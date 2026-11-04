import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AliasStore, CoordStore, RelayError, RelayGuard, ReportBatcher, coordinatorContext, frameAgentMessage, frameReportBatch, hopFromEvents, hopOfMessage, workerContext, isWithin,
  parseRelayCommand, resolveTarget, shortId, validateAlias, validateText
} from '../lib/core.js'

const LONG = '读 /root/DSH-A-mod/.agents/TASKS.md，按「认领规则」认领一个可认领的最高优先任务并完成；\n只做该任务。git push 要加 -c http.curloptResolve=github.com:443:140.82.114.4 --new'

test('解析 new：选项只在正文前读取，正文原样保留（含换行与正文里的 --xxx）', () => {
  assert.deepEqual(parseRelayCommand(`new --cwd /root/DSH-A-mod --as lint ${LONG}`), {
    kind: 'spawn', text: LONG, cwd: '/root/DSH-A-mod', alias: 'lint'
  })
  assert.deepEqual(parseRelayCommand(`new ${LONG}`), { kind: 'spawn', text: LONG })
  assert.equal(parseRelayCommand('new').kind, 'invalid')
  assert.equal(parseRelayCommand('new --cwd').kind, 'invalid')
})

test('解析发送与模式', () => {
  assert.deepEqual(parseRelayCommand('release 先跑 lint'), { kind: 'send', target: 'release', mode: 'followup', text: '先跑 lint' })
  assert.deepEqual(parseRelayCommand('@x --steer 停一下'), { kind: 'send', target: '@x', mode: 'steer', text: '停一下' })
  assert.equal(parseRelayCommand('09cef708 --queue 稍后看').mode, 'queue')
  assert.equal(parseRelayCommand('x --steer --queue a').kind, 'invalid')
  assert.equal(parseRelayCommand('release').kind, 'invalid')
})

test('解析 help / list / alias', () => {
  assert.equal(parseRelayCommand('').kind, 'help')
  assert.equal(parseRelayCommand('  LS ').kind, 'list')
  assert.deepEqual(parseRelayCommand('alias rel'), { kind: 'alias', name: 'rel' })
  assert.deepEqual(parseRelayCommand('alias rel 09cef708'), { kind: 'alias', name: 'rel', target: '09cef708' })
  assert.equal(parseRelayCommand('alias rel a b').kind, 'invalid')
  assert.deepEqual(parseRelayCommand('unalias rel'), { kind: 'unalias', name: 'rel' })
})

test('别名校验', () => {
  assert.equal(validateAlias(' Release '), 'release')
  assert.throws(() => validateAlias('new'), RelayError)
  assert.throws(() => validateAlias('-x'), RelayError)
  assert.throws(() => validateAlias('有中文'), RelayError)
  assert.throws(() => validateAlias('a'.repeat(33)), RelayError)
})

test('正文校验', () => {
  assert.throws(() => validateText('   '), /不能为空/)
  assert.throws(() => validateText('x'.repeat(16001)), /超过/)
  assert.equal(validateText(' a '), 'a')
})

test('目标解析：别名 > 完整 id > ≥8 位唯一前缀', () => {
  const ids = ['09cef708-a86e-4579-97f3-8bed3e580c91', '09cef708-ffff-0000-0000-000000000000', '20de8458-ea11-4217-a205-2e2792382154']
  const aliases = { release: ids[2] }
  assert.equal(resolveTarget('Release', aliases, ids).sessionId, ids[2])
  assert.equal(resolveTarget('@release'.slice(1), aliases, ids).via, 'alias')
  assert.equal(resolveTarget(ids[0], aliases, ids).via, 'id')
  assert.equal(resolveTarget('20de8458', aliases, ids).sessionId, ids[2])
  assert.throws(() => resolveTarget('09cef708', aliases, ids), /匹配到 2 个/)
  assert.throws(() => resolveTarget('20de', aliases, ids), /至少需要 8 位/)
  assert.throws(() => resolveTarget('deadbeef', aliases, ids), /找不到/)
})

const relayMsg = (hop) => ({ source: { kind: 'agent-message', form: 'relay', senderSessionId: 's' }, content: [{ type: 'text', text: frameAgentMessage({ text: 'x', fromLabel: '@a', hop, maxHops: 8 }) }] })

