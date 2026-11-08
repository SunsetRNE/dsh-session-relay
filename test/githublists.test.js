import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GitHubLists, LIST_TTL_MS, assertBranchDeletable, commandError, parseDefaultBranch, parseIssues,
  parseLocalBranches, parsePullDetail, parsePullRequests, parseRemoteBranches, parseWorktrees, requireRepo, validateBranchName
} from '../lib/githublists.js'

test('PR / issue 列表解析：字段归一、排序不动、坏输出拒绝', () => {
  const prs = parsePullRequests(JSON.stringify([
    { number: 7, title: '修 bug', author: { login: 'alice' }, url: 'https://github.com/o/r/pull/7', isDraft: false, reviewDecision: 'CHANGES_REQUESTED', updatedAt: '2026-11-07T01:00:00Z', comments: 3, additions: 12, deletions: 3, changedFiles: 2, headRefName: 'fix/x', baseRefName: 'main' },
    { number: 8, title: '已合', mergedAt: '2026-11-07T02:00:00Z' },
    { number: 9, title: '有评论', comments: [{}, {}] },
    { number: 0, title: '坏条目' }
  ]))
  assert.equal(prs.length, 3)
  assert.deepEqual({ n: prs[0].number, r: prs[0].reviewDecision, a: prs[0].author, h: prs[0].head }, { n: 7, r: 'CHANGES_REQUESTED', a: 'alice', h: 'fix/x' })
  assert.equal(prs[1].merged, true)
  assert.equal(prs[2].comments, 2, 'comments 数组按条数')
  assert.deepEqual({ a: prs[0].additions, d: prs[0].deletions, c: prs[0].changedFiles }, { a: 12, d: 3, c: 2 }, '列表带改动统计')
  assert.throws(() => parsePullRequests('not json'), /不是 JSON/)
  assert.throws(() => parsePullRequests('{}'), /不是数组/)

  const issues = parseIssues(JSON.stringify([
    { number: 9, title: '问题', author: { login: 'bob' }, url: 'u', updatedAt: 't', comments: 1, labels: [{ name: 'bug' }, 'ui'], assignees: [{ login: 'carol' }] }
  ]))
  assert.deepEqual(issues[0].labels, ['bug', 'ui'])
  assert.deepEqual(issues[0].assignees, ['carol'])
})

test('PR 详情解析：评审与评论正文', () => {
  const detail = parsePullDetail(JSON.stringify({
    number: 7, title: '修 bug', body: '说明', author: { login: 'alice' }, state: 'OPEN', isDraft: false, mergedAt: null,
    url: 'u', createdAt: 't0', updatedAt: 't1', additions: 12, deletions: 3, changedFiles: 1,
    files: [{ path: 'lib/x.js', additions: 12, deletions: 3, changeType: 'MODIFIED' }],
    reviews: [{ author: { login: 'bob' }, state: 'CHANGES_REQUESTED', body: '改一下', submittedAt: 't2' }],
    comments: [{ author: { login: 'carol' }, body: '收到', createdAt: 't3' }]
  }))
  assert.equal(detail.number, 7)
  assert.equal(detail.reviews[0].state, 'changes-requested')
  assert.equal(detail.reviews[0].body, '改一下')
  assert.equal(detail.comments[0].login, 'carol')
  assert.deepEqual({ a: detail.additions, d: detail.deletions, c: detail.changedFiles }, { a: 12, d: 3, c: 1 }, '详情带改动统计')
  assert.deepEqual(detail.files, [{ path: 'lib/x.js', additions: 12, deletions: 3, changeType: 'MODIFIED' }], '详情带文件清单')
  assert.throws(() => parsePullDetail('[]'), /不是对象/)
})

