/**
 * 仓库守候（2.1.0 核心）：轮询 GitHub issue/PR，按过滤规则在会话空闲时唤醒。
 *
 * 与参考插件 dsh-session-superagent 的 2.1.0 对齐范围：仓库动态、过滤原因、活跃时段、
 * 每小时上限、空闲才唤醒、观察模式、本机 ack；Gitee / 自动隔离 worktree / 卫星环留到 2.2.0。
 *
 * - 只读轮询（gh api），不写 GitHub；ack 标签只由用户动作写入（模型工具只做本机 ack）。
 * - 每个会话对同一个仓库最多一条守候，id = `<owner/repo>#<sessionId>`；配置以盘上为准。
 * - 时间统一用毫秒时间戳，测试注入 now。
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { RelayError, writeJsonAtomic } from './core.js'
import { ghEnv } from './ghenv.js'

export const REPO_WATCH_VERSION = 1
export const INTERVAL_MIN = 60
export const INTERVAL_MAX = 3600
export const BATCH_MAX = 10
export const WAKES_MAX = 30
export const FILTER_LOG_MAX = 8
export const HISTORY_MAX = 20
const SEEN_MAX = 300
const SEEN_MAX_AGE_MS = 30 * 24 * 3600_000
const WAKE_WINDOW_MS = 3600_000
const ACK_COLOR = '0e8a16'
export const DEFAULT_ACK_LABEL = 'relay:ack'
const LABEL_RE = /^[A-Za-z0-9._:-]{1,50}$/

export const DEFAULT_FILTERS = Object.freeze({
  labels: Object.freeze([]),
  ignoreLabels: Object.freeze([]),
  skipClosed: true,
  skipBots: true,
  skipDrafts: true,
  onlyAssigned: false,
  assignee: null,
  allowAuthors: Object.freeze([])
})

export const REPO_WATCH_DEFAULTS = Object.freeze({
  intervalSec: 120,
  cooldownMs: 3 * 60_000,
  batchLimit: 5,
  maxWakesPerHour: 6,
  activeHours: null,
  ackLabel: DEFAULT_ACK_LABEL,
  observe: false
})

const list = (value) => (Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [])

/** owner/name 或 GitHub 地址；Gitee 明确拒绝（2.2.0 再做）。 */
export function normalizeRepo(input) {
  const text = String(input ?? '').trim()
  if (text === '') throw new RelayError('需要仓库：owner/name 或 GitHub 地址', 'bad_repo')
  if (/gitee/i.test(text)) throw new RelayError('Gitee 守候还没做（2.2.0）；2.1.0 先支持 GitHub', 'unsupported_provider')
  const url = text.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/?].*)?$/i)
  if (url) return `${url[1]}/${url[2]}`
  const plain = text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (plain) return `${plain[1]}/${plain[2]}`
  throw new RelayError(`仓库写法不对：${text}（用 owner/name）`, 'bad_repo')
}

export function normalizeFilters(raw) {
  const f = raw && typeof raw === 'object' ? raw : {}
  return {
    labels: list(f.labels),
    ignoreLabels: list(f.ignoreLabels),
    skipClosed: f.skipClosed !== false,
    skipBots: f.skipBots !== false,
    skipDrafts: f.skipDrafts !== false,
    onlyAssigned: f.onlyAssigned === true,
    assignee: typeof f.assignee === 'string' && f.assignee.trim() ? f.assignee.trim().replace(/^@/, '') : null,
    allowAuthors: list(f.allowAuthors).map((name) => name.replace(/^@/, ''))
  }
}

