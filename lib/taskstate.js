/**
 * 任务本地状态（2.0.0 R0）：stage（流程阶段）+ approval（审批门）。
 *
 * - 与看板表格/claims 分离，存插件任务库旁的 state.json；表格只表达认领/执行事实。
 * - stage：triage / ready / doing / review / hold / dropped；doing 由认领自动置，
 *   其它只由用户命令或主会话（有特权时）改；review 由用户/主会话确认。
 * - approval：pending / approved / rejected；只能由用户命令（/relay task approve）记录，
 *   模型没有审批工具。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { RelayError } from './core.js'

export const STAGES = Object.freeze(['triage', 'ready', 'doing', 'review', 'hold', 'dropped'])
export const STAGE_LABEL = Object.freeze({
  triage: '待分诊',
  ready: '可认领',
  doing: '进行中',
  review: '待审查',
  hold: '暂停',
  dropped: '不做'
})
export const APPROVALS = Object.freeze(['pending', 'approved', 'rejected'])
export const APPROVAL_LABEL = Object.freeze({
  pending: '待审批',
  approved: '已审批',
  rejected: '已打回'
})

export function normalizeStage(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === '') return undefined
  if (!STAGES.includes(text)) throw new RelayError(`未知阶段 ${value}；可选：${STAGES.join(' / ')}`, 'bad_stage')
  return text
}

export function normalizeApproval(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === '') return undefined
  if (!APPROVALS.includes(text)) throw new RelayError(`未知审批状态 ${value}；可选：${APPROVALS.join(' / ')}`, 'bad_approval')
  return text
}

export class TaskState {
  constructor(storeRoot) {
    this.path = join(storeRoot, 'state.json')
    this.state = { version: 1, tasks: {} }
    this.loaded = false
    this.chain = Promise.resolve()
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && parsed.tasks !== null && typeof parsed.tasks === 'object') {
        this.state = { version: 1, tasks: { ...parsed.tasks } }
      }
    } catch { /* 文件不存在或损坏：从空状态开始 */ }
    this.loaded = true
    return this.state
  }

  get(id) {
    return this.state.tasks[id] ?? {}
  }

  entries() {
    return Object.entries(this.state.tasks)
  }

  async mutate(fn) {
    const runIt = this.chain.then(async () => {
      if (!this.loaded) await this.load()
      const next = { version: 1, tasks: { ...this.state.tasks } }
      const result = fn(next)
      await mkdir(dirname(this.path), { recursive: true }).catch(() => {})
      const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`
      await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
      await rename(tmp, this.path)
      this.state = next
      return result
    })
    this.chain = runIt.catch(() => {})
    return runIt
  }

  /** 改一条：patch 里 value=null/'' 表示删字段；所有字段都空时删掉这条。 */
  async set(id, patch) {
    const taskId = String(id ?? '').trim().toUpperCase()
    if (taskId === '') throw new RelayError('需要任务号', 'bad_task_id')
    return this.mutate((next) => {
      const before = { ...(next.tasks[taskId] ?? {}) }
      const after = { ...before }
      for (const [key, value] of Object.entries(patch ?? {})) {
        if (value === null || value === undefined || value === '') delete after[key]
        else after[key] = value
      }
      if (Object.keys(after).length === 0) delete next.tasks[taskId]
      else next.tasks[taskId] = after
      return { before, after }
    })
  }
}
