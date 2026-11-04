/**
 * 推送链提醒（用户 2026-11-03 同意）：替掉主会话靠定时器读日志末行。
 * 每轮读各工作区活跃声明「后台任务」里登记的日志；某个日志的末行从别的内容变成
 * STOP / 失败 / *_DONE 时，给该工作区的主会话发一条提醒（运行中就插进下一步，空闲才唤醒）。
 * - 第一次看到的日志只记基线，不提醒（插件加载 / 重载时不会补发旧结果）；
 * - 同一日志同一末行只提醒一次；同一轮多条合成一条；
 * - 只读日志，不碰进程、不改声明。
 */

export const CHAIN_DEFAULTS = Object.freeze({ intervalMs: 60_000 })
const MAX_SEEN_LOGS = 512

/** 判断一行是否是“结束”：停下 / 失败或完成。 */
export function terminalKind(log) {
  if (log?.missing) return undefined
  if (log?.stopped) return 'stop'
  if (log?.finished) return 'done'
  return undefined
}

/**
 * 对比上一轮记下的末行，返回需要提醒的条目。
 * @param seen - Map<path, lastLine>（会被更新）
 * @param background - checkBackground 结果数组
 */
export function chainTransitions(seen, background) {
  const alerts = []
  const handled = new Set()
  for (const item of background ?? []) {
    for (const log of item.logs ?? []) {
      if (log.missing || handled.has(log.path)) continue
      handled.add(log.path)
      const previous = seen.get(log.path)
      seen.set(log.path, log.last)
      if (previous === undefined || previous === log.last) continue
      const kind = terminalKind(log)
      if (kind !== undefined) alerts.push({ rel: item.rel, path: log.path, last: log.last, kind, pids: item.pids ?? [] })
    }
  }
  return alerts
}

export function frameChainAlert({ workspaceTitle, alerts }) {
  const lines = [
    `[协作插件 · 推送链提醒${workspaceTitle ? ` · 工作区 ${workspaceTitle}` : ''}]`,
    '这是插件读声明「后台任务」登记的日志后自动发的提醒，不是用户指令，也不是其它会话的请求。推送、发布、重跑仍按仓库约定由你核对并经用户同意；结果未知的命令不要重放。',
    ''
  ]
  for (const alert of alerts) {
    const pids = alert.pids.length === 0 ? '' : `（${alert.pids.map((p) => `pid ${p.pid} ${p.alive ? '仍在运行' : '已退出'}`).join('、')}）`
    lines.push(`- ${alert.kind === 'stop' ? '⚠ 停下 / 失败' : '✓ 完成'}：${alert.path} 末行「${alert.last}」${pids} · 登记在 ${alert.rel}`)
  }
  lines.push('', '核对后记得按约定更新该声明的「后台任务」（写明退出码）；不再需要定时器轮询这些日志。')
  return lines.join('\n')
}

/**
 * 轮询器：扫描函数与投递函数由 relay 注入，便于测试。
 * @param opts.targets - () => Array<{ key, coordinatorId, root, workspaceTitle }>
 * @param opts.scan - (root) => Promise<{ background }>
 * @param opts.deliver - (coordinatorId, text) => Promise
 */
export class ChainWatch {
  constructor({ targets, scan, deliver, intervalMs = CHAIN_DEFAULTS.intervalMs, logger, setTimer = setInterval, clearTimer = clearInterval } = {}) {
    this.targets = targets
    this.scan = scan
    this.deliver = deliver
    this.intervalMs = intervalMs
    this.logger = logger
    this.seen = new Map()
    this.sent = []
    this.running = false
    this.clearTimer = clearTimer
    if (intervalMs > 0) {
      this.timer = setTimer(() => { void this.poll().catch((error) => this.logger?.warn?.(`session-relay: chain poll failed: ${error?.message ?? error}`)) }, intervalMs)
      this.timer?.unref?.()
    }
  }

  async poll() {
    if (this.running) return []
    this.running = true
    const delivered = []
    try {
      for (const target of this.targets() ?? []) {
        let result
        try { result = await this.scan(target.root) } catch (error) { this.logger?.warn?.(`session-relay: chain scan ${target.root} failed: ${error?.message ?? error}`); continue }
        const seen = this.seenFor(target.root)
        const currentPaths = new Set((result?.background ?? []).flatMap((item) => (item.logs ?? []).map((log) => log.path)).filter(Boolean))
        for (const path of seen.keys()) if (!currentPaths.has(path)) seen.delete(path)
        const alerts = chainTransitions(seen, result?.background)
        while (seen.size > MAX_SEEN_LOGS) seen.delete(seen.keys().next().value)
        if (alerts.length === 0 || target.coordinatorId === undefined) continue
        const text = frameChainAlert({ workspaceTitle: target.workspaceTitle, alerts })
        try {
          await this.deliver(target.coordinatorId, text)
          delivered.push({ to: target.coordinatorId, alerts })
          this.sent = [...this.sent, { at: Date.now(), to: target.coordinatorId, count: alerts.length }].slice(-20)
        } catch (error) {
          this.logger?.warn?.(`session-relay: chain alert to ${target.coordinatorId} failed: ${error?.message ?? error}`)
        }
      }
    } finally {
      this.running = false
    }
    return delivered
  }

  seenFor(root) {
    if (!this.seen.has(root)) this.seen.set(root, new Map())
    return this.seen.get(root)
  }

  adopt(previous) {
    for (const [root, map] of previous?.seen ?? []) this.seen.set(root, new Map(map))
    this.sent = [...(previous?.sent ?? [])]
  }

  dispose() {
    if (this.timer !== undefined) this.clearTimer(this.timer)
    this.timer = undefined
  }
}
