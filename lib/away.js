/**
 * 用户不在时：主会话向用户提问（peer_ask_user）与无人值守唤醒预算。持久在 away.json。
 *
 * { version: 1, groups: { <工作区 id>: {
 *     asks: [{ id, question, options, about?, by, at, state: 'pending'|'answered'|'dismissed', answer?, endedAt? }],
 *     wakes: [{ at, target, tokens }],          // 最近一小时模型发起、唤醒了空闲会话的投递
 *     paused?: { at, notified }                 // 到上限后暂停：满一小时自动解除，或用户在面板「继续」
 * } } }
 *
 * 判定与记账在内存里同步完成（投递是异步的，先占名额再投递，避免并发绕过上限）；写盘排队进行。
 */
import { randomBytes } from 'node:crypto'
import { readFile, rename } from 'node:fs/promises'
import { RelayError, oneLine, writeJsonAtomic } from './core.js'

export const AWAY_LIMITS = Object.freeze({ pending: 20, ended: 10, question: 300, option: 40, minOptions: 2, maxOptions: 3 })
export const WAKE_WINDOW_MS = 3600_000
export const DEFAULT_WAKES_PER_HOUR = 16

function cleanAsk(item) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.question !== 'string' || !Array.isArray(item.options)) return undefined
  if (!['pending', 'answered', 'dismissed'].includes(item.state)) return undefined
  return {
    id: item.id, question: item.question, options: item.options.filter((option) => typeof option === 'string').slice(0, AWAY_LIMITS.maxOptions),
    ...(typeof item.about === 'string' ? { about: item.about } : {}),
    ...(typeof item.by === 'string' ? { by: item.by } : {}),
    at: Number(item.at) || 0, state: item.state,
    ...(typeof item.answer === 'string' ? { answer: item.answer } : {}),
    ...(Number.isFinite(item.endedAt) ? { endedAt: item.endedAt } : {})
  }
}

function cleanGroup(value) {
  const asks = Array.isArray(value?.asks) ? value.asks.map(cleanAsk).filter(Boolean) : []
  const wakes = Array.isArray(value?.wakes) ? value.wakes.filter((item) => Number.isFinite(item?.at)).map((item) => ({ at: item.at, ...(typeof item.target === 'string' ? { target: item.target } : {}), tokens: Number(item.tokens) || 0 })) : []
  const paused = Number.isFinite(value?.paused?.at) ? { at: value.paused.at, notified: value.paused.notified === true } : undefined
  return { asks, wakes, ...(paused === undefined ? {} : { paused }) }
}

export class AwayStore {
  constructor(path, { now = Date.now } = {}) {
    this.path = path
    this.now = now
    this.state = { groups: {} }
    this.loaded = false
    this.chain = Promise.resolve()
  }

  async load() {
    let parsed
    try { parsed = JSON.parse(await readFile(this.path, 'utf8')) } catch (error) {
      if (error instanceof SyntaxError) await rename(this.path, `${this.path}.corrupt-${this.now()}`).catch(() => {})
      else if (error?.code !== 'ENOENT') throw error
    }
    const groups = {}
    if (parsed?.version === 1 && parsed.groups && typeof parsed.groups === 'object') {
      for (const [key, value] of Object.entries(parsed.groups)) groups[key] = cleanGroup(value)
    }
    this.state = { groups }
    this.loaded = true
    return this.state
  }

  /** 已在内存改好：排队写盘（失败只记日志，不影响判定）。 */
  save() {
    const run = this.chain.then(() => writeJsonAtomic(this.path, { version: 1, groups: this.state.groups }))
    this.chain = run.catch(() => {})
    return run
  }

  group(key) {
    const group = (this.state.groups[key] ??= { asks: [], wakes: [] })
    // 只留最近一小时的唤醒
    const now = this.now()
    group.wakes = group.wakes.filter((item) => now - item.at < WAKE_WINDOW_MS)
    // 暂停按小时自动解除：暂停起满一小时就放开（用户也可以随时「继续」）
    if (group.paused !== undefined && now - group.paused.at >= WAKE_WINDOW_MS) delete group.paused
    return group
  }

  // ------------------------------------------------------------ 提问

  pending(key) {
    return (this.state.groups[key]?.asks ?? []).filter((item) => item.state === 'pending')
  }

  pendingCount() {
    let count = 0
    for (const group of Object.values(this.state.groups)) count += group.asks.filter((item) => item.state === 'pending').length
    return count
  }

  find(key, id) {
    return (this.state.groups[key]?.asks ?? []).find((item) => item.id === id)
  }

