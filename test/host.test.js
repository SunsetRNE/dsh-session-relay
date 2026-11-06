/** 用模拟 Host 服务验证 /relay 命令与 peer_* 工具的接线（不启动真实 DSH）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { parseRelayCommand } from '../lib/core.js'
import { fileURLToPath } from 'node:url'
import { after } from 'node:test'
import { execFileSync } from 'node:child_process'
import { sampleEvents } from './fixtures/inspect-events.js'
import { fixture as taskFixture } from './fixtures/task-board.js'
import { mkdir, readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { parseTaskDoc } from '../lib/tasks.js'

// 代次目录必须在包目录内（裸模块名从包的 node_modules 解析），测试用单独的目录并在结束时清理
const STAGE = join(fileURLToPath(new URL('..', import.meta.url)), '.gen-test')
after(() => rm(STAGE, { recursive: true, force: true }))

function makeAgent(id, { depth = 0, status = 'idle', cwd = '/tmp' } = {}) {
  const events = []
  const agent = {
    id,
    status,
    options: {},
    inbox: [],
    session: { id, header: { cwd, delegationDepth: depth }, snapshotEvents: () => events },
    followup(message) { agent.inbox.push(['followup', message]) },
    steer(message) { agent.inbox.push(['steer', message]) },
    inject(message) { agent.inbox.push(['queue', message]) }
  }
  return agent
}

async function setup(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'relay-host-'))
  const agents = new Map()
  const listeners = {}
  const commands = new Map()
  const tools = new Map()
  let counter = 0
  const caller = makeAgent('aaaaaaaa-0000-0000-0000-000000000001', { cwd: dir })
  const peer = makeAgent('bbbbbbbb-0000-0000-0000-000000000002', { cwd: dir, status: 'running' })
  const child = makeAgent('cccccccc-0000-0000-0000-000000000003', { cwd: dir, depth: 1 })
  for (const agent of [caller, peer, child]) agents.set(agent.id, agent)
  const listed = () => [...agents.values()].map((agent) => ({
    sessionId: agent.id,
    running: agent.status === 'running',
    agentAvailable: true,
    cwd: agent.session.header.cwd,
    ...(agent.session.header.delegationDepth > 0 ? { parentSessionId: caller.id } : {}),
    projections: { values: { title: `title of ${agent.id.slice(0, 4)}` } }
  }))
  const ctx = {
    sessionController: {
      list: async () => ({ items: listed() }),
      resolveAgent: async (id) => agents.has(id) ? { agent: agents.get(id) } : { error: new Error('not found') },
      create: async ({ workspaceId }) => {
        assert.equal(workspaceId, 'ws-1')
        const agent = makeAgent(`dddddddd-0000-0000-0000-00000000000${++counter}`, { cwd: dir })
        agents.set(agent.id, agent)
        return { sessionId: agent.id }
      }
    },
    workspaceRegistry: {
      archivedSessionIds: [],
      list: () => workspaces,
      create: async (path) => ({ id: 'ws-1', path })
    },
    sessions: { flush: async () => true, get: (id) => agents.get(id)?.session, list: () => [...agents.values()].map((agent) => agent.session) },
    get: (name) => services[name],
    waterfall: async (_name, { sessionId }, next) => (busy.has(sessionId) ? [{ kind: 'turn' }] : next()),
    logger: { warn() {} },
    on: (name, fn) => { listeners[name] = fn },
    effect: () => {},
    inject: (_names, fn) => fn({
      commands: { register: (definition) => { commands.set(definition.name, definition); return () => { if (commands.get(definition.name) === definition) commands.delete(definition.name) } } },
      tools: { register: (tool) => { tools.set(tool.name, tool); return () => { if (tools.get(tool.name) === tool) tools.delete(tool.name) } } },
      systemPrompt: { context: (entry) => contexts.push(entry) },
      webServer: { register: (route) => { routes.push(route); return () => {} } },
      connection: { requestRejection: () => undefined },
      effect: (fn) => fn()
    })
  }
  const busy = new Set()
  const services = {}
  const workspaces = []
  const contexts = []
  const routes = []
  const timers = []
  const notified = []
  const shell = apply(ctx, {
    stageRoot: STAGE, identityForAll: false,
    notify: async (title, text) => { notified.push([title, text]) },
    restart: { intervalMs: 1_000_000, stableMs: 0 },
    aliasPath: join(dir, 'aliases.json'), statePath: join(dir, 'coordination.json'), templatePath: join(dir, 'templates.json'), handoffPath: join(dir, 'handoffs.json'), pinPath: join(dir, 'pins.json'), watchPath: join(dir, 'watches.json'), watch: false, autoPinIntervalMs: 0, titlePath: join(dir, 'titles.json'), autoTitleIntervalMs: 0, chainWatchIntervalMs: 0, deadlinePath: join(dir, 'deadlines.json'), deadlineTickMs: 0, remoteReleaseTags: false, maxHops: 2, githubAuto: false,
    ...options,
    setTimer: (fn) => { timers.push(fn); return timers.length }, clearTimer: () => {}
  })
  assert.match(await shell.ready, /已加载/)
  const relay = shell.relay
  const contextFor = (agent) => contexts[0].text({ agent })
  const run = (raw, agent = caller) => commands.get('relay').handler({ rawInput: raw, agent, signal: AbortSignal.timeout(5000) })
  const call = (name, args, agent = caller) => tools.get(name).execute(args, { agent, signal: AbortSignal.timeout(5000) })
  return { dir, caller, peer, child, agents, listeners, commands, tools, run, call, relay, routes, shell, busy, notified, workspaces, services, timers, contextFor, makeAgent, cleanup: async () => { await shell.relay?.away?.chain; await rm(dir, { recursive: true, force: true }) } }
}

test('注册了 /relay 与四个 peer 工具', async () => {
  const h = await setup()
  try {
    assert.ok(h.commands.has('relay'))
    assert.equal(h.routes[0].path, '/api/dsha-session-relay')
    assert.deepEqual([...h.tools.keys()].sort(), ['peer_alias', 'peer_ask_user', 'peer_assign', 'peer_handoff', 'peer_inspect', 'peer_line', 'peer_list', 'peer_mail', 'peer_report', 'peer_send', 'peer_spawn', 'peer_task', 'peer_tasks', 'peer_watch'])
  } finally { await h.cleanup() }
})

test('/relay list 排除子代理会话，标出当前会话', async () => {
  const h = await setup()
  try {
    const result = await h.run('list')
    assert.equal(result.kind, 'success')
    assert.match(result.text, /aaaaaaaa.*← 当前/)
    assert.match(result.text, /bbbbbbbb.*运行中/)
    assert.doesNotMatch(result.text, /cccccccc/)
  } finally { await h.cleanup() }
})

test('/relay alias + 发送：真人指令以 user 来源 hop=0 送达', async () => {
  const h = await setup()
  try {
    assert.equal((await h.run(`alias rel ${h.peer.id.slice(0, 8)}`)).kind, 'success')
    const result = await h.run('rel 先跑 lintStandardRelease')
    assert.equal(result.kind, 'success')
    assert.match(result.text, /正在运行，已排在本轮之后/)
    const [mode, message] = h.peer.inbox.at(-1)
    assert.equal(mode, 'followup')
    assert.deepEqual(message.source, { kind: 'user' })
    assert.match(message.content[0].text, /用户经 \/relay/)
    assert.match(message.content[0].text, /先跑 lintStandardRelease$/)
  } finally { await h.cleanup() }
})

test('/relay new：在当前工作目录新建会话、设别名并立刻开始', async () => {
  const h = await setup()
  try {
    const result = await h.run('new --as lint 读 TASKS.md 认领任务')
    assert.equal(result.kind, 'success', result.text)
    const created = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    assert.ok(created)
    assert.equal(created.inbox[0][0], 'followup')
    assert.match(created.inbox[0][1].content[0].text, /^读 TASKS.md 认领任务/)
    // 别名已可用
    assert.equal((await h.run('lint --queue 补充一句')).kind, 'success')
    assert.equal(created.inbox.at(-1)[0], 'queue')
    // 别名占用
    assert.equal((await h.run('new --as lint 再来')).kind, 'error')
  } finally { await h.cleanup() }
})

test('拒绝：发给自己、发给子代理、子代理调用、坏目录', async () => {
  const h = await setup()
  try {
    assert.match((await h.run(`${h.caller.id} hi`)).text, /不能发给自己/)
    // 自己的子代理：插件打不开子代理，让本会话用原生 send_message
    assert.match((await h.run(`${h.child.id} hi`)).text, /你自己的子代理 cccccccc.*send_message/)
    await assert.rejects(h.call('peer_line', { text: 'x' }, h.child), /只给根会话用/)
    assert.match((await h.run('new --cwd /definitely/missing x')).text, /工作目录不存在/)
  } finally { await h.cleanup() }
})

test('peer_send：模型消息标记为 agent-message，并在 maxHops 后拒绝', async () => {
  const h = await setup()
  try {
    await h.call('peer_alias', { alias: 'peer' }, h.peer)
    await h.call('peer_alias', { alias: 'me2' }, h.caller)
    // caller 收到真人消息
    h.listeners['session/event'](h.caller.session, { type: 'user/message', data: { source: { kind: 'user' } } })
    const out = await h.call('peer_send', { target: 'peer', message: '已完成，提交 abc' })
    assert.match(out, /已送达 @peer/)
    const message = h.peer.inbox.at(-1)[1]
    assert.deepEqual(message.source, { kind: 'agent-message', form: 'relay', senderSessionId: h.caller.id })
    assert.match(message.content[0].text, /第 1\/2 跳/)
    assert.match(message.content[0].text, /不是用户本人的指令/)
    // peer 被这条中继消息唤醒，回复 → hop 2
    h.listeners['session/event'](h.peer.session, { type: 'user/message', data: message })
    await h.call('peer_send', { target: 'me2', message: '收到' }, h.peer)
    const back = h.caller.inbox.map(([, item]) => item).find((item) => /第 2\/2 跳/.test(String(item?.content?.[0]?.text ?? '')))
    assert.ok(back !== undefined)
    assert.match(back.content[0].text, /第 2\/2 跳/)
    h.listeners['session/event'](h.caller.session, { type: 'user/message', data: back })
    await assert.rejects(h.call('peer_send', { target: 'peer', message: '再说一句' }), /跳/)
  } finally { await h.cleanup() }
})

test('peer_send mode=interrupt：主会话专用，插入主会话指令；worker 不能调用', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    const out = await h.call('peer_send', { target: h.peer.id, message: '停止当前工作并汇报进度', mode: 'interrupt', stop: true })
    assert.match(out, /插播主会话指令/)
    const message = h.peer.inbox.at(-1)[1]
    assert.match(message.content[0].text, /\[主会话指令 · 停止并汇报\] 停止当前工作并汇报进度/)
    await assert.rejects(h.call('peer_send', { target: h.caller.id, message: 'x', mode: 'interrupt' }, h.peer), /只给本工作区主会话/)
  } finally { await h.cleanup() }
})

test('peer_mail：主会话发给单个会话后能 list/force/归档，目标收短通知与强推全文', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    const sent = await h.call('peer_mail', { action: 'send', to: h.peer.id, subject: '给 peer 的通知', body: '正文 1.4.0 验收', deadline_minutes: 1 })
    assert.match(sent, /已发送邮箱消息/)
    const id = sent.match(/m_[a-z0-9]+/)?.[0]
    assert.ok(id !== undefined, sent)
    // 目标只收到一行短通知，不长正文。
    const notice = h.peer.inbox.at(-1)[1].content[0].text
    assert.match(notice, /协作邮箱/)
    assert.match(notice, new RegExp(id))
    assert.doesNotMatch(notice, /正文 1\.4\.0 验收/)
    // 主会话能看到只发给 peer 的消息（之前 scope=session 对主会话不可见，force 会报错）。
    assert.match(await h.call('peer_mail', { action: 'list' }), /给 peer 的通知/)
    const forced = await h.call('peer_mail', { action: 'force', ids: [id] })
    assert.match(forced, /已强推 1 条/)
    assert.match(h.peer.inbox.at(-1)[1].content[0].text, /正文 1\.4\.0 验收/)
    // 目标自己读全文，主会话归档后双方都看不到。
    assert.match(await h.call('peer_mail', { action: 'read', ids: [id] }, h.peer), /正文 1\.4\.0 验收/)
    assert.match(await h.call('peer_mail', { action: 'mark', ids: [id], state: 'archived' }), /已归档/)
    assert.match(await h.call('peer_mail', { action: 'list' }), /没有消息/)
  } finally { await h.cleanup() }
})

test('邮箱批量：窗口内合并一条短通知；/relay mail 可列表/读全文/归档', async () => {
  const h = await setup({ mailboxBatchWindowMs: 0, mailboxTickMs: 0 })
  try {
    await h.run('main here')
    const group = h.relay.groupKeyOf(h.caller.id)
    const publish = (subject, body) => h.relay.publishMail({ group, from: 'plugin', targets: [h.peer.id], kind: 'watch', severity: 'info', subject, body, batch: true })
    const first = await publish('CI 1 成功', '正文一')
    await publish('CI 2 成功', '正文二')
    assert.equal(first.scheduled, true)
    // 窗口内不立刻发；tick 后合并成一条。
    assert.equal(h.peer.inbox.filter(([, message]) => /协作邮箱/.test(message.content[0].text)).length, 0)
    await h.relay.mailboxTick()
    const notices = h.peer.inbox.filter(([, message]) => /协作邮箱/.test(message.content[0].text))
    assert.equal(notices.length, 1)
    assert.match(notices[0][1].content[0].text, /2 条新消息/)
    assert.match(notices[0][1].content[0].text, /CI 2 成功/)
    assert.equal(h.notified.length, 0, '批量短通知不响手机')

    const list = await h.run('mail')
    assert.equal(list.kind, 'success')
    assert.match(list.text, /CI 2 成功/)
    assert.match(list.text, /最近 7 天/)
    const ids = h.relay.mailbox.items().map((item) => item.id)
    const read = await h.run(`mail read ${ids.join(' ')}`)
    assert.match(read.text, /正文一/)
    assert.match(read.text, /正文二/)
    assert.match(await h.run('mail archive read').then((result) => result.text), /已归档/)
    assert.match(await h.run('mail').then((result) => result.text), /没有消息/)
  } finally { await h.cleanup() }
})

test('peer_send：模型发给已卸任的主会话时拒绝，并给出现任主会话 id（用户发不拦）', async () => {
  const h = await setup()
  try {
    // peer 原是主会话，交接给 caller
    await h.run('main here', h.peer)
    await h.run('main here', h.caller)
    const key = h.relay.groupKeyOf(h.caller.id)
    await h.relay.handoffs.complete(key, { from: h.peer.id, to: h.caller.id })
    const other = h.makeAgent('eeeeeeee-0000-0000-0000-000000000005', { cwd: h.dir })
    h.agents.set(other.id, other)
    await assert.rejects(h.call('peer_send', { target: h.peer.id, message: '旧主会话收' }, other), (error) => {
      assert.equal(error.code, 'former_main')
      assert.match(error.message, new RegExp('现任主会话是 ' + h.caller.id))
      return true
    })
    assert.equal(h.peer.inbox.length, 0, '旧会话没被唤醒')
    // 用户从 /relay 发照常送达
    await h.run(`${h.peer.id} 用户亲自问一句`, h.caller)
    assert.equal(h.peer.inbox.length, 1)
  } finally { await h.cleanup() }
})

test('peer_send：main@<工作区> 每次解析成那个工作区的现任主会话，交接后自动跟到新主会话', async () => {
  const h = await setup()
  try {
    const mainA = h.makeAgent('eeeeeeee-0000-0000-0000-00000000000a', { cwd: '/root/DSH-A-mod' })
    const mainB = h.makeAgent('ffffffff-0000-0000-0000-00000000000b', { cwd: '/root/DSH-A-mod' })
    for (const agent of [mainA, mainB]) h.agents.set(agent.id, agent)
    h.workspaces.push(
      { id: 'ws-a', title: 'DSH-A-mod', path: '/root/DSH-A-mod', sessionIds: [mainA.id, mainB.id] },
      { id: 'ws-r', title: 'relay', path: '/root/dsha-session-relay', sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here', mainA)
    await h.call('peer_send', { target: 'main@DSH-A-mod', message: '对接要求' })
    assert.equal(mainA.inbox.length, 1)
    // 交接：B 成为主会话；同一个写法自动送到 B
    await h.run('main here', mainB)
    await h.call('peer_send', { target: 'main@dsh-a-mod', message: '第二条' })
    assert.equal(mainB.inbox.length, 1)
    assert.equal(mainA.inbox.length, 1, '旧主会话不再收到')
    // 按路径末段也能写；不存在的工作区报出可选名字
    await h.call('peer_send', { target: '@main@/root/DSH-A-mod', message: '第三条' })
    assert.equal(mainB.inbox.length, 2)
    await assert.rejects(h.call('peer_send', { target: 'main@nope', message: 'x' }), /找不到工作区「nope」；可用：DSH-A-mod、relay/)
    await assert.rejects(h.call('peer_send', { target: 'main@relay', message: 'x' }), /还没有主会话/)
  } finally { await h.cleanup() }
})

// 仿 DSH agent inbox：next-turn / next-step 两个列表，按 id 删除
function withRealInbox(agent) {
  const lists = { 'next-turn': [], 'next-step': [] }
  agent.status = 'running'
  agent.inbox = {
    get nextTurn() { return lists['next-turn'] },
    get nextStep() { return lists['next-step'] },
    remove(id) {
      for (const key of Object.keys(lists)) { const at = lists[key].findIndex((m) => m.id === id); if (at >= 0) { lists[key].splice(at, 1); return true } }
      return false
    }
  }
  agent.followup = (message) => { lists['next-turn'].push(message) }
  agent.inject = (message) => { lists['next-step'].push(message) }
  agent.steer = (message) => { lists['next-step'].push(message) }
  agent.take = () => lists['next-turn'].shift()
  return agent
}

test('peer_send 队列：回执带消息 id 与对方队列状态；withdraw 列出 / 按 id / all 撤回，只能撤自己的', async () => {
  const h = await setup()
  try {
    withRealInbox(h.peer)
    const third = h.makeAgent('eeeeeeee-0000-0000-0000-000000000007', { cwd: h.dir })
    h.agents.set(third.id, third)
    const r1 = await h.call('peer_send', { target: h.peer.id, message: '第一条：发布 run 进行中' })
    const id1 = /消息 id (\S+?)（/.exec(r1)[1]
    assert.match(r1, /对方队列现有 1 条（其中你发的 1 条，最早一条排了 不到 1 分钟）/)
    const r2 = await h.call('peer_send', { target: h.peer.id, message: '第二条：合并指令' })
    assert.match(r2, /对方队列现有 2 条（其中你发的 2 条/)
    await h.call('peer_send', { target: h.peer.id, message: '别人发的' }, third)
    // 列出：只列自己的两条，带正文摘要（去掉插件头）
    const list = await h.call('peer_send', { action: 'withdraw', target: h.peer.id })
    assert.match(list, /队列里共 3 条，你能撤回 2 条/)
    assert.match(list, /第一条：发布 run 进行中/)
    assert.ok(!list.includes('别人发的'))
    assert.ok(!list.includes('不是用户本人的指令'), '摘要不含插件加的头')
    // 按 id 撤回一条
    assert.match(await h.call('peer_send', { action: 'withdraw', target: h.peer.id, id: id1 }), /撤回 1 条；队列里还剩 2 条/)
    await assert.rejects(h.call('peer_send', { action: 'withdraw', target: h.peer.id, id: id1 }), /队列里没有这条/)
    // 别人的那条撤不了
    const otherId = h.peer.inbox.nextTurn.find((m) => m.source.senderSessionId === third.id).id
    await assert.rejects(h.call('peer_send', { action: 'withdraw', target: h.peer.id, id: otherId }), /不是你.*发的/)
    // all：只撤自己的
    assert.match(await h.call('peer_send', { action: 'withdraw', target: h.peer.id, id: 'all' }), /撤回 1 条；队列里还剩 1 条/)
    assert.equal(h.peer.inbox.nextTurn.length, 1)
    // 对方已取走的撤不回
    const r3 = await h.call('peer_send', { target: h.peer.id, message: '第三条' })
    const id3 = /消息 id (\S+?)（/.exec(r3)[1]
    h.peer.take(); h.peer.take()
    await assert.rejects(h.call('peer_send', { action: 'withdraw', target: h.peer.id, id: id3 }), /可能已经送达/)
    await assert.rejects(h.call('peer_send', { target: h.peer.id }), /send 需要 message/)
  } finally { await h.cleanup() }
})

test('peer_send 队列：supersede 作废自己之前排队的，只留最新一条；别人的不动', async () => {
  const h = await setup()
  try {
    withRealInbox(h.peer)
    const third = h.makeAgent('eeeeeeee-0000-0000-0000-000000000008', { cwd: h.dir })
    h.agents.set(third.id, third)
    await h.call('peer_send', { target: h.peer.id, message: '旧指令 1' })
    await h.call('peer_send', { target: h.peer.id, message: '旧指令 2' })
    await h.call('peer_send', { target: h.peer.id, message: '别人的' }, third)
    const out = await h.call('peer_send', { target: h.peer.id, message: '最新指令', supersede: true })
    assert.match(out, /已作废你之前排队的 2 条/)
    const texts = h.peer.inbox.nextTurn.map((m) => m.content[0].text)
    assert.equal(texts.length, 2)
    assert.ok(texts.some((t) => t.includes('最新指令')) && texts.some((t) => t.includes('别人的')))
  } finally { await h.cleanup() }
})

test('peer_send 队列：现任主会话能撤回前任主会话排队的消息，并写审计', async () => {
  const h = await setup()
  try {
    withRealInbox(h.peer)
    const oldMain = h.makeAgent('eeeeeeee-0000-0000-0000-000000000009', { cwd: h.dir })
    h.agents.set(oldMain.id, oldMain)
    await h.run('main here', oldMain)
    await h.call('peer_send', { target: h.peer.id, message: '前任发的：发布进行中' }, oldMain)
    // 交接给 caller
    await h.run('main here', h.caller)
    await h.relay.handoffs.complete(h.relay.groupKeyOf(h.caller.id), { from: oldMain.id, to: h.caller.id })
    const list = await h.call('peer_send', { action: 'withdraw', target: h.peer.id })
    assert.match(list, /你能撤回 1 条/)
    assert.match(list, /前任主会话 eeeeeeee 发的/)
    assert.match(await h.call('peer_send', { action: 'withdraw', target: h.peer.id, id: 'all' }), /撤回 1 条/)
    const { readFile } = await import('node:fs/promises')
    const audit = (await readFile(h.relay.queueAuditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(audit.at(-1).event, 'withdraw-former')
    assert.equal(audit.at(-1).by, h.caller.id)
    assert.equal(audit.at(-1).messages[0].from, oldMain.id)
    // 不是主会话的会话看不到也撤不了前任的
    const worker = h.makeAgent('eeeeeeee-0000-0000-0000-00000000000c', { cwd: h.dir })
    h.agents.set(worker.id, worker)
    await h.relay.send({ caller: oldMain, target: h.peer.id, text: '前任又一条', mode: 'followup', origin: 'model' }).catch(() => {})
    assert.match(await h.call('peer_send', { action: 'withdraw', target: h.peer.id }, worker), /没有你能撤回的/)
  } finally { await h.cleanup() }
})

test('peer_send 队列：宿主看不到对方队列时 withdraw 说明原因', async () => {
  const h = await setup()
  try {
    await h.call('peer_send', { target: h.peer.id, message: '普通替身' })
    await assert.rejects(h.call('peer_send', { action: 'withdraw', target: h.peer.id }), /看不到对方的待送队列/)
  } finally { await h.cleanup() }
})

test('peer_spawn：新会话首条消息带 Agent 创建说明', async () => {
  const h = await setup()
  try {
    const out = await h.call('peer_spawn', { task: '修 lint', alias: 'fix' })
    assert.match(out, /已新建会话 @fix/)
    const created = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    assert.match(created.inbox[0][1].content[0].text, /由平级会话 .* 的 Agent 创建/)
    assert.equal(created.inbox[0][1].source.kind, 'agent-message')
  } finally { await h.cleanup() }
})

const flushTimers = async (h) => { for (const fn of h.timers.splice(0)) await fn(); await new Promise((r) => setImmediate(r)) }

test('主会话 + /relay new：工作会话汇报合并后只唤醒主会话一次', async () => {
  const h = await setup()
  try {
    assert.match((await h.run('main here')).text, /主会话：/)
    await h.run('new --as w1 修 lint')
    await h.run('new --as w2 修文案')
    const [w1, w2] = [...h.agents.values()].filter((agent) => agent.id.startsWith('dddddddd'))
    assert.match(w1.inbox[0][1].content[0].text, /peer_report/)
    // 工作会话上下文告诉它主会话是谁
    assert.match(h.contextFor(w1), /role="worker"[\s\S]*Main session:/)
    // working 只记看板，不排投递
    assert.match(await h.call('peer_report', { status: 'working', summary: '跑测试中' }, w1), /未唤醒/)
    assert.equal(h.timers.length, 0)
    await h.call('peer_report', { status: 'ready', summary: 'lint 修好了', branch: 'fix/lint', commit: 'abc1234' }, w1)
    await h.call('peer_report', { status: 'question', summary: '版本号？', question: '273 还是 274' }, w2)
    assert.equal(h.timers.length, 1, '两条汇报共用一个合并窗口')
    const before = h.caller.inbox.length
    await flushTimers(h)
    assert.equal(h.caller.inbox.length, before + 1)
    const [mode, message] = h.caller.inbox.at(-1)
    assert.equal(mode, 'followup', '主会话空闲时唤醒')
    assert.match(message.content[0].text, /状态汇报 2 条/)
    assert.match(message.content[0].text, /提交 abc1234/)
    assert.match(message.content[0].text, /问题：273 还是 274/)
    // 主会话上下文里有看板，待答复排在最前
    const ctxText = h.contextFor(h.caller)
    assert.match(ctxText, /role="main"/)
    // 插件分类：需要处理（待答复）在可合并之前
    assert.match(ctxText, /【需要处理】\n- @w2[^\n]*待答复[\s\S]*【可合并】\n- @w1/)
    // 主会话正在运行时，汇报插进本轮而不是另开一轮
    h.caller.status = 'running'
    await h.call('peer_report', { status: 'done', summary: '完成' }, w2)
    await flushTimers(h)
    assert.equal(h.caller.inbox.at(-1)[0], 'queue')
    // 主会话回复工作会话：用宽上限
    assert.match(await h.call('peer_send', { target: 'w1', message: '合进 build273' }), /已送达/)
    assert.match(await h.call('peer_send', { target: 'main', message: '收到' }, w1), /已送达 @main/)
    await assert.rejects(h.call('peer_report', { status: 'ready', summary: 'x' }), /主会话不用汇报/)
    assert.match((await h.run('board')).text, /@w1[\s\S]*可合并/)
  } finally { await h.cleanup() }
})

test('接管：另一个会话成为主会话后汇报改送新主会话', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    await h.run('new --as w1 任务')
    const w1 = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    h.peer.status = 'idle'
    const out = await h.run(`main set ${h.peer.id.slice(0, 8)}`, w1)
    assert.match(out.text, /接管自/)
    await h.call('peer_report', { status: 'blocked', summary: '缺签名' }, w1)
    await flushTimers(h)
    assert.match(h.peer.inbox.at(-1)[1].content[0].text, /缺签名/)
    assert.match(h.contextFor(h.peer), /role="main"/)
    assert.match((await h.run('main clear')).text, /已取消主会话/)
    // 没有主会话时送创建者
    await h.call('peer_report', { status: 'done', summary: '完了' }, w1)
    await flushTimers(h)
    assert.match(h.caller.inbox.at(-1)[1].content[0].text, /完了/)
  } finally { await h.cleanup() }
})

test('一轮结束自动把最后一段回复写进看板，不唤醒；本轮已汇报则不覆盖', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    await h.run('new --as w1 任务')
    const w1 = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    const say = (text) => h.listeners['session/event'](w1.session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })
    h.listeners['agent/status']({ agent: w1, status: 'running' })
    say('改完了 build.gradle，测试通过')
    h.listeners['agent/status']({ agent: w1, status: 'idle' })
    await h.relay.coord.chain
    assert.match(h.relay.coord.snapshot().board[w1.id].lastTurn, /测试通过/)
    assert.equal(h.timers.length, 0)
    h.listeners['agent/status']({ agent: w1, status: 'running' })
    await new Promise((r) => setTimeout(r, 2))
    await h.call('peer_report', { status: 'ready', summary: '可合并' }, w1)
    say('另一段')
    h.listeners['agent/status']({ agent: w1, status: 'idle' })
    await h.relay.coord.chain
    assert.doesNotMatch(h.relay.coord.snapshot().board[w1.id].lastTurn, /另一段/)
  } finally { await h.cleanup() }
})

test('参与范围收紧：同目录不算；工作树里的、/relay new 建的、主动汇报的算；leave 退出', async () => {
  const h = await setup()
  try {
    assert.equal(h.contextFor(h.peer), '')
    await h.run('main here')
    // 与主会话同目录但从没汇报：不注入、不自动写看板
    assert.equal(h.contextFor(h.peer), '')
    h.listeners['session/event'](h.peer.session, { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '无关工作' }] } } })
    h.listeners['agent/status']({ agent: h.peer, status: 'idle' })
    await h.relay.coord.chain
    assert.equal(h.relay.coord.snapshot().board[h.peer.id], undefined)
    // 主动汇报后加入
    await h.call('peer_report', { status: 'working', summary: '开始' }, h.peer)
    assert.match(h.contextFor(h.peer), /role="worker"/)
    // leave 退出：移出看板、不再注入；再次汇报会重新加入
    assert.match((await h.run('leave', h.peer)).text, /已退出协作/)
    assert.equal(h.contextFor(h.peer), '')
    assert.doesNotMatch((await h.run('board')).text, /开始/)
    await h.call('peer_report', { status: 'working', summary: '回来了' }, h.peer)
    assert.match(h.contextFor(h.peer), /role="worker"/)
    // .agents/worktrees 下的会话自动算
    const wt = h.makeAgent('ffffffff-0000-0000-0000-00000000000a', { cwd: join(h.dir, '.agents', 'worktrees', 'fix', 'x') })
    h.agents.set(wt.id, wt)
    assert.match(h.contextFor(wt), /role="worker"/)
    const outsider = h.makeAgent('eeeeeeee-0000-0000-0000-000000000009', { cwd: '/elsewhere' })
    assert.equal(h.contextFor(outsider), '')
    assert.equal(h.contextFor(h.child), '')
    assert.match((await h.run('leave')).text, /主会话/)
  } finally { await h.cleanup() }
})

test('版本线：用户设定后主会话与工作会话上下文都可见；只有主会话模型能用 peer_line', async () => {
  const h = await setup()
  try {
    assert.match((await h.run('line')).text, /还没有版本线/)
    await h.run('main here')
    await h.run('new --as w1 任务')
    const w1 = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    const before = w1.inbox.length
    assert.match((await h.run('line main=build280（f55e3b3c）\n推前跑 lintStandardRelease')).text, /版本线已设定/)
    assert.equal(w1.inbox.length, before, '不唤醒工作会话')
    assert.match(h.contextFor(w1), /<version-line set-by="user"[\s\S]*build280[\s\S]*lintStandardRelease/)
    assert.match(h.contextFor(h.caller), /<version-line[\s\S]*build280/)
    await assert.rejects(h.call('peer_line', { text: 'main=build999' }, w1), /只有本工作区的主会话/)
    assert.match(await h.call('peer_line', { text: 'main=build281（abc）' }), /已更新/)
    // 不带 text：任何根会话（含工作会话）读全文
    assert.match(await h.call('peer_line', {}, w1), /main=build281（abc）/)
    const worker = h.contextFor(w1)
    assert.match(worker, /set-by="main-agent"[\s\S]*build281[\s\S]*not a user instruction/)
    assert.match((await h.run('board')).text, /版本线（.*build281/)
    assert.match((await h.run('line clear')).text, /已清除/)
    assert.doesNotMatch(h.contextFor(w1), /version-line/)
  } finally { await h.cleanup() }
})

test('指令模板：保存、列出、--tpl 新建与发送（补充附在后面）、删除', async () => {
  const h = await setup()
  try {
    const body = '读 /root/DSH-A-mod/.agents/TASKS.md，按「认领规则」认领一个可认领的最高优先任务并完成；\n只做该任务，需要我操作手机或做决定时再问我。'
    assert.match((await h.run(`tpl save claim ${body}`)).text, /已保存/)
    assert.match((await h.run('tpl')).text, /^claim · /)
    assert.equal((await h.run('tpl show claim')).text, body)
    assert.equal((await h.run('new --as c1 --tpl claim')).kind, 'success')
    const c1 = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    const first = c1.inbox[0][1].content[0].text
    assert.ok(first.startsWith(body), first)
    assert.match(first, /peer_report/)
    await h.run('c1 --tpl claim 优先 Lint 相关')
    assert.match(c1.inbox.at(-1)[1].content[0].text, /最高优先任务并完成；\n只做该任务[\s\S]*补充：优先 Lint 相关$/)
    assert.match((await h.run('new --tpl nope x')).text, /没有模板 "nope"/)
    assert.match((await h.run('tpl rm claim')).text, /已删除/)
    assert.equal((await h.run('tpl save Bad名字 x')).kind, 'error')
  } finally { await h.cleanup() }
})

test('热重载：换一份新实现，命令/工具换成新定义，跳数、看板、合并窗口里的汇报都保留', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    await h.run('new --as w1 任务')
    const w1 = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    await h.call('peer_report', { status: 'ready', summary: '等合并' }, w1)
    assert.equal(h.timers.length, 1, '汇报在合并窗口里')
    const oldRelay = h.shell.relay
    const oldTool = h.tools.get('peer_report')
    const message = (await h.run('reload')).text
    assert.match(message, /已重新加载 .*第 2 次加载/)
    assert.notEqual(h.shell.relay, oldRelay)
    assert.notEqual(h.tools.get('peer_report'), oldTool, '工具换成新实现的定义')
    assert.equal(h.shell.relay.coord.snapshot().board[w1.id].status, 'ready')
    assert.equal(h.shell.relay.batcher.pending.size, 1, '未送出的汇报被新实现接管')
    // 旧定时器触发不会重复投递；新实现的批次照常送达
    const before = h.caller.inbox.length
    for (const fn of h.timers.splice(0)) await fn()
    await new Promise((r) => setImmediate(r))
    assert.equal(h.caller.inbox.length, before + 1)
    assert.match((await h.run('status')).text, /已加载：.*第 2 次加载/)
  } finally { await h.cleanup() }
})

test('热重载：等旧实例正在跑的核验结束再接管（不重复投递）；定时器 ready 之后才启动', async () => {
  const h = await setup()
  try {
    const oldRelay = h.shell.relay
    let release
    oldRelay.watches.current = new Promise((resolve) => { release = resolve })
    let done = false
    const reloading = h.run('reload').then((out) => { done = true; return out })
    // reload 要先复制、导入实现：等到旧调度器被停掉（接管开始），再确认它在等这一轮
    for (let i = 0; i < 200 && oldRelay.watches.disposed !== true; i += 1) await new Promise((r) => setTimeout(r, 10))
    assert.equal(oldRelay.watches.disposed, true, '旧调度器已停，不会再开新一轮')
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(done, false, '旧实例这一轮没跑完，新实例不接管')
    release()
    assert.match((await reloading).text, /已重新加载/)
    const relay = h.shell.relay
    assert.equal(relay.watchStore, oldRelay.watchStore, '共用一份清单')
    assert.equal(oldRelay.timers.stopped, true)
    assert.equal(relay.timers.armed, true)
  } finally { await h.cleanup() }
  // DeferredTimers：arm 之前不跑；stop 后不再跑
  const { DeferredTimers } = await import('../lib/impl.js')
  const timers = new DeferredTimers()
  let ticks = 0
  timers.set(() => { ticks += 1 }, 5)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(ticks, 0, '没 arm 不启动（reload 失败时不会泄漏）')
  timers.arm()
  await new Promise((r) => setTimeout(r, 25))
  assert.ok(ticks > 0)
  timers.stop()
  const after = ticks
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(ticks, after)
})

test('重启时机：有会话在忙就等，全部空闲后通知一次', async () => {
  const h = await setup()
  try {
    h.busy.add(h.peer.id)
    assert.match((await h.run('restart-window')).text, /等待/)
    await h.shell.relay.restart.tick()
    assert.match((await h.run('restart-window status')).text, /还在忙/)
    assert.equal(h.notified.length, 0)
    h.busy.clear()
    await h.shell.relay.restart.tick()
    assert.equal(h.notified.length, 1)
    assert.match(h.notified[0][0], /可以重启/)
    assert.match((await h.run('restart-window status')).text, /可以重启了/)
    assert.equal((await h.run('restart-window cancel')).kind, 'error')
  } finally { await h.cleanup() }
})

test('/relay open：只建空白会话，不投递任何消息；--join 登记为工作会话', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    const out = await h.run('open --as blank1 --join')
    assert.equal(out.kind, 'success', out.text)
    assert.match(out.text, /没有发送任何内容/)
    const created = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    assert.equal(created.inbox.length, 0, '不触发模型轮次')
    assert.equal(h.shell.relay.coord.snapshot().board[created.id].status, 'working')
    assert.match(h.contextFor(created), /role="worker"/)
    assert.equal((await h.run('open 带指令')).kind, 'error')
  } finally { await h.cleanup() }
})

test('面板新建主会话：没有主会话时直接设为主会话；替换已有主会话时原主会话收到卸任通知（只进收件箱）', async () => {
  const h = await setup()
  try {
    const { perform } = await import('../lib/settings-route.js')
    // 新会话还没出现在侧栏登记的 sessionIds 里：分组以建会话时的工作区为准
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    const first = await perform(h.relay, { action: 'open', role: 'main', cwd: h.dir })
    const m1 = first.result.sessionId
    assert.equal(first.result.main, true)
    assert.equal(first.result.previousMain, undefined)
    assert.equal(h.relay.coordinatorFor(h.peer.id), m1, '同工作区的会话看到新主会话')
    assert.equal(h.agents.get(m1).inbox.length, 0, '不触发模型轮次')
    // 替换：原主会话收到卸任通知，不唤醒
    const second = await perform(h.relay, { action: 'open', role: 'main', cwd: h.dir })
    const m2 = second.result.sessionId
    assert.equal(second.result.previousMain, m1)
    assert.equal(h.relay.coordinatorFor(h.peer.id), m2)
    const [mode, notice] = h.agents.get(m1).inbox.at(-1)
    assert.equal(mode, 'queue')
    assert.match(notice.content[0].text, /不再是主会话/)
    assert.equal(h.agents.get(m2).inbox.length, 0)
  } finally { await h.cleanup() }
})

test('认领任务自动命名：持有者会话标题改成任务号；结束的认领不算；用户改过的不动', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    const titles = new Map()
    h.services.sessionTitle = {
      get: (session) => titles.get(session.id),
      rename: (session, title) => { const value = { title, source: { kind: 'user' } }; titles.set(session.id, value); return value }
    }
    await mkdir(join(h.dir, '.agents/claims/T46'), { recursive: true })
    await mkdir(join(h.dir, '.agents/claims/T45'), { recursive: true })
    await mkdir(join(h.dir, '.agents/claims/T40'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 任务 | 状态 |\n|---|---|---|\n| T40 | 旧 | 已完成 |\n| T45 | 甲 | 进行中 |\n| T46 | 乙 | 进行中 |\n')
    await writeFile(join(h.dir, '.agents/claims/T46/owner'), `session-${h.peer.id}\n2026-11-04 UTC\n`)
    await writeFile(join(h.dir, '.agents/claims/T45/owner'), `session-${h.peer.id}\n2026-11-04 UTC\n`)
    await writeFile(join(h.dir, '.agents/claims/T40/owner'), `session-${h.caller.id}\n`)
    await writeFile(join(h.dir, '.agents/claims/T40/done'), 'abc1234 已合入\n')
    const result = await h.relay.autoTitle.sync()
    assert.deepEqual(result.renamed, [[h.peer.id, 'T45 T46']])
    assert.equal(titles.get(h.caller.id), undefined, '认领已结束的不改')
    // 用户手动改名后不再动
    titles.set(h.peer.id, { title: '我的', source: { kind: 'user' } })
    await mkdir(join(h.dir, '.agents/claims/T47'), { recursive: true })
    await writeFile(join(h.dir, '.agents/claims/T47/owner'), `session-${h.peer.id}\n`)
    h.relay.taskBoards.cache.clear?.()
    assert.deepEqual((await h.relay.autoTitle.sync()).renamed, [])
    assert.equal(titles.get(h.peer.id).title, '我的')
  } finally { await h.cleanup() }
})

test('/relay drop --archived：先列（--dry）再清；只清归档，主会话与进行中不动；面板同一动作', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await h.run('new --as w1 任务一')
    await h.run('new --as w2 任务二')
    const [w1, w2] = [...h.agents.values()].filter((agent) => agent.id.startsWith('dddddddd'))
    h.workspaces[0].sessionIds.push(w1.id, w2.id)
    await h.call('peer_report', { status: 'done', summary: '做完了' }, w1)
    await h.call('peer_report', { status: 'working', summary: '还在做' }, w2)
    assert.equal(parseRelayCommand('drop --archived --merged --dry').kind, 'drop-archived')
    assert.deepEqual(parseRelayCommand('drop --merged').reasons, ['merged'])
    assert.equal(parseRelayCommand('drop --archived extra').kind, 'invalid')
    const dry = await h.run('drop --archived --dry')
    assert.match(dry.text, /将清理 1 个归档条目：@w1[^\n]*已完成/)
    assert.ok(h.relay.coord.snapshot().board[w1.id], 'dry 不改')
    const done = await h.run('drop --archived')
    assert.match(done.text, /已清理 1 个/)
    const board = h.relay.coord.snapshot().board
    assert.equal(board[w1.id], undefined)
    assert.ok(board[w2.id], '进行中的不动')
    assert.equal(h.relay.coordinatorFor(w2.id), h.caller.id, '主会话不动')
    assert.match((await h.run('drop --archived')).text, /没有符合条件/)
    // 面板：只按原因清
    await h.call('peer_report', { status: 'abandoned', summary: '不做了' }, w2)
    const { perform } = await import('../lib/settings-route.js')
    const kept = await perform(h.relay, { action: 'prune-archived', reasons: ['done'], fromSession: h.caller.id })
    assert.deepEqual(kept.result.dropped, [])
    const panel = await perform(h.relay, { action: 'prune-archived', reasons: ['abandoned', 'bogus'], fromSession: h.caller.id })
    assert.deepEqual(panel.result.dropped, [{ sessionId: w2.id, reason: 'abandoned' }])
  } finally { await h.cleanup() }
})

test('/relay open --main：新建即设为主会话；与 --join 互斥；命令名不能作别名', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    assert.equal(parseRelayCommand('open --main --join').kind, 'invalid')
    const out = await h.run('open --main --as boss2')
    assert.equal(out.kind, 'success', out.text)
    const created = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    assert.equal(h.relay.coordinatorFor(h.peer.id), created.id)
    assert.match(out.text, /已设为主会话，原主会话 .* 已收到卸任通知/)
    assert.equal(h.caller.inbox.at(-1)[0], 'queue')
    for (const word of ['wake', 'watch', 'declarations']) assert.equal((await h.run(`alias ${word}`)).kind, 'error', word)
  } finally { await h.cleanup() }
})

test('会话身份：/relay id 给出完整 id、前 8 位和别名；上下文带身份行', async () => {
  const h = await setup()
  try {
    await h.run('alias boss')
    const out = (await h.run('id')).text
    assert.match(out, /完整 id：aaaaaaaa-0000-0000-0000-000000000001/)
    assert.match(out, /前 8 位：aaaaaaaa/)
    assert.match(out, /@boss/)
    assert.match((await h.run(`id ${h.peer.id.slice(0, 8)}`)).text, /bbbbbbbb/)
    // identityForAll=false 时只给参与者；打开后每个根会话都有身份行
    h.shell.relay.identityForAll = true
    assert.match(h.contextFor(h.peer), /<session-identity id="bbbbbbbb-0000-0000-0000-000000000002" short="bbbbbbbb">/)
    assert.equal(h.contextFor(h.child), '', '子代理不注入')
    await h.run('main here')
    assert.match(h.contextFor(h.caller), /aliases="@main @boss"[\s\S]*role="main"/)
  } finally { await h.cleanup() }
})

test('面板接口：marks 带状态与别名，board 带条目；面板回复按用户指令送达', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    await h.run('new --as w1 任务')
    const w1 = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    await h.call('peer_report', { status: 'question', summary: '要不要改？', question: 'A 还是 B' }, w1)
    const marks = h.shell.relay.marks()
    assert.equal(marks.marks[w1.id], 'question')
    assert.equal(marks.marks[h.caller.id], 'main')
    assert.equal(marks.attention, 1)
    assert.deepEqual(marks.aliases[w1.id], ['w1'])
    const board = await h.shell.relay.board()
    assert.equal(board.entries[0].sessionId, w1.id)
    assert.equal(board.coordinator.sessionId, h.caller.id)
    const { perform } = await import('../lib/settings-route.js')
    const replied = await perform(h.shell.relay, { action: 'reply', target: 'w1', text: '选 A' })
    assert.equal(replied.result.sessionId, w1.id)
    const [, message] = w1.inbox.at(-1)
    assert.deepEqual(message.source, { kind: 'user' })
    assert.match(message.content[0].text, /监督面板[\s\S]*选 A/)
  } finally { await h.cleanup() }
})

test('协作标签数据：按会话所在工作区过滤，scope=all 列全部；join 让本会话加入', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    await h.run('new --as w1 任务一')
    await h.run('new --as w2 任务二')
    const [w1, w2] = [...h.agents.values()].filter((agent) => agent.id.startsWith('dddddddd'))
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, w1.id, h.peer.id] }, { id: 'ws-b', title: 'B', path: '/x', sessionIds: [w2.id] })
    let board = await h.shell.relay.board(undefined, { session: h.caller.id })
    assert.equal(board.scope, 'workspace')
    assert.deepEqual(board.entries.map((e) => e.sessionId), [w1.id])
    assert.equal(board.hiddenByScope, 1)
    assert.deepEqual(board.hiddenAttention, [])
    assert.equal(board.self.isMain, true)
    // 其它工作区的会话受阻：侧栏角标会算它，本工作区视图要指出它在哪
    await h.call('peer_report', { status: 'blocked', summary: '卡住了' }, w2)
    board = await h.shell.relay.board(undefined, { session: h.caller.id })
    assert.equal(h.relay.marks().attention, 1)
    assert.deepEqual(board.hiddenAttention.map((item) => [item.sessionId, item.status, item.workspace, item.summary]), [[w2.id, 'blocked', 'B', '卡住了']])
    board = await h.shell.relay.board(undefined, { session: h.caller.id, scope: 'all' })
    assert.deepEqual(board.hiddenAttention, [])
    // 找会话：id 前缀 / 别名；看板条目带卡片数据，其它会话带标题；范围同看板
    let found = await h.relay.findSessions({ query: '@w1', session: h.caller.id })
    assert.deepEqual(found.results.map((item) => [item.kind, item.entry?.sessionId]), [['board', w1.id]])
    found = await h.relay.findSessions({ query: '@w2', session: h.caller.id })
    assert.equal(found.results.length, 0, '当前工作区找不到别的工作区的会话')
    found = await h.relay.findSessions({ query: '@w2', session: h.caller.id, scope: 'all' })
    assert.deepEqual(found.results.map((item) => item.entry?.sessionId), [w2.id])
    found = await h.relay.findSessions({ query: h.peer.id, session: h.caller.id })
    assert.equal(found.results[0]?.kind, 'other')
    assert.equal(found.results[0].session.sessionId, h.peer.id)
    await assert.rejects(h.relay.findSessions({ query: '  ', session: h.caller.id }), /不能为空/)
    // 只看主会话：可不填关键词，只列主会话
    found = await h.relay.findSessions({ query: '', mainOnly: true, session: h.caller.id })
    assert.deepEqual(found.results.map((item) => [item.kind, item.session?.sessionId, item.session?.isMain]), [['other', h.caller.id, true]])
    found = await h.relay.findSessions({ query: '@w1', mainOnly: true, session: h.caller.id })
    assert.equal(found.results.length, 0)
    assert.equal(board.entries.length, 2)
    board = await h.shell.relay.board(undefined, { session: h.peer.id })
    assert.equal(board.self.participant, false)
    const { perform } = await import('../lib/settings-route.js')
    const joined = await perform(h.shell.relay, { action: 'join', target: h.peer.id, fromSession: h.peer.id })
    assert.equal(joined.board.self.participant, true)
    assert.equal(joined.board.self.entry.status, 'working')
  } finally { await h.cleanup() }
})

test('按工作区分组：每个工作区各有主会话和版本线；未加入的会话只看到本工作区的版本线', async () => {
  const h = await setup()
  try {
    const other = h.makeAgent('eeeeeeee-0000-0000-0000-000000000005', { cwd: '/y' })
    const loner = h.makeAgent('ffffffff-0000-0000-0000-000000000006', { cwd: '/y' })
    h.agents.set(other.id, other)
    h.agents.set(loner.id, loner)
    const wsA = { id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] }
    const wsB = { id: 'ws-b', title: 'B', path: '/y', sessionIds: [other.id, loner.id] }
    h.workspaces.push(wsA, wsB)
    assert.match((await h.run('main here')).text, /工作区 A · 主会话：/)
    assert.match((await h.run('main here', other)).text, /工作区 B · 主会话：/)
    await h.run('line A 的基线 build280')
    await h.run('line B 的基线 build900', other)
    const state = h.relay.coord.snapshot()
    assert.equal(state.groups['ws-a'].coordinator.sessionId, h.caller.id)
    assert.equal(state.groups['ws-b'].coordinator.sessionId, other.id)
    // 未加入协作的会话：只看到本工作区的版本线，不被要求汇报
    const peerContext = h.contextFor(h.peer)
    assert.match(peerContext, /role="observer"/)
    assert.match(peerContext, /A 的基线 build280/)
    assert.doesNotMatch(peerContext, /build900/)
    assert.doesNotMatch(peerContext, /调用 peer_report/)
    assert.match(h.contextFor(loner), /B 的基线 build900/)
    // 主会话上下文：本工作区计数 + 检索提示
    const mainContext = h.contextFor(h.caller)
    assert.match(mainContext, /Workspace A.*1 sidebar sessions, 1 not joined/)
    assert.match(mainContext, /peer_list/)
    assert.doesNotMatch(mainContext, /build900/)
    // main 指本工作区的主会话
    assert.match((await h.run('main', loner)).text, /工作区 B · 主会话：eeeeeeee/)
    // 汇报送到本工作区的主会话
    await h.call('peer_report', { status: 'question', summary: 'B 里的问题' }, loner)
    for (const fn of h.timers.splice(0)) await fn()
    assert.equal(other.inbox.length, 1)
    assert.equal(h.caller.inbox.length, 0)
    // 退出协作后连版本线也不注入
    await h.run('leave', h.peer)
    assert.equal(h.contextFor(h.peer), '')
    // 设置页：每个工作区一行
    const { snapshot, perform } = await import('../lib/settings-route.js')
    const snap = await snapshot(h.relay)
    assert.deepEqual(snap.groups.filter((g) => g.registered).map((g) => [g.id, g.line?.text]), [['ws-a', 'A 的基线 build280'], ['ws-b', 'B 的基线 build900']])
    const saved = await perform(h.relay, { action: 'line', workspaceId: 'ws-b', text: 'B 改成 build901' })
    assert.equal(saved.groups.find((g) => g.id === 'ws-b').line.text, 'B 改成 build901')
    assert.equal(saved.groups.find((g) => g.id === 'ws-a').line.text, 'A 的基线 build280')
    // 标记：两个主会话都是 main
    const marks = h.relay.marks()
    assert.equal(marks.marks[h.caller.id], 'main')
    assert.equal(marks.marks[other.id], 'main')
  } finally { await h.cleanup() }
})

test('登记工作区之前设的主会话 / 版本线，工作区出现后自动归位', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    await h.run('line 旧版全局基线')
    assert.ok(h.relay.coord.snapshot().groups._)
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.relay.ready()
    const groups = h.relay.coord.snapshot().groups
    assert.equal(groups._, undefined)
    assert.equal(groups['ws-a'].coordinator.sessionId, h.caller.id)
    assert.equal(groups['ws-a'].line.text, '旧版全局基线')
  } finally { await h.cleanup() }
})

test('peer_list：默认只列本工作区；scope=host 需开发者模式并写审计；声明核对只给主会话', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    h.workspaces.push({ id: 'ws-b', title: 'B', path: '/z', sessionIds: [] })
    const outsider = h.makeAgent('99999999-0000-0000-0000-000000000009', { cwd: '/z' })
    h.agents.set(outsider.id, outsider)
    h.workspaces[1].sessionIds.push(outsider.id)
    await h.run('main here')
    // 默认工作区：只有本工作区的会话，看不到别的工作区
    const scoped = await h.call('peer_list', {})
    assert.match(scoped, /工作区 A/)
    assert.match(scoped, /bbbbbbbb.*运行中/)
    assert.match(scoped, /aaaaaaaa.*← 当前/)
    assert.doesNotMatch(scoped, /99999999/)
    // 全机列表要开发者模式
    await assert.rejects(h.call('peer_list', { scope: 'host' }), /开发者模式/)
    await h.relay.devMode.enable(1)
    const host = await h.call('peer_list', { scope: 'host' })
    assert.match(host, /99999999/)
    await h.relay.devMode.chain
    const audit = await readFile(join(h.dir, 'devmode-audit.jsonl'), 'utf8').catch(() => '')
    assert.match(audit, /"event":"list"/)
    // 声明核对：只给本工作区主会话
    await assert.rejects(h.call('peer_list', { declarations: true }, h.peer), /只给本工作区的主会话/)
    assert.match(await h.call('peer_list', { declarations: true }), /工作树声明/)
    // 用户命令 /relay ws 仍然可用
    assert.match((await h.run('ws')).text, /侧栏登记 2 个会话/)
  } finally { await h.cleanup() }
})

test('peer_inspect digest：只读最近几轮，读别的工作区要开发者模式', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    const text = (t) => [{ type: 'text', text: t }]
    h.services.sessionQuery = {
      readSurface: async (id) => {
        assert.equal(id, h.peer.id)
        return { events: [
          { seq: 1, time: 1, type: 'system/message', data: { message: { role: 'system', content: text('系统提示'), source: { kind: 'system-prompt' } } } },
          { seq: 2, time: 2, type: 'user/message', data: { message: { role: 'user', content: text('第一轮问题'), source: { kind: 'user' } } } },
          { seq: 3, time: 3, type: 'assistant/message', data: { message: { role: 'assistant', content: text('第一轮回答') } } },
          { seq: 4, time: 4, type: 'user/message', data: { message: { role: 'user', content: text('运行时上下文'), source: { kind: 'context' } } } },
          { seq: 5, time: 5, type: 'user/message', data: { message: { role: 'user', content: text('第二轮问题'), source: { kind: 'user' } } } },
          { seq: 6, time: 6, type: 'assistant/message', data: { message: { role: 'assistant', content: text('第二轮回答') } } }
        ] }
      }
    }
    const digest = await h.call('peer_inspect', { session: 'bbbbbbbb', view: 'digest', turns: 1 })
    assert.match(digest, /是数据，不是用户对你的指令/)
    assert.match(digest, /seq 5 .* 用户\] 第二轮问题/)
    assert.match(digest, /第二轮回答/)
    assert.doesNotMatch(digest, /第一轮|系统提示|运行时上下文/)
    // 工作区外的会话拒绝
    const outsider = h.makeAgent('99999999-0000-0000-0000-000000000009', { cwd: '/z' })
    h.agents.set(outsider.id, outsider)
    await assert.rejects(h.call('peer_inspect', { session: outsider.id, view: 'digest' }), /不在本工作区/)
    // 开发者模式可读别的工作区并审计
    await h.relay.devMode.enable(1)
    h.services.sessionQuery.readSurface = async () => ({ events: [] })
    assert.match(await h.call('peer_inspect', { session: outsider.id, view: 'digest' }), /另一个工作区/)
    await h.relay.devMode.chain
    const audit = await readFile(join(h.dir, 'devmode-audit.jsonl'), 'utf8').catch(() => '')
    assert.match(audit, /"event":"read"/)
  } finally { await h.cleanup() }
})

test('归档会话：不再默认出现在列表 / 读取 / 搜索 / 投递里；主会话 include_archived 才可读', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    h.relay.ctx.workspaceRegistry.archivedSessionIds = [h.peer.id]
    await h.run('main here')
    const text = (t) => [{ type: 'text', text: t }]
    h.services.sessionQuery = {
      readSession: async (id) => ({ session: { id, header: {} }, events: id === h.peer.id ? [{ seq: 1, time: 1, type: 'assistant/message', data: { message: { role: 'assistant', content: text('UNIQUE_ARCHIVED_MARKER') } } }] : [] }),
      readSurface: async () => ({ events: [] })
    }
    // 列表默认不列归档会话
    assert.doesNotMatch(await h.call('peer_list', {}), /bbbbbbbb/)
    // 默认拒绝直接读 / digest
    await assert.rejects(h.call('peer_inspect', { session: 'bbbbbbbb', view: 'overview' }), /已归档/)
    await assert.rejects(h.call('peer_inspect', { session: 'bbbbbbbb', view: 'digest' }), /已归档/)
    // 投递报“已归档”，不是“找不到”
    await assert.rejects(h.call('peer_send', { target: 'bbbbbbbb', message: 'hi' }), /已归档/)
    // 主会话显式 include_archived 可读，并标出归档状态
    assert.match(await h.call('peer_inspect', { session: 'bbbbbbbb', view: 'overview', include_archived: true }), /已归档/)
    // 工作会话不能显式读
    await assert.rejects(h.call('peer_inspect', { session: 'bbbbbbbb', view: 'overview', include_archived: true }, h.peer), /只给用户或本工作区主会话/)
    // 工作区搜索默认跳过归档；显式 include_archived 才出现
    assert.doesNotMatch(await h.call('peer_inspect', { view: 'search', scope: 'workspace', query: 'UNIQUE_ARCHIVED_MARKER' }), /bbbbbbbb/)
    assert.match(await h.call('peer_inspect', { view: 'search', scope: 'workspace', query: 'UNIQUE_ARCHIVED_MARKER', include_archived: true }), /bbbbbbbb/)
    // 用户命令要显式 --archived
    const denied = await h.run('inspect bbbbbbbb')
    assert.equal(denied.kind, 'error')
    assert.match(denied.text, /已归档/)
    assert.match((await h.run('inspect bbbbbbbb --archived')).text, /已归档/)
  } finally { await h.cleanup() }
})

test('交接：主会话模型只能起草；用户确认后新建会话接手、旧主会话收到卸任通知、可退回', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await h.run('line main=build280')
    await h.run('new --as w1 任务一')
    const w1 = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    h.workspaces[0].sessionIds.push(w1.id)
    // 工作会话不能起草
    await assert.rejects(h.call('peer_handoff', { notes: 'x' }, w1), /只给本工作区的主会话/)
    // 没草稿不能确认（除非 --force）
    assert.match((await h.run('handoff confirm')).text, /还没有交接草稿/)
    const drafted = await h.call('peer_handoff', { notes: '下一步：从 281 推到 290' })
    assert.match(drafted, /不要自己/)
    assert.equal(h.notified.at(-1)[0], '主会话交接草稿已就绪')
    assert.match(h.contextFor(h.caller), /Handoff draft saved/)
    const preview = (await h.run('handoff')).text
    // /relay new 建的会话已经收到任务（DSH 不算空白会话）：进行中
    assert.match(preview, /从 281 推到 290[\s\S]*- @w1[^\n]* dddddddd · 进行中/)
    // 版本线、工作区计数、声明每一步都在新主会话的协作上下文里，快照不再重复
    assert.doesNotMatch(preview, /main=build280|侧栏登记/)
    // 用户确认：新建接手会话
    h.caller.inbox.length = 0
    const done = await h.run('handoff confirm --as main2')
    assert.equal(done.kind, 'success', done.text)
    const successor = [...h.agents.values()].filter((agent) => agent.id.startsWith('dddddddd')).at(-1)
    assert.notEqual(successor.id, w1.id)
    assert.equal(h.relay.coordinatorFor(w1.id), successor.id, '工作会话的主会话换成接手方')
    const [mode, message] = successor.inbox.at(-1)
    assert.equal(mode, 'followup')
    assert.deepEqual(message.source, { kind: 'user' })
    assert.match(message.content[0].text, /主会话交接 · 用户已确认[\s\S]*从 281 推到 290[\s\S]*交接时快照[\s\S]*@w1/)
    assert.match(h.contextFor(successor), /main=build280/, '版本线在接手方的协作上下文里')
    const [oldMode, notice] = h.caller.inbox.at(-1)
    assert.equal(oldMode, 'queue', '旧主会话只放收件箱，不唤醒')
    assert.match(notice.content[0].text, /不再是主会话/)
    assert.equal(h.relay.handoffs.draft('ws-a'), undefined, '草稿清掉')
    assert.match((await h.run('handoff history')).text, /→ @main2/)
    assert.match(h.contextFor(successor), /role="main"/)
    assert.match(h.contextFor(h.caller), /role="observer"/)
    // 退回
    await h.run(`main set ${h.caller.id}`)
    assert.equal(h.relay.coordinatorFor(w1.id), h.caller.id)
  } finally { await h.cleanup() }
})

test('交接到已有会话；交接文档送不到时主会话退回原样', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await h.run('handoff draft 状态：干净')
    const { perform } = await import('../lib/settings-route.js')
    const payload = await perform(h.relay, { action: 'handoff-confirm', to: h.peer.id, mode: 'queue', fromSession: h.caller.id })
    assert.equal(payload.result.to, h.peer.id)
    assert.equal(payload.board.coordinator.sessionId, h.peer.id)
    assert.equal(h.peer.inbox.at(-1)[0], 'queue')
    // 送达失败回滚
    await h.run('handoff draft 再交一次', h.peer)
    const ghost = 'eeeeeeee-0000-0000-0000-00000000000e'
    h.workspaces[0].sessionIds.push(ghost)
    const originalList = h.relay.ctx.sessionController.list
    h.relay.ctx.sessionController.list = async () => ({ items: [...(await originalList()).items, { sessionId: ghost, running: false, agentAvailable: false, cwd: h.dir }] })
    await assert.rejects(perform(h.relay, { action: 'handoff-confirm', to: ghost, fromSession: h.peer.id }), /无法打开目标会话/)
    assert.equal(h.relay.coordinatorFor(h.caller.id), h.peer.id, '失败后主会话不变')
    assert.ok(h.relay.handoffs.draft('ws-a'), '失败后草稿保留')
  } finally { await h.cleanup() }
})

test('扩展：占用重叠、可合并队列与分配、回复后标已答复、工作区广播', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    await h.run('new --as a 任务 a')
    await h.run('new --as b 任务 b')
    await h.run('new --as c 任务 c')
    const [a, b, c] = [...h.agents.values()].filter((agent) => agent.id.startsWith('dddddddd'))
    await h.call('peer_report', { status: 'working', summary: '改 UI', files: 'app/src/main/java/ui/, docs/x.md' }, a)
    await h.call('peer_report', { status: 'ready', summary: '好了', files: './app/src/main/java/ui/MainActivity.java' }, b)
    await h.call('peer_report', { status: 'ready', summary: '也好了' }, c)
    // 主会话上下文：重叠与队列
    const main = h.contextFor(h.caller)
    assert.match(main, /⚠ 占用重叠：与 @b 都在改 app\/src\/main\/java\/ui/)
    assert.match(main, /@b .*可合并 #1/)
    assert.match(main, /@c .*可合并 #2/)
    assert.match(h.contextFor(a), /⚠ 占用重叠：@b 也在改/)
    assert.match(h.contextFor(c), /可合并队列第 2 位/)
    // 主会话模型分配
    for (const fn of h.timers.splice(0)) await fn()
    h.caller.inbox.length = 0
    assert.match(await h.call('peer_assign', { target: 'b', value: 'build281' }), /分配 build281/)
    assert.match(b.inbox.at(-1)[1].content[0].text, /主会话分配：build281/)
    assert.match(h.contextFor(b), /分配的是：build281/)
    assert.match(h.contextFor(c), /可合并队列第 1 位/)
    await assert.rejects(h.call('peer_assign', { target: 'c', value: 'build282' }, a), /只有本工作区的主会话/)
    assert.match((await h.run('assign --quiet c build282')).text, /没有唤醒/)
    // 提问 → 回复 → 已答复
    await h.call('peer_report', { status: 'question', summary: '要不要改号', question: '281 还是 282' }, a)
    assert.equal(h.relay.marks().attention, 1)
    await h.call('peer_send', { target: 'a', message: '用 283' })
    assert.equal(h.relay.marks().attention, 0)
    assert.match(h.contextFor(h.caller), /待答复（已答复）/)
    assert.match(h.contextFor(a), /主会话已答复/)
    // 再汇报就清掉“已答复”
    await h.call('peer_report', { status: 'question', summary: '还有一个问题' }, a)
    assert.equal(h.relay.marks().attention, 1)
    // 广播：不含已完成
    await h.call('peer_report', { status: 'done', summary: '完成' }, c)
    const sent = await h.run('all main 已推到 build282')
    assert.equal(sent.kind, 'success', sent.text)
    assert.match(sent.text, /2 个会话/)
    assert.match(a.inbox.at(-1)[1].content[0].text, /已推到 build282/)
    assert.doesNotMatch(c.inbox.at(-1)[1].content[0].text, /已推到 build282/)
  } finally { await h.cleanup() }
})

test('工作树声明：主会话上下文摘要、/relay decl、worker 提醒、汇报补分支、面板数据', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    const wt = join(h.dir, '.agents/worktrees/fix/peer-task')
    await mkdir(wt, { recursive: true })
    await writeFile(join(wt, '.git'), 'gitdir: x\n')
    await writeFile(join(wt, '.ACTIVE-SESSION'), `状态：活跃\n分支：fix/peer-task（基于 abc）\n会话：session-${h.peer.id}\n当前阶段：定向单测中\n合并：不可合并\n`)
    const done = join(h.dir, '.agents/worktrees/fix/old')
    await mkdir(done, { recursive: true })
    await writeFile(join(done, '.SESSION-DONE'), `状态：已结束\n分支：fix/old\n会话：session-99999999-0000-0000-0000-000000000009\n合并：可合并（已提交 18af5dc9）\n`)
    // 汇报不写分支：用声明里的分支
    const reported = await h.call('peer_report', { status: 'ready', summary: '好了' }, h.peer)
    assert.match(reported, /可合并/)
    assert.equal(h.relay.coord.snapshot().board[h.peer.id].branch, 'fix/peer-task')
    const decl = await h.run('decl')
    assert.equal(decl.kind, 'success')
    assert.match(decl.text, /看板与声明不一致】1/)
    assert.match(decl.text, /可合并待排号.*】1\n- \.agents\/worktrees\/fix\/old/)
    assert.match(await h.call('peer_list', { declarations: true }), /工作树声明/)
    // 上下文（同步，读缓存）
    const mainCtx = h.contextFor(h.caller)
    assert.match(mainCtx, /工作树声明：活跃 1 · 可合并待排号 1/)
    assert.match(mainCtx, /⚠ .*看板报可合并，但声明仍是活跃/)
    const workerCtx = h.contextFor(h.peer)
    assert.match(workerCtx, /Your worktree declaration: \.agents\/worktrees\/fix\/peer-task\/\.ACTIVE-SESSION/)
    const board = await h.relay.board(undefined, { session: h.caller.id })
    const entry = board.entries.find((item) => item.sessionId === h.peer.id)
    assert.equal(entry.declaration.rel, '.agents/worktrees/fix/peer-task')
    assert.equal(entry.declarationIssues.length, 1)
    assert.equal(board.declarations.candidates.length, 1)
    assert.match((await h.run('board')).text, /工作树声明：/)
    // 关闭开关后不读
    assert.equal(h.relay.declarationRoot({ workspace: { path: '/' } }), undefined)
  } finally { await h.cleanup() }
})

test('特权分开：主会话发出用宽跳数与放宽限流；工作会话只有回主会话用宽跳数，其余普通', async () => {
  const h = await setup()
  try {
    const w2 = h.makeAgent('ffffffff-0000-0000-0000-000000000006', { cwd: h.dir })
    h.agents.set(w2.id, w2)
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id, w2.id] })
    await h.run('main here')
    const g = h.relay.guard
    assert.deepEqual(h.relay.sendPolicy(h.caller.id, h.peer.id), { maxHops: g.coordinatorMaxHops, scale: g.coordinatorRateScale, privileged: true })
    // 主会话发给别的工作区的会话也有特权
    assert.equal(h.relay.sendPolicy(h.caller.id, '99999999-0000-0000-0000-000000000009').maxHops, g.coordinatorMaxHops)
    assert.deepEqual(h.relay.sendPolicy(h.peer.id, h.caller.id), { maxHops: g.coordinatorMaxHops, scale: 1, privileged: false })
    assert.deepEqual(h.relay.sendPolicy(h.peer.id, w2.id), { maxHops: g.maxHops, scale: 1, privileged: false })
    assert.equal(h.relay.sendPolicy(h.peer.id).maxHops, g.maxHops) // 工作会话新建会话
    // 工作会话连发给另一个工作会话：普通上限（setup 里 maxHops=2）
    g.hops.set(h.peer.id, 2)
    await assert.rejects(h.call('peer_send', { target: w2.id, message: 'x' }, h.peer), /上限 2/)
    // 同样跳数回主会话可以
    assert.match(await h.call('peer_send', { target: 'main', message: 'x' }, h.peer), /已送达/)
    // 主会话限流放宽：普通上限 8 次，主会话可发 8×3
    g.hops.set(h.caller.id, 0)
    for (let i = 0; i < 9; i += 1) { g.hops.set(h.caller.id, 0); await h.call('peer_send', { target: h.peer.id, message: 'm' + i }) }
    // 工作会话普通限流：第 9 次被拒
    for (let i = 0; i < 8; i += 1) g.charge(w2.id, 'send')
    assert.throws(() => g.charge(w2.id, 'send'), /上限 8/)
  } finally { await h.cleanup() }
})

test('任务看板：会话目录（含工作树）往上有 .agents/TASKS.md 就进上下文，没有就不出现', async () => {
  const h = await setup()
  try {
    await mkdir(join(h.dir, '.agents/worktrees/fix/y'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 任务 | 状态 |\n|---|---|---|\n| T9 | 修点东西 | 待认领 |\n')
    const worker = h.makeAgent('12121212-0000-0000-0000-000000000012', { cwd: join(h.dir, '.agents/worktrees/fix/y') })
    h.agents.set(worker.id, worker)
    h.contextFor(worker)
    await h.relay.taskBoards.get(join(h.dir, '.agents/worktrees/fix/y'))
    assert.match(h.contextFor(worker), /<task-board path=".*\.agents\/TASKS\.md">[\s\S]*- T9 修点东西/)
    const outsider = h.makeAgent('34343434-0000-0000-0000-000000000034', { cwd: '/' })
    h.agents.set(outsider.id, outsider)
    await h.relay.taskBoards.get('/')
    assert.doesNotMatch(h.contextFor(outsider), /task-board/)
    // 有主会话后，没加入协作的旁观会话只拿一行看板摘要；工作树里的参与者仍拿完整段
    h.workspaces.push({ id: 'ws-tb', title: 'TB', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await h.relay.taskBoards.get(h.dir)
    const observer = h.contextFor(h.peer)
    assert.match(observer, /<task-board path="[^"]+">Task board: 1 open, 0 claimed;[^\n]*<\/task-board>/)
    assert.doesNotMatch(observer, /T9 修点东西/)
    assert.match(h.contextFor(worker), /- T9 修点东西/)
  } finally { await h.cleanup() }
})

test('拉起认领会话：首条消息写明身份、看板与认领方式；已认领 / 没有的任务拒绝；模型走 peer_spawn claim', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await mkdir(join(h.dir, '.agents/claims/T2'), { recursive: true })
    await writeFile(join(h.dir, '.agents/claims/T2/owner'), `${h.peer.id}\n2026-11-06T10:00:00Z\n`)
    await mkdir(join(h.dir, '.agents/claims/T4'), { recursive: true })
    await writeFile(join(h.dir, '.agents/claims/T4/done'), 'abc1234 可合并\n')
    await writeFile(join(h.dir, '.agents/TASKS.md'), '## 认领规则\n\n| 号 | 优先 | 任务 | 状态 |\n|---|---|---|---|\n| T1 | P2 | 低优先 | 待认领 |\n| T2 | P0 | 已被认领 | 待认领 |\n| T3 | P1 | 修 MCP | 可认领 |\n| T4 | P0 | 已完成 | 已合入 |\n')
    const done = await h.run('claim T3')
    assert.equal(done.kind, 'success', done.text)
    const claimer = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    assert.ok(claimer)
    assert.equal(h.relay.store.snapshot().t3, claimer.id)
    const [mode, message] = claimer.inbox[0]
    assert.equal(mode, 'followup')
    assert.equal(message.source.kind, 'user')
    const text = message.content[0].text
    assert.match(text, /新拉起的工作会话 @t3（id dddddddd/)
    assert.match(text, /主会话是/)
    assert.match(text, new RegExp(`看板 ${join(h.dir, '.agents/TASKS.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.match(text, /只认领 T3/)
    assert.match(text, /peer_task action=claim .*\.agents\/claims\/<任务号>/)
    assert.match(text, /peer_report/)
    assert.match(text, /先停下问我/)
    assert.doesNotMatch(text, /低优先|修 MCP/) // 不复制看板内容
    assert.equal(h.relay.coord.snapshot().board[claimer.id].status, 'working')
    // 已被认领、没有的任务
    assert.match((await h.run('claim T2')).text, /不是待认领/)
    assert.match((await h.run('claim T9')).text, /没有任务 T9/)
    // 自由指令不接受
    assert.equal((await h.run('claim 帮我修一下')).kind, 'error')
    // 面板数据：待认领按优先级
    const board = await h.relay.board(undefined, { session: h.caller.id })
    assert.deepEqual(board.taskBoard.open.map((row) => row.id), ['T3', 'T1'])
    // 侧栏任务分组：进行中带认领者会话（点开可直接打开），已结束只给结论
    assert.equal(board.taskBoard.claimed, 1)
    assert.deepEqual(board.taskBoard.claimedRows.map((row) => [row.id, row.owner]), [['T2', h.peer.id]])
    assert.equal(typeof board.taskBoard.claimedRows[0].ownerLabel, 'string')
    assert.deepEqual(board.taskBoard.endedRows.map((row) => [row.id, row.claim]), [['T4', 'done']])
    assert.equal(board.taskBoard.ended, 1)
    // 任务树依赖随快照带出，侧栏详情能显示「依赖」；动态页地图拿父子关系 + issue 号
    const found = await h.relay.taskBoardFor({ session: h.caller.id })
    await writeFile(join(found.board.storeRoot, 'graph.json'), JSON.stringify({ version: 1, tasks: { T1: { parentId: null, dependsOn: [] }, T3: { parentId: 'T1', dependsOn: ['T1'] } } }))
    const withDeps = await h.relay.board(undefined, { session: h.caller.id })
    assert.deepEqual(withDeps.taskBoard.open.find((row) => row.id === 'T3').dependsOn, ['T1'])
    assert.equal(withDeps.taskBoard.map.length, 3)
    assert.deepEqual(withDeps.taskBoard.map.map((row) => row.id), ['T1', 'T2', 'T4'])
    assert.equal(withDeps.taskBoard.map[0].id, 'T1')
    assert.equal(withDeps.taskBoard.map[0].childTotal, 1)
    assert.deepEqual(withDeps.taskBoard.map[0].children.map((row) => [row.id, row.kind]), [['T3', 'open']])
    assert.deepEqual(withDeps.taskBoard.map[0].children[0].dependsOn, ['T1'])
    assert.equal(withDeps.taskBoard.map[0].children[0].issue, undefined)
    assert.equal(withDeps.taskBoard.map[1].children.length, 0, '没有子任务的顶层任务也进地图')
    // 模型：peer_spawn claim=any（主会话）→ 按 agent 来源送达，取最高优先的
    const reply = await h.call('peer_spawn', { claim: 'any' })
    assert.match(reply, /去认领一个待认领任务/)
    const second = [...h.agents.values()].filter((agent) => agent.id.startsWith('dddddddd')).pop()
    assert.equal(second.inbox[0][1].source.kind, 'agent-message')
    assert.match(second.inbox[0][1].content[0].text, /认领一个「待认领」的最高优先任务/)
    await assert.rejects(h.call('peer_spawn', {}), /需要 task/)
  } finally { await h.cleanup() }
})

test('拉起认领别名：默认 t<任务号>；被占用时沿用变体 t5b 并写进首条消息', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 优先 | 任务 | 状态 |\n|---|---|---|---|\n| T5 | P1 | 别名任务 | 待认领 |\n')
    await h.relay.store.set('t5', h.peer.id)
    const done = await h.run('claim T5')
    assert.equal(done.kind, 'success', done.text)
    const claimer = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    assert.ok(claimer)
    assert.equal(h.relay.store.snapshot().t5b, claimer.id)
    assert.match(claimer.inbox[0][1].content[0].text, /@t5b/)
  } finally { await h.cleanup() }
})

test('推送链提醒：首次只记基线；末行变成 STOP / DONE 才提醒主会话一次', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    const wt = join(h.dir, '.agents/worktrees/release/r1')
    await mkdir(wt, { recursive: true })
    const log = join(h.dir, 'chain.log')
    await writeFile(log, 'push 281\n')
    await writeFile(join(wt, '.ACTIVE-SESSION'), `状态：活跃\n会话：session-${h.caller.id}\n合并：不可合并\n后台任务：chain.sh（pid 1999999）→ ${log}\n`)
    const poll = async () => { h.relay.declarations.cache.clear(); return h.relay.chain.poll() }
    assert.deepEqual(await poll(), [])
    await writeFile(log, 'push 281\npush 282\n')
    assert.deepEqual(await poll(), [])
    await writeFile(log, 'push 282\nSTOP: 283 Source checks failed\n')
    const sent = await poll()
    assert.equal(sent.length, 1)
    const inbox = h.caller.inbox.at(-1)[1]
    assert.equal(inbox.source.kind, 'agent-message')
    assert.match(inbox.content[0].text, /推送链提醒[\s\S]*⚠ 停下 \/ 失败：.*chain\.log 末行「STOP: 283 Source checks failed」/)
    assert.match(inbox.content[0].text, /不是用户指令/)
    assert.deepEqual(await poll(), [])
    await writeFile(log, 'CHAIN16_DONE 00:15:32Z\n')
    assert.match((await poll())[0].alerts[0].kind, /done/)
  } finally { await h.cleanup() }
})

test('自动置顶：默认关闭；开启后主会话最上、还在做的置顶；做完取消；不动手动置顶；关闭只撤插件加的', async () => {
  const h = await setup()
  try {
    const w2 = h.makeAgent('ffffffff-0000-0000-0000-000000000006', { cwd: h.dir })
    const manual = h.makeAgent('77777777-0000-0000-0000-000000000007', { cwd: h.dir })
    for (const agent of [w2, manual]) h.agents.set(agent.id, agent)
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id, w2.id, manual.id] })
    const registry = h.relay.ctx.workspaceRegistry
    registry.pinnedSessionIds = [manual.id]
    registry.pinSession = async (id) => { if (!registry.pinnedSessionIds.includes(id)) registry.pinnedSessionIds = [id, ...registry.pinnedSessionIds] }
    registry.unpinSession = async (id) => { registry.pinnedSessionIds = registry.pinnedSessionIds.filter((item) => item !== id) }
    await h.run('main here')
    await h.call('peer_report', { status: 'working', summary: '在做' }, h.peer)
    await h.call('peer_report', { status: 'done', summary: '做完了' }, w2)
    // 主会话在开启前已手动置顶（排在最后，最旧）
    registry.pinnedSessionIds = [manual.id, h.caller.id]
    // 只持有声明、没加入协作的会话（静默观察者）与空白会话：开启后也不置顶
    const silent = h.makeAgent('88888888-0000-0000-0000-000000000008', { cwd: h.dir })
    h.agents.set(silent.id, silent)
    h.workspaces[0].sessionIds.push(silent.id)
    await mkdir(join(h.dir, '.agents/worktrees/fix/silent'), { recursive: true })
    await writeFile(join(h.dir, '.agents/worktrees/fix/silent/.ACTIVE-SESSION'), `状态：活跃\n会话：session-${silent.id}\n合并：不可合并\n`)
    await h.run('open --join --as blank1')
    const blank = h.relay.store.snapshot().blank1
    // 默认关闭：不置顶
    assert.deepEqual(await h.relay.autoPin.sync(), [])
    assert.deepEqual(registry.pinnedSessionIds, [manual.id, h.caller.id])
    assert.match((await h.run('pin')).text, /未开启（默认关闭）/)
    const on = await h.run('pin on')
    assert.equal(on.kind, 'success', on.text)
    assert.ok(!registry.pinnedSessionIds.includes(silent.id))
    assert.ok(!registry.pinnedSessionIds.includes(blank))
    // 主会话被挪到最上面，但仍算手动置顶（不归插件）
    assert.deepEqual(registry.pinnedSessionIds, [h.caller.id, h.peer.id, manual.id])
    assert.ok(!h.relay.autoPin.ownedIn('ws-a').includes(h.caller.id))
    // 再跑一轮不来回挪
    await h.relay.autoPin.sync()
    assert.deepEqual(registry.pinnedSessionIds, [h.caller.id, h.peer.id, manual.id])
    // 做完：取消
    await h.call('peer_report', { status: 'done', summary: '完成' }, h.peer)
    await h.relay.autoPin.sync()
    assert.deepEqual(registry.pinnedSessionIds, [h.caller.id, manual.id])
    // 看板一变就补跑一轮，不用等 30 秒轮询（这里开 kick，延迟 5ms）
    h.relay.autoPin.kickDelayMs = 5
    await h.call('peer_report', { status: 'working', summary: '又开始做' }, w2)
    await new Promise((resolve) => setTimeout(resolve, 40))
    await h.relay.autoPin.running?.catch(() => {})
    assert.ok(registry.pinnedSessionIds.includes(w2.id), '汇报后马上置顶')
    await h.call('peer_report', { status: 'done', summary: '完成' }, w2)
    await new Promise((resolve) => setTimeout(resolve, 40))
    await h.relay.autoPin.running?.catch(() => {})
    assert.ok(!registry.pinnedSessionIds.includes(w2.id), '做完马上取消')
    h.relay.autoPin.kickDelayMs = -1
    // 用户手动取消主会话的置顶：插件重新置顶并归自己；再被取消就记 declined，不抢回
    await registry.unpinSession(h.caller.id)
    await h.relay.autoPin.sync()
    assert.equal(registry.pinnedSessionIds[0], h.caller.id)
    await registry.unpinSession(h.caller.id)
    await h.relay.autoPin.sync()
    await h.relay.autoPin.sync()
    assert.deepEqual(registry.pinnedSessionIds, [manual.id])
    // 新的工作会话置顶后，主会话（未置顶）不受影响
    const board = await h.relay.board(undefined, { session: h.caller.id })
    assert.deepEqual(board.autoPin, { enabled: true, available: true, owned: 0 })
    // 关闭：插件加的撤掉，手动的保留
    await h.call('peer_report', { status: 'working', summary: '又开始' }, w2)
    await h.relay.autoPin.sync()
    assert.ok(registry.pinnedSessionIds.includes(w2.id))
    const off = await h.run('pin off')
    assert.match(off.text, /撤掉了插件加的 1 个置顶/)
    assert.deepEqual(registry.pinnedSessionIds, [manual.id])
    // 关闭后不再置顶
    await h.relay.autoPin.sync()
    assert.deepEqual(registry.pinnedSessionIds, [manual.id])
  } finally { await h.cleanup() }
})

test('工作会话交接：带上看板、声明、认领、最近对话；别名移过去；原会话停手；运行中拒绝；主会话拒绝', async () => {
  const h = await setup()
  try {
    const src = h.makeAgent('56565656-0000-0000-0000-000000000056', { cwd: h.dir })
    h.agents.set(src.id, src)
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id, src.id] })
    await h.run('main here')
    await h.run(`alias t35 ${src.id}`)
    await h.call('peer_report', { status: 'blocked', summary: '卡在 vscreen 错误码', branch: 'fix/vscreen-error-detail', files: 'app/x.java', question: '要不要改 ADR？' }, src)
    const wt = join(h.dir, '.agents/worktrees/fix/vscreen-error-detail')
    await mkdir(wt, { recursive: true })
    await writeFile(join(wt, '.ACTIVE-SESSION'), `状态：活跃\n分支：fix/vscreen-error-detail（基于 42fa5c3e）\n会话：session-${src.id}\n当前阶段：调查中\n占用文件：app/x.java\n合并：不可合并\n后台任务：无\n`)
    await mkdir(join(h.dir, '.agents/claims/T35'), { recursive: true })
    await writeFile(join(h.dir, '.agents/claims/T35/owner'), `session-${src.id}\n2026-11-03 UTC\n`)
    const text = (t) => [{ type: 'text', text: t }]
    h.services.sessionQuery = { readSurface: async () => ({ events: [
      { seq: 1, time: 1, type: 'user/message', data: { message: { role: 'user', content: text('认领 T35'), source: { kind: 'user' } } } },
      { seq: 2, time: 2, type: 'assistant/message', data: { message: { role: 'assistant', content: text('已认领，正在查') } } },
      { seq: 3, time: 3, type: 'user/message', data: { message: { role: 'user', content: text('继续'), source: { kind: 'user' } } } },
      { seq: 4, time: 4, type: 'assistant/message', data: { message: { role: 'assistant', content: text('卡住了，示例 @[标题](dsh-session:…) 和 @[旧](dsh-session:ImEi) 写法') } } }
    ] }) }
    // 主会话不能用 takeover；运行中的不能交
    assert.match((await h.run(`takeover ${h.caller.id}`)).text, /主会话交接用/)
    src.status = 'running'
    assert.match((await h.run('takeover t35')).text, /还在运作（对话轮次进行中）/)
    src.status = 'idle'
    const done = await h.run('takeover t35 原会话额度用完了')
    assert.equal(done.kind, 'success', done.text)
    assert.match(done.text, /1 份工作树声明、1 个任务认领、最近 4 条对话；别名 @t35 已移到接手方/)
    const receiver = [...h.agents.values()].find((agent) => agent.id.startsWith('dddddddd'))
    assert.equal(h.relay.store.snapshot().t35, receiver.id)
    const [mode, message] = receiver.inbox[0]
    assert.equal(mode, 'followup')
    assert.equal(message.source.kind, 'user')
    const body = message.content[0].text
    assert.match(body, /【工作交接 · 用户已确认】你（@t35）接手会话/)
    assert.match(body, /== 用户补充 ==\n原会话额度用完了/)
    assert.match(body, /受阻 · 卡在 vscreen 错误码/)
    assert.match(body, /待答复的问题：要不要改 ADR？/)
    assert.match(body, new RegExp(`${wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\.ACTIVE-SESSION`))
    assert.match(body, /T35：.*claims\/T35\/owner/)
    assert.match(body, /\[seq 3 · .* 用户\] 继续/)
    assert.match(body, /\[seq 4 · .* 助手\] 卡住了/)
    // 原会话回复里的会话引用（含不合法的示例）投递前改成纯文字，DSH 自己的解析器不再报错、也不拼快照
    const { parseSessionReferenceText } = await import('@deepseek-ai/dsh-session-reference')
    assert.deepEqual(parseSessionReferenceText(body).references, [])
    assert.match(body, /示例 @\[标题\]\(dsh-session：…\) 和 @旧（a） 写法/)
    assert.match(body, /== 原会话最近 2 轮 ==\n\[seq 1 /) // 两轮 = 两条用户消息及其回复
    assert.match(body, new RegExp(`把 .*「会话」改成你的 id（${receiver.id}）`))
    assert.match(body, /末尾追加「接手 /)
    const board = h.relay.coord.snapshot().board
    assert.equal(board[receiver.id].status, 'blocked')
    assert.equal(board[receiver.id].branch, 'fix/vscreen-error-detail')
    assert.equal(board[src.id].status, 'done')
    assert.match(board[src.id].summary, /已交接给/)
    // 原会话：停手通知，放进收件箱不唤醒
    const notice = src.inbox.at(-1)
    assert.equal(notice[0], 'queue')
    assert.match(notice[1].content[0].text, /不要再改原来的工作树、声明和任务认领文件/)
    // 只读：声明与认领文件没变
    assert.match(await readFile(join(wt, '.ACTIVE-SESSION'), 'utf8'), new RegExp(`会话：session-${src.id}`))
    // 交给已有会话
    const again = await h.run(`takeover t35 --to ${h.peer.id}`)
    assert.match(again.text, /还在运作|交接完成/)
  } finally { await h.cleanup() }
})

test('交接前检查是否还在运作：轮次 / 后台任务 / 子代理拒绝，定时提醒只提示；面板 activity 视图', async () => {
  const h = await setup()
  try {
    const src = h.makeAgent('57575757-0000-0000-0000-000000000057', { cwd: h.dir })
    const dst = h.makeAgent('58585858-0000-0000-0000-000000000058', { cwd: h.dir })
    for (const agent of [src, dst]) h.agents.set(agent.id, agent)
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, src.id, dst.id] })
    await h.call('peer_report', { status: 'working', summary: '做着' }, src)
    const activity = new Map()
    h.relay.ctx.waterfall = async (_name, { sessionId }, next) => [...(activity.get(sessionId) ?? []), ...(await next())]
    activity.set(src.id, [{ kind: 'job', items: [{ id: 'j1', label: 'gradle' }] }])
    assert.deepEqual(await h.relay.busyOf(src.id), { busy: true, reasons: ['后台任务运行中 1 个'], notes: [] })
    assert.match((await h.run(`takeover ${src.id}`)).text, /还在运作（后台任务运行中 1 个）/)
    activity.set(src.id, [{ kind: 'schedule', items: [{ id: 's1' }] }])
    const onlyReminder = await h.relay.busyOf(src.id)
    assert.equal(onlyReminder.busy, false)
    assert.match(onlyReminder.notes[0], /定时提醒/)
    // 接手方在运作也拒绝
    activity.set(dst.id, [{ kind: 'subagent', items: [{}, {}] }])
    assert.match((await h.run(`takeover ${src.id} --to ${dst.id}`)).text, /接手方 .* 还在运作（子代理运行中 2 个）/)
    activity.set(dst.id, [{ kind: 'turn' }])
    const route = h.routes[0].handler
    const res = await new Promise((resolve) => {
      const out = { headers: {}, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }) } }
      route({ method: 'GET', url: `/api/dsha-session-relay?view=activity&ids=${src.id},${dst.id}`, headers: {} }, out)
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.activity[src.id].busy, false)
    assert.deepEqual(res.body.activity[dst.id].reasons, ['对话轮次进行中'])
    activity.clear()
    assert.match((await h.run(`takeover ${src.id} --to ${dst.id}`)).text, /交接完成/)
  } finally { await h.cleanup() }
})

test('主会话上下文超限：不再让它起草；插件从最近记录整理草稿，确认后照常交接', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    const text = (t) => [{ type: 'text', text: t }]
    h.services.sessionQuery = { readSurface: async () => ({ events: [
      { seq: 10, time: 10, type: 'user/message', data: { message: { role: 'user', content: text('推 295'), source: { kind: 'user' } } } },
      { seq: 11, time: 11, type: 'assistant/message', data: { message: { role: 'assistant', content: text('295 推送中，chain17 → /tmp/rel3/chain17.log') } } }
    ] }) }
    // 观察到一轮因上下文超限失败
    h.listeners['session/event'](h.caller.session, { type: 'turn/end', time: 12, data: { turn: 19, reason: { kind: 'error', error: { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'context overflow' } } } })
    const asked = await h.run('handoff ask')
    assert.equal(asked.kind, 'error')
    assert.match(asked.text, /上下文超限失败.*\/relay handoff auto/)
    assert.equal(h.caller.inbox.length, 0) // 没往失败的主会话里塞消息
    const view = h.relay.handoffView('ws-1')
    assert.equal(view.coordinatorFailure.code, 'CONTEXT_WINDOW_EXCEEDED')
    const auto = await h.run('handoff auto')
    assert.equal(auto.kind, 'success', auto.text)
    const draft = h.relay.handoffs.draft('ws-1')
    assert.equal(draft.by, 'plugin')
    assert.match(draft.notes, /因上下文超限失败.*没能自己写交接说明/)
    assert.match(draft.notes, /\[seq 11 .* 助手\] 295 推送中，chain17/)
    assert.match((await h.run('handoff')).text, /插件整理写/)
    const done = await h.run('handoff confirm --as main2')
    assert.equal(done.kind, 'success', done.text)
    const successor = h.relay.store.snapshot().main2
    const received = h.agents.get(successor).inbox[0][1].content[0].text
    assert.match(received, /插件从前任主会话的最近记录整理（前任没能自己起草）、用户确认后/)
    // 成功的一轮清掉失败标记
    h.listeners['session/event'](h.caller.session, { type: 'turn/end', time: 13, data: { turn: 20, reason: { kind: 'normal' } } })
    assert.equal(h.relay.lastFailure(h.caller.id), undefined)
  } finally { await h.cleanup() }
})

test('peer_inspect：本工作区可看、工作区外拒绝（用户命令可看）；不唤醒目标；工作区搜索；digest 读到用户提示', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    const outsider = h.makeAgent('99999999-0000-0000-0000-000000000009', { cwd: '/z' })
    h.agents.set(outsider.id, outsider)
    const reads = []
    h.services.sessionQuery = {
      readSession: async (id) => { reads.push(id); return { session: { id, cwd: h.dir }, events: sampleEvents() } },
      readSurface: async () => ({ events: sampleEvents() })
    }
    const overview = await h.call('peer_inspect', { session: 'bbbbbbbb' })
    assert.match(overview, /出错 EMPTY_RESPONSE/)
    assert.equal(h.peer.inbox.length, 0)
    assert.match(await h.call('peer_inspect', { session: 'bbbbbbbb', view: 'tools', errors_only: true }), /TOOL_TIMEOUT/)
    assert.match(await h.call('peer_inspect', { session: 'bbbbbbbb', query: 'a{x:2}' }), /1 处命中/)
    assert.match(await h.call('peer_inspect', { view: 'event', seq: 21 }), /EMPTY_RESPONSE/)
    await assert.rejects(h.call('peer_inspect', { view: 'event' }), /需要 seq/)
    await assert.rejects(h.call('peer_inspect', { session: outsider.id }), /不在本工作区.*\/relay inspect/)
    // 子代理按根会话的工作区视角查看
    assert.ok(typeof await h.call('peer_inspect', { session: 'bbbbbbbb' }, h.child) === 'string')
    const ws = await h.call('peer_inspect', { query: '协作', scope: 'workspace' })
    assert.match(ws, /扫描 2 个会话，2 个命中/)
    const turnFiltered = await h.call('peer_inspect', { query: 'edit', scope: 'workspace', turn: 1 })
    assert.match(turnFiltered, /没有命中/)
    const turnMatched = await h.call('peer_inspect', { query: 'edit', scope: 'workspace', turn: 2 })
    assert.match(turnMatched, /共 4 处/)
    assert.match(turnMatched, /2 处（显示 2）/)
    // 用户命令可以看工作区外的会话
    const user = await h.run(`inspect ${outsider.id.slice(0, 8)} files`)
    assert.equal(user.kind, 'success')
    assert.match(user.text, /client\.js · 成功 1 次/)
    assert.match((await h.run('search --in bbbbbbbb --kind error EMPTY')).text, /轮次结束/)
    // 短时间内重复查看走缓存
    const before = reads.length
    await h.call('peer_inspect', { session: 'bbbbbbbb', view: 'files' })
    assert.equal(reads.length, before)
    // peer_inspect digest 能读到原始形状的用户提示
    const digest = await h.call('peer_inspect', { session: 'bbbbbbbb', view: 'digest', turns: 2 })
    assert.match(digest, /用户\] 压缩面板布局/)
    assert.doesNotMatch(digest, /运行时上下文/)
  } finally { await h.cleanup() }
})

test('peer_tasks：汇总 / 单个任务 / 失效持有者；归档只有主会话或用户能执行，planId 不对拒绝', async () => {
  const h = await setup()
  try {
    await taskFixture(h.dir)
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    h.services.sessionQuery = { readSession: async () => { throw new Error('cold read not expected in this test') } }
    const report = await h.call('peer_tasks', {})
    assert.match(report, /持有者已失效（2）/)
    assert.match(report, /T3 .*会话已不存在/)
    assert.match(report, /可归档 3 个/)
    assert.ok(Buffer.byteLength(report, 'utf8') < 4000)
    assert.match(await h.call('peer_tasks', { id: 't2' }), /已挑入 main/)
    assert.match(await h.call('peer_tasks', { states: 'merged' }), /已合入（2）：\n- T1/)
    await assert.rejects(h.call('peer_tasks', { states: 'bogus' }), /不认识的状态/)
    const preview = await h.call('peer_tasks', { archive: 'preview' })
    const planId = /apply ([0-9a-f]{12})/.exec(preview)[1]
    // 不是主会话：不能执行
    await assert.rejects(h.call('peer_tasks', { archive: 'apply', plan_id: planId }), /只有本工作区的主会话或用户/)
    await h.run('main here')
    await assert.rejects(h.call('peer_tasks', { archive: 'apply', plan_id: 'aaaaaaaaaaaa' }), /被改过/)
    const before = (await readFile(join(h.dir, '.agents/TASKS.md'), 'utf8')).length
    assert.match(await h.call('peer_tasks', { archive: 'apply', plan_id: planId }), /已归档 3 个任务/)
    assert.ok((await readFile(join(h.dir, '.agents/TASKS.md'), 'utf8')).length < before)
    // 用户命令
    assert.match((await h.run('tasks T3')).text, /认领：.*→/)
    assert.match((await h.run('tasks archive')).text, /没有可归档的任务/)
    // 按持有者：T3 由 33333333 认领、44444444 接手
    const ref = `@[任务三](dsh-session:${Buffer.from(JSON.stringify('session-44444444-0000-0000-0000-000000000004')).toString('base64url')})`
    const byHolder = (await h.run(`tasks ${ref}`)).text
    assert.match(byHolder, /认领或接手过的任务：1 个/)
    assert.match(byHolder, /- T3 /)
    assert.doesNotMatch(byHolder, /- T4 /)
    assert.match(await h.call('peer_tasks', { session: 'session-55555555-0000-0000-0000-000000000005' }), /- T4 /)
  } finally { await h.cleanup() }
})

test('上下文估算：实时观察时虚报的 usage 按累计字符封顶，不提前出 context-budget', async () => {
  const h = await setup()
  try {
    const agent = h.makeAgent('5b5b5b5b-0000-0000-0000-00000000005b', { cwd: h.dir })
    const events = agent.session.snapshotEvents()
    const push = (event) => { events.push(event); h.relay.observe(agent.session, event) }
    push({ type: 'system/message', data: { text: 'x'.repeat(100_000) } })
    push({ type: 'assistant/message', data: { usage: { totalTokens: 30_000 } } })
    assert.equal(h.relay.contextTokensOf(agent.session.id), 30_000)
    push({ type: 'tool/result', data: { text: 'y'.repeat(40_000) } })
    push({ type: 'assistant/message', data: { usage: { inputTokens: 720_000, totalTokens: 725_000 } } })
    const tokens = h.relay.contextTokensOf(agent.session.id)
    assert.ok(tokens > 140_000 && tokens < 142_000, String(tokens))
    assert.equal(h.relay.contextBudgetText(agent.session.id, false), '')
    // 没有快照可补时不封顶
    const bare = { id: 'session-5c5c5c5c-0000-0000-0000-00000000005c', header: { cwd: h.dir } }
    h.relay.observe(bare, { type: 'assistant/message', data: { usage: { totalTokens: 500_000 } } })
    assert.equal(h.relay.contextTokensOf(bare.id), 500_000)
  } finally { await h.cleanup() }
})

test('面板唤醒：wake-plan 只读预判；小上下文原地唤醒发「继续」，过大新建会话接手', async () => {
  const h = await setup()
  try {
    const small = h.makeAgent('59595959-0000-0000-0000-000000000059', { cwd: h.dir })
    const big = h.makeAgent('5a5a5a5a-0000-0000-0000-00000000005a', { cwd: h.dir })
    for (const agent of [small, big]) h.agents.set(agent.id, agent)
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, small.id, big.id] })
    h.relay.contextTokens = new Map([[small.id, 40_000], [big.id, 646_000]])
    const route = h.routes[0].handler
    const call = (req) => new Promise((resolve) => {
      const out = { headers: {}, writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }) } }
      if (req.method === 'POST') {
        const body = Buffer.from(JSON.stringify(req.body))
        const stream = { method: 'POST', url: '/api/dsha-session-relay', headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield body }, on(name, fn) { if (name === 'data') fn(body); if (name === 'end') fn(); return this } }
        route(stream, out)
      } else route({ method: 'GET', url: req.url, headers: {} }, out)
    })
    const plan = await call({ method: 'GET', url: `/api/dsha-session-relay?view=wake-plan&target=${big.id}&fromSession=${h.caller.id}` })
    assert.equal(plan.status, 200)
    assert.equal(plan.body.wake.plans.auto.action, 'new')
    assert.equal(plan.body.wake.plans.resume.action, 'resume')
    assert.equal(plan.body.wake.contextTokens, 646_000)
    assert.equal(big.inbox.length, 0, '预判不发消息')
    assert.equal((await call({ method: 'GET', url: `/api/dsha-session-relay?view=wake-plan&target=${small.id}` })).body.wake.plans.auto.action, 'resume')
    // 原地唤醒
    const resumed = await call({ method: 'POST', body: { action: 'wake', target: small.id, note: '先修 lint', fromSession: h.caller.id } })
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body))
    assert.equal(resumed.body.result.action, 'resume')
    assert.equal(resumed.body.result.to, small.id)
    assert.equal(small.inbox.at(-1)[0], 'followup')
    assert.match(small.inbox.at(-1)[1].content[0].text, /用户唤醒你继续[\s\S]*补充说明：先修 lint/)
    // 过大：新建接手，原会话不被唤醒
    const before = big.inbox.length
    const renewed = await call({ method: 'POST', body: { action: 'wake', target: big.id, alias: 'big2', fromSession: h.caller.id } })
    assert.equal(renewed.status, 200, JSON.stringify(renewed.body))
    assert.equal(renewed.body.result.action, 'new')
    const created = h.agents.get(renewed.body.result.to)
    assert.ok(created && created.id.startsWith('dddddddd'))
    assert.match(created.inbox[0][1].content[0].text, /接手/)
    assert.ok(renewed.body.result.aliases.includes('big2'))
    assert.ok(big.inbox.slice(before).every(([mode]) => mode !== 'followup'), '原会话不收 followup 唤醒')
    // 运行中拒绝
    h.busy.add(small.id)
    assert.equal((await call({ method: 'GET', url: `/api/dsha-session-relay?view=wake-plan&target=${small.id}` })).body.wake.plans.auto.action, 'running')
    const refused = await call({ method: 'POST', body: { action: 'wake', target: small.id } })
    assert.equal(refused.status, 400)
    assert.equal(refused.body.error, 'target_running')
  } finally { await h.cleanup() }
})

test('交接快照：看板报可合并但提交已在 origin/main 的，按已合入不列出；没进 main 的照列', async () => {
  const h = await setup()
  try {
    const { execFileSync } = await import('node:child_process')
    const g = (...args) => execFileSync('git', args, { cwd: h.dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim()
    g('init', '-q'); g('commit', '-q', '--allow-empty', '-m', 'base')
    g('commit', '-q', '--allow-empty', '-m', 'feat: 已合入的修复')
    const merged = g('rev-parse', 'HEAD')
    g('update-ref', 'refs/remotes/origin/main', merged)
    g('checkout', '-q', '-b', 'side'); g('commit', '-q', '--allow-empty', '-m', 'fix: 还没合的修复')
    const pending = g('rev-parse', 'HEAD')
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await h.call('peer_report', { status: 'ready', summary: '旧的可合并', commit: merged.slice(0, 8) }, h.peer)
    const before = await h.relay.mainMergedFor('ws-a')
    assert.equal(before.size, 1)
    let snap = h.relay.handoffSnapshotFor('ws-a', before)
    assert.match(snap, /没有进行中的会话[\s\S]*归档 1 个（已合入 main 1）/)
    await h.call('peer_report', { status: 'ready', summary: '真的可合并', commit: pending.slice(0, 8) }, h.peer)
    snap = h.relay.handoffSnapshotFor('ws-a', await h.relay.mainMergedFor('ws-a'))
    assert.match(snap, /可合并 1[\s\S]*真的可合并/)
    // 提交本机已不存在：并成一行，不展开
    await h.call('peer_report', { status: 'ready', summary: '提交已被改写', commit: 'deadbeef' }, h.peer)
    snap = h.relay.handoffSnapshotFor('ws-a', await h.relay.mainMergedFor('ws-a'))
    assert.match(snap, /归档 1 个（提交本机已不存在 1）.*其中提交本机已不存在的 bbbbbbbb 请核对/)
    assert.doesNotMatch(snap, /提交已被改写/)
  } finally { await h.cleanup() }
})

test('声明写了「已合入 buildNNN」且提交确在 origin/main：插件把看板 ready 条目标成 done；不在 main 的不动', async () => {
  const h = await setup()
  try {
    const { execFileSync } = await import('node:child_process')
    const g = (...args) => execFileSync('git', args, { cwd: h.dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim()
    g('init', '-q'); g('commit', '-q', '--allow-empty', '-m', 'base')
    g('commit', '-q', '--allow-empty', '-m', 'feat: 主会话代为合并的修复')
    const merged = g('rev-parse', 'HEAD')
    g('update-ref', 'refs/remotes/origin/main', merged)
    g('checkout', '-q', '-b', 'side'); g('commit', '-q', '--allow-empty', '-m', 'fix: 声明写了已合入其实没进 main')
    const notIn = g('rev-parse', 'HEAD')
    const third = { id: 'cccccccc-0000-0000-0000-000000000003', header: {} }
    h.sessions?.set?.(third.id, third)
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id, third.id] })
    await h.run('main here')
    const wt1 = join(h.dir, '.agents/worktrees/fix/landed')
    await mkdir(wt1, { recursive: true })
    await writeFile(join(wt1, '.git'), 'gitdir: x\n')
    await writeFile(join(wt1, '.SESSION-DONE'), `状态：已结束\n分支：fix/landed\n会话：session-${h.peer.id}\n合并：可合并\n已合入 build301（${merged.slice(0, 8)}）\n`)
    await h.call('peer_report', { status: 'ready', summary: '可合并了', branch: 'fix/landed' }, h.peer)
    const wt2 = join(h.dir, '.agents/worktrees/fix/claimed')
    await mkdir(wt2, { recursive: true })
    await writeFile(join(wt2, '.git'), 'gitdir: x\n')
    await writeFile(join(wt2, '.SESSION-DONE'), `状态：已结束\n分支：fix/claimed\n会话：session-${third.id}\n合并：可合并\n已合入 build302（${notIn.slice(0, 8)}）\n`)
    await h.relay.coord.join(third.id)
    await h.relay.coord.upsert(third.id, { status: 'ready', summary: '也可合并', branch: 'fix/claimed' })
    const group = { key: 'ws-a', ...h.relay.coord.group('ws-a'), workspace: h.relay.workspaceById('ws-a') }
    const view = await h.relay.declarationViewFresh(group, { maxAgeMs: 0 })
    assert.deepEqual(view.readyMerged.map((item) => item.sessionId).sort(), [h.peer.id, third.id].sort(), '两条都是「看板可合并、声明已合入」')
    await h.relay.mainMergedFor('ws-a')
    const board = h.relay.coord.snapshot().board
    assert.equal(board[h.peer.id].status, 'done')
    assert.match(board[h.peer.id].summary, /插件核对.*已合入 build301.*已在 origin\/main/)
    assert.equal(board[third.id].status, 'ready', '提交不在 origin/main：不自动完成')
  } finally { await h.cleanup() }
})

test('核验：只有主会话 / 用户能登记与取消；工作会话能看；主会话上下文提示不用自己轮询', async () => {
  const h = await setup()
  try {
    h.relay.watches.checkers = { repoOf: async () => 'o/r', ci: async () => ({ done: false, status: 'queued' }), ref: async () => ({ sha: null }) }
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await h.call('peer_report', { status: 'working', summary: 'x' }, h.peer)
    await assert.rejects(h.call('peer_watch', { action: 'add', kind: 'ci', run_id: '1' }, h.peer), /只有本工作区的主会话/)
    const added = await h.call('peer_watch', { action: 'add', kind: 'ci', run_id: '41815663194', label: 'build308' })
    assert.match(added, /已登记核验 [0-9a-f]{8}：build308 · CI 41815663194 @o\/r/)
    assert.match(await h.call('peer_watch', { action: 'add', kind: 'ci', run_id: '41815663194' }), /没有重复登记/)
    assert.match(await h.call('peer_watch', { action: 'list' }, h.peer), /核验中 · build308/)
    assert.match(h.contextFor(h.caller), /Plugin is watching 1[\s\S]*do not poll/)
    const ref = (await h.run('watch ref main abcdef12 --hours 2 推送 309')).text
    assert.match(ref, /已登记核验 [0-9a-f]{8}：推送 309 · origin\/main = abcdef12/)
    const id = /核验 ([0-9a-f]{8})/.exec(ref)[1]
    assert.match((await h.run(`watch cancel ${id}`)).text, /已取消核验/)
    assert.match((await h.run('watch ci 12;rm')).text, /数字 run id|用法/)
  } finally { await h.cleanup() }
})

test('核验：新工作区没有主会话时，本会话可以自己登记 / 取消，通知发给登记人；有了主会话后别人不能再登记', async () => {
  const h = await setup({ mailboxBatchWindowMs: 0 })
  try {
    let remote = null
    h.relay.watches.checkers = { repoOf: async () => 'o/r', ci: async () => ({ done: false }), ref: async () => ({ sha: remote }) }
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    assert.match(await h.call('peer_watch', { action: 'list' }), /还没有主会话：本会话可以直接用 peer_watch 登记/)
    const added = await h.call('peer_watch', { action: 'add', kind: 'ref', ref: 'v1', sha: 'abcdef12', label: '新区 tag' })
    const id = /核验 ([0-9a-f]{8})/.exec(added)[1]
    await assert.rejects(h.call('peer_watch', { action: 'cancel', id }, h.peer), /只能取消自己登记的/)
    remote = 'abcdef1200000000000000000000000000000000'
    await h.relay.watches.tick() // 等登记时触发的那一轮结束
    for (const item of h.relay.watches.store.items()) item.nextAt = 0
    await h.relay.watches.tick()
    await h.relay.mailboxTick()
    assert.match(h.caller.inbox.map(([, message]) => message.content[0].text).join('\n'), /新区 tag/)
    await h.call('peer_watch', { action: 'add', kind: 'ref', ref: 'v2', sha: 'abcdef12' })
    const second = /核验 ([0-9a-f]{8})/.exec(await h.call('peer_watch', { action: 'add', kind: 'ref', ref: 'v3', sha: 'abcdef13' }))[1]
    assert.match(await h.call('peer_watch', { action: 'cancel', id: second }), /已取消/)
    await h.run('main here', h.peer)
    await assert.rejects(h.call('peer_watch', { action: 'add', kind: 'ref', ref: 'v4', sha: 'abcdef14' }), /只有本工作区的主会话能登记/)
  } finally { await h.cleanup() }
})

test('核验 tag：登记后换了主会话，tag 推上来时通知现任主会话（不是登记者），并发邮箱短通知（成功不响手机）', async () => {
  const h = await setup({ mailboxBatchWindowMs: 0 })
  try {
    let remote = null
    h.relay.watches.checkers = { repoOf: async () => 'o/r', ci: async () => ({ done: false }), ref: async () => ({ sha: remote }) }
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    const added = await h.call('peer_watch', { action: 'add', kind: 'ref', ref: 'v0.15.0', sha: '56bbde8f', label: '0.15.0 tag' })
    assert.match(added, /已登记核验/)
    // 主会话交给 peer，之后 tag 才出现
    await h.run('main here', h.peer)
    remote = '56bbde8f00000000000000000000000000000000'
    await h.relay.watches.tick() // 等登记时触发的那一轮结束
    for (const item of h.relay.watches.store.items()) item.nextAt = 0
    await h.relay.watches.tick()
    await h.relay.mailboxTick()
    const toPeer = h.peer.inbox.map(([, message]) => message.content[0].text).join('\n')
    assert.match(toPeer, /0\.15\.0 tag/)
    assert.doesNotMatch(h.caller.inbox.map(([, message]) => message.content[0].text).join('\n'), /0\.15\.0 tag/)
    assert.ok(h.relay.mailbox.items().some((item) => /0\.15\.0 tag/.test(item.subject)))
    assert.equal(h.notified.length, 0, '成功类只进邮箱/短通知，不响手机')
  } finally { await h.cleanup() }
})

test('peer_task：认领 / 拒抢 / 接手失效者 / 完成 / 登记 / 转交 / 退回 / 用户放弃 / 主会话改字段，带通知、备份与日志', async () => {
  const h = await setup()
  try {
    const main = h.makeAgent('eeeeeeee-0000-0000-0000-000000000005', { cwd: h.dir })
    h.agents.set(main.id, main)
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id, main.id] })
    await mkdir(join(h.dir, '.agents/claims/T9'), { recursive: true })
    await writeFile(join(h.dir, '.agents/claims/T9/owner'), 'session-99999999-0000-0000-0000-000000000009\n2026-11-01 00:00:00 UTC\n')
    const board = join(h.dir, '.agents/TASKS.md')
    await writeFile(board, ['# 看板', '', '## 任务', '', '| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |', '|---|---|---|---|---|---|',
      '| T1 | P2 | 一 | a | 否 | 待认领 |', '| T3 | P1 | 三 | c | 是 | 待认领 |', '| T9 | P1 | 九 | d | 是 | 进行中 |', '', '### T3 三', '', '- 原有', ''].join('\n'))
    await h.run('main here', main)
    const row = async (id) => parseTaskDoc(await readFile(board, 'utf8')).rows.find((item) => item.id === id)
    const owner = (id) => readFile(join(h.dir, '.agents/claims', id, 'owner'), 'utf8')

    assert.match(await h.call('peer_task', { action: 'claim', id: 't3' }), /已认领 T3/)
    assert.match(await owner('T3'), new RegExp(`^${h.caller.id}\\n`))
    assert.match((await row('T3')).status, /^进行中（aaaaaaaa 认领/)
    assert.match(await h.call('peer_task', { action: 'claim', id: 'T3' }), /已经由你持有/)
    await assert.rejects(h.call('peer_task', { action: 'claim', id: 'T3' }, h.peer), /已被 .*认领/)
    await assert.rejects(h.call('peer_task', { action: 'takeover', id: 'T3' }, h.peer), /没有失效/)
    await assert.rejects(h.call('peer_task', { action: 'takeover', id: 'T3', force: true }, h.peer), /没有失效/) // 工作会话不能强制
    await assert.rejects(h.call('peer_task', { action: 'done', id: 'T3', text: 'x' }, h.peer), /持有者是/)
    await assert.rejects(h.call('peer_task', { action: 'claim', id: 'T77' }), /都没有 T77/)

    const done = await h.call('peer_task', { action: 'done', id: 'T3', text: 'abc12345 可合并（基于 build9）' })
    assert.match(done, /已完成 T3/)
    assert.match(await readFile(join(h.dir, '.agents/claims/T3/done'), 'utf8'), /^abc12345 可合并/)
    assert.match((await row('T3')).status, /^已完成（aaaaaaaa，.*）：abc12345 可合并/)
    const toMain = main.inbox.map(([mode, message]) => [mode, message.content[0].text])
    assert.ok(toMain.some(([mode, text]) => mode === 'queue' && /relay-task-event.*T3 已完成：abc12345/.test(text)))
    await assert.rejects(h.call('peer_task', { action: 'claim', id: 'T3' }, h.peer), /已写完成/)

    // 持有者会话已不存在：可以接手
    assert.match(await h.call('peer_task', { action: 'takeover', id: 'T9' }, h.peer), /已接手 T9/)
    assert.match(await owner('T9'), new RegExp(`\\n接手 ${h.peer.id} \\d{4}-`))

    // 登记：工作会话要写来源；号由插件分配
    await assert.rejects(h.call('peer_task', { action: 'new', title: '拆出的子任务' }, h.peer), /写明来源/)
    const created = await h.call('peer_task', { action: 'new', title: '拆出的子任务', priority: 'P2', detail: '从 T9 拆出，用户要求', claim: true }, h.peer)
    const newId = /已登记 (T\d+)/.exec(created)[1]
    assert.equal(newId, 'T10')
    assert.match((await row(newId)).status, /^进行中（bbbbbbbb 认领/)
    assert.ok(parseTaskDoc(await readFile(board, 'utf8')).sections.has(newId))
    await assert.rejects(h.call('peer_task', { action: 'new', id: 'T3', title: '撞号' }, main), /已经用过/)

    // 转交：目标收到收件箱通知（未唤醒），owner 记下
    await assert.rejects(h.call('peer_task', { action: 'handoff', id: newId, to: 'aaaaaaaa' }), /持有者是/)
    assert.match(await h.call('peer_task', { action: 'handoff', id: newId, to: 'aaaaaaaa', text: '你熟这块' }, h.peer), /已转交 T10 → [\s\S]*已通知/)
    assert.match(await owner(newId), new RegExp(`接手 ${h.caller.id} .* 由 bbbbbbbb 转交：你熟这块`))
    assert.ok(h.caller.inbox.some(([mode, message]) => mode === 'queue' && /把任务 T10 转交给你/.test(message.content[0].text)))

    // 退回：认领目录留档，表格回到待认领，之后别人能再认领
    assert.match(await h.call('peer_task', { action: 'release', id: newId, text: '先不做' }), /已退回 T10/)
    assert.equal((await readdir(join(h.dir, '.agents/claims/.released'))).filter((name) => name.startsWith('T10-')).length, 1)
    assert.match((await row(newId)).status, /^待认领（aaaaaaaa 退回.*先不做/)
    assert.match(await h.call('peer_task', { action: 'claim', id: newId }, h.peer), /已认领 T10/)

    // 用户命令：没人认领的任务直接标放弃
    const abandoned = await h.run('task abandon T1 需求取消')
    assert.equal(abandoned.kind, 'success', abandoned.text)
    assert.match(await readFile(join(h.dir, '.agents/claims/T1/abandoned'), 'utf8'), /需求取消/)
    assert.match((await row('T1')).status, /^已放弃/)

    // 改字段：持有者之外只有主会话 / 用户
    await assert.rejects(h.call('peer_task', { action: 'update', id: 'T3', priority: 'P0' }, h.peer), /持有者是/)
    await assert.rejects(h.call('peer_task', { action: 'update', id: 'T3' }, main), /要给出要改的字段/)
    assert.match(await h.call('peer_task', { action: 'update', id: 'T3', priority: 'P0', note: '主会话复核' }, main), /已更新 T3/)
    assert.equal((await row('T3')).priority, 'P0')
    assert.match(await readFile(board, 'utf8'), /- 原有\n- \d{4}-\d\d-\d\d \d\d:\d\dZ eeeeeeee：主会话复核/)

    // 状态查询读到的是新结果
    assert.match(await h.call('peer_tasks', { id: 'T9' }), /接手 1 次|→/)
    // 1.8：任务事件、备份与锁都在插件任务库；工作区 .agents 里只留导出的看板/认领文件。
    const storeAgents = join(h.dir, 'tasks', h.relay.groupKeyOf(h.caller.id), '.agents')
    const events = (await readFile(join(storeAgents, 'task-events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(events.map((event) => event.action), ['claim', 'done', 'takeover', 'new', 'handoff', 'release', 'claim', 'abandon', 'update'])
    assert.ok((await readdir(join(storeAgents, 'backups/ops'))).length >= 8)
    await assert.rejects(readFile(join(storeAgents, '.tasks.lock')), /ENOENT/)
  } finally { await h.cleanup() }
})

test('任务库：首次导入后工作区文件只读；终态任务自动归档', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    const board = join(h.dir, '.agents/TASKS.md')
    const claim = join(h.dir, '.agents/claims/T1')
    await mkdir(claim, { recursive: true })
    await writeFile(board, '| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |\n|---|---|---|---|---|---|\n| T1 | P1 | 旧任务 | a | 否 | 已放弃 |\n')
    await writeFile(join(claim, 'owner'), `session-${h.caller.id}\n`)
    await writeFile(join(claim, 'abandoned'), '不做了\n')
    const old = new Date(Date.now() - 10 * 24 * 3600_000)
    await utimes(join(claim, 'abandoned'), old, old)
    await utimes(join(claim, 'owner'), old, old)

    // 第一次查询导入插件任务库。
    assert.match(await h.call('peer_tasks', {}), /T1/)
    // 之后手改工作区文件不会被回读（源已是插件任务库）。
    await writeFile(board, '| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |\n|---|---|---|---|---|---|\n| T2 | P1 | 手改的不回读 | b | 否 | 待认领 |\n')
    assert.doesNotMatch(await h.call('peer_tasks', {}), /T2/)

    // 终态超过 7 天：自动归档到插件归档库，并重导出。
    h.relay.taskArchiveAfterDays = 7
    const swept = await h.relay.taskArchiveSweep()
    assert.deepEqual(swept.archived, ['T1'])
    assert.doesNotMatch(await readFile(board, 'utf8'), /\| T1 \|/)
    assert.match(await readFile(join(h.dir, '.agents/TASKS-archive.md'), 'utf8'), /T1/)
    assert.doesNotMatch(await h.call('peer_tasks', {}), /T1/)
  } finally { await h.cleanup() }
})

test('任务库：/relay task import --force 覆盖并备份、/relay task export 重导出快照', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    const board = join(h.dir, '.agents/TASKS.md')
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(board, '| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |\n|---|---|---|---|---|---|\n| T1 | P1 | 原始任务 | a | 否 | 待认领 |\n')
    assert.match(await h.call('peer_tasks', {}), /T1/)
    // 手改导出快照不会自动回读
    await writeFile(board, '| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |\n|---|---|---|---|---|---|\n| T2 | P1 | 手改的任务 | b | 否 | 待认领 |\n')
    const plain = (await h.run('task import')).text
    assert.match(plain, /--force/)
    assert.doesNotMatch(await h.call('peer_tasks', {}), /T2/)

    // --force 明确覆盖，覆盖前备份旧任务库
    const forced = (await h.run('task import --force')).text
    assert.match(forced, /已从 .*TASKS\.md 重新导入任务库/)
    assert.match(forced, /现有任务 1 个/)
    assert.match(await h.call('peer_tasks', {}), /T2/)
    const storeAgents = join(h.dir, 'tasks', h.relay.groupKeyOf(h.caller.id), '.agents')
    const stamps = await readdir(join(storeAgents, 'backups/import'))
    assert.equal(stamps.length, 1)
    assert.match(await readFile(join(storeAgents, 'backups/import', stamps[0], 'TASKS.md'), 'utf8'), /T1/)

    // 导出：把任务库重新写回工作区快照（手写坏也能恢复）
    await writeFile(board, 'not a board')
    const exported = (await h.run('task export')).text
    assert.match(exported, /已导出任务库快照/)
    const restored = await readFile(board, 'utf8')
    assert.match(restored, /T2/)
    assert.doesNotMatch(restored, /not a board/)
  } finally { await h.cleanup() }
})

test('任务库：超过 taskStoreMaxActive 时先把最老的终态任务归档，未到 7 天也归档', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    const board = join(h.dir, '.agents/TASKS.md')
    for (const id of ['T1', 'T2']) await mkdir(join(h.dir, '.agents/claims', id), { recursive: true })
    await writeFile(board, ['| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |', '|---|---|---|---|---|---|',
      '| T1 | P1 | 一 | a | 否 | 已合入（build1） |', '| T2 | P2 | 二 | b | 否 | 已合入（build2） |', '| T3 | P1 | 三 | c | 否 | 待认领 |', ''].join('\n'))
    const old = new Date(Date.now() - 3600_000)
    const older = new Date(Date.now() - 7200_000)
    for (const [id, sha, at] of [['T1', 'aaa11111', older], ['T2', 'bbb22222', old]]) {
      const done = join(h.dir, '.agents/claims', id, 'done')
      await writeFile(done, `${sha} 可合并（基于 build9）\n`)
      await utimes(done, at, at)
    }
    h.relay.taskStoreMaxActive = 2
    h.relay.taskArchiveMaxBytes = 8 * 1024 * 1024
    assert.match(await h.call('peer_tasks', {}), /T1/) // 首次查询导入任务库
    const swept = await h.relay.taskArchiveSweep()
    assert.deepEqual(swept.archived, ['T1'], '只归档最老的终态任务，刚好降到上限')
    const exported = await readFile(board, 'utf8')
    assert.doesNotMatch(exported, /\| T1 \|/)
    assert.match(exported, /\| T2 \|/)
    assert.match(exported, /\| T3 \|/)
  } finally { await h.cleanup() }
})

test('看板快照：lightweight 先给核心字段，完整快照再补声明/任务区', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    const light = await h.relay.board(undefined, { session: h.caller.id, lightweight: true })
    assert.equal(light.partial, true)
    assert.ok(Array.isArray(light.entries))
    assert.equal(light.declarations, null)
    assert.equal(light.taskBoard, null)
    assert.equal(light.setup, null)
    const full = await h.relay.board(undefined, { session: h.caller.id })
    assert.equal(full.partial, false)
    assert.ok(Array.isArray(full.entries))
  } finally { await h.cleanup() }
})

test('tasksPanel：面板任务状态返回结构化分组，不含 <task-status> 原始文本', async () => {
  const h = await setup()
  try {
    await taskFixture(h.dir)
    const panel = await h.relay.tasksPanel(h.caller.id)
    assert.ok(panel.total > 0)
    assert.ok(Array.isArray(panel.groups) && panel.groups.length > 0)
    assert.ok(panel.groups.every((group) => typeof group.label === 'string' && Array.isArray(group.items) && group.items.length > 0))
    assert.ok(!JSON.stringify(panel).includes('<task-status'))
  } finally { await h.cleanup() }
})

test('任务树：split 父子/串行依赖、dispatch dry_run、子任务完成后父任务自动完成', async () => {
  const h = await setup()
  try {
    const { perform } = await import('../lib/settings-route.js')
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |\n|---|---|---|---|---|---|\n| T1 | P1 | 父任务 | a | 否 | 待认领 |\n| T10 | P1 | 待拆分 | a | 否 | 待认领 |\n')
    // 动态页「拆分子任务」表单走用户路由，直接建 T10.1 / T10.2
    const viaRoute = await perform(h.relay, { action: 'task-split', fromSession: h.caller.id, task: 'T10', subtasks: ['甲', '乙'], serial: false })
    assert.match(viaRoute.result.text, /T10\.1、T10\.2/)
    const t10 = viaRoute.board.taskBoard.map.find((group) => group.id === 'T10')
    assert.ok(t10 !== undefined, '地图里能看到拆分后的父任务')
    assert.deepEqual(t10.children.map((row) => row.id), ['T10.1', 'T10.2'])
    const split = await h.call('peer_task', { action: 'split', id: 'T1', subtasks: ['子一', '子二'], serial: true })
    assert.match(split, /T1\.1、T1\.2/)
    const board = () => readFile(join(h.dir, '.agents/TASKS.md'), 'utf8')
    assert.match(await board(), /T1\.1/)
    assert.match(await board(), /T1\.2/)
    const plan = await h.call('peer_task', { action: 'dispatch', id: 'T1', dry_run: true })
    assert.match(plan, /T1\.1/)
    assert.doesNotMatch(plan, /- T1\.2 →/)
    const viaCommand = await h.run('task dispatch T1 --dry-run')
    assert.equal(viaCommand.kind, 'success')
    assert.match(viaCommand.text, /T1\.1/)
    // 两个子任务都放弃后，父任务自动完成。
    for (const id of ['T1.1', 'T1.2']) {
      assert.match(await h.call('peer_task', { action: 'claim', id }, h.peer), /已认领/)
      assert.match(await h.call('peer_task', { action: 'abandon', id, text: '测试放弃' }, h.peer), /已放弃/)
    }
    assert.match(await board(), /已合入（子任务全部完成）/)
  } finally { await h.cleanup() }
})

test('任务派发：dispatch spawn 拉起新会话并带任务指令', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |\n|---|---|---|---|---|---|\n| T8 | P1 | 独立任务 | a | 否 | 待认领 |\n')
    const before = new Set(h.agents.keys())
    const out = await h.call('peer_task', { action: 'dispatch', mode: 'spawn', limit: 1 })
    assert.match(out, /拉起新会话 1/)
    const created = [...h.agents.keys()].find((id) => !before.has(id))
    assert.ok(created !== undefined)
    const text = h.agents.get(created).inbox[0][1].content[0].text
    assert.match(text, /T8/)
    assert.match(text, /认领/)
  } finally { await h.cleanup() }
})

test('子代理通讯：树内经根会话转交；对外署名根会话、回复落根；别人的子代理经其根转交；特权不继承、认领记在根会话；树内限流', async () => {
  const h = await setup()
  try {
    const sibling = h.makeAgent('ffffffff-0000-0000-0000-000000000006', { cwd: h.dir, depth: 1, status: 'running' })
    h.agents.set(sibling.id, sibling)
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    const texts = (agent) => agent.inbox.map(([mode, message]) => ({ mode, text: message.content[0].text, source: message.source }))

    const tree = await h.call('peer_list', {}, h.child)
    assert.match(tree, /<session-tree root="aaaaaaaa-/)
    assert.match(tree, /- cccccccc.*你自己/)
    assert.match(tree, /- ffffffff.*运行中/)
    assert.match(tree, /交给根会话.*send_message/)

    // 树内：DSH 不让插件打开子代理，交给根会话转（根会话空闲就唤醒它来转）
    assert.match(await h.call('peer_send', { target: 'ffffffff', message: '我这边接口改名了' }, h.child), /根会话 aaaaaaaa.*转交子代理 ffffffff/)
    const got = texts(h.caller).at(-1)
    assert.equal(got.mode, 'followup')
    assert.match(got.text, /【请转给你的子代理 ffffffff[^】]*】.*子代理 cccccccc.*agent_id ffffffff-0000/s)
    assert.match(got.text, /我这边接口改名了/)
    assert.match(got.text, /要回它就用 send_message（agent_id cccccccc-/)
    assert.match(got.text, /^\[来自本会话树里的 .*子代理 cccccccc/)
    assert.equal(got.source.senderSessionId, h.child.id)
    assert.equal(texts(sibling).length, 0)
    await assert.rejects(h.call('peer_send', { target: 'cccccccc', message: 'x' }, h.child), /不能发给自己/)
    await assert.rejects(h.call('peer_send', { target: 'ffffffff', message: 'x' }), /你自己的子代理 ffffffff.*send_message/)

    // 对外：署名「根会话的子代理」，来源记根会话，回复提示指向根
    await h.call('peer_send', { target: 'bbbbbbbb', message: '请看下 T3' }, h.child)
    const out = texts(h.peer).at(-1)
    assert.match(out.text, /来自平级会话 aaaaaaaa.* 的子代理 cccccccc/)
    assert.match(out.text, /peer_send 发给 aaaaaaaa.*回复落在它的根会话/)
    assert.equal(out.source.senderSessionId, h.caller.id)
    await assert.rejects(h.call('peer_send', { target: h.caller.id, message: 'x' }, h.child), /直接作为最终回复/)

    // 别人的子代理：交给它的根会话转交
    const via = await h.call('peer_send', { target: 'cccccccc', message: '给你的子代理' }, h.peer)
    assert.match(via, /转交子代理 cccccccc/)
    assert.match(texts(h.caller).at(-1).text, /【转交给你的子代理 cccccccc/)
    assert.equal(texts(h.child).length, 0)

    // 汇报：根是主会话时拒绝；否则记在根会话条目上
    await h.run('main here')
    await assert.rejects(h.call('peer_report', { status: 'working', summary: 'x' }, h.child), /根会话就是主会话/)
    await h.run('main here', h.peer)
    await h.call('peer_report', { status: 'working', summary: '跑完一半' }, h.child)
    let rootEntry = h.relay.coord.snapshot().board[h.caller.id]
    assert.equal(rootEntry.status, 'working')
    assert.equal(rootEntry.summary, undefined, '子代理摘要不写进父会话自己的摘要')
    assert.equal(rootEntry.subagents[h.child.id].summary, '跑完一半')
    // 回归：子代理报「已完成」不能让父会话显示已完成，也不默认唤醒主会话
    await h.call('peer_report', { status: 'working', summary: '父会话在发版' })
    const peerInbox = h.peer.inbox.length
    const reply = await h.call('peer_report', { status: 'done', summary: '子任务做完' }, h.child)
    assert.match(reply, /父会话自己的状态仍是「进行中」/)
    rootEntry = h.relay.coord.snapshot().board[h.caller.id]
    assert.equal(rootEntry.status, 'working')
    assert.equal(rootEntry.summary, '父会话在发版')
    assert.equal(rootEntry.subagents[h.child.id].status, 'done')
    assert.match(h.contextFor(h.peer), /父会话在发版[\s\S]*↳ 子代理 cccccccc（不是本会话自己的状态）· 已完成/)
    await h.relay.batcher.flushAll?.()
    assert.equal(h.peer.inbox.length, peerInbox, '子代理完成不唤醒主会话')
    // 子代理提问照常唤醒，并标明是子代理
    await h.call('peer_report', { status: 'question', summary: '要不要改接口', question: '改 A 还是 B' }, h.child)
    assert.equal(h.relay.coord.snapshot().board[h.caller.id].status, 'working')
    // 1.0.1 之前被子代理改写的旧条目：载入时挪进 subagents，父会话回到进行中
    const { migrateSubagentEntry } = await import('../lib/core.js')
    const migrated = migrateSubagentEntry({ status: 'done', summary: '［子代理 bb04cc9f］完成模块调查', branch: 'feat/x', reportedAt: 5, updatedAt: 6 })
    assert.equal(migrated.status, 'working')
    assert.equal(migrated.summary, undefined)
    assert.equal(migrated.branch, 'feat/x')
    assert.deepEqual(migrated.subagents.bb04cc9f, { status: 'done', summary: '完成模块调查', reportedAt: 5 })
    const untouched = { status: 'done', summary: '父会话自己做完' }
    assert.equal(migrateSubagentEntry(untouched), untouched)
    const { CoordStore } = await import('../lib/core.js')
    const legacyPath = join(h.dir, 'legacy-coord.json')
    await writeFile(legacyPath, JSON.stringify({ version: 2, board: { 'session-x': { status: 'done', summary: '［子代理 bb04cc9f］完成', updatedAt: Date.now() } }, links: {}, groups: {} }))
    const legacy = new CoordStore(legacyPath)
    await legacy.load()
    assert.equal(legacy.state.board['session-x']?.status, 'working')
    assert.equal(legacy.state.board['session-x']?.subagents?.bb04cc9f?.status, 'done')
    const { frameReportBatch } = await import('../lib/core.js')
    const framed = frameReportBatch({ reports: [{ sessionId: h.caller.id, subagentId: h.child.id, parentStatus: 'working', label: '@a', status: 'done', summary: 'x' }], hop: 1, maxHops: 3 })
    assert.match(framed, /子代理 cccccccc（父会话 @a.*子代理已完成；父会话自己的状态不变（进行中）/)

    // 认领记在根会话；子代理不继承主会话特权
    await h.run('main here')
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 任务 | 状态 |\n|---|---|---|\n| T1 | 一 | 待认领 |\n| T2 | 二 | 待认领 |\n')
    assert.match(await h.call('peer_task', { action: 'claim', id: 'T1' }, h.child), /已认领 T1/)
    assert.match(await readFile(join(h.dir, '.agents/claims/T1/owner'), 'utf8'), new RegExp(`^${h.caller.id}\\n`))
    await h.call('peer_task', { action: 'claim', id: 'T2' }, h.peer)
    await assert.rejects(h.call('peer_task', { action: 'update', id: 'T2', priority: 'P0' }, h.child), /持有者是/)
    assert.match(await h.call('peer_task', { action: 'update', id: 'T2', priority: 'P0' }), /已更新 T2/) // 根会话（主会话）本身可以
    const preview = await h.call('peer_tasks', { archive: 'preview' }, h.child)
    assert.equal(typeof preview, 'string')
    await assert.rejects(h.call('peer_tasks', { archive: 'apply', plan_id: 'aaaaaaaaaaaa' }, h.child), /子代理不能执行归档/)
    await assert.rejects(h.call('peer_spawn', { task: 'x' }, h.child), /只给根会话用/)

    // 树内限流按整棵树记
    h.relay.guard.limits.tree = [2, 600_000, '在会话树内互发']
    h.relay.guard.books.tree.clear()
    await h.call('peer_send', { target: 'ffffffff', message: '1' }, h.child)
    await h.call('peer_send', { target: 'cccccccc', message: '2' }, sibling)
    await assert.rejects(h.call('peer_send', { target: 'ffffffff', message: '3' }, h.child), /本会话树 10 分钟内已在会话树内互发 2 次/)
  } finally { await h.cleanup() }
})

// ------------------------------------------------------------ 0.18：初始化、常设授权、向用户提问、无人值守唤醒预算

test('初始化：面板 setup 标出缺的项；/relay task init 建出可解析的看板，已有时拒绝；模型不能建；没有看板的报错指向建法', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    let board = await h.relay.board(undefined, { session: h.caller.id })
    assert.deepEqual(board.setup, { hasMain: false, hasLine: false, hasTaskBoard: false, isGitRepo: false, root: h.dir })
    // 没有看板：模型与用户的报错都说明可以从面板或 /relay task init 建
    await assert.rejects(h.call('peer_tasks', {}), /初始化.*建任务看板.*\/relay task init/)
    await assert.rejects(h.call('peer_task', { action: 'claim', id: 'T1' }), (error) => error.code === 'no_task_board' && /\/relay task init/.test(error.message))
    // 模型没有建看板的动作
    await assert.rejects(h.call('peer_task', { action: 'init' }), /must be one of/)
    assert.ok(![...h.tools.keys()].some((name) => /init|deleg/.test(name)))
    const done = await h.run('task init')
    assert.equal(done.kind, 'success', done.text)
    const text = await readFile(join(h.dir, '.agents/TASKS.md'), 'utf8')
    assert.match(text, /^## 认领规则$/m)
    assert.deepEqual(parseTaskDoc(text).rows, [])
    assert.ok((await readdir(join(h.dir, '.agents'))).includes('claims'))
    // 缓存已失效：面板和上下文马上看到
    board = await h.relay.board(undefined, { session: h.caller.id })
    assert.equal(board.setup.hasTaskBoard, true)
    assert.equal(board.taskBoard.open.length, 0)
    assert.match(h.contextFor(h.caller), /<task-board path="[^"]*TASKS\.md">/)
    // 已有：拒绝（命令与面板）
    assert.match((await h.run('task init')).text, /已经有任务看板/)
    const { perform } = await import('../lib/settings-route.js')
    await assert.rejects(perform(h.relay, { action: 'task-init', fromSession: h.caller.id }), (error) => error.code === 'board_exists')
    // 建好的看板能直接登记任务
    assert.match(await h.call('peer_task', { action: 'new', title: '第一个任务', detail: '用户要求' }), /已登记 T1/)
    // 其余几项：git、主会话、版本线
    await mkdir(join(h.dir, '.git'))
    await h.run('main here')
    await h.run('line main=abc1234')
    board = await h.relay.board(undefined, { session: h.caller.id })
    assert.deepEqual(board.setup, { hasMain: true, hasLine: true, hasTaskBoard: true, isGitRepo: true, root: h.dir })
  } finally { await h.cleanup() }
})

test('常设授权：只由用户设 / 看 / 清；只进主会话上下文，正文原样；没设时只有一句固定提示', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    assert.match((await h.run('delegate')).text, /还没有常设授权[\s\S]*重跑不稳定的测试/)
    const unset = h.contextFor(h.caller)
    assert.match(unset, /peer_ask_user/)
    assert.doesNotMatch(unset, /Standing delegation/)
    assert.equal(h.contextFor(h.caller), unset, '没变化时上下文稳定')
    assert.equal((await h.run('delegate 重跑不稳定的 CI、排合并队列可以自己定')).kind, 'success')
    const set = h.contextFor(h.caller)
    assert.match(set, /Standing delegation \(set by the user\): "重跑不稳定的 CI、排合并队列可以自己定"\. Decide these yourself without waiting; anything else that needs the user: peer_ask_user\./)
    assert.match(set, /Push, merge, release, delete, install or phone actions still need explicit user approval/)
    assert.equal(h.relay.coord.group('ws-1').delegation.text, '重跑不稳定的 CI、排合并队列可以自己定')
    // 工作会话、旁观会话看不到
    await h.call('peer_report', { status: 'working', summary: 'x' }, h.peer)
    assert.doesNotMatch(h.contextFor(h.peer), /Standing delegation|排合并队列/)
    assert.match((await h.run('delegate')).text, /由你设定[\s\S]*排合并队列/)
    // 面板：数据与设置 / 清除
    const { perform } = await import('../lib/settings-route.js')
    let out = await perform(h.relay, { action: 'delegate', fromSession: h.caller.id, text: '只许排号' })
    assert.equal(out.board.delegation.text, '只许排号')
    assert.match(out.board.delegationDefault, /推送、合并到 main/)
    await assert.rejects(perform(h.relay, { action: 'delegate', fromSession: h.caller.id, text: 'x'.repeat(601) }), /600/)
    out = await perform(h.relay, { action: 'delegate-clear', fromSession: h.caller.id })
    assert.equal(out.board.delegation, null)
    assert.equal((await h.run('delegate clear')).kind, 'error')
    // 持久：重新加载后仍在
    await h.run('delegate 能自己定的事')
    await h.relay.coord.load()
    assert.equal(h.relay.coord.group('ws-1').delegation.text, '能自己定的事')
  } finally { await h.cleanup() }
})

test('peer_ask_user：只给主会话根会话；去重、上限校验；面板选择以用户身份（hop 0）送到主会话并清掉；忽略', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await assert.rejects(h.call('peer_ask_user', { question: '选哪个', options: ['A', 'B'] }), (error) => error.code === 'not_coordinator')
    await h.run('main here')
    await assert.rejects(h.call('peer_ask_user', { question: '选哪个', options: ['A', 'B'] }, h.peer), (error) => error.code === 'not_coordinator')
    await assert.rejects(h.call('peer_ask_user', { question: '选哪个', options: ['A', 'B'] }, h.child), /只给根会话用/)
    await assert.rejects(h.call('peer_ask_user', { question: '选哪个', options: ['A'] }), /2–3/)
    await assert.rejects(h.call('peer_ask_user', { question: '选哪个', options: ['A', 'x'.repeat(41)] }), /40/)
    await assert.rejects(h.call('peer_ask_user', { question: 'q'.repeat(301), options: ['A', 'B'] }), /300/)
    const first = await h.call('peer_ask_user', { question: 'build281 给谁', options: ['lint', 'adb'], about: h.peer.id.slice(0, 8) })
    assert.match(first, /并发了手机通知/)
    assert.match(first, /不要轮询/)
    assert.equal(h.notified.filter(([title]) => title === '主会话等你决定').length, 1)
    assert.match(h.notified.at(-1)[1], /build281 给谁（lint \/ adb）/)
    assert.match(await h.call('peer_ask_user', { question: 'build281 给谁', options: ['lint', 'adb'] }), /已经在等/)
    assert.equal(h.notified.filter(([title]) => title === '主会话等你决定').length, 1, '同一问题不重复通知')
    assert.match(h.contextFor(h.caller), /Waiting for the user on 1 peer_ask_user question/)
    assert.ok(h.relay.marks().attention >= 1, '侧栏角标算上待决定的问题')
    let board = await h.relay.board(undefined, { session: h.caller.id })
    assert.equal(board.asks.length, 1)
    const ask = board.asks[0]
    assert.equal(ask.about, h.peer.id)
    // 面板选择：用户来源、hop 0、发给主会话（不直接发给 about 的工作会话）
    const peerInbox = h.peer.inbox.length
    const { perform } = await import('../lib/settings-route.js')
    await assert.rejects(perform(h.relay, { action: 'ask-answer', fromSession: h.caller.id, id: ask.id, option: 'nope' }), (error) => error.code === 'bad_option')
    const out = await perform(h.relay, { action: 'ask-answer', fromSession: h.caller.id, id: ask.id, option: 'adb' })
    assert.equal(out.result.sessionId, h.caller.id)
    const [mode, message] = h.caller.inbox.at(-1)
    assert.equal(mode, 'followup')
    assert.deepEqual(message.source, { kind: 'user' })
    assert.equal(message.content[0].text, '[用户在面板选择] build281 给谁 → adb')
    const { hopOfMessage } = await import('../lib/core.js')
    assert.equal(hopOfMessage(message), 0)
    assert.equal(h.peer.inbox.length, peerInbox)
    assert.equal(out.board.asks.length, 0)
    assert.doesNotMatch(h.contextFor(h.caller), /Waiting for the user/)
    await assert.rejects(perform(h.relay, { action: 'ask-answer', fromSession: h.caller.id, id: ask.id, option: 'adb' }), (error) => error.code === 'ask_ended')
    // 用户回答不占唤醒名额
    assert.equal(h.relay.wakeView('ws-1').wakesThisHour, 0)
    // 忽略
    await h.call('peer_ask_user', { question: '要不要发版', options: ['发', '不发', '再等等'] })
    const second = (await h.relay.board(undefined, { session: h.caller.id })).asks[0]
    const dismissed = await perform(h.relay, { action: 'ask-dismiss', fromSession: h.caller.id, id: second.id })
    assert.equal(dismissed.board.asks.length, 0)
    // 通知失败不抛给模型
    h.relay.notify = async () => { throw new Error('bridge down') }
    assert.match(await h.call('peer_ask_user', { question: '第三个', options: ['是', '否'] }), /通知未送达/)
  } finally { await h.cleanup() }
})

test('peer_ask_user action=withdraw：主会话撤回过时的问题；不写 id 列出待答；只有主会话能撤；撤回后不能再答', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await h.call('peer_ask_user', { question: '推 tag 吗', options: ['推', '不推'] })
    const ask = (await h.relay.board(undefined, { session: h.caller.id })).asks[0]
    assert.match(h.contextFor(h.caller), /action=withdraw/)
    assert.match(await h.call('peer_ask_user', { action: 'withdraw' }), new RegExp(`${ask.id}：推 tag 吗`))
    await assert.rejects(h.call('peer_ask_user', { action: 'withdraw', id: ask.id }, h.peer), (error) => error.code === 'not_coordinator')
    assert.match(await h.call('peer_ask_user', { action: 'withdraw', id: ask.id }), /已撤回/)
    assert.equal((await h.relay.board(undefined, { session: h.caller.id })).asks.length, 0)
    assert.doesNotMatch(h.contextFor(h.caller), /Waiting for the user/)
    await assert.rejects(h.call('peer_ask_user', { action: 'withdraw', id: ask.id }), /已被主会话撤回/)
    const { perform } = await import('../lib/settings-route.js')
    await assert.rejects(perform(h.relay, { action: 'ask-answer', fromSession: h.caller.id, id: ask.id, option: '推' }), /已被主会话撤回/)
    assert.match(await h.call('peer_ask_user', { action: 'withdraw' }), /没有在等/)
    await assert.rejects(h.call('peer_ask_user', { question: '只有问题' }), /需要 question 和 options/)
    // 重新加载后状态还在
    const { AwayStore } = await import('../lib/away.js')
    const reloaded = new AwayStore(h.relay.away.path)
    await h.relay.away.chain
    await reloaded.load()
    assert.equal(reloaded.find('ws-1', ask.id).state, 'withdrawn')
  } finally { await h.cleanup() }
})

test('开发者模式：用户限时打开后模型可只读查看别的工作区并记审计；写操作边界不变；到期自动关', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    const outsider = h.makeAgent('99999999-0000-0000-0000-000000000009', { cwd: '/z' })
    h.agents.set(outsider.id, outsider)
    h.workspaces.push({ id: 'ws-b', title: 'B', path: '/z', sessionIds: [outsider.id] })
    h.services.sessionQuery = {
      readSession: async (id) => ({ session: { id, cwd: h.dir }, events: sampleEvents() }),
      readSurface: async () => ({ events: sampleEvents() })
    }
    await h.run('main here')
    await assert.rejects(h.call('peer_inspect', { session: outsider.id }), /开发者模式/)
    await assert.rejects(h.call('peer_inspect', { query: 'EMPTY', scope: 'all' }), /开发者模式/)
    assert.doesNotMatch(h.contextFor(h.caller), /dev-mode/)
    assert.match((await h.run('dev')).text, /关闭/)
    assert.match((await h.run('dev on 30')).text, /0–24 小时/)
    const { perform } = await import('../lib/settings-route.js')
    const on = await perform(h.relay, { action: 'dev-mode', fromSession: h.caller.id, enabled: true, hours: 1 })
    assert.equal(on.board.devMode.enabled, true)
    assert.match(h.contextFor(h.caller), /<dev-mode until=/)
    assert.match(await h.call('peer_inspect', { session: outsider.id }), /出错 EMPTY_RESPONSE/)
    assert.match(await h.call('peer_inspect', { query: 'EMPTY', scope: 'all' }), /个会话/)
    assert.match(await h.call('peer_inspect', { session: outsider.id, view: 'digest' }), /另一个工作区（B）/)
    // 写操作仍限本工作区
    await assert.rejects(h.call('peer_assign', { target: outsider.id, value: 'build1' }), (error) => error.code === 'outside_workspace')
    await h.relay.devMode.chain
    const audit = (await readFile(h.relay.devMode.auditPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(audit.map((item) => item.event), ['enable', 'read', 'search', 'read'])
    assert.equal(audit[1].target, outsider.id)
    // 到期即关
    h.relay.devMode.now = () => Date.now() + 2 * 3600_000
    assert.equal(h.relay.devMode.active(), false)
    await assert.rejects(h.call('peer_inspect', { session: outsider.id }), /不在本工作区/)
    h.relay.devMode.now = Date.now
    assert.match((await h.run('dev off')).text, /关闭/)
    assert.equal(h.relay.devMode.active(), false)
  } finally { await h.cleanup() }
})

test('无人值守唤醒预算：只算模型唤醒空闲会话；到上限改放收件箱并只通知一次；用户投递不受影响；继续后重新计数', async () => {
  const h = await setup()
  try {
    const w = h.makeAgent('99999999-0000-0000-0000-000000000009', { cwd: h.dir })
    h.agents.set(w.id, w)
    h.workspaces.push({ id: 'ws-1', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id, w.id] })
    await h.run('main here')
    h.relay.wakeLimit = 2
    h.listeners['session/event'](w.session, { type: 'assistant/message', data: { message: { content: [] }, usage: { totalTokens: 5000 } } })
    // 正在运行的会话：不算唤醒
    await h.call('peer_send', { target: h.peer.id.slice(0, 8), message: '插一句' })
    // 用户 /relay 不算
    await h.run(`${w.id.slice(0, 8)} 用户说的`)
    assert.equal(h.relay.wakeView('ws-1').wakesThisHour, 0)
    await h.call('peer_send', { target: w.id.slice(0, 8), message: '一' })
    await h.call('peer_send', { target: w.id.slice(0, 8), message: '二', mode: 'queue' })
    await h.call('peer_send', { target: w.id.slice(0, 8), message: '三' })
    let view = h.relay.wakeView('ws-1')
    assert.equal(view.wakesThisHour, 2, 'queue 不算唤醒')
    assert.equal(view.approxTokensThisHour, 10000)
    assert.equal(view.paused, false)
    // 第三次唤醒：改放收件箱，告诉模型别重试，发一次通知
    const out = await h.call('peer_send', { target: w.id.slice(0, 8), message: '四' })
    assert.match(out, /收件箱.*没有唤醒.*不要重试/)
    assert.equal(w.inbox.at(-1)[0], 'queue')
    assert.equal(h.relay.wakeView('ws-1').paused, true)
    await h.call('peer_send', { target: w.id.slice(0, 8), message: '五' })
    assert.equal(w.inbox.at(-1)[0], 'queue')
    const pauses = h.notified.filter(([title]) => title === '自动唤醒已暂停')
    assert.equal(pauses.length, 1)
    assert.match(pauses[0][1], /本小时自动唤醒已达 2 次，已暂停；面板可继续/)
    assert.match(h.contextFor(h.caller), /Unattended wake budget for this hour is used up/)
    // 用户投递照常唤醒
    await h.run(`${w.id.slice(0, 8)} 用户继续`)
    assert.equal(w.inbox.at(-1)[0], 'followup')
    // 新建会话：直接拒绝，不建
    const before = h.agents.size
    await assert.rejects(h.call('peer_spawn', { task: '新活' }), (error) => error.code === 'wake_budget' && /不要重试/.test(error.message))
    // 插件核验 / 推送链通知（origin 'plugin'）暂停时也照常唤醒，不计数
    assert.equal(h.relay.away.isPaused(h.relay.groupKeyOf(h.peer.id)), true)
    const sent = await h.relay.deliver(h.peer.id, { content: [{ type: 'text', text: 'CI 完成' }], source: { kind: 'agent' } }, 'auto', { origin: 'plugin' })
    assert.equal(sent.budgetQueued, undefined, '插件通知暂停时也照常投递')
    assert.equal(h.agents.size, before)
    // 面板数据与继续
    const { perform } = await import('../lib/settings-route.js')
    const board = await h.relay.board(undefined, { session: h.caller.id })
    assert.deepEqual(Object.keys(board.unattended).sort(), ['approxTokensThisHour', 'limit', 'paused', 'pausedAt', 'wakesThisHour'])
    assert.equal(board.unattended.limit, 2)
    const resumed = await perform(h.relay, { action: 'unattended-resume', fromSession: h.caller.id })
    assert.equal(resumed.board.unattended.paused, false)
    assert.equal(resumed.board.unattended.wakesThisHour, 0)
    assert.doesNotMatch(h.contextFor(h.caller), /Unattended wake budget/)
    await h.call('peer_send', { target: w.id.slice(0, 8), message: '六' })
    assert.equal(w.inbox.at(-1)[0], 'followup')
    assert.match((await h.run('wakes')).text, /1\/2 次/)
    // 持久：重新读文件计数还在
    await h.relay.away.chain
    await h.relay.away.load()
    assert.equal(h.relay.wakeView('ws-1').wakesThisHour, 1)
    // 0 = 不限
    h.relay.wakeLimit = 0
    for (let i = 0; i < 4; i += 1) await h.call('peer_send', { target: w.id.slice(0, 8), message: `x${i}` })
    assert.equal(w.inbox.at(-1)[0], 'followup')
    assert.equal(h.relay.wakeView('ws-1').paused, false)
  } finally { await h.cleanup() }
})

test('主会话跳数上限默认 24，普通上限仍是 3', async () => {
  const { RelayGuard } = await import('../lib/core.js')
  const guard = new RelayGuard()
  assert.equal(guard.coordinatorMaxHops, 24)
  assert.equal(guard.maxHops, 3)
})

test('自动置顶按面板分类：已合入的可合并、久未活动的进行中被撤；还在做的、待答复的保留', async () => {
  const h = await setup()
  try {
    const ids = ['a1', 'a2', 'a3', 'a4'].map((tag, index) => h.makeAgent(`${tag}a1a1a1-0000-0000-0000-00000000001${index}`, { cwd: h.dir }))
    const [merged, idle, active, asking] = ids
    for (const agent of ids) h.agents.set(agent.id, agent)
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, ...ids.map((agent) => agent.id)] })
    const registry = h.relay.ctx.workspaceRegistry
    registry.pinnedSessionIds = []
    registry.pinSession = async (id) => { if (!registry.pinnedSessionIds.includes(id)) registry.pinnedSessionIds = [id, ...registry.pinnedSessionIds] }
    registry.unpinSession = async (id) => { registry.pinnedSessionIds = registry.pinnedSessionIds.filter((item) => item !== id) }
    await h.run('main here')
    await h.call('peer_report', { status: 'ready', summary: '可合并', commit: 'abc1234' }, merged)
    await h.call('peer_report', { status: 'working', summary: '做着' }, idle)
    await h.call('peer_report', { status: 'working', summary: '做着' }, active)
    await h.call('peer_report', { status: 'question', summary: '问一下', question: 'A 还是 B' }, asking)
    // 不让后台 git 核对覆盖测试设的事实
    h.relay.mainMergedAt.set('ws-a', Date.now())
    h.relay.mainMergedCache.set('ws-a', new Map())
    assert.equal((await h.run('pin on')).kind, 'success')
    for (const agent of ids) assert.ok(registry.pinnedSessionIds.includes(agent.id), agent.id)
    // 提交已在 main；另一个 7 小时没动静
    h.relay.mainMergedCache.set('ws-a', new Map([[merged.id, { kind: 'merged', where: 'main abc1234' }]]))
    await h.relay.coord.upsert(idle.id, { reportedAt: Date.now() - 7 * 3600_000 })
    await h.relay.autoPin.sync()
    assert.ok(!registry.pinnedSessionIds.includes(merged.id), '已合入的撤掉')
    assert.ok(!registry.pinnedSessionIds.includes(idle.id), '久未活动的撤掉')
    assert.ok(registry.pinnedSessionIds.includes(active.id))
    assert.ok(registry.pinnedSessionIds.includes(asking.id))
  } finally { await h.cleanup() }
})

/** 仿 DSH：selectModel 记会话选择并在后台把它存成全局默认；默认模型保存按提交顺序串行。 */
function fakeModels(h, { initial = { provider: 'p1', model: 'base' } } = {}) {
  let current = { ...initial }
  let saves = Promise.resolve()
  const defaults = {
    currentSelection: () => ({ ...current }),
    saveSelection: (next) => {
      const done = saves.then(() => new Promise((resolve) => setTimeout(() => { current = { ...next }; resolve() }, 5)))
      saves = done.catch(() => {})
      return done
    }
  }
  h.services.agentDefaultModel = defaults
  const selected = []
  const controller = h.relay.ctx.sessionController
  controller.modelCatalog = async () => ({
    default: defaults.currentSelection(),
    groups: [
      { id: 'p1', name: 'P1', models: [{ id: 'base', name: 'Base' }, { id: 'big', name: 'Big', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }] },
      { id: 'p2', name: 'P2', models: [{ id: 'fast', name: 'Fast' }] }
    ],
    failures: []
  })
  controller.selectModel = async ({ sessionId, provider, model, reasoningEffort }) => {
    const pick = { provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) }
    selected.push([sessionId, pick])
    h.agents.get(sessionId)?.session.snapshotEvents().push({ type: 'model/selection', data: pick })
    void defaults.saveSelection(pick)
    return { selected: pick }
  }
  return { defaults, selected, flush: () => saves }
}

