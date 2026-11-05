// 右侧边栏「协作」标签：入口只登记类型与空壳，正文在 client.sidebar.js 里按需加载
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

function fakeReact(states = []) {
  let call = 0
  const React = {
    Fragment: 'fragment',
    useState: (initial) => (call < states.length ? [states[call++], () => {}] : [typeof initial === 'function' ? initial() : initial, () => {}]),
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useCallback: (fn) => fn,
    Component: class { constructor(props) { this.props = props; this.state = {} } setState() {} },
    createElement(type, props, ...children) {
      const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
      if (typeof type === 'function' && type.prototype instanceof React.Component) return new type({ ...(props ?? {}), children: flat.length === 1 ? flat[0] : flat }).render()
      if (typeof type === 'function') return type({ ...(props ?? {}), children: flat })
      return { type, props: props ?? {}, children: flat }
    }
  }
  return React
}

async function load(file, React, requireAsync) {
  let mod
  let chunk
  const req = (name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) }
  if (requireAsync) req.async = requireAsync
  globalThis.window = { __ModuleLoader__: { load: (row) => { chunk = row.chunk; mod = row.factory(req) } } }
  try { new Function(await readFile(new URL('../lib/' + file, import.meta.url), 'utf8'))() } finally { delete globalThis.window }
  return { mod, chunk }
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.children)
}

const t = (key) => key

test('入口：有 sidebarRightTabs 时登记标签类型与正文，旧的 7 个插槽不变', async () => {
  const React = fakeReact()
  const { mod } = await load('client.js', React)
  const slots = []
  const types = []
  const base = {
    locale: { bind: () => t, register: () => () => {} },
    effect: (fn) => fn(),
    slots: { inject: (_name, fn) => fn(), register: (options, component) => { slots.push({ options, component }); return () => {} } }
  }
  let injected
  mod.apply({ ...base, inject: (deps, fn) => { injected = deps; fn({ ...base, sidebarRightTabs: { register: (def) => { types.push(def); return () => {} } } }) } })
  assert.deepEqual(injected, ['slots', 'sidebarRightTabs'])
  assert.equal(types.length, 1)
  assert.equal(types[0].id, mod.SIDEBAR_TYPE_ID)
  assert.equal(types[0].kind, 'session-relay')
  assert.equal(types[0].title(), 'sideTitle')
  assert.equal(types[0].guide[0].description(), 'sideGuide')
  assert.equal(types[0].keepMounted, undefined, '关掉标签就释放')
  const body = slots.find((item) => item.options.name === 'sidebar.right.pane.tab')
  assert.equal(body.options.key, mod.SIDEBAR_TYPE_ID, '正文按类型 id 登记')
  assert.deepEqual(body.options.inject('session-x'), { sessionId: 'session-x' })
  assert.equal(slots.filter((item) => item.options.name !== 'sidebar.right.pane.tab').length, 7)
})

test('入口：没有 ctx.inject（旧宿主）时不登记右侧边栏、不报错', async () => {
  const React = fakeReact()
  const { mod } = await load('client.js', React)
  const names = []
  mod.apply({
    locale: { bind: () => t, register: () => () => {} },
    effect: (fn) => fn(),
    slots: { inject: (_name, fn) => fn(), register: (options) => { names.push(options.name); return () => {} } }
  })
  assert.ok(!names.includes('sidebar.right.pane.tab'))
})

test('入口：空壳不同步加载正文；用 require.async 拉 client.sidebar.js', async () => {
  const React = fakeReact()
  let lazyFactory
  React.lazy = (factory) => { lazyFactory = factory; return function LazyStub() { return 'lazy' } }
  React.Suspense = 'suspense'
  const asked = []
  const { mod } = await load('client.js', React, (file) => { asked.push(file); return Promise.resolve({ RelaySidebar: () => 'body', KIT_VERSION: 2 }) })
  const Tab = mod.makeSidebarTab({ t })
  assert.equal(asked.length, 0, '登记时不下载正文')
  const tree = React.createElement(Tab, { sessionId: 's' })
  assert.equal(tree.type, 'suspense')
  assert.equal(textOf(tree.props.fallback), 'sideLoading')
  const loaded = await lazyFactory()
  assert.deepEqual(asked, ['./client.sidebar.js'])
  assert.equal(loaded.default(), 'body')
})

test('入口：浏览器拿到不配套的旧正文时显示「请重开」，不把 undefined 当组件', async () => {
  const React = fakeReact()
  let lazyFactory
  React.lazy = (factory) => { lazyFactory = factory; return () => null }
  React.Suspense = 'suspense'
  const { mod } = await load('client.js', React, () => Promise.resolve({ RelaySidebar: () => 'old body' }))
  mod.makeSidebarTab({ t })
  const loaded = await lazyFactory()
  assert.equal(textOf(loaded.default()), 'sideStale')
  const { mod: chunk } = await load('client.sidebar.js', fakeReact())
  assert.equal(chunk.KIT_VERSION, 2, '正文与入口的 kit 版本一致')
})

