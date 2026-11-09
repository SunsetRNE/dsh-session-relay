/**
 * PR 审核多状态（T16 / 2.4.4）。
 *
 * 三件事：
 * 1. 11 态纯函数 prReviewState(pr, records, flags)：只根据 GitHub 只读字段 + 本地审核记录 / 忽略拒绝标记判状态，不猜。
 * 2. 本地审核记录（多轮）：按 repo + PR 存 { headSha, verdict, note, source, at, round, sessionId }；
 *    head sha 一变，旧记录即 stale（需再审），只保留最近 MAX_REVIEW_ROUNDS 轮。
 * 3. 本地标记：忽略 / 拒绝只写插件存储 + 审计，不写 GitHub，可取消。
 *
 * 边界：本模块只读写本地文件；不跑 gh、不写 GitHub、不合并 / 不推送。
 * 优先级链（看板 / 面板图例 / 详情说明必须一致）：
 *   已合并 > 已拒绝 > 已关闭 > 已忽略 > 已落后 > 已驳回 > 需再审 > 审批中 > 待合并 > 已审核 > 未审核
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { RelayError } from './core.js'

/** 状态优先级：数组顺序即展示 / 计数顺序（终态 → 动作态）。 */
export const PR_REVIEW_ORDER = Object.freeze([
  'merged', 'rejected', 'closed', 'ignored', 'behind',
  'changes-requested', 'needs-rereview', 'reviewing', 'ready', 'reviewed', 'unreviewed'
])

/** 显示名、色调、一句话含义。tone 对应面板 CSS 的 data-tone。 */
export const PR_REVIEW_STATE = Object.freeze({
  merged: { label: '已合并', tone: 'merged', hint: 'PR 已合并（终态）；只读事实，不写 GitHub。' },
  rejected: { label: '已拒绝', tone: 'error', hint: '用户本地标记拒绝合入（终态）；可取消，不写 GitHub。' },
  closed: { label: '已关闭', tone: 'closed', hint: 'GitHub 已关闭且未合并。' },
  ignored: { label: '已忽略', tone: 'ignored', hint: '用户本地忽略（静音），不出现在需处理；可恢复。' },
  behind: { label: '已落后', tone: 'warn', hint: 'head 落后 base（mergeStateStatus=BEHIND），需要先更新分支。' },
  'changes-requested': { label: '已驳回', tone: 'error', hint: '当前 head 审核不通过：人工要求修改或 AI 结论「必须修」。' },
  'needs-rereview': { label: '需再审', tone: 'warn', hint: '最后一次审核之后 head 又变了（rebase / 新提交），旧审核失效。' },
  reviewing: { label: '审批中', tone: 'brand', hint: 'AI 审核会话运行中，或 GitHub 有 pending review request。' },
  ready: { label: '待合并', tone: 'ok', hint: '审批通过（或无需审核）+ 可合并 + 检查全绿 + AI 结论通过。' },
  reviewed: { label: '已审核', tone: 'reviewed', hint: '当前 head 已有人工 / AI 审核结论且无阻塞，但还没满足合并条件。' },
  unreviewed: { label: '未审核', tone: '', hint: 'open，无人工 review、无 AI 审核记录。' }
})

/** 本地审核记录最多保留的轮数。 */
export const MAX_REVIEW_ROUNDS = 10
/** 本地按 repo+PR 保存的条数上限；超过时丢最久没更新的。 */
export const MAX_REVIEW_PRS = 500
/** 一条 note 保留的上限。 */
export const MAX_REVIEW_NOTE = 1000

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const PR_STATES = new Set(['OPEN', 'CLOSED', 'MERGED'])
const MERGE_STATES = new Set(['BEHIND', 'BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'HAS_HOOKS', 'UNKNOWN', 'UNSTABLE'])
const DECISIONS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])
export const REVIEW_VERDICTS = Object.freeze(['pass', 'must-fix'])
export const REVIEW_SOURCES = Object.freeze(['ai', 'user'])

