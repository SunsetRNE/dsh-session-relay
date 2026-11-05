import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
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
    // 登记时那次查询已投递失败 1 次；退避时间没到不重试
    await runner.tick()
    assert.equal(h.delivered.length, 0)
    h.advance(31_000)
    await runner.tick()
    assert.equal(h.delivered.length, 0, '第二次也失败')
    h.advance(61_000)
    // 换新实例（重启）后补发成功
    await h.make().tick()
    assert.equal(h.delivered.length, 1)
    assert.match(h.delivered[0][1], /远端 origin\/main 已是期望的 abcdef12/)
    assert.equal(h.phoned.length, 1)
  } finally { await h.cleanup() }
})

test('核验：CI 结论为 cancelled 记成「已取消」并按好消息通知一次（不挂红色告警）', () => {
  const item = { kind: 'ci', runId: '42074880855', repo: 'o/r' }
  const outcome = evaluate(item, { done: true, ok: false, status: 'completed', conclusion: 'cancelled', sha: 'abc1234', title: 'PR check', url: 'https://x' }, Date.now())
  assert.equal(outcome.state, 'cancelled')
  assert.equal(outcome.notice.ok, true, '被取代的取消不算坏消息')
  assert.match(outcome.notice.text, /已取消/)
  assert.doesNotMatch(outcome.notice.text, /结束：cancelled/)
  const failed = evaluate(item, { done: true, ok: false, status: 'completed', conclusion: 'failure', sha: 'abc1234', title: 'PR check' }, Date.now())
  assert.equal(failed.state, 'failed')
  assert.equal(failed.notice.ok, false)
  assert.match(failed.notice.text, /结束：failure/)
})