test('分支解析：本地 / 远端 / 默认分支', () => {
  const local = parseLocalBranches([
    '*\x00main\x00abc\x00origin/main\x00[ahead 2, behind 1]\x002026-11-07T00:00:00+08:00\x00chore: x',
    ' \x00fix/y\x00def\x00\x00\x002026-11-06T00:00:00+08:00\x00fix y'
  ].join('\n'))
  assert.equal(local.length, 2)
  assert.equal(local[0].current, true)
  assert.equal(local[0].ahead, 2)
  assert.equal(local[0].behind, 1)
  assert.equal(local[0].upstream, 'origin/main')
  assert.equal(local[1].current, false)
  assert.equal(local[1].upstream, null)

  const remote = parseRemoteBranches([
    'origin/HEAD\x00abc\x00t\x00x',
    'origin/main\x00aaa\x002026-11-07T00:00:00Z\x00subject',
    'origin/fix/y\x00bbb\x002026-11-06T00:00:00Z\x00fix'
  ].join('\n'))
  assert.deepEqual(remote.map((row) => row.name), ['main', 'fix/y'])
  assert.equal(parseDefaultBranch('origin/main\n'), 'main')
  assert.equal(parseDefaultBranch(''), undefined)
})

test('分支名校验与删除规则', () => {
  assert.equal(validateBranchName('fix/a-1'), 'fix/a-1')
  for (const bad of ['-x', 'a..b', 'a@{b', 'a/', 'x.lock', 'a b', '']) assert.throws(() => validateBranchName(bad), /分支名/)
  assert.throws(() => assertBranchDeletable({ name: 'main', defaultBranch: 'main' }), /默认分支/)
  assert.throws(() => assertBranchDeletable({ name: 'fix', current: true }), /当前分支/)
  assert.throws(() => assertBranchDeletable({ name: 'fix', merged: false }), /还没合并/)
  assert.equal(assertBranchDeletable({ name: 'fix', merged: true }), 'fix')
  assert.equal(assertBranchDeletable({ name: 'fix', merged: false, force: true }), 'fix')
  assert.throws(() => requireRepo('gitee:o/r'), /owner\/name/)
  assert.equal(requireRepo('o/r'), 'o/r')
})

function fakeTools() {
  const calls = { gh: [], git: [] }
  const gh = async (args) => {
    calls.gh.push(args)
    const joined = args.join(' ')
    if (joined.startsWith('pr list')) return { stdout: JSON.stringify([{ number: 7, title: 'x', author: { login: 'a' }, url: 'u', isDraft: false, reviewDecision: 'APPROVED', updatedAt: 't', comments: 0, headRefName: 'h', baseRefName: 'main' }]), stderr: '' }
    if (joined.startsWith('issue list')) return { stdout: JSON.stringify([{ number: 9, title: 'i', author: { login: 'b' }, url: 'u', updatedAt: 't', comments: 0, labels: [], assignees: [] }]), stderr: '' }
    if (joined.startsWith('pr view')) return { stdout: JSON.stringify({ number: 7, title: 'x', body: 'b', author: { login: 'a' }, state: 'OPEN', reviews: [], comments: [], url: 'u' }), stderr: '' }
    if (joined.startsWith('pr review') || joined.startsWith('pr comment') || joined.startsWith('pr close') || joined.startsWith('pr reopen')) return { stdout: '', stderr: '' }
    throw Object.assign(new Error('unknown gh ' + joined), { stderr: 'unknown gh' })
  }
  const git = async (args) => {
    calls.git.push(args)
    const joined = args.join(' ')
    if (joined.includes('for-each-ref') && joined.includes('refs/heads')) return { stdout: ['*\x00main\x00abc\x00origin/main\x00\x002026-11-07T00:00:00+08:00\x00c',
      ' \x00fix/merged\x00def\x00\x00\x002026-11-06T00:00:00+08:00\x00m',
      ' \x00fix/y\x00ghi\x00\x00\x002026-11-05T00:00:00+08:00\x00y'].join('\n'), stderr: '' }
    if (joined.includes('for-each-ref') && joined.includes('refs/remotes/origin')) return { stdout: 'origin/main\x00abc\x002026-11-07T00:00:00+08:00\x00c', stderr: '' }
    if (joined.includes('symbolic-ref')) return { stdout: 'origin/main\n', stderr: '' }
    if (joined.includes('branch --merged')) return { stdout: '* main\n  fix/merged\n', stderr: '' }
    if (joined.includes('fetch --prune')) return { stdout: '', stderr: '' }
    if (joined.includes('branch -d') || joined.includes('branch -D')) return { stdout: '', stderr: '' }
    if (joined.includes('push origin --delete')) return { stdout: '', stderr: '' }
    throw Object.assign(new Error('unknown git ' + joined), { stderr: 'unknown git' })
  }
  return { gh, git, calls }
}

