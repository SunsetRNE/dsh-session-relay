/**
 * 通知邮箱（1.4.0 MVP）：公共通知的全文落在这里，会话只收短通知，需要细节时用 peer_mail 读。
 *
 * - 存储：插件数据目录的 mailbox.json（与 watches.json 同级），按 workspace group 过滤。
 * - 可见性：scope=workspace 全工作区可见；scope=session 只给 targets；scope=role=main 只给主会话。
 * - 去重：eventKey 相同只保留一条；readBy 按会话记。
 * - 截止提醒：主会话推送时写 deadlineAt；到点仍未读且未 force 的，由 impl 的 tick 提醒主会话。
 * - 保留：每工作区 maxItems / ttlMs，过期或超额先追加到 mailbox.json.archive.jsonl，再移出活动列表。
 *
 * 这个文件只做数据；通知投递、工具、HTTP 路由在 impl.js / settings-route.js。
 */
import { appendFile, readFile, rename } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { RelayError, clip, formatTime, writeJsonAtomic } from './core.js'

export const MAIL_DEFAULTS = Object.freeze({
  maxItems: 500,
  ttlMs: 30 * 24 * 3600_000,
  maxBody: 8192,
  maxSubject: 120,
  maxNotice: 320,
  defaultDeadlineMinutes: 5,
  maxDeadlineMinutes: 60,
  tickMs: 30_000
})

const KINDS = new Set(['watch', 'build', 'version', 'board', 'system', 'notice'])
const SEVERITIES = new Set(['info', 'warn', 'error'])
const STATES = new Set(['read', 'unread', 'archived'])

function mailId(now) {
  return `m_${now.toString(36)}${randomBytes(3).toString('hex')}`
}

function cleanItem(raw) {
  if (raw === null || typeof raw !== 'object') return undefined
  if (typeof raw.id !== 'string' || typeof raw.subject !== 'string' || typeof raw.group !== 'string') return undefined
  if (!Number.isFinite(Number(raw.at))) return undefined
  return {
    ...raw,
    kind: KINDS.has(raw.kind) ? raw.kind : 'system',
    severity: SEVERITIES.has(raw.severity) ? raw.severity : 'info',
    targets: Array.isArray(raw.targets) ? raw.targets.filter((id) => typeof id === 'string') : [],
    readBy: raw.readBy !== null && typeof raw.readBy === 'object' ? { ...raw.readBy } : {},
    refs: Array.isArray(raw.refs) ? raw.refs.filter((ref) => ref !== null && typeof ref === 'object') : []
  }
}

export class MailboxStore {
  constructor(path, { now = Date.now, maxItems = MAIL_DEFAULTS.maxItems, ttlMs = MAIL_DEFAULTS.ttlMs } = {}) {
    this.path = path
    this.archivePath = `${path}.archive.jsonl`
    this.now = now
    this.maxItems = maxItems
    this.ttlMs = ttlMs
    this.state = { items: [] }
    this.loaded = false
    this.chain = Promise.resolve()
  }

  async load() {
    let parsed
    try { parsed = JSON.parse(await readFile(this.path, 'utf8')) } catch (error) {
      if (error instanceof SyntaxError) {
        this.corruptPath = `${this.path}.corrupt-${this.now()}`
        await rename(this.path, this.corruptPath).catch(() => { this.corruptPath = undefined })
      } else if (error?.code !== 'ENOENT') throw error
    }
    const items = Array.isArray(parsed?.items) ? parsed.items.map(cleanItem).filter(Boolean) : []
    this.state = { items }
    this.loaded = true
    return this.state
  }

  items() {
    return this.state.items
  }

  mutate(fn) {
    const runIt = this.chain.then(async () => {
      if (!this.loaded) await this.load()
      const next = { items: this.state.items.map((item) => ({
        ...item,
        targets: [...(item.targets ?? [])],
        readBy: { ...(item.readBy ?? {}) },
        refs: [...(item.refs ?? [])]
      })) }
      const result = fn(next)
      const removed = this.prune(next)
      await writeJsonAtomic(this.path, { version: 1, items: next.items })
      this.state = next
      if (removed.length > 0) {
        await appendFile(this.archivePath, removed.map((item) => JSON.stringify(item)).join('\n') + '\n').catch(() => {})
      }
      return result
    })
    this.chain = runIt.catch(() => {})
    return runIt
  }

  /** 过期/超额先记到 archive，再从活动列表移除；不直接删。 */
  prune(next) {
    const now = this.now()
    const removed = []
    next.items = next.items.filter((item) => {
      const expired = item.archivedAt !== undefined && item.archivedAt !== null
        ? true
        : now - Number(item.at ?? now) > this.ttlMs
      if (expired) { removed.push(item); return false }
      return true
    })
    while (next.items.length > this.maxItems) {
      const index = next.items.findIndex((item) => Object.keys(item.readBy ?? {}).length > 0 || item.archivedAt)
      const at = index >= 0 ? index : 0
      removed.push(next.items.splice(at, 1)[0])
    }
    return removed
  }

