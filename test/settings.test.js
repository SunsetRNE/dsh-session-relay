/** 设置页「会话协作」：Host 路由与 Client 组件冒烟测试（不启动浏览器）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { SessionRelay, prReviewLaunchText } from '../lib/impl.js'
import { createHandler, perform, snapshot } from '../lib/settings-route.js'
import { COMMAND_REFERENCE, HELP_TEXT } from '../lib/core.js'

async function makeRelay() {
  const dir = await mkdtemp(join(tmpdir(), 'relay-settings-'))
  const relay = new SessionRelay({ logger: { warn() {} }, get: () => undefined, sessions: { get: () => undefined } }, {
    aliasPath: join(dir, 'aliases.json'), statePath: join(dir, 'coordination.json'), templatePath: join(dir, 'templates.json'), handoffPath: join(dir, 'handoffs.json'), watchPath: join(dir, 'watches.json'), deadlinePath: join(dir, 'deadlines.json'), deadlineTickMs: 0, watch: false, githubAuto: false
  })
  await relay.ready()
  return { dir, relay, cleanup: async () => { await relay.away.chain; await rm(dir, { recursive: true, force: true }) } }
}

function fakeReq(method, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))])
  req.method = method
  req.headers = { host: '127.0.0.1:46779', ...headers }
  return req
}

function fakeRes() {
  const res = { status: 0, body: undefined }
  res.writeHead = (status) => { res.status = status }
  res.end = (payload) => { res.body = JSON.parse(payload) }
  return res
}

test('设置页保存的模板 /relay new --tpl 立即可用；重命名、同名保护、删除', async () => {
  const h = await makeRelay()
  try {
    let state = await perform(h.relay, { action: 'save', name: 'Claim', text: '读 TASKS.md\n认领任务' })
    assert.deepEqual(state.templates.map((t) => t.name), ['claim'])
    assert.equal(await h.relay.composeText('补充', 'claim'), '读 TASKS.md\n认领任务\n\n补充：补充')
    await assert.rejects(perform(h.relay, { action: 'save', name: 'claim', text: 'x', previousName: null }), /已有同名模板/)
    state = await perform(h.relay, { action: 'save', name: 'claim2', text: '新正文', previousName: 'claim' })
    assert.deepEqual(state.templates.map((t) => t.name), ['claim2'])
    state = await perform(h.relay, { action: 'save', name: 'claim2', text: '覆盖', previousName: 'claim2', overwrite: true })
    assert.equal(state.templates[0].text, '覆盖')
    await assert.rejects(perform(h.relay, { action: 'save', name: '中文', text: 'x' }), /模板名/)
    state = await perform(h.relay, { action: 'remove', name: 'claim2' })
    assert.deepEqual(state.templates, [])
  } finally { await h.cleanup() }
})

test('手改 templates.json 后不重启也能读到', async () => {
  const h = await makeRelay()
  try {
    await writeFile(join(h.dir, 'templates.json'), JSON.stringify({ version: 1, templates: { hand: { text: '手写的', updatedAt: 1 } } }))
    assert.equal(await h.relay.composeText('', 'hand'), '手写的')
    await assert.rejects(h.relay.composeText('', 'nope'), /已有：hand/)
  } finally { await h.cleanup() }
})

test('设置页写版本线按用户设定；快照带命令速查', async () => {
  const h = await makeRelay()
  try {
    let state = await perform(h.relay, { action: 'line', text: 'main=build280' })
    assert.equal(state.line.text, 'main=build280')
    assert.equal(state.line.setBy, 'user')
    assert.ok(state.reference.length >= 4 && state.notes.length > 0)
    state = await perform(h.relay, { action: 'line-clear' })
    assert.equal(state.line, null)
    await assert.rejects(perform(h.relay, { action: 'line', text: ' ' }), /不能为空/)
    await assert.rejects(perform(h.relay, { action: 'bogus' }), /未知操作/)
  } finally { await h.cleanup() }
})

test('路由：鉴权失败、跨源、坏请求体、正常读写', async () => {
  const h = await makeRelay()
  try {
    let rejection
    const handler = createHandler({ requestRejection: () => rejection }, h.relay)
    rejection = 401
    let res = fakeRes(); await handler(fakeReq('GET'), res)
    assert.equal(res.status, 401)
    rejection = undefined
    res = fakeRes(); await handler(fakeReq('POST', { action: 'line', text: 'x' }, { origin: 'http://evil.example' }), res)
    assert.equal(res.status, 403)
    res = fakeRes(); await handler(fakeReq('POST', '{bad'), res)
    assert.equal(res.status, 400)
    res = fakeRes(); await handler(fakeReq('POST', { action: 'save', name: 'claim', text: '正文' }, { origin: 'http://127.0.0.1:46779' }), res)
    assert.equal(res.status, 200)
    assert.equal(res.body.templates[0].name, 'claim')
    res = fakeRes(); await handler(fakeReq('POST', { action: 'save', name: 'bad name', text: 'x' }), res)
    assert.equal(res.status, 400)
    assert.match(res.body.message, /模板名/)
    res = fakeRes(); await handler(fakeReq('GET'), res)
    assert.equal(res.body.ok, true)
    assert.equal(res.body.templates.length, 1)
    assert.equal(JSON.parse(await readFile(join(h.dir, 'templates.json'), 'utf8')).templates.claim.text, '正文')
  } finally { await h.cleanup() }
})

test('PR「AI 审核」提示词：带仓库 / PR 号 / 只读边界', () => {
  const text = prReviewLaunchText({ repo: 'o/r', number: 7, title: '修 bug', url: 'https://github.com/o/r/pull/7', workspaceTitle: 'w', sessionId: 'session-ai' })
  for (const part of ['o/r#7', 'gh pr diff 7 --repo o/r', '只读', '不要改任何文件', 'peer_report']) assert.ok(text.includes(part), '缺少 ' + part)
})

test('PR「AI 审核」路由：用户动作把 PR 号交给 launchPrReview', async () => {
  const h = await makeRelay()
  try {
    let got
    h.relay.launchPrReview = async (args) => { got = args; return { sessionId: 'session-ai', repo: 'o/r', number: 7 } }
    const done = await perform(h.relay, { action: 'pr-ai-review', number: 7, fromSession: 'session-x' })
    assert.deepEqual(got, { fromId: 'session-x', number: 7, model: undefined })
    assert.equal(done.result.sessionId, 'session-ai')
  } finally { await h.cleanup() }
})

test('面板搜索路由：转发结构化参数并拒绝空查询、非法范围和数值', async () => {
  const calls = []
  const relay = {
    panelSearch: async (options) => { calls.push(options); return { scope: options.scope, scanned: 1, skipped: 0, total: 1, groups: [] } }
  }
  const handler = createHandler({ requestRejection: () => undefined }, relay)
  let res = fakeRes()
  await handler(Object.assign(fakeReq('GET'), { url: '/api/dsha-session-relay?view=search&q=needle&scope=all&fromSession=s1&regex=1&caseSensitive=1&kinds=all&tool=bash&turn=2&maxSessions=3&maxHits=4' }), res)
  assert.equal(res.status, 200)
  assert.deepEqual(calls[0], { query: 'needle', scope: 'all', workspaceId: undefined, fromSession: 's1', regex: true, caseSensitive: true, kinds: 'all', tool: 'bash', turn: 2, maxSessions: 3, maxHits: 4 })
  res = fakeRes()
  await handler(Object.assign(fakeReq('GET'), { url: '/api/dsha-session-relay?view=search&q=' }), res)
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'empty_query')
  res = fakeRes()
  await handler(Object.assign(fakeReq('GET'), { url: '/api/dsha-session-relay?view=search&q=x&scope=all&workspace=ws-a' }), res)
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'bad_search_scope')
  res = fakeRes()
  await handler(Object.assign(fakeReq('GET'), { url: '/api/dsha-session-relay?view=search&q=x&turn=1.5' }), res)
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'bad_search_option')
})

test('命令速查：每条例子都能被解析成有效命令，/relay help 来自同一份', async () => {
  const { parseRelayCommand } = await import('../lib/core.js')
  for (const group of COMMAND_REFERENCE) {
    for (const item of group.items) {
      assert.ok(item.example.startsWith('/relay'), item.example)
      const parsed = parseRelayCommand(item.example.slice('/relay'.length))
      assert.notEqual(parsed.kind, 'invalid', `${item.example} → ${parsed.reason}`)
      assert.ok(HELP_TEXT.includes(item.syntax), item.syntax)
    }
  }
})

/** 极简 React：直接调用函数组件、钩子返回初始值，用来确认各数据状态下渲染不抛错。 */
function fakeReact() {
  const rendered = []
  const React = {
    Fragment: 'fragment',
    useId: () => 'id',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useCallback: (fn) => fn,
    Component: class { constructor(props) { this.props = props; this.state = {} } setState() {} },
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
      if (typeof type === 'function' && type.prototype instanceof React.Component) {
        const instance = new type({ ...(props ?? {}), children: flat.length === 1 ? flat[0] : flat })
        return instance.render()
      }
      if (typeof type === 'function') return type({ ...(props ?? {}), children: flat })
      rendered.push({ type, props: props ?? {}, children: flat })
      return { type, props: props ?? {}, children: flat }
    }
  }
  return { React, rendered }
}

