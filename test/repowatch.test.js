import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_ACK_LABEL, RepoWatchRunner, RepoWatchStore, advanceSeen, batchFresh, filterReason,
  inActiveHours, normalizeActiveHours, normalizeFilters, normalizeRepo, normalizeStartRequest,
  partitionItems, pruneSeen, pruneWakeTimes
} from '../lib/repowatch.js'

const item = (number, overrides = {}) => ({
  number, title: `item ${number}`, state: 'open', updated_at: new Date(1000 + number * 1000).toISOString(),
  labels: [], user: { login: 'alice', type: 'User' }, assignees: [], draft: false, pull_request: false, html_url: `https://github.com/o/r/issues/${number}`,
  ...overrides
})

test('仓库守候：仓库写法与 Gitee 拒绝', () => {
  assert.equal(normalizeRepo('owner/name'), 'owner/name')
  assert.equal(normalizeRepo('https://github.com/owner/name'), 'owner/name')
  assert.equal(normalizeRepo('git@github.com:owner/name.git'), 'owner/name')
  assert.throws(() => normalizeRepo('gitee:owner/name'), /Gitee/)
  assert.throws(() => normalizeRepo(''), /需要仓库/)
})

test('仓库守候：过滤原因可解释', () => {
  const f = normalizeFilters({ labels: ['ai-fix'], ignoreLabels: ['wontfix'], onlyAssigned: true, allowAuthors: ['@alice'] })
  assert.equal(filterReason(item(1, { labels: ['ai-fix'], assignees: [{ login: 'alice' }] }), f), null)
  assert.match(filterReason(item(2, { state: 'closed' }), f), /已关闭/)
  assert.match(filterReason(item(3, { draft: true }), f), /草稿/)
  assert.match(filterReason(item(4, { user: { login: 'dependabot[bot]', type: 'Bot' } }), f), /机器人/)
  assert.match(filterReason(item(5, { labels: ['wontfix'] }), f), /排除标签/)
  assert.match(filterReason(item(6, { labels: [] }), f), /不在标签白名单/)
  assert.match(filterReason(item(7, { labels: ['ai-fix'], user: { login: 'bob', type: 'User' }, assignees: [{ login: 'alice' }] }), f), /作者不在名单/)
  assert.match(filterReason(item(8, { labels: ['ai-fix'], assignees: [] }), f), /没有指派/)
  assert.equal(filterReason(item(9, { labels: ['ai-fix'], assignees: [{ login: 'alice' }] }), normalizeFilters({ labels: ['ai-fix'], skipBots: false, skipClosed: false, skipDrafts: false })), null)
})

test('仓库守候：水位、冷却吸收与批量排序', () => {
  const now = 10_000
  const watch = { cursor: new Date(1000).toISOString(), seen: { 1: new Date(5000).toISOString() }, lastReported: { 2: now - 1000 } }
  const rows = [item(1), item(2), item(3)]
  const split = partitionItems(rows, watch, { now, cooldownMs: 180_000 })
  assert.deepEqual(split.fresh.map((entry) => entry.number), [3])
  assert.deepEqual(split.absorbed.map((entry) => entry.number), [2])
  const seen = advanceSeen({}, [item(4)], { now })
  assert.equal(seen['4'], new Date(5000).toISOString())
  assert.deepEqual(pruneSeen({ 1: new Date(0).toISOString() }, { now: 40 * 24 * 3600_000 }), {})
  assert.deepEqual(pruneWakeTimes([now - 1000, now - 2 * 3600_000], now), [now - 1000])
  const batch = batchFresh([item(1), item(2, { labels: ['a', 'b'], assignees: [{ login: 'x' }], pull_request: true })], 5)
  assert.deepEqual(batch.map((entry) => entry.number), [2, 1])
})

test('仓库守候：活跃时段', () => {
  assert.equal(normalizeActiveHours('9:00-22:30'), '09:00-22:30')
  assert.throws(() => normalizeActiveHours('9-22'), /活跃时段/)
  assert.equal(inActiveHours('09:00-18:00', new Date(2026, 0, 1, 10, 0)), true)
  assert.equal(inActiveHours('09:00-18:00', new Date(2026, 0, 1, 19, 0)), false)
  assert.equal(inActiveHours('22:00-06:00', new Date(2026, 0, 1, 23, 0)), true)
  assert.equal(inActiveHours('22:00-06:00', new Date(2026, 0, 1, 12, 0)), false)
})

test('仓库守候：启动参数校验', () => {
  assert.throws(() => normalizeStartRequest({ repo: 'o/r', intervalSec: 10 }), /轮询间隔/)
  assert.throws(() => normalizeStartRequest({ repo: 'o/r', batchLimit: 0 }), /单次唤醒/)
  assert.throws(() => normalizeStartRequest({ repo: 'o/r', maxWakesPerHour: 0 }), /每小时/)
  assert.throws(() => normalizeStartRequest({ repo: 'o/r', ackLabel: 'bad label' }), /ack 标签/)
  const clean = normalizeStartRequest({ repo: 'o/r', labels: ['a'], skipBots: false }, { now: 5000 })
  assert.equal(clean.filters.labels[0], 'a')
  assert.equal(clean.filters.skipBots, false)
  assert.equal(clean.nextAt, 5000 + 120_000)
})

