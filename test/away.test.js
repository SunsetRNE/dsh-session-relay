// 无人值守唤醒预算：暂停满一小时自动解除；插件通知不计数
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AwayStore, WAKE_WINDOW_MS } from '../lib/away.js'

test('唤醒预算：到上限暂停，满一小时自动解除；用户继续立即解除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-away-'))
  try {
    let now = 1_000_000
    const store = new AwayStore(join(dir, 'away.json'), { now: () => now })
    await store.load()
    for (let i = 0; i < 2; i += 1) assert.equal(store.admit('w', { limit: 2 }).allowed, true)
    assert.deepEqual(store.admit('w', { limit: 2 }), { allowed: false, newlyPaused: true })
    assert.equal(store.isPaused('w'), true)
    now += WAKE_WINDOW_MS - 1
    assert.equal(store.isPaused('w'), true, '不到一小时仍暂停')
    now += 1
    assert.equal(store.isPaused('w'), false, '满一小时自动解除')
    assert.equal(store.admit('w', { limit: 2 }).allowed, true)
    assert.equal(store.view('w', 2).paused, false)
    // 再次到上限后用户继续：立即解除并清零
    store.admit('w', { limit: 2 }); store.admit('w', { limit: 2 })
    assert.equal(store.isPaused('w'), true)
    assert.equal(store.resume('w'), true)
    assert.equal(store.view('w', 2).wakesThisHour, 0)
    await store.chain
  } finally { await rm(dir, { recursive: true, force: true }) }
})
