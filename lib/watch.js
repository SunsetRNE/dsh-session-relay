/**
 * 核验清单（用户 2026-11-04 同意）：插件替主会话盯 CI 任务与远端分支 sha，结果变化时通知主会话并发手机通知。
 *
 * - 持久：每一项写进 watches.json（状态、上次结果、下次核验时间、待发通知）；DSH 重启后加载即补查一次，
 *   停机期间发生的变化按“上次结果 → 这次结果”判断，不会因为只记基线而漏掉。
 * - 只读：CI 用 `gh run view <id> -R <owner/repo> --json …`，远端分支用 `git ls-remote <remote> <ref>`；
 *   参数逐项校验，不拼 shell，不执行任何自由命令，不推送、不重跑。
 * - 重试：核验失败按 1 / 2 / 5 / 10 分钟递增退避；连续失败 failAlertAfter 次发一次“核验失败”，恢复后照常。
 * - 通知不丢、不重复：结果先记成待发（pending），投递成功才清掉；失败按 30 秒起翻倍退避（最长 10 分钟），24 小时还没送到才放弃；重启后补发。同一结果只通知一次。
 * - 登记时先查一次：永久性错误（gh 没装 / 没登录、run 或远端写错）直接拒绝；“等远端变化”的基线取登记这一刻。
 *   投递目标在发送时才解析：当时该工作区的主会话，没有主会话就发给创建者；都没有只发手机通知。
 */
import { execFile } from 'node:child_process'
import { rename, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { RelayError, clip, formatTime, writeJsonAtomic } from './core.js'

export const WATCH_DEFAULTS = Object.freeze({
  tickMs: 30_000,
  /** 刚登记的前 30 分钟每分钟查一次，之后每 5 分钟。 */
  fastMs: 60_000,
  slowMs: 5 * 60_000,
  fastWindowMs: 30 * 60_000,
  backoffMs: [60_000, 120_000, 300_000, 600_000],
  failAlertAfter: 5,
  defaultDeadlineMs: 6 * 3600_000,
  maxDeadlineMs: 7 * 24 * 3600_000,
  maxActive: 50,
  maxStored: 200,
  deliveryAttempts: 10,
  /** 会话投递失败按 30 秒起翻倍退避（最长 10 分钟），超过 24 小时还没送到才放弃（只留手机通知）。 */
  deliveryRetryMs: 30_000,
  deliveryRetryMaxMs: 10 * 60_000,
  deliveryGiveUpMs: 24 * 3600_000,
  commandTimeoutMs: 30_000
})

export const WATCH_KINDS = ['ci', 'ref']
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const RUN_RE = /^[0-9]{1,20}$/
const REMOTE_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/
const REF_RE = /^(?!.*\.\.)(?!.*\/\/)(?!-)[A-Za-z0-9._\/-]{1,200}$/
const SHA_RE = /^[0-9a-f]{7,40}$/i
const LABEL_LIMIT = 80
const STATES = new Set(['active', 'done', 'failed', 'timeout', 'cancelled'])

/** 校验并规范化一条登记请求；不合法抛 RelayError。 */
export function validateWatchRequest(request, { now = Date.now(), defaults = WATCH_DEFAULTS } = {}) {
  const kind = String(request?.kind ?? '')
  if (!WATCH_KINDS.includes(kind)) throw new RelayError(`kind 只能是 ${WATCH_KINDS.join(' / ')}`, 'invalid_watch')
  const cwd = String(request.cwd ?? '')
  if (!isAbsolute(cwd)) throw new RelayError('需要仓库所在的绝对路径（默认取当前会话目录）', 'invalid_watch')
  const label = request.label === undefined ? undefined : clip(String(request.label), LABEL_LIMIT)
  const hours = request.deadlineHours === undefined ? undefined : Number(request.deadlineHours)
  if (hours !== undefined && !(hours > 0)) throw new RelayError('deadline_hours 必须是正数', 'invalid_watch')
  const deadlineMs = Math.min(defaults.maxDeadlineMs, hours === undefined ? defaults.defaultDeadlineMs : Math.round(hours * 3600_000))
  const base = { kind, cwd, ...(label ? { label } : {}), deadline: now + deadlineMs }
  if (kind === 'ci') {
    const runId = String(request.runId ?? '').trim()
    if (!RUN_RE.test(runId)) throw new RelayError('run_id 必须是 GitHub Actions 的数字 run id', 'invalid_watch')
    const repo = request.repo === undefined ? undefined : String(request.repo).trim()
    if (repo !== undefined && !REPO_RE.test(repo)) throw new RelayError('repo 写成 owner/name', 'invalid_watch')
    return { ...base, runId, ...(repo ? { repo } : {}) }
  }
  const ref = String(request.ref ?? '').trim()
  if (!REF_RE.test(ref)) throw new RelayError('ref 只能是分支或 tag 名（字母、数字、. _ / -）', 'invalid_watch')
  const remote = String(request.remote ?? 'origin').trim()
  if (!REMOTE_RE.test(remote)) throw new RelayError('remote 只能是远端名（如 origin）', 'invalid_watch')
  const sha = request.sha === undefined || request.sha === '' ? undefined : String(request.sha).trim().toLowerCase()
  if (sha !== undefined && !SHA_RE.test(sha)) throw new RelayError('sha 写 7–40 位十六进制', 'invalid_watch')
  return { ...base, ref, remote, ...(sha ? { sha } : {}) }
}

/** 从 git remote URL 推出 owner/repo（只认 github.com）。 */
export function repoFromUrl(url) {
  const match = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(url ?? '').trim())
  return match ? `${match[1]}/${match[2]}` : undefined
}

