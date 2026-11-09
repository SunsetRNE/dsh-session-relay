/** T16：PR 审核 11 态状态机 + 本地多轮记录 / 忽略拒绝标记。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_REVIEW_ROUNDS, PR_REVIEW_ORDER, PR_REVIEW_STATE, PrReviewStore,
  appendReviewRecord, normalizeReviewRecords, prReviewKey, prReviewState
} from '../lib/prreview.js'

const checksPass = { total: 2, passing: 2, pending: 0, failing: 0, state: 'pass' }
const checksPending = { total: 2, passing: 1, pending: 1, failing: 0, state: 'pending' }
const checksNone = { total: 0, passing: 0, pending: 0, failing: 0, state: 'none' }
const base = () => ({
  number: 7,
  state: 'OPEN',
  draft: false,
  merged: false,
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
  reviewDecision: '',
  reviewRequests: [],
  latestReviews: [],
  checks: checksPass,
  headSha: 'aaaaaaaa1111'
})
const record = (over = {}) => ({ headSha: 'aaaaaaaa1111', verdict: 'pass', source: 'ai', note: '', at: 1000, round: 1, ...over })
const stateOf = (pr, records = [], flags = {}) => prReviewState(pr, records, flags).state

test('11 态顺序 / 显示名 / 一句话原因齐全，优先级链与任务描述一致', () => {
  assert.deepEqual([...PR_REVIEW_ORDER], [
    'merged', 'rejected', 'closed', 'ignored', 'behind',
    'changes-requested', 'needs-rereview', 'reviewing', 'ready', 'reviewed', 'unreviewed'
  ])
  for (const key of PR_REVIEW_ORDER) {
    const meta = PR_REVIEW_STATE[key]
    assert.equal(typeof meta.label, 'string')
    assert.ok(meta.label.length > 0, key + ' 有显示名')
    assert.equal(typeof meta.hint, 'string')
    assert.ok(meta.hint.length > 0, key + ' 有一句话原因')
    assert.equal(typeof meta.tone, 'string', key + ' 有色调')
  }
  assert.equal(PR_REVIEW_STATE['changes-requested'].label, '已驳回')
  assert.equal(PR_REVIEW_STATE.ready.label, '待合并')
  assert.equal(PR_REVIEW_STATE.unreviewed.label, '未审核')
})

test('状态机：11 个状态都能到达', () => {
  assert.equal(stateOf({ ...base(), state: 'MERGED' }), 'merged')
  assert.equal(stateOf(base(), [], { rejected: true }), 'rejected')
  assert.equal(stateOf({ ...base(), state: 'CLOSED' }), 'closed')
  assert.equal(stateOf(base(), [], { ignored: true }), 'ignored')
  assert.equal(stateOf({ ...base(), mergeStateStatus: 'BEHIND' }), 'behind')
  assert.equal(stateOf({ ...base(), reviewDecision: 'CHANGES_REQUESTED' }), 'changes-requested')
  assert.equal(stateOf(base(), [record({ headSha: 'bbbbbbbb2222' })]), 'needs-rereview')
  assert.equal(stateOf(base(), [], { aiReviewRunning: true }), 'reviewing')
  assert.equal(stateOf({ ...base(), reviewDecision: 'APPROVED' }), 'ready')
  assert.equal(stateOf({ ...base(), reviewDecision: 'APPROVED', checks: checksPending }), 'reviewed')
  assert.equal(stateOf(base()), 'ready', '无必需审批 + 可合并 + 检查全绿 → 待合并（无需审核）')
  assert.equal(stateOf({ ...base(), mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }), 'unreviewed')
})

test('状态机：优先级链——终态 / 标记压过动作态', () => {
  // 已合并 > 已拒绝
  assert.equal(stateOf({ ...base(), state: 'MERGED' }, [], { rejected: true }), 'merged')
  // 已拒绝 > 已关闭
  assert.equal(stateOf({ ...base(), state: 'CLOSED' }, [], { rejected: true }), 'rejected')
  // 已关闭 > 已忽略
  assert.equal(stateOf({ ...base(), state: 'CLOSED' }, [], { ignored: true }), 'closed')
  // 已忽略 > 已落后
  assert.equal(stateOf({ ...base(), mergeStateStatus: 'BEHIND' }, [], { ignored: true }), 'ignored')
  // 已落后 > 已驳回
  assert.equal(stateOf({ ...base(), mergeStateStatus: 'BEHIND', reviewDecision: 'CHANGES_REQUESTED' }), 'behind')
  // 已驳回 > 需再审（当前 head 的必须修记录压过旧 head 记录）
  assert.equal(stateOf(base(), [record({ headSha: 'bbbbbbbb2222', verdict: 'must-fix' }), record({ headSha: 'aaaaaaaa1111', verdict: 'must-fix', at: 2000, round: 2 })]), 'changes-requested')
  // 需再审 > 审批中
  assert.equal(stateOf(base(), [record({ headSha: 'bbbbbbbb2222' })], { aiReviewRunning: true }), 'needs-rereview')
  // 审批中 > 待合并
  assert.equal(stateOf({ ...base(), reviewDecision: 'APPROVED' }, [], { aiReviewRunning: true }), 'reviewing')
  // 待合并 > 已审核：人工批准 + 检查未绿 → 已审核
  assert.equal(stateOf({ ...base(), reviewDecision: 'APPROVED', checks: checksPending }), 'reviewed')
  // 已审核 > 未审核：AI 通过但缺批准 / 不可合并
  assert.equal(stateOf({ ...base(), mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }, [record()]), 'reviewed')
})

test('边界：草稿 / 无检查 / 未知 / stale / AI 通过但未批准 / 进行中 review request', () => {
  // 草稿不参与合并判定
  assert.equal(stateOf({ ...base(), draft: true, reviewDecision: 'APPROVED' }), 'unreviewed')
  assert.match(prReviewState({ ...base(), draft: true }, [], {}).reason, /草稿/)
  // 无检查 = 视为全绿（不等于未知）
  assert.equal(stateOf({ ...base(), reviewDecision: 'APPROVED', checks: checksNone }), 'ready')
  assert.equal(stateOf({ ...base(), reviewDecision: 'APPROVED', checks: undefined }), 'reviewed', '检查未知不算全绿')
  // 未知：没有任何 GitHub 字段时保守给未审核 + unknown
  const unknown = prReviewState({ number: 7 }, [], {})
  assert.equal(unknown.state, 'unreviewed')
  assert.equal(unknown.unknown, true)
  assert.match(unknown.reason, /未知/)
  // stale：最后一次审核之后 head 变了
  const stale = prReviewState(base(), [record({ headSha: 'bbbbbbbb2222' })], {})
  assert.equal(stale.state, 'needs-rereview')
  assert.equal(stale.stale, true)
  assert.match(stale.reason, /aaaaaaa|bbbbbbb/)
  // AI 通过但人工未批准 / GitHub 阻塞 → 已审核
  const aiPass = prReviewState({ ...base(), mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }, [record()], { aiGate: true })
  assert.equal(aiPass.state, 'reviewed')
  assert.equal(aiPass.round, 1)
  // GitHub pending review request → 审批中
  assert.equal(stateOf({ ...base(), mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', reviewRequests: [{ login: 'bob' }] }), 'reviewing')
  // latestReviews 里的 PENDING 也算
  assert.equal(stateOf({ ...base(), mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED', latestReviews: [{ login: 'bob', state: 'PENDING' }] }), 'reviewing')
  // 当前 head 的必须修记录 → 已驳回（AI 门优先于人工批准）
  assert.equal(stateOf({ ...base(), reviewDecision: 'APPROVED' }, [record({ verdict: 'must-fix', note: '修边界' })]), 'changes-requested')
  const must = prReviewState(base(), [record({ verdict: 'must-fix', source: 'user', note: '修边界' })], {})
  assert.match(must.reason, /必须修/)
  assert.match(must.reason, /修边界/)
})

test('记录规范化：不合格结论丢弃、按时间排序、补轮次、只留最近 10 轮', () => {
  assert.deepEqual(normalizeReviewRecords([{ verdict: 'pass' }]), [], '缺 head 的记录丢弃')
  assert.deepEqual(normalizeReviewRecords([{ headSha: 'a', verdict: 'unknown', at: 1 }]), [], '不认识的结论丢弃')
  const many = Array.from({ length: 15 }, (_, index) => record({ at: 1000 + index, headSha: 'h' + index }))
  const kept = normalizeReviewRecords(many)
  assert.equal(kept.length, MAX_REVIEW_ROUNDS)
  assert.deepEqual(kept.map((item) => item.round), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15], '裁剪后保留真实轮次')
  assert.equal(kept[0].headSha, 'h5')
  const done = appendReviewRecord([], record({ at: 0 }))
  assert.equal(done.round, 1)
  const done2 = appendReviewRecord(done.records, record({ at: 10, headSha: 'b' }))
  assert.equal(done2.round, 2)
  assert.deepEqual(done2.records.map((item) => item.round), [1, 2])
})

test('存储：多轮记录 / 忽略拒绝开关 / AI 会话标记 / 重新加载后仍在', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-prreview-'))
  try {
    const path = join(dir, 'pr-reviews.json')
    const store = new PrReviewStore(path, { now: () => 5000 })
    await store.setAiReview('o/r', 7, { sessionId: 'session-ai', headSha: 'aaaa', at: 4000 })
    assert.equal(store.get('o/r', 7).aiReview.sessionId, 'session-ai')
    const first = await store.record('o/r', 7, { headSha: 'aaaa', verdict: 'must-fix', note: '先修', source: 'ai', sessionId: 'session-ai', at: 5000 })
    assert.equal(first.round, 1)
    await store.clearAiReview('o/r', 7, 'session-other')
    assert.equal(store.get('o/r', 7).aiReview.sessionId, 'session-ai', '会话 id 不同不清')
    await store.clearAiReview('o/r', 7, 'session-ai')
    assert.equal(store.get('o/r', 7).aiReview, null)
    const second = await store.record('o/r', 7, { headSha: 'bbbb', verdict: 'pass', note: '', source: 'user', at: 6000 })
    assert.equal(second.round, 2)
    await store.flag('o/r', 7, 'ignored', true)
    await store.flag('o/r', 7, 'rejected', true)
    assert.deepEqual(store.get('o/r', 7).flags, { ignored: true, rejected: true })
    await store.flag('o/r', 7, 'ignored', false)
    assert.equal(store.get('o/r', 7).flags.ignored, false)
    await store.flag('o/r', 7, 'rejected', false)
    assert.deepEqual(store.get('o/r', 7).flags, { ignored: false, rejected: false })
    await assert.rejects(() => store.flag('o/r', 7, 'weird', true), /ignored \/ rejected/)

    const raw = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(raw.version, 1)
    assert.equal(raw.prs['o/r#7'].records.length, 2)
    const again = new PrReviewStore(path)
    await again.load()
    assert.equal(again.get('o/r', 7).records.length, 2)
    assert.equal(again.get('o/r', 7).records[1].verdict, 'pass')
    assert.equal(prReviewKey('o/r', 7), 'o/r#7')
    assert.throws(() => prReviewKey('bad repo', 7), /owner\/repo/)
    assert.throws(() => prReviewKey('o/r', 0), /正整数/)
    // 清空记录 / 标记后条目删掉，不留空壳
    await store.flag('o/r', 7, 'ignored', false)
    assert.equal(store.get('o/r', 7).records.length, 2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('状态机用存储里的记录：head 变化自动需再审，记录结论后回到已审核 / 已驳回', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-prreview-flow-'))
  try {
    const store = new PrReviewStore(join(dir, 'pr-reviews.json'))
    const pr = { ...base(), mergeStateStatus: 'BLOCKED', reviewDecision: 'REVIEW_REQUIRED' }
    await store.record('o/r', 7, { headSha: pr.headSha, verdict: 'pass', source: 'ai', at: 1000 })
    const entry = store.get('o/r', 7)
    assert.equal(prReviewState(pr, entry.records, { ignored: entry.flags.ignored, rejected: entry.flags.rejected }).state, 'reviewed')
    const changed = { ...pr, headSha: 'cccccccc3333' }
    assert.equal(prReviewState(changed, entry.records, {}).state, 'needs-rereview')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