async function loadClient(React) {
  let mod
  globalThis.window = { __ModuleLoader__: { load: ({ factory }) => { mod = factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) }) } } }
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  new Function(source)()
  // 正文按需加载（client.panel.js）：测试里直接载入并注入 kit，拿到真组件
  let panel
  globalThis.window = { __ModuleLoader__: { load: ({ chunk, factory }) => { assert.equal(chunk, 'client.panel.js'); panel = factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) }) } } }
  new Function(await readFile(new URL('../lib/client.panel.js', import.meta.url), 'utf8'))()
  delete globalThis.window
  return { ...mod, ...mod.loadPanel(panel), lazy: mod }
}

function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.children)
}

test('模型下拉：同一个模型 id 出现在多个 provider 时补上 provider 名，避免两条一模一样的行', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const { modelOptionLabel } = mod
  const groups = [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }, { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' }] },
    { id: 'deepseek-account', name: 'DeepSeek Account', models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }] }
  ]
  assert.equal(modelOptionLabel(groups, groups[0], groups[0].models[0]), 'DeepSeek-V4.1-Flash（deepseek-flash · DeepSeek）', '重复的模型带 provider')
  assert.equal(modelOptionLabel(groups, groups[1], groups[1].models[0]), 'DeepSeek-V4.1-Flash（deepseek-flash · DeepSeek Account）')
  assert.equal(modelOptionLabel(groups, groups[0], groups[0].models[1]), 'DeepSeek-V4-Pro（deepseek-v4-pro）', '不重复的不加后缀')
  assert.equal(modelOptionLabel([{ id: 'x', name: 'X', models: [{ id: 'm' }] }], { id: 'x', name: 'X', models: [{ id: 'm' }] }, { id: 'm' }), 'm')
})

test('面板概览：给出快速交接入口（主会话先整理快照再交接，工作会话直接新建接手），上下文大时提示', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => `${key}`
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const base = { scope: 'workspace', workspace: null, hiddenByScope: 0, coordinator: null, line: null, others: [], othersTotal: 0, entries: [], restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a' }
  const render = (self) => {
    const board = { ...base, self }
    const original = React.useState
    let calls = 0
    React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
    const text = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'overview' }))
    React.useState = original
    return text
  }
  const selfOf = (extra) => ({ sessionId: 'session-a', short: 'a', label: '@a', aliases: [], isMain: false, model: null, mainElsewhere: false, entry: null, participant: true, seesLine: true, ...extra })
  const main = render(selfOf({ isMain: true }))
  assert.match(main, /quickHandoffMain/, '主会话：整理快照并交接')
  assert.match(main, /quickHandoffHint/)
  const worker = render(selfOf({ sessionId: 'session-b', label: '@w' }))
  assert.match(worker, /quickHandoffWorker/, '工作会话：直接新建接手')
  const hot = render(selfOf({ isMain: true, contextTokens: 520_000 }))
  assert.match(hot, /quickHandoffHot/, '上下文超过阈值时提示交接')
  // 主会话两步：先整理草稿，再确认交接
  const source = await readFile(new URL('../lib/client.panel.js', import.meta.url), 'utf8')
  assert.match(source, /handoff-auto['"][\s\S]{0,160}handoff-confirm/)
})

test('面板概览：版本线用胶囊摘要 + 两行预览，全文按需展开', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => `${key}`
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const line = 'Version line：基线 origin/main=bb5bcee（v1.11.6）；60 个检查点；HEAD 7902dfe；串行测试 346 全过；未推送/未打 tag/未发 Release。后面是很长很长的说明。'.repeat(4)
  const board = {
    scope: 'workspace', workspace: null, hiddenByScope: 0, entries: [], others: [], othersTotal: 0,
    coordinator: { sessionId: 'session-a', label: '@a', exists: true, state: 'idle', model: 'm' },
    line: { text: line }, restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a'
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const text = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'overview' }))
  React.useState = original
  for (const part of ['lineTitle', 'lineMainChip', 'lineHeadChip', 'lineCheckpoints', 'lineTests', 'lineUnreleased', 'lineExpand']) {
    assert.match(text, new RegExp(part), '缺少 ' + part)
  }
  assert.match(text, /bb5bcee/)
  assert.match(text, /7902dfe/)
  assert.doesNotMatch(text, /后面是很长很长的说明。\n?后面/, '预览截断，不铺满整段')
})

test('面板看板：合并队列块已删除，队列号 / 构建号改由卡片 badge 表达', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key === 'assignedTo' ? 'assigned {v}' : key
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const board = {
    scope: 'workspace', workspace: null, hiddenByScope: 0, coordinator: null, line: null, others: [], othersTotal: 0, restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a',
    entries: [
      { sessionId: 'session-two', label: '@two', status: 'ready', category: 'ready', queue: 2, assigned: 'build301', branch: 'feat/two', commit: 'bbbbbbb1', state: 'idle', updatedAt: 1 },
      { sessionId: 'session-one', label: '@one', status: 'ready', category: 'ready', queue: 1, branch: 'feat/one', commit: 'aaaaaaa1', state: 'idle', updatedAt: 1, declaration: { rel: '.agents/worktrees/feat/one', mergeLabel: '可合并', kind: 'done' } },
      { sessionId: 'session-plain', label: '@plain', status: 'working', category: 'active', state: 'running', updatedAt: 1 }
    ]
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const page = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'board' }))
  React.useState = original
  assert.ok(!page.includes('mergeQueueTitle'), '不再有独立的合并队列折叠块')
  assert.match(page, /queueNo/, '队列号仍由卡片 badge 表达')
  assert.match(page, /build301/, '已分配的构建号仍在卡片上')
})

test('Client：二轮压缩——概览操作行合并、归档移到底部默认收起、页签 inline', async () => {
  const css = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(css, /\.dshaSr_page \.dshaSr_tabs\{display:inline-flex/, '页签改成紧凑 inline 左对齐')
  const panelSrc = await readFile(new URL('../lib/client.panel.js', import.meta.url), 'utf8')
  assert.ok(!panelSrc.includes('dshaSr_idline'), '本会话卡不再有两行大号 id')
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const board = {
    scope: 'workspace', workspace: { id: 'w', title: 'W', path: '/w' }, hiddenByScope: 0,
    coordinator: { sessionId: 'session-main1', label: '@main', exists: true, model: 'm' },
    self: { sessionId: 'session-self1', aliases: ['me'], isMain: false, participant: true, seesLine: true, model: 'deepseek-flash' },
    line: { text: 'main=abc1234' },
    entries: [
      { sessionId: 'session-a', label: '@a', status: 'ready', category: 'ready', state: 'idle', summary: 's', updatedAt: 1 },
      { sessionId: 'session-old', label: '@old', status: 'done', category: 'archived', state: 'idle', summary: 'old', updatedAt: 1 }
    ],
    others: [], othersTotal: 0, restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/w',
    unattended: { wakesThisHour: 1, limit: 10, approxTokensThisHour: 1000 }
  }
  const render = (page) => {
    const original = React.useState
    let calls = 0
    React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
    try { return textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: page })) } finally { React.useState = original }
  }
  const overview = render('overview')
  for (const part of ['selfTitle', 'quickHandoffHint', 'overviewCounts', 'overviewToBoard', 'wakeLine', 'modelIs']) assert.ok(overview.includes(part), '概览缺少 ' + part)
  const boardText = render('board')
  assert.ok(boardText.includes('archiveTitle') && boardText.includes('foldArchiveSum'), '归档折叠在')
  assert.ok(!boardText.includes('archiveHint'), '归档默认收起')
  assert.ok(boardText.indexOf('archiveTitle') > boardText.indexOf('catReady'), '归档在页面底部')
  assert.ok(!boardText.includes('mergeQueueTitle'), '合并队列块已删')
})