function run(cmd, args, { cwd, timeout }) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', LC_ALL: 'C' } }, (error, stdout, stderr) => {
      if (error) reject(new Error(clip(String(stderr || error.message), 200)))
      else resolve(String(stdout))
    })
  })
}

/**
 * 默认核验器（真实命令）。测试注入替身。
 * ci → { done, ok, status, conclusion, sha, title, url }；ref → { sha | null }
 */
export const defaultCheckers = {
  async repoOf(cwd, timeout) {
    return repoFromUrl(await run('git', ['remote', 'get-url', 'origin'], { cwd, timeout }))
  },
  async ci(item, { timeout }) {
    const raw = await run('gh', ['run', 'view', item.runId, '-R', item.repo, '--json', 'status,conclusion,headSha,workflowName,displayTitle,url'], { cwd: item.cwd, timeout })
    const data = JSON.parse(raw)
    const done = data.status === 'completed'
    return { done, ok: done && data.conclusion === 'success', status: String(data.status ?? ''), conclusion: String(data.conclusion ?? ''), sha: String(data.headSha ?? '').slice(0, 40), title: clip(data.displayTitle || data.workflowName || '', 80), url: String(data.url ?? '') }
  },
  async ref(item, { timeout }) {
    return pickRefDetail(await run('git', ['ls-remote', item.remote, ...refCandidates(item.ref)], { cwd: item.cwd, timeout }), item.ref)
  }
}

/** ls-remote 的模式按尾部匹配（main 也会匹配 feature/main），所以传完整 ref，再按完全相等挑。 */
export function refCandidates(ref) {
  return ref.startsWith('refs/') ? [ref] : [`refs/heads/${ref}`, `refs/tags/${ref}`]
}

/** 从 ls-remote 输出挑出精确匹配的 sha：分支优先；附注 tag 取解引用后的提交（^{}）。未找到返回 null。 */
export function pickRef(output, ref) {
  return pickRefDetail(output, ref).sha
}

/**
 * 同上，另带附注 tag 的 tag 对象 sha（object）：用户可能填 `git rev-parse v1` 的 tag 对象 sha，
 * 也可能填 `v1^{}` 的提交 sha，两个都要能对上。
 * @returns {{ sha: string|null, object?: string }}
 */
export function pickRefDetail(output, ref) {
  const rows = new Map()
  for (const line of String(output).split('\n')) {
    const [sha, name] = line.trim().split(/\s+/)
    if (sha && name && SHA_RE.test(sha)) rows.set(name, sha.toLowerCase())
  }
  for (const name of refCandidates(ref)) {
    if (rows.has(name + '^{}')) return { sha: rows.get(name + '^{}'), ...(rows.has(name) ? { object: rows.get(name) } : {}) }
    if (rows.has(name)) return { sha: rows.get(name) }
  }
  return { sha: null }
}

