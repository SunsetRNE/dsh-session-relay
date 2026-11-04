/** 设置页「会话协作」：Host 路由与 Client 组件冒烟测试（不启动浏览器）。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { SessionRelay } from '../lib/impl.js'
import { createHandler, perform, snapshot } from '../lib/settings-route.js'
import { COMMAND_REFERENCE, HELP_TEXT } from '../lib/core.js'

async function makeRelay() {
  const dir = await mkdtemp(join(tmpdir(), 'relay-settings-'))
  const relay = new SessionRelay({ logger: { warn() {} }, get: () => undefined, sessions: { get: () => undefined } }, {
    aliasPath: join(dir, 'aliases.json'), statePath: join(dir, 'coordination.json'), templatePath: join(dir, 'templates.json'), handoffPath: join(dir, 'handoffs.json'), watchPath: join(dir, 'watches.json'), watch: false
  })
  await relay.ready()
  return { dir, relay, cleanup: () => rm(dir, { recursive: true, force: true }) }
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
  delete globalThis.window
  return mod
}

function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.children)
}

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
  assert.deepEqual(Object.keys(byName).sort(), ['conversation.session.header.utilities', 'conversation.view', 'main', 'settings.section', 'sidebar.panellist', 'sidebar.session.row.hover', 'sidebar.session.row.leading'])
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
    const text = textOf(full)
    assert.match(text, /lineTitle/)
    assert.match(text, /claim/)
    assert.match(text, /refTitle/)
    assert.match(text, /\/relay tpl save claim/)
  } finally { await h.cleanup() }
})

test('Client：面板、状态点、悬停卡片、页头 ID 在有数据时渲染不抛错', async () => {
  const { React } = fakeReact()
  const mod = await loadClient(React)
  const t = (key) => key
  const id = 'session-7ea4fd68-f693-4589-93e2-29868349ee4f'
  const store = { subscribe: () => () => {}, getSnapshot: () => ({ marks: { [id]: 'question' }, aliases: { [id]: ['rel'] }, attention: 1, coordinator: id, restart: 'off' }), refresh: async () => {} }
  const header = textOf(React.createElement(mod.HeaderId, { sessionId: id, marksStore: store, t }))
  assert.match(header, /★ @rel · 7ea4fd68/)
  assert.match(textOf(React.createElement(mod.RowHover, { sessionId: id, marksStore: store, t })), new RegExp(id))
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
  const page = textOf(React.createElement(mod.BoardPage, { t, openSession: () => {}, marksStore: store }))
  React.useState = original
  assert.match(page, /mainIs/)
  assert.match(page, /要不要改/)
  assert.match(page, /openTitle/)
  // 次要分区默认收起：只有标题和一行摘要
  assert.match(page, /restartTitlefoldRestartIdle/)
  assert.doesNotMatch(page, /restartStart/)
  // 本机记住展开后：内容出现
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ restart: true, open: true }), setItem: () => {} } }
  calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const opened = textOf(React.createElement(mod.BoardPage, { t, openSession: () => {}, marksStore: store }))
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
  const text = textOf(React.createElement(mod.ConversationRelayView, { sessionId: id, t, openSession: () => {}, marksStore: store }))
  React.useState = original
  assert.match(text, new RegExp(id))
  assert.match(text, /selfNotJoined/)
  assert.match(text, /joinSelf/)
  assert.match(text, /scopeWorkspace/)
  assert.match(text, /scopeHidden/)
  assert.match(text, /hiddenAttention[\s\S]*@t43b[\s\S]*认领被拒/)
  assert.match(text, /hiddenAttentionShow/)
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
    React.createElement(mod.ConversationRelayView, { sessionId: 'session-2b3fef60-00f7-4698-b7de-6111c3fdabd0', t: (k) => k, openSession() {}, marksStore: store })
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
  const view = textOf(React.createElement(mod.ConversationRelayView, { sessionId: id, t, openSession: () => {}, marksStore: store }))
  React.useState = original
  assert.match(view, /selfObserver/)
  assert.match(view, /othersTitlefoldOthersSum/)
  assert.doesNotMatch(view, /扫一遍仓库/)
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ others: true }), setItem: () => {} } }
  calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const expanded = textOf(React.createElement(mod.ConversationRelayView, { sessionId: id, t, openSession: () => {}, marksStore: store }))
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
    handoff: { group: 'ws-a', coordinator: main, draft: { id: 'd', notes: '下一步：推 281', by: 'model', updatedAt: 1 }, snapshot: '版本线：未公告', history: [{ at: 1, from: 'session-old', to: main, fromLabel: '@old', toLabel: '@rel' }] },
    restart: { phase: 'off', text: '', busy: [] }, version: {}, defaultCwd: '/a'
  }
  const original = React.useState
  let calls = 0
  React.useState = (initial) => (++calls === 2 ? [board, () => {}] : original(initial))
  const page = textOf(React.createElement(mod.BoardPage, { t, openSession: () => {}, marksStore: store }))
  React.useState = original
  assert.match(page, /hoTitle/)
  assert.match(page, /hoDraftBy/)
  assert.match(page, /hoConfirm/)
  assert.match(page, /hoRevert/)
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
  const page = textOf(React.createElement(mod.BoardPage, { t, openSession: () => {}, marksStore: store }))
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
    // EntryCard 里第 1 个 useState 是 mode，第 11 个是 wakeInfo
    React.useState = (initial) => {
      calls += 1
      if (calls === 2) return [board, () => {}]
      if (/at EntryCard/.test(new Error().stack)) {
        inCard += 1
        if (inCard === 1) return ['wake', () => {}]
        if (inCard === 11) return [wakeInfo, () => {}]
      }
      return original(initial)
    }
    try { return textOf(React.createElement(mod.BoardPage, { t, openSession: () => {}, marksStore: store })) } finally { React.useState = original }
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
  const page = textOf(React.createElement(mod.BoardPage, { t, openSession: () => {}, marksStore: store }))
  React.useState = original
  for (const key of ['catAttention', 'catReady', 'why_failed', 'archiveTitle', 'foldArchiveSum', 'catHint']) assert.match(page, new RegExp(key))
  assert.doesNotMatch(page, /catActive|boardEmpty/)
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
  const page = textOf(React.createElement(mod.BoardPage, { t, openSession: () => {}, marksStore: store }))
  React.useState = original
  assert.match(page, /cardMore/)
  assert.match(page, /conflictCount/)
  assert.doesNotMatch(page, /SECRET_FILES|SECRET_TURN/, '折叠时不显示占用与最近一轮')
  assert.match(page, /OPEN_FILES/, '需要处理的卡片展开')
  assert.match(page, /catBlank/)
  assert.doesNotMatch(page, /BLANK_SUMMARY/, '空白分组默认收起')
})
