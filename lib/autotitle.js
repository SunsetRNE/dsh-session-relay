/**
 * 认领任务自动命名（用户 2026-11-04 定）：会话认领了看板任务，就把侧栏标题改成任务号，
 * 比如「T45」「T46 T47」，看板和侧栏一眼能对上。
 *
 * 规则：
 * - 只看 .agents/claims/<号>/owner 里的现任持有者，且还没写 done / abandoned 的认领。
 * - 用户手动改过标题（DSH 标题来源是 user、且不是插件上次写的）就不再动它；自动生成的标题直接覆盖。
 * - 认领全部结束后不改回去（保留最后一次的任务号，方便事后定位）。
 * - 只改加载着的会话（DSH 的 rename 只接受活会话）；没加载的下一轮再试。
 * applied 存在 titles.json：{ version: 1, applied: { 会话 id: 插件写过的标题 } }。
 */
import { readFile } from 'node:fs/promises'
import { writeJsonAtomic } from './core.js'

const MAX_IDS = 6

/** 任务号自然排序后拼成标题：T9 T10 T45；超过 6 个写「… 等 N 个」。 */
export function claimTitle(taskIds) {
  const ids = [...new Set(taskIds.map((id) => String(id).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }))
  if (ids.length === 0) return undefined
  if (ids.length <= MAX_IDS) return ids.join(' ')
  return `${ids.slice(0, MAX_IDS).join(' ')} 等 ${ids.length} 个`
}

/**
 * 这一轮要改哪些（纯函数）。
 * @param input.wanted - Map<会话 id, 标题>
 * @param input.current - (会话 id) => { title, source } 或 undefined（source 是 DSH 标题来源：user / fallback / provider）
 * @param input.applied - { 会话 id: 插件上次写的标题 }
 * 用户手动改过的标题（来源是 user、且不是插件上次写的那个）不动；自动生成的标题可以覆盖。
 * @returns {{ rename: Array<[id, title]>, skipped: Array<[id, reason]> }}
 */
export function planTitles({ wanted, current, applied }) {
  const rename = []
  const skipped = []
  for (const [id, title] of wanted) {
    const now = current(id)
    if (now?.title === title) continue
    if (now?.source === 'user' && now.title !== applied[id]) { skipped.push([id, 'user-renamed']); continue }
    rename.push([id, title])
  }
  return { rename, skipped }
}

export class TitleStore {
  constructor(path) {
    this.path = path
    this.state = { applied: {} }
    this.loaded = false
    this.chain = Promise.resolve()
  }

  async load() {
    let parsed
    try { parsed = JSON.parse(await readFile(this.path, 'utf8')) } catch (error) { if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
    const ok = parsed?.version === 1
    this.state = {
      applied: ok && parsed.applied && typeof parsed.applied === 'object' ? Object.fromEntries(Object.entries(parsed.applied).filter(([, value]) => typeof value === 'string')) : {}
    }
    this.loaded = true
    return this.snapshot()
  }

  snapshot() {
    return { applied: { ...this.state.applied } }
  }

  mutate(fn) {
    const run = this.chain.then(async () => {
      if (!this.loaded) await this.load()
      const next = this.snapshot()
      const result = fn(next)
      await writeJsonAtomic(this.path, { version: 1, ...next })
      this.state = next
      return result
    })
    this.chain = run.catch(() => {})
    return run
  }
}

/**
 * 轮询执行器。relay 注入：
 * - targets(): Promise<Map<会话 id, 任务号[]>>（各工作区看板里现任持有者的未结束认领）
 * - titles(): sessionTitle 服务（get / rename），没有时整个功能不可用
 * - session(id): 活会话或 undefined
 */
export class AutoTitle {
  constructor({ store, targets, titles, session, intervalMs = 60_000, logger, setTimer = setInterval, clearTimer = clearInterval } = {}) {
    this.store = store
    this.targets = targets
    this.titles = titles
    this.session = session
    this.logger = logger
    this.clearTimer = clearTimer
    this.running = undefined
    this.lastRun = undefined
    if (intervalMs > 0) {
      this.timer = setTimer(() => { void this.sync().catch(() => {}) }, intervalMs)
      this.timer?.unref?.()
    }
  }

  available() {
    const service = this.titles()
    return typeof service?.rename === 'function' && typeof service?.get === 'function'
  }

  sync() {
    if (this.running !== undefined) return this.running
    this.running = this.run().finally(() => { this.running = undefined })
    return this.running
  }

  currentTitle(id) {
    const session = this.session(id)
    if (session === undefined) return undefined
    try {
      const snapshot = this.titles()?.get(session)
      return typeof snapshot?.title === 'string' ? { title: snapshot.title, source: snapshot.source?.kind } : undefined
    } catch { return undefined }
  }

  async run() {
    if (this.disposed) return { renamed: [], skipped: [] }
    if (!this.store.loaded) await this.store.load()
    if (!this.available()) return { renamed: [], skipped: [] }
    const claims = await this.targets()
    const wanted = new Map()
    for (const [id, tasks] of claims) {
      if (this.session(id) === undefined) continue
      const title = claimTitle(tasks)
      if (title !== undefined) wanted.set(id, title)
    }
    const plan = planTitles({ wanted, current: (id) => this.currentTitle(id), applied: this.store.snapshot().applied })
    const renamed = []
    for (const [id, title] of plan.rename) {
      if (this.disposed) break
      const session = this.session(id)
      if (session === undefined) continue
      try {
        const done = this.titles().rename(session, title)
        renamed.push([id, done?.title ?? title])
      } catch (error) {
        this.logger?.warn?.(`session-relay: auto-title ${id} failed: ${error?.message ?? error}`)
      }
    }
    if (renamed.length > 0) await this.store.mutate((next) => { for (const [id, title] of renamed) next.applied[id] = title })
    this.lastRun = { at: Date.now(), renamed, skipped: plan.skipped }
    return this.lastRun
  }

  dispose() {
    this.disposed = true
    if (this.timer !== undefined) this.clearTimer(this.timer)
    this.timer = undefined
  }
}