/** 永久性错误（命令不存在、没登录、run / 仓库 / 远端写错）：登记时直接拒绝，不进退避重试。网络类错误不算。 */
export function isPermanentError(error) {
  const text = String(error?.code ?? '') + ' ' + String(error?.message ?? error ?? '')
  return /ENOENT|HTTP 40[134]|gh auth login|not logged in|could not find|not found|not a git repository|does not appear to be a git repository|No such remote/i.test(text)
}

/** 记一条待发通知：已有没发出去的就接在后面（不覆盖），以最新的成败为准。 */
function queueNotice(target, notice, now) {
  const previous = target.pending
  target.pending = previous === undefined
    ? { ...notice, at: now, attempts: 0 }
    : { ok: notice.ok, text: `${previous.text}；${notice.text}`, at: now, attempts: 0 }
}

/** 一次核验结果 → 是否结束、要发的通知。纯函数，便于测试。 */
export function evaluate(item, result, now) {
  if (item.kind === 'ci') {
    const last = { status: result.status, conclusion: result.conclusion, sha: result.sha, title: result.title, url: result.url }
    if (!result.done) return { last }
    return { last, state: result.ok ? 'done' : 'failed', notice: { ok: result.ok, text: `CI ${item.runId}${result.title ? `「${result.title}」` : ''} ${result.ok ? '成功' : `结束：${result.conclusion || '未知结论'}`}${result.sha ? `（sha ${result.sha.slice(0, 8)}）` : ''}${result.url ? ` ${result.url}` : ''}` } }
  }
  const sha = result.sha
  const last = { sha, ...(result.object ? { object: result.object } : {}) }
  const where = `${item.remote}/${item.ref}`
  if (item.sha) {
    if (sha !== null && (sha.startsWith(item.sha) || result.object?.startsWith(item.sha))) return { last, state: 'done', notice: { ok: true, text: `远端 ${where} 已是期望的 ${item.sha.slice(0, 8)}（推送生效）` } }
    // 远端变成了别的 sha（被别人推送 / force push）：提醒一次，继续等期望值
    const before = item.last?.sha
    if (item.last !== undefined && sha !== null && sha !== before) return { last, notice: { ok: false, text: `远端 ${where} 变成了 ${sha.slice(0, 8)}${before ? `（原来是 ${before.slice(0, 8)}）` : ''}，不是期望的 ${item.sha.slice(0, 8)}；继续等` } }
    return { last }
  }
  // 没给期望 sha：基线在登记时记下（见 WatchRunner.add）；旧数据没有基线的，第一次只记基线
  if (item.baseline === undefined) return { last, baseline: sha }
  if (sha !== item.baseline) return { last, state: 'done', notice: { ok: sha !== null, text: sha === null ? `远端 ${where} 已被删除（原来是 ${String(item.baseline).slice(0, 8)}）` : `远端 ${where} 变了：${item.baseline === null ? '新建' : String(item.baseline).slice(0, 8)} → ${sha.slice(0, 8)}` } }
  return { last }
}

export function describeWatch(item) {
  const what = item.kind === 'ci' ? `CI ${item.runId}${item.repo ? ` @${item.repo}` : ''}` : `${item.remote}/${item.ref}${item.sha ? ` = ${item.sha.slice(0, 8)}` : ' 变化'}`
  return `${item.label ? `${item.label} · ` : ''}${what}`
}

export class WatchStore {
  constructor(path, { now = Date.now, maxStored = WATCH_DEFAULTS.maxStored } = {}) {
    this.path = path
    this.now = now
    this.maxStored = maxStored
    this.state = { items: [], chainSeen: {} }
    this.loaded = false
    this.chain = Promise.resolve()
  }

