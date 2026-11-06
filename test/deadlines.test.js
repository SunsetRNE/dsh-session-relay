/** 平级通知回执时限：解析、持久化、回执销账、到期查询。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatTimeout, parseTimeout } from '../lib/core.js'
import { DeadlineStore } from '../lib/deadlines.js'

test('时限解析：默认 3m，支持 s/m/h/ms，拒绝关闭与越界', () => {
  assert.equal(parseTimeout(undefined), 180_000)
  assert.equal(parseTimeout(''), 180_000)
  assert.equal(parseTimeout('default'), 180_000)
  assert.equal(parseTimeout('90s'), 90_000)
  assert.equal(parseTimeout('3m'), 180_000)
  assert.equal(parseTimeout('2h'), 7_200_000)
  assert.equal(parseTimeout('1.5m'), 90_000)
  assert.equal(parseTimeout('10000ms'), 10_000)
  assert.equal(parseTimeout('30'), 30_000, '纯数字按秒')
  assert.throws(() => parseTimeout('0'), /10 秒–24 小时/)
  assert.throws(() => parseTimeout('9s'), /10 秒–24 小时/)
  assert.throws(() => parseTimeout('25h'), /10 秒–24 小时/)
  assert.throws(() => parseTimeout('soon'), /时限写法/)
  assert.equal(formatTimeout(180_000), '3 分钟')
  assert.equal(formatTimeout(90_000), '90 秒')
  assert.equal(formatTimeout(7_200_000), '2 小时')
})

test('DeadlineStore：持久化、回执销账、到期与只提醒一次', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-deadlines-'))
  let now = 1_000_000
  try {
    const store = new DeadlineStore(join(root, 'deadlines.json'), { now: () => now })
    await store.add({ id: 'm1', from: 'A', to: 'B', at: now, deadlineAt: now + 180_000, timeoutMs: 180_000, mode: 'followup', kind: 'send', preview: '请确认' })
    await store.add({ id: 'm2', from: 'A', to: 'C', at: now, deadlineAt: now + 60_000, timeoutMs: 60_000, mode: 'followup', kind: 'send', preview: '另一个' })
    assert.equal((await store.pendingFor('A')).length, 2)
    assert.equal((await store.due(now + 120_000)).length, 1, '只到期的 m2')
    assert.equal(await store.ackExchange({ from: 'A', to: 'B' }), 1, 'B 回消息，销掉 A→B')
    assert.deepEqual((await store.pendingFor('A')).map((item) => item.id), ['m2'])
    await store.ackExchange({ from: 'A', to: 'B' })
    // 重开读回
    const again = new DeadlineStore(join(root, 'deadlines.json'), { now: () => now })
    await again.load()
    assert.deepEqual((await again.pendingFor('A')).map((item) => item.id), ['m2'])
    await again.markReminded('m2')
    assert.equal((await again.due(now + 120_000)).length, 0, '提醒过的不再重复')
    await again.remove('m2')
    assert.equal((await again.pendingFor('A')).length, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})
