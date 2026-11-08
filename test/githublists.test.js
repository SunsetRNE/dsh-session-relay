import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('工作树：二次确认后移除干净工作树并删分支；活跃声明拒绝', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-wt-'))
  try {
    const repo = join(dir, 'repo')
    const wt = join(repo, '.agents', 'worktrees', 'wt', 'branch')
    await mkdir(wt, { recursive: true })
    const calls = []
    const git = async (args) => {
      const joined = args.join(' ')
      calls.push(joined)
      if (joined.includes('for-each-ref') && joined.includes('refs/heads')) return { stdout: ' \x00wt/branch\x00abc\x00\x00\x002026-11-07T00:00:00+08:00\x00x', stderr: '' }
      if (joined.includes('for-each-ref') && joined.includes('refs/remotes/origin')) return { stdout: '', stderr: '' }
      if (joined.includes('symbolic-ref')) return { stdout: '', stderr: '' }
      if (joined.includes('worktree list --porcelain')) return { stdout: 'worktree ' + wt + '\nHEAD abc\nbranch refs/heads/wt/branch\n\n', stderr: '' }
      if (joined.includes('status --porcelain')) return { stdout: '', stderr: '' }
      if (joined.includes('worktree remove')) return { stdout: '', stderr: '' }
      if (joined.includes('branch -D')) return { stdout: '', stderr: '' }
      throw Object.assign(new Error('unknown git ' + joined), { stderr: 'unknown git' })
    }
    const lists = new GitHubLists({ gh: async () => ({ stdout: '' }), git, now: () => 1000 })
    const done = await lists.deleteBranch({ path: repo, name: 'wt/branch', removeWorktree: true })
    assert.equal(done.worktreeRemoved, wt)
    assert.ok(calls.some((line) => line.includes('worktree remove ' + wt)), '移除了工作树')
    assert.ok(calls.some((line) => line.includes('branch -D wt/branch')), '强制删了分支')

    const wt2 = join(repo, '.agents', 'worktrees', 'active')
    await mkdir(wt2, { recursive: true })
    await writeFile(join(wt2, '.ACTIVE-SESSION'), '状态：活跃')
    const git2 = async (args) => {
      const joined = args.join(' ')
      if (joined.includes('for-each-ref') && joined.includes('refs/heads')) return { stdout: ' \x00wt/active\x00abc\x00\x00\x002026-11-07T00:00:00+08:00\x00x', stderr: '' }
      if (joined.includes('for-each-ref') && joined.includes('refs/remotes/origin')) return { stdout: '', stderr: '' }
      if (joined.includes('symbolic-ref')) return { stdout: '', stderr: '' }
      if (joined.includes('worktree list --porcelain')) return { stdout: 'worktree ' + wt2 + '\nHEAD abc\nbranch refs/heads/wt/active\n\n', stderr: '' }
      if (joined.includes('status --porcelain')) return { stdout: '', stderr: '' }
      throw Object.assign(new Error('unknown git ' + joined), { stderr: 'unknown git' })
    }
    const lists2 = new GitHubLists({ gh: async () => ({ stdout: '' }), git: git2, now: () => 1000 })
    await assert.rejects(() => lists2.deleteBranch({ path: repo, name: 'wt/active', removeWorktree: true }), /ACTIVE-SESSION/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

/** 遗留清理夹具：clean（干净 + .SESSION-DONE）、dirty（有改动）、active（.ACTIVE-SESSION）、outside（不在 .agents/worktrees）。 */
async function cleanupFixture(dir, calls = []) {
  const repo = join(dir, 'repo')
  const paths = {
    clean: join(repo, '.agents', 'worktrees', 'clean'),
    dirty: join(repo, '.agents', 'worktrees', 'dirty'),
    active: join(repo, '.agents', 'worktrees', 'active'),
    outside: join(dir, 'outside')
  }
  for (const path of Object.values(paths)) await mkdir(path, { recursive: true })
  await writeFile(join(paths.clean, '.SESSION-DONE'), '状态：已结束\n会话：session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n')
  await writeFile(join(paths.dirty, 'a.txt'), 'a\n')
  await writeFile(join(paths.active, '.ACTIVE-SESSION'), '状态：活跃\n会话：session-11111111-2222-3333-4444-555555555555\n')
  const names = { clean: 'wt/clean', dirty: 'wt/dirty', active: 'wt/active', outside: 'wt/outside' }
  const git = async (args) => {
    const joined = args.join(' ')
    calls.push(joined)
    if (joined.includes('for-each-ref') && joined.includes('refs/heads')) {
      return { stdout: [
        '*\x00main\x00aaa\x00origin/main\x00\x002026-11-07T00:00:00+08:00\x00m',
        ' \x00wt/clean\x00bbb\x00\x00\x002026-11-06T00:00:00+08:00\x00c',
        ' \x00wt/dirty\x00ccc\x00\x00\x002026-11-05T00:00:00+08:00\x00d',
        ' \x00wt/active\x00ddd\x00\x00\x002026-11-04T00:00:00+08:00\x00e',
        ' \x00wt/outside\x00eee\x00\x00\x002026-11-03T00:00:00+08:00\x00f'
      ].join('\n'), stderr: '' }
    }
    if (joined.includes('for-each-ref') && joined.includes('refs/remotes/origin')) return { stdout: '', stderr: '' }
    if (joined.includes('symbolic-ref')) return { stdout: '', stderr: '' }
    if (joined.includes('worktree list --porcelain')) {
      return { stdout: ['worktree ' + repo + '\nHEAD main\nbranch refs/heads/main\n', ...Object.entries(paths).map(([key, path]) => 'worktree ' + path + '\nHEAD ' + key + '\nbranch refs/heads/' + names[key] + '\n')].join('\n'), stderr: '' }
    }
    if (joined.includes('branch --merged')) return { stdout: '* main\n  wt/clean\n  wt/active\n', stderr: '' }
    if (joined.includes('status --porcelain')) return { stdout: joined.includes(paths.dirty) ? '?? a.txt\n' : '', stderr: '' }
    if (joined.includes('worktree remove') || joined.includes('branch -D')) return { stdout: '', stderr: '' }
    throw Object.assign(new Error('unknown git ' + joined), { stderr: 'unknown git' })
  }
  return { repo, paths, git }
}

test('遗留清理：列出工作树分支的干净 / 声明 / 合并状态，只标出可清理的', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-cleanup-'))
  try {
    const { repo, git } = await cleanupFixture(dir)
    const lists = new GitHubLists({ gh: async () => ({ stdout: '' }), git, now: () => 1000 })
    const view = await lists.worktreeBranches(repo)
    assert.equal(view.branches.length, 4, '主 checkout 的当前分支不算遗留工作树')
    assert.ok(!view.branches.some((branch) => branch.name === 'main'), '不列主 checkout')
    const byName = new Map(view.branches.map((branch) => [branch.name, branch]))
    assert.equal(byName.get('wt/clean').clean, true)
    assert.equal(byName.get('wt/clean').declaration, 'done')
    assert.equal(byName.get('wt/clean').session, 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    assert.equal(byName.get('wt/clean').merged, true)
    assert.equal(byName.get('wt/clean').cleanable, true)
    assert.equal(byName.get('wt/dirty').cleanable, false)
    assert.match(byName.get('wt/dirty').reason, /未提交改动/)
    assert.equal(byName.get('wt/active').cleanable, false)
    assert.match(byName.get('wt/active').reason, /会话未结束/)
    assert.equal(byName.get('wt/outside').cleanable, false)
    assert.match(byName.get('wt/outside').reason, /\.agents\/worktrees/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('遗留清理：批量只移除干净且无活跃声明的工作树，其余逐条跳过并记审计', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-cleanup-run-'))
  try {
    const calls = []
    const audits = []
    const { repo, paths, git } = await cleanupFixture(dir, calls)
    const lists = new GitHubLists({ gh: async () => ({ stdout: '' }), git, audit: async (record) => { audits.push(record) }, now: () => 1000 })
    const done = await lists.cleanupWorktreeBranches({ path: repo, names: ['wt/clean', 'wt/dirty', 'wt/active', 'wt/outside', 'wt/clean'] })
    assert.equal(done.removed, 1)
    assert.equal(done.skipped, 3)
    assert.deepEqual(done.results.map((row) => [row.name, row.ok]), [['wt/clean', true], ['wt/dirty', false], ['wt/active', false], ['wt/outside', false]])
    assert.ok(calls.some((line) => line.includes('worktree remove ' + paths.clean)), '干净工作树被移除')
    assert.ok(calls.some((line) => line.includes('branch -D wt/clean')), '分支被删除')
    assert.ok(!calls.some((line) => line.includes('worktree remove ' + paths.dirty)), '有改动的工作树不动')
    assert.ok(!calls.some((line) => line.includes('worktree remove ' + paths.active)), '活跃会话的工作树不动')
    assert.equal(audits.filter((row) => row.event === 'branch-delete-worktree').length, 1)
    assert.equal(audits.at(-1).event, 'branch-cleanup')
    assert.equal(audits.at(-1).removed, 1)
    assert.equal(audits.at(-1).skipped, 3)
  } finally { await rm(dir, { recursive: true, force: true }) }
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
