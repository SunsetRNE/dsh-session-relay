/** 工作树声明（只读）：解析、扫描、与看板对照，以及 /relay decl、上下文、汇报补分支的接线。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeclarationIndex, parseClaimOwner, parseDeclaration, reconcile, scanWorkspace, describeDeclarations, declarationSummaryLine } from '../lib/declarations.js'

const A = 'aaaaaaaa-0000-0000-0000-000000000001'
const B = 'bbbbbbbb-0000-0000-0000-000000000002'
const GONE = 'eeeeeeee-0000-0000-0000-000000000005'

function decl({ status = '活跃（请勿合并）', branch, session, phase = '进行中', merge = '不可合并', trailer = [] }) {
  return [
    `状态：${status}`, `分支：${branch}（基于 62bee61a origin/main build272）`, `会话：${session}`,
    '开始：2026-11-02T11:34:38Z', '更新：2026-11-02T11:58:10Z', '内容：任务', `当前阶段：${phase}`,
    '占用文件：app/src/main/java/X.java、tools/java-format-files.json', `合并：${merge}`, '后台任务：无', ...trailer
  ].join('\n') + '\n'
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'relay-decl-'))
  const wt = (rel) => join(root, '.agents/worktrees', rel)
  const put = async (rel, name, text, git = true) => {
    await mkdir(wt(rel), { recursive: true })
    if (git) await writeFile(join(wt(rel), '.git'), 'gitdir: x\n')
    if (name !== undefined) await writeFile(join(wt(rel), name), text)
  }
  await put('fix/a-ready', '.ACTIVE-SESSION', decl({ branch: 'fix/a-ready', session: `session-${A}` }))
  await put('fix/b-done', '.SESSION-DONE', decl({ status: '已结束', branch: 'fix/b-done', session: `session-${B}（接手 session-${GONE}：闪退）`, merge: '可合并（已提交 18af5dc9，建议版本说明「x」）' }))
  await put('fix/c-pending', '.SESSION-DONE', decl({ status: '已结束', branch: 'fix/c-pending', session: `session-${GONE}`, merge: '可合并（已提交 37725ccb）', trailer: ['待推送 build293（37725ccb）'] }))
  await put('release/r1', '.ACTIVE-SESSION', decl({ branch: 'release/r1', session: `session-${GONE}`, merge: '不可合并', trailer: ['已合入 build290（89f92118）'] }))
  await put('perf/orphan', '.ACTIVE-SESSION', decl({ branch: 'perf/orphan', session: `session-${GONE}` }))
  await put('tmp/bare', undefined, '')
  await put('notes', undefined, '', false)
  await mkdir(join(root, '.agents/claims/T1'), { recursive: true })
  await writeFile(join(root, '.agents/claims/T1/owner'), `session-${GONE}\n2026-11-01 UTC\n接手 session-${A} 2026-11-02 UTC\n`)
  await mkdir(join(root, '.agents/claims/T2'), { recursive: true })
  await writeFile(join(root, '.agents/claims/T2/owner'), `session-${B}\n`)
  await writeFile(join(root, '.agents/claims/T2/done'), '18af5dc9 可合并\n')
  return root
}

test('parseDeclaration：持有者、接手前任、分支、合并状态与提交', () => {
  const done = parseDeclaration(decl({ branch: 'fix/x', session: `session-${B}（接手 session-${GONE}：闪退）`, merge: '可合并（已提交 18af5dc9）' }))
  assert.equal(done.holder, `session-${B}`)
  assert.deepEqual(done.previous, [`session-${GONE}`])
  assert.equal(done.branch, 'fix/x')
  assert.equal(done.merge, 'mergeable')
  assert.equal(done.commit, '18af5dc9')
  assert.equal(parseDeclaration(decl({ branch: 'x', session: A, merge: '不可合并' })).merge, 'blocked')
  assert.equal(parseDeclaration(decl({ branch: 'x', session: A, merge: '放弃，勿合并' })).merge, 'abandoned')
  const merged = parseDeclaration(decl({ branch: 'x', session: A, merge: '可合并（已提交 5f46eae0）', trailer: ['待推送 build281（5f46eae0）', '已合入 build281（5f46eae0）'] }))
  assert.equal(merged.merge, 'merged')
  assert.equal(merged.build, 'build281')
  assert.equal(parseDeclaration('状态：已结束\n会话：未登记\n合并：已合入 main\n').holder, undefined)
  assert.equal(parseClaimOwner(`session-${GONE}\n2026\n接手 session-${A} 2026\n`), `session-${A}`)
})

test('scanWorkspace + reconcile：分类与看板不一致', async () => {
  const root = await fixture()
  try {
    const scan = await scanWorkspace(root)
    assert.equal(scan.declarations.length, 5)
    assert.deepEqual(scan.undeclared, ['.agents/worktrees/tmp/bare'])
    assert.deepEqual(scan.claims.map((claim) => [claim.task, claim.state, claim.holder]), [['T1', 'claimed', `session-${A}`], ['T2', 'done', `session-${B}`]])
    // 看板 id 不带 session- 前缀也能对上
    const board = { [A]: { status: 'ready', updatedAt: 1 }, [B]: { status: 'working', updatedAt: 1 } }
    const view = reconcile(scan, board, new Set([A, B]))
    assert.deepEqual(view.candidates.map((d) => d.rel), ['.agents/worktrees/fix/b-done'])
    assert.deepEqual(view.pending.map((d) => d.build), ['build293'])
    assert.deepEqual(view.mergedActive.map((d) => d.rel), ['.agents/worktrees/release/r1'])
    assert.deepEqual(view.orphans.map((d) => d.rel), ['.agents/worktrees/perf/orphan'])
    assert.deepEqual(view.mismatches.map((m) => [m.sessionId, m.kind]).sort(), [[A, 'ready-not-declared'], [B, 'declared-done']])
    const text = describeDeclarations(view, { labelFor: (id) => id.replace(/^session-/, '').slice(0, 8), root })
    assert.match(text, /看板与声明不一致】2/)
    assert.match(text, /没有声明的工作树.*\n- \.agents\/worktrees\/tmp\/bare/)
    assert.match(text, /T1 · aaaaaaaa/)
    assert.match(text, /不会改任何声明文件/)
    const line = declarationSummaryLine(view, (id) => id.slice(0, 8))
    assert.match(line, /可合并待排号 1.*待推送 1.*已合入未交还 1.*持有者已不在 1.*无声明工作树 1/)
    // 只读：声明文件内容没变
    assert.match(await readFile(join(root, '.agents/worktrees/fix/a-ready/.ACTIVE-SESSION'), 'utf8'), /合并：不可合并/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('DeclarationIndex：peek 不阻塞、过期后台刷新、并发合并', async () => {
  let calls = 0
  let clock = 0
  const index = new DeclarationIndex({ ttlMs: 100, now: () => clock, scan: async () => { calls += 1; return { declarations: [], claims: [], undeclared: [], n: calls } } })
  assert.equal(index.peek('/w'), undefined)
  const [a, b] = await Promise.all([index.get('/w'), index.get('/w')])
  assert.equal(calls, 1)
  assert.equal(a.n, 1); assert.equal(b.n, 1)
  assert.equal(index.peek('/w').n, 1)
  clock = 500
  assert.equal(index.peek('/w').n, 1) // 先给旧值
  await index.get('/w', { maxAgeMs: 1000 })
  assert.equal(calls, 2)
})

export { fixture, A, B }

test('看板报可合并但声明已合入：移出队列并标注；活跃声明几天没更新', async () => {
  const { annotateBoard, idleDays } = await import('../lib/declarations.js')
  const { mergeQueue, renderBoardLines } = await import('../lib/core.js')
  const scan = { declarations: [
    { rel: '.agents/worktrees/ui/x', kind: 'done', holder: `session-${A}`, branch: 'ui/x', merge: 'merged', build: 'build292' },
    { rel: '.agents/worktrees/fix/old', kind: 'active', holder: `session-${B}`, branch: 'fix/old', merge: 'blocked', updated: '2026-10-28 09:00 UTC', mtimeMs: 0 }
  ], claims: [], undeclared: [] }
  const board = { [A]: { status: 'ready', branch: 'ui/x', reportedAt: 1 }, [B]: { status: 'working' } }
  const view = reconcile(scan, board, new Set([A, B]), { now: () => Date.parse('2026-11-03T06:00:00Z') })
  assert.deepEqual(view.readyMerged.map((m) => m.sessionId), [A])
  const annotated = annotateBoard(board, view)
  assert.deepEqual(mergeQueue(annotated), [])
  assert.match(renderBoardLines(Object.entries(annotated), (id) => id.slice(0, 8), { queue: [] }).join('\n'), /声明已合入 build292·看板未更新/)
  assert.deepEqual(view.idle.map((item) => [item.decl.rel, item.days]), [['.agents/worktrees/fix/old', 5]])
  assert.match(declarationSummaryLine(view, (id) => id.slice(0, 8)), /3 天以上没更新 1（fix\/old 5 天；只是提示/)
  assert.equal(idleDays({ updated: '2026-11-02T11:58:10Z' }, Date.parse('2026-11-03T12:00:00Z')), 1)
})