  async load() {
    let parsed
    try { parsed = JSON.parse(await readFile(this.path, 'utf8')) } catch (error) {
      if (error instanceof SyntaxError) {
        // 文件损坏：先挪开留底再按空清单继续，不被下一次写入直接覆盖
        this.corruptPath = `${this.path}.corrupt-${this.now()}`
        await rename(this.path, this.corruptPath).catch(() => { this.corruptPath = undefined })
      } else if (error?.code !== 'ENOENT') throw error
    }
    const items = Array.isArray(parsed?.items) ? parsed.items.filter((item) => item && typeof item.id === 'string' && WATCH_KINDS.includes(item.kind) && STATES.has(item.state)) : []
    const chainSeen = parsed?.chainSeen && typeof parsed.chainSeen === 'object' ? parsed.chainSeen : {}
    this.state = { items, chainSeen }
    this.loaded = true
    return this.state
  }

  mutate(fn) {
    const runIt = this.chain.then(async () => {
      if (!this.loaded) await this.load()
      const next = { items: this.state.items.map((item) => ({ ...item })), chainSeen: { ...this.state.chainSeen } }
      const result = fn(next)
      // 结束且通知已发的旧条目超过上限时丢最旧的
      while (next.items.length > this.maxStored) {
        const index = next.items.findIndex((item) => item.state !== 'active' && item.pending === undefined)
        if (index < 0) break
        next.items.splice(index, 1)
      }
      await writeJsonAtomic(this.path, { version: 1, ...next })
      this.state = next
      return result
    })
    this.chain = runIt.catch(() => {})
    return runIt
  }

  items() { return this.state.items }
}

/**
 * 调度器。依赖由 relay 注入：
 * @param opts.resolveTarget - (item) => sessionId | undefined（发送时解析：主会话优先，其次创建者）
 * @param opts.deliver - (sessionId, text) => Promise
 * @param opts.notify - (title, text) => Promise
 */
export class WatchRunner {
  constructor({ store, checkers = defaultCheckers, resolveTarget, deliver, notify, label = (key) => key, logger, now = Date.now, setTimer = setInterval, clearTimer = clearInterval, ...config }) {
    this.store = store
    this.checkers = checkers
    this.resolveTarget = resolveTarget
    this.deliver = deliver
    this.notify = notify
    this.label = label
    this.logger = logger
    this.now = now
    this.config = { ...WATCH_DEFAULTS, ...config }
    this.clearTimer = clearTimer
    this.running = false
    if (this.config.tickMs > 0) {
      this.timer = setTimer(() => { void this.tick().catch((error) => this.logger?.warn?.(`session-relay: watch tick failed: ${error?.message ?? error}`)) }, this.config.tickMs)
      this.timer?.unref?.()
    }
  }

  async add(request, { group, createdBy, origin }) {
    const now = this.now()
    const clean = validateWatchRequest(request, { now, defaults: this.config })
    const info = await stat(clean.cwd).catch(() => undefined)
    if (!info?.isDirectory()) throw new RelayError(`目录不存在：${clean.cwd}`, 'invalid_watch')
    if (clean.kind === 'ci' && clean.repo === undefined) {
      clean.repo = await this.checkers.repoOf(clean.cwd, this.config.commandTimeoutMs).catch(() => undefined)
      if (clean.repo === undefined) throw new RelayError('推不出仓库（origin 不是 github.com），请写 repo=owner/name', 'invalid_watch')
    }
    if (!this.store.loaded) await this.store.load()
    const active = this.store.items().filter((item) => item.state === 'active')
    if (active.length >= this.config.maxActive) throw new RelayError(`进行中的核验已有 ${active.length} 项，先取消一些`, 'too_many_watches')
    const same = active.find((item) => item.group === group && describeWatch({ ...item, label: undefined }) === describeWatch({ ...clean, label: undefined }) && item.cwd === clean.cwd)
    if (same) return { item: same, duplicate: true }
    // 登记时先查一次：永久性错误直接拒绝；“等远端变化”的基线就是这一刻的远端（不是第一次查成功时），
    // 否则第一次查询失败期间发生的推送 / 新 tag 会被当成基线吞掉
    let probe
    try {
      probe = await this.checkers[clean.kind](clean, { timeout: this.config.commandTimeoutMs })
    } catch (error) {
      const reason = clip(String(error?.message ?? error), 160)
      if (isPermanentError(error)) throw new RelayError(`登记前核验失败（不会自己好）：${reason}`, 'invalid_watch')
      if (clean.kind === 'ref' && clean.sha === undefined) throw new RelayError(`查不到远端现在的状态，没法记基线：${reason}。稍后再试，或直接给期望 sha`, 'invalid_watch')
    }
    const seed = probe === undefined ? {} : clean.kind === 'ref' ? { last: { sha: probe.sha, ...(probe.object ? { object: probe.object } : {}) }, ...(clean.sha === undefined ? { baseline: probe.sha } : {}) } : {}
    const item = { id: randomBytes(4).toString('hex'), ...clean, group, ...(createdBy ? { createdBy } : {}), origin, state: 'active', createdAt: now, nextAt: now, fails: 0, ...seed }
    await this.store.mutate((state) => { state.items.push(item) })
    // 登记后马上查一次（不等它查完再返回）
    this.firstCheck = this.tick().catch(() => {})
    return { item, duplicate: false }
  }

