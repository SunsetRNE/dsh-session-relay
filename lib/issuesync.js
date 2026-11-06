/**
 * R1 GitHub issue 投影（2.0.0 之后的第一块，本地为准、单向）。
 *
 * - 任务库是唯一事实源；这里只在仓库开关 `issues` 打开时，把任务投影成 GitHub issue，
 *   并把本地状态变化投影成评论 / 关票；GitHub 上的改动不反推本地任务。
 * - 出站按仓库串行；每步先查 marker 再写，重复触发不会重复建票。
 * - 超时 / 断网 / gh 回执不明记 `unknown`，不当作成功，也不改本地任务；按退避重试。
 * - 只有用户打开 `issues`（可选 `closeOnTerminal`）才会写 GitHub；模型工具没有写入口。
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ghEnv } from './ghenv.js'

export const SYNC_FILE = 'sync.json'
export const SYNC_VERSION = 1
/** 指数退避：30s → 2m → 8m → 30m → 1h 封顶；抖动 ±20%。 */
export const BACKOFF_MS = Object.freeze([30_000, 120_000, 480_000, 1_800_000, 3_600_000])
const FLUSH_LIMIT = 20
const MAX_QUEUE = 200

const STATE_TEXT = {
  open: '待认领',
  live: '进行中',
  dead: '持有者已失效',
  stale: '持有者久未活动',
  queued: '待合并',
  partial: '部分合入',
  likely: '疑似已合入',
  merged: '已合并',
  abandoned: '已放弃',
  unknown: '状态未知'
}