test('入口：宿主没有 require.async 时显示加载失败而不是崩溃', async () => {
  const React = fakeReact()
  React.lazy = () => () => null
  const { mod } = await load('client.js', React)
  assert.equal(textOf(React.createElement(mod.makeSidebarTab({ t }), { sessionId: 's' })), 'sideLoadFailed')
})

const sampleBoard = () => ({
  workspace: { title: 'dsha-session-relay', path: '/root/dsha-session-relay' },
  coordinator: { sessionId: 'session-main1234', label: '@main', state: 'running' },
  line: { text: 'main=a8f06fe' },
  entries: [
    { sessionId: 'session-w1aaaaaa', label: '@w1', title: '侧边栏改版', status: 'question', state: 'idle', summary: '要不要改', question: 'A 还是 B', branch: 'feat/side', commit: 'abcdef1234', conflicts: [{ label: '@w2', paths: ['lib/client.js'] }] },
    { sessionId: 'session-w2bbbbbb', label: '@w2', status: 'ready', state: 'idle', queue: 1 }
  ],
  othersTotal: 3,
  taskBoard: { open: [{ id: 'T1', priority: 'P1', title: '侧边栏' }], claimed: 2 }
})

function kitFor(opened = []) {
  return {
    t, format: (text, values) => text + JSON.stringify(values), formatTime: () => '2026-11-05 10:00', shortId: (id) => id.slice(8, 16),
    statusText: (_t, status) => 'status_' + status, stateText: (_t, state) => 'state_' + state,
    request: async () => ({}), errorText: () => 'err', copyText: async () => true,
    openSession: (id) => opened.push(id)
  }
}

// useState 顺序：board 状态、tick、filter、selected、lineOpen、copied
const states = (board, { filter = 'all', selected } = {}) => [{ board, error: undefined, at: Date.now() }, 0, filter, selected, false, undefined]