test('新建会话指定模型：角色模型、--model、全局默认保持不变；模型调 peer_spawn 固定用工作会话模型', async () => {
  const h = await setup()
  try {
    const m = fakeModels(h)
    h.workspaces.push({ id: 'ws-1', title: 'W', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    // 只有命令（用户）能设角色模型
    let res = await h.run('models worker p1/big@high')
    assert.equal(res.kind, 'success', res.text)
    assert.match(res.text, /工作会话模型已设为 p1\/big@high/)
    assert.deepEqual(h.relay.coord.group('ws-1').models.worker, { provider: 'p1', model: 'big', reasoningEffort: 'high' })
    res = await h.run('models')
    assert.match(res.text, /工作会话：p1\/big@high/)
    assert.match(res.text, /主会话：跟随默认/)
    // 写错的模型 / 强度：拒绝，不建会话
    const before = h.agents.size
    res = await h.run('new --model p1/nope 干活')
    assert.equal(res.kind, 'error')
    assert.match(res.text, /没有模型 nope/)
    res = await h.run('new --model big@ultra 干活')
    assert.match(res.text, /推理强度只能是 low \/ high/)
    assert.equal(h.agents.size, before, '没有建出会话')
    // /relay new 不写 --model：用工作会话模型；写了：用指定的（只写模型名，目录里唯一时自动补服务商）
    res = await h.run('new 干活甲')
    assert.equal(res.kind, 'success', res.text)
    assert.match(res.text, /模型：p1\/big@high（工作区角色模型）/)
    res = await h.run('new --model fast 干活乙')
    assert.match(res.text, /模型：p2\/fast（本次指定）/)
    await m.flush()
    assert.deepEqual(m.defaults.currentSelection(), { provider: 'p1', model: 'base' }, '全局默认模型没被改')
    assert.deepEqual(m.selected.map(([, pick]) => pick.model), ['big', 'fast'])
    // --model default：不调 selectModel
    res = await h.run('new --model default 干活丙')
    assert.doesNotMatch(res.text, /模型：/)
    assert.equal(m.selected.length, 2)
    // 模型调 peer_spawn：没有模型参数，固定用工作会话模型
    const spawnParams = h.tools.get('peer_spawn').parameters
    assert.ok(spawnParams !== undefined && JSON.stringify(spawnParams).includes('task'))
    assert.doesNotMatch(JSON.stringify(spawnParams), /"model"/)
    await h.call('peer_spawn', { task: '模型拉起的活' })
    assert.deepEqual(m.selected.at(-1)[1], { provider: 'p1', model: 'big', reasoningEffort: 'high' })
    // 看板卡片显示会话当前模型
    const board = await h.relay.board(undefined, { session: h.caller.id })
    const spawned = board.entries.find((entry) => entry.sessionId === m.selected[0][0])
    assert.equal(spawned.model, 'p1/big@high')
    assert.equal(board.roleModels.worker, 'p1/big@high')
    // 改回跟随默认
    res = await h.run('models worker default')
    assert.match(res.text, /改回跟随默认/)
    assert.equal(h.relay.coord.group('ws-1').models, undefined)
    await m.flush()
    assert.deepEqual(m.defaults.currentSelection(), { provider: 'p1', model: 'base' })
  } finally { await h.cleanup() }
})

test('新建会话指定模型：选的模型和全局默认是同一个、没写强度时，带上全局默认的推理强度（命令、面板、角色模型）', async () => {
  const h = await setup()
  try {
    const m = fakeModels(h, { initial: { provider: 'p1', model: 'big', reasoningEffort: 'high' } })
    h.workspaces.push({ id: 'ws-1', title: 'W', path: h.dir, sessionIds: [h.caller.id] })
    let res = await h.run('new --model p1/big 干活')
    assert.match(res.text, /模型：p1\/big@high/)
    res = await h.run('new --model p1/big@low 干活')
    assert.match(res.text, /模型：p1\/big@low/, '写了强度就照写的')
    res = await h.run('new --model p1/base 干活')
    assert.match(res.text, /模型：p1\/base（/, '不同模型不加强度')
    const opened = await h.relay.openBlank({ fromId: h.caller.id, cwd: h.dir, model: { provider: 'p1', model: 'big' } })
    assert.equal(opened.modelLabel, 'p1/big@high')
    await h.run('models worker p1/big')
    res = await h.run('new 角色模型')
    assert.match(res.text, /模型：p1\/big@high（工作区角色模型）/)
    await m.flush()
    assert.deepEqual(m.defaults.currentSelection(), { provider: 'p1', model: 'big', reasoningEffort: 'high' })
  } finally { await h.cleanup() }
})

test('新建会话指定模型：读不到默认模型服务时不调 selectModel（宁可不设，也不改全局默认）', async () => {
  const h = await setup()
  try {
    const m = fakeModels(h)
    delete h.services.agentDefaultModel
    h.workspaces.push({ id: 'ws-1', title: 'W', path: h.dir, sessionIds: [h.caller.id] })
    const res = await h.run('new --model p2/fast 干活')
    assert.equal(res.kind, 'success', res.text)
    assert.match(res.text, /没有设上指定模型：读不到 DSH 的默认模型服务/)
    assert.equal(m.selected.length, 0)
  } finally { await h.cleanup() }
})

test('接手新建：沿用原会话模型；交接新建主会话：用主会话模型；面板表单可当场改', async () => {
  const h = await setup()
  try {
    const m = fakeModels(h)
    h.workspaces.push({ id: 'ws-1', title: 'W', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await h.run('models main p1/big@low')
    await h.run('models worker p2/fast')
    // 原会话最近一次请求用的是 p1/base
    h.peer.status = 'idle'
    h.peer.session.snapshotEvents().push({ type: 'request/header', data: { header: { config: { provider: 'p1', model: 'base' } } } })
    await h.call('peer_report', { status: 'working', summary: '在做' }, h.peer)
    let done = await h.relay.takeover({ source: h.peer.id, to: 'new', fromId: h.caller.id })
    assert.equal(done.modelSource, 'inherit')
    assert.equal(done.modelLabel, 'p1/base')
    // 面板当场指定
    const third = h.agents.get(done.to)
    third.status = 'idle'
    done = await h.relay.takeover({ source: done.to, to: 'new', fromId: h.caller.id, model: { provider: 'p1', model: 'big', reasoningEffort: 'high' } })
    assert.equal(done.modelSource, 'explicit')
    assert.equal(done.modelLabel, 'p1/big@high')
    // 交接新建主会话：主会话模型
    await h.relay.saveHandoffDraft({ key: 'ws-1', notes: '交接', by: 'user', from: h.caller.id })
    const handed = await h.relay.confirmHandoff({ key: 'ws-1', to: 'new' })
    assert.equal(handed.modelSource, 'role')
    assert.equal(handed.modelLabel, 'p1/big@low')
    await m.flush()
    assert.deepEqual(m.defaults.currentSelection(), { provider: 'p1', model: 'base' })
  } finally { await h.cleanup() }
})

test('GitHub 面板动作：只走设置路由；锁定后换号拒绝登记 CI 核验、核验器也不调 gh；看板默认不带验证码', async () => {
  const h = await setup()
  try {
    const account = { value: { login: 'alice', id: 101 } }
    const ghCalls = []
    h.relay.github.gh = async (args) => {
      ghCalls.push(args)
      return { stdout: `HTTP/2.0 200 OK\r\nX-Oauth-Scopes: repo\r\n\r\n${JSON.stringify({ login: account.value.login, id: account.value.id })}`, stderr: '' }
    }
    h.relay.github.bridge = { get: async () => ({ result: '' }), post: async () => ({}), open: async () => {} }
    await h.run('main here')
    const { perform } = await import('../lib/settings-route.js')
    const refreshed = await perform(h.relay, { action: 'github-refresh', fromSession: h.caller.id })
    assert.equal(refreshed.result.github.login, 'alice')
    assert.equal(refreshed.board.github.match, 'unpinned')
    const pinned = await perform(h.relay, { action: 'github-pin', fromSession: h.caller.id })
    assert.equal(pinned.board.github.pinned.accountId, 101)
    // 补权限：路由必须认识 github-relogin，并把档位交给 startLogin（不能掉到「未知操作」）
    let started
    const realStart = h.relay.github.startLogin.bind(h.relay.github)
    h.relay.github.startLogin = async (options) => { started = options; return h.relay.github.view({ withCode: true }) }
    await perform(h.relay, { action: 'github-relogin', fromSession: h.caller.id, tier: 'repo' })
    assert.deepEqual(started, { refresh: true, tier: 'repo' })
    h.relay.github.startLogin = realStart
    // 退出后重新登录：路由要认识并转到 resetLogin
    let reset
    const realReset = h.relay.github.resetLogin.bind(h.relay.github)
    h.relay.github.resetLogin = async (options) => { reset = options; return h.relay.github.view({ withCode: true }) }
    await perform(h.relay, { action: 'github-reset-login', fromSession: h.caller.id, tier: 'all' })
    assert.deepEqual(reset, { tier: 'all' })
    h.relay.github.resetLogin = realReset
    assert.equal(JSON.parse(await readFile(join(h.dir, 'github.json'), 'utf8')).pinned.login, 'alice')
    // 换号
    account.value = { login: 'mallory', id: 666 }
    await perform(h.relay, { action: 'github-refresh', fromSession: h.caller.id })
    assert.equal(h.notified.filter(([title]) => title === 'GitHub 身份变了').length, 1)
    await assert.rejects(h.call('peer_watch', { action: 'add', kind: 'ci', run_id: '123', repo: 'o/r', cwd: h.dir }), /不是锁定的 alice/)
    const before = ghCalls.length
    await assert.rejects(h.relay.watches.checkers.ci({ runId: '1', repo: 'o/r', cwd: h.dir }, { timeout: 1000 }), (error) => error.code === 'github_mismatch')
    assert.equal(ghCalls.length, before, '只读身份，不跑 gh run view')
    // 模型能看到的看板不带验证码字段
    const board = await h.relay.board(undefined, { session: h.caller.id })
    assert.equal(board.github.match, 'mismatch')
    assert.equal(board.github.loginFlow, null)
    const { snapshot } = await import('../lib/settings-route.js')
    const settings = await snapshot(h.relay)
    assert.equal(settings.github.match, 'mismatch')
    assert.ok('userCode' in (settings.github.loginFlow ?? { userCode: null }))
    await perform(h.relay, { action: 'github-unpin', fromSession: h.caller.id })
    assert.equal(h.relay.github.pinned, null)
    await assert.rejects(perform(h.relay, { action: 'github-bogus', fromSession: h.caller.id }), /未知的 GitHub 动作|未知/)
  } finally { await h.cleanup() }
})

test('看板版本：内容不变两次版本相同，带 since 只回 notModified；有变化换版本', async () => {
  const h = await setup()
  try {
    await h.run('main here')
    const route = h.routes.find((item) => typeof item.handler === 'function' || typeof item === 'function')
    const handler = route?.handler ?? route
    const get = (query) => new Promise((resolve) => {
      const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v }, writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers ?? {}) }, end(text) { resolve(JSON.parse(text)) } }
      void handler({ method: 'GET', url: '/api/dsha-session-relay?' + query, headers: { host: 'local' } }, res)
    })
    const first = await get('view=board&session=' + h.caller.id)
    assert.equal(typeof first.version, 'string')
    assert.ok(Array.isArray(first.entries))
    const again = await get('view=board&session=' + h.caller.id + '&since=' + first.version)
    assert.deepEqual(again, { ok: true, notModified: true, version: first.version })
    await h.run('line main=abc')
    const changed = await get('view=board&session=' + h.caller.id + '&since=' + first.version)
    assert.notEqual(changed.version, first.version)
    assert.ok(Array.isArray(changed.entries))
    // 任务页只用 tasks=1 的轻量快照补任务板，不触发完整快照里的 repo/声明远端校验
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 优先 | 任务 | 状态 |\n|---|---|---|---|\n| T1 | P1 | 做点事 | 待认领 |\n')
    const light = await get('view=board&session=' + h.caller.id + '&light=1')
    assert.equal(light.partial, true)
    assert.equal(light.taskBoard, null, '默认轻量快照不带任务板')
    const lightTasks = await get('view=board&session=' + h.caller.id + '&light=1&tasks=1')
    assert.equal(lightTasks.partial, true)
    assert.equal(lightTasks.declarations, null, '带任务板也不做声明/远端校验')
    assert.ok(lightTasks.taskBoard !== null && typeof lightTasks.taskBoard === 'object', 'tasks=1 轻量快照带任务板')
  } finally { await h.cleanup() }
})

