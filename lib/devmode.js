/**
 * 开发者模式：用户在面板或 /relay dev 打开后，限时内模型可以只读查看所有工作区的会话（调试插件 / 跨项目排查用）。
 * 只放宽「读」：peer_inspect 指定别的工作区的会话、scope=all 的跨工作区搜索、peer_workspace session=<别的工作区会话>。
 * 发消息、改看板、认领、接手、分配等写操作的工作区边界不变。
 *
 * devmode.json: { version: 1, until, enabledAt, by: 'user' }，过期即视为关闭（不用定时器）。
 * 每次跨工作区读取追加一行到 devmode-audit.jsonl（超过 1 MB 轮转一份 .1）。
 */
import { appendFile, readFile, rename, stat, unlink } from 'node:fs/promises'
import { RelayError, writeJsonAtomic } from './core.js'

export const DEV_MODE_DEFAULT_HOURS = 2
export const DEV_MODE_MAX_HOURS = 24
const AUDIT_LIMIT = 1024 * 1024

export class DevMode {
  constructor(path, auditPath, { now = Date.now } = {}) {
    this.path = path
    this.auditPath = auditPath
    this.now = now
    this.state = undefined
    this.loaded = false
    this.chain = Promise.resolve()
  }

  async load() {
    let parsed
    try { parsed = JSON.parse(await readFile(this.path, 'utf8')) } catch (error) {
      if (error instanceof SyntaxError) await rename(this.path, `${this.path}.corrupt-${this.now()}`).catch(() => {})
      else if (error?.code !== 'ENOENT') throw error
    }
    this.state = parsed?.version === 1 && Number.isFinite(parsed.until) ? { until: parsed.until, enabledAt: Number(parsed.enabledAt) || 0 } : undefined
    this.loaded = true
    return this.state
  }

  /** 现在是否开着（过期算关）。 */
  active() {
    return this.state !== undefined && this.now() < this.state.until
  }

  view() {
    return this.active() ? { enabled: true, until: this.state.until, enabledAt: this.state.enabledAt } : { enabled: false, until: null, enabledAt: null }
  }

  /** 只由用户调用（面板 / /relay dev）。hours 缺省 2，范围 (0, 24]。 */
  async enable(hours = DEV_MODE_DEFAULT_HOURS) {
    const value = Number(hours)
    if (!Number.isFinite(value) || value <= 0 || value > DEV_MODE_MAX_HOURS) throw new RelayError(`时长要在 0–${DEV_MODE_MAX_HOURS} 小时之间`, 'bad_hours')
    const at = this.now()
    this.state = { until: at + Math.round(value * 3600_000), enabledAt: at }
    await this.save()
    await this.audit({ event: 'enable', until: this.state.until })
    return this.view()
  }

  async disable() {
    const was = this.active()
    this.state = undefined
    await this.save()
    if (was) await this.audit({ event: 'disable' })
    return was
  }

  save() {
    const body = this.state === undefined ? { version: 1, until: null } : { version: 1, until: this.state.until, enabledAt: this.state.enabledAt, by: 'user' }
    const run = this.chain.then(() => writeJsonAtomic(this.path, body))
    this.chain = run.catch(() => {})
    return run
  }

  /** 记一条审计；失败不影响读取本身。 */
  async audit(record) {
    if (this.auditPath === undefined) return
    const line = JSON.stringify({ at: new Date(this.now()).toISOString(), ...record }) + '\n'
    const run = this.chain.then(async () => {
      try { if ((await stat(this.auditPath)).size > AUDIT_LIMIT) { await unlink(`${this.auditPath}.1`).catch(() => {}); await rename(this.auditPath, `${this.auditPath}.1`) } } catch {}
      await appendFile(this.auditPath, line, { mode: 0o600 })
    })
    this.chain = run.catch(() => {})
    return run.catch(() => {})
  }
}