test('正文 chunk：登记为 dsh-session-relay 的 client.sidebar.js；列表有顶栏、计数、主会话、版本线、卡片与任务', async () => {
  const React = fakeReact(states(sampleBoard()))
  const { mod, chunk } = await load('client.sidebar.js', React)
  assert.equal(chunk, 'client.sidebar.js')
  const text = textOf(React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-self', useTabInfo: () => ({ tab: { visible: true } }) }))
  for (const part of ['dsha-session-relay', 'sideJustNow', 'sideCountAttention', 'sideCountReady', 'sideCountOpen', 'mainIs', '@main', 'main=a8f06fe',
    'sideFAll', 'sideFAttention', '@w1', 'status_question', '要不要改', 'feat/side', 'abcdef1', '⚠ 1', '@w2', 'queueNo', 'sideOthers', 'tasksTitle', 'sideClaimed', 'T1', 'P1', '侧边栏', 'openSession']) {
    assert.ok(text.includes(part), '缺少 ' + part)
  }
})

test('正文 chunk：筛选「可合并」只留 ready 的卡片；空分组给提示', async () => {
  const React = fakeReact(states(sampleBoard(), { filter: 'ready' }))
  const { mod } = await load('client.sidebar.js', React)
  const text = textOf(React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' }))
  assert.ok(text.includes('@w2'))
  assert.ok(!text.includes('要不要改'), '待答复的卡片不在「可合并」里')
  const React2 = fakeReact(states({ ...sampleBoard(), entries: [sampleBoard().entries[0]] }, { filter: 'done' }))
  const { mod: mod2 } = await load('client.sidebar.js', React2)
  assert.ok(textOf(React2.createElement(mod2.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' })).includes('sideFEmpty'))
})

test('正文 chunk：点卡片进详情——返回、路径、状态、问题、信息表、冲突', async () => {
  const React = fakeReact(states(sampleBoard(), { selected: 'session-w1aaaaaa' }))
  const { mod } = await load('client.sidebar.js', React)
  const text = textOf(React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' }))
  for (const part of ['sideBack', 'dsha-session-relay / @w1', '侧边栏改版', '● status_question', 'question', 'A 还是 B', 'sideDetailSummary', 'sideDetailInfo', 'sideBranch', 'feat/side', 'sideCommit', 'sideDetailIssues', 'sideOverlap']) {
    assert.ok(text.includes(part), '详情缺少 ' + part)
  }
  assert.ok(!text.includes('sideCountAttention'), '详情页不显示列表计数')
})

test('正文 chunk：还没数据时显示读取中；没有会话时不渲染', async () => {
  const React = fakeReact()
  const { mod } = await load('client.sidebar.js', React)
  const kit = kitFor()
  assert.match(textOf(React.createElement(mod.RelaySidebar, { kit, sessionId: 'session-self' })), /loading/)
  assert.equal(React.createElement(mod.RelaySidebar, { kit, sessionId: '' }), null)
})

test('正文 chunk：样式随标签注入，不在入口里；不用 backdrop-filter 和常驻动画', async () => {
  const chunk = await readFile(new URL('../lib/client.sidebar.js', import.meta.url), 'utf8')
  const entry = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(chunk.includes('.dshaSv_card'))
  assert.ok(!entry.includes('.dshaSv_'), '入口不带侧边栏样式')
  const cssText = chunk.slice(chunk.indexOf('const css = ['), chunk.indexOf("].join('')"))
  assert.ok(cssText.length > 100)
  assert.ok(!/backdrop-filter|@keyframes|animation:/.test(cssText))
})

test('正文 chunk：空白会话按服务端分类显示「空白」，不算进行中；没有待领任务给提示；不用黑色 brand-primary', async () => {
  const board = { ...sampleBoard(), entries: [{ sessionId: 'session-f4ada307', label: 'f4ada307', status: 'working', category: 'blank', state: 'idle', summary: '空白会话，等待用户输入第一句' }], taskBoard: { open: [], claimed: 0 } }
  const React = fakeReact(states(board))
  const { mod } = await load('client.sidebar.js', React)
  const text = textOf(React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' }))
  assert.ok(text.includes('catBlank'), '胶囊显示分组名')
  assert.ok(!text.includes('status_working'), '不显示过时的汇报状态')
  assert.ok(text.includes('0sideCountActive'), '空白会话不计入进行中')
  assert.ok(text.includes('sideNoOpenTasks'))
  const React2 = fakeReact(states(board, { filter: 'active' }))
  const { mod: mod2 } = await load('client.sidebar.js', React2)
  assert.ok(textOf(React2.createElement(mod2.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' })).includes('sideFEmpty'), '「进行中」筛选里没有空白会话')
  const chunk = await readFile(new URL('../lib/client.sidebar.js', import.meta.url), 'utf8')
  assert.ok(!chunk.includes('brand-primary'), '强调色用链接蓝，不用主题里接近黑白的 brand-primary')
})

test('正文 chunk：顶栏 GitHub 身份胶囊；换号标红，未登录提示，读不到就不显示', async () => {
  const pill = async (github) => {
    const React = fakeReact(states({ ...sampleBoard(), github }))
    const { mod } = await load('client.sidebar.js', React)
    return textOf(React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' }))
  }
  assert.ok((await pill({ state: 'ready', match: 'ok', login: 'alice', pinned: { login: 'alice' } })).includes('@alice'))
  const bad = await pill({ state: 'ready', match: 'mismatch', login: 'mallory', pinned: { login: 'alice' } })
  assert.ok(bad.includes('⚠ @mallory'))
  assert.ok((await pill({ state: 'missing', match: 'missing', login: null, pinned: null })).includes('ghPillOut'))
  const none = await pill(undefined)
  assert.ok(!none.includes('ghPill') && !none.includes('@alice'))
})

test('入口：设置页 / 协作标签 / 监督面板的正文在 client.panel.js，第一次渲染才下载；不配套时提示刷新', async () => {
  const React = fakeReact()
  const lazies = []
  React.lazy = (factory) => { lazies.push(factory); return function LazyStub() { return 'lazy' } }
  React.Suspense = 'suspense'
  const asked = []
  let reply = { make: () => ({ BoardPage: () => 'board', SessionRelaySettings: () => 'settings' }), KIT_VERSION: 1 }
  const { mod } = await load('client.js', React, (file) => { asked.push(file); return Promise.resolve(reply) })
  assert.equal(asked.length, 0, '载入入口时不下载正文')
  const tree = React.createElement(mod.BoardPage, { t })
  assert.equal(tree.type, 'suspense')
  assert.equal(textOf(tree.props.fallback), 'panelLoading')
  assert.equal((await lazies[0]()).default(), 'board')
  React.createElement(mod.SessionRelaySettings, { t })
  assert.equal((await lazies[1]()).default(), 'settings')
  assert.deepEqual(asked, ['./client.panel.js'], '几个页面共用一次下载')
  // 正文 kit 版本不配套
  reply = { make: () => ({}), KIT_VERSION: 0 }
  const second = await load('client.js', React, () => Promise.resolve(reply))
  React.createElement(second.mod.BoardPage, { t })
  assert.equal(textOf((await lazies.at(-1)()).default({ t })), 'panelStale')
  const { mod: chunk, chunk: name } = await load('client.panel.js', fakeReact())
  assert.equal(name, 'client.panel.js')
  assert.equal(chunk.KIT_VERSION, second.mod.PANEL_KIT, '正文与入口的 kit 版本一致')
})