test('核验：查询失败按退避重试，连续 5 次发一次失败通知，恢复后发恢复；超时发超时', async () => {
  let fail = true
  const h = await harness({ ci: async () => { if (fail) throw new Error('gh: network'); return { done: false, status: 'queued' } } })
  try {
    const runner = h.make()
    await runner.add({ kind: 'ci', runId: '1', repo: 'o/r', cwd: h.dir, deadlineHours: 1 }, { group: 'g', createdBy: 'm', origin: 'user' })
    await runner.firstCheck
    for (let i = 0; i < 5; i += 1) { h.advance(11 * 60_000); await runner.tick() }
    const failures = h.delivered.filter(([, text]) => /连续 5 次没查到结果/.test(text))
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
  const { __polledAt, ...logs } = saved
  assert.deepEqual(logs, { '/r': { '/r/chain.log': 'push 1' } })
  assert.ok(__polledAt > 0, '轮询时间持久化')
  last = 'CHAIN_DONE'
  const after = make()
  await after.poll()
  assert.equal(delivered.length, 0, '投递失败')
  await after.poll()
  assert.equal(delivered.length, 1, '下一轮补发')
  await make().poll()
  assert.equal(delivered.length, 1, '重启后不重复')
})

test('核验审计修复：附注 tag 两种 sha 都认；基线取登记那一刻；永久错误拒绝；远端变成别的 sha 提醒一次', async () => {
  const tagOut = 'aaaaaaa000000000000000000000000000000000\trefs/tags/v1\ncccccccc00000000000000000000000000000000\trefs/tags/v1^{}\n'
  const { pickRefDetail, isPermanentError } = await import('../lib/watch.js')
  assert.deepEqual(pickRefDetail(tagOut, 'v1'), { sha: 'cccccccc00000000000000000000000000000000', object: 'aaaaaaa000000000000000000000000000000000' })
  assert.equal(evaluate({ kind: 'ref', remote: 'origin', ref: 'v1', sha: 'aaaaaaa' }, pickRefDetail(tagOut, 'v1'), 0).state, 'done', '填 tag 对象 sha')
  assert.equal(evaluate({ kind: 'ref', remote: 'origin', ref: 'v1', sha: 'cccccccc' }, pickRefDetail(tagOut, 'v1'), 0).state, 'done', '填提交 sha')
  assert.ok(isPermanentError(new Error('spawn gh ENOENT')))
  assert.ok(isPermanentError(new Error('HTTP 404: Not Found')))
  assert.ok(!isPermanentError(new Error('Could not resolve host: github.com')))

  // 基线：登记时 tag 不存在；第一次轮询失败期间 tag 出现，之后照样通知
  let remote = { sha: null }
  let failing = false
  const h = await harness({ ref: async () => { if (failing) throw new Error('network'); return remote } })
  try {
    const runner = h.make()
    const { item } = await runner.add({ kind: 'ref', ref: 'v2', cwd: h.dir }, { group: 'g', createdBy: 'm', origin: 'user' })
    assert.equal(item.baseline, null, '基线是登记时的远端（不存在）')
    failing = true
    await runner.firstCheck
    remote = { sha: 'dddddddd00000000000000000000000000000000' }
    failing = false
    h.advance(2 * 60_000)
    await runner.tick()
    assert.ok(h.delivered.some(([, text]) => /新建 → dddddddd/.test(text)), '不会把新 tag 当基线吞掉')
  } finally { await h.cleanup() }

  // 永久错误：登记直接拒绝；“等变化”查不到现状也拒绝
  const bad = await harness({ ref: async () => { throw new Error('fatal: No such remote origin2') }, ci: async () => { throw new Error('HTTP 404: Not Found') } })
  try {
    await assert.rejects(bad.make().add({ kind: 'ci', runId: '9', repo: 'o/r', cwd: bad.dir }, { group: 'g', origin: 'user' }), /不会自己好/)
    await assert.rejects(bad.make().add({ kind: 'ref', ref: 'main', cwd: bad.dir }, { group: 'g', origin: 'user' }), /不会自己好/)
  } finally { await bad.cleanup() }
  const flaky = await harness({ ref: async () => { throw new Error('network down') } })
  try {
    await assert.rejects(flaky.make().add({ kind: 'ref', ref: 'main', cwd: flaky.dir }, { group: 'g', origin: 'user' }), /没法记基线/)
  } finally { await flaky.cleanup() }

  // 给了期望 sha、远端被推成别的：提醒一次，继续等
  let now = { sha: '1111111100000000000000000000000000000000' }
  const fp = await harness({ ref: async () => now })
  try {
    const runner = fp.make()
    await runner.add({ kind: 'ref', ref: 'main', sha: 'eeeeeeee', cwd: fp.dir }, { group: 'g', createdBy: 'm', origin: 'user' })
    await runner.firstCheck
    assert.equal(fp.delivered.length, 0, '和登记时一样，不提醒')
    now = { sha: '2222222200000000000000000000000000000000' }
    fp.advance(2 * 60_000); await runner.tick()
    fp.advance(2 * 60_000); await runner.tick()
    const notes = fp.delivered.filter(([, text]) => /变成了 22222222.*不是期望的 eeeeeeee/.test(text))
    assert.equal(notes.length, 1)
    assert.equal(runner.list('g')[0].state, 'active')
  } finally { await fp.cleanup() }
})

test('核验审计修复：投递失败 24 小时才放弃；watches.json 损坏先留底', async () => {
  const h = await harness({ ref: async () => ({ sha: 'abcdef1234' }), deliverFails: 1000 })
  try {
    const runner = h.make()
    await runner.add({ kind: 'ref', ref: 'main', sha: 'abcdef12', cwd: h.dir }, { group: 'g', createdBy: 'm', origin: 'user' })
    await runner.firstCheck
    for (let i = 0; i < 20; i += 1) { h.advance(10 * 60_000); await runner.tick() }
    assert.ok(runner.list('g')[0].pending, '3 小时后还在重试')
    h.advance(24 * 3600_000); await runner.tick()
    assert.equal(runner.list('g')[0].notified.gaveUp, true)
  } finally { await h.cleanup() }
  const dir = await mkdtemp(join(tmpdir(), 'relay-corrupt-'))
  try {
    await writeFile(join(dir, 'w.json'), '{"items": [')
    const store = new WatchStore(join(dir, 'w.json'), { now: () => 42 })
    await store.load()
    assert.equal(await readFile(join(dir, 'w.json.corrupt-42'), 'utf8'), '{"items": [')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('推送链：第一次见到的日志若在上一轮轮询之后才结束，照样提醒', async () => {
  const delivered = []
  const start = Date.now()
  const chain = new ChainWatch({
    intervalMs: 0,
    targets: () => [{ key: 'g', coordinatorId: 'main', root: '/r' }],
    scan: async () => ({ background: [{ rel: 'wt', logs: [
      { path: '/r/old.log', last: 'CHAIN_DONE', finished: true, mtimeMs: start - 3600_000 },
      { path: '/r/new.log', last: 'CHAIN_DONE', finished: true, mtimeMs: start + 1000 }
    ] }] }),
    deliver: async (_to, text) => { delivered.push(text) }
  })
  await chain.poll()
  assert.equal(delivered.length, 1)
  assert.match(delivered[0], /new\.log/)
  assert.doesNotMatch(delivered[0], /old\.log/)
})