  async cancel(id, group) {
    if (!this.store.loaded) await this.store.load()
    const found = this.store.items().find((item) => item.id === id && (group === undefined || item.group === group))
    if (found === undefined) throw new RelayError(`找不到核验 ${id}`, 'not_found')
    if (found.state !== 'active') return found
    return this.store.mutate((state) => {
      const item = state.items.find((entry) => entry.id === id)
      item.state = 'cancelled'
      item.endedAt = this.now()
      return item
    })
  }

  list(group) {
    return this.store.items().filter((item) => group === undefined || item.group === group)
  }

  nextDelay(item, now) {
    if (item.fails > 0) return this.config.backoffMs[Math.min(item.fails - 1, this.config.backoffMs.length - 1)]
    return now - item.createdAt < this.config.fastWindowMs ? this.config.fastMs : this.config.slowMs
  }

  /** 一轮：查到期的项，然后补发待发通知。重入时等正在进行的那一轮，不并发。 */
  tick() {
    if (this.current !== undefined) return this.current
    this.current = this.runTick().finally(() => { this.current = undefined })
    return this.current
  }

  async runTick() {
    if (this.disposed) return
    if (!this.store.loaded) await this.store.load()
    const now = this.now()
    const due = this.store.items().filter((item) => item.state === 'active' && (item.nextAt ?? 0) <= now)
    for (const item of due) {
      if (this.disposed) return
      await this.checkOne(item.id)
    }
    if (!this.disposed) await this.flush()
  }

  async checkOne(id) {
    const item = this.store.items().find((entry) => entry.id === id)
    if (item === undefined || item.state !== 'active') return
    const now = this.now()
    let outcome
    let error
    try {
      outcome = evaluate(item, await this.checkers[item.kind](item, { timeout: this.config.commandTimeoutMs }), now)
    } catch (caught) {
      error = caught
    }
    await this.store.mutate((state) => {
      const target = state.items.find((entry) => entry.id === id)
      if (target === undefined || target.state !== 'active') return
      target.checkedAt = now
      if (error !== undefined) {
        target.fails = (target.fails ?? 0) + 1
        target.lastError = clip(String(error?.message ?? error), 200)
        if (target.fails === this.config.failAlertAfter) queueNotice(target, { ok: false, text: `核验 ${describeWatch(target)} 连续 ${target.fails} 次失败：${target.lastError}（会继续按退避重试）` }, now)
      } else {
        if (target.fails >= this.config.failAlertAfter) queueNotice(target, { ok: true, text: `核验 ${describeWatch(target)} 已恢复` }, now)
        target.fails = 0
        delete target.lastError
        target.last = outcome.last
        if ('baseline' in outcome) target.baseline = outcome.baseline
        if (outcome.state) {
          target.state = outcome.state
          target.endedAt = now
        }
        if (outcome.notice) queueNotice(target, outcome.notice, now)
      }
      if (target.state === 'active' && now >= target.deadline) {
        target.state = 'timeout'
        target.endedAt = now
        const seen = target.kind === 'ci' ? (target.last?.status ? `最后状态 ${target.last.status}` : '一直没查到结果') : `远端最后是 ${target.last?.sha ? target.last.sha.slice(0, 8) : '不存在'}`
        queueNotice(target, { ok: false, text: `核验 ${describeWatch(target)} 超时（登记于 ${formatTime(target.createdAt)}），${seen}` }, now)
      }
      if (target.state === 'active') target.nextAt = now + this.nextDelay(target, now)
    })
  }

