/**
 * 对方会话的待送队列（DSH agent inbox：next-turn / next-step 两个列表）。
 * 只读和按 id 删除 / 替换，不碰对方已经开始处理的输入。
 * 发送方从消息自己的 source.senderSessionId 认，不另外记账；排队时长靠插件投递时记的时间（重载后由 adopt 接过来）。
 */

/** agent 的 inbox 支持按 id 读删时返回它，否则 undefined（测试替身、旧宿主）。 */
export function inboxOf(agent) {
  const inbox = agent?.inbox
  if (inbox === null || typeof inbox !== 'object') return undefined
  if (!Array.isArray(inbox.nextTurn) || !Array.isArray(inbox.nextStep) || typeof inbox.remove !== 'function') return undefined
  return inbox
}

/** 消息正文：去掉插件加的头（「---」分隔线之前的说明），只留发送方写的内容。 */
export function messagePreview(message, limit = 80) {
  const text = (Array.isArray(message?.content) ? message.content : [])
    .filter((part) => part?.type === 'text').map((part) => String(part.text ?? '')).join('\n')
  const marker = text.indexOf('\n---\n')
  const body = (marker >= 0 ? text.slice(marker + 5) : text).replace(/\s+/g, ' ').trim()
  return body.length > limit ? body.slice(0, limit - 1) + '…' : body
}

/**
 * 对方队列里还没送达的消息。
 * @returns {Array<{ id, list, senderId, message }>}；不支持时返回 undefined
 */
export function pendingOf(agent) {
  const inbox = inboxOf(agent)
  if (inbox === undefined) return undefined
  const out = []
  for (const [list, items] of [['next-step', inbox.nextStep], ['next-turn', inbox.nextTurn]]) {
    for (const message of items) {
      if (typeof message?.id !== 'string') continue
      const source = message.source ?? {}
      out.push({ id: message.id, list, senderId: source.kind === 'agent-message' ? source.senderSessionId : undefined, message })
    }
  }
  return out
}

/**
 * 回执用的队列状态。
 * @param sentAt - Map<messageId, 投递时间>
 */
export function queueStats(pending, senderId, sentAt, now = Date.now()) {
  if (pending === undefined) return undefined
  const mine = pending.filter((item) => senderId !== undefined && item.senderId === senderId)
  const times = pending.map((item) => sentAt.get(item.id)).filter((at) => Number.isFinite(at))
  return { total: pending.length, mine: mine.length, oldestMs: times.length === 0 ? undefined : Math.max(0, now - Math.min(...times)) }
}

/** 待收队列的上限与「落后/卡住」判定。 */
export const BACKLOG_DEFAULTS = Object.freeze({
  /** 待收消息到这个数就直接拒绝新的普通消息（steer/interrupt 例外）。 */
  maxPending: 8,
  /** 到这个数（或最早一条超过 lagOldestMs）算落后。 */
  lagPending: 4,
  lagOldestMs: 5 * 60_000,
  /** 最早一条超过这个时长，或运行中且待收不为空超过这个时长，算卡住。 */
  stuckOldestMs: 30 * 60_000,
  stuckRunningMs: 30 * 60_000
})

/**
 * 判定一个会话的待收队列：ok / lagging / stuck。
 * 只用可观测的量：条数、最早一条排了多久、当前轮跑了多久；不猜对方在做什么。
 */
export function classifyBacklog({ count = 0, oldestMs, runningMs } = {}, limits = BACKLOG_DEFAULTS) {
  const pending = Math.max(0, Number(count) || 0)
  const oldest = Number.isFinite(oldestMs) ? Math.max(0, oldestMs) : 0
  const running = Number.isFinite(runningMs) ? Math.max(0, runningMs) : 0
  const why = []
  if (pending >= limits.maxPending) why.push(`待收 ${pending} 条，到硬上限 ${limits.maxPending}`)
  if (oldest >= limits.stuckOldestMs) why.push(`最早一条排了 ${formatAge(oldest)}`)
  if (running >= limits.stuckRunningMs && pending > 0) why.push(`当前轮已跑了 ${formatAge(running)}，待收没清`)
  if (why.length > 0) return { level: 'stuck', why: why.join('；') }
  if (pending >= limits.lagPending) why.push(`待收 ${pending} 条`)
  if (oldest >= limits.lagOldestMs) why.push(`最早一条排了 ${formatAge(oldest)}`)
  return why.length > 0 ? { level: 'lagging', why: why.join('；') } : { level: 'ok', why: '' }
}

/** 投递时间表只留最近的若干条，免得无限长。 */
export function rememberSent(sentAt, id, at, max = 500) {
  sentAt.set(id, at)
  while (sentAt.size > max) sentAt.delete(sentAt.keys().next().value)
}

export function formatAge(ms) {
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return '不到 1 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

/** 追加一行审计（撤回前任 / 别人发的消息时）；失败不影响撤回本身。 */
export async function appendQueueAudit(path, record, now = Date.now()) {
  if (path === undefined) return
  const { appendFile, mkdir } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  try {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, JSON.stringify({ at: new Date(now).toISOString(), ...record }) + '\n', { mode: 0o600 })
  } catch {}
}
