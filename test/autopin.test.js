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