test('面板看板：分组只有一两条时强制展开（折叠态跨工作区继承会让新工作区看不到卡片）', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const { foldStartsOpen } = mod
  assert.equal(typeof foldStartsOpen, 'function')
  // 记着「收起」但只有一两条：仍展开
  assert.equal(foldStartsOpen({ forceOpen: true, saved: false, defaultOpen: false }), true)
  // 条数多时尊重用户的选择
  assert.equal(foldStartsOpen({ forceOpen: false, saved: false, defaultOpen: true }), false)
  assert.equal(foldStartsOpen({ forceOpen: false, saved: true, defaultOpen: false }), true)
  // 没记过就用默认
  assert.equal(foldStartsOpen({ saved: undefined, defaultOpen: true }), true)
  assert.equal(foldStartsOpen({ saved: undefined, defaultOpen: false }), false)
  // 分组渲染处确实把「≤2 条」传成 forceOpen
  const source = await readFile(new URL('../lib/client.panel.js', import.meta.url), 'utf8')
  assert.match(source, /forceOpen: list\.length <= 2 && cat !== 'idle' && cat !== 'blank'/)
})

test('Client：注册 settings.section；有数据时渲染公告、模板、速查不抛错', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const registrations = []
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (fn) => fn(),
    slots: { inject: (_name, fn) => fn(), register: (options, component) => { registrations.push({ options, component }); return () => {} } }
  }
  mod.apply(ctx)
  const byName = Object.fromEntries(registrations.map((r) => [r.options.name, r]))
  assert.equal(byName['conversation.view'].options.id, 'session-relay')
  assert.equal(byName['conversation.view'].options.label(), 'tab')
  assert.ok(byName['conversation.view'].options.order > 10, '排在“轨迹”之后')
  assert.deepEqual(Object.keys(byName).sort(), ['conversation.composer.dock', 'conversation.session.header.utilities', 'conversation.view', 'main', 'settings.section', 'sidebar.panellist', 'sidebar.session.row.hover', 'sidebar.session.row.leading'])
  assert.equal(byName['conversation.composer.dock'].options.id, 'session-relay-watch')
  assert.equal(byName['settings.section'].options.id, 'session-relay')
  assert.equal(byName['settings.section'].options.label(), 'nav')
  assert.equal(byName['main'].options.key, byName['sidebar.panellist'].options.id, '面板图标与主面板同一个 id')
  // 用初始 state 渲染（data 未加载）
  const empty = React.createElement(mod.SessionRelaySettings, { t: (key) => key })
  assert.match(textOf(empty), /intro/)
  // 直接渲染有数据的子树：通过把 useState 的初始 data 换成快照
  const h = await makeRelay()
  try {
    await perform(h.relay, { action: 'save', name: 'claim', text: '读 TASKS.md' })
    await perform(h.relay, { action: 'line', text: 'main=build280' })
    const data = await snapshot(h.relay)
    const original = React.useState
    let calls = 0
    React.useState = (initial) => (calls++ === 0 ? [data, () => {}] : original(initial))
    const full = React.createElement(mod.SessionRelaySettings, { t: (key) => key })
    React.useState = original
    let text = textOf(full)
    // 默认：版本线与插件状态展开，模板与速查收起只显示摘要
    assert.match(text, /lineTitle/)
    assert.match(text, /setTplSum/)
    assert.doesNotMatch(text, /读 TASKS\.md/)
    assert.match(text, /setRefSum/)
    assert.match(text, /reloadHint/)
    // 展开（折叠状态记在 localStorage）
    const saved = globalThis.window
    globalThis.window = { localStorage: { getItem: () => JSON.stringify({ 'set-tpl': true, 'set-ref': true, 'set-ref-tpl': true }), setItem() {} } }
    calls = 0
    React.useState = (initial) => (calls++ === 0 ? [data, () => {}] : original(initial))
    try { text = textOf(React.createElement(mod.SessionRelaySettings, { t: (key) => key })) } finally { React.useState = original; globalThis.window = saved }
    assert.match(text, /claim/)
    assert.match(text, /refTitle/)
    assert.match(text, /\/relay tpl save claim/)
  } finally { await h.cleanup() }
})

test('Client：左侧 / 协作面板默认嵌入 9 页签；无主会话给说明；旧 BoardPage 保留为 utility', async () => {
  const { React } = fakeReact()
  const seen = []
  const StubSidebar = (props) => {
    seen.push(props)
    return React.createElement('div', null, 'EMBED:' + props.sessionId + ':' + props.persistPrefix)
  }
  let panel
  globalThis.window = { __ModuleLoader__: { load: ({ factory }) => { panel = factory(() => React) } } }
  try { new Function(await readFile(new URL('../lib/client.panel.js', import.meta.url), 'utf8'))() } finally { delete globalThis.window }
  const kit = {
    format: (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values?.[key] ?? ''),
    formatTime: () => '', shortId: (id) => String(id).slice(8, 16), request: async () => ({}), copyText: async () => true,
    errorText: () => '', Button: (props) => React.createElement('button', { onClick: props.onClick }, props.children), Status: () => null,
    useFlash: () => [{}, () => {}], StarIcon: () => null, statusText: () => '', stateText: () => '', SidebarEmbedded: StubSidebar
  }
  const parts = panel.make(kit)
  const storeOf = (snap) => ({ subscribe: () => () => {}, getSnapshot: () => snap, refresh: async () => {} })
  const left = textOf(React.createElement(parts.BoardPage, { t: (key) => key, openSession: () => {}, marksStore: storeOf({ coordinator: 'session-main' }) }))
  assert.match(left, /EMBED:session-main:embed-panel:/, '左栏用主会话视角、独立页签前缀')
  const none = textOf(React.createElement(parts.BoardPage, { t: (key) => key, openSession: () => {}, marksStore: storeOf({}) }))
  assert.match(none, /panelNoMain/, '没有主会话给一行说明')
  assert.match(none, /sideUtilityOverview[\s\S]*sideUtilitySearch/, '说明页仍可进概览 / 全文搜索')
  const tab = textOf(React.createElement(parts.ConversationRelayView, { t: (key) => key, openSession: () => {}, marksStore: storeOf({ coordinator: 'session-main' }), sessionId: 'session-cur' }))
  assert.match(tab, /EMBED:session-cur:embed-tab:/, '对话标签用当前会话、另一套页签前缀')
  assert.equal(typeof seen[0].onOpenUtility, 'function', 'utility 回调透传')
  assert.equal(typeof seen[0].t, 'function', '文案函数透传')
  assert.equal(typeof parts.LegacyBoardPage, 'function', '旧 BoardPage 仍导出给 utility 页')
  // TDZ 回归：BoardPage 打开 utility（概览 / 搜索）时 mainId 必须已初始化，不能抛 ReferenceError
  const originalUseState = React.useState
  let boardCalls = 0
  React.useState = (initial) => {
    if (/at BoardPage/.test(String(new Error().stack))) {
      boardCalls += 1
      if (boardCalls === 1) return ['overview', () => {}]
    }
    return originalUseState(initial)
  }
  let utilText = ''
  try {
    utilText = textOf(React.createElement(parts.BoardPage, { t: (key) => key, openSession: () => {}, marksStore: storeOf({ coordinator: 'session-main' }) }))
  } finally { React.useState = originalUseState }
  assert.ok(boardCalls >= 1, 'utility state 已注入')
  assert.match(utilText, /panelUtilityBack/, 'utility 打开不抛、返回栏渲染')
})

