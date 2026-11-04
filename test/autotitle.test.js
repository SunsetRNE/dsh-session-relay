import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AutoTitle, TitleStore, claimTitle, planTitles } from '../lib/autotitle.js'

test('claimTitle：任务号自然排序、去重，超过 6 个收尾', () => {
  assert.equal(claimTitle([]), undefined)
  assert.equal(claimTitle(['T45']), 'T45')
  assert.equal(claimTitle(['T47', 'T46', 'T46']), 'T46 T47')
  assert.equal(claimTitle(['T10', 'T9']), 'T9 T10')
  assert.equal(claimTitle(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']), 'T1 T2 T3 T4 T5 T6 等 7 个')
})

test('planTitles：自动标题可覆盖；用户手动改过的不动；插件自己写过的可再改', () => {
  const wanted = new Map([['a', 'T1'], ['b', 'T2'], ['c', 'T3 T4'], ['d', 'T5']])
  const current = { a: { title: '你是工作区…', source: 'fallback' }, b: { title: '我的名字', source: 'user' }, c: { title: 'T3', source: 'user' }, d: { title: 'T5', source: 'user' } }
  const plan = planTitles({ wanted, current: (id) => current[id], applied: { c: 'T3' } })
  assert.deepEqual(plan.rename, [['a', 'T1'], ['c', 'T3 T4']])
  assert.deepEqual(plan.skipped, [['b', 'user-renamed']])
})

test('AutoTitle：改活会话的标题并记下；用户改过后不再动；没加载的跳过', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-title-'))
  try {
    const sessions = new Map([['s1', { id: 's1' }], ['s2', { id: 's2' }]])
    const titles = new Map([['s1', { title: '读 TASKS.md 认领', source: { kind: 'fallback' } }]])
    const service = {
      get: (session) => titles.get(session.id),
      rename: (session, title) => { const value = { title, source: { kind: 'user' } }; titles.set(session.id, value); return value }
    }
    let claims = new Map([['s1', ['T46', 'T45']], ['ghost', ['T9']]])
    const store = new TitleStore(join(dir, 'titles.json'))
    const runner = new AutoTitle({ store, targets: async () => claims, titles: () => service, session: (id) => sessions.get(id), intervalMs: 0 })
    let result = await runner.sync()
    assert.deepEqual(result.renamed, [['s1', 'T45 T46']])
    assert.equal(titles.get('s1').title, 'T45 T46')
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'titles.json'), 'utf8')).applied, { s1: 'T45 T46' })
    // 认领变了：插件写的标题可以再改
    claims = new Map([['s1', ['T45', 'T46', 'T47']]])
    result = await runner.sync()
    assert.equal(titles.get('s1').title, 'T45 T46 T47')
    // 用户手动改名后不再动
    service.rename({ id: 's1' }, '我自己起的')
    claims = new Map([['s1', ['T48']]])
    result = await runner.sync()
    assert.deepEqual(result.renamed, [])
    assert.equal(titles.get('s1').title, '我自己起的')
    // 认领全部结束：不改回去
    claims = new Map()
    await runner.sync()
    assert.equal(titles.get('s1').title, '我自己起的')
    // 没有标题服务：整个功能不可用，不报错
    const off = new AutoTitle({ store, targets: async () => claims, titles: () => undefined, session: () => undefined, intervalMs: 0 })
    assert.equal(off.available(), false)
    assert.deepEqual((await off.sync()).renamed, [])
    runner.dispose()
    assert.deepEqual((await runner.sync()).renamed, [], 'dispose 后不再改')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
