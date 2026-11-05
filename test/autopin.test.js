/** 侧栏自动置顶：只动插件自己置顶的；主会话在最上面；用户取消后不抢回。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planPins } from '../lib/autopin.js'

test('planPins：工作会话先、主会话最后置顶；已置顶（含手动）不重复', () => {
  const plan = planPins({ key: 'w', wanted: ['a', 'b'], main: 'm', pinned: ['b'], owned: {}, declined: [] })
  assert.deepEqual(plan.pin, ['a', 'm'])
  assert.deepEqual(plan.unpin, [])
})

test('planPins：做完的取消；用户手动置顶的不取消；用户取消插件置顶的记 declined 不抢回', () => {
  const plan = planPins({ key: 'w', wanted: ['a'], main: 'm', pinned: ['m', 'done', 'manual'], owned: { m: 'w', done: 'w', a: 'w', other: 'x' }, declined: [] })
  assert.deepEqual(plan.unpin, ['done'])
  assert.ok(!plan.unpin.includes('manual'))
  assert.ok(!plan.unpin.includes('other'))
  assert.deepEqual(plan.decline, ['a'])
  assert.ok(!plan.pin.includes('a'))
  // 不再“还在做”就清掉 declined
  assert.deepEqual(planPins({ key: 'w', wanted: [], pinned: [], owned: {}, declined: ['a'] }).undecline, ['a'])
})


test('kick：看板变化后尽快跑一轮；多次合并；正在跑时跑完补一轮；没开启不跑；dispose 后取消', async () => {
  const { AutoPin } = await import('../lib/autopin.js')
  const timers = []
  const setTimeoutFn = (fn) => { const t = { fn, cleared: false }; timers.push(t); return t }
  const clearTimeoutFn = (t) => { t.cleared = true }
  const fire = () => { const due = timers.splice(0).filter((t) => !t.cleared); for (const t of due) t.fn(); return due.length }
  const store = { loaded: true, state: { enabled: [] }, snapshot() { return { enabled: this.state.enabled, owned: {}, declined: [] } }, async mutate() {} }
  let runs = 0
  let release
  const pin = new AutoPin({ store, registry: () => ({ pinSession: async () => {}, unpinSession: async () => {}, pinnedSessionIds: [] }), targets: async () => { runs += 1; await new Promise((resolve) => { release = resolve }); return [] }, intervalMs: 0, kickDelayMs: 10, setTimeoutFn, clearTimeoutFn })
  pin.kick()
  assert.equal(timers.length, 0, '没开启自动置顶的工作区：不排')
  store.state.enabled = ['ws-a']
  pin.kick(); pin.kick(); pin.kick()
  assert.equal(timers.length, 1, '短时间多次变化合并成一轮')
  fire()
  assert.equal(runs, 1)
  // 正在跑时又变了：不并发，跑完再补一轮
  pin.kick()
  fire()
  assert.equal(runs, 1)
  release()
  await pin.running?.catch(() => {})
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fire(), 1, '跑完补排了一轮')
  assert.equal(runs, 2)
  release()
  await pin.running?.catch(() => {})
  pin.kick()
  pin.dispose()
  assert.ok(timers.every((t) => t.cleared), 'dispose 取消待跑的一轮')
})