  /** 登记一个提问；同一问题还在等时返回原来那条（duplicate=true）。 */
  ask(key, { question, options, about, by }) {
    const text = String(question ?? '').trim()
    if (text === '') throw new RelayError('question 不能为空', 'bad_ask')
    if (text.length > AWAY_LIMITS.question) throw new RelayError(`question 最多 ${AWAY_LIMITS.question} 字`, 'bad_ask')
    const raw = typeof options === 'string' ? options.split(/[|\n]/) : options
    const list = Array.isArray(raw) ? raw.map((option) => oneLine(option)).filter((option) => option !== '') : []
    if (list.length < AWAY_LIMITS.minOptions || list.length > AWAY_LIMITS.maxOptions) throw new RelayError(`options 要 ${AWAY_LIMITS.minOptions}–${AWAY_LIMITS.maxOptions} 个简短选项`, 'bad_ask')
    if (list.some((option) => option.length > AWAY_LIMITS.option)) throw new RelayError(`每个选项最多 ${AWAY_LIMITS.option} 字`, 'bad_ask')
    if (new Set(list).size !== list.length) throw new RelayError('选项不能重复', 'bad_ask')
    const group = this.group(key)
    const same = group.asks.find((item) => item.state === 'pending' && item.question === text)
    if (same !== undefined) return { ask: same, duplicate: true }
    if (group.asks.filter((item) => item.state === 'pending').length >= AWAY_LIMITS.pending) {
      throw new RelayError(`已有 ${AWAY_LIMITS.pending} 个问题在等用户回答；先等用户处理，不要再问`, 'too_many_asks')
    }
    const ask = { id: randomBytes(4).toString('hex'), question: text, options: list, ...(about ? { about } : {}), ...(by ? { by } : {}), at: this.now(), state: 'pending' }
    group.asks.push(ask)
    this.trimEnded(group)
    void this.save()
    return { ask, duplicate: false }
  }

  /** 用户回答或忽略；不是 pending 的抛错（面板重复点击）。 */
  resolve(key, id, { answer, dismiss = false }) {
    const ask = this.find(key, id)
    if (ask === undefined) throw new RelayError('没有这个问题（可能已被清理）', 'no_ask')
    if (ask.state !== 'pending') throw new RelayError(ask.state === 'answered' ? `这个问题已经回答过：${ask.answer}` : '这个问题已被忽略', 'ask_ended')
    if (!dismiss && !ask.options.includes(answer)) throw new RelayError('选项不在这个问题的选项里', 'bad_option')
    ask.state = dismiss ? 'dismissed' : 'answered'
    if (!dismiss) ask.answer = answer
    ask.endedAt = this.now()
    this.trimEnded(this.group(key))
    void this.save()
    return ask
  }

  trimEnded(group) {
    const ended = group.asks.filter((item) => item.state !== 'pending')
    if (ended.length <= AWAY_LIMITS.ended) return
    const drop = new Set(ended.sort((a, b) => (a.endedAt ?? a.at) - (b.endedAt ?? b.at)).slice(0, ended.length - AWAY_LIMITS.ended))
    group.asks = group.asks.filter((item) => !drop.has(item))
  }

  // ------------------------------------------------------------ 唤醒预算

  /**
   * 模型发起的一次唤醒能不能放行：放行就记账（tokens = 目标此刻的上下文大小）。
   * limit 为 0 不限。到上限时进入暂停，返回 { allowed: false, newlyPaused }；暂停期间一律不放行。
   */
  admit(key, { limit, target, tokens }) {
    const group = this.group(key)
    if (group.paused !== undefined) return { allowed: false, newlyPaused: false }
    if (limit > 0 && group.wakes.length >= limit) {
      group.paused = { at: this.now(), notified: false }
      void this.save()
      return { allowed: false, newlyPaused: true }
    }
    group.wakes.push({ at: this.now(), ...(target ? { target } : {}), tokens: Number(tokens) || 0 })
    void this.save()
    return { allowed: true }
  }

  /** 这次暂停的手机通知只发一次。 */
  markNotified(key) {
    const group = this.group(key)
    if (group.paused === undefined || group.paused.notified) return false
    group.paused.notified = true
    void this.save()
    return true
  }

  /** 用户「继续」：解除暂停并清空本小时计数。 */
  resume(key) {
    const group = this.group(key)
    const was = group.paused !== undefined
    delete group.paused
    group.wakes = []
    void this.save()
    return was
  }

  isPaused(key) {
    return this.state.groups[key] === undefined ? false : this.group(key).paused !== undefined
  }

  view(key, limit) {
    const group = this.state.groups[key] === undefined ? { wakes: [] } : this.group(key)
    return {
      wakesThisHour: group.wakes.length,
      limit,
      approxTokensThisHour: group.wakes.reduce((sum, item) => sum + (item.tokens || 0), 0),
      paused: group.paused !== undefined,
      pausedAt: group.paused?.at ?? null
    }
  }
}