test('Client：面板、状态点、悬停卡片、页头 ID 在有数据时渲染不抛错', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const id = 'session-7ea4fd68-f693-4589-93e2-29868349ee4f'
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: { [id]: 'question' }, aliases: { [id]: ['rel'] }, attention: 1, coordinator: id, restart: 'off' }), refresh: async () => {} }
  const header = textOf(React.createElement(mod.HeaderId, { sessionId: id, marksStore: store, t }))
  assert.match(header, /★ @rel · 7ea4fd68/)
  const hoverTree = React.createElement(mod.RowHover, { sessionId: id, marksStore: store, t })
  const hoverText = textOf(hoverTree)
  assert.match(hoverText, new RegExp(id), '悬停卡保留完整 id')
  const hoverJson = JSON.stringify(hoverTree)
  assert.ok(hoverJson.includes('dshaSr_hoverRow'), '悬停卡改结构化行')
  assert.ok(hoverJson.includes('dshaSr_metaChip'), 'id 用等宽芯片')
  assert.ok(hoverText.includes('@main') && hoverText.includes('@rel'), '主会话与别名用胶囊')
  assert.notEqual(React.createElement(mod.RowMark, { sessionId: id, marksStore: store, t }), null)
  assert.equal(React.createElement(mod.RowMark, { sessionId: 'session-other', marksStore: store, t }), null, '没有状态不渲染')
  assert.match(textOf(React.createElement(mod.PanelIcon, { size: 18, marksStore: store })), /1/)
  const board = {
    coordinator: { sessionId: id, label: '@rel', exists: true }, line: { text: 'main=build280', setAt: 1, setBy: 'user' },
    entries: [{ sessionId: 'session-aa', label: '@w1', status: 'question', state: 'idle', summary: '要不要改', question: 'A 还是 B', updatedAt: 1 }],
    restart: { phase: 'off', text: '没有在等待。', busy: [] }, version: {}, defaultCwd: '/root/DSH-A-mod'
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const page = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store }))
  React.useState = original
  // 默认概览：主会话、版本线、计数、新建；不铺开看板和次要分区；分页标签带“需要处理”角标
  assert.match(page, /mainIs/)
  assert.match(page, /openTitle/)
  assert.match(page, /overviewCounts/)
  assert.match(page, /pageOverview[\s\S]*pageBoard1[\s\S]*pageSearch[\s\S]*pageOps/)
  assert.doesNotMatch(page, /要不要改|restartTitle/)
  calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const boardPage = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'board' }))
  React.useState = original
  assert.match(boardPage, /要不要改/)
  assert.doesNotMatch(boardPage, /mainIs|restartTitle/)
  calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const ops = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'ops' }))
  React.useState = original
  // 次要分区默认收起：只有标题和一行摘要
  assert.match(ops, /restartTitlefoldRestartIdle/)
  assert.doesNotMatch(ops, /restartStart/)
  // 本机记住展开后：内容出现
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ restart: true, open: true }), setItem: () => {} } }
  calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const opened = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'ops' }))
  React.useState = original
  delete globalThis.window
  assert.match(opened, /restartStart/)
  assert.doesNotMatch(opened, /foldRestartIdle/)
})

test('Client：协作标签带本会话身份卡片与范围切换', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const id = 'session-2b3fef60-00f7-4698-b7de-6111c3fdabd0'
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const board = {
    self: { sessionId: id, short: '2b3fef60', label: '2b3fef60', aliases: [], isMain: false, entry: null, participant: false },
    scope: 'workspace', workspace: { id: 'w', title: 'DSH-A-mod', path: '/root/DSH-A-mod', count: 5 }, hiddenByScope: 2,
    hiddenAttention: [{ sessionId: 'session-000bc230', label: '@t43b', status: 'blocked', workspace: 'DSH-A-mod', summary: '认领被拒' }],
    coordinator: null, line: null, entries: [], restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/root/DSH-A-mod'
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const text = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, sessionId: id, embedded: true }))
  React.useState = original
  assert.match(text, new RegExp(id))
  assert.match(text, /selfNotJoined/)
  assert.match(text, /joinSelf/)
  assert.match(text, /hiddenAttention[\s\S]*@t43b[\s\S]*认领被拒/)
  assert.match(text, /hiddenAttentionShow/)
  // 窄屏只显示短 id（CSS 切换），完整 id 仍在
  assert.match(text, /2b3fef60-00f7[\s\S]*2b3fef60/)
  calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const tab = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, sessionId: id, embedded: true, initialPage: 'board' }))
  React.useState = original
  assert.match(tab, /scopeWorkspace/)
  assert.match(tab, /scopeHidden/)
  assert.match(tab, /hiddenAttention/)
  assert.doesNotMatch(tab, /joinSelf/)
  assert.doesNotMatch(text, /panel/, '嵌入时不重复标题')
})

test('根上下文严格注入：不能直接读 connection 等未注入服务（复现 Cordis 的 cannot get property without inject）', async () => {
  const { createRelay } = await import('../lib/impl.js')
  const dir = await mkdtemp(join(tmpdir(), 'relay-strict-'))
  try {
    const allowed = { logger: { warn() {} }, get: () => undefined, sessions: { get: () => undefined, list: () => [] }, sessionController: { list: async () => ({ items: [] }) }, workspaceRegistry: { list: () => [] }, waterfall: async (_n, _p, next) => next() }
    const strict = new Proxy(allowed, { get(target, key) { if (typeof key === 'string' && !(key in target)) throw new Error(`cannot get property "${key}" without inject`); return target[key] } })
    let live
    const relay = createRelay(strict, { aliasPath: join(dir, 'a.json'), statePath: join(dir, 'c.json'), templatePath: join(dir, 't.json'), watchPath: join(dir, 'w.json'), watch: false, connection: () => live })
    await relay.ready()
    // 外壳的 web 子上下文还没就绪：503，不抛错
    let res = fakeRes(); await relay.routeHandler(fakeReq('GET'), res)
    assert.equal(res.status, 503)
    live = { requestRejection: () => undefined }
    res = fakeRes(); await relay.routeHandler(Object.assign(fakeReq('GET'), { url: '/api/dsha-session-relay?view=marks' }), res)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    res = fakeRes(); await relay.routeHandler(Object.assign(fakeReq('GET'), { url: '/api/dsha-session-relay?view=board&session=s1' }), res)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    res = fakeRes(); await relay.routeHandler(fakeReq('GET'), res)
    assert.equal(res.status, 200, JSON.stringify(res.body))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('Client 发出的看板请求能被路由正确解析（会话参数不被整体编码）', async () => {
  const { React } = fakeReact()
  const urls = []
  globalThis.fetch = async (url) => { urls.push(String(url)); return { ok: true, status: 200, json: async () => ({ ok: true, entries: [] }) } }
  globalThis.document = { visibilityState: 'visible', querySelector: () => null }
  const original = React.useEffect
  const realInterval = globalThis.setInterval
  React.useEffect = (fn) => { fn() }
  globalThis.setInterval = () => 0
  try {
    const mod = await loadClient(React)
    const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
    React.createElement(mod.LegacyBoardPage, { t: (k) => k, openSession() {}, marksStore: store, sessionId: 'session-2b3fef60-00f7-4698-b7de-6111c3fdabd0', embedded: true })
  } finally {
    React.useEffect = original
    globalThis.setInterval = realInterval
    delete globalThis.fetch
    delete globalThis.document
  }
  const url = new URL(urls[0], 'http://local')
  assert.equal(url.pathname, '/api/dsha-session-relay')
  assert.equal(url.searchParams.get('view'), 'board')
  assert.equal(url.searchParams.get('session'), 'session-2b3fef60-00f7-4698-b7de-6111c3fdabd0')
  assert.equal(url.searchParams.get('scope'), 'workspace')
})

test('Client：侧栏面板（无会话视角）按本机记住的工作区取看板，多个工作区时显示切换下拉', async () => {
  const { React } = fakeReact()
  const urls = []
  globalThis.fetch = async (url) => { urls.push(String(url)); return { ok: true, status: 200, json: async () => ({ ok: true, entries: [] }) } }
  globalThis.document = { visibilityState: 'visible', querySelector: () => null }
  const stored = {}
  const original = React.useEffect
  const realInterval = globalThis.setInterval
  let mod
  try {
    mod = await loadClient(React)
    globalThis.window = { localStorage: { getItem: (key) => (key === 'dshaSr.workspace.v1' ? 'ws-b' : stored[key] ?? null), setItem: (key, value) => { stored[key] = value }, removeItem: (key) => { delete stored[key] } } }
    React.useEffect = (fn) => { fn() }
    globalThis.setInterval = () => 0
    const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
    React.createElement(mod.LegacyBoardPage, { t: (k) => k, openSession() {}, marksStore: store })
  } finally {
    React.useEffect = original
    globalThis.setInterval = realInterval
    delete globalThis.fetch
    delete globalThis.document
    delete globalThis.window
  }
  const url = new URL(urls[0], 'http://local')
  assert.equal(url.searchParams.get('view'), 'board')
  assert.equal(url.searchParams.get('workspace'), 'ws-b')
  assert.equal(url.searchParams.get('session'), null)
  // 渲染：两个工作区时有下拉，当前选中看板所在的工作区
  const board = {
    entries: [], others: [], groupKey: 'ws-b', workspace: { id: 'ws-b', title: 'B', path: '/b' },
    workspaces: [{ id: 'ws-a', title: 'A', path: '/a', hasMain: true }, { id: 'ws-b', title: 'B', path: '/b', hasMain: false }, { id: 'ws-gone', title: 'GONE', path: '/gone', hasMain: true, registered: false }]
  }
  const realState = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : realState(initial))
  globalThis.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }
  let text
  try {
    text = textOf(React.createElement(mod.LegacyBoardPage, { t: (k) => k, openSession() {}, marksStore: { subscribe: () => () => {}, getSnapshot: () => ({}), refresh: async () => {} } }))
  } finally { React.useState = realState; delete globalThis.window }
  assert.match(text, /wsPick/)
  assert.match(text, /wsPickAwsPickMainBpageOverview/, '两个选项：A（有主会话）、B')
  assert.ok(!text.includes('GONE'), '已从侧栏删除的工作区不出现在选项里')
})

test('Client：设置页每个工作区一条版本线；协作标签列出未加入的会话', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const data = {
    templates: [], limits: { text: 16000, line: 1500 }, reference: [], notes: [], version: {}, line: null,
    groups: [
      { id: 'ws-a', title: 'DSH-A-mod', path: '/root/DSH-A-mod', registered: true, count: 91, primary: true, coordinator: { sessionId: 's1', label: '@rel' }, line: { text: 'A 基线 build280', setAt: 1, setBy: 'model' } },
      { id: 'ws-b', title: 'default-workspace', path: '/root/x', registered: true, count: 1, primary: false, coordinator: null, line: null }
    ]
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (calls++ === 0 ? [data, () => {}] : original(initial))
  const settings = textOf(React.createElement(mod.SessionRelaySettings, { t }))
  React.useState = original
  assert.match(settings, /DSH-A-mod/)
  assert.match(settings, /default-workspace/)
  assert.match(settings, /lineWsMain/)
  assert.match(settings, /lineSetBy/)
  assert.match(settings, /lineWsNoMain/)
  const id = 'session-2b3fef60-00f7-4698-b7de-6111c3fdabd0'
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const board = {
    self: { sessionId: id, short: '2b3fef60', label: '2b3fef60', aliases: [], isMain: false, entry: null, participant: false, seesLine: true },
    scope: 'workspace', workspace: { id: 'ws-a', title: 'DSH-A-mod', path: '/root/DSH-A-mod', count: 91 }, hiddenByScope: 0,
    coordinator: { sessionId: 's1', label: '@rel', exists: true }, line: { text: 'A 基线', setAt: 1, setBy: 'model' }, entries: [],
    others: [{ sessionId: 'session-99999999-0000', label: 'x', title: '扫一遍仓库', state: 'cold', updatedAt: 1, optOut: false }], othersTotal: 40,
    restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/root/DSH-A-mod'
  }
  calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const view = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, sessionId: id, embedded: true }))
  React.useState = original
  assert.match(view, /selfObserver/)
  calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const othersView = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, sessionId: id, embedded: true, initialPage: 'board' }))
  React.useState = original
  assert.match(othersView, /othersTitlefoldOthersSum/)
  assert.doesNotMatch(othersView, /扫一遍仓库/)
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ others: true }), setItem: () => {} } }
  calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const expanded = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, sessionId: id, embedded: true, initialPage: 'board' }))
  React.useState = original
  delete globalThis.window
  assert.match(expanded, /扫一遍仓库/)
  assert.match(expanded, /othersMore/)
})