const SOURCE_LABEL = { ai: 'AI', user: '人工' }
const DECISION_LABEL = { APPROVED: '已批准', CHANGES_REQUESTED: '要求修改', REVIEW_REQUIRED: '待审批' }

/** AI 审核会话最后两行的机器可读结论标记（与 prReviewLaunchText 约定一致）。 */
export const AI_CONCLUSION_MARK = '【审核结论】'
export const AI_REASON_MARK = '【结论原因】'
const AI_CONCLUSION_RE = /【审核结论】\s*[:：]?\s*(pass|must-fix)\b/gi
const AI_REASON_RE = /【结论原因】\s*[:：]?\s*([^\r\n]*)/g

/**
 * 从审核会话文本里解析机器可读结论；只认最后出现的【审核结论】标记，解析不到返回 undefined（不猜）。
 * @returns {{ verdict: 'pass'|'must-fix', reason: string } | undefined}
 */
export function parseReviewConclusion(text) {
  const source = String(text ?? '')
  if (source === '') return undefined
  let verdict
  let verdictAt = -1
  for (const match of source.matchAll(AI_CONCLUSION_RE)) {
    verdict = String(match[1]).toLowerCase()
    verdictAt = Number(match.index) || 0
  }
  if (verdict === undefined) return undefined
  let reason = ''
  for (const match of source.matchAll(AI_REASON_RE)) {
    const at = Number(match.index) || 0
    if (at < verdictAt) continue
    reason = String(match[1] ?? '').trim()
  }
  return { verdict, reason: reason.slice(0, 200) }
}

function shortSha(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text === '' ? '' : text.slice(0, 7)
}

function clip(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length <= max ? value : value.slice(0, max - 1) + '…'
}

/** 规范一条本地审核记录；不认识的结论直接丢弃（不猜）。 */
export function normalizeReviewRecord(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const verdict = String(raw.verdict ?? '')
  if (!REVIEW_VERDICTS.includes(verdict)) return undefined
  const source = REVIEW_SOURCES.includes(String(raw.source ?? '')) ? String(raw.source) : 'user'
  const headSha = typeof raw.headSha === 'string' ? raw.headSha.trim() : ''
  if (headSha === '') return undefined
  const at = Number(raw.at)
  if (!Number.isFinite(at) || at <= 0) return undefined
  const round = Number(raw.round)
  return {
    headSha,
    verdict,
    source,
    note: typeof raw.note === 'string' ? raw.note.slice(0, MAX_REVIEW_NOTE) : '',
    at,
    round: Number.isSafeInteger(round) && round > 0 ? round : undefined,
    ...(typeof raw.sessionId === 'string' && raw.sessionId !== '' ? { sessionId: raw.sessionId } : {})
  }
}

/** 记录列表：按时间排、补轮次（保留已记的轮次，裁剪后第 k 轮仍是第 k 轮）、只留最近 MAX_REVIEW_ROUNDS 轮。 */
export function normalizeReviewRecords(raw) {
  const list = (Array.isArray(raw) ? raw : []).map(normalizeReviewRecord).filter(Boolean)
  list.sort((a, b) => a.at - b.at)
  let previous = 0
  for (const record of list) {
    const round = Number.isSafeInteger(record.round) && record.round > previous ? record.round : previous + 1
    record.round = round
    previous = round
  }
  return list.slice(-MAX_REVIEW_ROUNDS)
}

/**
 * 追加一轮审核结论；round 从 1 递增，head sha 由调用方保证是当前 head。
 * @returns {{ records: object[], record: object, round: number }}
 */
export function appendReviewRecord(records, raw, { now = Date.now() } = {}) {
  const list = normalizeReviewRecords(records)
  const normalized = normalizeReviewRecord({ ...raw, at: Number(raw?.at) > 0 ? raw.at : now })
  if (normalized === undefined) throw new RelayError('审核结论不完整（需要 head / 结论 / 时间）', 'bad_review_record')
  const round = (list.at(-1)?.round ?? 0) + 1
  const record = { ...normalized, round }
  list.push(record)
  return { records: list.slice(-MAX_REVIEW_ROUNDS), record, round }
}