/** 活跃时段 "HH:MM-HH:MM"（本地时间；支持跨夜）；空/格式不对 = 一直活跃。 */
export function normalizeActiveHours(spec) {
  const text = String(spec ?? '').trim()
  if (text === '') return null
  const m = text.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
  if (m === null) throw new RelayError(`活跃时段写法不对：${text}（用 09:00-22:00）`, 'bad_active_hours')
  const hour = (value) => Number(value)
  if (hour(m[1]) > 23 || hour(m[3]) > 23 || hour(m[2]) > 59 || hour(m[4]) > 59) throw new RelayError(`活跃时段越界：${text}`, 'bad_active_hours')
  return `${String(hour(m[1])).padStart(2, '0')}:${m[2]}-${String(hour(m[3])).padStart(2, '0')}:${m[4]}`
}

export function inActiveHours(spec, now = new Date()) {
  if (!spec) return true
  const m = String(spec).match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/)
  if (m === null) return true
  const toMin = (h, mi) => (Number(h) * 60 + Number(mi)) % (24 * 60)
  const start = toMin(m[1], m[2])
  const end = toMin(m[3], m[4])
  const cur = now.getHours() * 60 + now.getMinutes()
  if (start === end) return true
  return start < end ? cur >= start && cur < end : cur >= start || cur < end
}

export function labelNames(item) {
  return (item?.labels ?? []).map((label) => (typeof label === 'string' ? label : label?.name)).filter(Boolean)
}

export function isBot(item) {
  const user = item?.user ?? {}
  return user.type === 'Bot' || /\[bot\]$/i.test(String(user.login ?? ''))
}

export function hasAckLabel(item, label) {
  return labelNames(item).some((name) => String(name).toLowerCase() === String(label ?? '').toLowerCase())
}

/** null = 通过；否则给一个可读原因，面板能解释「为什么没叫醒」。 */
export function filterReason(item, filters = DEFAULT_FILTERS) {
  const f = { ...DEFAULT_FILTERS, ...(filters ?? {}) }
  if (f.skipClosed && item?.state && item.state !== 'open') return '已关闭'
  if (f.skipDrafts && item?.draft === true) return '草稿 PR'
  if (f.skipBots && isBot(item)) return '机器人'
  const names = labelNames(item).map((name) => String(name).toLowerCase())
  const ignored = list(f.ignoreLabels).map((name) => name.toLowerCase()).find((name) => names.includes(name))
  if (ignored) return `排除标签：${ignored}`
  const wanted = list(f.labels).map((name) => name.toLowerCase())
  if (wanted.length > 0 && !wanted.some((name) => names.includes(name))) return `不在标签白名单：${f.labels.join(', ')}`
  const authors = list(f.allowAuthors).map((name) => name.toLowerCase())
  if (authors.length > 0) {
    const login = String(item?.user?.login ?? '').toLowerCase()
    if (!authors.includes(login)) return `作者不在名单：@${login || '?'}`
  }
  if (f.onlyAssigned) {
    const assignees = (item?.assignees ?? []).map((entry) => String(entry?.login ?? entry).toLowerCase())
    if (f.assignee) return assignees.includes(String(f.assignee).toLowerCase()) ? null : `未指派给 @${f.assignee}`
    return assignees.length > 0 ? null : '没有指派给人'
  }
  return null
}

const updatedMs = (item) => {
  const value = Date.parse(String(item?.updated_at ?? ''))
  return Number.isFinite(value) ? value : 0
}

/** 水位 + 冷却：只把「相对上次看到有更新」的条目当 fresh；冷却期内的更新 absorbed（推进水位但不唤醒）。 */
export function partitionItems(items, watch = {}, { now = Date.now(), cooldownMs = REPO_WATCH_DEFAULTS.cooldownMs } = {}) {
  if (!Array.isArray(items)) return { fresh: [], absorbed: [] }
  const seen = watch.seen ?? {}
  const reported = watch.lastReported ?? {}
  const floor = Date.parse(String(watch.cursor ?? ''))
  const fresh = []
  const absorbed = []
  for (const item of items) {
    const key = String(item.number)
    const prev = seen[key]
    const baseline = prev !== undefined ? Date.parse(String(prev)) : (Number.isFinite(floor) ? floor : 0)
    if (!(updatedMs(item) > baseline)) continue
    if (cooldownMs > 0 && reported[key] !== undefined && now - Number(reported[key]) < cooldownMs) absorbed.push(item)
    else fresh.push(item)
  }
  return { fresh, absorbed }
}