test('hop：真人归零，中继按正文标记继承，其它来源不变；source 只含规范字段', () => {
  assert.equal(hopOfMessage({ source: { kind: 'user' } }), 0)
  assert.equal(hopOfMessage(relayMsg(2)), 2)
  assert.deepEqual(Object.keys(relayMsg(2).source).sort(), ['form', 'kind', 'senderSessionId'])
  assert.equal(hopOfMessage({ source: { kind: 'agent-message', form: 'relay', senderSessionId: 's' }, content: [{ type: 'text', text: 'team message' }] }), undefined)
  assert.equal(hopOfMessage({ source: { kind: 'runtime-context' } }), undefined)
  const batch = { source: { kind: 'agent-message' }, content: [{ type: 'text', text: frameReportBatch({ reports: [{ label: '@w', sessionId: 'w', status: 'ready', summary: 's' }], hop: 4, maxHops: 8 }) }] }
  assert.equal(hopOfMessage(batch), 4)
  const events = [
    { type: 'user/message', data: relayMsg(2) },
    { type: 'user/message', data: { source: { kind: 'runtime-context' } } },
    { type: 'turn/start', data: {} }
  ]
  assert.equal(hopFromEvents(events), 2)
  assert.equal(hopFromEvents([...events, { type: 'user/message', data: { source: { kind: 'user' } } }]), 0)
  assert.equal(hopFromEvents([]), 0)
})

test('防循环：A→B→A… 在第 maxHops 跳后拒绝；主会话配对用更宽上限', () => {
  const guard = new RelayGuard({ maxHops: 3, coordinatorMaxHops: 5 })
  guard.observe('A', { source: { kind: 'user' } })
  const h1 = guard.admitSend('A')
  guard.observe('B', relayMsg(h1))
  const h2 = guard.admitSend('B')
  guard.observe('A', relayMsg(h2))
  const h3 = guard.admitSend('A')
  guard.observe('B', relayMsg(h3))
  assert.deepEqual([h1, h2, h3], [1, 2, 3])
  assert.throws(() => guard.admitSend('B'), (error) => error.code === 'hop_limit')
  assert.equal(guard.admitSend('B', 'send', guard.coordinatorMaxHops), 4)
  guard.observe('B', { source: { kind: 'user' } })
  assert.equal(guard.admitSend('B'), 1)
})

test('限流：窗口内超限拒绝，窗口过后恢复；forget 不清限流', () => {
  let now = 0
  const guard = new RelayGuard({ sendLimit: 2, sendWindowMs: 1000, spawnLimit: 1, spawnWindowMs: 1000, now: () => now })
  guard.admitSend('A'); guard.admitSend('A')
  assert.throws(() => guard.admitSend('A'), (error) => error.code === 'rate_limited')
  guard.admitSend('A', 'spawn')
  assert.throws(() => guard.admitSend('A', 'spawn'), (error) => error.code === 'rate_limited')
  guard.forget('A')
  assert.throws(() => guard.admitSend('A'), (error) => error.code === 'rate_limited')
  now = 1500
  assert.equal(guard.admitSend('A'), 1)
})

test('Agent 消息封装声明不是用户授权', () => {
  const text = frameAgentMessage({ text: 'hi', fromLabel: '@a', hop: 1, maxHops: 3 })
  assert.match(text, /不是用户本人的指令/)
  assert.match(text, /第 1\/3 跳/)
  assert.ok(text.endsWith('hi'))
})

