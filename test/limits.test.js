/** 本轮资源边界：交接、日志和目录扫描必须有界，失败扫描需要退避。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HandoffStore, HANDOFF_MESSAGE_LIMIT, NOTES_LIMIT, frameHandoff } from '../lib/handoff.js'
import { frameTakeover, TAKEOVER_MESSAGE_LIMIT } from '../lib/takeover.js'
import { DeclarationIndex, scanWorkspace } from '../lib/declarations.js'
import { checkBackground } from '../lib/gitcheck.js'
import { parseBoard, scanBoard } from '../lib/taskboard.js'

const ID = 'aaaaaaaa-0000-0000-0000-000000000001'

const activeDecl = (session = ID) => `状态：活跃\n会话：session-${session}\n分支：fix/x\n合并：不可合并\n后台任务：无\n`

test('交接状态：旧历史白名单清洗、草稿 TTL、文件大小有界', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-limits-'))
  try {
    const path = join(dir, 'handoffs.json')
    await writeFile(path, JSON.stringify({ version: 1,
      drafts: { old: { id: 'old', notes: '过期', updatedAt: 1 }, fresh: { id: 'fresh', notes: '保留', updatedAt: 1000 } },
      history: Array.from({ length: 60 }, (_, i) => ({ group: 'fresh', id: `h${i}`, to: ID, notes: 'x'.repeat(2000), at: i, extra: 'drop' }))
    }))
    const store = new HandoffStore(path, { now: () => 1000 + 31 * 24 * 60 * 60 * 1000 })
    await store.load()
    assert.equal(store.draft('old'), undefined)
    assert.equal(store.history('fresh', 100).length, 30)
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(parsed.version, 1)
    assert.ok(Buffer.byteLength(await readFile(path), 'utf8') < 96 * 1024)
    assert.ok(parsed.history.every((item) => item.notes.length <= 600 && item.extra === undefined))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('交接消息：主会话与工作会话的最终正文有 UTF-8 字节上限', () => {
  const notes = '说明'.repeat(NOTES_LIMIT)
  const snapshot = '快照'.repeat(NOTES_LIMIT * 2)
  const main = frameHandoff({ workspaceTitle: 'A', fromLabel: '@old', notes, snapshot, by: 'plugin' })
  assert.ok(Buffer.byteLength(main, 'utf8') <= HANDOFF_MESSAGE_LIMIT)
  const takeover = frameTakeover({ from: { id: ID, label: '@old' }, to: { id: 'b', alias: 'new' }, root: '/repo', note: '补充'.repeat(5000), decls: Array.from({ length: 100 }, (_, i) => ({ dir: `/repo/w${i}`, file: '.ACTIVE-SESSION', branch: `b${i}`, merge: 'blocked', phase: '进行中', files: 'app/src/main/A.java' })), claims: Array.from({ length: 100 }, (_, i) => ({ task: `T${i}`, path: `/repo/.agents/claims/T${i}` })), turns: Array.from({ length: 100 }, (_, i) => ({ seq: i, role: '助手', text: '回复'.repeat(1000), time: i })) })
  assert.ok(Buffer.byteLength(takeover, 'utf8') <= TAKEOVER_MESSAGE_LIMIT)
  assert.match(takeover, /你先做/)
})

test('日志扫描：超大文件不全量读，目录也不阻塞', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-log-'))
  try {
    const large = join(dir, 'large.log')
    await writeFile(large, Buffer.alloc(10 * 1024 * 1024, 65))
    const result = await checkBackground({ rel: 'x', background: `job（pid 1999999）→ ${large}` })
    assert.equal(result.logs[0].skipped !== undefined, true)
    const folder = join(dir, 'folder.log')
    await mkdir(folder)
    const skipped = await checkBackground({ rel: 'x', background: `job → ${folder}` })
    assert.equal(skipped.logs[0].missing || skipped.logs[0].skipped !== undefined, true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('扫描预算：工作树、认领、看板行数超限时返回截断标记', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-scan-limit-'))
  try {
    const tree = join(dir, '.agents/worktrees/fix')
    const claims = join(dir, '.agents/claims')
    await mkdir(tree, { recursive: true }); await mkdir(claims, { recursive: true })
    for (let i = 0; i < 5; i++) {
      const wt = join(tree, `w${i}`); await mkdir(wt); await writeFile(join(wt, '.ACTIVE-SESSION'), activeDecl())
      await mkdir(join(claims, `T${i}`))
    }
    const scan = await scanWorkspace(dir, { limits: { worktrees: 2, claims: 2, declarations: 2 } })
    assert.equal(scan.truncated, true)
    assert.ok(scan.declarations.length <= 2)
    assert.ok(scan.claims.length <= 2)
    const rows = ['| 号 | 状态 | 任务 |', '|---|---|---|', ...Array.from({ length: 5 }, (_, i) => `| T${i} | 待认领 | x |`)].join('\n')
    const parsed = parseBoard(rows, { maxRows: 2 })
    assert.equal(parsed.truncated, true)
    assert.equal(parsed.rows.length, 2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('DeclarationIndex：失败退避并限制缓存根目录数量', async () => {
  let now = 0
  let calls = 0
  const index = new DeclarationIndex({ maxRoots: 2, retryBaseMs: 100, now: () => now, scan: async () => { calls += 1; throw new Error('broken') } })
  await index.get('/a')
  await index.get('/a')
  assert.equal(calls, 1)
  now = 101
  await index.get('/a')
  assert.equal(calls, 2)
  await index.get('/b'); await index.get('/c')
  assert.ok(index.cache.size <= 2)
})

test('交接快照只列没结束的会话，每条一两行；交接说明超过 2000 字拒收', async () => {
  const { handoffSnapshot } = await import('../lib/handoff.js')
  const t = Date.UTC(2026, 10, 4)
  const board = {
    'session-aaaaaaaa-0000-0000-0000-000000000001': { status: 'ready', summary: '可合并', branch: 'fix/a', commit: 'abc12345', files: 'A.java, B.java', lastTurn: '很长的最近一轮', lastTurnAt: t + 5, reportedAt: t, updatedAt: t },
    'session-bbbbbbbb-0000-0000-0000-000000000002': { status: 'ready', summary: '旧的可合并', declMerged: 'build304', files: 'X', updatedAt: t },
    'session-cccccccc-0000-0000-0000-000000000003': { status: 'done', summary: '做完了', updatedAt: t },
    'session-dddddddd-0000-0000-0000-000000000004': { status: 'blocked', summary: '卡住', question: '要不要改 ADR？', updatedAt: t }
  }
  const text = handoffSnapshot({ board, labelFor: (id) => id.slice(8, 16) })
  assert.match(text, /看板：2 个没结束，另有 2 个已完成 \/ 已合入不列出/)
  assert.match(text, /- aaaaaaaa · 可合并 · 分支 fix\/a · 提交 abc12345/, '标签就是短 id 时不重复')
  assert.match(text, /问题：要不要改 ADR？/)
  for (const gone of ['bbbbbbbb', 'cccccccc', '占用', '最近一轮', '版本线（', '工作区：']) assert.ok(!text.includes(gone), gone)
  const store = new HandoffStore(join(await mkdtemp(join(tmpdir(), 'ho-')), 'h.json'))
  assert.throws(() => store.saveDraft('g', { notes: '字'.repeat(NOTES_LIMIT + 1), by: 'model' }), /超过 2000 字/)
})

test('主会话上下文：已合入 / 提交不存在 / 前任主会话并成一行，不排队、不算占用重叠；重叠一个会话一行', async () => {
  const { coordinatorContext } = await import('../lib/core.js')
  const t = Date.UTC(2026, 10, 4)
  const id = (n) => `session-${String(n).repeat(8)}-0000-0000-0000-000000000000`
  const board = {
    [id(1)]: { status: 'ready', summary: '真的可合并', commit: 'abc12345', files: 'docs/a.md', reportedAt: t, updatedAt: t },
    [id(2)]: { status: 'ready', summary: '早已进 main', mainMerged: 'main f5ec2520', files: 'docs', lastTurn: '很长的最近一轮', lastTurnAt: t + 9, updatedAt: t },
    [id(3)]: { status: 'ready', summary: '提交被改写', commitMissing: true, files: 'docs', updatedAt: t },
    [id(4)]: { status: 'question', summary: '旧主会话的问题', question: '要不要发 304？', formerMain: true, files: 'docs', updatedAt: t },
    [id(5)]: { status: 'working', summary: '在改文档', files: 'docs/a.md, docs/b.md', updatedAt: t },
    [id(6)]: { status: 'working', summary: '也在改文档', files: 'docs', updatedAt: t },
    [id(7)]: { status: 'working', summary: '还在改文档', files: 'docs/a.md', updatedAt: t }
  }
  const text = coordinatorContext({ board, labelFor: (sid) => sid.slice(8, 16), selfId: 'm' })
  assert.match(text, /11111111 · 可合并 #1/)
  for (const gone of ['早已进 main', '提交被改写', '要不要发 304', '很长的最近一轮', '可合并 #2']) assert.ok(!text.includes(gone), gone)
  assert.match(text, /已合入 main（声明或 git 核对）1 个：22222222/)
  assert.match(text, /提交本机已不存在.*1 个：33333333/)
  assert.match(text, /已卸任的前任主会话 1 个：44444444/)
  // 1 与 5、6、7 都重叠：只一行，点名 3 个
  const one = text.split('\n').filter((line) => line.includes('⚠')).filter((line, i, all) => all.indexOf(line) === i)
  assert.ok(!text.includes('22222222 都在改') && !text.includes('与 33333333'), '过时条目不算重叠')
  assert.equal(text.split('- 11111111')[1].split('\n- ')[0].match(/⚠/g).length, 1)
  assert.ok(one.length > 0)
})

test('主会话上下文：已完成的条目不放占用清单与最近一轮', async () => {
  const { coordinatorContext } = await import('../lib/core.js')
  const t = Date.UTC(2026, 10, 4)
  const board = { 'session-eeeeeeee-0000-0000-0000-000000000000': { status: 'done', summary: '做完了', files: 'X.java', lastTurn: '收尾', lastTurnAt: t + 5, reportedAt: t, updatedAt: t } }
  const text = coordinatorContext({ board, labelFor: (id) => id.slice(8, 16), selfId: 'm' })
  assert.match(text, /eeeeeeee · 已完成/)
  assert.doesNotMatch(text, /占用：|最近一轮/)
})

test('分类：插件按事实判定，归档 / 需要处理 / 可合并 / 进行中 / 久未活动 / 空白', async () => {
  const { classifyEntry } = await import('../lib/core.js')
  const now = Date.UTC(2026, 10, 4, 12)
  const hour = 3600_000
  const c = (entry, facts = {}) => classifyEntry(entry, facts, { now })
  assert.deepEqual(c({ status: 'ready', mainMerged: 'main x' }), { category: 'archived', categoryReason: 'merged' })
  assert.deepEqual(c({ status: 'ready', commitMissing: true }), { category: 'archived', categoryReason: 'missing' })
  assert.deepEqual(c({ status: 'question', formerMain: true }), { category: 'archived', categoryReason: 'former-main' })
  assert.deepEqual(c({ status: 'done', reportedAt: now }), { category: 'archived', categoryReason: 'done' })
  assert.deepEqual(c({ status: 'working', reportedAt: now }, { gone: true }), { category: 'archived', categoryReason: 'gone' })
  assert.equal(c({ status: 'question', question: 'q', reportedAt: now }).category, 'attention')
  assert.equal(c({ status: 'question', question: 'q', reportedAt: now, answeredAt: now + 1 }).category, 'active', '已答复的不再要处理')
  assert.deepEqual(c({ status: 'working', reportedAt: now }, { failure: { code: 'EMPTY_RESPONSE' } }), { category: 'attention', categoryReason: 'failed', categoryDetail: 'EMPTY_RESPONSE' })
  assert.equal(c({ status: 'working', reportedAt: now }, { failure: { code: 'X' }, running: true }).category, 'active', '出错后又在跑')
  assert.equal(c({ status: 'ready', reportedAt: now }, { heavy: true }).category, 'ready', '可合并优先于上下文过大')
  assert.equal(c({ status: 'working', reportedAt: now }, { heavy: true }).categoryReason, 'heavy')
  assert.equal(c({ status: 'working', summary: '由用户加入协作', updatedAt: now - 30 * hour }).category, 'blank')
  assert.equal(c({ status: 'working', updatedAt: now - 30 * hour }, { lastActiveAt: now - hour }).category, 'active', '加入后会话有活动就不是空白')
  assert.equal(c({ status: 'working', reportedAt: now - 7 * hour }).category, 'idle')
  assert.equal(c({ status: 'working', reportedAt: now - 7 * hour }, { running: true }).category, 'active')
  assert.equal(c({ status: 'working', reportedAt: now - hour }).category, 'active')
  // DSH 的空白会话标记优先：有过对话但没汇报的不算空白（用户 2026-11-04 截图里 5fef3774、e4f60b18 被误判）
  assert.equal(c({ status: 'working', summary: '由用户加入协作', updatedAt: now - 30 * hour }, { blank: false, lastActiveAt: now - hour }).category, 'active')
  assert.equal(c({ status: 'working', summary: '由用户加入协作', updatedAt: now - 30 * hour }, { blank: false, lastActiveAt: now - 20 * hour }).category, 'idle')
  assert.equal(c({ status: 'working', summary: '空白', updatedAt: now - hour }, { blank: true }).category, 'blank')
})

test('主会话上下文（分类后）：归档只给一行计数，久未活动 / 空白只列标签', async () => {
  const { coordinatorContext } = await import('../lib/core.js')
  const id = (n) => `session-${String(n).repeat(8)}-0000-0000-0000-000000000000`
  const board = {
    [id(1)]: { status: 'question', question: '发不发？', summary: 'q', category: 'attention', categoryReason: 'question', updatedAt: 3 },
    [id(2)]: { status: 'working', summary: '跑着跑着空响应', category: 'attention', categoryReason: 'failed', categoryDetail: 'EMPTY_RESPONSE', updatedAt: 2 },
    [id(3)]: { status: 'ready', summary: '真的可合并', commit: 'abc1234', category: 'ready', files: 'a', updatedAt: 1 },
    [id(4)]: { status: 'working', summary: '很久没动', category: 'idle', updatedAt: 1 },
    [id(5)]: { status: 'working', summary: '由用户加入协作', category: 'blank', updatedAt: 1 },
    [id(6)]: { status: 'ready', summary: '早进 main 了', mainMerged: 'main x', category: 'archived', categoryReason: 'merged', files: 'a', updatedAt: 1 },
    [id(7)]: { status: 'ready', summary: '提交没了', commitMissing: true, category: 'archived', categoryReason: 'missing', updatedAt: 1 },
    [id(8)]: { status: 'done', summary: '做完了', category: 'archived', categoryReason: 'done', updatedAt: 1 }
  }
  const text = coordinatorContext({ board, labelFor: (sid) => sid.slice(8, 16), selfId: 'm' })
  assert.match(text, /插件按事实分类：需要处理 2 · 可合并 1 · 久未活动 1 · 空白 1/)
  assert.match(text, /【需要处理】\n- 11111111 · 待答复[\s\S]*- 22222222 · 进行中[^\n]*插件判定：最后一轮出错（EMPTY_RESPONSE）/)
  assert.match(text, /【可合并】\n- 33333333 · 可合并 #1/)
  assert.match(text, /【久未活动】44444444/)
  assert.match(text, /【空白】55555555/)
  assert.match(text, /归档 3 个（[^）]*已合入 main 1[^）]*），已从上下文收起.*其中提交本机已不存在的 77777777 请核对/)
  const part = text.slice(text.indexOf('看板（'))
  for (const gone of ['早进 main 了', '提交没了', '做完了', '很久没动,', '由用户加入协作', '⚠']) assert.ok(!part.includes(gone), gone)
})
