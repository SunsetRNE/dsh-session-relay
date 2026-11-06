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
    { sessionId: 'session-w2bbbbbb', label: '@w2', status: 'ready', state: 'idle', queue: 1 },
    { sessionId: 'session-w3cccccc', label: '@w3', status: 'working', category: 'blank', state: 'idle', summary: '空白会话' }
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

// useState 顺序：board 状态、tick、filter、selected、lineOpen、copied、quietOpen、tasksOpen、busy、note
const states = (board, { filter = 'all', selected, quietOpen = false, tasksOpen = false } = {}) => [{ board, error: undefined, at: Date.now() }, 0, filter, selected, false, undefined, quietOpen, tasksOpen, false, undefined]

test('正文 chunk：登记为 dsh-session-relay 的 client.sidebar.js；列表有顶栏、计数、主会话、版本线、卡片与任务', async () => {
  const React = fakeReact(states(sampleBoard()))
  const { mod, chunk } = await load('client.sidebar.js', React)
  assert.equal(chunk, 'client.sidebar.js')
  const text = textOf(React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-self', useTabInfo: () => ({ tab: { visible: true } }) }))
  for (const part of ['dsha-session-relay', '1sideCountAttention', '0sideCountActive', '1sideCountReady', 'sideTaskSummary', 'mainIs', '@main', 'lineTitle', 'main=a8f06fe',
    '@w1', 'why_question', '要不要改', 'feat/side', 'abcdef1', '⚠ 1', '@w2', 'queueNo', 'sideTaskBoard', 'sideTaskSummary', 'sideDoneMore', 'T1', 'P1', '侧边栏', 'openSession']) {
    assert.ok(text.includes(part), '缺少 ' + part)
  }
  // 空白会话合成一行，不单独列卡片；计数本身就是筛选
  assert.ok(text.includes('catBlank 1'))
  assert.ok(!text.includes('@w3'))
  assert.ok(!text.includes('sideFAll'), '没有单独的「全部」筛选')
})

test('正文 chunk：筛选「可合并」只留 ready 的卡片；空分组不占一行提示', async () => {
  const React = fakeReact(states(sampleBoard(), { filter: 'ready' }))
  const { mod } = await load('client.sidebar.js', React)
  const text = textOf(React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' }))
  assert.ok(text.includes('@w2'))
  assert.ok(!text.includes('要不要改'), '待答复的卡片不在「可合并」里')
  const React2 = fakeReact(states(sampleBoard(), { filter: 'active' }))
  const { mod: mod2 } = await load('client.sidebar.js', React2)
  const empty = textOf(React2.createElement(mod2.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' }))
  assert.ok(!empty.includes('@w1') && !empty.includes('@w2'), '空白会话不算进行中，空分组不再渲染提示行')
  // 会话不到 3 个：不给筛选，即使记着旧筛选也全列
  const React3 = fakeReact(states({ ...sampleBoard(), entries: sampleBoard().entries.slice(0, 2) }, { filter: 'ready' }))
  const { mod: mod3 } = await load('client.sidebar.js', React3)
  const few = textOf(React3.createElement(mod3.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' }))
  assert.ok(few.includes('@w1') && few.includes('@w2') && few.includes('sideBoard'))
  assert.ok(!few.includes('sideCountReady'))
})

test('正文 chunk：点卡片进详情——返回、路径、状态、问题、信息表、冲突', async () => {
  const React = fakeReact(states(sampleBoard(), { selected: 'session-w1aaaaaa' }))
  const { mod } = await load('client.sidebar.js', React)
  const text = textOf(React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' }))
  for (const part of ['sideBack', 'dsha-session-relay / @w1', '侧边栏改版', '● why_question', 'question', 'A 还是 B', 'sideDetailSummary', 'sideDetailInfo', 'sideBranch', 'feat/side', 'sideCommit', 'sideDetailIssues', 'sideOverlap']) {
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
  assert.ok(text.includes('catBlank 1'), '合成一行显示分组名')
  assert.ok(text.includes('sideNoOpenTasks'))
  // 展开后列卡片：胶囊显示分组名，不显示过时的汇报状态
  const React2 = fakeReact(states(board, { quietOpen: true }))
  const { mod: mod2 } = await load('client.sidebar.js', React2)
  const open = textOf(React2.createElement(mod2.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' }))
  assert.ok(open.includes('catBlank') && open.includes('f4ada307'))
  assert.ok(!open.includes('status_working'))
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

test('正文 chunk：等你决定直接点选项（以用户身份回答）；提醒条只在有事时出现；任务只列前 3 条', async () => {
  const posted = []
  const kit = { ...kitFor(), request: async (method, body) => { posted.push([method, body]); return {} } }
  const board = {
    ...sampleBoard(),
    asks: [{ id: 'a1', question: 'build281 给谁', options: ['lint', 'adb'], byLabel: '@main', at: 1 }],
    unattended: { paused: true },
    declarations: { mismatches: 2 },
    watches: [{ id: 'w1', state: 'failed', line: 'CI 123 失败', what: 'CI 123', checkedAt: Date.now() }, { id: 'w2', state: 'active', line: 'CI 9 运行中', what: 'CI 9' }],
    taskBoard: { open: ['T1', 'T2', 'T3', 'T4', 'T5'].map((id) => ({ id, title: id + ' 标题' })), claimed: 0 }
  }
  const React = fakeReact(states(board))
  const { mod } = await load('client.sidebar.js', React)
  const tree = React.createElement(mod.RelaySidebar, { kit, sessionId: 'session-self' })
  const text = textOf(tree)
  for (const part of ['askTitle', 'build281 给谁', 'lint', 'adb', 'askDismiss', 'sideAlertWake', 'wakeResume', 'sideAlertDecl', 'CI 123 失败', 'sideWatching', 'T3 标题', 'sideMoreTasks']) assert.ok(text.includes(part), '缺少 ' + part)
  assert.ok(!text.includes('T4 标题'))
  const find = (node, label) => {
    if (!node || typeof node !== 'object') return undefined
    if (Array.isArray(node)) { for (const child of node) { const hit = find(child, label); if (hit) return hit } return undefined }
    if (node.type === 'button' && textOf(node.children) === label) return node
    return find(node.children, label)
  }
  await find(tree, 'lint').props.onClick()
  assert.deepEqual(posted[0], ['POST', { action: 'ask-answer', id: 'a1', option: 'lint', fromSession: 'session-self' }])
  await find(tree, 'wakeResume').props.onClick()
  assert.equal(posted[1][1].action, 'unattended-resume')
  // 没事：不出现提醒区
  const React2 = fakeReact(states(sampleBoard()))
  const { mod: mod2 } = await load('client.sidebar.js', React2)
  const calm = textOf(React2.createElement(mod2.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' }))
  assert.ok(!/askTitle|sideAlert|sideWatching/.test(calm))
})

test('正文 chunk：读取中给同高占位；数据旧了顶栏变色；已结束收在底部；复制失败也提示', async () => {
  const React0 = fakeReact()
  const { mod: mod0 } = await load('client.sidebar.js', React0)
  const loading = React0.createElement(mod0.RelaySidebar, { kit: kitFor(), sessionId: 'session-none' })
  assert.ok(JSON.stringify(loading).includes('dshaSv_skel'))

  const board = { ...sampleBoard(), entries: [...sampleBoard().entries, { sessionId: 'session-d1dddddd', label: '@d1', status: 'done', category: 'archived', state: 'idle' }] }
  const old = [{ board, error: undefined, at: Date.now() - 40 * 60000 }, 0, 'all', undefined, false, undefined, false, false, false, undefined]
  const React = fakeReact(old)
  const { mod } = await load('client.sidebar.js', React)
  const tree = React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' })
  const json = JSON.stringify(tree)
  assert.ok(json.includes('"data-tone":"error"') && textOf(tree).includes('sideMinAgo'), '超过 30 分钟标红')
  assert.ok(textOf(tree).includes('sideDoneN') && !textOf(tree).includes('@d1'), '已结束默认收起')
  const React2 = fakeReact([...old.slice(0, 10), true])
  const { mod: mod2 } = await load('client.sidebar.js', React2)
  assert.ok(textOf(React2.createElement(mod2.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' })).includes('@d1'), '展开后列出')

  const failing = [{ board: sampleBoard(), error: undefined, at: Date.now() }, 0, 'all', undefined, false, 'fail:session-main1234', false, false, false, undefined]
  const React3 = fakeReact(failing)
  const { mod: mod3 } = await load('client.sidebar.js', React3)
  const failed = React3.createElement(mod3.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' })
  assert.ok(textOf(failed).includes('!') && JSON.stringify(failed).includes('copyFailed'), '复制失败显示「!」并提示')
})

test('正文 chunk：折叠与筛选记在本机，换会话 / 重开标签后保持', async () => {
  const stored = {}
  const React = fakeReact()
  let tree
  const saved = globalThis.window
  try {
    const { mod } = await load('client.sidebar.js', React)
    globalThis.window = { localStorage: { getItem: (key) => stored[key] ?? null, setItem: (key, value) => { stored[key] = value } } }
    stored['dshaSv.ui.v1'] = JSON.stringify({ quiet: true })
    // 第一个 useState 是看板状态：用缓存里没有的会话 id，手动给看板
    let call = 0
    const original = React.useState
    React.useState = (initial) => (call++ === 0 ? [{ board: sampleBoard(), error: undefined, at: Date.now() }, () => {}] : original(initial))
    tree = React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-other' })
    React.useState = original
  } finally { globalThis.window = saved }
  assert.ok(textOf(tree).includes('@w3'), '空白会话按记住的「展开」列出')
})

test('正文 chunk：轮询带上次的 since；notModified 时不换看板对象（卡片不重画），只更新时间', async () => {
  const React = fakeReact()
  const effects = []
  React.useEffect = (fn) => { effects.push(fn) }
  const sets = []
  React.useState = (initial) => [typeof initial === 'function' ? initial() : initial, (value) => sets.push(value)]
  const calls = []
  let reply = { ok: true, entries: sampleBoard().entries, version: 'v1' }
  const kit = { ...kitFor(), request: async (method, body, query) => { calls.push(query); return reply } }
  const saved = globalThis.document
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, querySelector: () => null, createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } }
  const cleanups = []
  // 找出更新看板的那次 setState（还有刷新提示等别的更新）
  const boardUpdate = () => sets.map((value) => (typeof value === 'function' ? value({ board: undefined }) : value)).find((value) => value && typeof value === 'object' && 'board' in value && value.at !== undefined)
  try {
    const { mod } = await load('client.sidebar.js', React)
    React.createElement(mod.RelaySidebar, { kit, sessionId: 'session-poll', useTabInfo: () => ({ tab: { visible: true } }) })
    cleanups.push(...effects.map((fn) => fn()))
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(calls[0].since, undefined)
    const first = boardUpdate()
    assert.equal(first.version, 'v1')
    // 第二轮：模块缓存里有 v1，带 since；服务端回 notModified
    reply = { ok: true, notModified: true, version: 'v1' }
    effects.length = 0; sets.length = 0
    React.createElement(mod.RelaySidebar, { kit, sessionId: 'session-poll', useTabInfo: () => ({ tab: { visible: true } }) })
    cleanups.push(...effects.map((fn) => fn()))
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(calls.at(-1).since, 'v1')
    const updated = boardUpdate()
    assert.equal(updated.board, first.board, '看板对象沿用')
  } finally {
    for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
    globalThis.document = saved
  }
})

test('正文 chunk：需要处理的卡片胶囊说原因（最后一轮出错 / 上下文过大），不显示已经过时的汇报状态', async () => {
  const board = () => ({
    workspace: { title: 'w', path: '/root/dsha-session-relay' },
    line: { text: 'main=abc' },
    entries: [
      { sessionId: 'session-f1aaaaaa', label: '@f1', status: 'working', category: 'attention', categoryReason: 'failed', categoryDetail: 'EMPTY_RESPONSE', state: 'idle', summary: '上一轮失败了' },
      { sessionId: 'session-h1bbbbbb', label: '@h1', status: 'working', category: 'attention', categoryReason: 'heavy', state: 'idle', summary: '上下文满了' },
      { sessionId: 'session-a1cccccc', label: '@a1', status: 'working', category: 'active', state: 'running', summary: '在跑' }
    ],
    othersTotal: 0
  })
  const React = fakeReact(states(board()))
  const { mod } = await load('client.sidebar.js', React)
  const tree = React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' })
  const text = textOf(tree)
  assert.ok(text.includes('why_failed'), '出错说原因')
  assert.ok(text.includes('why_heavy'), '上下文过大说原因')
  assert.equal(text.split('status_working').length - 1, 1, '只有真正进行中的那张卡片显示汇报状态，需要处理的两张改说原因')
  const pills = []
  const walk = (node) => {
    if (node === null || node === undefined || node === false) return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (typeof node !== 'object') return
    if (node.props?.className === 'dshaSv_pill') pills.push(node)
    walk(node.children)
  }
  walk(tree)
  const failed = pills.find((pill) => textOf(pill) === 'why_failed')
  assert.equal(failed.props['data-tone'], 'error', '最后一轮出错用错误色')
  assert.equal(failed.props.title, 'status_working · EMPTY_RESPONSE', '悬停给出原始状态与错误码')
  const heavy = pills.find((pill) => textOf(pill) === 'why_heavy')
  assert.equal(heavy.props['data-tone'], 'warn', '上下文过大用提醒色')
})

test('正文 chunk：卡片主操作随状态——待答复回复、可合并排号、久未活动唤醒；都要二次确认，以用户身份发出', async () => {
  const find = (node, pred) => {
    if (!node || typeof node !== 'object') return undefined
    if (Array.isArray(node)) { for (const child of node) { const hit = find(child, pred); if (hit) return hit } return undefined }
    if (pred(node)) return node
    return find(node.children, pred)
  }
  const button = (label) => (node) => node.type === 'button' && textOf(node.children) === label
  const posted = []
  const kit = kitFor()
  // 父组件 12 个 useState：board、tick、filter、selected、lineOpen、copied、quietOpen、tasksOpen、busy、note、doneOpen、ghLoginOpen；之后才轮到卡片
  const sidebarStates = (board, cardStates, quietOpen = false) => [{ board, error: undefined, at: Date.now() }, 0, 'all', undefined, false, undefined, quietOpen, false, false, undefined, false, false, ...cardStates]
  const q = sampleBoard().entries[0]
  let React = fakeReact(sidebarStates({ ...sampleBoard(), entries: [q] }, ['reply', '先做 A', false]))
  let m = (await load('client.sidebar.js', React)).mod
  let tree = React.createElement(m.RelaySidebar, { kit: { ...kit, request: async (method, body) => { posted.push(body); return {} } }, sessionId: 'session-self' })
  assert.ok(find(tree, button('reply')), '待答复卡片有「回复」')
  assert.ok(find(tree, (n) => n.type === 'textarea'), '展开后是输入框')
  await find(tree, button('send')).props.onClick({ stopPropagation() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(posted.at(-1), { action: 'reply', target: q.sessionId, text: '先做 A', mode: 'followup', fromSession: 'session-self' })
  const r = sampleBoard().entries[1]
  React = fakeReact(sidebarStates({ ...sampleBoard(), entries: [r] }, ['assign', 'build281', false]))
  m = (await load('client.sidebar.js', React)).mod
  tree = React.createElement(m.RelaySidebar, { kit: { ...kit, request: async (method, body) => { posted.push(body); return {} } }, sessionId: 'session-self' })
  await find(tree, button('assignSend')).props.onClick({ stopPropagation() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(posted.at(-1), { action: 'assign', target: r.sessionId, value: 'build281', notify: true, fromSession: 'session-self' })
  const idle = { sessionId: 'session-i1iiiiii', label: '@i1', status: 'working', category: 'idle', state: 'idle' }
  // 久未活动默认收在一行里：展开后才有卡片
  React = fakeReact(sidebarStates({ ...sampleBoard(), entries: [idle] }, ['wake', '', false], true))
  m = (await load('client.sidebar.js', React)).mod
  tree = React.createElement(m.RelaySidebar, { kit: { ...kit, request: async (method, body) => { posted.push(body); return {} } }, sessionId: 'session-self' })
  assert.ok(textOf(tree).includes('sideWakeAsk'), '唤醒先问一句')
  await find(tree, button('wakeConfirm')).props.onClick({ stopPropagation() {} })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(posted.at(-1), { action: 'wake', target: idle.sessionId, force: 'resume', fromSession: 'session-self' })
  // 进行中的卡片只有「打开」
  const working = { sessionId: 'session-k1kkkkkk', label: '@k1', status: 'working', category: 'active', state: 'running' }
  React = fakeReact(sidebarStates({ ...sampleBoard(), entries: [working] }, [undefined]))
  m = (await load('client.sidebar.js', React)).mod
  tree = React.createElement(m.RelaySidebar, { kit, sessionId: 'session-self' })
  assert.ok(!find(tree, button('reply')) && !find(tree, button('assign')) && !find(tree, button('wake')))
})

// 任务看板：参考 Deck 的列表 + 详情 + 动作。TaskBoard 单独测，避免父组件 11 个 useState 的位置耦合。
const taskKit = (overrides = {}) => {
  const opened = []
  const copied = []
  const kit = {
    ...kitFor(opened),
    copyText: async (text) => { copied.push(text); return true; },
    ...overrides
  }
  return { kit, opened, copied }
}

const tasksFixture = () => ({
  file: '.agents/TASKS.md',
  open: [{ id: 'T1', priority: 'P1', title: '改侧栏' }, { id: 'T2', title: '补测试' }],
  claimed: 1,
  ended: 1,
  claimedRows: [{ id: 'T3', priority: 'P2', title: '跑真机', owner: 'session-w1aaaaaa', ownerLabel: '@w1', status: '进行中（@w1 认领）', worktree: 'fix/t3', dependsOn: ['T1'] }],
  endedRows: [{ id: 'T0', title: '旧任务', claim: 'done' }]
})

const findScopeChips = (node, out = []) => {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((child) => findScopeChips(child, out)); return out }
  if (node.props?.className === 'dshaSv_scope') out.push(node)
  findScopeChips(node.children, out)
  return out
}

const findNode = (node, pred) => {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) { for (const child of node) { const hit = findNode(child, pred); if (hit) return hit } return undefined }
  if (pred(node)) return node
  return findNode(node.children, pred)
}

const findButton = (node, pred) => {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) { for (const child of node) { const hit = findButton(child, pred); if (hit) return hit } return undefined }
  if (node.type === 'button' && pred(textOf(node.children), node)) return node
  return findButton(node.children, pred)
}

test('任务看板：可接 / 进行中 / 已结束分组，进行中显示持有者，已结束默认收起', async () => {
  const { kit } = taskKit()
  const React = fakeReact([])
  const { mod } = await load('client.sidebar.js', React)
  const tree = React.createElement(mod.TaskBoard, { kit, tasks: tasksFixture(), act: async () => ({}), busy: false })
  const text = textOf(tree)
  for (const part of ['sideTaskBoard', 'sideTaskSummary', 'sideTaskOpen', 'T1', 'P1', '改侧栏', 'T2', 'sideTaskActive', 'T3', 'P2', '@w1', 'sideTaskEnded']) assert.ok(text.includes(part), '缺少 ' + part)
  assert.ok(!text.includes('T0'), '已结束默认收起')
  // 展开「已结束」是一个按钮；点击由上层状态控制，这里只验折叠态
  const endedButton = findButton(tree, (label) => label.includes('sideTaskEnded'))
  assert.ok(endedButton !== undefined, '有「已结束」分组入口（默认收起）')

  const expanded = fakeReact([undefined, { 'g:ended': true }])
  const mod2 = (await load('client.sidebar.js', expanded)).mod
  const open = textOf(expanded.createElement(mod2.TaskBoard, { kit, tasks: tasksFixture(), act: async () => ({}), busy: false }))
  assert.ok(open.includes('T0') && open.includes('sideTaskDone'), '展开后列出已结束任务和结论')
})

test('任务看板：点条目进详情，打开持有会话、复制任务号和派发指令', async () => {
  const { kit, opened, copied } = taskKit()
  const React = fakeReact(['T3'])
  const { mod } = await load('client.sidebar.js', React)
  const tree = React.createElement(mod.TaskBoard, { kit, tasks: tasksFixture(), entries: [{ sessionId: 'session-w1aaaaaa', summary: '跑了真机，等合并' }], act: async () => ({}), busy: false, onCopied: () => {} })
  const text = textOf(tree)
  for (const part of ['sideTaskBack', 'T3', 'tasksHolder', '@w1', 'sideTaskWorktree', 'fix/t3', 'sideTaskStatus', 'sideTaskDepends', 'sideTaskLatest', '跑了真机，等合并', 'tasksOpenHolder', 'sideTaskCopyId', 'sideTaskCopyDispatch']) assert.ok(text.includes(part), '详情缺少 ' + part)
  assert.ok(!text.includes('sideTaskSummary'), '详情页不显示分组计数')
  await findButton(tree, (label) => label === 'tasksOpenHolder').props.onClick()
  assert.deepEqual(opened, ['session-w1aaaaaa'])
  await findButton(tree, (label) => label === 'sideTaskCopyId').props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(copied, ['T3'])
  await findButton(tree, (label) => label === 'sideTaskCopyDispatch').props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(copied, ['T3', '/relay task dispatch T3'])
})

test('任务看板：详情显示关联 PR 的只读状态', async () => {
  const { kit } = taskKit()
  const React = fakeReact(['T3'])
  const { mod } = await load('client.sidebar.js', React)
  const tasks = tasksFixture()
  tasks.claimedRows = [{
    ...tasks.claimedRows[0],
    pr: { number: 7, url: 'https://github.com/o/r/pull/7', repo: 'o/r', source: 'ok', label: 'PR #7 · OPEN · 可合并 · checks 1/1 通过' }
  }]
  const tree = React.createElement(mod.TaskBoard, { kit, tasks, act: async () => ({}), busy: false })
  assert.match(textOf(tree), /PR #7 · OPEN · 可合并 · checks 1\/1 通过/)
})

test('任务看板：可接任务进详情后复制认领指令；拉起认领会话要确认，成功直接打开新会话', async () => {
  const { kit, opened, copied } = taskKit()
  const React = fakeReact(['T1'])
  const { mod } = await load('client.sidebar.js', React)
  const tree = React.createElement(mod.TaskBoard, { kit, tasks: tasksFixture(), act: async () => ({}), busy: false })
  await findButton(tree, (label) => label === 'sideTaskCopyClaim').props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(copied, ['/relay task claim T1'])

  const posted = []
  const select = fakeReact(['T1', undefined, 'T1', ''])
  const mod2 = (await load('client.sidebar.js', select)).mod
  const detail = select.createElement(mod2.TaskBoard, {
    kit, tasks: tasksFixture(), busy: false,
    act: async (body) => { posted.push(body); return { result: { sessionId: 'session-new1234' } } }
  })
  await findButton(detail, (label) => label === 'tasksClaimConfirm').props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(posted, [{ action: 'claim', task: 'T1' }])
  assert.deepEqual(opened, ['session-new1234'], '拉起成功后直接打开新会话')
})

test('任务看板：旧快照只有 open / claimed 计数时不崩，仍给待领列表和计数', async () => {
  const { kit } = taskKit()
  const React = fakeReact([])
  const { mod } = await load('client.sidebar.js', React)
  const tree = React.createElement(mod.TaskBoard, { kit, tasks: { open: [{ id: 'T9', title: '旧数据' }], claimed: 2 }, act: async () => ({}), busy: false })
  const text = textOf(tree)
  assert.ok(text.includes('T9') && text.includes('sideDoneMore'))
})


// GitHub 登录卡：点顶栏胶囊就地展开；登录/补权限/锁定都走设置页同一套 action
test('GitHub 登录卡：点胶囊展开；未登录时发起登录，验证码卡可复制/取消', async () => {
  const base = { ...sampleBoard(), taskBoard: { open: [], claimed: 0 } }
  // 父组件 12 个 useState 之后是 GitHubCard 的 tier（usePersisted 的 useState）
  const ghStates = (github, open = true, tier = 'repo') => [{ board: { ...base, github }, error: undefined, at: Date.now() }, 0, 'all', undefined, false, undefined, false, false, false, undefined, false, open, tier]
  const posted = []
  const kit = { ...kitFor(), request: async (method, body) => { posted.push(body); return {} } }
  const missing = { state: 'missing', match: 'missing', login: null, accountId: null, pinned: null, scopes: [], loginFlow: null, error: null }
  let React = fakeReact(ghStates(missing))
  let { mod } = await load('client.sidebar.js', React)
  let tree = React.createElement(mod.RelaySidebar, { kit, sessionId: 'session-self' })
  assert.ok(textOf(tree).includes('ghStateMissing') && textOf(tree).includes('ghTier'))
  const pill = findButton(tree, (label, node) => String(node.props.className).includes('dshaSv_pillBtn'))
  assert.equal(pill.props['aria-expanded'], true, '胶囊标了展开状态')
  await findButton(tree, (label) => label === 'ghLogin').props.onClick()
  assert.deepEqual(posted, [{ action: 'github-login', tier: 'repo', fromSession: 'session-self' }])

  const pending = { ...missing, loginFlow: { state: 'pending', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', opened: true, startedAt: 1, expiresAt: 2 } }
  const copied = []
  React = fakeReact(ghStates(pending))
  mod = (await load('client.sidebar.js', React)).mod
  tree = React.createElement(mod.RelaySidebar, { kit: { ...kit, copyText: async (text) => { copied.push(text); return true } }, sessionId: 'session-self' })
  const text = textOf(tree)
  for (const part of ['ABCD-1234', 'ghCode', 'ghCopyCode', 'ghCodeOpened', 'ghCancel']) assert.ok(text.includes(part), '缺少 ' + part)
  await findButton(tree, (label) => label === 'ghCopyCode').props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(copied, ['ABCD-1234'])
  await findButton(tree, (label) => label === 'ghCancel').props.onClick()
  assert.equal(posted.at(-1).action, 'github-login-cancel')
})

test('GitHub 登录卡：已登录未锁定给「锁定」；锁错号给「重新锁定」；有「补足全部权限」', async () => {
  const base = { ...sampleBoard(), taskBoard: { open: [], claimed: 0 } }
  const ghStates = (github, tier = 'all') => [{ board: { ...base, github }, error: undefined, at: Date.now() }, 0, 'all', undefined, false, undefined, false, false, false, undefined, false, true, tier]
  const posted = []
  const kit = { ...kitFor(), request: async (method, body) => { posted.push(body); return {} } }
  const ready = { state: 'ready', match: 'unpinned', login: 'alice', accountId: 1, pinned: null, scopes: ['repo', 'workflow'], loginFlow: null, error: null }
  let React = fakeReact(ghStates(ready))
  let mod = (await load('client.sidebar.js', React)).mod
  let tree = React.createElement(mod.RelaySidebar, { kit, sessionId: 'session-self' })
  assert.ok(textOf(tree).includes('ghPinUnpinned'))
  const chips = findScopeChips(tree)
  assert.deepEqual(chips.map((chip) => chip.props.title), ['repo', 'workflow'], '权限按 scope 逐颗显示')
  assert.ok(textOf(tree).includes('ghTierUpgrade'))
  await findButton(tree, (label) => label === 'ghPin').props.onClick()
  assert.equal(posted.at(-1).action, 'github-pin')
  await findButton(tree, (label) => label.includes('ghTierUpgrade')).props.onClick()
  assert.equal(posted.at(-1).action, 'github-relogin')

  const mismatch = { ...ready, match: 'mismatch', login: 'mallory', pinned: { login: 'alice', accountId: 1 } }
  React = fakeReact(ghStates(mismatch))
  mod = (await load('client.sidebar.js', React)).mod
  tree = React.createElement(mod.RelaySidebar, { kit, sessionId: 'session-self' })
  assert.ok(textOf(tree).includes('ghPinMismatch'))
  await findButton(tree, (label) => label === 'ghRepin').props.onClick()
  assert.equal(posted.at(-1).action, 'github-pin')
})


test('GitHub 登录卡：三档权限胶囊可选，动作带上所选档位', async () => {
  const base = { ...sampleBoard(), taskBoard: { open: [], claimed: 0 } }
  const ghStates = (github, tier) => [{ board: { ...base, github }, error: undefined, at: Date.now() }, 0, 'all', undefined, false, undefined, false, false, false, undefined, false, true, tier]
  const posted = []
  const kit = { ...kitFor(), request: async (method, body) => { posted.push(body); return {} } }
  const missing = { state: 'missing', match: 'missing', login: null, accountId: null, pinned: null, scopes: [], loginFlow: null, error: null }
  let React = fakeReact(ghStates(missing, 'basic'))
  let mod = (await load('client.sidebar.js', React)).mod
  let tree = React.createElement(mod.RelaySidebar, { kit, sessionId: 'session-self' })
  const text = textOf(tree)
  for (const part of ['ghTier', 'ghTierBasic', 'ghTierRepo', 'ghTierAll', 'ghTierHintBasic', 'ghTierNote']) assert.ok(text.includes(part), '缺少 ' + part)
  const basic = findButton(tree, (label, node) => node.props['aria-pressed'] === true && label === 'ghTierBasic')
  assert.ok(basic !== undefined, '基础档按选中态渲染')
  await findButton(tree, (label) => label === 'ghLogin').props.onClick()
  assert.deepEqual(posted, [{ action: 'github-login', tier: 'basic', fromSession: 'session-self' }])

  const ready = { state: 'ready', match: 'ok', login: 'alice', accountId: 1, pinned: { login: 'alice', accountId: 1 }, scopes: ['repo'], loginFlow: null, error: null }
  React = fakeReact(ghStates(ready, 'repo'))
  mod = (await load('client.sidebar.js', React)).mod
  tree = React.createElement(mod.RelaySidebar, { kit, sessionId: 'session-self' })
  await findButton(tree, (label) => label.includes('ghTierUpgrade')).props.onClick()
  assert.equal(posted.at(-1).action, 'github-relogin')
  assert.equal(posted.at(-1).tier, 'repo')
})


test('GitHub 登录卡：当前权限显示为一颗颗小胶囊，不再出现 {v} 占位符', async () => {
  const base = { ...sampleBoard(), taskBoard: { open: [], claimed: 0 } }
  const github = { state: 'ready', match: 'ok', login: 'alice', accountId: 1, pinned: { login: 'alice', accountId: 1 }, scopes: ['repo', 'workflow', 'gist', 'admin:repo_hook'], loginFlow: null, error: null }
  const states = [{ board: { ...base, github }, error: undefined, at: Date.now() }, 0, 'all', undefined, false, undefined, false, false, false, undefined, false, true, 'repo']
  const React = fakeReact(states)
  const { mod } = await load('client.sidebar.js', React)
  const tree = React.createElement(mod.RelaySidebar, { kit: kitFor(), sessionId: 'session-self' })
  const text = textOf(tree)
  assert.ok(!text.includes('{v}'), '不再显示未替换的占位符')
  const chips = findScopeChips(tree)
  assert.deepEqual(chips.map((chip) => chip.props.title), ['repo', 'workflow', 'gist', 'admin:repo_hook'], '四个 scope 各一颗胶囊')
  assert.deepEqual(chips.map((chip) => textOf(chip)), ['repo', 'workflow', 'gist', 'admin:repo_hook'], '测试字典里回退成原始 scope')
})


test('GitHub 登录卡：授权缺 scope 时明确告警，并提供「退出后重新登录」确认流', async () => {
  const base = { ...sampleBoard(), taskBoard: { open: [], claimed: 0 } }
  const github = {
    state: 'ready', match: 'ok', login: 'alice', accountId: 1, pinned: { login: 'alice', accountId: 1 },
    scopes: ['repo', 'read:org', 'gist'], loginFlow: { state: 'done', missing: ['admin:org', 'delete_repo'], missingTotal: 2, userCode: null, verificationUri: null, opened: false },
    error: null
  }
  // 父组件 12 个 + tier(13) + resetAsk(14)
  const states = [{ board: { ...base, github }, error: undefined, at: Date.now() }, 0, 'all', undefined, false, undefined, false, false, false, undefined, false, true, 'repo', true]
  const posted = []
  const kit = { ...kitFor(), request: async (method, body) => { posted.push(body); return {} } }
  const React = fakeReact(states)
  const { mod } = await load('client.sidebar.js', React)
  const tree = React.createElement(mod.RelaySidebar, { kit, sessionId: 'session-self' })
  const text = textOf(tree)
  for (const part of ['ghGrantedMissing', 'admin:org', 'delete_repo', 'ghGrantedMissingHint', 'ghResetAsk', 'ghResetConfirm']) assert.ok(text.includes(part), '缺少 ' + part)
  await findButton(tree, (label) => label === 'ghResetConfirm').props.onClick()
  assert.deepEqual(posted.at(-1), { action: 'github-reset-login', tier: 'repo', fromSession: 'session-self' })
})


test('GitHub 登录卡：档位已补足时显示「已补足」状态，档位胶囊带 ✓', async () => {
  const base = { ...sampleBoard(), taskBoard: { open: [], claimed: 0 } }
  const github = {
    state: 'ready', match: 'ok', login: 'alice', accountId: 1, pinned: { login: 'alice', accountId: 1 },
    scopes: ['repo', 'admin:org', 'admin:repo_hook', 'workflow'],
    tiers: {
      basic: ['repo', 'read:org', 'gist', 'workflow'],
      repo: ['repo', 'admin:repo_hook', 'workflow'],
      all: ['repo', 'admin:org', 'admin:repo_hook', 'workflow']
    },
    loginFlow: null, error: null
  }
  const states = [{ board: { ...base, github }, error: undefined, at: Date.now() }, 0, 'all', undefined, false, undefined, false, false, false, undefined, false, true, 'all', false]
  const React = fakeReact(states)
  const kit = kitFor()
  const { mod } = await load('client.sidebar.js', React)
  const tree = React.createElement(mod.RelaySidebar, { kit, sessionId: 'session-self' })
  const text = textOf(tree)
  assert.ok(text.includes('ghTierCovered'), '显示已补足状态')
  assert.ok(!text.includes('ghTierUpgrade'), '已补足时不再给「补足到」按钮')
  assert.ok(text.includes('ghTierAll ✓') && text.includes('ghTierRepo ✓'), '已覆盖的档位带 ✓')
  assert.ok(!text.includes('ghTierBasic ✓'), '未覆盖的档位不带 ✓')
  const status = findNode(tree, (node) => node.props?.['aria-disabled'] === true && textOf(node).includes('ghTierCovered'))
  assert.ok(status !== undefined, '状态是不可点的一行')
})

test('任务看板：GitHub 同步一行状态，可展开链接票列表', async () => {
  const sync = {
    available: true, repo: 'o/r', paused: false, queue: 2, switches: { issues: true },
    links: [
      { id: 'T1', issue: 7, url: 'https://github.com/o/r/issues/7', state: 'synced' },
      { id: 'T2', issue: null, url: null, state: 'unknown', lastError: 'dial tcp: i/o timeout' }
    ]
  }
  const { kit } = taskKit()
  const collapsed = fakeReact([])
  const mod = (await load('client.sidebar.js', collapsed)).mod
  const collapsedText = textOf(collapsed.createElement(mod.TaskBoard, { kit, tasks: tasksFixture(), sync, act: async () => ({}), busy: false }))
  assert.match(collapsedText, /syncTitle/)
  assert.match(collapsedText, /o\/r/)
  assert.match(collapsedText, /syncQueue/)
  assert.match(collapsedText, /syncUnknown/)
  assert.ok(!collapsedText.includes('#7'), '默认收起不展开列表')

  const expanded = fakeReact([undefined, {}, undefined, '', true])
  const mod2 = (await load('client.sidebar.js', expanded)).mod
  const expandedText = textOf(expanded.createElement(mod2.TaskBoard, { kit, tasks: tasksFixture(), sync, act: async () => ({}), busy: false }))
  assert.match(expandedText, /syncStateSynced/)
  assert.match(expandedText, /T1/)
  assert.match(expandedText, /#7/)
  assert.match(expandedText, /syncStateUnknown/)
  assert.match(expandedText, /T2/)
})