test('reload：换新的 GitHub 身份实例，旧方法不会残留（tier/refresh/reset 都在新代码里）', async () => {
  const h = await setup()
  try {
    const before = h.shell.relay.github
    assert.equal(typeof before.resetLogin, 'function')
    assert.equal(typeof before.startLogin, 'function')
    // 模拟旧实例上还挂着一个登录流程：reload 后不能把它带进新实例
    const child = { killed: false, kill() { this.killed = true } }
    before.login = { state: 'pending', child }
    const text = await h.shell.reload('test')
    assert.match(text, /重新加载/)
    const after = h.shell.relay.github
    assert.notEqual(after, before, '身份对象必须换新，不能整对象接管旧实例')
    assert.equal(typeof after.resetLogin, 'function')
    assert.equal(after.login, null, '旧登录流程被取消，不跨实例悬挂')
    assert.equal(child.killed, true)
  } finally { await h.cleanup() }
})

test('任务阶段与审批：认领自动 doing，update stage 只给主会话，审批只走用户命令', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-stage', title: 'S', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 优先 | 任务 | 状态 |\n|---|---|---|---|\n| T1 | P1 | 做点事 | 待认领 |\n')
    await h.call('peer_task', { action: 'claim', id: 'T1' })
    const found = await h.relay.taskBoardFor({ sessionId: h.caller.id })
    const state = await h.relay.ensureTaskState(found.board.storeRoot)
    assert.equal(state.get('T1').stage, 'doing', '认领自动置 doing')
    await h.call('peer_task', { action: 'update', id: 'T1', stage: 'review' })
    assert.equal(state.get('T1').stage, 'review')
    assert.equal(state.get('T1').approval, 'pending', '进 review 自动 pending')
    await assert.rejects(h.call('peer_task', { action: 'update', id: 'T1', stage: 'hold' }, h.peer), /只给用户或本工作区主会话/)
    const approved = await h.run('approve T1 看过提交了')
    assert.match(approved.text, /已记录 T1 的审批：通过/)
    assert.equal(state.get('T1').approval, 'approved')
    assert.equal(state.get('T1').approvalNote, '看过提交了')
    await h.run('reject T1 还要改')
    assert.equal(state.get('T1').stage, 'doing')
    assert.equal(state.get('T1').approval, 'rejected')
    const detail = await h.call('peer_tasks', { id: 'T1' })
    assert.match(detail, /阶段：进行中/)
    assert.match(detail, /审批：已打回/)
  } finally { await h.cleanup() }
})