test('Client：交接面板与侧栏标记（实心星、加入即空心圈）', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const main = 'session-7ea4fd68-f693-4589-93e2-29868349ee4f'
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: { [main]: 'main', 'session-j': 'joined', 'session-d': 'done', 'session-x': 'abandoned' }, aliases: {}, attention: 0, coordinator: main, restart: 'off' }), refresh: async () => {} }
  const mark = (id) => React.createElement(mod.RowMark, { sessionId: id, marksStore: store, t })
  assert.ok(JSON.stringify(mark(main)).includes('dshaSr_starIcon'), '主会话是 SVG 实心星')
  assert.ok(JSON.stringify(mark('session-j')).includes('"joined"'), '加入即空心圈')
  assert.ok(JSON.stringify(mark('session-d')).includes('"done"'))
  assert.equal(mark('session-x'), null)
  assert.equal(mark('session-none'), null, '没加入的不显示')
  const board = {
    scope: 'workspace', workspace: { id: 'ws-a', title: 'A', path: '/a', count: 3 }, hiddenByScope: 0,
    coordinator: { sessionId: main, label: '@rel', exists: true }, line: null, entries: [], others: [{ sessionId: 'session-o', label: 'o', title: '另一个', state: 'idle', updatedAt: 1 }], othersTotal: 1,
    handoff: { group: 'ws-a', coordinator: main, draft: { id: 'd', notes: '下一步：推 281', by: 'model', updatedAt: 1 }, snapshot: '版本线：未公告', history: [{ at: 2, from: 'session-old', to: main, fromLabel: '@old', toLabel: '@rel' }, { at: 1, from: 'session-older', to: 'session-old', fromLabel: '@older', toLabel: '@old' }] },
    restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a'
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const page = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'ops' }))
  React.useState = original
  assert.match(page, /hoTitle/)
  assert.match(page, /hoDraftBy/)
  assert.match(page, /hoConfirm/)
  assert.match(page, /hoRevert/)
  // 最近交接只列最近一条，其余收在「全部 n 条」里
  assert.match(page, /@old.*→.*@rel/)
  assert.doesNotMatch(page, /@older → @old/)
  assert.match(page, /hoHistoryMore/)
})

test('Client：看板卡片显示已答复、队列号、已分配、占用重叠与分配按钮', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const board = {
    scope: 'workspace', workspace: null, hiddenByScope: 0, coordinator: null, line: null, others: [], othersTotal: 0,
    entries: [
      { sessionId: 'session-a', label: '@a', status: 'question', answered: true, state: 'idle', summary: 'q', updatedAt: 1, conflicts: [{ with: 'session-b', label: '@b', paths: ['app/ui'] }] },
      { sessionId: 'session-b', label: '@b', status: 'ready', queue: 1, state: 'idle', summary: 'r', updatedAt: 1, conflicts: [] },
      { sessionId: 'session-c', label: '@c', status: 'ready', assigned: 'build281', state: 'idle', summary: 'r', updatedAt: 1 }
    ],
    restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a'
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const page = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'board' }))
  React.useState = original
  for (const key of ['answered', 'queueNo', 'assignedTo', 'conflict', 'assign']) assert.match(page, new RegExp(key))
})

test('Client：卡片「唤醒」表单显示预判，主会话新建时禁用确认', async () => {
  const { React, rendered } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const board = {
    scope: 'workspace', workspace: null, hiddenByScope: 0, coordinator: null, line: null, others: [], othersTotal: 0,
    entries: [{ sessionId: 'session-a', label: '@a', status: 'working', state: 'idle', summary: 's', updatedAt: 1 }],
    restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a'
  }
  const render = (wakeInfo) => {
    rendered.length = 0
    const original = React.useState
    let calls = 0
    let inCard = 0
    // EntryCard 里第 1 个 useState 是 mode，第 12 个是 wakeInfo（第 6 个是新建会话的模型）
    React.useState = (initial) => {
      calls += 1
      if (calls === 2) return [board, () => {}]
      if (/at EntryCard/.test(new Error().stack)) {
        inCard += 1
        if (inCard === 1) return ['wake', () => {}]
        if (inCard === 12) return [wakeInfo, () => {}]
      }
      return original(initial)
    }
    try { return textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'board' })) } finally { React.useState = original }
  }
  const confirm = () => rendered.find((node) => node.type === 'button' && node.children.includes('wakeConfirm'))
  const plans = (auto) => ({ auto, resume: { action: 'resume', reason: 'r' }, new: { action: 'new', reason: 'n' } })
  let page = render({ sessionId: 'session-a', contextTokens: 446000, coordinator: false, busy: false, reasons: [], notes: [], plans: plans({ action: 'new', reason: '上下文约 446k' }) })
  for (const key of ['wakeTitle', 'wakeAuto', 'wakeResume', 'wakeNew', 'wakeWill', 'wakeHint', 'wakeConfirm']) assert.match(page, new RegExp(key))
  const placeholders = rendered.map((node) => node.props.placeholder).filter(Boolean)
  assert.ok(placeholders.includes('wakeAlias') && placeholders.includes('wakeNote'), '新建时有别名与补充说明')
  assert.ok(confirm(), '有确认按钮')
  assert.notEqual(confirm().props.disabled, true)
  page = render({ sessionId: 'session-a', contextTokens: 446000, coordinator: true, busy: false, reasons: [], notes: [], plans: plans({ action: 'new', reason: 'x' }) })
  assert.match(page, /wakeMain/)
  assert.equal(confirm().props.disabled, true)
  page = render(undefined)
  assert.match(page, /wakeChecking/)
  assert.equal(confirm().props.disabled, true)
})

