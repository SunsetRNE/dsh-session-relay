import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WatchRunner, WatchStore, evaluate, pickRef, repoFromUrl, validateWatchRequest } from '../lib/watch.js'
import { ChainWatch } from '../lib/chainwatch.js'

async function harness({ ci, ref, deliverFails = 0 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'relay-watch-'))
  let now = Date.UTC(2026, 10, 4, 12)
  const delivered = []
  const phoned = []
  let failsLeft = deliverFails
  const checkers = { repoOf: async () => 'o/r', ci: ci ?? (async () => ({ done: false, status: 'in_progress' })), ref: ref ?? (async () => ({ sha: null })) }
  const make = () => new WatchRunner({
    store: new WatchStore(join(dir, 'w.json')), checkers, tickMs: 0, now: () => now,
    resolveTarget: (item) => item.createdBy,
    deliver: async (to, text) => { if (failsLeft > 0) { failsLeft -= 1; throw new Error('offline') } delivered.push([to, text]) },
    notify: async (title, text) => { phoned.push([title, text]) }
  })
  return { dir, make, delivered, phoned, checkers, advance: (ms) => { now += ms }, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('核验：参数校验、ref 精确匹配、repo 推断', () => {
  assert.throws(() => validateWatchRequest({ kind: 'ci', runId: '12; rm -rf /', cwd: '/a' }), /数字 run id/)
  assert.throws(() => validateWatchRequest({ kind: 'ref', ref: '--upload-pack=x', cwd: '/a' }), /分支或 tag/)
  assert.throws(() => validateWatchRequest({ kind: 'ref', ref: 'main', remote: '-x', cwd: '/a' }), /远端名/)
  assert.throws(() => validateWatchRequest({ kind: 'ci', runId: '1', cwd: 'rel' }), /绝对路径/)
  assert.equal(validateWatchRequest({ kind: 'ref', ref: 'main', sha: 'ABCDEF12', cwd: '/a' }, { now: 0 }).sha, 'abcdef12')
  assert.equal(pickRef('1111111111111111111111111111111111111111\trefs/heads/x/main\n', 'main'), null)
  assert.equal(repoFromUrl('https://github.com/SunsetRNE/DSHA-Sunset-mod.git'), 'SunsetRNE/DSHA-Sunset-mod')
  assert.equal(repoFromUrl('git@github.com:a/b.git'), 'a/b')
  const base = { kind: 'ref', remote: 'origin', ref: 'main' }
  assert.deepEqual(evaluate(base, { sha: 'aaa' }), { last: { sha: 'aaa' }, baseline: 'aaa' })
  assert.equal(evaluate({ ...base, baseline: 'aaa' }, { sha: 'bbb' }).state, 'done')
})

test('核验：CI 跑完才通知一次；重启后不重复；停机期间完成的照样补查补发', async () => {
  let status = { done: false, status: 'in_progress' }
  const h = await harness({ ci: async () => status })
  try {
    const runner = h.make()
    const { item } = await runner.add({ kind: 'ci', runId: '41815663194', cwd: h.dir, label: 'build308' }, { group: 'g', createdBy: 'main-1', origin: 'user' })
    await runner.firstCheck
    await runner.firstCheck
    assert.equal(item.repo, 'o/r')
    await runner.tick()
    assert.equal(h.delivered.length, 0)
    // “DSH 停机”：换一个新 runner（同一文件），期间 CI 完成
    status = { done: true, ok: true, status: 'completed', conclusion: 'success', sha: 'd6ce6f5d0000', title: 'release' }
    h.advance(10 * 60_000)
    const restarted = h.make()
    await restarted.tick()
    assert.equal(h.delivered.length, 1)
    assert.match(h.delivered[0][1], /核验结果[\s\S]*✓ CI 41815663194「release」 成功（sha d6ce6f5d）/)
    assert.equal(h.phoned.length, 1)
    await h.make().tick()
    assert.equal(h.delivered.length, 1, '同一结果只通知一次')
    const saved = JSON.parse(await readFile(join(h.dir, 'w.json'), 'utf8'))
    assert.equal(saved.items[0].state, 'done')
    assert.ok(saved.items[0].notified)
  } finally { await h.cleanup() }
})

test('核验：投递失败保留待发，下一轮补发；手机通知只发一次', async () => {
  const h = await harness({ ref: async () => ({ sha: 'abcdef1234' }), deliverFails: 2 })
  try {
    const runner = h.make()
    await runner.add({ kind: 'ref', ref: 'main', sha: 'abcdef12', cwd: h.dir }, { group: 'g', createdBy: 'main-1', origin: 'model' })
    await runner.firstCheck
    // 登记时那次查询已投递失败 1 次；再一轮还失败
    await runner.tick()
    assert.equal(h.delivered.length, 0)
    // 换新实例（重启）后补发成功
    await h.make().tick()
    assert.equal(h.delivered.length, 1)
    assert.match(h.delivered[0][1], /远端 origin\/main 已是期望的 abcdef12/)
    assert.equal(h.phoned.length, 1)
  } finally { await h.cleanup() }
})

test('核验：查询失败按退避重试，连续 5 次发一次失败通知，恢复后发恢复；超时发超时', async () => {
  let fail = true
  const h = await harness({ ci: async () => { if (fail) throw new Error('gh: network'); return { done: false, status: 'queued' } } })
  try {
    const runner = h.make()
    await runner.add({ kind: 'ci', runId: '1', repo: 'o/r', cwd: h.dir, deadlineHours: 1 }, { group: 'g', createdBy: 'm', origin: 'user' })
    await runner.firstCheck
    for (let i = 0; i < 5; i += 1) { h.advance(11 * 60_000); await runner.tick() }
    const failures = h.delivered.filter(([, text]) => /连续 5 次失败/.test(text))
    assert.equal(failures.length, 1)
    fail = false
    h.advance(11 * 60_000)
    await runner.tick()
    // 恢复与超时同一轮出现时并成一条，不互相覆盖
    assert.ok(h.delivered.some(([, text]) => /已恢复/.test(text)))
    h.advance(2 * 3600_000)
    await runner.tick()
    assert.ok(h.delivered.some(([, text]) => /超时/.test(text)))
    assert.equal(runner.list('g')[0].state, 'timeout')
  } finally { await h.cleanup() }
})

test('推送链：已看到的末行持久化，重启后停机期间的 DONE 照样提醒；投递失败下一轮重试', async () => {
  let saved = {}
  let last = 'push 1'
  let failNext = true
  const delivered = []
  const make = () => new ChainWatch({
    intervalMs: 0,
    targets: () => [{ key: 'g', coordinatorId: 'main', root: '/r', workspaceTitle: 'W' }],
    scan: async () => ({ background: [{ rel: 'wt', logs: [{ path: '/r/chain.log', last, finished: /DONE/.test(last) }] }] }),
    deliver: async (to, text) => { if (failNext && /DONE/.test(text)) { failNext = false; throw new Error('x') } delivered.push(text) },
    notify: async () => {},
    loadSeen: async () => saved,
    saveSeen: async (seen) => { saved = JSON.parse(JSON.stringify(seen)) }
  })
  await make().poll()
  assert.deepEqual(saved, { '/r': { '/r/chain.log': 'push 1' } })
  last = 'CHAIN_DONE'
  const after = make()
  await after.poll()
  assert.equal(delivered.length, 0, '投递失败')
  await after.poll()
  assert.equal(delivered.length, 1, '下一轮补发')
  await make().poll()
  assert.equal(delivered.length, 1, '重启后不重复')
})
