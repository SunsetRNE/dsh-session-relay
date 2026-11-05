/**
 * 侧栏自动置顶（用户 2026-11-03 定：默认关闭，按工作区开启）。
 * 开启后：本工作区主会话 + 还在做的工作会话（看板 进行中 / 受阻 / 待答复 / 可合并，或持有未合入的活跃声明）自动置顶；
 * 做完（看板报完成 / 放弃且声明已交还）自动取消。
 * 只管插件自己置顶的会话（owned）：用户手动置顶的从不取消；唯一例外是主会话——开启后它总被挪到本工作区置顶的最上面，
 * 但手动置顶的主会话不记成插件的（关闭开关也不会取消它）；
 * 用户手动取消了插件置顶的会话，记进 declined，这一轮“还在做”期间不再置顶它（不和用户抢）。
 * 关闭开关：撤掉本工作区插件加的置顶，手动置顶的不动。
 * 置顶列表就是侧栏用的 workspaceRegistry.pinnedSessionIds（新置顶的排最前）。
 */
import { readFile } from 'node:fs/promises'
import { writeJsonAtomic } from './core.js'

export const ACTIVE_STATUSES = new Set(['working', 'blocked', 'question', 'ready'])

/** pins.json：{ version: 1, enabled: [工作区 id], owned: { 会话 id: 工作区 id }, declined: [会话 id] } */
export class PinStore {
  constructor(path) {
    this.path = path
    this.state = { enabled: [], owned: {}, declined: [] }
    this.loaded = false
    this.chain = Promise.resolve()
  }

  async load() {
    let parsed
    try { parsed = JSON.parse(await readFile(this.path, 'utf8')) } catch (error) { if (error?.code !== 'ENOENT') throw error }
    const ok = parsed?.version === 1
    const strings = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
    this.state = {
      enabled: ok ? strings(parsed.enabled) : [],
      owned: ok && parsed.owned && typeof parsed.owned === 'object' ? Object.fromEntries(Object.entries(parsed.owned).filter(([, key]) => typeof key === 'string')) : {},
      declined: ok ? strings(parsed.declined).slice(-200) : []
    }
    this.loaded = true
    return this.snapshot()
  }