test('Client：看板卡片与合并队列的 meta 用芯片，长摘要两行截断并带悬停全文', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  // files 在字典里是带占位符的格式串：这里模拟真实 t，防止把 `占用：{v}` 直接渲染出来
  const t = (key) => key === 'files' ? '占用：{v}' : key
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const summary = 'S'.repeat(240)
  const board = {
    scope: 'workspace', workspace: null, hiddenByScope: 0, coordinator: null, line: null, others: [], othersTotal: 0,
    entries: [
      { sessionId: 'session-a', label: '@a', status: 'ready', category: 'attention', state: 'idle', summary, updatedAt: 1, branch: 'feat/x', commit: 'abcdef1234', model: 'deepseek-flash', queue: 1, assigned: 'build301', files: 'a.js, b.js', declaration: { rel: '.agents/worktrees/feat/x', mergeLabel: '可合并', kind: 'done', build: 'build301', count: 2 } }
    ],
    restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a'
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const tree = React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'board' })
  React.useState = original
  const text = textOf(tree)
  const json = JSON.stringify(tree)
  assert.ok(json.includes('dshaSr_metaChip'), '分支 / 提交 / 模型 / 时间用芯片')
  for (const part of ['feat/x', 'abcdef1234', 'deepseek-flash', 'build301', '可合并']) assert.ok(json.includes(part), '缺少 ' + part)
  assert.ok(json.includes('dshaSr_metaChips'), 'meta 芯片成组渲染')
  assert.ok(json.includes(summary), '摘要保留全文（悬停 title）')
  assert.ok(text.includes('filesLabel'), '占用文件标签用纯标签 key')
  assert.ok(text.includes('a.js') && text.includes('b.js'), '占用文件仍逐个显示')
  assert.ok(!text.includes('{v}'), '不把带占位符的格式串直接渲染出来')
  assert.ok(text.includes('.agents/worktrees/feat/x'), '工作树声明路径仍在')
})

test('Client：看板按插件分类分组，归档条目进右栏「归档」分区，原因标签显示', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const board = {
    scope: 'workspace', workspace: null, hiddenByScope: 0, coordinator: null, line: null, others: [], othersTotal: 0,
    entries: [
      { sessionId: 'session-a', label: '@a', status: 'working', category: 'attention', categoryReason: 'failed', categoryDetail: 'EMPTY_RESPONSE', state: 'idle', summary: 's', updatedAt: 1 },
      { sessionId: 'session-b', label: '@b', status: 'ready', category: 'ready', queue: 1, state: 'idle', summary: 'r', updatedAt: 1 },
      { sessionId: 'session-c', label: '@c', status: 'ready', category: 'archived', categoryReason: 'merged', mainMerged: 'main abc', state: 'idle', summary: 'old', updatedAt: 1 }
    ],
    restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a'
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const page = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'board' }))
  React.useState = original
  for (const key of ['catAttention', 'catReady', 'why_failed', 'archiveTitle', 'foldArchiveSum']) assert.match(page, new RegExp(key))
  assert.doesNotMatch(page, /catActive|boardEmpty/)
})

test('Client：核验记录用本地化状态胶囊（完成 / 已取消），未知状态显示原值', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const board = {
    scope: 'workspace', workspace: null, hiddenByScope: 0, coordinator: null, line: null, entries: [], others: [], othersTotal: 0, taskBoard: undefined,
    watches: [
      { id: 'w1', state: 'done', line: 'CI 1 完成', what: 'CI 1', checkedAt: 1 },
      { id: 'w2', state: 'cancelled', line: 'CI 2 已取消', what: 'CI 2', checkedAt: 1 },
      { id: 'w3', state: 'failed', line: 'CI 3 失败', what: 'CI 3', checkedAt: 1 },
      { id: 'w4', state: 'quarantined', line: 'CI 4 未知', what: 'CI 4', checkedAt: 1 }
    ],
    restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a'
  }
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ watch: true }), setItem() {} } }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  let text
  try { text = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'ops' })) } finally { React.useState = original; delete globalThis.window }
  for (const part of ['verifyStateDone', 'verifyStateCancelled', 'verifyStateFailed', 'quarantined']) assert.ok(text.includes(part), '缺少 ' + part)
  assert.ok(!text.includes('>active<'), '不把未知状态当 active')
})

test('Client：卡片默认折叠（只留摘要与展开按钮），需要处理的自动展开；久未活动 / 空白分组默认收起', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  // 把参数也带出来，才能看出占用 / 最近一轮有没有渲染
  const t = (key) => `${key}:{v}`
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const board = {
    scope: 'workspace', workspace: null, hiddenByScope: 0, coordinator: null, line: null, others: [], othersTotal: 0,
    entries: [
      { sessionId: 'session-a', label: '@a', status: 'working', category: 'active', state: 'idle', summary: 's', files: 'SECRET_FILES', lastTurn: 'SECRET_TURN', lastTurnAt: 9, reportedAt: 1, updatedAt: 1, conflicts: [{ with: 'session-b', label: '@b', paths: ['x'] }] },
      { sessionId: 'session-b', label: '@b', status: 'blocked', category: 'attention', categoryReason: 'blocked', state: 'idle', summary: 'b', files: 'OPEN_FILES', updatedAt: 1 },
      { sessionId: 'session-c', label: '@c', status: 'working', category: 'blank', state: 'cold', summary: 'BLANK_SUMMARY', updatedAt: 1 }
    ],
    restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a'
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const page = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'board' }))
  React.useState = original
  assert.match(page, /cardMore/)
  assert.match(page, /conflictCount/)
  assert.doesNotMatch(page, /SECRET_FILES|SECRET_TURN/, '折叠时不显示占用与最近一轮')
  assert.match(page, /OPEN_FILES/, '需要处理的卡片展开')
  assert.match(page, /catBlank/)
  assert.doesNotMatch(page, /BLANK_SUMMARY/, '空白分组默认收起')
})

test('Client：找会话结果——看板条目用完整卡片，其它会话带打开 / 加入；路由空查询拒绝', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const found = { scope: 'all', total: 3, results: [
    { kind: 'board', entry: { sessionId: 'session-000bc230-1', label: '@t43b', status: 'blocked', state: 'idle', summary: '认领被拒', updatedAt: 1, category: 'attention' } },
    { kind: 'other', session: { sessionId: 'session-000bc231-2', label: 'x', title: '别的会话', aliases: ['foo'], state: 'cold', updatedAt: 1, isMain: false, optOut: false, workspace: 'A' } }
  ], candidates: [] }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [found, () => {}] : original(initial))
  const text = textOf(React.createElement(mod.SessionFind, { t: (k) => k, scope: 'all', onScopeChange() {}, openSession() {}, busy: false, act: async () => ({}), copy() {}, flash() {}, sessionId: 'session-me' }))
  React.useState = original
  for (const key of ['findTitle', 'findMainOnly', 'findCount', '认领被拒', '别的会话', '@foo', 'joinThis', 'openSession', 'inWorkspace']) assert.match(text, new RegExp(key))
  const handler = createHandler({ requestRejection: () => undefined }, { findSessions: async () => { throw new Error('不该调用') } })
  const res = fakeRes()
  await handler(Object.assign(fakeReq('GET'), { url: '/api/dsha-session-relay?view=find&q=%20' }), res)
  assert.equal(res.status, 400)
  assert.equal(res.body.error, 'empty_query')
  const seen = []
  const ok = createHandler({ requestRejection: () => undefined }, { findSessions: async (options) => { seen.push(options); return { results: [] } } })
  const res2 = fakeRes()
  await ok(Object.assign(fakeReq('GET'), { url: '/api/dsha-session-relay?view=find&q=&main=1&scope=all' }), res2)
  assert.equal(res2.status, 200)
  assert.equal(seen[0].mainOnly, true)
  assert.equal(seen[0].scope, 'all')
})