test('仓库守候：轮询 → 唤醒 → 水位推进；忙时/观察/限流有记录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-rw-'))
  try {
    const store = new RepoWatchStore(join(dir, 'repo-watches.json'))
    await store.load()
    let now = 1000
    let running = false
    let pollCalls = 0
    const delivered = []
    const rows = [item(12), item(13, { labels: ['bot'] })]
    const runner = new RepoWatchRunner({
      store, now: () => now,
      poll: async () => { pollCalls += 1; return rows },
      sessionState: async () => ({ exists: true, running }),
      deliver: async (sessionId, text) => { delivered.push({ sessionId, text }) },
      config: { cooldownMs: 180_000 }
    })
    const watch = await runner.start({ repo: 'o/r', goal: '处理 issue', intervalSec: 60 }, { sessionId: 's1', groupKey: 'g', createdBy: 's1' })
    assert.equal(watch.repo, 'o/r')
    now += 60_000
    await runner.tick()
    assert.equal(pollCalls, 1)
    assert.equal(delivered.length, 1)
    assert.match(delivered[0].text, /#12/)
    assert.match(delivered[0].text, /目标：处理 issue/)
    assert.equal(watch.seen['12'] !== undefined, true)
    // 同一批下次不再唤醒
    now += 60_000
    await runner.tick()
    assert.equal(delivered.length, 1)
    // 忙时：不拉、不唤醒，记 busy
    running = true
    const watchRow = runner.list({ groupKey: 'g' })[0]
    watchRow.nextAt = now
    rows[0] = item(14, { updated_at: new Date(now + 5000).toISOString() })
    await runner.tick()
    assert.equal(delivered.length, 1)
    assert.equal(runner.list({ groupKey: 'g' })[0].lastDeferred.reason, 'busy')
    // 观察模式：只记 history
    running = false
    await runner.update(watch.id, { observe: true })
    now += 10_000
    runner.list({ groupKey: 'g' })[0].nextAt = now
    await runner.tick()
    assert.equal(delivered.length, 1)
    assert.equal(runner.list({ groupKey: 'g' })[0].history.some((row) => row.reason === 'observe'), true)
    // 限流
    await runner.update(watch.id, { observe: false, maxWakesPerHour: 1 })
    const current = runner.list({ groupKey: 'g' })[0]
    current.wakeTimes = [now - 1000]
    current.nextAt = now
    current.seen = {}
    rows[0] = item(15, { updated_at: new Date(now + 1000).toISOString() })
    await runner.tick()
    assert.equal(delivered.length, 1)
    assert.equal(runner.list({ groupKey: 'g' })[0].lastDeferred.reason, 'rate')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('仓库守候：ack 本机生效，用户态可写 GitHub 标签；轮询失败退避', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-rw2-'))
  try {
    const store = new RepoWatchStore(join(dir, 'repo-watches.json'))
    await store.load()
    let now = 1000
    const labels = []
    let fail = false
    const runner = new RepoWatchRunner({
      store, now: () => now,
      poll: async () => { if (fail) throw Object.assign(new Error('timeout'), { stderr: 'dial tcp: i/o timeout' }); return [item(21)] },
      sessionState: async () => ({ exists: true, running: false }),
      deliver: async () => {},
      writeAckLabel: async (repo, number, label) => { labels.push([repo, number, label]) }
    })
    const watch = await runner.start({ repo: 'o/r' }, { sessionId: 's1', groupKey: 'g', createdBy: 's1' })
    const acked = await runner.ack(watch.id, [21], { by: 's1', writeGitHub: true })
    assert.deepEqual(acked.numbers, [21])
    assert.equal(acked.github, true)
    assert.deepEqual(labels, [['o/r', 21, DEFAULT_ACK_LABEL]])
    assert.equal(watch.lastAcked.github, true)
    now += 1000
    fail = true
    runner.list({ groupKey: 'g' })[0].nextAt = now
    await runner.tick()
    const failed = runner.list({ groupKey: 'g' })[0]
    assert.equal(failed.consecutiveFailures, 1)
    assert.match(failed.lastError, /i\/o timeout/)
    assert.ok(failed.nextAt > now)
    assert.equal(failed.history.some((row) => row.ok === false), true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('仓库守候：盘上保存/恢复；同仓库同会话更新不重复建', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-rw3-'))
  try {
    const path = join(dir, 'repo-watches.json')
    const store = new RepoWatchStore(path)
    await store.load()
    const runner = new RepoWatchRunner({ store, now: () => 1000, poll: async () => [], sessionState: async () => ({ exists: true, running: false }), deliver: async () => {} })
    await runner.start({ repo: 'o/r', intervalSec: 90 }, { sessionId: 's1', groupKey: 'g', createdBy: 's1' })
    await runner.start({ repo: 'o/r', intervalSec: 120 }, { sessionId: 's1', groupKey: 'g', createdBy: 's1' })
    const again = new RepoWatchStore(path)
    await again.load()
    assert.equal(again.list().length, 1)
    assert.equal(again.list()[0].intervalSec, 120)
    assert.equal(again.list()[0].goal, '')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
