/** 待收队列上限与落后/卡住判定。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKLOG_DEFAULTS, classifyBacklog } from '../lib/queue.js'

test('待收判定：ok / lagging / stuck 只看条数、最老时长、当前轮时长', () => {
  assert.equal(BACKLOG_DEFAULTS.maxPending, 8)
  assert.equal(classifyBacklog({ count: 2 }).level, 'ok')
  assert.equal(classifyBacklog({ count: 4 }).level, 'lagging')
  assert.match(classifyBacklog({ count: 4 }).why, /待收 4 条/)
  assert.equal(classifyBacklog({ count: 1, oldestMs: 6 * 60_000 }).level, 'lagging')
  assert.equal(classifyBacklog({ count: 1, oldestMs: 31 * 60_000 }).level, 'stuck')
  assert.equal(classifyBacklog({ count: 1, runningMs: 31 * 60_000 }).level, 'stuck')
  assert.equal(classifyBacklog({ count: 8 }).level, 'stuck')
  assert.equal(classifyBacklog({ count: 0, runningMs: 31 * 60_000 }).level, 'ok', '空队列不算卡住')
})