/** 本地标记 / AI 审核会话记录；坏数据当没有。 */
export function normalizeLocalEntry(raw) {
  const row = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const ai = row.aiReview
  const aiReview = ai !== null && typeof ai === 'object' && typeof ai.sessionId === 'string' && ai.sessionId !== ''
    ? {
        sessionId: ai.sessionId,
        at: Number(ai.at) > 0 ? Number(ai.at) : undefined,
        ...(typeof ai.headSha === 'string' && ai.headSha !== '' ? { headSha: ai.headSha } : {}),
        ...(Number(ai.checkedAt) > 0 ? { checkedAt: Number(ai.checkedAt) } : {}),
        ...(ai.noVerdict === true ? { noVerdict: true } : {})
      }
    : null
  return {
    records: normalizeReviewRecords(row.records),
    flags: { ignored: row?.flags?.ignored === true, rejected: row?.flags?.rejected === true },
    aiReview
  }
}

function isChecks(value) {
  return value !== null && typeof value === 'object' && ['none', 'pending', 'pass', 'fail'].includes(String(value.state ?? ''))
}

function hasGithubData(pr) {
  if (pr === null || typeof pr !== 'object') return false
  return PR_STATES.has(String(pr.state ?? '')) || pr.merged !== undefined || pr.draft !== undefined ||
    pr.mergeStateStatus !== undefined || pr.reviewDecision !== undefined || pr.source !== undefined
}

/**
 * PR 审核状态纯函数。
 * @param {object} pr 列表 / 详情里归一化过的 PR：state / merged / draft / mergeStateStatus / mergeable /
 *   reviewDecision / reviewRequests / latestReviews / checks / headSha / source
 * @param {object[]} records 本地审核记录（旧 → 新）
 * @param {{ignored?: boolean, rejected?: boolean, aiReviewRunning?: boolean, aiGate?: boolean}} flags
 * @returns {{state: string, label: string, tone: string, hint: string, reason: string, priority: number,
 *   round: number, stale: boolean, headSha: string, unknown: boolean, draft: boolean, decision: string,
 *   mergeStateStatus: string, checks?: object, aiReviewRunning: boolean, record?: object}}
 */
