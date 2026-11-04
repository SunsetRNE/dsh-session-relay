/** 看板写操作的纯函数与文件原语：命令解析、任务号分配、表格插入 / 修改、详情备注、认领目录、锁。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRelayCommand } from '../lib/core.js'
import { appendTaskNote, cell, createClaim, insertTask, nextTaskId, patchTaskRow, retireClaim, usedTaskIds, withBoardLock, LOCK_NAME } from '../lib/taskops.js'
import { parseTaskDoc, readClaims } from '../lib/tasks.js'

const DOC = [
  '# 看板', '', '## 任务', '',
  '| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |',
  '|---|---|---|---|---|---|',
  '| T1 | P0 | 一 | a | 是 | 已合入 |',
  '| T3 | P1 | 三 | c | 否 | 待认领 |',
  '',
  '> 备注：原误编 T13，已改',
  '',
  '### T3 三的详情', '', '- 第一条', '',
  '## 其它', '', '尾巴'
].join('\n')

test('命令解析：/relay task 各动作；/relay task <号> 仍是查看', () => {
  assert.deepEqual(parseRelayCommand('task T3'), { kind: 'tasks', id: 'T3' })
  const created = parseRelayCommand('task new 修启动卡顿 --priority P1 --worktree 新建 `fix/boot` --claim')
  assert.equal(created.kind, 'task-op')
  assert.equal(created.title, '修启动卡顿')
  assert.equal(created.priority, 'P1')
  assert.equal(created.worktree, '新建 `fix/boot`')
  assert.equal(created.claim, true)
  assert.deepEqual(parseRelayCommand('task done t47 9cd7b3af 可合并（基于 build312）'), { kind: 'task-op', action: 'done', id: 'T47', text: '9cd7b3af 可合并（基于 build312）' })
  assert.deepEqual(parseRelayCommand('task handoff T3 --to @t9 你接着做'), { kind: 'task-op', action: 'handoff', id: 'T3', to: '@t9', text: '你接着做' })
  assert.equal(parseRelayCommand('task Claim T3 --for t9').for, 't9')
  assert.equal(parseRelayCommand('task done T3').kind, 'invalid')
  assert.equal(parseRelayCommand('task abandon T3').kind, 'invalid')
  assert.equal(parseRelayCommand('task handoff T3').kind, 'invalid')
  assert.equal(parseRelayCommand('task claim').kind, 'invalid')
  assert.equal(parseRelayCommand('task new').kind, 'invalid')
  assert.match(parseRelayCommand('task update T3 --bogus x').reason, /不认识的选项 --bogus/)
})

test('任务号：表格、详情、正文提到的、认领目录、已释放、归档都算用过', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-taskops-'))
  try {
    await mkdir(join(dir, 'claims', 'T20'), { recursive: true })
    await mkdir(join(dir, 'claims', '.released', 'T21-20261104T010203Z'), { recursive: true })
    const used = await usedTaskIds({ docText: DOC, claimsRoot: join(dir, 'claims'), archiveText: '<!-- archived:T22 2026 -->' })
    for (const id of ['T1', 'T3', 'T13', 'T20', 'T21', 'T22']) assert.ok(used.has(id), id)
    assert.equal(nextTaskId(used), 'T23')
    assert.equal(nextTaskId(new Set()), 'T1')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('表格：新行插在任务表末尾，列按表头对齐，| 转全角；改字段只动给出的列', () => {
  const text = insertTask(DOC, { id: 'T4', priority: 'P2', title: 'a|b', worktree: 'w', build: '否', status: '待认领' }, { detail: '证据：x', by: 'session-aaaaaaaa-0000-0000-0000-000000000001', now: Date.UTC(2026, 10, 4, 1, 2) })
  const doc = parseTaskDoc(text)
  const row = doc.rows.find((item) => item.id === 'T4')
  assert.equal(row.line, 8) // 紧跟 T3 那一行
  assert.equal(row.title, 'a｜b')
  assert.equal(row.status, '待认领')
  assert.match(doc.sections.get('T4').heading, /^### T4 a\|b（aaaaaaaa 登记，2026-11-04 01:02Z）/)
  const patched = patchTaskRow(text, 'T3', { status: '进行中', priority: 'P0' })
  const after = parseTaskDoc(patched.text).rows.find((item) => item.id === 'T3')
  assert.equal(after.status, '进行中')
  assert.equal(after.priority, 'P0')
  assert.equal(after.title, '三')
  assert.equal(after.worktree, 'c')
  assert.equal(patchTaskRow(text, 'T99', { status: 'x' }), undefined)
  // 没有任务表：文末新建
  const fresh = insertTask('# 空', { id: 'T1', title: '首个', status: '待认领' })
  assert.equal(parseTaskDoc(fresh).rows[0].id, 'T1')
  assert.equal(cell('a\nb|c'), 'a b｜c')
})

test('备注：追加在详情段末尾（下一节之前）；没有详情段就新建', () => {
  const text = appendTaskNote(DOC, 'T3', '核对过', { by: 'session-bbbbbbbb-0000-0000-0000-000000000002', now: Date.UTC(2026, 10, 4, 3, 4) })
  const lines = text.split('\n')
  const at = lines.findIndex((line) => line.includes('核对过'))
  assert.equal(lines[at - 1], '- 第一条')
  assert.match(lines[at], /^- 2026-11-04 03:04Z bbbbbbbb：核对过$/)
  assert.ok(lines.indexOf('## 其它') > at)
  const added = appendTaskNote(DOC, 'T1', '新备注', { title: '一' })
  assert.ok(parseTaskDoc(added).sections.has('T1'))
})

test('认领目录：mkdir 原子认领、第二次返回 false；退回移到 .released 且不再被读到', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-taskops-'))
  try {
    const root = join(dir, 'claims')
    assert.equal(await createClaim(root, 'T5', 'session-aaaaaaaa-0000-0000-0000-000000000001'), true)
    assert.equal(await createClaim(root, 'T5', 'session-bbbbbbbb-0000-0000-0000-000000000002'), false)
    assert.match(await readFile(join(root, 'T5', 'owner'), 'utf8'), /^session-aaaaaaaa-[^\n]+\n\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\n$/)
    await assert.rejects(createClaim(root, '../x', 's'), /不是任务号/)
    const dest = await retireClaim(root, 'T5')
    assert.match(dest, /\.released\/T5-\d{8}T\d{6}Z$/)
    assert.equal((await readClaims(root)).claims.has('T5'), false)
    assert.equal(await createClaim(root, 'T5', 'session-bbbbbbbb-0000-0000-0000-000000000002'), true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('看板锁：同一时刻只有一个写；残留的过期锁会被清掉', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'relay-taskops-'))
  try {
    const order = []
    await Promise.all([1, 2, 3].map((n) => withBoardLock(dir, async () => {
      order.push(`in${n}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push(`out${n}`)
    })))
    for (let index = 0; index < order.length; index += 2) assert.equal(order[index].slice(2), order[index + 1].slice(3))
    await mkdir(join(dir, LOCK_NAME))
    const old = new Date(Date.now() - 60_000)
    await utimes(join(dir, LOCK_NAME), old, old)
    assert.equal(await withBoardLock(dir, async () => 'ok'), 'ok')
    assert.deepEqual((await readdir(dir)).filter((name) => name === LOCK_NAME), [])
    await mkdir(join(dir, LOCK_NAME))
    await assert.rejects(withBoardLock(dir, async () => 'x', { waitMs: 100 }), /正被别的会话修改/)
    await writeFile(join(dir, 'x'), '')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
