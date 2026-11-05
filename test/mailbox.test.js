import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MailboxStore } from '../lib/mailbox.js'

async function harness({ maxItems = 5, ttlMs = 30 * 24 * 3600_000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'relay-mail-'))
  let now = Date.UTC(2026, 10, 4, 12)
  const store = new MailboxStore(join(dir, 'mailbox.json'), { now: () => now, maxItems, ttlMs })
  await store.load()
  return { dir, store, advance: (ms) => { now += ms }, now: () => now }
}

test('邮箱：写入去重、按工作区/会话可见、未读与已读', async () => {
  const h = await harness()
  try {
    const first = await h.store.add({ at: h.now(), group: 'g', scope: { type: 'workspace', id: 'g' }, subject: 'build330 已发布', body: 'full body', targets: ['a', 'b'], eventKey: 'build:330' })
    assert.equal(first.duplicate, false)
    const again = await h.store.add({ at: h.now(), group: 'g', scope: { type: 'workspace', id: 'g' }, subject: 'build330 已发布', body: 'full body', targets: ['a', 'b'], eventKey: 'build:330' })
    assert.equal(again.duplicate, true)
    const second = await h.store.add({ at: h.now(), group: 'g', scope: { type: 'session', id: 'b' }, subject: '给 b 的私信', body: 'only b', targets: ['b'] })
    assert.equal(h.store.unreadCount({ group: 'g', sessionId: 'a' }), 1)
    assert.equal(h.store.unreadCount({ group: 'g', sessionId: 'b' }), 2)
    assert.equal(h.store.list({ group: 'g', sessionId: 'c' }).length, 1)
    assert.equal(h.store.list({ group: 'other', sessionId: 'a' }).length, 0)
    await h.store.markRead([first.item.id], 'a')
    assert.equal(h.store.unreadCount({ group: 'g', sessionId: 'a' }), 0)
    assert.equal(h.store.summary({ group: 'g', sessionId: 'a' }).unread, 0)
    assert.equal(h.store.summary({ group: 'g', sessionId: 'b' }).unread, 2)
    await h.store.mark([first.item.id], { sessionId: 'a', state: 'unread' })
    assert.equal(h.store.unreadCount({ group: 'g', sessionId: 'a' }), 1)
    assert.equal(h.store.summary({ group: 'g', sessionId: 'a' }).latestSubject, 'build330 已发布')
    assert.equal(h.store.summary({ group: 'g', sessionId: 'a' }).latestSubject !== undefined, true)
    void second
  } finally { await rm(h.dir, { recursive: true, force: true }) }
})

test('邮箱：会话/多目标可见性；归档走 archive 不直接消失', async () => {
  const h = await harness()
  try {
    const item = await h.store.add({ at: h.now(), group: 'g', scope: { type: 'targets' }, subject: 'targets only', targets: ['a', 'b'], readBy: {} })
    assert.equal(h.store.list({ group: 'g', sessionId: 'a' }).length, 1)
    assert.equal(h.store.list({ group: 'g', sessionId: 'c' }).length, 0)
    const marked = await h.store.mark([item.item.id], { sessionId: 'a', isMain: true, state: 'archived' })
    assert.deepEqual(marked, [item.item.id])
    assert.equal(h.store.list({ group: 'g', sessionId: 'a' }).length, 0)
    const archive = await readFile(join(h.dir, 'mailbox.json.archive.jsonl'), 'utf8')
    assert.match(archive, /targets only/)
  } finally { await rm(h.dir, { recursive: true, force: true }) }
})

test('邮箱：截止提醒只针对未读目标，force 后不再提醒', async () => {
  const h = await harness()
  try {
    const item = await h.store.add({
      at: h.now(), group: 'g', scope: { type: 'targets' }, subject: 'deadline', targets: ['a', 'b'], readBy: {},
      deadlineAt: h.now() + 60_000
    })
    assert.equal(h.store.due(h.now() + 30_000).length, 0)
    const due = h.store.due(h.now() + 61_000)
    assert.equal(due.length, 1)
    await h.store.remind([item.item.id])
    assert.equal(h.store.due(h.now() + 120_000).length, 0)
    const forceItem = await h.store.add({ at: h.now(), group: 'g', scope: { type: 'targets' }, subject: 'force me', targets: ['a'], readBy: {}, deadlineAt: h.now() - 1 })
    const forced = await h.store.force([forceItem.item.id], 'main-1')
    assert.equal(forced.length, 1)
    assert.deepEqual(forced[0].targets, ['a'])
    assert.equal(h.store.due(h.now() + 1).length, 0)
  } finally { await rm(h.dir, { recursive: true, force: true }) }
})

test('邮箱：主会话可读、强推并归档只发给单个会话的消息', async () => {
  const h = await harness()
  try {
    const item = await h.store.add({ at: h.now(), group: 'g', scope: { type: 'session', id: 'b' }, subject: '给 b 的私信', body: 'only b', targets: ['b'] })
    // 主会话能读到（设计：主会话可读本工作区全部），别的普通会话读不到。
    assert.equal(h.store.list({ group: 'g', sessionId: 'a', isMain: true }).length, 1)
    assert.equal(h.store.list({ group: 'g', sessionId: 'c' }).length, 0)
    assert.ok(h.store.get(item.item.id, { group: 'g', sessionId: 'a', isMain: true }))
    const forced = await h.store.force([item.item.id], 'a')
    assert.equal(forced.length, 1)
    assert.deepEqual(forced[0].targets, ['b'])
    // 主会话归档后双方列表都不再显示，归档落盘。
    await h.store.mark([item.item.id], { sessionId: 'a', isMain: true, state: 'archived' })
    assert.equal(h.store.list({ group: 'g', sessionId: 'a', isMain: true }).length, 0)
    assert.equal(h.store.list({ group: 'g', sessionId: 'b' }).length, 0)
    const archive = await readFile(join(h.dir, 'mailbox.json.archive.jsonl'), 'utf8')
    assert.match(archive, /给 b 的私信/)
  } finally { await rm(h.dir, { recursive: true, force: true }) }
})

test('邮箱：短通知排期/投递记账与 7 天统计', async () => {
  const h = await harness()
  try {
    const item = await h.store.add({ at: h.now(), group: 'g', scope: { type: 'workspace', id: 'g' }, subject: 's', body: 'abcde', targets: ['a'] })
    assert.equal(item.item.bodyBytes, 5)
    await h.store.scheduleNotice(item.item.id, h.now())
    assert.equal(h.store.pendingNotices(h.now()).length, 1)
    assert.equal(h.store.pendingNotices(h.now() - 1).length, 0)
    await h.store.noticed([item.item.id], { at: h.now(), text: 'hello' })
    assert.equal(h.store.pendingNotices(h.now()).length, 0)
    const stats = h.store.stats('g')
    assert.equal(stats.items, 1)
    assert.equal(stats.bodyBytes, 5)
    assert.equal(stats.noticeBytes, 5)
    assert.equal(stats.notices, 1)
    // 7 天窗口外不计入
    h.advance(8 * 24 * 3600_000)
    assert.equal(h.store.stats('g').items, 0)
  } finally { await rm(h.dir, { recursive: true, force: true }) }
})
