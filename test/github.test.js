import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitHubIdentity, LOGIN_SCOPES, SCOPE_TIERS, impliedScopes, loginArgs, missingScopes, parseDeviceLogin, parseUserResponse, shellHasGithub, tierScopes } from '../lib/github.js'

const userReply = (login, id, scopes = 'repo, workflow') => ({ stdout: `HTTP/2.0 200 OK\r\nX-Oauth-Scopes: ${scopes}\r\n\r\n${JSON.stringify({ login, id })}`, stderr: '' })

/** 可换号的 gh 替身：account 为 null 时表现成没登录。 */
function fakeGh(state) {
  return async (args) => {
    state.calls.push(args)
    if (state.account === null) throw Object.assign(new Error('exit 4'), { stderr: 'To get started with GitHub CLI, please run:  gh auth login' })
    return userReply(state.account.login, state.account.id)
  }
}

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.written = []
  child.stdin = { write: (text) => child.written.push(text) }
  child.killed = false
  child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('exit', null)) }
  return child
}

async function setup({ account = { login: 'alice', id: 101 }, shell } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'relay-gh-'))
  const state = { account, calls: [] }
  const notified = []
  const opened = []
  const children = []
  const kinds = []
  const scopesSeen = []
  const bridge = {
    get: async (path) => {
      if (path === '/app/version') return { result: shell ? 'VERSION=1\nGITHUB_CREDENTIALS=1\n' : 'VERSION=1\n' }
      if (path === '/app/github/status') return shell.status
      throw new Error('unexpected ' + path)
    },
    post: async (path, body) => { shell.posted = [path, body]; return shell.login },
    open: async (url) => { opened.push(url) }
  }
  const identity = new GitHubIdentity(join(dir, 'github.json'), join(dir, 'github-audit.jsonl'), {
    gh: fakeGh(state), bridge, notify: async (title, text) => notified.push([title, text]),
    spawnLogin: (kind = 'login', scopes) => { kinds.push(kind); scopesSeen.push(scopes); const child = fakeChild(); children.push(child); return child }
  })
  await identity.load()
  const audit = async () => (await readFile(join(dir, 'github-audit.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  // 收尾可能和退出后的异步 probe/审计撞上（已知偶发 ENOTEMPTY）：重试几次再放弃
  const cleanup = async () => {
    for (let i = 0; i < 10; i += 1) {
      try { await rm(dir, { recursive: true, force: true }); return } catch (error) {
        if (error?.code !== 'ENOTEMPTY' && error?.code !== 'EBUSY') throw error
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
  }
  return { dir, state, identity, notified, opened, children, kinds, scopesSeen, audit, cleanup }
}

test('github 解析：gh api -i user、设备验证码、壳的 GITHUB_CREDENTIALS', () => {
  assert.deepEqual(parseUserResponse(userReply('alice', 101).stdout), { login: 'alice', accountId: 101, scopes: ['repo', 'workflow'] })
  assert.equal(parseUserResponse('HTTP/2.0 200 OK\r\n\r\nnot json'), undefined)
  assert.deepEqual(parseDeviceLogin('! First copy your one-time code: ab12-CD34\nOpen this URL to continue in your web browser: https://github.com/login/device\n'), { userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' })
  assert.equal(parseDeviceLogin('one-time code: AB12-CD34 only'), undefined)
  assert.equal(shellHasGithub('A=1\nGITHUB_CREDENTIALS=1\nB=2'), true)
  assert.equal(shellHasGithub('GITHUB_CREDENTIALS=10'), false)
})

test('github 身份：没锁定时不拦也不调 gh；锁定后换号标红、只报一次、拒绝 gh 调用；按数字 id 判（改名不算）', async () => {
  const h = await setup()
  try {
    await h.identity.requireIdentity()
    assert.equal(h.state.calls.length, 0, '没锁定不跑 gh')
    const pinned = await h.identity.pin()
    assert.equal(pinned.match, 'ok')
    assert.deepEqual(JSON.parse(await readFile(join(h.dir, 'github.json'), 'utf8')).pinned.accountId, 101)
    // 改名：同一个 id
    h.state.account = { login: 'alice-renamed', id: 101 }
    await h.identity.probe()
    assert.equal(h.identity.match(), 'ok')
    await h.identity.requireIdentity()
    // 换号
    h.state.account = { login: 'mallory', id: 666 }
    await h.identity.probe()
    assert.equal(h.identity.match(), 'mismatch')
    await h.identity.probe()
    assert.equal(h.notified.length, 1, '同一次换号只通知一次')
    assert.match(h.notified[0][1], /mallory（666）.*alice/)
    await assert.rejects(h.identity.requireIdentity(), (error) => error.code === 'github_mismatch')
    // 退出登录
    h.state.account = null
    await h.identity.probe()
    assert.equal(h.identity.match(), 'missing')
    assert.equal(h.notified.length, 2)
    await assert.rejects(h.identity.requireIdentity(), (error) => error.code === 'github_missing')
    // 解锁后放行
    await h.identity.unpin()
    await h.identity.requireIdentity()
    const events = (await h.audit()).map((item) => item.event)
    assert.deepEqual(events, ['pin', 'mismatch', 'missing', 'unpin'])
    // 重新加载读回锁定状态
    const again = new GitHubIdentity(join(h.dir, 'github.json'), undefined, { gh: fakeGh(h.state), bridge: {} })
    assert.equal(await again.load(), null)
  } finally { await h.cleanup() }
})

test('github 登录（gh）：解析验证码、经桥打开 github.com、回车放行；验证码只在 withCode 视图里，结束后清掉；审计不含验证码', async () => {
  const h = await setup({ account: null })
  try {
    const pending = h.identity.startLogin()
    await new Promise((resolve) => setImmediate(resolve))
    const child = h.children[0]
    child.stderr.emit('data', '! First copy your one-time code: WXYZ-1234\n')
    child.stderr.emit('data', 'Open this URL to continue in your web browser: https://github.com/login/device\n')
    const view = await pending
    assert.equal(view.loginFlow.state, 'pending')
    assert.equal(view.loginFlow.userCode, 'WXYZ-1234')
    assert.equal(view.loginFlow.opened, true)
    assert.deepEqual(h.opened, ['https://github.com/login/device'])
    assert.deepEqual(child.written, ['\n'])
    assert.equal('userCode' in h.identity.view().loginFlow, false, '默认视图不带验证码')
    // 再点一次不另起进程
    await h.identity.startLogin()
    assert.equal(h.children.length, 1)
    // 用户在浏览器完成授权
    h.state.account = { login: 'alice', id: 101 }
    child.emit('exit', 0)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const done = h.identity.view({ withCode: true })
    assert.equal(done.loginFlow.state, 'done')
    assert.equal(done.loginFlow.userCode, null)
    assert.equal(done.login, 'alice')
    assert.equal(done.match, 'unpinned')
    const audit = await h.audit()
    assert.deepEqual(audit.map((item) => item.event), ['login-start', 'login-done'])
    assert.equal(JSON.stringify(audit).includes('WXYZ'), false)
  } finally { await h.cleanup() }
})

test('github 登录（gh）：取消会结束子进程；失败给出最后一行原因', async () => {
  const h = await setup({ account: null })
  try {
    const pending = h.identity.startLogin()
    await new Promise((resolve) => setImmediate(resolve))
    h.children[0].stderr.emit('data', 'one-time code: AAAA-BBBB\nhttps://github.com/login/device\n')
    await pending
    const cancelled = await h.identity.cancelLogin()
    assert.equal(cancelled.loginFlow.state, 'cancelled')
    assert.equal(h.children[0].killed, true)

    const second = h.identity.startLogin()
    await new Promise((resolve) => setImmediate(resolve))
    const child = h.children[1]
    child.stderr.emit('data', 'one-time code: CCCC-DDDD\nhttps://github.com/login/device\n')
    await second
    child.stderr.emit('data', 'failed to authenticate via web browser: slow_down\n')
    child.emit('exit', 1)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const view = h.identity.view()
    assert.equal(view.loginFlow.state, 'failed')
    assert.match(view.loginFlow.error, /slow_down/)
  } finally { await h.cleanup() }
})

test('github 身份（壳接管）：读 /app/github/status，不跑 gh；登录交给壳', async () => {
  const shell = { status: { state: 'READY', login: 'alice', accountId: 101, scopes: ['repo'], credentialGeneration: 3 }, login: { userCode: 'SHEL-L123', verificationUri: 'https://github.com/login/device', expiresAt: 9e15 } }
  const h = await setup({ shell })
  try {
    const found = await h.identity.probe()
    assert.equal(found.source, 'shell')
    assert.equal(found.accountId, 101)
    assert.equal(h.state.calls.length, 0)
    const view = await h.identity.startLogin()
    assert.equal(shell.posted[0], '/app/github/login')
    assert.equal(view.loginFlow.userCode, 'SHEL-L123')
    shell.status = { state: 'MISSING' }
    await h.identity.probe()
    assert.equal(h.identity.match(), 'missing')
  } finally { await h.cleanup() }
})

test('github.json 损坏：留底后按未锁定处理', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-gh-'))
  try {
    await writeFile(join(dir, 'github.json'), '{oops')
    const identity = new GitHubIdentity(join(dir, 'github.json'), undefined, { gh: async () => userReply('a', 1), bridge: {}, now: () => 42 })
    assert.equal(await identity.load(), null)
    assert.equal(await readFile(join(dir, 'github.json.corrupt-42'), 'utf8'), '{oops')
  } finally { await rm(dir, { recursive: true, force: true }) }
})


test('全量 scope：登录/刷新都带全部经典权限，含组织、删除仓库、webhooks 等；不含 offline_access', () => {
  for (const scope of ['repo', 'workflow', 'admin:org', 'admin:repo_hook', 'delete_repo', 'project', 'write:packages', 'read:audit_log', 'admin:public_key']) {
    assert.ok(LOGIN_SCOPES.includes(scope), '缺少 ' + scope)
  }
  assert.ok(!LOGIN_SCOPES.includes('offline_access'), '不请求 offline_access（不改变 token 生命周期）')
  const login = loginArgs('login')
  assert.deepEqual(login.slice(0, 5), ['auth', 'login', '--web', '--hostname', 'github.com'])
  assert.equal(login[login.indexOf('--scopes') + 1].split(',').length, LOGIN_SCOPES.length)
  const refresh = loginArgs('refresh')
  assert.deepEqual(refresh.slice(0, 2), ['auth', 'refresh'])
  assert.equal(refresh[refresh.indexOf('--scopes') + 1].split(',').includes('admin:org'), true)
})

test('github 登录：已登录时 refresh 走 gh auth refresh；没登录时退回登录', async () => {
  const h = await setup()
  try {
    // 先把 current 探成 ready（模拟已登录）
    await h.identity.probe()
    const pending = h.identity.startLogin({ refresh: true })
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(h.kinds, ['refresh'], '已登录时补权限')
    const child = h.children[0]
    child.stderr.emit('data', '! First copy your one-time code: QWER-5678\n')
    child.stderr.emit('data', 'Open this URL to continue in your web browser: https://github.com/login/device\n')
    const view = await pending
    assert.equal(view.loginFlow.userCode, 'QWER-5678')
    child.emit('exit', 0)
    await new Promise((resolve) => setTimeout(resolve, 10))
    // 没登录时 refresh 退回登录
    h.state.account = null
    await h.identity.probe()
    const again = h.identity.startLogin({ refresh: true })
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(h.kinds, ['refresh', 'login'])
    h.children[1].emit('exit', 1)
    await again.catch(() => {})
  } finally { await h.cleanup() }
})


test('权限分档：basic / repo / all 三档，未知档位按「全部」处理', () => {
  assert.deepEqual(SCOPE_TIERS.basic, ['repo', 'read:org', 'gist', 'workflow'])
  assert.ok(SCOPE_TIERS.repo.includes('admin:repo_hook') && !SCOPE_TIERS.repo.includes('delete_repo'))
  assert.equal(tierScopes('all'), LOGIN_SCOPES)
  assert.equal(tierScopes('unknown'), SCOPE_TIERS.repo)
  assert.equal(loginArgs('login', tierScopes('basic')).at(-1), 'repo,read:org,gist,workflow')
})

test('github 登录：按所选档位把 scope 交给 gh；已登录补权限用 refresh', async () => {
  const h = await setup()
  try {
    const pending = h.identity.startLogin({ tier: 'basic' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(h.kinds, ['login'])
    assert.deepEqual(h.scopesSeen[0], ['repo', 'read:org', 'gist', 'workflow'])
    h.children[0].emit('exit', 1)
    await pending.catch(() => {})
    await h.identity.probe()
    const refresh = h.identity.startLogin({ refresh: true, tier: 'repo' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(h.kinds, ['login', 'refresh'])
    assert.ok(h.scopesSeen[1].includes('admin:repo_hook'))
    assert.ok(!h.scopesSeen[1].includes('delete_repo'))
    h.children[1].emit('exit', 1)
    await refresh.catch(() => {})
  } finally { await h.cleanup() }
})


test('github 登录：scope 没授全会记 missing 并在审计里留请求/实际数量；resetLogin 先退出再完整登录', async () => {
  const h = await setup()
  try {
    await h.identity.probe() // 已登录，current ready
    const pending = h.identity.startLogin({ refresh: true, tier: 'basic' })
    await new Promise((resolve) => setImmediate(resolve))
    const child = h.children[0]
    child.emit('exit', 0)
    await pending.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    const audit = await h.audit()
    const done = audit.find((item) => item.event === 'login-done')
    assert.equal(done.tier, 'basic')
    assert.equal(done.requested, 4)
    assert.equal(done.granted, 2)
    assert.equal(done.missing, 2)
    const view = h.identity.view({ withCode: true })
    assert.deepEqual(view.loginFlow.missing, ['read:org', 'gist'])
    assert.equal(view.loginFlow.missingTotal, 2)

    // resetLogin：先 gh auth logout，再 kind=login
    const before = h.state.calls.length
    const again = h.identity.resetLogin({ tier: 'repo' })
    for (let i = 0; i < 50 && h.kinds.length < 2; i += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(h.state.calls.at(-1), ['auth', 'logout', '--hostname', 'github.com'])
    assert.equal(h.state.calls.length, before + 1)
    assert.deepEqual(h.kinds.at(-1), 'login')
    assert.ok(h.scopesSeen.at(-1).includes('admin:repo_hook'))
    h.children.at(-1).emit('exit', 1)
    await again.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 30))
  } finally { await h.cleanup() }
})


test('scope 核对：按隐含闭包判断，GitHub 归一化掉的低级 scope 不算缺', () => {
  // 实际归一化后常见的一组（2026-11-06 实测）
  const granted = ['admin:gpg_key', 'admin:org', 'admin:org_hook', 'admin:public_key', 'admin:repo_hook', 'codespace', 'delete:packages', 'delete_repo', 'gist', 'notifications', 'project', 'read:audit_log', 'repo', 'user', 'workflow', 'write:packages']
  assert.deepEqual(missingScopes(LOGIN_SCOPES, granted), [], '全部档在归一化后不应报缺')
  assert.deepEqual(missingScopes(SCOPE_TIERS.repo, granted), [], '仓库管理档也不应报缺')
  assert.deepEqual(missingScopes(SCOPE_TIERS.basic, ['repo', 'workflow']), ['read:org', 'gist'], '基础档真缺时才报')
  const implied = impliedScopes(['repo', 'admin:org'])
  for (const child of ['repo:status', 'public_repo', 'write:org', 'read:org', 'security_events']) assert.ok(implied.has(child), '缺少隐含 ' + child)
})


test('github 视图带每档 scope 清单：前端据此判断「已补足」', async () => {
  const h = await setup()
  try {
    const view = h.identity.view()
    assert.deepEqual(view.tiers.basic, SCOPE_TIERS.basic)
    assert.deepEqual(view.tiers.all, LOGIN_SCOPES)
  } finally { await h.cleanup() }
})
