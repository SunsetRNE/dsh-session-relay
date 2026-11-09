/** T15 票子驾驶舱：内置技能 provider、票子 gates、拉起首条消息。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TICKET_DEFAULT_SKILL, TICKET_SKILLS, collectTicketSkills, isSkillName, parseSkillFrontmatter,
  readSkillCatalog, ticketDependencyViews, ticketGates, ticketLaunchText, ticketSkillsView
} from '../lib/ticket-cockpit.js'
import { createBundledProvider, registerBundledSkills } from '../lib/bundled-skills.js'

const ROOT = new URL('..', import.meta.url).pathname

async function tempSkills() {
  const dir = await mkdtemp(join(tmpdir(), 'relay-skills-'))
  await mkdir(join(dir, 'relay-worker'), { recursive: true })
  await mkdir(join(dir, 'bad name'), { recursive: true })
  await mkdir(join(dir, 'no-desc'), { recursive: true })
  await writeFile(join(dir, 'relay-worker', 'SKILL.md'), '---\nname: relay-worker\ndescription: 工作会话技能\nwhenToUse: 被分到任务时\n---\n\n# 正文\n\n先读看板。\n')
  await writeFile(join(dir, 'bad name', 'SKILL.md'), '---\nname: bad name\ndescription: 坏名字\n---\n正文\n')
  await writeFile(join(dir, 'no-desc', 'SKILL.md'), '---\nname: no-desc\n---\n正文\n')
  return dir
}

test('内置技能：frontmatter 解析 kebab-case / whenToUse / 描述，坏文件安静跳过', async () => {
  const dir = await tempSkills()
  try {
    const parsed = parseSkillFrontmatter('---\nname: relay-main\ndescription: "主会话"\nwhenToUse: 接手时\n---\n\n正文\n')
    assert.equal(parsed.name, 'relay-main')
    assert.equal(parsed.description, '主会话')
    assert.equal(parsed.whenToUse, '接手时')
    assert.equal(parsed.content, '正文')
    assert.deepEqual(parsed.invocation, { modelInvocable: true, userInvocable: true })
    assert.equal(parseSkillFrontmatter('没有 frontmatter'), undefined)
    assert.equal(parseSkillFrontmatter('---\nname: Bad_Name\ndescription: x\n---\n'), undefined)
    assert.equal(parseSkillFrontmatter('---\nname: ok\ndescription:\n---\n'), undefined)
    const catalog = await readSkillCatalog(dir)
    assert.deepEqual(catalog.map((row) => row.name), ['relay-worker'], '坏名字 / 缺描述不进列表')
    assert.ok(isSkillName('relay-worker') && !isSkillName('Relay_Worker'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('内置技能：随包 bundled-skills 提供 relay-main / relay-worker / relay-release，项目同名优先', async () => {
  const bundled = await readSkillCatalog(join(ROOT, 'bundled-skills'))
  assert.deepEqual(bundled.map((row) => row.name), ['relay-main', 'relay-release', 'relay-worker'])
  for (const row of bundled) {
    assert.match(row.description, /\S/)
    assert.ok(row.whenToUse === undefined || typeof row.whenToUse === 'string')
    assert.equal(parseSkillFrontmatter(await readFile(row.path, 'utf8')).name, row.name)
  }
  const project = await tempSkills()
  try {
    const merged = await collectTicketSkills({ bundledDir: join(ROOT, 'bundled-skills'), projectDir: project })
    const worker = merged.find((row) => row.name === 'relay-worker')
    assert.equal(worker.source, 'project', '项目同名技能优先（与宿主 skill 档位一致）')
    const view = await ticketSkillsView({ bundledDir: join(ROOT, 'bundled-skills'), projectDir: project })
    assert.deepEqual(view.roles, TICKET_SKILLS)
    assert.equal(view.defaultSkill, TICKET_DEFAULT_SKILL)
    assert.equal(view.available, true)
    assert.ok(Array.isArray(view.list) && view.list.every((row) => ['bundled', 'project'].includes(row.source)))
  } finally { await rm(project, { recursive: true, force: true }) }
})

test('内置技能 provider：list / get 符合宿主契约，坏目录与错候选安静返回空', async () => {
  const dir = await tempSkills()
  try {
    const provider = createBundledProvider({ dir, providerName: 't15-bundled' })
    assert.equal(provider.name, 't15-bundled')
    const list = await provider.list({})
    assert.equal(list.length, 1)
    const candidate = list[0]
    assert.equal(candidate.name, 'relay-worker')
    assert.equal(candidate.provider, 't15-bundled')
    assert.equal(candidate.source, 'bundled')
    assert.equal(candidate.rank, 600)
    assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })
    assert.equal(candidate.resourceBase.kind, 'directory')
    const definition = await provider.get(candidate, {})
    assert.equal(definition.name, 'relay-worker')
    assert.equal(definition.provider, 't15-bundled')
    assert.match(definition.content, /先读看板/)
    assert.equal(await provider.get({ ...candidate, name: 'other' }, {}), undefined)
    assert.deepEqual(await createBundledProvider({ dir: join(dir, 'nope') }).list({}), [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('内置技能注册：没有 skills 服务时安静降级；有服务时注册 provider 并返回 disposer', async () => {
  const dir = await tempSkills()
  try {
    assert.equal(registerBundledSkills(undefined, { dir }), undefined)
    assert.equal(registerBundledSkills({}, { dir }), undefined)
    assert.equal(registerBundledSkills({ skills: {} }, { dir }), undefined)
    let created
    let disposed = 0
    const service = { registerProvider: (create) => { created = create({ signal: new AbortController().signal }); return () => { disposed += 1 } } }
    const dispose = registerBundledSkills({ skills: service }, { dir, providerName: 't15' })
    assert.equal(typeof dispose, 'function')
    assert.equal(created.name, 't15')
    assert.deepEqual((await created.list({})).map((row) => row.name), ['relay-worker'])
    dispose()
    assert.equal(disposed, 1)
    // 注册抛错也不外泄（插件其它功能不受影响）
    assert.equal(registerBundledSkills({ skills: { registerProvider: () => { throw new Error('dup') } } }, { dir }), undefined)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('包内容：package.json 的 files 带 bundled-skills，不再有 .dsh/skills 副本', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(pkg.files.some((pattern) => pattern.startsWith('bundled-skills')), '打包包含内置技能')
  for (const name of ['relay-main', 'relay-worker', 'relay-release']) {
    const raw = await readFile(join(ROOT, 'bundled-skills', name, 'SKILL.md'), 'utf8')
    assert.equal(parseSkillFrontmatter(raw).name, name)
  }
  await assert.rejects(readFile(join(ROOT, '.dsh', 'skills', 'relay-main', 'SKILL.md'), 'utf8'), /ENOENT|no such file/)
})

test('gates：无持有者 + 可认领 + 依赖结束 → 可拉起；各道门禁给原因', () => {
  const base = { deps: [], stage: 'ready', approval: null, skill: 'relay-worker', skills: ['relay-worker'] }
  let gates = ticketGates({ ...base, claim: null })
  assert.equal(gates.launch.allowed, true)
  assert.equal(gates.launch.reason, null)
  assert.equal(gates.deps.ok, true)
  assert.equal(gates.holder.state, 'none')
  assert.equal(gates.wake.allowed, false)

  gates = ticketGates({ ...base, claim: { state: 'claimed', holder: 'session-a' }, holder: { sessionId: 'session-a', label: '@a', state: 'live' } })
  assert.equal(gates.launch.allowed, false)
  assert.match(gates.launch.reason, /活跃持有者 @a/)
  assert.equal(gates.wake.allowed, true)

  gates = ticketGates({ ...base, claim: { state: 'claimed', holder: 'session-a' }, holder: { state: 'stale' } })
  assert.match(gates.launch.reason, /久未活动/)
  assert.equal(gates.wake.allowed, true)

  gates = ticketGates({ ...base, claim: { state: 'claimed', holder: 'session-a' }, holder: { state: 'dead' } })
  assert.equal(gates.launch.allowed, true, '失效持有者可以被新会话接手')
  assert.equal(gates.holder.replaceable, true)
  assert.equal(gates.wake.allowed, false, '失效持有者不唤醒')

  gates = ticketGates({ ...base, claim: null, deps: [{ id: 'T1', title: '前置', ended: false }] })
  assert.equal(gates.launch.allowed, false)
  assert.match(gates.launch.reason, /依赖未结束：T1/)
  assert.equal(gates.deps.ended, 0)
  assert.equal(gates.deps.pending[0].id, 'T1')

  gates = ticketGates({ ...base, claim: null, stage: 'triage' })
  assert.match(gates.launch.reason, /待分诊/)
  gates = ticketGates({ ...base, claim: null, stage: undefined })
  assert.equal(gates.launch.allowed, true, '阶段未设置按可认领处理')
  gates = ticketGates({ ...base, claim: null, approval: 'rejected' })
  assert.match(gates.launch.reason, /审批已打回/)
  gates = ticketGates({ ...base, claim: null, skill: 'missing-skill', skills: ['relay-worker'] })
  assert.match(gates.launch.reason, /missing-skill 不存在/)

  // T19：任务审批与合并流水线分开；版本未发布只给 nextTag，已发布才给实际 tag。
  gates = ticketGates({ ...base, claim: null, approval: 'approved', merge: { stage: 'ready', sha: 'abc' }, release: { nextTag: 'v2.4.4' } })
  assert.equal(gates.approval.value, 'approved', '任务审批是 approved')
  assert.equal(gates.merge.stage, 'ready', '合并仍是可合并（审批 ≠ 合并）')
  assert.equal(gates.release.nextTag, 'v2.4.4')
  assert.equal(gates.release.tag, null, '未发布不给实际 tag')
  assert.equal(gates.release.released, false)

  gates = ticketGates({ ...base, claim: null, merge: { stage: 'approved', approved: true, sha: 'abcdef1234' }, release: { nextTag: 'v2.4.4' } })
  assert.equal(gates.merge.stage, 'approved')
  assert.equal(gates.merge.approved, true)
  assert.equal(gates.merge.sha, 'abcdef1234')
  assert.equal(gates.release.tag, null)

  gates = ticketGates({ ...base, claim: { state: 'done' }, terminal: 'merged', merge: { stage: 'local-merged', pendingPush: true, sha: '73001c2', approved: true }, release: { nextTag: 'v2.4.4' } })
  assert.equal(gates.ended, true)
  assert.equal(gates.launch.allowed, false)
  assert.match(gates.launch.reason, /只读/)
  assert.equal(gates.merge.stage, 'local-merged')
  assert.equal(gates.merge.pendingPush, true, '本地已合入 · 待推送')
  assert.equal(gates.merge.sha, '73001c2')
  assert.equal(gates.release.nextTag, 'v2.4.4')
  assert.equal(gates.release.released, false)

  gates = ticketGates({ ...base, claim: { state: 'done' }, terminal: 'merged', merge: { stage: 'released', sha: 'abcdef1234', merged: 'main e071cf10' }, release: { nextTag: 'v2.4.4', tag: 'v2.4.3', released: true } })
  assert.equal(gates.merge.stage, 'released')
  assert.equal(gates.release.released, true)
  assert.equal(gates.release.tag, 'v2.4.3', '已发布才显示实际 tag')
})

test('依赖明细：认领状态与看板文字都能判断结束，未结束的保留给 UI', () => {
  const rowOf = new Map([
    ['T1', { id: 'T1', title: '一', status: '已合入（main）' }],
    ['T2', { id: 'T2', title: '二', status: '进行中（@w）' }],
    ['T3', { id: 'T3', title: '三', status: '待认领' }]
  ])
  const view = ticketDependencyViews(['T1', 'T2', 'T3', 'T9'], {
    rowOf,
    openIds: new Set(['T3']),
    claimedIds: new Set(['T2']),
    endedIds: new Set(['T1'])
  })
  assert.deepEqual(view.map((item) => [item.id, item.ended, item.state]), [['T1', true, 'ended'], ['T2', false, 'claimed'], ['T3', false, 'open'], ['T9', false, null]])
})

test('拉起首条消息：票子完整字段 + 先加载技能 + 边界；长正文截断', () => {
  const text = ticketLaunchText({
    task: 'T15', title: '票子驾驶舱', priority: 'P1', sessionId: 'session-new', alias: 't15',
    workspaceTitle: 'relay', coordinatorLabel: '@main', skill: 'relay-worker',
    boardPath: '/w/.agents/TASKS.md', claimsPath: '/w/.agents/claims',
    branch: 't15', worktree: '.agents/worktrees/t15', stage: 'doing', approval: 'approved',
    deps: [{ id: 'T14', title: '前置', ended: true }], children: [{ id: 'T15.1', title: '子票' }],
    parent: { id: 'T10', title: '父任务' }, issue: { number: 7, url: 'https://github.com/o/r/issues/7' },
    pr: { number: 9, url: 'https://github.com/o/r/pull/9', label: 'PR #9' },
    line: 'v2.4.3 已发布', body: '验收：串行测试全绿。\n'.repeat(400)
  })
  for (const part of ['T15', '票子驾驶舱', '依赖：T14 前置（已结束）', '子票：T15.1 子票', '父任务：T10 父任务',
    '#7', '#9', 'v2.4.3 已发布', '先加载技能：调用 skill 工具加载内置技能「relay-worker」',
    '已由用户代你登记', '.agents/worktrees/t15', '验收：串行测试全绿', '不 push、不合并、不发版']) {
    assert.ok(text.includes(part), '缺少 ' + part)
  }
  assert.ok(text.length < 8000, '正文有上限')
})
