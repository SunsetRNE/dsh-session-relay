/** 合并流水线中间态「本地已合入 · 待推送」（T18）：本地 main 只读判定 + approvalView 优先级 + 看板接线。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionRelay } from '../lib/impl.js'
import { loadLocalMain } from '../lib/tasks.js'

const gitRun = promisify(execFile)

/** 临时仓库：local main = base → both → localOnly；origin/main 只到 both；side 分支上的 side 提交不在任何一个 main。 */
async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'relay-local-main-'))
  const repo = join(dir, 'repo')
  await mkdir(repo, { recursive: true })
  const run = (...args) => gitRun('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: repo })
  const commit = async (message) => {
    await run('commit', '-q', '--allow-empty', '-m', message)
    return (await run('rev-parse', 'HEAD')).stdout.trim()
  }
  await run('init', '-q', '-b', 'main', '.')
  const base = await commit('base')
  const both = await commit('feat: 已 push 的提交')
  const localOnly = await commit('fix: 只合进本地 main')
  await run('update-ref', 'refs/remotes/origin/main', both)
  await run('checkout', '-q', '-b', 'side', both)
  const side = await commit('fix: 还没合')
  await run('checkout', '-q', 'main')
  return { dir, repo, base, both, localOnly, side, cleanup: async () => { await rm(dir, { recursive: true, force: true }) } }
}

function makeRelay(repo, sessionIds) {
  const dir = join(repo, '..')
  const ctx = {
    logger: { warn() {} },
    get: () => undefined,
    sessions: { get: () => undefined },
    workspaceRegistry: { list: () => [{ id: 'ws-a', title: 'repo', path: repo, sessionIds }] }
  }
  const relay = new SessionRelay(ctx, {
    aliasPath: join(dir, 'aliases.json'), statePath: join(dir, 'coordination.json'), templatePath: join(dir, 'templates.json'),
    handoffPath: join(dir, 'handoffs.json'), watchPath: join(dir, 'watches.json'), deadlinePath: join(dir, 'deadlines.json'),
    deadlineTickMs: 0, watch: false, githubAuto: false
  })
  return relay
}

test('本地 main 判定：local main 含 / 不含 / origin 优先 / 非 ready 不标', async () => {
  const f = await makeRepo()
  try {
    const mainShort = (await gitRun('git', ['rev-parse', '--short=8', 'refs/heads/main'], { cwd: f.repo })).stdout.trim()
    const index = await loadLocalMain(f.repo)
    assert.ok(index !== undefined, '读到 refs/heads/main')
    assert.equal(index.short, mainShort)
    assert.ok(index.reach.has(f.localOnly), '本地 main 的后继提交在集合里')
    assert.ok(index.reach.has(f.both), '祖先提交也在')
    assert.ok(!index.reach.has(f.side), '没合进 main 的分支提交不在集合里')

    const w1 = 'session-11111111-0000-0000-0000-000000000001'
    const w2 = 'session-22222222-0000-0000-0000-000000000002'
    const w3 = 'session-33333333-0000-0000-0000-000000000003'
    const w4 = 'session-44444444-0000-0000-0000-000000000004'
    const relay = makeRelay(f.repo, ['session-main1', w1, w2, w3, w4])
    await relay.ready()
    await relay.coord.setCoordinator('session-main1', f.repo, 'ws-a')
    await relay.coord.upsert(w1, { status: 'ready', summary: '本地已合入', commit: f.localOnly })
    await relay.coord.upsert(w2, { status: 'ready', summary: '还没合', commit: f.side })
    await relay.coord.upsert(w3, { status: 'ready', summary: '已 push', commit: f.both })
    await relay.coord.upsert(w4, { status: 'working', summary: '进行中', commit: f.localOnly })
    try {
      // origin/main 先核对：w3 属于 origin 已合入，本地中间态要让位（origin 优先）
      const origin = await relay.mainMergedFor('ws-a')
      assert.equal(origin.get(w3)?.kind, 'merged')

      const local = await relay.localMergedFor('ws-a')
      assert.equal(local.get(w1)?.kind, 'local', 'local main 含提交 → 标出来')
      assert.match(local.get(w1)?.where ?? '', /^local main [0-9a-f]{8}$/)
      assert.equal(local.has(w2), false, 'local main 不含的分支提交不标')
      assert.equal(local.has(w3), false, 'origin/main 已含的不算本地待推送')
      assert.equal(local.has(w4), false, '非 ready 条目不标')

      // approvalView 阶段优先级：merged(origin) > local-merged > approved > ready
      const entry = { status: 'ready', commit: f.localOnly }
      const approved = { status: 'approved', sha: f.localOnly }
      assert.equal(relay.approvalView({ ...entry, mainMerged: 'main abc', mainLocal: 'local main def' }, undefined).stage, 'merged')
      const localView = relay.approvalView({ ...entry, mainLocal: 'local main def' }, approved)
      assert.equal(localView.stage, 'local-merged', '本地已合入优先于已批准')
      assert.equal(localView.pendingPush, true)
      assert.equal(localView.localMerged, 'local main def')
      assert.equal(localView.tag, null, '还没发版，不给随版本发布 tag')
      assert.equal(relay.approvalView(entry, approved).stage, 'approved', '没有 main 事实时仍按批准')
      assert.equal(relay.approvalView(entry, undefined), undefined, '没有记录 / 事实时不给流水线')
      const released = relay.approvalView({ ...entry, mainMerged: 'main abc', mainLocal: 'local main def' }, undefined, { releasedTag: 'v2.4.3', fullyReleased: true })
      assert.equal(released.stage, 'released', 'origin 已发布仍最优先')

      // 看板接线：mainLocal 进条目，approval 走 local-merged；origin 已含的仍显示 merged
      const board = await relay.board(undefined, { session: 'session-main1' })
      const byId = Object.fromEntries(board.entries.map((item) => [item.sessionId, item]))
      assert.equal(byId[w1].mainLocal, local.get(w1).where)
      assert.equal(byId[w1].approval?.stage, 'local-merged')
      assert.equal(byId[w1].approval?.pendingPush, true)
      assert.equal(byId[w1].category, 'archived', '待推送的条目不再排在可合并队列')
      assert.equal(byId[w1].categoryReason, 'local-merged')
      assert.equal(byId[w3].mainLocal, undefined, 'origin/main 已含的条目不标本地中间态')
      assert.equal(byId[w3].approval?.stage, 'merged')
      assert.equal(byId[w2].approval, undefined, '还没合的分支没有流水线状态')
      assert.equal(byId[w4].approval, undefined, '非 ready 不给流水线')
    } finally {
      await relay.away.chain
    }
  } finally {
    await f.cleanup()
  }
})

test('本地 main 不存在时不判定（detached / 没有 refs/heads/main），不抛错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-local-nomain-'))
  const repo = join(dir, 'repo')
  try {
    await mkdir(repo, { recursive: true })
    const run = (...args) => gitRun('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: repo })
    await run('init', '-q', '-b', 'master', '.')
    await run('commit', '-q', '--allow-empty', '-m', 'base')
    assert.equal(await loadLocalMain(repo), undefined, '没有 refs/heads/main 就是 undefined，不猜')
    assert.equal(await loadLocalMain(join(dir, 'nope')), undefined, '目录不存在也不抛')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