export function advanceSeen(seen, items, { now = Date.now() } = {}) {
  const next = { ...(seen ?? {}) }
  for (const item of items ?? []) {
    const at = updatedMs(item)
    next[String(item.number)] = new Date(at || now).toISOString()
  }
  return next
}

export function pruneSeen(seen, { now = Date.now(), max = SEEN_MAX, maxAgeMs = SEEN_MAX_AGE_MS } = {}) {
  const rows = Object.entries(seen ?? {})
    .map(([key, at]) => [key, Date.parse(String(at))])
    .filter(([, at]) => Number.isFinite(at) && now - at <= maxAgeMs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
  return Object.fromEntries(rows.map(([key, at]) => [key, new Date(at).toISOString()]))
}

export function pruneWakeTimes(times, now = Date.now()) {
  return (Array.isArray(times) ? times : []).map(Number).filter((at) => Number.isFinite(at) && now - at < WAKE_WINDOW_MS)
}

export function pushFiltered(log, record, max = FILTER_LOG_MAX) {
  const next = [...(Array.isArray(log) ? log : []), record]
  return next.slice(-Math.max(1, max))
}

export function pushHistory(history, record, max = HISTORY_MAX) {
  const next = [...(Array.isArray(history) ? history : []), record]
  return next.slice(-Math.max(1, max))
}

export function priorityScore(item) {
  const labels = labelNames(item).length
  const assigned = (item?.assignees ?? []).length > 0 ? 3 : 0
  const kind = item?.pull_request === true ? 1 : 0
  return labels * 2 + assigned + kind
}

export function batchFresh(fresh, limit = REPO_WATCH_DEFAULTS.batchLimit) {
  return [...(fresh ?? [])]
    .sort((a, b) => priorityScore(b) - priorityScore(a) || updatedMs(b) - updatedMs(a))
    .slice(0, Math.max(1, Math.min(BATCH_MAX, Number(limit) || REPO_WATCH_DEFAULTS.batchLimit)))
}

/** 失败退避：30s → 1m → 2m → 5m → 10m → 30m 封顶（下一轮仍受 interval 约束）。 */
export function failureDelayMs(failures, baseMs) {
  const steps = [30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000]
  return Math.max(baseMs, steps[Math.min(Math.max(0, failures - 1), steps.length - 1)])
}

export function normalizeStartRequest(request = {}, { now = Date.now() } = {}) {
  const repo = normalizeRepo(request.repo)
  const intervalSec = Math.round(Number(request.intervalSec ?? REPO_WATCH_DEFAULTS.intervalSec))
  if (!Number.isFinite(intervalSec) || intervalSec < INTERVAL_MIN || intervalSec > INTERVAL_MAX) {
    throw new RelayError(`轮询间隔要在 ${INTERVAL_MIN}–${INTERVAL_MAX} 秒`, 'bad_interval')
  }
  const batchLimit = Math.round(Number(request.batchLimit ?? REPO_WATCH_DEFAULTS.batchLimit))
  if (!Number.isFinite(batchLimit) || batchLimit < 1 || batchLimit > BATCH_MAX) throw new RelayError(`单次唤醒条数 1–${BATCH_MAX}`, 'bad_batch')
  const maxWakesPerHour = Math.round(Number(request.maxWakesPerHour ?? REPO_WATCH_DEFAULTS.maxWakesPerHour))
  if (!Number.isFinite(maxWakesPerHour) || maxWakesPerHour < 1 || maxWakesPerHour > WAKES_MAX) {
    throw new RelayError(`每小时唤醒上限 1–${WAKES_MAX}`, 'bad_wakes')
  }
  const ackLabel = String(request.ackLabel ?? REPO_WATCH_DEFAULTS.ackLabel).trim() || DEFAULT_ACK_LABEL
  if (!LABEL_RE.test(ackLabel)) throw new RelayError(`ack 标签只能用字母数字和 . _ : -（≤50）`, 'bad_label')
  const goal = typeof request.goal === 'string' ? request.goal.trim().slice(0, 500) : ''
  const filters = normalizeFilters(request.filters ?? request)
  const activeHours = normalizeActiveHours(request.activeHours)
  return {
    repo,
    intervalSec,
    batchLimit,
    maxWakesPerHour,
    ackLabel,
    activeHours,
    goal,
    filters,
    observe: request.observe === true,
    enabled: request.enabled !== false,
    cursor: new Date(now).toISOString(),
    nextAt: now + intervalSec * 1000
  }
}

export function describeRepoWatch(watch) {
  const state = watch.enabled === false ? '已暂停' : watch.observe ? '观察中' : '守候中'
  const filters = []
  if (watch.filters?.labels?.length) filters.push(`标签 ${watch.filters.labels.join(',')}`)
  if (watch.filters?.allowAuthors?.length) filters.push(`作者 ${watch.filters.allowAuthors.join(',')}`)
  if (watch.filters?.onlyAssigned) filters.push('仅指派')
  if (watch.activeHours) filters.push(`时段 ${watch.activeHours}`)
  return `${watch.repo} · ${state} · ${watch.intervalSec}s${filters.length ? ' · ' + filters.join(' · ') : ''}`
}

export function wakeText(watch, items, { label } = {}) {
  const lines = items.map((item) => {
    const kind = item.pull_request === true ? 'PR' : 'issue'
    const labels = labelNames(item).slice(0, 4)
    return `- #${item.number} [${kind}] ${item.title}${labels.length ? `（${labels.join(', ')}）` : ''}${item.html_url ? ` ${item.html_url}` : ''}`
  })
  return [
    `【仓库守候】${watch.repo} 有 ${items.length} 条新动态${label ? `（${label}）` : ''}`,
    ...lines,
    watch.goal ? `目标：${watch.goal}` : null,
    '处理完请说明改了什么；本机回执用 peer_repo_watch action=ack。',
    `要让 GitHub 也留痕（打 ${watch.ackLabel} 标签），由用户在侧栏「仓库守候」卡片点「在 GitHub 打 ack 标签」。`
  ].filter(Boolean).join('\n')
}

// ---------------------------------------------------------------- gh 只读轮询 / ack 标签

export function runGh(args, { timeout = 25_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout, maxBuffer: 4 * 1024 * 1024, env: ghEnv(process.env) }, (error, stdout, stderr) => {
      if (error) { error.stderr = String(stderr ?? ''); error.stdout = String(stdout ?? ''); reject(error) } else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

export function normalizeIssueItem(raw) {
  if (!raw || !Number.isFinite(Number(raw.number))) return undefined
  return {
    number: Number(raw.number),
    title: String(raw.title ?? '').slice(0, 200),
    state: String(raw.state ?? ''),
    updated_at: String(raw.updated_at ?? ''),
    html_url: typeof raw.html_url === 'string' ? raw.html_url : null,
    labels: labelNames(raw),
    user: raw.user && typeof raw.user === 'object' ? { login: raw.user.login ?? null, type: raw.user.type ?? null } : null,
    assignees: Array.isArray(raw.assignees) ? raw.assignees.map((entry) => ({ login: entry?.login ?? null })) : [],
    draft: raw.draft === true || raw.pull_request?.draft === true,
    pull_request: raw.pull_request !== undefined && raw.pull_request !== null
  }
}

/** 只读列出仓库最近更新的 issue/PR；gh 失败抛错，由 runner 记 lastError + 退避。 */
export async function listRepoItems(repo, { gh = runGh, perPage = 50 } = {}) {
  const { stdout } = await gh(['api', `repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=${perPage}`, '-H', 'Accept: application/vnd.github+json'])
  const parsed = JSON.parse(stdout)
  return (Array.isArray(parsed) ? parsed : []).map(normalizeIssueItem).filter(Boolean)
}

/** 用户动作：给 issue/PR 打 ack 标签；标签不存在时先建。 */
export async function addAckLabel(repo, number, label, { gh = runGh } = {}) {
  const post = ['api', `repos/${repo}/issues/${number}/labels`, '-X', 'POST', '-H', 'Accept: application/vnd.github+json', '-f', `labels[]=${label}`]
  try {
    await gh(post)
  } catch (error) {
    const text = `${error?.stderr ?? ''} ${error?.message ?? ''}`
    if (!/404|Not Found|label/i.test(text)) throw error
    await gh(['api', `repos/${repo}/labels`, '-X', 'POST', '-f', `name=${label}`, '-f', `color=${ACK_COLOR}`, '-f', 'description=relay repo watch ack'])
    await gh(post)
  }
}

// ---------------------------------------------------------------- 盘上状态

export class RepoWatchStore {
  constructor(path, { now = Date.now } = {}) {
    this.path = path
    this.now = now
    this.state = { version: REPO_WATCH_VERSION, watchers: {} }
    this.loaded = false
  }

  async load() {
    let parsed
    try { parsed = JSON.parse(await readFile(this.path, 'utf8')) } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const watchers = parsed?.watchers && typeof parsed.watchers === 'object' ? parsed.watchers : {}
    this.state = { version: REPO_WATCH_VERSION, watchers: { ...watchers } }
    this.loaded = true
    return this.state
  }

  save() {
    return writeJsonAtomic(this.path, this.state)
  }

  list() { return Object.values(this.state.watchers) }

  get(id) { return this.state.watchers[id] }

  async put(record) {
    this.state.watchers[record.id] = record
    await this.save()
    return record
  }

  async remove(id) {
    const found = this.state.watchers[id]
    if (found === undefined) return undefined
    delete this.state.watchers[id]
    await this.save()
    return found
  }
}

// ---------------------------------------------------------------- 轮询 / 唤醒

export class RepoWatchRunner {
  constructor({ store, poll, sessionState, deliver, writeAckLabel, notify, label = (value) => value, logger, now = Date.now, config = {} }) {
    this.store = store
    this.poll = poll
    this.sessionState = sessionState
    this.deliver = deliver
    this.writeAckLabel = writeAckLabel
    this.notify = notify
    this.label = label
    this.logger = logger
    this.now = now
    this.config = { ...REPO_WATCH_DEFAULTS, ...config }
    this.ticking = false
    this.disposed = false
  }

  get(id) { return this.store.get(id) }

  list({ groupKey } = {}) {
    const rows = this.store.list()
    return groupKey === undefined ? rows : rows.filter((watch) => watch.groupKey === groupKey)
  }

  async save() { await this.store.save().catch((error) => this.logger?.warn?.(`session-relay: repo watch save failed: ${error?.message ?? error}`)) }

  async start(request, { sessionId, groupKey, createdBy } = {}) {
    if (typeof sessionId !== 'string' || sessionId === '') throw new RelayError('守候必须绑定当前会话', 'no_session')
    const clean = normalizeStartRequest(request, { now: this.now() })
    const id = `${clean.repo}#${sessionId}`
    const existing = this.store.get(id)
    const now = this.now()
    const watch = existing === undefined ? {
      id, repo: clean.repo, provider: 'github', sessionId, groupKey: typeof groupKey === 'string' ? groupKey : '',
      enabled: clean.enabled, observe: clean.observe, intervalSec: clean.intervalSec, filters: clean.filters,
      batchLimit: clean.batchLimit, maxWakesPerHour: clean.maxWakesPerHour, activeHours: clean.activeHours,
      ackLabel: clean.ackLabel, goal: clean.goal, cursor: clean.cursor, nextAt: clean.nextAt,
      seen: {}, lastReported: {}, wakeTimes: [], filteredLog: [], history: [],
      lastPoll: null, lastWake: null, lastError: null, lastErrorKind: null, consecutiveFailures: 0,
      lastDeferred: null, lastBatch: null, createdAt: now, updatedAt: now, createdBy
    } : {
      ...existing, enabled: clean.enabled, observe: clean.observe, intervalSec: clean.intervalSec, filters: clean.filters,
      batchLimit: clean.batchLimit, maxWakesPerHour: clean.maxWakesPerHour, activeHours: clean.activeHours,
      ackLabel: clean.ackLabel, goal: clean.goal, nextAt: Math.min(existing.nextAt ?? now, clean.nextAt), updatedAt: now
    }
    await this.store.put(watch)
    return watch
  }

  async update(id, patch = {}) {
    const watch = this.store.get(id)
    if (watch === undefined) throw new RelayError(`没有这条守候：${id}`, 'not_found')
    const clean = normalizeStartRequest({ ...watch, ...patch, repo: watch.repo }, { now: this.now() })
    Object.assign(watch, {
      enabled: clean.enabled, observe: clean.observe, intervalSec: clean.intervalSec, filters: clean.filters,
      batchLimit: clean.batchLimit, maxWakesPerHour: clean.maxWakesPerHour, activeHours: clean.activeHours,
      ackLabel: clean.ackLabel, goal: clean.goal, updatedAt: this.now()
    })
    await this.store.put(watch)
    return watch
  }

  async setEnabled(id, enabled) {
    const watch = this.store.get(id)
    if (watch === undefined) throw new RelayError(`没有这条守候：${id}`, 'not_found')
    watch.enabled = enabled === true
    watch.updatedAt = this.now()
    await this.store.put(watch)
    return watch
  }

  async stop(id) {
    return this.store.remove(id)
  }

  async ack(id, numbers, { by, writeGitHub = false } = {}) {
    const watch = this.store.get(id)
    if (watch === undefined) throw new RelayError(`没有这条守候：${id}`, 'not_found')
    const clean = (Array.isArray(numbers) ? numbers : [numbers]).map(Number).filter((number) => Number.isFinite(number) && number > 0)
    if (clean.length === 0) throw new RelayError('要 ack 的编号为空', 'bad_ack')
    const now = this.now()
    const seen = { ...(watch.seen ?? {}) }
    const lastReported = { ...(watch.lastReported ?? {}) }
    for (const number of clean) {
      seen[String(number)] = new Date(now).toISOString()
      lastReported[String(number)] = now
    }
    watch.seen = pruneSeen(seen, { now })
    watch.lastReported = lastReported
    watch.lastAcked = { at: now, numbers: clean, by: by ?? null, github: false }
    watch.updatedAt = now
    let githubError
    if (writeGitHub === true && typeof this.writeAckLabel === 'function') {
      try {
        for (const number of clean) await this.writeAckLabel(watch.repo, number, watch.ackLabel)
        watch.lastAcked.github = true
      } catch (error) {
        githubError = error?.message ?? String(error)
        watch.lastError = githubError
        watch.lastErrorKind = 'ack'
      }
    }
    await this.store.put(watch)
    return { watch, numbers: clean, github: watch.lastAcked.github, ...(githubError === undefined ? {} : { error: githubError }) }
  }

  /** 立即检查一条守候（不推进 nextAt 以外的东西；用户/模型都可触发）。 */
  async check(id) {
    const watch = this.store.get(id)
    if (watch === undefined) throw new RelayError(`没有这条守候：${id}`, 'not_found')
    await this.pollOne(watch, { force: true })
    return watch
  }

  async tick() {
    if (this.ticking || this.disposed) return
    this.ticking = true
    try {
      const now = this.now()
      for (const watch of this.store.list()) {
        if (this.disposed) break
        if (watch.enabled !== true) continue
        if ((watch.nextAt ?? 0) > now) continue
        await this.pollOne(watch).catch((error) => {
          watch.lastError = error?.message ?? String(error)
          watch.lastErrorKind = 'unexpected'
          watch.nextAt = now + failureDelayMs((watch.consecutiveFailures ?? 0) + 1, watch.intervalSec * 1000)
          this.logger?.warn?.(`session-relay: repo watch ${watch.id} failed: ${error?.message ?? error}`)
        })
      }
    } finally {
      this.ticking = false
    }
  }

  async pollOne(watch, { force = false } = {}) {
    const now = this.now()
    const intervalMs = Math.max(INTERVAL_MIN, watch.intervalSec ?? REPO_WATCH_DEFAULTS.intervalSec) * 1000
    watch.lastPoll = now
    // ① 活跃时段（拉 API 前）
    if (!inActiveHours(watch.activeHours, new Date(now))) {
      watch.lastDeferred = { at: now, reason: 'activeHours' }
      watch.nextAt = now + intervalMs
      await this.save()
      return
    }
    // ② 会话还在不在 / 是否空闲；忙时只排队，不拉 API，也不推进水位
    let state
    try { state = await this.sessionState(watch.sessionId) } catch { state = { exists: false } }
    if (state?.exists === false) {
      watch.lastError = '绑定会话已不存在'; watch.lastErrorKind = 'session'
      watch.lastDeferred = { at: now, reason: 'session' }
      watch.nextAt = now + intervalMs
      await this.save()
      return
    }
    if (state?.running === true) {
      watch.lastDeferred = { at: now, reason: 'busy' }
      watch.nextAt = now + intervalMs
      await this.save()
      return
    }
    // ③ 拉取（只读）
    let items
    try {
      items = await this.poll(watch)
      if (!Array.isArray(items)) items = []
    } catch (error) {
      watch.consecutiveFailures = (watch.consecutiveFailures ?? 0) + 1
      watch.lastError = String(error?.stderr ?? error?.message ?? error).trim().split('\n')[0].slice(0, 240) || '轮询失败'
      watch.lastErrorKind = 'poll'
      watch.history = pushHistory(watch.history ?? [], { at: now, ok: false, reason: 'poll', error: watch.lastError })
      watch.nextAt = now + failureDelayMs(watch.consecutiveFailures, intervalMs)
      await this.save()
      return
    }
    watch.consecutiveFailures = 0
    watch.lastError = null
    watch.lastErrorKind = null
    // ④ 过滤 + 水位
    const candidates = []
    const absorbed = []
    for (const item of items) {
      if (hasAckLabel(item, watch.ackLabel)) { absorbed.push(item); continue }
      const reason = filterReason(item, watch.filters)
      if (reason !== null) {
        watch.filteredLog = pushFiltered(watch.filteredLog ?? [], { at: now, number: item.number, title: item.title, reason })
        continue
      }
      candidates.push(item)
    }
    const split = partitionItems(candidates, watch, { now, cooldownMs: this.config.cooldownMs })
    const fresh = split.fresh
    absorbed.push(...split.absorbed)
    if (absorbed.length > 0) {
      watch.seen = pruneSeen(advanceSeen(watch.seen, absorbed, { now }), { now })
      watch.lastAbsorbed = { at: now, numbers: absorbed.map((item) => item.number).slice(0, 20) }
    }
    watch.lastPoll = now
    if (fresh.length === 0) {
      watch.lastDeferred = null
      watch.nextAt = now + intervalMs
      await this.save()
      return
    }
    // ⑤ 观察模式：只记会唤醒哪几条，推进水位，不发消息
    if (watch.observe === true) {
      watch.seen = pruneSeen(advanceSeen(watch.seen, fresh, { now }), { now })
      watch.history = pushHistory(watch.history ?? [], { at: now, ok: true, reason: 'observe', numbers: fresh.map((item) => item.number).slice(0, BATCH_MAX) })
      watch.nextAt = now + intervalMs
      await this.save()
      return
    }
    // ⑥ 每小时上限
    watch.wakeTimes = pruneWakeTimes(watch.wakeTimes ?? [], now)
    if (watch.wakeTimes.length >= (watch.maxWakesPerHour ?? REPO_WATCH_DEFAULTS.maxWakesPerHour)) {
      watch.lastDeferred = { at: now, reason: 'rate', numbers: fresh.map((item) => item.number).slice(0, BATCH_MAX) }
      watch.nextAt = now + intervalMs
      await this.save()
      return
    }
    // ⑦ 批量唤醒
    const batch = batchFresh(fresh, watch.batchLimit)
    const text = wakeText(watch, batch, { label: this.label(watch.sessionId) })
    try {
      await this.deliver(watch.sessionId, text)
    } catch (error) {
      watch.lastError = String(error?.message ?? error).slice(0, 240) || '唤醒失败'
      watch.lastErrorKind = 'deliver'
      watch.history = pushHistory(watch.history ?? [], { at: now, ok: false, reason: 'deliver', numbers: batch.map((item) => item.number) })
      watch.nextAt = now + failureDelayMs((watch.consecutiveFailures ?? 0) + 1, intervalMs)
      await this.save()
      return
    }
    watch.seen = pruneSeen(advanceSeen(watch.seen, batch, { now }), { now })
    const reported = { ...(watch.lastReported ?? {}) }
    for (const item of batch) reported[String(item.number)] = now
    watch.lastReported = reported
    watch.wakeTimes = [...watch.wakeTimes, now]
    watch.lastWake = now
    watch.lastBatch = { at: now, items: batch.map((item) => ({ number: item.number, title: item.title, url: item.html_url, kind: item.pull_request === true ? 'pr' : 'issue' })) }
    watch.history = pushHistory(watch.history ?? [], { at: now, ok: true, reason: 'wake', numbers: batch.map((item) => item.number) })
    watch.lastDeferred = null
    watch.nextAt = now + intervalMs
    watch.updatedAt = now
    await this.save()
    if (typeof this.notify === 'function') void Promise.resolve(this.notify('仓库守候已唤醒会话', `${watch.repo}：${batch.map((item) => '#' + item.number).join(' ')}`)).catch(() => {})
  }

  view({ groupKey } = {}) {
    const now = this.now()
    const rows = this.list({ groupKey }).map((watch) => ({
      id: watch.id, repo: watch.repo, provider: watch.provider ?? 'github', sessionId: watch.sessionId,
      sessionLabel: this.label(watch.sessionId), enabled: watch.enabled !== false, observe: watch.observe === true,
      intervalSec: watch.intervalSec, filters: watch.filters, batchLimit: watch.batchLimit, maxWakesPerHour: watch.maxWakesPerHour,
      activeHours: watch.activeHours ?? null, ackLabel: watch.ackLabel, goal: watch.goal ?? '',
      lastPoll: watch.lastPoll ?? null, lastWake: watch.lastWake ?? null,
      lastError: watch.lastError ?? null, lastErrorKind: watch.lastErrorKind ?? null,
      nextAt: watch.nextAt ?? null, consecutiveFailures: watch.consecutiveFailures ?? 0,
      deferReason: watch.lastDeferred?.reason ?? null, lastDeferred: watch.lastDeferred ?? null,
      lastBatch: watch.lastBatch ?? null,
      filteredLog: (watch.filteredLog ?? []).slice(-4),
      history: (watch.history ?? []).slice(-5),
      wakeCountLastHour: pruneWakeTimes(watch.wakeTimes ?? [], now).length,
      updatedAt: watch.updatedAt ?? null
    })).sort((a, b) => String(a.repo).localeCompare(String(b.repo)))
    return { watches: rows, total: rows.length, active: rows.filter((watch) => watch.enabled).length, errors: rows.filter((watch) => watch.lastError !== null).length }
  }
}
