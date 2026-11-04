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
  const text = handoffSnapshot({ workspace: { title: 'W' }, line: { setAt: t, text: 'main=build307 (f5ec2520)\n第二行很长的规则' }, board, labelFor: (id) => id.slice(8, 16) })
  assert.match(text, /看板：2 个没结束，另有 2 个已完成 \/ 已合入不列出/)
  assert.match(text, /aaaaaaaa .*分支 fix\/a · 提交 abc12345/)
  assert.match(text, /问题：要不要改 ADR？/)
  assert.match(text, /main=build307 \(f5ec2520\)/)
  for (const gone of ['bbbbbbbb', 'cccccccc', '占用', '最近一轮', '第二行很长的规则']) assert.ok(!text.includes(gone), gone)
  const store = new HandoffStore(join(await mkdtemp(join(tmpdir(), 'ho-')), 'h.json'))
  assert.throws(() => store.saveDraft('g', { notes: '字'.repeat(NOTES_LIMIT + 1), by: 'model' }), /超过 2000 字/)
})