test('任务 PR 只读关联：用户命令关联、缓存查看、刷新、解除；模型没有入口', async () => {
  const calls = []
  const info = {
    url: 'https://github.com/o/r/pull/7',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    reviewDecision: 'REVIEW_REQUIRED',
    mergedAt: null,
    headRefOid: 'abcdef1234567890',
    baseRefName: 'main',
    statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }]
  }
  const h = await setup({ prGh: async (args) => { calls.push(args); return { stdout: JSON.stringify(info) } } })
  try {
    h.workspaces.push({ id: 'ws-pr', title: 'PR', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 优先 | 任务 | 状态 |\n|---|---|---|---|\n| T1 | P1 | 做点事 | 待认领 |\n')
    const linked = await h.run('task pr T1 https://github.com/o/r/pull/7')
    assert.match(linked.text, /已关联 T1 → PR #7（o\/r）/)
    assert.match(linked.text, /可合并/)
    assert.match(linked.text, /待审批/)
    assert.match(linked.text, /不代开 PR/)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], ['pr', 'view', '7', '--repo', 'o/r', '--json', 'url,state,isDraft,mergeable,reviewDecision,statusCheckRollup,mergedAt,headRefOid,baseRefName'])
    const found = await h.relay.taskBoardFor({ sessionId: h.caller.id })
    const state = await h.relay.ensureTaskState(found.board.storeRoot)
    assert.equal(state.get('T1').pr.number, 7)
    assert.equal(state.get('T1').pr.repo, 'o/r')
    assert.equal(state.get('T1').pr.source, 'ok')
    assert.equal(state.get('T1').pr.status.state, 'OPEN')
    assert.equal(state.get('T1').stage, undefined, '关联 PR 不改任务阶段')
    assert.equal(state.get('T1').approval, undefined, '关联 PR 不改审批')
    const detail = await h.call('peer_tasks', { id: 'T1' })
    assert.match(detail, /PR：PR #7 · OPEN · 可合并 · 待审批 · checks 1\/1 通过/)
    // 缓存未过期：只看不重查
    const shown = await h.run('task pr T1')
    assert.equal(calls.length, 1)
    assert.match(shown.text, /PR #7（o\/r）/)
    // 强制刷新
    await h.run('task pr T1 refresh')
    assert.equal(calls.length, 2)
    // 面板快照带 PR 摘要
    const panel = await h.relay.tasksPanel(h.caller.id)
    const item = panel.groups.flatMap((group) => group.items).find((row) => row.id === 'T1')
    assert.equal(item.pr.label, 'PR #7 · OPEN · 可合并 · 待审批 · checks 1/1 通过')
    // 解除关联，不动阶段/审批
    const cleared = await h.run('task pr T1 clear')
    assert.match(cleared.text, /已解除 T1 与 PR #7 的关联/)
    assert.equal(state.get('T1').pr, undefined)
    // 面板「关联 PR」走用户路由，和命令同一份任务库
    const { perform } = await import('../lib/settings-route.js')
    const viaPanel = await perform(h.relay, { action: 'task-pr', fromSession: h.caller.id, task: 'T1', pr: 'https://github.com/o/r/pull/9' })
    assert.match(viaPanel.result.text, /已关联 T1 → PR #9/)
    assert.equal(state.get('T1').pr.number, 9)
    // 模型没有关联入口（工具参数枚举直接拒绝）
    await assert.rejects(h.call('peer_task', { action: 'pr', id: 'T1', target: '7' }), /must be one of|不认识的动作/)
  } finally { await h.cleanup() }
})

test('任务 PR 关联：只给号时按当前目录的 GitHub origin 推断仓库', async () => {
  const h = await setup({
    prGh: async () => ({
      stdout: JSON.stringify({
        url: 'https://github.com/o2/r2/pull/9', state: 'OPEN', isDraft: false, mergeable: 'UNKNOWN', reviewDecision: '',
        mergedAt: null, headRefOid: 'ffff', baseRefName: 'main', statusCheckRollup: []
      })
    })
  })
  try {
    h.workspaces.push({ id: 'ws-pr2', title: 'PR2', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    execFileSync('git', ['-C', h.dir, 'init', '-q'])
    execFileSync('git', ['-C', h.dir, 'remote', 'add', 'origin', 'https://github.com/o2/r2.git'])
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 优先 | 任务 | 状态 |\n|---|---|---|---|\n| T2 | P1 | 做点事 | 待认领 |\n')
    const linked = await h.run('task pr T2 9')
    assert.match(linked.text, /已关联 T2 → PR #9（o2\/r2）/)
    const found = await h.relay.taskBoardFor({ sessionId: h.caller.id })
    const state = await h.relay.ensureTaskState(found.board.storeRoot)
    assert.equal(state.get('T2').pr.repo, 'o2/r2')
    assert.equal(state.get('T2').pr.url, 'https://github.com/o2/r2/pull/9')
  } finally { await h.cleanup() }
})

test('任务 PR 关联：探测失败记 unknown、保留关联，详情给出原因', async () => {
  const h = await setup({
    prGh: async () => { const error = new Error('boom'); error.stderr = 'HTTP 500: server error\n'; throw error }
  })
  try {
    h.workspaces.push({ id: 'ws-pr3', title: 'PR3', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 优先 | 任务 | 状态 |\n|---|---|---|---|\n| T3 | P1 | 做点事 | 待认领 |\n')
    const linked = await h.run('task pr T3 https://github.com/o/r/pull/8')
    assert.match(linked.text, /已关联 T3 → PR #8/)
    assert.match(linked.text, /状态：未知（HTTP 500: server error）/)
    const found = await h.relay.taskBoardFor({ sessionId: h.caller.id })
    const state = await h.relay.ensureTaskState(found.board.storeRoot)
    assert.equal(state.get('T3').pr.source, 'unknown')
    assert.equal(state.get('T3').pr.number, 8)
    const detail = await h.call('peer_tasks', { id: 'T3' })
    assert.match(detail, /PR：PR #8 · 状态未知/)
  } finally { await h.cleanup() }
})

test('面板仓库：board 带能力探测与开关，用户动作改开关并记审计，模型没有写入口', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'relay-repo-panel-'))
  const calls = []
  const repoGh = async (args) => {
    calls.push(args.join(' '))
    const path = args[1]
    if (path === 'repos/o/r') return { stdout: JSON.stringify({ has_issues: true, has_projects: true, default_branch: 'main', allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: false, delete_branch_on_merge: false, permissions: { admin: true, push: true } }) }
    if (path === 'repos/o/r/branches/main/protection') throw Object.assign(new Error('exit 1'), { stderr: 'Branch not protected (HTTP 404)' })
    if (path.startsWith('repos/o/r/labels')) return { stdout: '[]' }
    if (path === 'repos/o/r/issues?state=all&per_page=1') return { stdout: JSON.stringify([{ number: 7 }]) }
    if (path === 'repos/o/r/issues/7/sub_issues') throw Object.assign(new Error('exit 1'), { stderr: 'Not Found (HTTP 404)' })
    throw new Error('unexpected gh ' + path)
  }
  const h = await setup({ repoGh, taskStoreBase: join(baseDir, 'tasks') })
  try {
    h.workspaces.push({ id: 'ws-repo', title: 'R', path: h.dir, sessionIds: [h.caller.id] })
    await h.run('main here')
    execFileSync('git', ['-C', h.dir, 'init', '-q'])
    execFileSync('git', ['-C', h.dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git'])
    const board = await h.relay.board(undefined, { workspaceId: 'ws-repo' })
    assert.equal(board.repo.available, true)
    assert.equal(board.repo.repo, 'o/r')
    assert.equal(board.repo.source, 'ok')
    assert.equal(board.repo.repoInfo.hasIssues, true)
    assert.equal(board.repo.protection.state, 'none')
    assert.equal(board.repo.switches.find((item) => item.key === 'issues').available, true)
    const mapSwitch = board.repo.switches.find((item) => item.key === 'mapIssues')
    assert.equal(mapSwitch.available, true, 'sub-issues 不支持时按正文 tasklist 降级，仍可开')
    assert.match(mapSwitch.note, /tasklist/)
    const done = await h.relay.setRepoSwitch({ workspaceId: 'ws-repo', key: 'issues', enabled: true })
    assert.equal(done.changed, true)
    const stored = await h.relay.repoStore.probe('o/r')
    assert.equal(stored.switches.issues, true)
    const audit = await readFile(join(baseDir, 'tasks', 'repos', 'switch-audit.jsonl'), 'utf8')
    assert.match(audit, /"repo":"o\/r","key":"issues","from":false,"to":true,"by":"user"/)
    assert.equal((await h.relay.setRepoSwitch({ workspaceId: 'ws-repo', key: 'mapIssues', enabled: true })).changed, true)
    // 强制重新探测会再读一次 gh
    const before = calls.length
    const refreshed = await h.relay.refreshRepo({ workspaceId: 'ws-repo' })
    assert.equal(refreshed.source, 'ok')
    assert.ok(calls.length > before, 'force 绕过缓存')
    // 模型工具不接受仓库开关动作
    await assert.rejects(h.call('peer_task', { action: 'repo-switch', key: 'issues', enabled: true }), /must be one of|不认识的动作/)
  } finally { await h.cleanup(); await rm(baseDir, { recursive: true, force: true }) }
})

test('R1 issue 投影接线：issues 开关打开后任务变化会排队建票；模型没有同步入口', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'relay-issue-sync-'))
  const ghCalls = []
  const gh = async (args) => {
    ghCalls.push(args.join(' '))
    if (args[0] === 'issue' && args[1] === 'list') return { stdout: '[]' }
    if (args[1] === 'repos/o/r/issues' && args.includes('POST')) return { stdout: JSON.stringify({ number: 7, html_url: 'https://github.com/o/r/issues/7' }) }
    if (args[1] === 'repos/o/r/issues/7' && args.includes('PATCH')) return { stdout: '{"state":"open"}' }
    throw new Error('unexpected gh ' + args.join(' '))
  }
  const repoStore = {
    async switches() { return { issues: true, closeOnTerminal: false, labelSync: false, mapIssues: false, prLink: false, approvalGate: true, projectStatus: false } },
    async probe() { return { probe: { source: 'ok', repo: {}, labels: [], labelsState: 'ok', subIssues: 'unknown' }, switches: {} } }
  }
  const h = await setup({
    taskStoreBase: join(baseDir, 'tasks'),
    repoStore,
    issueSyncOptions: { gh, readTask: async ({ taskId }) => ({ id: taskId, title: '做点事', state: 'live', priority: 'P1', statusText: '进行中', holderLabel: '@t1' }) }
  })
  try {
    h.workspaces.push({ id: 'ws-sync', title: 'S', path: h.dir, sessionIds: [h.caller.id] })
    await h.run('main here')
    execFileSync('git', ['-C', h.dir, 'init', '-q'])
    execFileSync('git', ['-C', h.dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git'])
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 优先 | 任务 | 状态 |\n|---|---|---|---|\n')
    await h.call('peer_task', { action: 'new', id: 'T1', title: '做点事', detail: '用户要求' })
    const found = await h.relay.taskBoardFor({ sessionId: h.caller.id })
    const sync = h.relay.issueSyncFor(found.board.storeRoot)
    await sync.flush()
    assert.equal(sync.getLink('o/r', 'T1').issue, 7)
    assert.equal(sync.getLink('o/r', 'T1').state, 'synced')
    assert.ok(ghCalls.some((call) => call.includes('relay-task:T1')))
    const status = await h.run('sync status')
    assert.match(status.text, /GitHub 同步：o\/r/)
    assert.match(status.text, /T1 · #7 · synced/)
    // 看板快照带只读同步摘要（完整和轻量都有；不新增 gh 调用）
    const board = await h.relay.board(undefined, { workspaceId: 'ws-sync' })
    assert.equal(board.sync.repo, 'o/r')
    assert.equal(board.sync.available, true)
    assert.equal(board.sync.switches.issues, true)
    assert.ok(board.sync.links.some((link) => link.id === 'T1' && link.issue === 7 && link.state === 'synced'))
    const light = await h.relay.board(undefined, { workspaceId: 'ws-sync', lightweight: true })
    assert.equal(light.partial, true)
    assert.equal(light.sync, null, '同步摘要随完整快照补水，轻量首屏不查')
    // 模型没有同步入口
    assert.ok(!h.tools.has('peer_sync'))
    await assert.rejects(h.call('peer_task', { action: 'sync-dispatch' }), /must be one of|不认识的动作/)
  } finally { await h.cleanup(); await rm(baseDir, { recursive: true, force: true }) }
})

test('R1 issue 投影默认接线：不注入 readTask 也能读到任务并建票；队列处理完落盘清空', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'relay-issue-default-'))
  const ghCalls = []
  const gh = async (args) => {
    ghCalls.push(args.join(' '))
    if (args[0] === 'issue' && args[1] === 'list') return { stdout: '[]' }
    if (args[1] === 'repos/o/r/issues' && args.includes('POST')) return { stdout: JSON.stringify({ number: 9, html_url: 'https://github.com/o/r/issues/9' }) }
    if (args[1] === 'repos/o/r/issues/9' && args.includes('PATCH')) return { stdout: '{"state":"open"}' }
    throw new Error('unexpected gh ' + args.join(' '))
  }
  const repoStore = {
    async switches() { return { issues: true, closeOnTerminal: false, labelSync: false, mapIssues: false, prLink: false, approvalGate: true, projectStatus: false } },
    async probe() { return { probe: { source: 'ok', repo: {}, labels: [], labelsState: 'ok', subIssues: 'unknown' }, switches: {} } }
  }
  const h = await setup({ taskStoreBase: join(baseDir, 'tasks'), repoStore, issueSyncOptions: { gh } })
  try {
    h.workspaces.push({ id: 'ws-sync2', title: 'S2', path: h.dir, sessionIds: [h.caller.id] })
    await h.run('main here')
    execFileSync('git', ['-C', h.dir, 'init', '-q'])
    execFileSync('git', ['-C', h.dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git'])
    await mkdir(join(h.dir, '.agents'), { recursive: true })
    await writeFile(join(h.dir, '.agents/TASKS.md'), '| 号 | 优先 | 任务 | 状态 |\n|---|---|---|---|\n')
    await h.call('peer_task', { action: 'new', id: 'T1', title: '做点事', detail: '用户要求' })
    const found = await h.relay.taskBoardFor({ sessionId: h.caller.id })
    const sync = h.relay.issueSyncFor(found.board.storeRoot)
    await sync.flush()
    const link = sync.getLink('o/r', 'T1')
    assert.equal(link.issue, 9, '默认 readTask 能从任务库读到任务并建票')
    assert.equal(link.state, 'synced')
    assert.ok(ghCalls.some((call) => call.includes('relay-task:T1')))
    const onDisk = JSON.parse(await readFile(join(found.board.storeRoot, 'sync.json'), 'utf8'))
    assert.deepEqual(onDisk.repos['o/r'].queue, [], '队列处理完要落盘清空，不能留在 sync.json')
    // 认领后投影正文要带持有者事实（之前 syncTaskSnapshot 不传 holders，票里写「0d246872：查不到」）
    await h.call('peer_task', { action: 'claim', id: 'T1' })
    await sync.flush()
    assert.ok(!ghCalls.join(' ').includes('查不到'), '认领后写入 issue 的正文不能出现「查不到」')
    assert.ok(ghCalls.join(' ').includes('：空闲') || ghCalls.join(' ').includes('：运行中'), '正文应带持有者状态')
  } finally { await h.cleanup(); await rm(baseDir, { recursive: true, force: true }) }
})

test('平级通知回执时限：超时提醒发送方；对方回复即销账', async () => {
  let now = 1_000_000
  const h = await setup({ deadlineNow: () => now })
  try {
    const sent = await h.call('peer_send', { target: h.peer.id, message: '请确认 A', timeout: '10s' }, h.caller)
    assert.match(sent, /10 秒/)
    assert.match(sent, /没被取走|强制通知/)
    assert.equal((await h.relay.deadlines.due(now + 10_000)).length, 1)
    now += 10_000
    const swept = await h.relay.sweepDeadlines()
    assert.equal(swept.length, 1)
    assert.equal(swept[0].sent, true)
    const reminder = h.caller.inbox.find(([, message]) => message.content?.[0]?.text?.includes('<relay-deadline>'))
    assert.ok(reminder, '发送方收到插队提醒')
    assert.match(reminder[1].content[0].text, /请确认 A/)
    assert.match(reminder[1].content[0].text, /10 秒/)
    // 只提醒一次
    assert.equal((await h.relay.sweepDeadlines()).length, 0)

    // 对方回消息：之前的待回执销账，不再提醒
    const h2 = await setup({ deadlineNow: () => now })
    try {
      await h2.call('peer_send', { target: h2.peer.id, message: '再确认', timeout: '10s' }, h2.caller)
      await h2.call('peer_send', { target: h2.caller.id, message: '收到' }, h2.peer)
      now += 11_000
      assert.equal((await h2.relay.sweepDeadlines()).length, 0)
    } finally { await h2.cleanup() }
  } finally { await h.cleanup() }
})

test('通知到期：对方正在运行就自动插队，不再提醒发送方', async () => {
  let now = 7_000_000
  const h = await setup({ deadlineNow: () => now })
  try {
    h.peer.status = 'running'
    await h.call('peer_send', { target: h.peer.id, message: '超时插队', timeout: '10s' }, h.caller)
    const sent = h.peer.inbox.find(([, message]) => Array.isArray(message?.content) && String(message.content[0]?.text ?? '').includes('超时插队'))
    assert.ok(sent !== undefined)
    const message = sent[1]
    let removed = false
    const agent = {
      status: 'running', session: h.peer.session,
      inbox: { remove: (id) => { if (id === message.id) { removed = true; return true } return false } },
      steer: (item) => h.peer.inbox.push(['steer', item])
    }
    h.relay.pendingFor = async () => ({ agent, pending: [{ id: message.id, senderId: h.caller.id, message }] })
    now += 10_000
    const swept = await h.relay.sweepDeadlines()
    assert.equal(swept.length, 1)
    assert.equal(swept[0].forced, true)
    assert.equal(removed, true, '从原队列移出')
    assert.ok(h.peer.inbox.some(([mode, item]) => mode === 'steer' && item === message), '原消息插进当前轮')
    assert.ok(!h.caller.inbox.some(([, item]) => item.content?.[0]?.text?.includes('<relay-deadline>')), '不再提醒发送方')
  } finally { await h.cleanup() }
})

test('汇报 question 到期且主会话运行中：自动插队，不再提醒工作会话', async () => {
  let now = 8_000_000
  const h = await setup({ deadlineNow: () => now })
  try {
    const batch = { id: 'batch-1', content: [{ type: 'text', text: '要决定 A/B' }], source: { kind: 'agent-message' } }
    let removed = false
    const agent = {
      status: 'running', session: h.caller.session,
      inbox: { remove: (id) => { if (id === 'batch-1') { removed = true; return true } return false } },
      steer: (item) => h.caller.inbox.push(['steer', item])
    }
    h.relay.pendingFor = async () => ({ agent, pending: [{ id: 'batch-1', senderId: h.peer.id, message: batch }] })
    await h.relay.deadlines.add({ id: 'report-1', from: h.peer.id, to: h.caller.id, at: now, deadlineAt: now + 10_000, timeoutMs: 10_000, mode: 'report', kind: 'report', preview: '要决定', deliveryId: 'batch-1' })
    now += 10_000
    const swept = await h.relay.sweepDeadlines()
    assert.equal(swept.length, 1)
    assert.equal(swept[0].forced, true)
    assert.equal(removed, true)
    assert.ok(h.caller.inbox.some(([mode, item]) => mode === 'steer' && item === batch))
    assert.ok(!h.peer.inbox.some(([, item]) => item.content?.[0]?.text?.includes('<relay-deadline>')))
    const record = await h.relay.deadlines.get('report-1')
    assert.ok(record === undefined || record.forcedAt > 0)
  } finally { await h.cleanup() }
})

test('汇报 question 也有回执时限；主会话回复即销账', async () => {
  let now = 2_000_000
  const h = await setup({ deadlineNow: () => now })
  try {
    await h.run('main here')
    await h.call('peer_report', { status: 'question', summary: '要决定', question: 'A 还是 B', timeout: '10s' }, h.peer)
    now += 10_000
    const swept = await h.relay.sweepDeadlines()
    assert.equal(swept.length, 1)
    assert.ok(h.peer.inbox.some(([, message]) => message.content?.[0]?.text?.includes('<relay-deadline>')))
    // 主会话回复：销掉 worker 的待回执
    const h2 = await setup({ deadlineNow: () => now })
    try {
      await h2.run('main here')
      await h2.call('peer_report', { status: 'question', summary: '要决定', question: 'A 还是 B', timeout: '10s' }, h2.peer)
      await h2.call('peer_send', { target: h2.peer.id, message: '选 A' }, h2.caller)
      now += 11_000
      assert.equal((await h2.relay.sweepDeadlines()).length, 0)
    } finally { await h2.cleanup() }
  } finally { await h.cleanup() }
})

test('待收队列：硬上限拒绝普通消息，queue 在落后时拒绝，steer 可插队，peer_list 显示待收', async () => {
  const h = await setup()
  try {
    const pending = (n) => Array.from({ length: n }, (_, index) => ({ id: 'm' + index, senderId: h.peer.id, list: 'next-turn', message: {} }))
    h.relay.pendingFor = async () => ({ agent: h.peer, pending: pending(8) })
    await assert.rejects(h.call('peer_send', { target: h.peer.id, message: 'x' }, h.caller), /待收消息已有 8 条|硬上限/)
    const steered = await h.call('peer_send', { target: h.peer.id, message: 'x', mode: 'steer' }, h.caller)
    assert.match(steered, /已送达/)
    h.relay.pendingFor = async () => ({ agent: h.peer, pending: pending(4) })
    await assert.rejects(h.call('peer_send', { target: h.peer.id, message: 'x', mode: 'queue' }, h.caller), /落后.*queue/)
    const list = await h.call('peer_list', {}, h.caller)
    assert.match(list, /待收 4/)
  } finally { await h.cleanup() }
})

test('看板快照：活跃会话带待收队列，落后时标 lagging', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-backlog', title: 'B', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await h.run('main here')
    await h.call('peer_report', { status: 'working', summary: '干活' }, h.peer)
    h.relay.pendingFor = async () => ({ agent: h.peer, pending: Array.from({ length: 4 }, (_, index) => ({ id: 'q' + index, senderId: h.caller.id, list: 'next-turn', message: {} })) })
    const board = await h.relay.board(undefined, { workspaceId: 'ws-backlog' })
    const entry = board.entries.find((item) => item.sessionId === h.peer.id)
    assert.equal(entry.pending.count, 4)
    assert.equal(entry.pending.level, 'lagging')
  } finally { await h.cleanup() }
})

test('收到即销账：成功取走不再给发送方发回执消息；只有一直没被取走才提醒', async () => {
  let now = 3_000_000
  const h = await setup({ deadlineNow: () => now })
  try {
    h.peer.status = 'idle'
    await h.call('peer_send', { target: h.peer.id, message: '请确认', timeout: '10s' }, h.caller)
    assert.ok(!h.caller.inbox.some(([, message]) => message.content?.[0]?.text?.includes('<relay-receipt>')), '成功不发回执消息')
    now += 10_000
    assert.equal((await h.relay.sweepDeadlines()).length, 0, '已取走的不再提醒')
  } finally { await h.cleanup() }

  const h2 = await setup({ deadlineNow: () => now })
  try {
    const sent = await h2.call('peer_send', { target: h2.peer.id, message: '排队中', timeout: '10s' }, h2.caller)
    assert.match(sent, /不再单独发回执/)
    h2.relay.pendingFor = async () => ({ agent: h2.peer, pending: [] })
    const received = await h2.relay.sweepReceipts()
    assert.equal(received.length, 1, '队列消失视为已取走')
    assert.ok(!h2.caller.inbox.some(([, message]) => message.content?.[0]?.text?.includes('<relay-receipt>')), '补发也只销账，不发消息')
  } finally { await h2.cleanup() }
})

test('expect_reply=false：待命消息不因没回复触发超时；取走也只销账', async () => {
  let now = 4_000_000
  const h = await setup({ deadlineNow: () => now })
  try {
    await h.call('peer_send', { target: h.peer.id, message: '收到，保持待命', timeout: '10s', expect_reply: false }, h.caller)
    now += 11_000
    assert.equal((await h.relay.sweepDeadlines()).length, 0, '明确不用回复就不超时提醒')
    h.peer.status = 'idle'
    const received = await h.relay.sweepReceipts()
    assert.equal(received.length, 1, '宿主看不到队列时，空闲兜底算取走')
    assert.ok(!h.caller.inbox.some(([, message]) => message.content?.[0]?.text?.includes('<relay-receipt>')))
  } finally { await h.cleanup() }
})

test('事件销账：目标会话处理到这条消息时按 id 清掉时限，不发回执消息', async () => {
  const h = await setup()
  try {
    await h.call('peer_send', { target: h.peer.id, message: '事件销账测试', timeout: '10s' }, h.caller)
    const delivered = h.peer.inbox.find(([, message]) => Array.isArray(message?.content) && String(message.content[0]?.text ?? '').includes('事件销账测试'))
    assert.ok(delivered !== undefined)
    const message = delivered[1]
    assert.equal(typeof message.id, 'string')
    assert.equal((await h.relay.deadlines.all()).filter((record) => record.id === message.id).length, 1, '取走前有时限')
    h.listeners['session/event'](h.peer.session, { type: 'user/message', data: { message } })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal((await h.relay.deadlines.all()).filter((record) => record.id === message.id).length, 0, '处理到就销账')
    assert.ok(!h.caller.inbox.some(([, item]) => item.content?.[0]?.text?.includes('<relay-receipt>')), '不发回执消息')
  } finally { await h.cleanup() }
})

test('汇报收到即销账：主会话处理到汇报批后清掉时限，不发回执消息', async () => {
  let now = 5_000_000
  const h = await setup({ deadlineNow: () => now })
  try {
    await h.run('main here')
    await h.call('peer_report', { status: 'question', summary: '要决定', question: 'A 还是 B', timeout: '10s' }, h.peer)
    await h.relay.batcher.flushAll()
    const batch = h.caller.inbox.map(([, message]) => message).find((message) => String(message?.content?.[0]?.text ?? '').includes('要决定'))
    assert.ok(batch !== undefined)
    assert.equal(typeof batch.id, 'string')
    h.listeners['session/event'](h.caller.session, { type: 'user/message', data: { message: batch } })
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.ok(!h.peer.inbox.some(([, message]) => String(message?.content?.[0]?.text ?? '').includes('<relay-receipt>')), '不发回执消息')
    now += 11_000
    assert.equal((await h.relay.sweepDeadlines()).length, 0, '已销账的不再超时提醒')
  } finally { await h.cleanup() }
})

test('紧急插队：priority=urgent 在目标运行中直接 steer；排队超时自动升级', async () => {
  let now = 6_000_000
  const h = await setup({ deadlineNow: () => now })
  try {
    const sent = await h.call('peer_send', { target: h.peer.id, message: '先停，方向不对', priority: 'urgent' }, h.caller)
    assert.match(sent, /紧急插队/)
    const last = h.peer.inbox.at(-1)
    assert.equal(last[0], 'steer', 'urgent 不排到本轮之后')
    assert.match(last[1].content[0].text, /先停/)

    // 普通 followup 排队超过阈值：自动从队列取出并 steer，不再等满 3 分钟
    now += 120_000
    const message = { id: 'pending-1', content: [{ type: 'text', text: '纠正：先停' }], source: { kind: 'agent-message' } }
    let removed = false
    const agent = {
      status: 'running',
      session: h.peer.session,
      inbox: { remove: (id) => { if (id === 'pending-1') { removed = true; return true } return false } },
      steer: (item) => h.peer.inbox.push(['steer', item])
    }
    h.relay.pendingFor = async () => ({ agent, pending: [{ id: 'pending-1', senderId: h.caller.id, message }] })
    await h.relay.deadlines.add({
      id: 'pending-1', from: h.caller.id, to: h.peer.id, at: now - 120_000, deadlineAt: now + 60_000,
      timeoutMs: 180_000, mode: 'followup', kind: 'send', preview: '纠正：先停', deliveredAt: now - 120_000, receiptPending: true
    })
    const escalated = await h.relay.sweepEscalations()
    assert.deepEqual(escalated, ['pending-1'])
    assert.equal(removed, true, '从原队列移出')
    assert.ok(h.peer.inbox.some(([mode, item]) => mode === 'steer' && item === message), '改为 steer 插进当前轮')
  } finally { await h.cleanup() }
})
