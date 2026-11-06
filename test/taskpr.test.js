/** 任务 PR 只读关联：解析、探测汇总、失败 unknown、展示文案。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRelayCommand } from '../lib/core.js'
import {
  PR_STATUS_TTL_MS, describePrDetail, mergeProbe, parsePullRef, prLabel, prLine, probePull, summarizeChecks, summarizePr
} from '../lib/taskpr.js'

const prJson = (over = {}) => JSON.stringify({
  url: 'https://github.com/o/r/pull/7',
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: 'REVIEW_REQUIRED',
  mergedAt: null,
  headRefOid: 'abcdef1234567890',
  baseRefName: 'main',
  statusCheckRollup: [
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null },
    { __typename: 'StatusContext', state: 'SUCCESS' }
  ],
  ...over
})

test('解析：PR 号 / URL / owner/repo#号；别的东西明确报错', () => {
  assert.deepEqual(parsePullRef('123'), { number: 123 })
  assert.deepEqual(parsePullRef('#123'), { number: 123 })
  assert.deepEqual(parsePullRef('https://github.com/o/r/pull/7'), { number: 7, repo: 'o/r' })
  assert.deepEqual(parsePullRef('https://github.com/o/r/pulls/7/'), { number: 7, repo: 'o/r' })
  assert.deepEqual(parsePullRef('https://github.com/o/r/pull/7?diff=split'), { number: 7, repo: 'o/r' })
  assert.deepEqual(parsePullRef('o/r#7'), { number: 7, repo: 'o/r' })
  for (const bad of ['', 'abc', 'https://gitlab.com/o/r/pull/7', '0', '-1', 'https://github.com/o/r/issues/7']) {
    assert.throws(() => parsePullRef(bad), /PR 只认号/)
  }
  assert.equal(PR_STATUS_TTL_MS, 120_000)
})

test('命令解析：/relay task pr 关联 / 查看 / refresh / clear', () => {
  assert.deepEqual(parseRelayCommand('task pr T1 123'), { kind: 'task-pr', id: 'T1', target: '123' })
  assert.deepEqual(parseRelayCommand('task pr t1 https://github.com/o/r/pull/7'), { kind: 'task-pr', id: 'T1', target: 'https://github.com/o/r/pull/7' })
  assert.deepEqual(parseRelayCommand('task pr T1'), { kind: 'task-pr', id: 'T1', show: true })
  assert.deepEqual(parseRelayCommand('task pr T1 refresh'), { kind: 'task-pr', id: 'T1', refresh: true })
  assert.deepEqual(parseRelayCommand('task pr T1 clear'), { kind: 'task-pr', id: 'T1', clear: true })
  assert.equal(parseRelayCommand('task pr').kind, 'invalid')
  assert.equal(parseRelayCommand('task pr T1 a b').kind, 'invalid')
})

test('check 汇总：CheckRun / StatusContext 分开算，未知状态按进行中', () => {
  assert.deepEqual(summarizeChecks([]), { total: 0, passing: 0, pending: 0, failing: 0, state: 'none' })
  assert.deepEqual(summarizeChecks([
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'StatusContext', state: 'PENDING' },
    { __typename: 'StatusContext', state: 'ERROR' }
  ]), { total: 5, passing: 2, pending: 1, failing: 2, state: 'fail' })
})

test('探测：gh pr view 只读一次，成功给状态、失败给 unknown，不抛', async () => {
  const calls = []
  const probe = await probePull('o/r', 7, {
    now: () => 1000,
    gh: async (args) => { calls.push(args); return { stdout: prJson() } }
  })
  assert.deepEqual(calls[0], ['pr', 'view', '7', '--repo', 'o/r', '--json', 'url,state,isDraft,mergeable,reviewDecision,statusCheckRollup,mergedAt,headRefOid,baseRefName'])
  assert.equal(probe.source, 'ok')
  assert.equal(probe.probedAt, 1000)
  assert.equal(probe.status.state, 'OPEN')
  assert.equal(probe.status.mergeable, 'MERGEABLE')
  assert.equal(probe.status.reviewDecision, 'REVIEW_REQUIRED')
  assert.deepEqual(probe.status.checks, { total: 3, passing: 2, pending: 1, failing: 0, state: 'pending' })
  assert.equal(probe.status.headSha, 'abcdef1234567890')

  const failed = await probePull('o/r', 7, {
    now: () => 2000,
    gh: async () => { const error = new Error('boom'); error.stderr = 'HTTP 404: Not Found\n'; throw error }
  })
  assert.equal(failed.source, 'unknown')
  assert.equal(failed.error, 'HTTP 404: Not Found')

  const badJson = await probePull('o/r', 7, { now: () => 3000, gh: async () => ({ stdout: 'not json' }) })
  assert.equal(badJson.source, 'unknown')
  assert.match(badJson.error, /JSON/)
})

test('合并探测结果：失败保留上次状态但标 unknown，成功清掉旧错误', () => {
  const linked = { number: 7, url: 'https://github.com/o/r/pull/7', repo: 'o/r', addedAt: 1, addedBy: 'session-x' }
  const ok = mergeProbe(linked, { source: 'ok', probedAt: 10, status: { state: 'OPEN', mergeable: 'MERGEABLE', reviewDecision: '', checks: { total: 0, passing: 0, pending: 0, failing: 0, state: 'none' } } })
  assert.equal(ok.source, 'ok')
  assert.equal(ok.status.state, 'OPEN')
  const failed = mergeProbe({ ...ok, error: 'old' }, { source: 'unknown', probedAt: 20, error: 'HTTP 500' })
  assert.equal(failed.source, 'unknown')
  assert.equal(failed.error, 'HTTP 500')
  assert.equal(failed.status.state, 'OPEN', '失败不丢上次状态')
  const recovered = mergeProbe(failed, { source: 'ok', probedAt: 30, status: { ...ok.status, state: 'MERGED' } })
  assert.equal(recovered.error, undefined, '成功后清掉旧错误')
  assert.equal(recovered.status.state, 'MERGED')
})

test('展示：一行文案、结构化摘要、详情里失败给原因和上次缓存', () => {
  const status = {
    state: 'OPEN', draft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED',
    checks: { total: 2, passing: 2, pending: 0, failing: 0, state: 'pass' }
  }
  const pr = { number: 7, url: 'https://github.com/o/r/pull/7', repo: 'o/r', source: 'ok', probedAt: 1_700_000_000_000, status }
  assert.equal(prLabel(pr), 'PR #7 · OPEN · 可合并 · 审批通过 · checks 2/2 通过')
  assert.match(prLine(pr), /https:\/\/github\.com\/o\/r\/pull\/7$/)
  assert.deepEqual(summarizePr(pr), { number: 7, url: 'https://github.com/o/r/pull/7', repo: 'o/r', source: 'ok', label: 'PR #7 · OPEN · 可合并 · 审批通过 · checks 2/2 通过' })
  assert.equal(summarizePr(undefined), undefined)
  assert.equal(prLabel(undefined), '')
  const conflict = prLabel({ ...pr, status: { ...status, mergeable: 'CONFLICTING', reviewDecision: 'CHANGES_REQUESTED', checks: { total: 3, passing: 1, pending: 0, failing: 2, state: 'fail' } } })
  assert.match(conflict, /有冲突/)
  assert.match(conflict, /要求修改/)
  assert.match(conflict, /失败 2/)
  const merged = prLabel({ ...pr, status: { ...status, state: 'MERGED', mergedAt: '2026-11-06T00:00:00Z' } })
  assert.match(merged, /已合并/)

  const detail = describePrDetail(pr)
  assert.match(detail, /PR #7（o\/r）/)
  assert.match(detail, /状态：OPEN · 可合并 · 审批通过 · checks 2\/2 通过/)
  assert.match(detail, /只读探测|不代开 PR/)
  const unknown = describePrDetail({ ...pr, source: 'unknown', error: 'HTTP 500', probedAt: 2 })
  assert.match(unknown, /状态：未知（HTTP 500）/)
  assert.match(unknown, /上次缓存：OPEN · 可合并 · 审批通过/)
  assert.match(unknown, /refresh 重试/)
})