test('Client：概览页的「等你决定」、唤醒暂停横幅 / 计数行、「初始化」卡片与常设授权', async () => {
  const { React, rendered } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const id = 'session-2b3fef60-00f7-4698-b7de-6111c3fdabd0'
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const base = {
    self: null, scope: 'workspace', workspace: { id: 'w', title: 'W', path: '/p', count: 1 }, groupKey: 'w',
    coordinator: null, line: null, entries: [], restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/p',
    delegation: null, delegationDefault: '建议的授权文字', delegationLimit: 600
  }
  const render = (board, props = {}) => {
    const original = React.useState
    let calls = 0
    React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
    try { return textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'overview', ...props })) } finally { React.useState = original }
  }
  // 缺东西：初始化卡片逐项列出；没有会话视角时不给「设本会话为主会话」，改给提示
  let text = render({ ...base, setup: { hasMain: false, hasLine: false, hasTaskBoard: false, isGitRepo: false, root: '/p' } })
  assert.match(text, /setupTitle/)
  assert.match(text, /setupNoMain[\s\S]*setupMainHint/)
  assert.doesNotMatch(text, /setupSetMain/)
  assert.match(text, /setupNoLine[\s\S]*setupLineSave/)
  assert.match(text, /setupNoBoard[\s\S]*setupInitBoard/)
  assert.match(text, /setupNotGit/)
  assert.ok(rendered.some((node) => node.type === 'textarea' && node.props.value === 'setupLineTemplate'), '版本线编辑框预填模板')
  // 有会话视角：按钮出现
  text = render({ ...base, setup: { hasMain: false, hasLine: true, hasTaskBoard: true, isGitRepo: true, root: '/p' } }, { sessionId: id, embedded: true })
  assert.match(text, /setupSetMain/)
  assert.doesNotMatch(text, /setupNoBoard|setupNotGit|setupNoLine/)
  // 什么都不缺：卡片不出现
  text = render({ ...base, setup: { hasMain: true, hasLine: true, hasTaskBoard: true, isGitRepo: true, root: '/p' } })
  assert.doesNotMatch(text, /setupTitle/)
  // 没有目录：只给提示
  text = render({ ...base, setup: { hasMain: true, hasLine: true, hasTaskBoard: false, isGitRepo: false, root: null } })
  assert.match(text, /setupNoRoot/)
  assert.doesNotMatch(text, /setupInitBoard/)
  // 等你决定：每个选项一个按钮 + 忽略，排在最上面；计数行
  const asks = [{ id: 'a1', question: 'build281 给谁', options: ['lint', 'adb'], about: 'session-x', aboutLabel: '@lint', by: 'session-m', byLabel: '@main', at: 1 }]
  text = render({ ...base, asks, unattended: { wakesThisHour: 3, limit: 16, approxTokensThisHour: 1_250_000, paused: false, pausedAt: null } })
  assert.match(text, /^[\s\S]*?askTitle（1）build281 给谁[\s\S]*lintadbaskDismiss/)
  assert.match(text, /askAbout/)
  assert.match(text, /wakeLine/)
  assert.doesNotMatch(text, /wakePaused/)
  assert.match(text, /delegTitle/)
  // 开发者模式：开启时概览顶部有提示和关闭按钮；交接与核验页有开关
  text = render({ ...base, devMode: { enabled: true, until: 2_000_000_000_000, enabledAt: 1, defaultHours: 2, maxHours: 24 } })
  assert.match(text, /devBanner[\s\S]*devDisable/)
  text = render({ ...base, devMode: { enabled: false, until: null, enabledAt: null, defaultHours: 2, maxHours: 24 } })
  assert.doesNotMatch(text, /devBanner/)
  text = render({ ...base, devMode: { enabled: false, until: null, enabledAt: null, defaultHours: 2, maxHours: 24 } }, { initialPage: 'ops' })
  assert.match(text, /devTitle/)
  // GitHub 账号：换号时折叠标题标红；登录进行中自动展开，显示验证码与取消
  const gh = (extra) => ({ match: 'ok', source: 'gh', state: 'ready', login: 'alice', accountId: 101, scopes: ['repo'], error: null, checkedAt: 1, pinned: { accountId: 101, login: 'alice' }, loginFlow: null, ...extra })
  text = render({ ...base, github: gh({ match: 'mismatch', login: 'mallory', accountId: 666 }) }, { initialPage: 'ops' })
  // 不一致时默认展开，直接看到说明与重新锁定
  assert.match(text, /ghTitle[\s\S]*ghPinnedBad[\s\S]*ghRepin/)
  text = render({ ...base, github: gh({ match: 'missing', state: 'missing', login: null, accountId: null, pinned: null, loginFlow: { state: 'pending', userCode: 'WXYZ-1234', verificationUri: 'https://github.com/login/device', opened: true } }) }, { initialPage: 'ops' })
  assert.match(text, /ghCode[\s\S]*WXYZ-1234[\s\S]*ghCodeOpened[\s\S]*ghCancel/)
  assert.doesNotMatch(text, /ghLogin/)
  // 暂停：横幅 + 继续
  text = render({ ...base, unattended: { wakesThisHour: 16, limit: 16, approxTokensThisHour: 0, paused: true, pausedAt: 1 } })
  assert.match(text, /wakePaused[\s\S]*wakeResume/)
  // 计数文字（真实词典格式）
  const zhLine = (() => {
    const original = React.useState
    let calls = 0
    React.useState = (initial) => (++calls === 2 ? [{ ...base, unattended: { wakesThisHour: 3, limit: 16, approxTokensThisHour: 1_250_000, paused: false, pausedAt: null } }, () => {}] : original(initial))
    try { return textOf(React.createElement(mod.LegacyBoardPage, { t: (key) => ({ wakeLine: '本小时自动唤醒 {n}/{limit} 次，约 {tokens} token' })[key] ?? key, openSession: () => {}, marksStore: store, initialPage: 'overview' })) } finally { React.useState = original }
  })()
  assert.match(zhLine, /本小时自动唤醒 3\/16 次，约 1\.3M token/)
  // 常设授权展开后：未设定时预填建议文字
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ deleg: true }), setItem: () => {} } }
  try {
    rendered.length = 0
    text = render(base)
    assert.match(text, /delegHint/)
    assert.ok(rendered.some((node) => node.type === 'textarea' && node.props.value === '建议的授权文字'))
  } finally { delete globalThis.window }
  // 旧服务端（没有这些字段）不出错
  text = render({ ...base, delegationDefault: undefined, asks: undefined, unattended: undefined, setup: undefined })
  assert.doesNotMatch(text, /setupTitle|askTitle|wakeLine|delegTitle/)
})

test('Client：模型下拉（跟随 / 全局默认 / 按服务商分组 / 推理强度）与概览页角色模型；只读模型列表时说明不支持', async () => {
  const { React, rendered } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const models = {
    supported: true,
    catalog: { default: { provider: 'p1', model: 'base' }, groups: [{ id: 'p1', name: 'P1', models: [{ id: 'base', name: 'base' }, { id: 'big', name: 'Big', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' }] }], failures: [] },
    roles: { main: null, worker: { provider: 'p1', model: 'big', reasoningEffort: 'high' } },
    labels: { main: null, worker: 'p1/big@high', default: 'p1/base' }
  }
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const board = {
    scope: 'workspace', workspace: { id: 'ws-a', title: 'A', path: '/a' }, groupKey: 'ws-a', coordinator: { sessionId: 's-main', label: '@main', exists: true, model: 'p1/base' }, line: null,
    others: [], entries: [], restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a', roleModels: { main: null, worker: 'p1/big@high' }
  }
  const original = React.useState
  let calls = 0
  // BoardPage 第 2 个 useState 是看板；模型数据由 useModels 的 useState 给出
  React.useState = (initial) => {
    calls += 1
    if (calls === 2) return [board, () => {}]
    if (/at useModels/.test(new Error().stack)) return [models, () => {}]
    return original(initial)
  }
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ models: true, open: true }), setItem() {}, removeItem() {} } }
  let text
  try { text = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession() {}, marksStore: store, initialPage: 'overview' })) } finally { React.useState = original; delete globalThis.window }
  assert.match(text, /modelRolesTitle/)
  assert.match(text, /modelRoleMain[\s\S]*modelRoleWorker/)
  assert.match(text, /modelIs/, '主会话卡片显示模型')
  // 模型选择器改成自绘：不再用原生 <select>/<option>（Android WebView 会整屏弹原生列表）
  const pickers = rendered.filter((node) => node.type === 'button' && node.props['aria-haspopup'] === 'listbox')
  assert.ok(pickers.length >= 1, '新建表单用的是自绘模型选择器')
  assert.ok(textOf(pickers[0]).includes('modelFollowIs'), '默认显示「跟随默认」')
  // 推理强度也改成自绘分段：已选具体模型（worker = p1/big@high）时出现 Low/High，当前值选中
  const effortButtons = rendered.filter((node) => node.type === 'button' && node.props['aria-pressed'] !== undefined && ['Low', 'High'].includes(textOf(node)))
  assert.ok(effortButtons.some((node) => textOf(node) === 'Low'), '给出可用强度')
  assert.ok(effortButtons.some((node) => textOf(node) === 'High' && node.props['aria-pressed'] === 'true'), '当前强度选中')
  assert.ok(!rendered.some((node) => node.type === 'select' && node.props['aria-label'] === 'modelEffort'), '强度不再用原生 select')
  // 不支持时只给一行说明
  rendered.length = 0
  calls = 0
  React.useState = (initial) => {
    calls += 1
    if (calls === 2) return [board, () => {}]
    if (/at useModels/.test(new Error().stack)) return [null, () => {}]
    return original(initial)
  }
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ models: true, open: true }), setItem() {}, removeItem() {} } }
  try { text = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession() {}, marksStore: store, initialPage: 'overview' })) } finally { React.useState = original; delete globalThis.window }
  assert.match(text, /modelUnsupported/)
  // 不支持时以「一行说明」为准；渲染树里可能还留着上一轮的节点，不按节点数量断言
})

