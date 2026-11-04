/** 任务看板状态与归档：临时 git 仓库 + claims 目录，覆盖合入判定、持有者失效、归档预览 / 执行 / 去重 / 拒绝。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  applyArchive, archivedIdsOf, classifyTasks, deliverableCommits, describeCommits, loadMainIndex, parseTaskDoc, planArchive, readClaims, renderArchivePlan,
  renderTaskDetail, renderTaskReport, tailFacts
} from '../lib/tasks.js'
import { parseRelayCommand } from '../lib/core.js'
import { boardContext } from '../lib/taskboard.js'
import { fixture } from './fixtures/task-board.js'

async function classify(f, holders = new Map(), now = Date.now()) {
  const text = await readFile(f.file, 'utf8')
  const archived = archivedIdsOf(await readFile(join(f.board, 'TASKS-archive.md'), 'utf8').catch(() => ''))
  const doc = parseTaskDoc(text)
  const { claims } = await readClaims(join(f.board, 'claims'))
  const index = await loadMainIndex(f.dir)
  const shas = []
  for (const claim of claims.values()) shas.push(...deliverableCommits([claim.done, claim.abandoned].filter(Boolean).join('\n')).commits)
  for (const row of doc.rows) shas.push(...deliverableCommits(row.status).commits)
  const commits = await describeCommits(f.dir, shas)
  return { text, index, tasks: classifyTasks(doc, claims, { index, commits, holders, now, archived }) }
}

test('交付提交：跳过基线、日期与纯数字，单列作废', () => {
  const found = deliverableCommits('9cd7b3af 可合并（基于 62bee61a build272）；旧 2564f3a2 作废勿合；须在 27bb2071 之后；20261103 测试包 299026448 字节；main=f5ec2520')
  assert.deepEqual(found.commits, ['9cd7b3af'])
  assert.deepEqual(found.voided, ['2564f3a2'])
})

test('分类：祖先 / 同主题挑入算已合入；不在 main 是待合并；main 提到任务号是疑似；持有者失效与过大；已放弃；表格滞后与重复行', async () => {
  const f = await fixture()
  try {
    const holders = new Map([
      ['session-44444444-0000-0000-0000-000000000004', { exists: true, running: false, updatedAt: Date.now(), lastEnd: { kind: 'error', code: 'EMPTY_RESPONSE', at: Date.now() }, contextTokens: 625_000 }],
      ['session-55555555-0000-0000-0000-000000000005', { exists: true, running: true, contextTokens: 670_000 }]
    ])
    const { tasks, index } = await classify(f, holders)
    const by = (id) => tasks.find((task) => task.id === id)
    assert.equal(by('T1').state, 'merged')
    assert.equal(by('T2').state, 'merged')
    assert.match(by('T2').why, /→/)
    assert.deepEqual(by('T2').voided, [f.v.slice(0, 8)])
    assert.equal(by('T3').state, 'dead')
    assert.match(by('T3').why, /44444444.*出错 EMPTY_RESPONSE.*接手 1 次/)
    assert.match(by('T3').fresh, /625k，必须开新会话/)
    assert.ok(by('T3').notes.includes('表格还写着待认领'))
    assert.equal(by('T4').state, 'live')
    assert.match(by('T4').fresh, /670k/)
    assert.equal(by('T5').state, 'likely')
    assert.match(by('T5').why, /提到 T5/)
    assert.equal(by('T6').state, 'abandoned')
    assert.equal(by('T7').state, 'queued')
    assert.ok(by('T7').notes.some((note) => /2 行/.test(note)))
    const report = renderTaskReport(tasks, { board: f.file, main: index, docBytes: 1000 })
    assert.ok(Buffer.byteLength(report, 'utf8') < 3000)
    assert.match(report, /持有者已失效（1）：\n- T3/)
    assert.match(report, /已合入（2）：T1 T2/)
    assert.match(report, /可归档 3 个/)
    assert.match(renderTaskReport(tasks, { states: ['merged'] }), /已合入（2）：\n- T1/)
    const detail = renderTaskDetail(by('T2'))
    assert.match(detail, /已挑入 main/)
    assert.match(detail, /标明作废/)
    assert.match(detail, /只显示最后一段/)
    // 持有者不存在
    const gone = (await classify(f, new Map([['session-44444444-0000-0000-0000-000000000004', { exists: false }]]))).tasks.find((task) => task.id === 'T3')
    assert.equal(gone.state, 'dead')
    assert.match(gone.why, /会话已不存在/)
    // 空闲很久
    const idle = (await classify(f, new Map([['session-44444444-0000-0000-0000-000000000004', { exists: true, updatedAt: Date.now() - 10 * 3600_000 }]]))).tasks.find((task) => task.id === 'T3')
    assert.equal(idle.state, 'stale')
  } finally { await f.cleanup() }
})

test('归档：预览不写文件；apply 校验 planId、备份、原子替换、去重；不丢行', async () => {
  const f = await fixture()
  try {
    const { text, tasks } = await classify(f)
    const plan = planArchive({ docText: text, tasks, now: Date.parse('2026-02-01T00:00:00Z') })
    assert.deepEqual(plan.items.map((item) => item.id).sort(), ['T1', 'T2', 'T6'])
    assert.equal(await readFile(f.file, 'utf8'), text)
    assert.match(renderArchivePlan(plan), new RegExp(`apply ${plan.planId}`))
    assert.doesNotMatch(plan.newDoc, /任务一详情|过程记录/)
    assert.match(plan.newDoc, /任务三详情/)
    assert.match(plan.newDoc, /> 已归档 3 个任务（T1 T2 T6）/)
    // 看板改过 → 拒绝
    await assert.rejects(applyArchive({ boardFile: f.file, planId: 'ffffffffffff', tasks }), /被改过/)
    const done = await applyArchive({ boardFile: f.file, planId: plan.planId, tasks, now: Date.parse('2026-02-01T00:00:00Z') })
    const after = await readFile(f.file, 'utf8')
    const archive = await readFile(join(f.board, 'TASKS-archive.md'), 'utf8')
    assert.equal(after, plan.newDoc)
    assert.equal(await readFile(done.backup, 'utf8'), text)
    assert.match(archive, /<!-- archived:T1 /)
    assert.match(archive, /### T1 任务一详情/)
    assert.match(archive, /过程记录 2/)
    assert.match(archive, /claims done（原文）/)
    // 原文每一行都还在（看板或归档里）
    const kept = new Set([...after.split('\n'), ...archive.split('\n').map((line) => line.replace(/^- 原表格行：/, ''))])
    for (const line of text.split('\n')) if (line.trim() !== '') assert.ok(kept.has(line), `丢了：${line}`)
    // 同一任务又被写回看板：再次归档只去重，指引行替换而不是追加
    await writeFile(f.file, after.replace('| T3 |', `| T1 | P0 | 任务一 | a | 是 | 已合入 build2（${f.a.slice(0, 8)}） |\n| T3 |`))
    const again = await classify(f)
    assert.ok(again.tasks.find((task) => task.id === 'T1').notes.includes('已归档过又出现'))
    const plan2 = planArchive({ docText: again.text, archiveText: archive, tasks: again.tasks, ids: ['T1'] })
    assert.equal(plan2.items[0].duplicate, true)
    await applyArchive({ boardFile: f.file, planId: plan2.planId, tasks: again.tasks, ids: ['T1'] })
    const third = await readFile(f.file, 'utf8')
    assert.equal(third.split('\n').filter((line) => line.startsWith('> 已归档 ')).length, 1)
    assert.doesNotMatch(third, /\| T1 \|/)
    assert.match(await readFile(join(f.board, 'TASKS-archive.md'), 'utf8'), /重复记录/)
    assert.ok((await readdir(join(f.board, 'backups'))).length >= 2)
    // 进行中的不能指定归档
    const plan3 = planArchive({ docText: third, tasks: (await classify(f)).tasks, ids: ['T4', 'T9'] })
    assert.deepEqual(plan3.skipped.map((item) => item.id), ['T4', 'T9'])
    assert.equal(plan3.items.length, 0)
  } finally { await f.cleanup() }
})

test('持有者事实：最后一轮出错后用户又发消息不算死；取最近一次 totalTokens', () => {
  const ev = (seq, type, data) => ({ seq, time: seq * 1000, type, data })
  const crashed = tailFacts([
    ev(1, 'user/message', { content: [], source: { kind: 'user' } }),
    ev(2, 'assistant/message', { usage: { totalTokens: 100_000 } }),
    ev(3, 'assistant/attempt', { stream: [{ chunk: { type: 'usage', usage: { inputTokens: 30_000, cacheReadTokens: 190_000 } } }] }),
    ev(4, 'turn/end', { reason: { kind: 'error', error: { code: 'EMPTY_RESPONSE' } } })
  ])
  assert.equal(crashed.lastEnd.code, 'EMPTY_RESPONSE')
  assert.equal(crashed.contextTokens, 220_000)
  const resumed = tailFacts([ev(1, 'turn/end', { reason: { kind: 'error' } }), ev(2, 'user/message', { content: [], source: { kind: 'user' } })])
  assert.equal(resumed.lastEnd, undefined)
})

test('看板上下文：变大时提示用 peer_tasks 与归档；始终提醒只写一行结论', () => {
  const base = { file: '/w/.agents/TASKS.md', root: '/w', claimsRoot: '/w/.agents/claims', open: [], claimed: [], ended: 30, hasClaimRules: true }
  assert.doesNotMatch(boardContext({ ...base, size: 10_000 }), /Board ~/)
  assert.match(boardContext({ ...base, size: 10_000 }), /Write only via peer_task \(/)
  const big = boardContext({ ...base, size: 54_096 })
  assert.match(big, /Board ~48KB, 30 ended.*peer_tasks/)
  assert.match(big, /peer_task action=done/)
  // 大小按 16KB 取整：小幅变化不改上下文
  assert.equal(boardContext({ ...base, size: 54_000 }), boardContext({ ...base, size: 55_000 }))
})

test('解析 /relay tasks', () => {
  assert.deepEqual(parseRelayCommand('tasks'), { kind: 'tasks' })
  assert.deepEqual(parseRelayCommand('task t35'), { kind: 'tasks', id: 't35' })
  assert.deepEqual(parseRelayCommand('tasks --state dead,queued --limit 5'), { kind: 'tasks', states: ['dead', 'queued'], limit: 5 })
  assert.deepEqual(parseRelayCommand('tasks archive T10, T35'), { kind: 'tasks', archive: 'preview', ids: ['T10', 'T35'] })
  assert.deepEqual(parseRelayCommand('tasks archive apply 82294b00dad4'), { kind: 'tasks', archive: 'apply', planId: '82294b00dad4' })
  assert.equal(parseRelayCommand('tasks archive apply nope').kind, 'invalid')
  assert.equal(parseRelayCommand('tasks --bogus').kind, 'invalid')
})

test('投递前中和会话引用：DSH 解析器不再报错，也不拼快照', async () => {
  const { defuseSessionMentions } = await import('../lib/core.js')
  const { parseSessionReferenceText } = await import('@deepseek-ai/dsh-session-reference')
  const id = 'session-130b5eba-bcba-4503-a9c2-4fdeacd797a5'
  const uri = `dsh-session:${Buffer.from(JSON.stringify(id)).toString('base64url')}`
  const samples = [
    '写入的是一段 `@[标题](dsh-session:…)` 链接', // 真实事故：原会话回复里的示例
    `@[修 \\] 面板](${uri}) 看看`, `裸的 ${uri} 也算`, '@[x](dsh-session:!!)', 'dsh-session:ImEi', 'xdsh-session:abc', '@[x](dsh-session:)'
  ]
  for (const sample of samples) {
    // 前提：原文确实会被 DSH 当引用（报错或解析出引用）
    let raw
    try { raw = parseSessionReferenceText(sample).references.length } catch { raw = 'throws' }
    assert.ok(raw === 'throws' || raw > 0, sample)
    const out = defuseSessionMentions(sample)
    assert.deepEqual(parseSessionReferenceText(out).references, [], out)
  }
  assert.equal(defuseSessionMentions(`@[修 \\] 面板](${uri}) 看看`), `@修 ] 面板（${id}） 看看`)
  assert.equal(defuseSessionMentions(`裸的 ${uri} 也算`), `裸的 ${id} 也算`)
  assert.equal(defuseSessionMentions('写 `@[标题](dsh-session:…)`'), '写 `@[标题](dsh-session：…)`')
  assert.equal(defuseSessionMentions('没有引用'), '没有引用')
})

test('@ 会话引用：所有子命令的目标都能用；tasks 带会话只看它认领 / 接手过的', async () => {
  const { expandSessionMentions } = await import('../lib/core.js')
  const id = 'session-130b5eba-bcba-4503-a9c2-4fdeacd797a5'
  const ref = (label) => `@[${label}](dsh-session:${Buffer.from(JSON.stringify(id)).toString('base64url')})`
  assert.equal(expandSessionMentions(`看 ${ref('修 面板 [x]')} 和 ${ref('b')}`), `看 ${id} 和 ${id}`)
  assert.equal(expandSessionMentions('@[x](dsh-session:!!)'), '@[x](dsh-session:!!)')
  assert.deepEqual(parseRelayCommand(`tasks ${ref('标题')}`), { kind: 'tasks', holder: id })
  assert.deepEqual(parseRelayCommand(`tasks ${ref('标题')} --state dead`), { kind: 'tasks', holder: id, states: ['dead'] })
  assert.deepEqual(parseRelayCommand('tasks @t39-guard'), { kind: 'tasks', holder: '@t39-guard' })
  assert.equal(parseRelayCommand(`inspect ${ref('x')} tools`).target, id)
  assert.equal(parseRelayCommand(`${ref('x')} 继续`).kind, 'send')
  assert.equal(parseRelayCommand('tasks T1 T2').kind, 'invalid')
  // 模型工具直接收到 @ 链接（peer_tasks session= / peer_inspect / peer_send）也能解析
  const { resolveTarget } = await import('../lib/core.js')
  assert.equal(resolveTarget(ref('T39 [x]'), {}, [id]).sessionId, id)
  assert.equal(resolveTarget(`dsh-session:${Buffer.from(JSON.stringify(id)).toString('base64url')}`, {}, [id]).sessionId, id)
  assert.throws(() => resolveTarget('@[x](dsh-session:!!)', {}, [id]), /找不到/)
})

test('/relay wake：@ 选会话；小上下文原地唤醒，过大 / 归档 / 空响应新建接手，--resume / --new 强制', async () => {
  const { wakePlan } = await import('../lib/core.js')
  const id = 'session-130b5eba-bcba-4503-a9c2-4fdeacd797a5'
  const ref = `@[标题](dsh-session:${Buffer.from(JSON.stringify(id)).toString('base64url')})`
  assert.deepEqual(parseRelayCommand(`wake ${ref}`), { kind: 'wake', target: id })
  assert.deepEqual(parseRelayCommand(`wake ${ref} --new --as t39b 先修 lint`), { kind: 'wake', target: id, force: 'new', alias: 't39b', note: '先修 lint' })
  assert.equal(parseRelayCommand('wake @x --resume').force, 'resume')
  assert.equal(parseRelayCommand('wake').kind, 'invalid')
  assert.equal(parseRelayCommand('wake x --resume --new').kind, 'invalid')
  assert.equal(wakePlan({ exists: false }).action, 'gone')
  assert.equal(wakePlan({ exists: true, running: true }).action, 'running')
  assert.equal(wakePlan({ exists: true, contextTokens: 80_000 }).action, 'resume')
  assert.equal(wakePlan({ exists: true }).action, 'resume')
  assert.equal(wakePlan({ exists: true, contextTokens: 446_000 }).action, 'resume') // 1M 窗口下 446k 仍可原地继续
  assert.equal(wakePlan({ exists: true, contextTokens: 650_000 }).action, 'new')
  assert.equal(wakePlan({ exists: true, contextTokens: 300_000 }, { limit: 200_000 }).action, 'new')
  assert.equal(wakePlan({ exists: true, archived: true }).action, 'new')
  assert.equal(wakePlan({ exists: true, contextTokens: 50_000, lastEnd: { kind: 'error', code: 'EMPTY_RESPONSE' } }).action, 'resume') // 小上下文的空响应是偶发
  assert.equal(wakePlan({ exists: true, contextTokens: 450_000, lastEnd: { kind: 'error', code: 'EMPTY_RESPONSE' } }).action, 'new')
  assert.equal(wakePlan({ exists: true, contextTokens: 50_000, lastEnd: { kind: 'error', code: 'CONTEXT_WINDOW_EXCEEDED' } }).action, 'new')
  assert.equal(wakePlan({ exists: true, contextTokens: 50_000, lastEnd: { kind: 'error', code: 'RATE_LIMIT' } }).action, 'resume')
  assert.equal(wakePlan({ exists: true, contextTokens: 446_000 }, { force: 'resume' }).action, 'resume')
  assert.equal(wakePlan({ exists: true, contextTokens: 1_000 }, { force: 'new' }).action, 'new')
  assert.equal(wakePlan({ exists: true, running: true }, { force: 'resume' }).action, 'running')
})

test('上下文预算：默认按 1M 窗口，配置可改并保持 hint ≤ heavy ≤ handoff', async () => {
  const { resolveContextBudget, CONTEXT_BUDGET } = await import('../lib/core.js')
  assert.deepEqual(resolveContextBudget(undefined), { ...CONTEXT_BUDGET })
  assert.ok(CONTEXT_BUDGET.handoff < 1_048_576 * 0.8) // 留在 DSH 自动压缩之前
  assert.deepEqual(resolveContextBudget({ hint: 100_000, heavy: 'x', handoff: -1 }), { hint: 100_000, heavy: CONTEXT_BUDGET.heavy, handoff: CONTEXT_BUDGET.handoff })
  assert.deepEqual(resolveContextBudget({ hint: 700_000, heavy: 200_000, handoff: 300_000 }), { hint: 700_000, heavy: 700_000, handoff: 700_000 })
})
