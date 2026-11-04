/**
 * 推送链提醒（用户 2026-11-03 同意）：替掉主会话靠定时器读日志末行。
 * 每轮读各工作区活跃声明「后台任务」里登记的日志；某个日志的末行从别的内容变成
 * STOP / 失败 / *_DONE 时，给该工作区的主会话发一条提醒（运行中就插进下一步，空闲才唤醒）。
 * - 第一次看到的日志只记基线，不提醒（插件加载 / 重载时不会补发旧结果）；
 * - 同一日志同一末行只提醒一次；同一轮多条合成一条；
 * - 只读日志，不碰进程、不改声明。
 * - 0.12.0 起持久化（用户 2026-11-04 要求重启不漏）：每个日志上次看到的末行存进核验清单文件，
 *   重启后接着比较，停机期间变成 STOP / DONE 的照样提醒；投递失败的不记为已看到，下一轮重试；
 *   每条提醒另发一次手机通知。只有第一次见到的日志才只记基线。
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
export function chainTransitions(seen, background, { commit = true } = {}) {
  const alerts = []
  const handled = new Set()
  for (const item of background ?? []) {
    for (const log of item.logs ?? []) {
      if (log.missing || handled.has(log.path)) continue
      handled.add(log.path)
      const previous = seen.get(log.path)
      const kind = previous === undefined || previous === log.last ? undefined : terminalKind(log)
      // commit=false：要提醒的先不记为已看到，投递成功后再记（失败下一轮重试）
      if (kind === undefined || commit) seen.set(log.path, log.last)
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
  constructor({ targets, scan, deliver, notify, loadSeen, saveSeen, intervalMs = CHAIN_DEFAULTS.intervalMs, logger, setTimer = setInterval, clearTimer = clearInterval } = {}) {
    this.targets = targets
    this.scan = scan
    this.deliver = deliver
    this.notify = notify
    this.loadSeen = loadSeen
    this.saveSeen = saveSeen
    this.phoned = new Set()
    this.restored = loadSeen === undefined
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
      if (!this.restored) {
        // 第一次轮询前从持久文件恢复：DSH 重启后接着上次的末行比较
        const saved = await Promise.resolve(this.loadSeen()).catch(() => undefined)
        for (const [root, entries] of Object.entries(saved ?? {})) if (!this.seen.has(root)) this.seen.set(root, new Map(Object.entries(entries ?? {})))
        this.restored = true
      }
      for (const target of this.targets() ?? []) {
        let result
        try { result = await this.scan(target.root) } catch (error) { this.logger?.warn?.(`session-relay: chain scan ${target.root} failed: ${error?.message ?? error}`); continue }
        const seen = this.seenFor(target.root)
        const currentPaths = new Set((result?.background ?? []).flatMap((item) => (item.logs ?? []).map((log) => log.path)).filter(Boolean))
        for (const path of seen.keys()) if (!currentPaths.has(path)) seen.delete(path)
        const alerts = chainTransitions(seen, result?.background, { commit: target.coordinatorId === undefined })
        while (seen.size > MAX_SEEN_LOGS) seen.delete(seen.keys().next().value)
        if (alerts.length === 0 || target.coordinatorId === undefined) continue
        // 手机通知每条只发一次（投递重试不重复发）
        for (const alert of alerts) {
          const key = `${alert.path}\u0000${alert.last}`
          if (this.phoned.has(key) || this.notify === undefined) continue
          this.phoned.add(key)
          while (this.phoned.size > MAX_SEEN_LOGS) this.phoned.delete(this.phoned.values().next().value)
          await Promise.resolve(this.notify(alert.kind === 'stop' ? '推送链停下 / 失败' : '推送链完成', `${target.workspaceTitle ?? ''} ${alert.path.split('/').pop()}：${alert.last}`.trim())).catch(() => {})
        }
        const text = frameChainAlert({ workspaceTitle: target.workspaceTitle, alerts })
        try {
          await this.deliver(target.coordinatorId, text)
          for (const alert of alerts) seen.set(alert.path, alert.last)
          delivered.push({ to: target.coordinatorId, alerts })
          this.sent = [...this.sent, { at: Date.now(), to: target.coordinatorId, count: alerts.length }].slice(-20)
        } catch (error) {
          this.logger?.warn?.(`session-relay: chain alert to ${target.coordinatorId} failed: ${error?.message ?? error}`)
        }
      }
      if (this.saveSeen !== undefined) await Promise.resolve(this.saveSeen(Object.fromEntries([...this.seen].map(([root, map]) => [root, Object.fromEntries(map)])))).catch((error) => this.logger?.warn?.(`session-relay: chain seen save failed: ${error?.message ?? error}`))
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
    for (const key of previous?.phoned ?? []) this.phoned.add(key)
    if (previous?.restored) this.restored = true
  }

  dispose() {
    if (this.timer !== undefined) this.clearTimer(this.timer)
    this.timer = undefined
  }
}