  /** 补发待发通知：同一投递目标合成一条；投递成功才清掉。手机通知每条只发一次。 */
  async flush() {
    const now = this.now()
    const pending = this.store.items().filter((item) => item.pending !== undefined && (item.pending.retryAt ?? 0) <= now)
    if (pending.length === 0) return []
    const byTarget = new Map()
    for (const item of pending) {
      const target = this.resolveTarget(item)
      const key = target ?? ''
      if (!byTarget.has(key)) byTarget.set(key, [])
      byTarget.get(key).push(item)
    }
    const sent = []
    for (const [target, items] of byTarget) {
      // 手机通知：每项只发一次（phoned 标记），失败不重试，不影响会话投递
      for (const item of items.filter((entry) => !entry.pending.phoned)) {
        await Promise.resolve(this.notify?.(item.pending.ok ? '核验完成' : '核验需要处理', `${item.label ?? describeWatch(item)}：${item.pending.text}`)).catch((error) => this.logger?.warn?.(`session-relay: watch phone notify failed: ${error?.message ?? error}`))
      }
      await this.store.mutate((state) => { for (const item of items) { const entry = state.items.find((x) => x.id === item.id); if (entry?.pending) entry.pending = { ...entry.pending, phoned: true } } })
      let delivered = target === ''
      if (target !== '') {
        try {
          await this.deliver(target, frameWatchNotice({ workspaceTitle: this.label(items[0].group), items }))
          delivered = true
        } catch (error) {
          this.logger?.warn?.(`session-relay: watch notice to ${target} failed: ${error?.message ?? error}`)
        }
      }
      await this.store.mutate((state) => {
        for (const item of items) {
          const entry = state.items.find((x) => x.id === item.id)
          if (entry?.pending === undefined) continue
          entry.pending.attempts = (entry.pending.attempts ?? 0) + 1
          const at = this.now()
          if (delivered || at - (entry.pending.at ?? at) >= this.config.deliveryGiveUpMs) {
            entry.notified = { at, to: target || null, text: entry.pending.text, ...(delivered ? {} : { gaveUp: true }) }
            delete entry.pending
          } else {
            // 主会话忙 / DSH 刚起来：退避重试，不是 5 分钟就放弃
            entry.pending.retryAt = at + Math.min(this.config.deliveryRetryMaxMs, this.config.deliveryRetryMs * 2 ** (entry.pending.attempts - 1))
          }
        }
      })
      if (delivered) sent.push({ to: target || null, ids: items.map((item) => item.id) })
    }
    return sent
  }

  dispose() {
    this.disposed = true
    if (this.timer !== undefined) this.clearTimer(this.timer)
    this.timer = undefined
  }
}

export function frameWatchNotice({ workspaceTitle, items }) {
  const lines = [
    `[协作插件 · 核验结果${workspaceTitle ? ` · 工作区 ${workspaceTitle}` : ''}]`,
    '这是插件按核验清单只读查询（gh run view / git ls-remote）后自动发的通知，不是用户指令。推送、发布、重跑仍须按约定核对并经用户同意；结果未知的命令不要重放。',
    ''
  ]
  for (const item of items) lines.push(`- ${item.pending.ok ? '✓' : '⚠'} ${item.pending.text}${item.label ? `（${item.label}）` : ''} · 核验 ${item.id}`)
  return lines.join('\n')
}

/** 上下文 / 列表用的一行。 */
export function watchLine(item) {
  const state = { active: '核验中', done: '完成', failed: '失败', timeout: '超时', cancelled: '已取消' }[item.state]
  const tail = item.state === 'active'
    ? `${item.fails > 0 ? `连续失败 ${item.fails} 次` : item.checkedAt ? `上次 ${formatTime(item.checkedAt)}` : '等待首次核验'} · 截止 ${formatTime(item.deadline)}`
    : item.notified ? `已通知 ${formatTime(item.notified.at)}${item.notified.gaveUp ? '（会话投递失败，只发了手机通知）' : ''}` : item.pending ? '通知待发' : ''
  return `${item.id} · ${state} · ${describeWatch(item)}${tail ? ` · ${tail}` : ''}`
}