  snapshot() {
    return { enabled: [...this.state.enabled], owned: { ...this.state.owned }, declined: [...this.state.declined] }
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
 * 算这一轮要做什么（纯函数）。
 * @param input.key - 工作区 id
 * @param input.wanted - 想置顶的会话（不含主会话）
 * @param input.main - 主会话 id（可无）
 * @param input.pinned - 当前置顶列表（新的在前）
 * @param input.owned - { 会话: 工作区 }（全部工作区）
 * @param input.declined - 用户取消过的
 * @returns {{ pin: string[], unpin: string[], own: string[], disown: string[], decline: string[], undecline: string[] }}
 */
export function planPins({ key, wanted, main, pinned, owned, declined }) {
  const pinnedSet = new Set(pinned)
  const declinedSet = new Set(declined)
  const mine = Object.entries(owned).filter(([, group]) => group === key).map(([id]) => id)
  const want = new Set([...(main === undefined ? [] : [main]), ...wanted])
  const plan = { pin: [], unpin: [], own: [], disown: [], decline: [], undecline: [] }
  for (const id of mine) {
    if (!pinnedSet.has(id)) {
      // 插件置顶过、现在不在置顶里：用户手动取消了；还想要的话记下不再抢
      plan.disown.push(id)
      if (want.has(id)) plan.decline.push(id)
    } else if (!want.has(id)) {
      plan.unpin.push(id)
      plan.disown.push(id)
    }
  }
  const declinedNow = new Set([...declinedSet, ...plan.decline])
  // 工作会话先置顶，主会话最后（置顶列表新的在前，主会话就在最上面）
  const order = [...wanted, ...(main === undefined ? [] : [main])]
  for (const id of order) {
    if (pinnedSet.has(id) || declinedNow.has(id) || plan.pin.includes(id)) continue
    plan.pin.push(id)
    plan.own.push(id)
  }
  // 不再“还在做”的，清掉 declined，下一轮重新开始时可以再置顶
  for (const id of declinedSet) if (!want.has(id)) plan.undecline.push(id)
  return plan
}

/**
 * 轮询执行器。relay 注入：registry（workspaceRegistry）、targets()（开启的工作区及想要的会话）。
 */
export class AutoPin {
  constructor({ store, registry, targets, intervalMs = 30_000, kickDelayMs = 500, logger, setTimer = setInterval, clearTimer = clearInterval, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
    this.kickDelayMs = kickDelayMs
    this.setTimeoutFn = setTimeoutFn
    this.clearTimeoutFn = clearTimeoutFn
    this.kickTimer = undefined
    this.kickAgain = false
    this.disposed = false
    this.store = store
    this.registry = registry
    this.targets = targets
    this.logger = logger
    this.running = undefined
    this.clearTimer = clearTimer
    this.lastRun = undefined
    if (intervalMs > 0) {
      this.timer = setTimer(() => { void this.sync().catch(() => {}) }, intervalMs)
      this.timer?.unref?.()
    }
  }

  available() {
    const registry = this.registry()
    return typeof registry?.pinSession === 'function' && typeof registry?.unpinSession === 'function' && Array.isArray(registry?.pinnedSessionIds)
  }

  /** 跑一轮（串行，重入时等上一轮）。返回各工作区的动作。 */
  sync() {
    if (this.running !== undefined) return this.running
    this.running = this.run().finally(() => { this.running = undefined })
    return this.running
  }

  async run() {
    if (!this.store.loaded) await this.store.load()
    if (!this.available()) return []
    const registry = this.registry()
    const results = []
    for (const target of await this.targets(this.store.snapshot().enabled)) {
      const state = this.store.snapshot()
      const plan = planPins({ key: target.key, wanted: target.wanted, main: target.main, pinned: [...registry.pinnedSessionIds], owned: state.owned, declined: state.declined })
      const pinned = []
      const failed = []
      for (const id of plan.unpin) await registry.unpinSession(id).catch((error) => failed.push([id, error?.message ?? String(error)]))
      for (const id of plan.pin) {
        try { await registry.pinSession(id); pinned.push(id) } catch (error) { failed.push([id, error?.message ?? String(error)]) }
      }
      // 主会话要在本工作区置顶的最上面（置顶列表新的在前）：不在就取消再置顶一次，挪到最前。
      // 手动置顶的主会话也挪，但不记成插件的，关闭开关时不会被取消。被用户取消过（declined）的不动。
      let raisedMain = false
      const members = new Set(target.members ?? [])
      const mainPinned = target.main !== undefined && registry.pinnedSessionIds.includes(target.main)
      const firstMember = registry.pinnedSessionIds.find((id) => members.has(id))
      if (mainPinned && firstMember !== undefined && firstMember !== target.main) {
        try { await registry.unpinSession(target.main); await registry.pinSession(target.main); raisedMain = true } catch (error) { failed.push([target.main, error?.message ?? String(error)]) }
      }
      await this.store.mutate((next) => {
        for (const id of plan.disown) delete next.owned[id]
        for (const id of pinned) next.owned[id] = target.key
        next.declined = [...new Set([...next.declined.filter((id) => !plan.undecline.includes(id)), ...plan.decline])].slice(-200)
      })
      for (const [id, message] of failed) this.logger?.warn?.(`session-relay: auto-pin ${id} failed: ${message}`)
      results.push({ key: target.key, pinned, unpinned: plan.unpin, declined: plan.decline, raisedMain, failed })
    }
    this.lastRun = { at: Date.now(), results }
    return results
  }

  /**
   * 看板 / 主会话变了就尽快跑一轮（不用等 30 秒轮询）。短时间内多次变化合并成一轮；
   * 正在跑时记下来，跑完再补一轮，保证用的是最新看板。没有开启自动置顶的工作区时什么也不做。
   */
  kick() {
    if (this.disposed || this.kickDelayMs < 0) return
    if (!this.store.loaded || this.store.state.enabled.length === 0) return
    if (this.kickTimer !== undefined) return
    this.kickTimer = this.setTimeoutFn(() => {
      this.kickTimer = undefined
      if (this.disposed) return
      if (this.running !== undefined) {
        if (!this.kickAgain) { this.kickAgain = true; void this.running.finally(() => { this.kickAgain = false; this.kick() }) }
        return
      }
      void this.sync().catch((error) => this.logger?.warn?.(`session-relay: auto-pin kick failed: ${error?.message ?? error}`))
    }, this.kickDelayMs)
    this.kickTimer?.unref?.()
  }

  /** 开关。关闭时撤掉本工作区插件加的置顶。 */
  async setEnabled(key, enabled) {
    if (!this.store.loaded) await this.store.load()
    if (enabled) {
      await this.store.mutate((next) => { if (!next.enabled.includes(key)) next.enabled.push(key) })
      return this.sync()
    }
    // 先等进行中的一轮，避免它在关闭后又置顶
    await this.running?.catch(() => {})
    const registry = this.registry()
    const mine = Object.entries(this.store.snapshot().owned).filter(([, group]) => group === key).map(([id]) => id)
    const removed = []
    for (const id of mine) {
      try { if (this.available()) await registry.unpinSession(id); removed.push(id) } catch (error) { this.logger?.warn?.(`session-relay: auto-unpin ${id} failed: ${error?.message ?? error}`) }
    }
    await this.store.mutate((next) => {
      next.enabled = next.enabled.filter((item) => item !== key)
      for (const id of removed) delete next.owned[id]
    })
    return [{ key, unpinned: removed }]
  }

  isEnabled(key) {
    return this.store.state.enabled.includes(key)
  }

  ownedIn(key) {
    return Object.entries(this.store.state.owned).filter(([, group]) => group === key).map(([id]) => id)
  }

  dispose() {
    this.disposed = true
    if (this.timer !== undefined) this.clearTimer(this.timer)
    this.timer = undefined
    if (this.kickTimer !== undefined) this.clearTimeoutFn(this.kickTimer)
    this.kickTimer = undefined
  }
}
