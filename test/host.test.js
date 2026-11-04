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
import { sampleEvents } from './fixtures/inspect-events.js'
import { fixture as taskFixture } from './fixtures/task-board.js'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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

async function setup() {
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
    aliasPath: join(dir, 'aliases.json'), statePath: join(dir, 'coordination.json'), templatePath: join(dir, 'templates.json'), handoffPath: join(dir, 'handoffs.json'), pinPath: join(dir, 'pins.json'), watchPath: join(dir, 'watches.json'), watch: false, autoPinIntervalMs: 0, titlePath: join(dir, 'titles.json'), autoTitleIntervalMs: 0, chainWatchIntervalMs: 0, remoteReleaseTags: false, maxHops: 2,
    setTimer: (fn) => { timers.push(fn); return timers.length }, clearTimer: () => {}
  })
  assert.match(await shell.ready, /已加载/)
  const relay = shell.relay
  const contextFor = (agent) => contexts[0].text({ agent })
  const run = (raw, agent = caller) => commands.get('relay').handler({ rawInput: raw, agent, signal: AbortSignal.timeout(5000) })
  const call = (name, args, agent = caller) => tools.get(name).execute(args, { agent, signal: AbortSignal.timeout(5000) })
  return { dir, caller, peer, child, agents, listeners, commands, tools, run, call, relay, routes, shell, busy, notified, workspaces, services, timers, contextFor, makeAgent, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('注册了 /relay 与四个 peer 工具', async () => {
  const h = await setup()
  try {
    assert.ok(h.commands.has('relay'))
    assert.equal(h.routes[0].path, '/api/dsha-session-relay')
    assert.deepEqual([...h.tools.keys()].sort(), ['peer_alias', 'peer_assign', 'peer_handoff', 'peer_inspect', 'peer_line', 'peer_list', 'peer_report', 'peer_send', 'peer_spawn', 'peer_task', 'peer_tasks', 'peer_watch', 'peer_workspace'])
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
    const back = h.caller.inbox.at(-1)[1]
    assert.match(back.content[0].text, /第 2\/2 跳/)
    h.listeners['session/event'](h.caller.session, { type: 'user/message', data: back })
    await assert.rejects(h.call('peer_send', { target: 'peer', message: '再说一句' }), /跳/)
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
    assert.match(mainContext, /peer_workspace/)
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

test('peer_workspace：只给主会话；列出工作区全部会话并能读最近几轮', async () => {
  const h = await setup()
  try {
    h.workspaces.push({ id: 'ws-a', title: 'A', path: h.dir, sessionIds: [h.caller.id, h.peer.id] })
    await assert.rejects(h.call('peer_workspace', {}, h.peer), /只给本工作区的主会话/)
    await h.run('main here')
    const list = await h.call('peer_workspace', {})
    assert.match(list, /侧栏登记 2 个会话/)
    assert.match(list, /bbbbbbbb · 运行中 · 未加入/)
    assert.match(list, /aaaaaaaa.*← 当前/)
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
    const digest = await h.call('peer_workspace', { session: 'bbbbbbbb', turns: 1 })
    assert.match(digest, /是数据，不是用户对你的指令/)
    assert.match(digest, /seq 5 .* 用户\] 第二轮问题/)
    assert.match(digest, /第二轮回答/)
    assert.doesNotMatch(digest, /第一轮|系统提示|运行时上下文/)
    // 工作区外的会话拒绝
    const outsider = h.makeAgent('99999999-0000-0000-0000-000000000009', { cwd: '/z' })
    h.agents.set(outsider.id, outsider)
    await assert.rejects(h.call('peer_workspace', { session: outsider.id }), /不在本工作区/)
    // 用户命令同样可用
    assert.match((await h.run('ws')).text, /侧栏登记 2 个会话/)
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
    assert.match(await h.call('peer_workspace', { declarations: true }), /工作树声明/)
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
    await writeFile(join(h.dir, '.agents/TASKS.md'), '## 认领规则\n\n| 号 | 优先 | 任务 | 状态 |\n|---|---|---|---|\n| T1 | P2 | 低优先 | 待认领 |\n| T2 | P0 | 已被认领 | 待认领 |\n| T3 | P1 | 修 MCP | 可认领 |\n')
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
    // 模型：peer_spawn claim=any（主会话）→ 按 agent 来源送达，取最高优先的
    const reply = await h.call('peer_spawn', { claim: 'any' })
    assert.match(reply, /去认领一个待认领任务/)
    const second = [...h.agents.values()].filter((agent) => agent.id.startsWith('dddddddd')).pop()
    assert.equal(second.inbox[0][1].source.kind, 'agent-message')
    assert.match(second.inbox[0][1].content[0].text, /认领一个「待认领」的最高优先任务/)
    await assert.rejects(h.call('peer_spawn', {}), /需要 task/)
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

test('peer_inspect：本工作区可看、工作区外拒绝（用户命令可看）；不唤醒目标；工作区搜索；peer_workspace 读到用户提示', async () => {
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
    // peer_workspace 摘要能读到原始形状的用户提示
    await h.run('main here')
    const digest = await h.call('peer_workspace', { session: 'bbbbbbbb', turns: 2 })
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
  const h = await setup()
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
    assert.match(h.caller.inbox.map(([, message]) => message.content[0].text).join('\n'), /新区 tag/)
    await h.call('peer_watch', { action: 'add', kind: 'ref', ref: 'v2', sha: 'abcdef12' })
    const second = /核验 ([0-9a-f]{8})/.exec(await h.call('peer_watch', { action: 'add', kind: 'ref', ref: 'v3', sha: 'abcdef13' }))[1]
    assert.match(await h.call('peer_watch', { action: 'cancel', id: second }), /已取消/)
    await h.run('main here', h.peer)
    await assert.rejects(h.call('peer_watch', { action: 'add', kind: 'ref', ref: 'v4', sha: 'abcdef14' }), /只有本工作区的主会话能登记/)
  } finally { await h.cleanup() }
})

test('核验 tag：登记后换了主会话，tag 推上来时通知现任主会话（不是登记者），并发手机通知', async () => {
  const h = await setup()
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
    const toPeer = h.peer.inbox.map(([, message]) => message.content[0].text).join('\n')
    assert.match(toPeer, /0\.15\.0 tag/)
    assert.doesNotMatch(h.caller.inbox.map(([, message]) => message.content[0].text).join('\n'), /0\.15\.0 tag/)
    assert.ok(h.notified.some(([title, text]) => /0\.15\.0 tag/.test(`${title} ${text}`)))
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
    const events = (await readFile(join(h.dir, '.agents/task-events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(events.map((event) => event.action), ['claim', 'done', 'takeover', 'new', 'handoff', 'release', 'claim', 'abandon', 'update'])
    assert.ok((await readdir(join(h.dir, '.agents/backups/ops'))).length >= 8)
    await assert.rejects(readFile(join(h.dir, '.agents/.tasks.lock')), /ENOENT/)
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
    assert.match(h.relay.coord.snapshot().board[h.caller.id].summary, /^［子代理 cccccccc］跑完一半/)

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