test('列表缓存：60 秒内不重复请求，force 绕过；身份守卫先跑', async () => {
  const { gh, git, calls } = fakeTools()
  let guarded = 0
  const lists = new GitHubLists({ gh, git, identity: { requireIdentity: async () => { guarded += 1 } }, now: () => 1000 })
  const first = await lists.pullRequests('o/r')
  const second = await lists.pullRequests('o/r')
  assert.equal(first.items.length, 1)
  assert.equal(second.fetchedAt, first.fetchedAt)
  assert.equal(calls.gh.length, 1)
  await lists.pullRequests('o/r', { force: true })
  assert.equal(calls.gh.length, 2)
  assert.equal(guarded, 2)
  assert.ok(LIST_TTL_MS >= 30_000)
})

test('列表缓存：并发同一 key 只跑一次 gh', async () => {
  const { gh, git, calls } = fakeTools()
  const lists = new GitHubLists({ gh, git, now: () => 1000 })
  const [a, b] = await Promise.all([lists.pullRequests('o/r'), lists.pullRequests('o/r')])
  assert.equal(calls.gh.length, 1, '并发请求共用一次 gh')
  assert.equal(a, b, '两个调用拿到同一份结果')
})

test('分支列表：默认分支 / 当前分支 / 已合并；fetch 清缓存', async () => {
  const { gh, git, calls } = fakeTools()
  const lists = new GitHubLists({ gh, git, now: () => 1000 })
  const snapshot = await lists.branches('/repo', { repo: 'o/r' })
  assert.equal(snapshot.current, 'main')
  assert.equal(snapshot.defaultBranch, 'main')
  assert.equal(snapshot.local[0].merged, true)
  assert.equal(snapshot.remote[0].name, 'main')
  await lists.fetch('/repo')
  await lists.branches('/repo')
  assert.equal(calls.git.filter((args) => args.join(' ').includes('for-each-ref')).length, 4, 'fetch 后重读一次本地 + 远端')
})

test('PR 写动作：approve / 评论 / 关闭重开带审计；缺正文拒绝', async () => {
  const { gh, git, calls } = fakeTools()
  const audits = []
  const lists = new GitHubLists({ gh, git, audit: async (record) => { audits.push(record) }, now: () => 1000 })
  await lists.prAction('o/r', 7, 'approve', { body: 'LGTM' })
  assert.ok(calls.gh.some((args) => args.join(' ') === 'pr review 7 --repo o/r --approve --body LGTM'))
  await assert.rejects(() => lists.prAction('o/r', 7, 'comment', { body: '  ' }), /不能为空/)
  await assert.rejects(() => lists.prAction('o/r', 7, 'request-changes', {}), /请求修改/)
  await lists.prAction('o/r', 7, 'close')
  await lists.prAction('o/r', 7, 'reopen')
  assert.deepEqual(audits.map((row) => row.event), ['pr-approve', 'pr-close', 'pr-reopen'])
})

test('PR 写动作：清掉打开 / 已关闭列表与详情缓存', async () => {
  const { gh, git, calls } = fakeTools()
  const lists = new GitHubLists({ gh, git, now: () => 1000 })
  await lists.pullRequests('o/r')
  await lists.pullRequests('o/r', { state: 'closed' })
  await lists.pullRequestDetail('o/r', 7)
  assert.equal(calls.gh.length, 3)
  await lists.prAction('o/r', 7, 'comment', { body: '收到' })
  assert.equal(calls.gh.length, 4)
  await lists.pullRequests('o/r')
  await lists.pullRequests('o/r', { state: 'closed' })
  await lists.pullRequestDetail('o/r', 7)
  assert.equal(calls.gh.length, 7, '写后列表与详情缓存都失效')
})