/** 执行一次 gh；测试可替换。 */
function runGh(args, { timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout, maxBuffer: 4 * 1024 * 1024, env: ghEnv(process.env) }, (error, stdout, stderr) => {
      if (error) { error.stderr = String(stderr ?? ''); error.stdout = String(stdout ?? ''); reject(error) } else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

function oneLine(value, max = 300) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

function taskIdOf(value) {
  return String(value ?? '').trim().toUpperCase()
}

/** 建票/评论用的标题、正文与 marker；正文里也写清「本地为准」。 */
export function issueTitle(task) {
  return `[relay ${task.id}] ${oneLine(task.title, 180) || task.id}`
}

export function issueMarker(taskId) {
  return `<!-- relay-task:${taskIdOf(taskId)} -->`
}

export function issueBody(task) {
  const lines = [
    issueMarker(task.id),
    `本地任务：${task.id}${task.title ? ` · ${oneLine(task.title, 200)}` : ''}`,
    '',
    `- 状态：${STATE_TEXT[task.state] ?? task.state ?? '未知'}${task.why ? `（${oneLine(task.why, 160)}）` : ''}`,
    ...(task.stage ? [`- 阶段：${task.stage}`] : []),
    ...(task.priority ? [`- 优先级：${task.priority}`] : []),
    ...(task.worktree ? [`- 工作树：${task.worktree}`] : []),
    ...(task.holderLabel ? [`- 认领：${task.holderLabel}`] : []),
    ...(task.statusText ? [`- 看板状态：${oneLine(task.statusText, 300)}`] : []),
    ...(task.approval ? [`- 审批：${task.approval}${task.approvalNote ? `（${oneLine(task.approvalNote, 160)}）` : ''}`] : []),
    '',
    'relay 任务库是事实源；本票由 relay 按本地状态单向投影，GitHub 上的改动不会反推本地任务。'
  ]
  return lines.join('\n')
}

/** 终态评论：只有合并已审批 / 已放弃才评论；待审批的合并票保持 open、不评论。 */
export function terminalComment(task) {
  if (task.state === 'merged' && task.approval === 'approved') {
    return `relay：任务 ${task.id} 已合并${task.done ? `（${oneLine(task.done, 500)}）` : ''}。审批记录：${oneLine(task.approvalNote, 200) || '已通过'}。`
  }
  if (task.state === 'abandoned') {
    return `relay：任务 ${task.id} 已放弃${task.abandoned ? `（${oneLine(task.abandoned, 500)}）` : ''}。`
  }
  return undefined
}

/** 关票条件：用户打开 closeOnTerminal；合并票还要审批通过且有合并结论；放弃票要有放弃原因。 */
export function shouldCloseIssue(task, switches = {}) {
  if (switches.closeOnTerminal !== true) return false
  if (task.state === 'abandoned') return true
  if (task.state !== 'merged' || task.approval !== 'approved') return false
  return typeof task.done === 'string' && task.done.trim() !== ''
}

/**
 * 把 gh 失败分成 unknown / failed。
 * 设计：超时、连接重置、DNS/TLS、5xx、gh 回执不明都算 unknown；401/403/404/422 是明确失败。
 */
export function classifyGhFailure(error) {
  const text = `${error?.stderr ?? ''}\n${error?.message ?? ''}`
  const message = oneLine(text, 240) || 'gh 调用失败'
  if (error?.killed === true || error?.signal !== undefined) return { unknown: true, error: message }
  if (/HTTP (401|403|404|409|422)\b|Resource not accessible|Not Found|Validation Failed|already exists/i.test(text)) {
    return { unknown: false, error: message }
  }
  // 默认按 unknown：宁可重试前先搜，也不能把可能已建好的票当失败再建一张。
  return { unknown: true, error: message }
}

function backoffDelay(attempts, now = Date.now()) {
  const base = BACKOFF_MS[Math.min(Math.max(0, attempts - 1), BACKOFF_MS.length - 1)]
  const jitter = 0.8 + Math.random() * 0.4
  return Math.round(base * jitter)
}

function normalizeState(parsed) {
  const state = { version: SYNC_VERSION, repos: {} }
  if (parsed === null || typeof parsed !== 'object' || parsed.repos === null || typeof parsed.repos !== 'object') return state
  for (const [repo, value] of Object.entries(parsed.repos)) {
    if (value === null || typeof value !== 'object') continue
    const links = value.links !== null && typeof value.links === 'object' ? { ...value.links } : {}
    const queue = Array.isArray(value.queue) ? value.queue.map(taskIdOf).filter(Boolean).slice(0, MAX_QUEUE) : []
    state.repos[repo] = { paused: value.paused === true, links, queue, updatedAt: Number(value.updatedAt) || 0 }
  }
  return state
}

/**
 * 每个任务库一份 sync.json；一个工作区里的任务与其 origin 仓库绑定。
 * 依赖注入：repoStore.switches(repo) 读仓库开关；readTask({repo, taskId}) 返回本地任务快照。
 */
export class IssueSync {
  constructor(storeRoot, { gh = runGh, now = Date.now, repoStore, readTask, logger } = {}) {
    this.storeRoot = storeRoot
    this.path = join(storeRoot, SYNC_FILE)
    this.gh = gh
    this.now = now
    this.repoStore = repoStore
    this.readTask = readTask
    this.logger = logger
    this.state = { version: SYNC_VERSION, repos: {} }
    this.loaded = false
    this.chain = Promise.resolve()
  }

  async load() {
    if (this.loaded) return this.state
    try {
      this.state = normalizeState(JSON.parse(await readFile(this.path, 'utf8')))
    } catch { this.state = { version: SYNC_VERSION, repos: {} } }
    this.loaded = true
    return this.state
  }

  async save() {
    await mkdir(dirname(this.path), { recursive: true }).catch(() => {})
    const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    await rename(tmp, this.path)
  }

  repo(repo) {
    const key = String(repo ?? '')
    this.state.repos[key] ??= { paused: false, links: {}, queue: [], updatedAt: 0 }
    return this.state.repos[key]
  }

  getLink(repo, taskId) {
    return this.repo(repo).links[taskIdOf(taskId)]
  }

  /** 有出站意图就排队；重复触发只保留一条。 */
  async enqueue(repo, taskId, { reason = 'update' } = {}) {
    await this.load()
    const id = taskIdOf(taskId)
    if (id === '') return { queued: false, reason: 'bad_task_id' }
    const bucket = this.repo(repo)
    const previous = bucket.links[id] ?? {}
    bucket.links[id] = {
      ...previous,
      state: previous.state === 'unknown' ? 'unknown' : 'queued',
      reason,
      attempts: Number(previous.attempts) || 0,
      commentKeys: Array.isArray(previous.commentKeys) ? previous.commentKeys : []
    }
    if (!bucket.queue.includes(id)) bucket.queue.push(id)
    while (bucket.queue.length > MAX_QUEUE) {
      const dropped = bucket.queue.shift()
      if (bucket.links[dropped] !== undefined) {
        bucket.links[dropped].state = 'failed'
        bucket.links[dropped].lastError = '同步队列超过上限，未发送；任务本身不受影响'
      }
    }
    bucket.updatedAt = this.now()
    await this.save()
    return { queued: true, id, repo }
  }

  async setPaused(repo, paused) {
    await this.load()
    const bucket = this.repo(repo)
    bucket.paused = paused === true
    bucket.updatedAt = this.now()
    await this.save()
    return bucket.paused
  }

  async retry(repo, taskId) {
    await this.load()
    const id = taskIdOf(taskId)
    const bucket = this.repo(repo)
    const link = bucket.links[id]
    if (link === undefined) return false
    link.state = 'queued'
    link.nextAttemptAt = null
    link.unknownSince = null
    if (!bucket.queue.includes(id)) bucket.queue.push(id)
    await this.save()
    return true
  }

  async detach(repo, taskId) {
    await this.load()
    const id = taskIdOf(taskId)
    const bucket = this.repo(repo)
    const existed = bucket.links[id] !== undefined
    delete bucket.links[id]
    bucket.queue = bucket.queue.filter((item) => item !== id)
    await this.save()
    return existed
  }

  /** 串行刷新；同一实例的并发调用不会同时发同一仓库的请求。 */
  async flush() {
    const run = this.chain.then(() => this.drain())
    this.chain = run.catch(() => {})
    return run
  }

  async drain() {
    await this.load()
    const report = []
    for (const [repo, bucket] of Object.entries(this.state.repos)) {
      if (bucket.paused) continue
      let processed = 0
      while (bucket.queue.length > 0 && processed < FLUSH_LIMIT) {
        const id = bucket.queue[0]
        const link = bucket.links[id]
        if (link?.nextAttemptAt !== undefined && Number(link.nextAttemptAt) > this.now()) break
        const result = await this.process(repo, id)
        report.push({ repo, id, ...result })
        await this.save()
        if (result.retry) break
        bucket.queue.shift()
        processed += 1
      }
    }
    return report
  }

  async process(repo, taskId) {
    const bucket = this.repo(repo)
    const id = taskIdOf(taskId)
    const link = bucket.links[id] ?? (bucket.links[id] = { state: 'queued', attempts: 0, commentKeys: [] })
    const switches = await this.repoStore?.switches?.(repo).catch(() => undefined)
    if (switches?.issues !== true) {
      link.state = 'local'
      link.lastError = ''
      // 开关关着：保留队列，等用户打开后同一批继续（不丢失本地意图）
      return { skipped: 'issues_off', retry: true }
    }
    let task
    try {
      task = await this.readTask?.({ repo, taskId: id })
    } catch (error) {
      task = undefined
      link.lastError = oneLine(error?.message ?? error, 240)
    }
    if (task === undefined || task === null) {
      link.state = 'failed'
      link.lastError = link.lastError || `本地任务库没有 ${id}`
      return { failed: true, dropped: true, error: link.lastError }
    }
    link.intent = link.issue === undefined ? 'create' : 'update'
    link.state = 'in-flight'
    link.attempts = (Number(link.attempts) || 0) + 1
    link.lastAttemptAt = this.now()
    try {
      let number = Number(link.issue)
      if (!Number.isInteger(number) || number <= 0) {
        const found = await this.findIssue(repo, id)
        if (found.conflict !== undefined) {
          link.state = 'conflict'
          link.lastError = found.conflict
          link.nextAttemptAt = null
          return { conflict: true, error: found.conflict }
        }
        if (found.issue !== undefined) {
          number = found.issue.number
          link.issue = number
          link.url = found.issue.url
          link.remoteState = found.issue.state
        } else {
          const created = await this.createIssue(repo, task)
          number = created.number
          link.issue = number
          link.url = created.url
          link.remoteState = 'open'
        }
      }
      const remote = await this.updateIssue(repo, number, task)
      if (remote?.state) link.remoteState = remote.state
      const comment = terminalComment(task)
      if (comment !== undefined) {
        const key = `${task.state}:${task.approval ?? ''}:${task.stage ?? ''}:${comment.length}`
        if (!link.commentKeys.includes(key)) {
          await this.commentIssue(repo, number, comment)
          link.commentKeys = [...link.commentKeys, key].slice(-50)
        }
      }
      if (shouldCloseIssue(task, switches)) {
        await this.closeIssue(repo, number)
        link.remoteState = 'closed'
      }
      link.state = 'synced'
      link.lastError = ''
      link.unknownSince = null
      link.nextAttemptAt = null
      link.lastSyncedAt = this.now()
      return { synced: true, issue: number, url: link.url }
    } catch (error) {
      const failure = classifyGhFailure(error)
      link.state = failure.unknown ? 'unknown' : 'failed'
      link.lastError = failure.error
      if (failure.unknown) link.unknownSince ??= this.now()
      link.nextAttemptAt = this.now() + backoffDelay(link.attempts, this.now())
      return { [failure.unknown ? 'unknown' : 'failed']: true, error: failure.error, retry: true }
    }
  }

  /** 按 marker 搜已存在的票；重试前先搜，避免重复建票。 */
  async findIssue(repo, taskId) {
    const id = taskIdOf(taskId)
    const { stdout } = await this.gh(['issue', 'list', '--repo', repo, '--state', 'all', '--search', `relay-task:${id} in:body`, '--json', 'number,url,state,title,body'])
    const items = JSON.parse(stdout)
    if (!Array.isArray(items)) throw new Error('issue 搜索返回的不是数组')
    const marker = issueMarker(id)
    const matches = items.filter((item) => typeof item?.body === 'string' && item.body.includes(marker))
    if (matches.length === 0) return { issue: undefined }
    if (matches.length > 1) return { conflict: `找到 ${matches.length} 张带 ${marker} 的票（#${matches.map((item) => item.number).join('、#')}）；先人工确认哪张是准的` }
    const item = matches[0]
    return { issue: { number: Number(item.number), url: typeof item.url === 'string' ? item.url : undefined, state: typeof item.state === 'string' ? item.state.toLowerCase() : undefined } }
  }

  async createIssue(repo, task) {
    const { stdout } = await this.gh(['api', `repos/${repo}/issues`, '-X', 'POST', '-f', `title=${issueTitle(task)}`, '-f', `body=${issueBody(task)}`])
    const info = JSON.parse(stdout)
    const number = Number(info?.number)
    if (!Number.isInteger(number) || number <= 0) throw new Error('建票回执里没有 issue 号')
    return { number, url: typeof info?.html_url === 'string' ? info.html_url : `https://github.com/${repo}/issues/${number}` }
  }

  async updateIssue(repo, number, task) {
    const { stdout } = await this.gh(['api', `repos/${repo}/issues/${number}`, '-X', 'PATCH', '-f', `title=${issueTitle(task)}`, '-f', `body=${issueBody(task)}`])
    let info
    try { info = JSON.parse(stdout) } catch { info = {} }
    return { state: typeof info?.state === 'string' ? info.state : undefined }
  }

  async commentIssue(repo, number, body) {
    await this.gh(['api', `repos/${repo}/issues/${number}/comments`, '-X', 'POST', '-f', `body=${body}`])
  }

  async closeIssue(repo, number) {
    await this.gh(['api', `repos/${repo}/issues/${number}`, '-X', 'PATCH', '-f', 'state=closed'])
  }

  /** 命令展示用的只读摘要。 */
  async summary(repo) {
    await this.load()
    const switches = await this.repoStore?.switches?.(repo).catch(() => undefined)
    const bucket = this.state.repos[repo]
    const switchView = {
      issues: switches?.issues === true,
      closeOnTerminal: switches?.closeOnTerminal === true,
      labelSync: switches?.labelSync === true
    }
    if (bucket === undefined) return { repo, paused: false, queue: 0, links: [], switches: switchView }
    return {
      repo,
      paused: bucket.paused === true,
      queue: bucket.queue.length,
      switches: switchView,
      links: Object.entries(bucket.links).map(([id, link]) => ({
        id,
        issue: Number.isInteger(Number(link.issue)) ? Number(link.issue) : null,
        url: link.url ?? null,
        state: link.state ?? 'local',
        attempts: Number(link.attempts) || 0,
        lastError: link.lastError ?? '',
        unknownSince: link.unknownSince ?? null,
        lastSyncedAt: link.lastSyncedAt ?? null,
        nextAttemptAt: link.nextAttemptAt ?? null,
        remoteState: link.remoteState ?? null
      }))
    }
  }
}

/** 命令输出：状态 + 每条链接票。 */
export function describeIssueSync(summary, { formatTime = (value) => new Date(value).toISOString() } = {}) {
  const sw = summary.switches ?? {}
  const lines = [`GitHub 同步：${summary.repo} · ${summary.paused ? '已暂停' : '运行中'} · 队列 ${summary.queue} 条 · issues 开关 ${sw.issues ? '开' : '关'}${sw.closeOnTerminal ? ' · 终态关票 开' : ''}`]
  if (summary.links.length === 0) {
    lines.push('还没有链接票。任务变化且 issues 开关打开后会排队；也可 /relay sync backfill 先投影现有任务。')
    return lines.join('\n')
  }
  for (const link of summary.links.slice(-30)) {
    const parts = [`${link.id}`, link.issue ? `#${link.issue}` : '未建票', link.state]
    if (link.remoteState) parts.push(`远端 ${link.remoteState}`)
    if (link.attempts > 0) parts.push(`尝试 ${link.attempts} 次`)
    if (link.lastError) parts.push(`错误：${oneLine(link.lastError, 120)}`)
    if (link.lastSyncedAt) parts.push(`最近同步 ${formatTime(link.lastSyncedAt)}`)
    if (link.nextAttemptAt && link.state !== 'synced' && link.state !== 'failed') parts.push(`下次 ${formatTime(link.nextAttemptAt)}`)
    lines.push(`- ${parts.join(' · ')}`)
  }
  return lines.join('\n')
}
