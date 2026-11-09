/** 侧栏 PR / 问题 / 分支：Relay 层聚合、工作区路径与用户写动作门槛。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionRelay } from '../lib/impl.js'

const run = (args) => new Promise((resolve) => execFile('git', args, (error) => resolve(error ?? null)))

async function makeRepo(root, name) {
  const dir = join(root, name)
  await run(['init', '-q', dir])
  await run(['-C', dir, 'remote', 'add', 'origin', `https://github.com/o/${name}.git`])
  return dir
}

async function makeRelay({ lists, workspaces }) {
  const dir = await mkdtemp(join(tmpdir(), 'relay-lists-'))
  const relay = new SessionRelay(
    { logger: { warn() {} }, get: () => undefined, sessions: { get: () => undefined }, workspaceRegistry: { list: () => workspaces } },
    {
      aliasPath: join(dir, 'a.json'), statePath: join(dir, 'c.json'), templatePath: join(dir, 't.json'),
      handoffPath: join(dir, 'h.json'), watchPath: join(dir, 'w.json'), watch: false, githubAuto: false,
      repoWatchTickMs: 0, deadlineTickMs: 0, githubLists: lists
    }
  )
  await relay.ready()
  return { dir, relay, cleanup: async () => { await relay.away.chain.catch(() => {}); await rm(dir, { recursive: true, force: true }) } }
}

test('侧栏列表：PR / 问题按当前工作区仓库取，状态透传', async () => {
  const base = await mkdtemp(join(tmpdir(), 'relay-ws-'))
  const repo = await makeRepo(base, 'project')
  const calls = []
  const lists = {
    pullRequests: async (name, opts) => { calls.push(['pr', name, opts]); return { repo: name, state: opts?.state ?? 'open', items: [{ number: 7 }], fetchedAt: 1 } },
    issues: async (name) => { calls.push(['issue', name]); return { repo: name, items: [{ number: 9 }], fetchedAt: 1 } },
    branches: async () => ({ local: [], remote: [], current: null, defaultBranch: null })
  }
  const workspaces = [{ id: 'ws1', title: '项目', path: repo, sessionIds: ['s1'] }]
  const h = await makeRelay({ lists, workspaces })
  try {
    const prs = await h.relay.prListView({ fromSession: 's1' })
    assert.equal(prs.repo, 'o/project')
    assert.equal(prs.items.length, 1)
    assert.equal(prs.items[0].number, 7)
    assert.equal(prs.items[0].review.state, 'unreviewed', '没有 GitHub 字段时保守显示未审核')
    assert.equal(prs.reviewOrder[0], 'merged', '11 态顺序跟优先级链一致')
    assert.equal(prs.reviewOrder.at(-1), 'unreviewed')
    const closed = await h.relay.prListView({ fromSession: 's1', state: 'closed', force: true })
    assert.equal(closed.state, 'closed')
    assert.deepEqual(calls, [['pr', 'o/project', { force: false, state: 'open' }], ['pr', 'o/project', { force: true, state: 'closed' }]])
    const issues = await h.relay.issueListView({ fromSession: 's1' })
    assert.deepEqual(issues.items, [{ number: 9 }])
    assert.equal(calls.at(-1)[0], 'issue')
  } finally { await h.cleanup(); await rm(base, { recursive: true, force: true }) }
})

test('PR 详情：按当前工作区仓库与 PR 号取，非法编号拒绝', async () => {
  const base = await mkdtemp(join(tmpdir(), 'relay-ws-detail-'))
  const repo = await makeRepo(base, 'detail')
  const calls = []
  const lists = {
    pullRequests: async () => ({ items: [] }), issues: async () => ({ items: [] }), branches: async () => ({ local: [], remote: [] }),
    pullRequestDetail: async (name, number) => { calls.push([name, number]); return { repo: name, detail: { number, reviews: [], comments: [] } } }
  }
  const h = await makeRelay({ lists, workspaces: [{ id: 'ws1', title: '项目', path: repo, sessionIds: ['s1'] }] })
  try {
    const view = await h.relay.prDetailView({ fromSession: 's1', number: 7 })
    assert.equal(view.detail.number, 7)
    assert.deepEqual(calls, [['o/detail', 7]])
    await assert.rejects(() => h.relay.prDetailView({ fromSession: 's1', number: 0 }), /正整数/)
  } finally { await h.cleanup(); await rm(base, { recursive: true, force: true }) }
})

test('侧栏列表：无工作区路径 / 无 GitHub origin 给空态而不是抛错', async () => {
  const lists = { pullRequests: async () => ({ items: [] }), issues: async () => ({ items: [] }), branches: async () => ({ local: [], remote: [] }) }
  const h = await makeRelay({ lists, workspaces: [] })
  try {
    await assert.rejects(() => h.relay.prListView({ fromSession: 's1' }), /没有路径|登记工作区/)
    assert.deepEqual((await h.relay.branchListView()).workspaces, [])
  } finally { await h.cleanup() }
})

test('侧栏分支：聚合全部登记工作区；单工作区失败不影响别的', async () => {
  const base = await mkdtemp(join(tmpdir(), 'relay-ws2-'))
  const one = await makeRepo(base, 'one')
  const two = join(base, 'not-a-repo')
  const calls = []
  const lists = {
    branches: async (path) => {
      calls.push(path)
      if (path === two) throw new Error('fatal: not a git repository')
      return { path, current: 'main', defaultBranch: 'main', local: [{ name: 'main' }], remote: [{ name: 'main' }], fetchedAt: 1 }
    }
  }
  const workspaces = [
    { id: 'ws2', title: '乙', path: two, sessionIds: ['s2'] },
    { id: 'ws1', title: '甲', path: one, sessionIds: ['s1'] }
  ]
  const h = await makeRelay({ lists, workspaces })
  try {
    const view = await h.relay.branchListView()
    assert.deepEqual(calls, [two, one])
    assert.equal(view.skipped, 1, '非 git 工作区被跳过')
    assert.deepEqual(view.workspaces.map((row) => row.workspace.title), ['甲'], '只列 git 工作区')
    assert.equal(view.workspaces[0].current, 'main')
    assert.deepEqual(view.workspaces[0].local, [{ name: 'main' }])
    assert.equal(view.workspaces[0].error, null)
  } finally { await h.cleanup(); await rm(base, { recursive: true, force: true }) }
})

test('遗留清理视图：聚合各工作区的工作树分支并给出可清理计数', async () => {
  const base = await mkdtemp(join(tmpdir(), 'relay-ws-cleanup-'))
  const one = await makeRepo(base, 'one')
  const two = await makeRepo(base, 'two')
  const calls = []
  const lists = {
    worktreeBranches: async (path) => {
      calls.push(path)
      return {
        path, defaultBranch: 'main', current: 'main',
        branches: path === one
          ? [{ name: 'wt/a', worktree: join(one, '.agents/worktrees/a'), merged: true, clean: true, declaration: 'done', cleanable: true, reason: null }]
          : [{ name: 'wt/b', worktree: join(two, '.agents/worktrees/b'), merged: false, clean: false, declaration: 'none', cleanable: false, reason: '工作树有未提交改动' }]
      }
    }
  }
  const workspaces = [
    { id: 'ws2', title: 'B', path: two, sessionIds: ['s2'] },
    { id: 'ws1', title: 'A', path: one, sessionIds: ['s1'] }
  ]
  const h = await makeRelay({ lists, workspaces })
  try {
    const view = await h.relay.branchCleanupView()
    assert.deepEqual(calls, [two, one])
    assert.equal(view.total, 2)
    assert.equal(view.cleanable, 1)
    assert.deepEqual(view.workspaces.map((row) => row.workspace.title), ['A', 'B'])
    assert.equal(view.workspaces[0].branches[0].name, 'wt/a')
  } finally { await h.cleanup(); await rm(base, { recursive: true, force: true }) }
})

test('遗留清理动作：必须用户点击 + 二次确认；按工作区分组、逐条回传结果', async () => {
  const base = await mkdtemp(join(tmpdir(), 'relay-ws-cleanup-run-'))
  const one = await makeRepo(base, 'one')
  const two = await makeRepo(base, 'two')
  const written = []
  const lists = {
    cleanupWorktreeBranches: async ({ path, names }) => {
      written.push([path, names])
      const results = names.map((name) => name === 'wt/bad' ? { name, ok: false, reason: '工作树有未提交改动' } : { name, ok: true })
      return { results, removed: results.filter((row) => row.ok === true).length, skipped: results.filter((row) => row.ok !== true).length }
    }
  }
  const workspaces = [
    { id: 'ws1', title: '甲', path: one, sessionIds: ['s1'] },
    { id: 'ws2', title: '乙', path: two, sessionIds: ['s2'] }
  ]
  const h = await makeRelay({ lists, workspaces })
  try {
    const items = [
      { workspaceId: 'ws1', name: 'wt/a' },
      { workspaceId: 'ws1', name: 'wt/bad' },
      { workspaceId: 'ws1', name: 'wt/a' },
      { workspaceId: 'ws2', name: 'wt/c' }
    ]
    await assert.rejects(() => h.relay.cleanupBranches({ items, confirm: true }), /只能由用户/)
    await assert.rejects(() => h.relay.cleanupBranches({ items, user: true }), /二次确认/)
    await assert.rejects(() => h.relay.cleanupBranches({ items: [], confirm: true, user: true }), /先选/)
    const done = await h.relay.cleanupBranches({ items, confirm: true, user: true })
    assert.deepEqual(written, [[one, ['wt/a', 'wt/bad']], [two, ['wt/c']]])
    assert.equal(done.removed, 2)
    assert.equal(done.skipped, 1)
    assert.equal(done.results.find((row) => row.name === 'wt/bad').reason, '工作树有未提交改动')
    assert.ok(done.results.every((row) => typeof row.workspaceId === 'string'))
  } finally { await h.cleanup(); await rm(base, { recursive: true, force: true }) }
})

test('页签计数：当前工作区 PR / 问题数量 + 邮箱未读', async () => {
  const base = await mkdtemp(join(tmpdir(), 'relay-ws-counts-'))
  const repo = await makeRepo(base, 'counts')
  const lists = {
    pullRequests: async () => ({ items: [{ number: 1 }, { number: 2 }] }),
    issues: async () => ({ items: [{ number: 3 }] }),
    branches: async () => ({ local: [], remote: [] })
  }
  const h = await makeRelay({ lists, workspaces: [{ id: 'ws1', title: '项目', path: repo, sessionIds: ['s1'] }] })
  try {
    h.relay.mailView = async () => ({ mailbox: { unread: 3 }, items: [] })
    assert.deepEqual(await h.relay.railCounts({ fromSession: 's1' }), { prs: 2, issues: 1, mail: 3 })
  } finally { await h.cleanup(); await rm(base, { recursive: true, force: true }) }
})

test('用户写动作：PR 与分支删除必须 user=true，工作区路径来自登记', async () => {
  const base = await mkdtemp(join(tmpdir(), 'relay-ws3-'))
  const repo = await makeRepo(base, 'repo')
  const written = []
  const lists = {
    pullRequests: async () => ({ items: [] }),
    issues: async () => ({ items: [] }),
    branches: async () => ({ local: [], remote: [], current: 'main', defaultBranch: 'main' }),
    prAction: async (name, number, action, opts) => { written.push(['pr', name, number, action, opts]); return { ok: true } },
    deleteBranch: async (opts) => { written.push(['delete', opts]); return { ok: true } },
    fetch: async (path) => { written.push(['fetch', path]); return { ok: true } }
  }
  const workspaces = [{ id: 'ws1', title: '项目', path: repo, sessionIds: ['s1'] }]
  const h = await makeRelay({ lists, workspaces })
  try {
    await assert.rejects(() => h.relay.prAction({ action: 'approve', number: 7, fromSession: 's1' }), /只能由用户/)
    await assert.rejects(() => h.relay.branchAction({ action: 'delete', workspaceId: 'ws1', name: 'fix/x', fromSession: 's1' }), /只能由用户/)
    await h.relay.prAction({ action: 'approve', number: 7, fromSession: 's1', user: true })
    assert.deepEqual(written[0], ['pr', 'o/repo', 7, 'approve', { body: undefined }])
    await h.relay.branchAction({ action: 'delete', workspaceId: 'ws1', name: 'fix/x', remote: true, confirm: 'fix/x', user: true, fromSession: 's1' })
    assert.deepEqual(written[1], ['delete', { path: repo, name: 'fix/x', remote: true, force: false, confirm: 'fix/x' }])
    await h.relay.branchAction({ action: 'fetch', workspaceId: 'ws1', user: true, fromSession: 's1' })
    assert.deepEqual(written[2], ['fetch', repo])
    await assert.rejects(() => h.relay.branchAction({ action: 'delete', workspaceId: 'nope', name: 'x', user: true }), /不在侧栏登记/)
  } finally { await h.cleanup(); await rm(base, { recursive: true, force: true }) }
})

test('PR 审核 11 态：列表 / 详情接入本地记录、忽略拒绝与 AI 会话；记录结论要当前 head 并写审计', async () => {
  const base = await mkdtemp(join(tmpdir(), 'relay-ws-review-'))
  const repo = await makeRepo(base, 'review')
  const head1 = 'aaaaaaaa1111bbbbbbbb2222cccccccc3333dddddddd'
  const item = {
    number: 7, title: 'x', author: 'alice', url: 'https://github.com/o/review/pull/7', state: 'OPEN', draft: false,
    merged: false, mergeStateStatus: 'BLOCKED', mergeable: 'UNKNOWN', reviewDecision: 'REVIEW_REQUIRED',
    reviewRequests: [], latestReviews: [], checks: { total: 0, passing: 0, pending: 0, failing: 0, state: 'none' },
    headSha: head1, head: 'fix/x', base: 'main', updatedAt: '2026-11-09T00:00:00Z', comments: 0, additions: 1, deletions: 1, changedFiles: 1
  }
  const lists = {
    pullRequests: async () => ({ repo: 'o/review', state: 'open', items: [item], fetchedAt: 1 }),
    pullRequestDetail: async () => ({ repo: 'o/review', detail: { ...item, reviews: [], comments: [], files: [] }, fetchedAt: 1 }),
    issues: async () => ({ items: [] }),
    branches: async () => ({ local: [], remote: [] })
  }
  const h = await makeRelay({ lists, workspaces: [{ id: 'ws1', title: '项目', path: repo, sessionIds: ['s1'] }] })
  try {
    // 未审核：没有记录 / 标记
    let view = await h.relay.prListView({ fromSession: 's1' })
    assert.equal(view.items[0].review.state, 'unreviewed')
    assert.deepEqual(view.reviewOrder.slice(0, 3), ['merged', 'rejected', 'closed'])
    // 忽略 / 拒绝：只写本地，可取消
    await assert.rejects(() => h.relay.prFlag({ fromSession: 's1', number: 7, flag: 'ignored', on: true }), /只能由用户/)
    await h.relay.prFlag({ fromSession: 's1', number: 7, flag: 'ignored', on: true, user: true })
    view = await h.relay.prListView({ fromSession: 's1' })
    assert.equal(view.items[0].review.state, 'ignored')
    const rejected = await h.relay.prFlag({ fromSession: 's1', number: 7, flag: 'rejected', on: true, user: true })
    assert.deepEqual(rejected.flags, { ignored: true, rejected: true })
    await h.relay.prFlag({ fromSession: 's1', number: 7, flag: 'rejected', on: false, user: true })
    await h.relay.prFlag({ fromSession: 's1', number: 7, flag: 'ignored', on: false, user: true })
    // AI 审核会话 → 审批中
    await h.relay.prReviews.setAiReview('o/review', 7, { sessionId: 'session-ai', headSha: head1, at: Date.now() })
    view = await h.relay.prListView({ fromSession: 's1' })
    assert.equal(view.items[0].review.state, 'reviewing')
    assert.equal(view.items[0].local.aiReview.sessionId, 'session-ai')
    // 记录结论：必须当前 head；AI 通过后状态变已审核（缺批准 / 不可合并）
    await assert.rejects(() => h.relay.prReviewRecord({ fromSession: 's1', number: 7, verdict: 'pass', source: 'ai' }), /只能由用户/)
    const done = await h.relay.prReviewRecord({ fromSession: 's1', number: 7, verdict: 'pass', source: 'ai', user: true })
    assert.equal(done.round, 1)
    assert.equal(done.record.headSha, head1)
    view = await h.relay.prListView({ fromSession: 's1' })
    assert.equal(view.items[0].review.state, 'reviewed', 'AI 通过但缺批准 / 不可合并 → 已审核')
    assert.equal(view.items[0].review.round, 1)
    const detail = await h.relay.prDetailView({ fromSession: 's1', number: 7 })
    assert.equal(detail.review.state, 'reviewed')
    assert.equal(detail.records.length, 1)
    assert.equal(detail.records[0].source, 'ai')
    assert.equal(detail.aiReview, null, '记录结论后清掉审批中标记')
    // 「必须修」要写说明；当前 head 的必须修 → 已驳回
    await assert.rejects(() => h.relay.prReviewRecord({ fromSession: 's1', number: 7, verdict: 'must-fix', source: 'ai', user: true }), /说明/)
    const must = await h.relay.prReviewRecord({ fromSession: 's1', number: 7, verdict: 'must-fix', note: '修边界', source: 'user', user: true })
    assert.equal(must.round, 2)
    view = await h.relay.prListView({ fromSession: 's1' })
    assert.equal(view.items[0].review.state, 'changes-requested')
    // head 变了 → 需再审（重新探测到的旧 head 不同）
    lists.pullRequestDetail = async () => ({ repo: 'o/review', detail: { ...item, headSha: 'ffffffff9999', reviews: [], comments: [], files: [] }, fetchedAt: 1 })
    view = await h.relay.prListView({ fromSession: 's1' })
    lists.pullRequests = async () => ({ repo: 'o/review', state: 'open', items: [{ ...item, headSha: 'ffffffff9999' }], fetchedAt: 2 })
    view = await h.relay.prListView({ fromSession: 's1', force: true })
    assert.equal(view.items[0].review.state, 'needs-rereview')
    // 审计：只写本机 JSONL，不写 GitHub
    const audit = await readFile(join(h.dir, 'pr-review-audit.jsonl'), 'utf8')
    for (const event of ['pr-review-record', 'pr-ignored', 'pr-unignored', 'pr-rejected']) assert.ok(audit.includes(event), '缺少审计 ' + event)
  } finally { await h.cleanup(); await rm(base, { recursive: true, force: true }) }
})
