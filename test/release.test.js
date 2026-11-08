/** 发布状态卡：版本推进、阶段条、发版清单命令（纯函数；真机数据读取在 host/impl 用例里）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bumpPatch, nextReleaseVersion, parseVersion, releaseCommand, releaseStages } from '../lib/release.js'

test('版本号：解析与补丁递增；非法版本不猜', () => {
  assert.deepEqual(parseVersion('2.4.2'), { major: 2, minor: 4, patch: 2 })
  assert.deepEqual(parseVersion('v2.4.2'), undefined, 'tag 写法不带 v')
  assert.equal(bumpPatch('2.4.2'), '2.4.3')
  assert.equal(bumpPatch('2.4.9'), '2.4.10')
  assert.equal(bumpPatch('2.4'), undefined)
  assert.equal(parseVersion(''), undefined)
})

test('待发版本：package.json 版本没打 tag → 随它发布；已打 tag → 下一个补丁', () => {
  const pending = nextReleaseVersion({ version: '2.4.3', tags: ['v2.4.1', 'v2.4.2'] })
  assert.equal(pending.tag, 'v2.4.3')
  assert.equal(pending.tagExists, false)
  assert.equal(pending.nextVersion, '2.4.3')
  assert.equal(pending.nextTag, 'v2.4.3')
  const released = nextReleaseVersion({ version: '2.4.2', tags: ['v2.4.1', 'v2.4.2'] })
  assert.equal(released.tagExists, true)
  assert.equal(released.nextVersion, '2.4.3')
  assert.equal(released.nextTag, 'v2.4.3')
  assert.equal(nextReleaseVersion({ version: '', tags: [] }).tag, undefined)
  // 数字排序交给调用方；这里只认完全相等的 tag
  assert.equal(nextReleaseVersion({ version: '2.4.2', tags: ['v2.4.20'] }).tagExists, false)
})

test('阶段条：准备 → 测试 → 打包 → 已 push → tag → Release → 市场；读不到写未知', () => {
  const keys = (facts) => releaseStages(facts).map((step) => step.key)
  assert.deepEqual(keys({}), ['prepare', 'test', 'pack', 'push', 'tag', 'release', 'market'])
  const done = releaseStages({
    prepared: { changelog: true, notes: true },
    packed: { file: 'dist/x.tgz', size: 1 },
    pushed: true,
    tagExists: true,
    release: { state: 'ready' }
  })
  assert.deepEqual(done.map((step) => step.state), ['done', 'unknown', 'done', 'done', 'done', 'done', 'unknown'])
  const waiting = releaseStages({
    prepared: { changelog: false, notes: false },
    packed: null,
    pushed: false,
    tagExists: false,
    release: { state: 'missing' }
  })
  assert.deepEqual(waiting.map((step) => step.state), ['pending', 'unknown', 'pending', 'pending', 'pending', 'pending', 'unknown'])
  const unknown = releaseStages({ prepared: null, pushed: undefined, release: { state: 'unknown' } })
  assert.deepEqual(unknown.map((step) => step.state), ['unknown', 'unknown', 'pending', 'unknown', 'pending', 'unknown', 'unknown'])
})

test('发版清单命令：串行测试 / 打包 / tag / Release；只复制，不执行', () => {
  const command = releaseCommand({ version: '2.4.3' })
  for (const part of [
    'node --test --test-concurrency=1 test/*.test.js',
    'npm pack --pack-destination dist',
    'git tag v2.4.3 <发版提交>',
    'gh release create v2.4.3 dist/dsh-session-relay-2.4.3.tgz',
    '--notes-file docs/release-notes-2.4.3.md'
  ]) assert.ok(command.includes(part), '缺少 ' + part)
  assert.ok(!/git push/.test(command), '不替用户推送')
  assert.ok(releaseCommand({}).includes('vX.Y.Z'), '版本未知时用占位符而不是猜')
})
