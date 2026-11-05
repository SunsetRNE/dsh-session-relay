// 会话 checkout 识别（B）与 /relay wt 命令解析（C）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkoutOf, createCheckoutCache, parseCheckoutOutput, sessionCwd } from '../lib/checkout.js'
import { parseRelayCommand } from '../lib/core.js'

const git = (cwd, ...args) => new Promise((resolve, reject) => {
  execFile('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd }, (error, stdout) => error ? reject(new Error(String(error?.message))) : resolve(String(stdout).trim()))
})

test('parseCheckoutOutput：主检出 / 工作树 / detached', () => {
  assert.deepEqual(parseCheckoutOutput('/r\nfeat/x\n.git\n.git', '/r'), { path: '/r', branch: 'feat/x', detached: false, linked: false })
  assert.deepEqual(parseCheckoutOutput('/r/w\nfeat/y\n/r/.git/worktrees/w\n/r/.git', '/r/w'), { path: '/r/w', branch: 'feat/y', detached: false, linked: true })
  assert.deepEqual(parseCheckoutOutput('/r\nHEAD\n.git\n.git', '/r'), { path: '/r', branch: undefined, detached: true, linked: false })
  assert.equal(parseCheckoutOutput('', '/r'), undefined)
})

test('checkoutOf：普通仓库读分支；工作树读分支与分叉点；非 git 目录给 undefined', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-checkout-'))
  try {
    await git(root, 'init', '-q', '--initial-branch=main')
    await writeFile(join(root, 'a.txt'), 'a\n')
    await git(root, 'add', 'a.txt')
    await git(root, 'commit', '-q', '-m', 'base')
    const plain = await checkoutOf(root)
    assert.equal(plain.branch, 'main')
    assert.equal(plain.linked, false)

    // 官方工作树的样子：分支 + 单独目录，git 登记为 linked worktree
    const linked = join(root, '.agents/worktrees/dsh-6b1f02c4-9a3e')
    await mkdir(join(root, '.agents/worktrees'), { recursive: true })
    await git(root, 'worktree', 'add', '-q', '-b', 'dsh-6b1f02c4-9a3e', linked, 'main')
    const info = await checkoutOf(linked)
    assert.equal(info.branch, 'dsh-6b1f02c4-9a3e')
    assert.equal(info.linked, true)
    assert.equal(info.baseRef, 'main', '没有 origin/main 时退回本地 main')
    assert.match(info.base, /^[0-9a-f]{40}$/)

    assert.equal(await checkoutOf(join(root, 'nope')), undefined)
    assert.equal(await checkoutOf(''), undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('createCheckoutCache：TTL 内命中缓存、过期重读、容量有上限', async () => {
  let at = 1000
  let reads = 0
  const cache = createCheckoutCache({ now: () => at, ttlMs: 100, max: 2, read: async (cwd) => { reads += 1; return { path: cwd } } })
  assert.deepEqual(await cache.get('/a'), { path: '/a' })
  assert.deepEqual(await cache.get('/a'), { path: '/a' })
  assert.equal(reads, 1, 'TTL 内不重复读')
  at += 1000
  await cache.get('/a')
  assert.equal(reads, 2, '过期后重读')
  await cache.get('/b'); await cache.get('/c')
  assert.equal(cache.size(), 2, '容量上限生效')
  assert.equal(await cache.get(''), undefined)
})

test('sessionCwd：优先宿主 workingDirectory 服务，其次会话对象上的字段', () => {
  const session = { id: 's1', cwd: '/from-session' }
  const withService = { sessions: { get: () => session }, get: (name) => name === 'workingDirectory' ? { get: () => '/from-service' } : undefined }
  assert.equal(sessionCwd(withService, 's1'), '/from-service')
  const withoutService = { sessions: { get: () => session }, get: () => undefined }
  assert.equal(sessionCwd(withoutService, 's1'), '/from-session')
  assert.equal(sessionCwd({ sessions: { get: () => undefined } }, 'nope'), undefined)
  assert.equal(sessionCwd(undefined, 's1'), undefined)
})

test('/relay wt 解析：目标、--from、--name；用法错误给提示', () => {
  assert.deepEqual(parseRelayCommand('wt @w1'), { kind: 'worktree', target: '@w1' })
  assert.deepEqual(parseRelayCommand('worktree @w1 --from origin/main --name fix/x'), { kind: 'worktree', target: '@w1', from: 'origin/main', name: 'fix/x' })
  assert.equal(parseRelayCommand('wt').kind, 'invalid')
  assert.equal(parseRelayCommand('wt @w1 多余参数').kind, 'invalid')
  // wt 是保留字，不会被当成别名指令
  assert.notEqual(parseRelayCommand('wt @w1').kind, 'send')
})