  visible(item, { group, sessionId, isMain = false, includeArchived = false } = {}) {
    if (item.group !== group) return false
    if (!includeArchived && item.archivedAt !== undefined && item.archivedAt !== null) return false
    // 主会话能读本工作区全部消息（含 scope=session 的），否则发给单个会话的消息
    // 主会话既读不到、也 force/mark 不了。
    if (isMain) return true
    const scope = item.scope ?? { type: 'workspace' }
    if (scope.type === 'workspace') return true
    if (scope.type === 'targets') return (item.targets ?? []).includes(sessionId)
    if (scope.type === 'role') return scope.id === 'main' ? isMain : !isMain
    if (scope.type === 'session') return scope.id === sessionId || (item.targets ?? []).includes(sessionId)
    return true
  }

  list({ group, sessionId, isMain = false, unread = false, kind, limit = 20, includeArchived = false } = {}) {
    const items = this.state.items
      .filter((item) => this.visible(item, { group, sessionId, isMain, includeArchived }))
      .filter((item) => kind === undefined || item.kind === kind)
      .filter((item) => !unread || !item.readBy?.[sessionId])
      .sort((a, b) => Number(b.at) - Number(a.at))
    return items.slice(0, Math.max(1, Math.min(100, Number(limit) || 20)))
  }

  unreadCount({ group, sessionId, isMain = false } = {}) {
    return this.list({ group, sessionId, isMain, unread: true, limit: 100 }).length
  }

  summary({ group, sessionId, isMain = false } = {}) {
    const unread = this.unreadCount({ group, sessionId, isMain })
    const latest = this.list({ group, sessionId, isMain, limit: 1 })[0]
    return { unread, latestSubject: latest?.subject ?? null, latestAt: latest?.at ?? null }
  }

  get(id, opts) {
    const item = this.state.items.find((entry) => entry.id === id)
    if (item === undefined || !this.visible(item, opts)) return undefined
    return item
  }

  async add(item) {
    return this.mutate((next) => {
      const existing = item.eventKey ? next.items.find((entry) => entry.eventKey === item.eventKey) : undefined
      if (existing !== undefined) return { item: existing, duplicate: true }
      const entry = { ...item, id: item.id ?? mailId(this.now()) }
      next.items.push(entry)
      return { item: entry, duplicate: false }
    })
  }

  async markRead(ids, sessionId) {
    return this.mutate((next) => {
      const at = this.now()
      const marked = []
      for (const id of ids ?? []) {
        const item = next.items.find((entry) => entry.id === id)
        if (item === undefined) continue
        item.readBy = { ...(item.readBy ?? {}), [sessionId]: at }
        marked.push(item.id)
      }
      return marked
    })
  }

  async mark(ids, { sessionId, isMain = false, state }) {
    if (!STATES.has(state)) throw new RelayError('邮箱标记只能是 read / unread / archived', 'invalid_mail_state')
    return this.mutate((next) => {
      const at = this.now()
      const marked = []
      for (const id of ids ?? []) {
        const item = next.items.find((entry) => entry.id === id)
        if (item === undefined) continue
        if (state === 'read') item.readBy = { ...(item.readBy ?? {}), [sessionId]: at }
        else if (state === 'unread') { const readBy = { ...(item.readBy ?? {}) }; delete readBy[sessionId]; item.readBy = readBy }
        else {
          if (!isMain) throw new RelayError('只有主会话能归档邮箱消息', 'not_coordinator')
          item.archivedAt = at
        }
        marked.push(item.id)
      }
      return marked
    })
  }

  due(now = this.now()) {
    return this.state.items.filter((item) => {
      if (item.deadlineAt === undefined || item.deadlineAt === null) return false
      if (Number(item.deadlineAt) > now) return false
      if (item.remindedAt !== undefined && item.remindedAt !== null) return false
      if (item.forcedAt !== undefined && item.forcedAt !== null) return false
      if (item.archivedAt !== undefined && item.archivedAt !== null) return false
      const targets = item.targets ?? []
      return targets.length > 0 && targets.some((id) => !item.readBy?.[id])
    })
  }

  async remind(ids) {
    const at = this.now()
    return this.mutate((next) => {
      for (const item of next.items) if ((ids ?? []).includes(item.id)) item.remindedAt = at
    })
  }

  async force(ids, by) {
    const at = this.now()
    return this.mutate((next) => {
      const forced = []
      for (const item of next.items) {
        if (!(ids ?? []).includes(item.id)) continue
        if (item.forcedAt !== undefined && item.forcedAt !== null) continue
        const targets = (item.targets ?? []).filter((id) => !item.readBy?.[id])
        item.forcedAt = at
        item.forcedBy = by ?? null
        item.forcedTo = targets
        forced.push({ item, targets })
      }
      return forced
    })
  }
}

/** 邮箱列表一行（工具/文本用；不带 body）。 */
export function mailLine(item, { unread = false } = {}) {
  const at = formatTime(item.at)
  const mark = unread ? '●' : '○'
  return `${mark} ${item.id} · ${item.subject} · ${at}${item.severity === 'error' ? ' · 需要处理' : item.severity === 'warn' ? ' · 注意' : ''}`
}

/** 正文裁剪：读工具一次别把所有大消息都塞回上下文。 */
export function clipMailBody(body, max = MAIL_DEFAULTS.maxBody) {
  const text = String(body ?? '')
  return text.length > max ? `${text.slice(0, max)}\n…（已截断，共 ${text.length} 字）` : text
}

export { clip, KINDS, SEVERITIES, STATES }