export function prReviewState(pr, records = [], flags = {}) {
  const list = normalizeReviewRecords(records)
  const latest = list.at(-1)
  const raw = pr !== null && typeof pr === 'object' ? pr : {}
  const headSha = typeof raw.headSha === 'string' ? raw.headSha.trim() : ''
  const stale = latest !== undefined && headSha !== '' && typeof latest.headSha === 'string' && latest.headSha !== '' && latest.headSha !== headSha
  const round = latest?.round ?? 0
  const decision = DECISIONS.has(String(raw.reviewDecision ?? '')) ? String(raw.reviewDecision) : ''
  const mergeStateStatus = MERGE_STATES.has(String(raw.mergeStateStatus ?? '')) ? String(raw.mergeStateStatus) : 'UNKNOWN'
  const checks = isChecks(raw.checks) ? raw.checks : undefined
  const draft = raw.draft === true
  const reviewRequests = Array.isArray(raw.reviewRequests) ? raw.reviewRequests.filter((item) => item !== null && typeof item === 'object') : []
  const latestReviews = Array.isArray(raw.latestReviews) ? raw.latestReviews : []
  const pendingReviewRequest = reviewRequests.length > 0 || latestReviews.some((entry) => String(entry?.state ?? '').toUpperCase() === 'PENDING')
  const aiReviewRunning = flags.aiReviewRunning === true
  const aiGateEnabled = flags.aiGate === true || list.some((record) => record.source === 'ai')
  const unknown = !hasGithubData(raw)
  const merged = raw.state === 'MERGED' || raw.merged === true
  const closed = !merged && raw.state === 'CLOSED'
  const open = !merged && !closed && !unknown
  const checksTotal = checks === undefined ? 0 : Number(checks.total) || 0
  const checksOk = checks !== undefined && (checks.state === 'pass' || checks.state === 'none')
  const mergeable = raw.mergeable === 'MERGEABLE'
  const canMerge = mergeStateStatus === 'CLEAN' || (mergeStateStatus === 'UNKNOWN' && mergeable)
  const hasCurrentRecord = latest !== undefined && !stale
  const currentPass = hasCurrentRecord && latest.verdict === 'pass'
  const currentMustFix = hasCurrentRecord && latest.verdict === 'must-fix'
  const aiGateOk = !aiGateEnabled || currentPass
  const noReviewRequired = decision === '' && !pendingReviewRequest && mergeStateStatus === 'CLEAN'
  const approvalOk = decision === 'APPROVED' || noReviewRequired
  const reviewed = open && (decision === 'APPROVED' || currentPass)
  const sourceNote = latest !== undefined && latest.note !== '' ? `：${clip(latest.note, 60)}` : ''
  const mergeBlocker = mergeStateStatus === 'DIRTY' ? '有冲突' : mergeStateStatus === 'BLOCKED' ? 'GitHub 仍阻塞（可能缺必需审批 / 检查）'
    : checks === undefined ? '检查状态未知' : checks.state === 'pending' ? `检查进行中 ${Number(checks.pending) || 0}` : checks.state === 'fail' ? `检查失败 ${Number(checks.failing) || 0}` : ''

  const make = (state, reason, extra = {}) => {
    const meta = PR_REVIEW_STATE[state]
    return {
      state,
      label: meta.label,
      tone: meta.tone,
      hint: meta.hint,
      reason,
      priority: PR_REVIEW_ORDER.indexOf(state) + 1,
      round,
      stale,
      headSha,
      unknown,
      draft,
      decision,
      mergeStateStatus,
      ...(checks === undefined ? {} : { checks }),
      aiReviewRunning,
      ...(latest === undefined ? {} : { record: { ...latest } }),
      ...extra
    }
  }

  if (merged) return make('merged', `已合并${raw.mergedAt ? '（' + clip(raw.mergedAt, 19) + '）' : ''}`)
  if (flags.rejected === true) return make('rejected', '本地已标记拒绝合入（可取消，不写 GitHub）')
  if (closed) return make('closed', 'GitHub 已关闭且未合并')
  if (flags.ignored === true) return make('ignored', '本地已忽略（静音，可恢复）')
  if (mergeStateStatus === 'BEHIND') return make('behind', 'head 落后 base（BEHIND），需要先更新分支')
  if (decision === 'CHANGES_REQUESTED') return make('changes-requested', '人工评审要求修改（CHANGES_REQUESTED）')
  if (currentMustFix) return make('changes-requested', `第 ${round} 轮${SOURCE_LABEL[latest.source]}审核结论「必须修」${sourceNote}`)
  if (stale) return make('needs-rereview', `当前 head ${shortSha(headSha)} 在最后一次审核（${shortSha(latest.headSha)}）后变了，需要再审`)
  if (aiReviewRunning) return make('reviewing', 'AI 审核会话运行中')
  if (pendingReviewRequest) return make('reviewing', 'GitHub 有 pending review request')
  if (unknown) return make('unreviewed', 'PR 状态未知（只读查询没拿到数据）', { unknown: true })
  if (open && draft) return make('unreviewed', '草稿 PR，不参与合并状态')
  if (open && approvalOk && canMerge && checksOk && aiGateOk) {
    const how = decision === 'APPROVED' ? '已批准' : '无需必需审批'
    const checksText = checksTotal > 0 ? ` · checks ${Number(checks.passing) || 0}/${checksTotal} 通过` : ' · 无检查'
    return make('ready', `${how} · 可合并${checksText}${aiGateEnabled ? ' · AI 结论通过' : ''}`)
  }
  if (reviewed) {
    const how = decision === 'APPROVED' ? '人工已批准' : `第 ${round} 轮${SOURCE_LABEL[latest.source]}审核通过`
    const blockers = []
    if (!approvalOk) blockers.push('缺批准')
    if (!canMerge) blockers.push(mergeStateStatus === 'DIRTY' ? '有冲突' : '暂不可合并')
    if (!checksOk) blockers.push(mergeBlocker || '检查未全绿')
    if (!aiGateOk) blockers.push('AI 结论未通过')
    return make('reviewed', `${how}${blockers.length > 0 ? '；' + blockers.join(' / ') : ''}`)
  }
  const why = []
  if (draft) why.push('草稿')
  if (!approvalOk) why.push(decision === 'REVIEW_REQUIRED' ? '等待批准' : '缺批准')
  if (!canMerge) why.push(mergeBlocker || '暂不可合并')
  if (!checksOk) why.push(checks === undefined ? '检查状态未知' : mergeBlocker || '检查未全绿')
  if (!aiGateOk) why.push('AI 结论未通过')
  return make('unreviewed', why.length > 0 ? '没有人工评审或 AI 审核结论；' + why.join(' / ') : '没有人工评审或 AI 审核结论')
}