test('PR 列表 / 详情请求带改动字段', async () => {
  const { gh, git, calls } = fakeTools()
  const lists = new GitHubLists({ gh, git, now: () => 1000 })
  await lists.pullRequests('o/r')
  await lists.pullRequestDetail('o/r', 7)
  const listArgs = calls.gh.find((args) => args.join(' ').startsWith('pr list'))?.join(' ') ?? ''
  assert.match(listArgs, /additions,deletions,changedFiles/, '列表带改动统计字段')
  const detailArgs = calls.gh.find((args) => args.join(' ').startsWith('pr view'))?.join(' ') ?? ''
  assert.match(detailArgs, /files,additions,deletions,changedFiles/, '详情带文件清单字段')
})

test('工作树：分支被 worktree 占用时标记并拒绝删除', async () => {
  const git = async (args) => {
    const joined = args.join(' ')
    if (joined.includes('for-each-ref') && joined.includes('refs/heads')) return { stdout: ' \x00wt/branch\x00abc\x00\x00\x002026-11-07T00:00:00+08:00\x00x', stderr: '' }
    if (joined.includes('for-each-ref') && joined.includes('refs/remotes/origin')) return { stdout: '', stderr: '' }
    if (joined.includes('symbolic-ref')) return { stdout: '', stderr: '' }
    if (joined.includes('worktree list --porcelain')) return { stdout: 'worktree /repo/wt\nHEAD abc\nbranch refs/heads/wt/branch\n\n', stderr: '' }
    throw Object.assign(new Error('unknown git ' + joined), { stderr: 'unknown git' })
  }
  const lists = new GitHubLists({ gh: async () => ({ stdout: '' }), git, now: () => 1000 })
  const snapshot = await lists.branches('/repo')
  assert.equal(snapshot.local.find((item) => item.name === 'wt/branch').worktree, '/repo/wt')
  await assert.rejects(() => lists.deleteBranch({ path: '/repo', name: 'wt/branch' }), /工作树占用/)
  assert.deepEqual(parseWorktrees('worktree /a\nHEAD 1\nbranch refs/heads/x\n\nworktree /b\nHEAD 2\ndetached\n'), [
    { path: '/a', branch: 'x', head: '1' },
    { path: '/b', head: '2', detached: true }
  ])
})

test('分支删除：当前 / 默认 / 未合并 / 远端确认名', async () => {
  const { gh, git } = fakeTools()
  const audits = []
  const lists = new GitHubLists({ gh, git, audit: async (record) => { audits.push(record) }, now: () => 1000 })
  await assert.rejects(() => lists.deleteBranch({ path: '/repo', name: 'main' }), /默认分支/)
  // 远端删除：确认名不对拒绝；对了才执行
  await assert.rejects(() => lists.deleteBranch({ path: '/repo', name: 'fix/y', remote: true, confirm: 'wrong' }), /输入分支名/)
  await lists.deleteBranch({ path: '/repo', name: 'fix/y', remote: true, confirm: 'fix/y' })
  assert.deepEqual(audits.at(-1), { event: 'branch-delete-remote', path: '/repo', branch: 'fix/y', force: false, stderr: '' })
  // 本地未合并默认拒绝，force 才放行（fix/y 不在 merged 集合里）
  await assert.rejects(() => lists.deleteBranch({ path: '/repo', name: 'fix/y' }), /还没合并/)
  await lists.deleteBranch({ path: '/repo', name: 'fix/y', force: true })
  assert.equal(audits.at(-1).event, 'branch-delete-local')
})

test('命令错误：只取 stderr 第一行', () => {
  assert.equal(commandError({ stderr: 'fatal: x\ny' }), 'fatal: x')
  assert.equal(commandError({}, '默认'), '默认')
})
