/** GitHub 仓库能力探测 + 仓库开关（R0）：只读探测、unknown 不猜、开关只认用户、按仓库存。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GithubRepoStore, describeRepo, originRepo, parseRepoUrl, switchAvailability } from '../lib/githubrepo.js'

const OK_REPO = {
  has_issues: true, has_projects: true, default_branch: 'main',
  allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: true,
  delete_branch_on_merge: false, permissions: { admin: true, push: true, triage: true }
}

function fakeGh({ repo = OK_REPO, protection = 'none', labels = ['bug'], issue = 7, subIssues = 'unsupported' } = {}) {
  const calls = []
  const gh = async (args) => {
    calls.push(args.join(' '))
    const path = args[1]
    if (path === 'repos/o/r') return { stdout: JSON.stringify(repo) }
    if (path === 'repos/o/r/branches/main/protection') {
      if (protection === 'none') throw Object.assign(new Error('exit 1'), { stderr: 'gh: Branch not protected (HTTP 404)' })
      if (protection === 'unknown') throw Object.assign(new Error('exit 1'), { stderr: 'gh: HTTP 403 Forbidden' })
      return { stdout: JSON.stringify({ required_pull_request_reviews: { required_approving_review_count: 2 }, required_status_checks: { contexts: ['ci'] }, enforce_admins: { enabled: true } }) }
    }
    if (path === 'repos/o/r/labels?per_page=100') return { stdout: JSON.stringify(labels.map((name) => ({ name }))) }
    if (path === 'repos/o/r/issues?state=all&per_page=1') return { stdout: JSON.stringify(issue === null ? [] : [{ number: issue }]) }
    if (path === `repos/o/r/issues/${issue}/sub_issues`) {
      if (subIssues === 'supported') return { stdout: '[]' }
      throw Object.assign(new Error('exit 1'), { stderr: subIssues === 'unknown' ? 'gh: HTTP 500' : 'gh: Not Found (HTTP 404)' })
    }
    throw new Error('unexpected gh ' + path)
  }
  return { gh, calls }
}

async function tmp() { return mkdtemp(join(tmpdir(), 'relay-repo-')) }

test('parseRepoUrl：https / ssh / git@ 都认，非 GitHub 返回 undefined', () => {
  assert.equal(parseRepoUrl('https://github.com/SunsetRNE/dsh-session-relay.git'), 'SunsetRNE/dsh-session-relay')
  assert.equal(parseRepoUrl('git@github.com:SunsetRNE/dsh-session-relay.git'), 'SunsetRNE/dsh-session-relay')
  assert.equal(parseRepoUrl('ssh://git@github.com/o/r'), 'o/r')
  assert.equal(parseRepoUrl('https://gitlab.com/o/r.git'), undefined)
  assert.equal(parseRepoUrl(''), undefined)
})

test('originRepo：从临时 git 仓库读 origin；没有 origin 返回 undefined', async () => {
  const dir = await tmp()
  try {
    const git = (args) => new Promise((resolve, reject) => execFile('git', args, { cwd: dir }, (error, stdout) => error ? reject(error) : resolve(String(stdout))))
    await git(['init', '-q'])
    assert.equal(await originRepo(dir), undefined)
    await git(['remote', 'add', 'origin', 'git@github.com:o/r.git'])
    assert.equal(await originRepo(dir), 'o/r')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('探测：仓库信息/保护/labels/sub-issues 映射，缓存 10 分钟内不重复跑 gh', async () => {
  const base = await tmp()
  try {
    const { gh, calls } = fakeGh()
    let now = 1_000
    const store = new GithubRepoStore(base, { gh, now: () => now })
    const record = await store.probe('o/r')
    assert.equal(record.probe.source, 'ok')
    assert.deepEqual(record.probe.repo.merge, { merge: true, squash: false, rebase: true })
    assert.equal(record.probe.repo.permissions.admin, true)
    assert.equal(record.probe.protection.state, 'none', '404 记作未开分支保护')
    assert.deepEqual(record.probe.labels, ['bug'])
    assert.equal(record.probe.subIssues, 'unsupported', '端点 404 = 不支持')
    const first = calls.length
    await store.probe('o/r')
    assert.equal(calls.length, first, '缓存内不再请求')
    now += 11 * 60_000
    await store.probe('o/r')
    assert.ok(calls.length > first, '过期后重新探测')
    await store.probe('o/r', { force: true })
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('探测失败记 error 且不猜能力；分支保护 403 记 unknown', async () => {
  const base = await tmp()
  try {
    const down = async () => { throw Object.assign(new Error('exit 1'), { stderr: 'gh: x509: certificate signed by unknown authority' }) }
    const store = new GithubRepoStore(base, { gh: down })
    const record = await store.probe('o/r')
    assert.equal(record.probe.source, 'error')
    assert.match(record.probe.error, /x509/)
    assert.equal(switchAvailability(record, 'issues').ok, false)
    assert.equal(switchAvailability(record, 'approvalGate').ok, true, '纯本地开关不受探测失败影响')

    const { gh } = fakeGh({ protection: 'unknown' })
    const store2 = new GithubRepoStore(base, { gh })
    const second = await store2.probe('o/r')
    assert.equal(second.probe.protection.state, 'unknown', '403 不猜成没开')
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('开关：按仓库存盘、只认已知键、能力不满足时拒绝开启', async () => {
  const base = await tmp()
  try {
    const { gh } = fakeGh()
    const store = new GithubRepoStore(base, { gh })
    const opened = await store.setSwitch('o/r', 'issues', true)
    assert.equal(opened.changed, true)
    assert.equal(opened.record.switches.issues, true)
    // 新实例读回（按仓库存，不按工作区）
    const again = new GithubRepoStore(base, { gh })
    assert.equal((await again.switches('o/r')).issues, true)
    // 未知键
    await assert.rejects(store.setSwitch('o/r', 'nope', true), /未知仓库开关/)
    // mapIssues 在 sub-issues 不支持/未知时降级为正文 tasklist，仍可开
    await store.setSwitch('o/r', 'mapIssues', true)
    assert.equal((await store.switches('o/r')).mapIssues, true)
    assert.match(switchAvailability(await store.probe('o/r'), 'mapIssues').note, /tasklist/)
    // prLink 没有额外依赖，能开
    await store.setSwitch('o/r', 'prLink', true)
    assert.equal((await store.switches('o/r')).prLink, true)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('describeRepo：列出能力、保护、sub-issues 和各开关可用性', async () => {
  const base = await tmp()
  try {
    const { gh } = fakeGh()
    const store = new GithubRepoStore(base, { gh })
    const record = await store.probe('o/r')
    const text = describeRepo(record)
    for (const part of ['GitHub 仓库：o/r', 'issues 开', 'projects 开', '合并方式 merge/rebase', 'main 保护：未开', 'sub-issues 不支持', 'issues（issue 投影）：关', 'approvalGate（合并前审批门）：开', '降级为父 issue 正文 tasklist', '用法：/relay repo']) {
      assert.ok(text.includes(part), '缺少 ' + part)
    }
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('命令解析：/relay repo [refresh|on|off]', async () => {
  const { parseRelayCommand } = await import('../lib/core.js')
  assert.deepEqual(parseRelayCommand('repo'), { kind: 'repo-show' })
  assert.deepEqual(parseRelayCommand('repo refresh'), { kind: 'repo-refresh' })
  assert.deepEqual(parseRelayCommand('repo on prLink'), { kind: 'repo-set', key: 'prLink', enabled: true })
  assert.deepEqual(parseRelayCommand('repo off issues'), { kind: 'repo-set', key: 'issues', enabled: false })
  assert.equal(parseRelayCommand('repo on').kind, 'invalid')
  assert.equal(parseRelayCommand('repo on a b').kind, 'invalid')
  assert.equal(parseRelayCommand('repo nope').kind, 'invalid')
})