/** 预算本地条目的完整对象（给面板详情用）。 */
export function reviewEntryView(entry) {
  const local = normalizeLocalEntry(entry)
  return { records: local.records, flags: local.flags, aiReview: local.aiReview }
}

/** repo + PR 号 → 存储键；不合法直接报错。 */
export function prReviewKey(repo, number) {
  const clean = String(repo ?? '').trim()
  if (!REPO_RE.test(clean)) throw new RelayError('仓库名要写成 owner/repo', 'bad_repo')
  const n = Number(number)
  if (!Number.isSafeInteger(n) || n <= 0) throw new RelayError('PR 号要是正整数', 'bad_number')
  return `${clean}#${n}`
}

/**
 * 本地 PR 审核记录 / 标记存储：{ version: 1, prs: { "owner/repo#123": { records, flags, aiReview, updatedAt } } }。
 * 串行化读改写 + 原子替换；文件损坏时从空开始（不阻断面板）。
 */
export class PrReviewStore {
  constructor(path, { now = Date.now } = {}) {
    this.path = path
    this.now = now
    this.state = { version: 1, prs: {} }
    this.loaded = false
    this.chain = Promise.resolve()
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && parsed.prs !== null && typeof parsed.prs === 'object' && !Array.isArray(parsed.prs)) {
        const prs = {}
        for (const [key, value] of Object.entries(parsed.prs)) {
          if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+$/.test(key)) continue
          const entry = normalizeLocalEntry(value)
          if (entry.records.length === 0 && entry.aiReview === null && entry.flags.ignored !== true && entry.flags.rejected !== true) continue
          prs[key] = { ...entry, updatedAt: Number(value?.updatedAt) > 0 ? Number(value.updatedAt) : 0 }
        }
        this.state = { version: 1, prs }
      }
    } catch { /* 文件不存在或损坏：从空状态开始 */ }
    this.loaded = true
    return this.state
  }

  /** 确保已从磁盘读入（第一次读面板前 await 一次）。 */
  async ready() {
    if (!this.loaded) await this.load()
    return this.state
  }

  /** 读一条；返回规范化副本（没有则空记录）。调用方先 await ready()。 */
  get(repo, number) {
    const key = prReviewKey(repo, number)
    const row = this.state.prs[key]
    return { key, ...normalizeLocalEntry(row) }
  }

  /** 当前 head 的审核记录是否过期（面板可以提前提示）。 */
  stale(repo, number, headSha) {
    const entry = this.get(repo, number)
    const latest = entry.records.at(-1)
    return latest !== undefined && typeof headSha === 'string' && headSha !== '' && latest.headSha !== headSha
  }

  async mutate(fn) {
    const run = this.chain.then(async () => {
      if (!this.loaded) await this.load()
      const next = { version: 1, prs: { ...this.state.prs } }
      const result = fn(next)
      // 条数上限：按 updatedAt 丢最老的
      const keys = Object.keys(next.prs)
      if (keys.length > MAX_REVIEW_PRS) {
        keys.sort((a, b) => (Number(next.prs[a]?.updatedAt) || 0) - (Number(next.prs[b]?.updatedAt) || 0))
        for (const key of keys.slice(0, keys.length - MAX_REVIEW_PRS)) delete next.prs[key]
      }
      await mkdir(dirname(this.path), { recursive: true }).catch(() => {})
      const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`
      await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
      await rename(tmp, this.path)
      this.state = next
      return result
    })
    this.chain = run.catch(() => {})
    return run
  }

  /**
   * 追加一轮审核结论（head sha 用调用方探测到的当前 head）。
   * oncePerSession=true：同一 sessionId 已有记录就跳过（AI 自动回写的幂等保护，并发也安全）。
   */
  async record(repo, number, { headSha, verdict, note = '', source = 'user', sessionId, at = this.now(), oncePerSession = false } = {}) {
    const key = prReviewKey(repo, number)
    return this.mutate((next) => {
      const before = normalizeLocalEntry(next.prs[key])
      const existing = oncePerSession && typeof sessionId === 'string' && sessionId !== ''
        ? before.records.find((item) => item.sessionId === sessionId)
        : undefined
      if (existing !== undefined) return { key, records: before.records, record: existing, round: existing.round, skipped: true }
      const done = appendReviewRecord(before.records, { headSha, verdict, note, source, sessionId, at })
      next.prs[key] = { ...before, records: done.records, updatedAt: at }
      return { key, records: done.records, record: done.record, round: done.round, skipped: false }
    })
  }

  /** 设置 / 取消忽略、拒绝。 */
  async flag(repo, number, flag, on, { at = this.now() } = {}) {
    const key = prReviewKey(repo, number)
    if (flag !== 'ignored' && flag !== 'rejected') throw new RelayError('本地标记只有 ignored / rejected', 'bad_flag')
    return this.mutate((next) => {
      const before = normalizeLocalEntry(next.prs[key])
      const flags = { ...before.flags, [flag]: on === true }
      if (flags.ignored !== true && flags.rejected !== true && before.records.length === 0 && before.aiReview === null) delete next.prs[key]
      else next.prs[key] = { ...before, flags, updatedAt: at }
      return { key, ...before, flags }
    })
  }

  /** 记录 AI 审核会话（用于「审批中」和详情里打开会话）；已有则覆盖。 */
  async setAiReview(repo, number, { sessionId, headSha, at = this.now(), checkedAt, noVerdict } = {}) {
    const key = prReviewKey(repo, number)
    if (typeof sessionId !== 'string' || sessionId === '') throw new RelayError('需要审核会话 id', 'bad_session')
    return this.mutate((next) => {
      const before = normalizeLocalEntry(next.prs[key])
      const aiReview = {
        sessionId,
        at,
        ...(typeof headSha === 'string' && headSha !== '' ? { headSha } : {}),
        ...(Number(checkedAt) > 0 ? { checkedAt: Number(checkedAt) } : {}),
        ...(noVerdict === true ? { noVerdict: true } : {})
      }
      next.prs[key] = { ...before, aiReview, updatedAt: at }
      return { key, aiReview }
    })
  }

  /** 清掉 AI 审核会话标记；给了 sessionId 时只清同一条（避免误清新拉起的）。 */
  async clearAiReview(repo, number, sessionId, { at = this.now() } = {}) {
    const key = prReviewKey(repo, number)
    return this.mutate((next) => {
      const before = normalizeLocalEntry(next.prs[key])
      if (before.aiReview === null) return { key, cleared: false }
      if (typeof sessionId === 'string' && sessionId !== '' && before.aiReview.sessionId !== sessionId) return { key, cleared: false }
      const after = { ...before, aiReview: null }
      if (after.flags.ignored !== true && after.flags.rejected !== true && after.records.length === 0) delete next.prs[key]
      else next.prs[key] = { ...after, updatedAt: at }
      return { key, cleared: true }
    })
  }
}