test('别名存储：原子写入、权限 0600、重载、移除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-'))
  try {
    const path = join(dir, 'nested', 'aliases.json')
    const store = new AliasStore(path)
    assert.equal(await store.set('Rel', 's1'), undefined)
    assert.equal(await store.set('rel', 's2'), 's1')
    await Promise.all([store.set('a', 'x'), store.set('b', 'y')])
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    const reloaded = new AliasStore(path)
    assert.deepEqual(await reloaded.load(), { rel: 's2', a: 'x', b: 'y' })
    assert.equal(await reloaded.remove('rel'), 's2')
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')).aliases, { a: 'x', b: 'y' })
    await assert.rejects(store.set('new', 'z'), RelayError)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('解析 main / board / drop；main 后跟正文是发给主会话', () => {
  assert.deepEqual(parseRelayCommand('main'), { kind: 'main-show' })
  assert.deepEqual(parseRelayCommand('main here'), { kind: 'main-set' })
  assert.deepEqual(parseRelayCommand('main set rel'), { kind: 'main-set', target: 'rel' })
  assert.deepEqual(parseRelayCommand('main clear'), { kind: 'main-clear' })
  assert.deepEqual(parseRelayCommand('main 版本线定为 build273'), { kind: 'send', target: 'main', mode: 'followup', text: '版本线定为 build273' })
  assert.deepEqual(parseRelayCommand('board'), { kind: 'board' })
    assert.throws(() => validateAlias('main'), RelayError)
})

test('目标 main 解析为主会话；未指定时报错', () => {
  const ids = ['20de8458-ea11-4217-a205-2e2792382154']
  assert.equal(resolveTarget('@main', {}, ids, ids[0]).sessionId, ids[0])
  assert.throws(() => resolveTarget('main', {}, ids, undefined), /还没有指定主会话/)
})

test('isWithin 按路径段判断', () => {
  assert.ok(isWithin('/root/DSH-A-mod/.agents/worktrees/fix/a', '/root/DSH-A-mod'))
  assert.ok(isWithin('/root/DSH-A-mod', '/root/DSH-A-mod/'))
  assert.ok(!isWithin('/root/DSH-A-mod-2', '/root/DSH-A-mod'))
})

test('汇报合并：同一目标窗口内只投递一次，同一发送方保留最后一条', async () => {
  const timers = []
  const delivered = []
  const batcher = new ReportBatcher({ delayMs: 10, deliver: async (target, reports) => { delivered.push([target, reports]) }, setTimer: (fn) => { timers.push(fn); return timers.length }, clearTimer: () => {} })
  batcher.add('main', { sessionId: 'w1', status: 'working', summary: 'a' })
  batcher.add('main', { sessionId: 'w2', status: 'ready', summary: 'b' })
  assert.equal(batcher.add('main', { sessionId: 'w1', status: 'ready', summary: 'c' }), 2)
  assert.equal(timers.length, 1)
  await timers[0]()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(delivered.length, 1)
  assert.deepEqual(delivered[0][1].map((r) => r.summary), ['c', 'b'])
  batcher.add('main', { sessionId: 'w1', status: 'done', summary: 'd' })
  await batcher.flushAll()
  assert.equal(delivered.length, 2)
})

test('协调状态：接管主会话、看板合并更新、裁剪与持久化', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'coord-'))
  try {
    let now = 1_000
    const path = join(dir, 'coordination.json')
    const store = new CoordStore(path, { staleMs: 100, maxAgeMs: 10_000, now: () => now })
    await store.upsert('w1', { status: 'working', summary: '改 lint', branch: 'fix/lint' })
    await store.upsert('w1', { status: 'ready', commit: 'abc1234', summary: undefined })
    assert.deepEqual(store.snapshot().board.w1, { status: 'ready', summary: '改 lint', branch: 'fix/lint', commit: 'abc1234', updatedAt: 1000 })
    assert.equal(await store.setCoordinator('m1', '/root/DSH-A-mod'), undefined)
    assert.equal(await store.setCoordinator('w1', '/root/DSH-A-mod'), 'm1')
    assert.equal(store.snapshot().board.w1, undefined, '新主会话移出看板')
    await store.upsert('w2', { status: 'done', summary: 'x' })
    now = 2_000
    await store.upsert('w3', { status: 'bogus', summary: 'y' })
    assert.equal(store.snapshot().board.w2, undefined, '已完成的过期记录被裁剪')
    assert.equal(store.snapshot().board.w3.status, undefined, '非法状态被丢弃')
    const reloaded = new CoordStore(path)
    const loaded = await reloaded.load()
    assert.equal(loaded.coordinator.sessionId, 'w1')
    assert.equal(loaded.coordinator.cwd, '/root/DSH-A-mod')
    assert.equal((await stat(path)).mode & 0o777, 0o600)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('上下文文本：主会话看看板，工作会话看汇报方式；时间不用相对值', () => {
  const board = { w1: { status: 'question', summary: '要不要改版本号', question: 'build273 还是 274？', updatedAt: Date.UTC(2026, 10, 2, 17, 0) } }
  const main = coordinatorContext({ board, labelFor: (id) => '@' + id, selfId: 'm' })
  assert.match(main, /role="main"/)
  assert.match(main, /@w1 w1 · 待答复/)
  assert.match(main, /问题：build273/)
  assert.doesNotMatch(main, /分钟前/)
  const worker = workerContext({ coordinatorLabel: '@m', entry: board.w1 })
  assert.match(worker, /Main session: @m/)
  assert.match(worker, /peer_report/)
})

test('session- 前缀的 id：短 id 去掉前缀，前缀匹配带不带 session- 都可以', () => {
  const ids = ['session-7ea4fd68-f693-4589-93e2-29868349ee4f', 'session-2b3fef60-00f7-4698-b7de-6111c3fdabd0']
  assert.equal(shortId(ids[0]), '7ea4fd68')
  assert.equal(resolveTarget('7ea4fd68', {}, ids).sessionId, ids[0])
  assert.equal(resolveTarget('session-2b3fef60', {}, ids).sessionId, ids[1])
  assert.throws(() => resolveTarget('session-', {}, ids), /至少需要 8 位/)
})

test('解析 line / tpl / leave / --tpl', () => {
  assert.deepEqual(parseRelayCommand('line'), { kind: 'line-show' })
  assert.deepEqual(parseRelayCommand('line clear'), { kind: 'line-clear' })
  assert.deepEqual(parseRelayCommand('line main=build280\n推前 lint'), { kind: 'line-set', text: 'main=build280\n推前 lint' })
  assert.deepEqual(parseRelayCommand('tpl'), { kind: 'tpl-list' })
  assert.deepEqual(parseRelayCommand('tpl save claim 第一行\n第二行'), { kind: 'tpl-save', name: 'claim', text: '第一行\n第二行' })
  assert.deepEqual(parseRelayCommand('tpl show claim'), { kind: 'tpl-show', name: 'claim' })
  assert.deepEqual(parseRelayCommand('tpl rm claim'), { kind: 'tpl-remove', name: 'claim' })
  assert.equal(parseRelayCommand('tpl save claim').kind, 'invalid')
  assert.deepEqual(parseRelayCommand('new --as c1 --tpl claim'), { kind: 'spawn', text: '', alias: 'c1', template: 'claim' })
  assert.deepEqual(parseRelayCommand('c1 --tpl claim 补充'), { kind: 'send', target: 'c1', mode: 'followup', text: '补充', template: 'claim' })
  assert.deepEqual(parseRelayCommand('leave'), { kind: 'leave' })
  assert.deepEqual(parseRelayCommand('drop lint'), { kind: 'leave', target: 'lint' })
  assert.throws(() => validateAlias('line'), RelayError)
})

test('版本线与退出标记持久化', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'coord-line-'))
  try {
    const path = join(dir, 'c.json')
    const store = new CoordStore(path, { now: () => 5 })
    await assert.rejects(store.setLine('  '), /不能为空/)
    await assert.rejects(store.setLine('x'.repeat(1501)), /超过/)
    await store.setLine('main=build280', 'user', 's1')
    await store.upsert('w', { status: 'working', summary: 'a' })
    assert.equal(await store.leave('w'), true)
    const loaded = await new CoordStore(path).load()
    assert.deepEqual(loaded.line, { text: 'main=build280', setAt: 5, setBy: 'user', bySessionId: 's1' })
    assert.deepEqual(loaded.optOut, ['w'])
    assert.equal(loaded.board.w, undefined)
    assert.equal(await store.join('w'), true)
    assert.deepEqual((await new CoordStore(path).load()).optOut, [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('--tpl / --as 后紧跟中文标点和正文时，正确拆出名字', () => {
  assert.deepEqual(parseRelayCommand('new --as xx --tpl claim，告诉我能否看到版本基线即可'), { kind: 'spawn', text: '告诉我能否看到版本基线即可', alias: 'xx', template: 'claim' })
  assert.deepEqual(parseRelayCommand('new --as xx，--tpl claim 正文'), { kind: 'spawn', text: '正文', alias: 'xx', template: 'claim' })
  assert.deepEqual(parseRelayCommand('c1 --tpl claim。再来一个'), { kind: 'send', target: 'c1', mode: 'followup', text: '再来一个', template: 'claim' })
  assert.equal(parseRelayCommand('new --tpl 认领 x').kind, 'invalid')
})

test('协调状态 v1 → v2：旧的全局主会话 / 版本线读进默认分组，写回 v2', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'coord-v1-'))
  try {
    const path = join(dir, 'c.json')
    await writeFile(path, JSON.stringify({ version: 1, coordinator: { sessionId: 'm', since: 1, cwd: '/r' }, line: { text: 'L', setAt: 2, setBy: 'user' }, links: {}, board: { w: { status: 'working', summary: 's', updatedAt: Date.now() } } }))
    const store = new CoordStore(path)
    const loaded = await store.load()
    assert.equal(loaded.groups._.coordinator.sessionId, 'm')
    assert.equal(loaded.line.text, 'L')
    assert.equal(await store.migrateGroup('_', 'ws1'), true)
    const raw = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(raw.version, 2)
    assert.equal(raw.groups.ws1.coordinator.sessionId, 'm')
    assert.equal(raw.groups.ws1.line.text, 'L')
    assert.equal(raw.coordinator, undefined)
    assert.equal(raw.board.w.status, 'working')
    // 同一会话不能同时当两个工作区的主会话
    await store.setCoordinator('m', '/r', 'ws2')
    assert.equal(store.coordinatorId('ws1'), undefined)
    assert.equal(store.coordinatorId('ws2'), 'm')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
