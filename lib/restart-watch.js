/**
 * 重启时机提醒：等所有会话都空闲（无运行中的轮次、后台任务、子代理、持久终端）
 * 并稳定一段时间后，发一次手机通知，然后停止观察。
 *
 * 只观察、只提醒，不重启任何东西。nohup 等脱离 DSH 的进程看不到，提醒文案里会说明。
 */

export const RESTART_DEFAULTS = Object.freeze({ intervalMs: 5_000, stableMs: 30_000, timeoutMs: 6 * 3600_000 })

export class RestartWatch {
  /**
   * @param options.sessions - () => 当前 live 会话 id 列表
   * @param options.activity - (sessionId) => Promise<活动列表>，空数组表示空闲
   * @param options.notify - (title, text) => Promise<void>
   */
  constructor({ sessions, activity, notify, label = (id) => id, now = Date.now, setTimer = setInterval, clearTimer = clearInterval, logger, ...rest }) {
    const config = { ...RESTART_DEFAULTS, ...rest }
    this.sessions = sessions
    this.activity = activity
    this.notify = notify
    this.label = label
    this.now = now
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.logger = logger
    this.intervalMs = config.intervalMs
    this.stableMs = config.stableMs
    this.timeoutMs = config.timeoutMs
    this.state = { phase: 'off' }
    this.timer = undefined
    this.inflight = undefined
  }

  /** 开始等待；已在等待时只返回当前状态。 */
  start() {
    if (this.state.phase === 'watching') return this.snapshot()
    this.state = { phase: 'watching', startedAt: this.now(), idleSince: undefined, busy: [], lastCheckAt: undefined }
    this.arm()
    void this.tick().catch((error) => this.logger?.warn?.(`session-relay: restart check failed: ${error?.message ?? error}`))
    return this.snapshot()
  }

  cancel() {
    const was = this.state.phase === 'watching'
    this.disarm()
    this.state = { phase: was ? 'cancelled' : this.state.phase, at: this.now() }
    return was
  }

  arm() {
    this.disarm()
    this.timer = this.setTimer(() => { void this.tick().catch((error) => this.logger?.warn?.(`session-relay: restart check failed: ${error?.message ?? error}`)) }, this.intervalMs)
    this.timer?.unref?.()
  }

  disarm() {
    if (this.timer !== undefined) this.clearTimer(this.timer)
    this.timer = undefined
  }

  /** 一次检查；检查进行中再调用会等同一次检查结束，不并发。 */
  tick() {
    if (this.state.phase !== 'watching') return Promise.resolve()
    if (this.inflight === undefined) this.inflight = this.check().finally(() => { this.inflight = undefined })
    return this.inflight
  }

  async check() {
    {
      const now = this.now()
      if (now - this.state.startedAt > this.timeoutMs) {
        this.disarm()
        this.state = { phase: 'timeout', at: now }
        return
      }
      const busy = []
      for (const sessionId of this.sessions()) {
        let kinds = []
        try {
          const found = await this.activity(sessionId)
          kinds = Array.isArray(found) ? found.map((item) => item?.kind ?? 'activity') : []
        } catch {
          kinds = ['unknown']
        }
        if (kinds.length > 0) busy.push({ sessionId, kinds })
      }
      if (this.state.phase !== 'watching') return
      const checkedAt = this.now()
      if (busy.length > 0) {
        this.state = { ...this.state, idleSince: undefined, busy, lastCheckAt: checkedAt }
        return
      }
      const idleSince = this.state.idleSince ?? checkedAt
      this.state = { ...this.state, idleSince, busy: [], lastCheckAt: checkedAt }
      if (checkedAt - idleSince < this.stableMs) return
      this.disarm()
      let notifyError
      try {
        await this.notify('现在可以重启 DSH', `所有会话已空闲 ${Math.round((checkedAt - idleSince) / 1000)} 秒（没有运行中的轮次、后台任务、子代理或终端）。nohup 等脱离 DSH 的进程不在统计内。`)
      } catch (error) {
        notifyError = error?.message ?? String(error)
        this.logger?.warn?.(`session-relay: restart notify failed: ${notifyError}`)
      }
      this.state = { phase: 'ready', at: checkedAt, ...(notifyError === undefined ? {} : { notifyError }) }
    }
  }

  snapshot() {
    const state = this.state
    return {
      phase: state.phase,
      ...(state.startedAt === undefined ? {} : { startedAt: state.startedAt }),
      ...(state.idleSince === undefined ? {} : { idleSince: state.idleSince }),
      ...(state.lastCheckAt === undefined ? {} : { lastCheckAt: state.lastCheckAt }),
      ...(state.at === undefined ? {} : { at: state.at }),
      ...(state.notifyError === undefined ? {} : { notifyError: state.notifyError }),
      busy: (state.busy ?? []).map((item) => ({ ...item, label: this.label(item.sessionId) }))
    }
  }

  /** 热重载时接管旧实例的等待状态。 */
  adopt(previous) {
    if (previous?.state?.phase === undefined) return
    this.state = { ...previous.state }
    previous.disarm?.()
    if (this.state.phase === 'watching') this.arm()
  }

  dispose() {
    this.disarm()
  }
}

/** 等待状态的人类可读描述。 */
export function describeRestart(snapshot) {
  switch (snapshot.phase) {
    case 'watching': {
      if (snapshot.busy.length > 0) {
        const kinds = { turn: '轮次', job: '后台任务', subagent: '子代理', terminal: '终端', unknown: '状态未知' }
        const list = snapshot.busy.slice(0, 6).map((item) => `${item.label}（${item.kinds.map((kind) => kinds[kind] ?? kind).join('、')}）`).join('；')
        return `正在等待所有会话空闲。还在忙：${list}${snapshot.busy.length > 6 ? ` 等 ${snapshot.busy.length} 个` : ''}`
      }
      return snapshot.idleSince === undefined ? '正在等待所有会话空闲…' : '所有会话已空闲，再稳定几秒就通知你…'
    }
    case 'ready': return `可以重启了：所有会话都空闲${snapshot.notifyError ? `（手机通知没发出去：${snapshot.notifyError}）` : '，已发手机通知'}。nohup 等脱离 DSH 的进程不在统计内。`
    case 'timeout': return '等了 6 小时会话仍不空闲，已停止等待。'
    case 'cancelled': return '已取消等待。'
    default: return '没有在等待。'
  }
}
