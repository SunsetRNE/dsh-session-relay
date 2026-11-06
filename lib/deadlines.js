/**
 * 平级通知的待回执时限（2.0.0 补丁）。
 *
 * 问题：peer_send / peer_report question 发出去后没有任何时限；对方一直埋头苦干或忘记回，
 * 发送方会无限期等下去。这里为每条显式通知记一个 deadline；超时后用插队消息提醒发送方
 * （不是替对方执行，也不改任何任务状态）。
 *
 * - 只有显式通知（peer_send、/relay 指令、peer_report question/blocked）才登记；
 *   插件内部的看板/邮件/核验通知不登记，避免刷屏。
 * - 回执：对方用 peer_send / peer_report 回给发送方时，由 ackExchange 清掉对应记录。
 * - 只提醒一次；提醒后保留到回执或 24 小时，便于审计/排查。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const DEADLINE_VERSION = 1
export const MAX_DEADLINE_RECORDS = 2000
export const MAX_DEADLINE_KEEP_MS = 24 * 3600_000

function cleanRecord(value) {
  if (value === null || typeof value !== 'object') return undefined
  const id = typeof value.id === 'string' ? value.id : undefined
  const from = typeof value.from === 'string' ? value.from : undefined
  const to = typeof value.to === 'string' ? value.to : undefined
  const deadlineAt = Number(value.deadlineAt)
  if (id === undefined || from === undefined || to === undefined || !Number.isFinite(deadlineAt)) return undefined
  return {
    id,
    from,
    to,
    at: Number(value.at) || 0,
    deadlineAt,
    timeoutMs: Number(value.timeoutMs) || 0,
    mode: typeof value.mode === 'string' ? value.mode : 'followup',
    kind: value.kind === 'report' ? 'report' : 'send',
    preview: typeof value.preview === 'string' ? value.preview.slice(0, 200) : '',
    ...(Number(value.deliveredAt) > 0 ? { deliveredAt: Number(value.deliveredAt) } : {}),
    ...(value.receiptPending === true ? { receiptPending: true } : {}),
    ...(value.receiptOnly === true ? { receiptOnly: true } : {}),
    ...(Number(value.remindedAt) > 0 ? { remindedAt: Number(value.remindedAt) } : {}),
    ...(typeof value.lastError === 'string' ? { lastError: value.lastError.slice(0, 200) } : {})
  }
}

export class DeadlineStore {
  constructor(path, { now = Date.now } = {}) {
    this.path = path
    this.now = now
    this.state = { version: DEADLINE_VERSION, pending: {} }
    this.loaded = false
    this.chain = Promise.resolve()
  }

  async load() {
    if (this.loaded) return this.state
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'))
      const pending = {}
      for (const [id, value] of Object.entries(parsed?.pending ?? {})) {
        const record = cleanRecord(value)
        if (record !== undefined) pending[id] = record
      }
      this.state = { version: DEADLINE_VERSION, pending }
    } catch { this.state = { version: DEADLINE_VERSION, pending: {} } }
    this.loaded = true
    return this.state
  }

  async save() {
    await mkdir(dirname(this.path), { recursive: true }).catch(() => {})
    const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 })
    await rename(tmp, this.path)
  }

  prune(state, now = this.now()) {
    const entries = Object.values(state.pending)
    for (const record of entries) {
      if (now - Math.max(record.at, record.remindedAt ?? 0) > MAX_DEADLINE_KEEP_MS) delete state.pending[record.id]
    }
    while (Object.keys(state.pending).length > MAX_DEADLINE_RECORDS) {
      const oldest = Object.values(state.pending).sort((a, b) => (a.at || 0) - (b.at || 0))[0]
      if (oldest === undefined) break
      delete state.pending[oldest.id]
    }
  }

  async add(record) {
    return this.mutate((next) => {
      const clean = cleanRecord(record)
      if (clean === undefined) return false
      next.pending[clean.id] = clean
      this.prune(next)
      return true
    })
  }

  async remove(id) {
    return this.mutate((next) => {
      if (next.pending[id] === undefined) return 0
      delete next.pending[id]
      return 1
    })
  }

  /**
   * 对方回消息 / 回汇报：清掉「from → to」方向还没回执的通知。
   * 返回清掉的条数；没有匹配时不写文件。
   */
  async ackExchange({ from, to } = {}) {
    await this.load()
    const ids = Object.values(this.state.pending)
      .filter((record) => record.from === from && record.to === to)
      .map((record) => record.id)
    if (ids.length === 0) return 0
    return this.mutate((next) => {
      let removed = 0
      for (const id of ids) if (next.pending[id] !== undefined) { delete next.pending[id]; removed += 1 }
      return removed
    })
  }

  async get(id) {
    await this.load()
    return this.state.pending[id]
  }

  /** 原子取走一条：只有拿到的一方能发回执，避免事件与轮询重复。 */
  async take(id) {
    return this.mutate((next) => {
      const record = next.pending[id]
      if (record === undefined) return undefined
      delete next.pending[id]
      return record
    })
  }

  async markReminded(id, at = this.now()) {
    return this.mutate((next) => {
      const record = next.pending[id]
      if (record === undefined) return false
      record.remindedAt = at
      return true
    })
  }

  async due(at = this.now()) {
    await this.load()
    return Object.values(this.state.pending).filter((record) => record.receiptOnly !== true && record.remindedAt === undefined && record.deadlineAt <= at)
  }

  async all() {
    await this.load()
    return Object.values(this.state.pending)
  }

  async pendingFor(from) {
    await this.load()
    return Object.values(this.state.pending).filter((record) => record.from === from)
  }

  async mutate(fn) {
    const run = this.chain.then(async () => {
      await this.load()
      const next = { version: DEADLINE_VERSION, pending: { ...this.state.pending } }
      const result = fn(next)
      this.state = next
      await this.save()
      return result
    })
    this.chain = run.catch(() => {})
    return run
  }
}