test('面板仓库动作：repo-switch / repo-refresh 走用户动作，返回新看板', async () => {
  const calls = []
  const relay = {
    async ready() {},
    async setRepoSwitch(args) { calls.push(['switch', args]); return { repo: 'o/r', key: 'issues', enabled: true, changed: true } },
    async refreshRepo(args) { calls.push(['refresh', args]); return { available: true, repo: 'o/r' } },
    async board() { return { entries: [] } }
  }
  const out = await perform(relay, { action: 'repo-switch', key: 'issues', enabled: true, workspaceId: 'ws-a' })
  assert.deepEqual(out.result, { repo: 'o/r', key: 'issues', enabled: true, changed: true })
  assert.deepEqual(calls[0], ['switch', { sessionId: undefined, workspaceId: 'ws-a', key: 'issues', enabled: true }])
  const refreshed = await perform(relay, { action: 'repo-refresh', workspaceId: 'ws-a' })
  assert.deepEqual(refreshed.result.repo, { available: true, repo: 'o/r' })
  assert.deepEqual(calls[1], ['refresh', { sessionId: undefined, workspaceId: 'ws-a' }])
})

test('面板写回 Projects：project-status-write 走用户动作', async () => {
  const calls = []
  const relay = {
    async ready() {},
    async writeProjectStatus(args) { calls.push(args); return { ok: true, status: 'In Progress' } },
    async board() { return { entries: [] } }
  }
  const out = await perform(relay, { action: 'project-status-write', task: 't3', fromSession: 's1' })
  assert.deepEqual(calls[0], { sessionId: 's1', taskId: 't3' })
  assert.deepEqual(out.result, { ok: true, status: 'In Progress' })
  await assert.rejects(perform(relay, { action: 'project-status-write', task: 't3' }), /需要会话视角/)
})

test('项目状态只读接口：按会话与任务读，缺少会话报错', async () => {
  const seen = []
  const relay = {
    async ready() {},
    async projectStatusFor(args) { seen.push(args); return { available: true, state: 'ok', status: 'In Progress', project: '路线图' } }
  }
  const handler = createHandler({ requestRejection: () => undefined }, relay)
  const res = fakeRes()
  await handler(Object.assign(fakeReq('GET'), { url: '/api/dsha-session-relay?view=project-status&session=s1&task=t3' }), res)
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.deepEqual(res.body.projectStatus, { available: true, state: 'ok', status: 'In Progress', project: '路线图' })
  assert.deepEqual(seen[0], { sessionId: 's1', taskId: 't3' })
  const miss = fakeRes()
  await handler(Object.assign(fakeReq('GET'), { url: '/api/dsha-session-relay?view=project-status&task=t3' }), miss)
  assert.equal(miss.status >= 400, true)
})

test('面板任务审批：task-approval 走用户动作，返回新看板', async () => {
  const calls = []
  const relay = {
    async ready() {},
    async taskApproval(session, args) { calls.push([session, args]); return 'ok' },
    async board() { return { entries: [] } }
  }
  await perform(relay, { action: 'task-approval', id: 't3', approved: true, note: '可以合', fromSession: 's1' })
  await perform(relay, { action: 'task-approval', id: 'T3', approved: false, fromSession: 's1' })
  assert.deepEqual(calls, [
    ['s1', { id: 'T3', approved: true, note: '可以合' }],
    ['s1', { id: 'T3', approved: false, note: undefined }]
  ])
  await assert.rejects(perform(relay, { action: 'task-approval', id: 'T3', approved: true }), /需要会话视角/)
})

test('面板同步队列动作：flush / backfill / pause / retry / detach 走用户动作，返回新看板', async () => {
  const calls = []
  let boards = 0
  const relay = {
    async ready() {},
    async syncAction(session, command) { calls.push([session, command]); return 'ok' },
    async board() { boards += 1; return { entries: [] } }
  }
  await perform(relay, { action: 'sync-flush', fromSession: 's1' })
  await perform(relay, { action: 'sync-backfill', fromSession: 's1' })
  await perform(relay, { action: 'sync-pause', paused: true, fromSession: 's1' })
  await perform(relay, { action: 'sync-retry', id: 't3', fromSession: 's1' })
  await perform(relay, { action: 'sync-detach', id: 'T3', fromSession: 's1' })
  assert.deepEqual(calls, [
    ['s1', { kind: 'sync-flush' }],
    ['s1', { kind: 'sync-backfill' }],
    ['s1', { kind: 'sync-pause', paused: true }],
    ['s1', { kind: 'sync-retry', id: 'T3' }],
    ['s1', { kind: 'sync-detach', id: 'T3' }]
  ])
  assert.equal(boards, 5, '每个动作后返回新看板')
  await assert.rejects(perform(relay, { action: 'sync-retry', id: 'x', fromSession: 's1' }), /任务号无效/)
  await assert.rejects(perform(relay, { action: 'sync-flush' }), /需要会话视角/)
})

test('面板 GitHub 仓库：显示能力探测与开关，不可用开关带原因', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const base = {
    scope: 'workspace', workspace: { id: 'ws-a', title: 'A', path: '/a' }, hiddenByScope: 0, coordinator: null, line: null,
    others: [], othersTotal: 0, entries: [], restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a'
  }
  const render = (repo) => {
    const board = { ...base, repo }
    const original = React.useState
    let calls = 0
    React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
    globalThis.window = { localStorage: { getItem: (key) => (key === 'dshaSr.fold.v1' ? JSON.stringify({ repo: true }) : null), setItem() {}, removeItem() {} } }
    try { return textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'ops' })) } finally { React.useState = original; delete globalThis.window }
  }
  const ok = render({
    available: true, repo: 'o/r', source: 'ok', probedAt: 1_700_000_000_000,
    repoInfo: { hasIssues: true, hasProjects: true, merge: { merge: true, squash: false, rebase: true } },
    protection: { state: 'none', requiredReviews: 0, requiredChecks: [] }, labels: ['bug', 'help'], labelsState: 'ok', subIssues: 'unsupported',
    switches: [
      { key: 'issues', label: 'issue 投影', hint: '按任务建票', enabled: false, available: true },
      { key: 'mapIssues', label: '地图票', hint: '子票', enabled: false, available: false, reason: '仓库/gh 不支持 sub-issues' }
    ]
  })
  for (const part of ['repoTitle', 'o/r', 'repoProbeOk', 'repoCapIssues', 'repoCapIssues repoOn', 'repoCapMerge', 'repoRefresh', 'issue 投影', 'repoUnavailable', '仓库/gh 不支持 sub-issues']) {
    assert.ok(ok.includes(part), '缺少 ' + part)
  }
  const missing = render({ available: false, reason: '这个目录没有 origin' })
  assert.match(missing, /repoTitle/)
  assert.match(missing, /repoNoRepo/)
  assert.match(missing, /这个目录没有 origin/)
})

test('协作面板 GitHub 仓库：同步队列只读展示', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: {}, aliases: {}, attention: 0, coordinator: null, restart: 'off' }), refresh: async () => {} }
  const board = {
    scope: 'workspace', workspace: { id: 'ws-a', title: 'A', path: '/a' }, hiddenByScope: 0, coordinator: null, line: null,
    others: [], othersTotal: 0, entries: [], restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a',
    repo: {
      available: true, repo: 'o/r', source: 'ok', probedAt: 1,
      repoInfo: { hasIssues: true, hasProjects: true, merge: { merge: true } }, protection: { state: 'none' }, labels: 0, labelsState: 'ok', subIssues: 'unknown',
      switches: [{ key: 'issues', label: 'issue 投影', enabled: true, available: true }]
    },
    sync: {
      available: true, repo: 'o/r', paused: false, queue: 1, switches: { issues: true },
      links: [{ id: 'T1', issue: 7, url: 'https://github.com/o/r/issues/7', state: 'synced' }, { id: 'T2', issue: null, url: null, state: 'unknown', lastError: 'timeout' }]
    }
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  globalThis.window = { localStorage: { getItem: (key) => (key === 'dshaSr.fold.v1' ? JSON.stringify({ repo: true }) : null), setItem() {}, removeItem() {} } }
  let text
  try { text = textOf(React.createElement(mod.LegacyBoardPage, { t, openSession: () => {}, marksStore: store, initialPage: 'ops' })) } finally { React.useState = original; delete globalThis.window }
  assert.match(text, /syncTitle/)
  assert.match(text, /T1/)
  assert.match(text, /#7/)
  assert.match(text, /syncStateSynced/)
  assert.match(text, /T2/)
  assert.match(text, /syncStateUnknown/)
})
