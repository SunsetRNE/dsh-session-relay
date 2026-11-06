/** R1 issue 投影：出站队列、marker 幂等、unknown、审批门与关票条件。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BACKOFF_MS, IssueSync, PROJECT_STATUS_TTL_MS, SYNC_FILE, classifyGhFailure, describeIssueSync, issueBody, issueTitle, matchStatusOption, parseProjectItem, parseProjectStatus, projectStageOf, shouldCloseIssue, terminalComment
} from '../lib/issuesync.js'

const task = (over = {}) => ({
  id: 'T1', title: '做点事', state: 'live', stage: 'doing', priority: 'P1', worktree: 'fix/t1',
  statusText: '进行中（@t1 认领）', holderLabel: '@t1', why: '', ...over
})

const switchesOf = (over = {}) => async () => ({ issues: true, closeOnTerminal: false, labelSync: false, ...over })

function fakeGh(handler) {
  const calls = []
  const gh = async (args) => { calls.push(args); return handler(args) }
  return { gh, calls }
}

function createOk(over = {}) {
  return async (args) => {
    if (args[0] === 'issue' && args[1] === 'list') return { stdout: '[]' }
    if (args[1] === 'repos/o/r/issues' && args.includes('POST')) return { stdout: JSON.stringify({ number: 7, html_url: 'https://github.com/o/r/issues/7', ...over }) }
    if (args[1] === 'repos/o/r/issues/7' && args.includes('PATCH') && !args.includes('state=closed')) return { stdout: JSON.stringify({ number: 7, state: 'open' }) }
    if (args[1] === 'repos/o/r/issues/7/comments') return { stdout: '{}' }
    if (args[1] === 'repos/o/r/issues/7' && args.includes('state=closed')) return { stdout: '{}' }
    throw new Error('unexpected gh ' + args.join(' '))
  }
}

async function tempSync({ gh, repoStore = switchesOf(), readTask = async () => task() } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'relay-sync-'))
  let now = 1_000_000
  const sync = new IssueSync(root, { gh, now: () => now, repoStore: { switches: repoStore }, readTask })
  return { root, sync, advance: (ms) => { now += ms }, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('文案：标题带任务号，正文带 marker，终态评论与关票条件明确', () => {
  assert.equal(issueTitle(task()), '[relay T1] 做点事')
  assert.match(issueBody(task()), /<!-- relay-task:T1 -->/)
  assert.match(issueBody(task()), /relay 任务库是事实源/)
  assert.match(terminalComment({ ...task(), state: 'merged', approval: 'approved', done: 'abc1234 可合并' }), /已合并/)
  assert.equal(terminalComment({ ...task(), state: 'merged', approval: 'pending' }), undefined, '待审批不评论')
  assert.equal(terminalComment(task()), undefined)
  assert.equal(shouldCloseIssue({ ...task(), state: 'merged', approval: 'pending', done: 'abc' }, { closeOnTerminal: true }), false)
  assert.equal(shouldCloseIssue({ ...task(), state: 'merged', approval: 'approved', done: 'abc' }, { closeOnTerminal: false }), false)
  assert.equal(shouldCloseIssue({ ...task(), state: 'merged', approval: 'approved', done: 'abc' }, { closeOnTerminal: true }), true)
  assert.equal(shouldCloseIssue({ ...task(), state: 'abandoned' }, { closeOnTerminal: true }), true)
})

test('Projects 状态只读：读 Status、2 分钟缓存、没链接或读失败都不猜', async () => {
  const payload = JSON.stringify({ data: { repository: { issue: { number: 7, projectItems: { nodes: [{ project: { title: '路线图' }, fieldValues: { nodes: [{ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'In Progress', field: { name: 'Status' } }] } }] } } } } })
  const { gh, calls } = fakeGh(async (args) => {
    if (args[0] === 'api' && args[1] === 'graphql') return { stdout: payload }
    throw new Error('unexpected gh ' + args.join(' '))
  })
  const h = await tempSync({ gh })
  try {
    await h.sync.enqueue('o/r', 'T1')
    h.sync.state.repos['o/r'].links.T1 = { issue: 7, state: 'synced' }
    const first = await h.sync.projectStatus('o/r', 'T1')
    assert.equal(first.state, 'ok')
    assert.equal(first.status, 'In Progress')
    assert.equal(first.project, '路线图')
    assert.equal(calls.length, 1)
    const second = await h.sync.projectStatus('o/r', 'T1')
    assert.equal(second.cached, true)
    assert.equal(calls.length, 1, '2 分钟内用缓存')
    h.advance(PROJECT_STATUS_TTL_MS)
    await h.sync.projectStatus('o/r', 'T1')
    assert.equal(calls.length, 2)
    assert.equal((await h.sync.projectStatus('o/r', 'T9')).state, 'none', '没链接 issue 不猜')
    assert.deepEqual(parseProjectStatus({ data: { repository: { issue: { projectItems: { nodes: [] } } } } }), { state: 'none', reason: 'issue 还没有加入 Project' })
  } finally { await h.cleanup() }

  const fail = fakeGh(async () => { throw Object.assign(new Error('boom'), { stderr: 'missing project scope' }) })
  const h2 = await tempSync({ gh: fail.gh })
  try {
    await h2.sync.enqueue('o/r', 'T1')
    h2.sync.state.repos['o/r'].links.T1 = { issue: 8, state: 'synced' }
    const out = await h2.sync.projectStatus('o/r', 'T1')
    assert.equal(out.state, 'unknown')
    assert.match(out.reason, /project scope/)
  } finally { await h2.cleanup() }
})

test('Projects 写回：按 stage 匹配 Status 选项并更新；匹配不到只报选项、不发 mutation', async () => {
  const itemPayload = JSON.stringify({ data: { repository: { issue: { projectItems: { nodes: [{
    id: 'ITEM1',
    project: { id: 'P1', title: '路线图' },
    fieldValues: { nodes: [{ __typename: 'ProjectV2ItemFieldSingleSelectValue', name: 'In Progress', field: { id: 'F1', name: 'Status', options: [{ id: 'O1', name: 'Todo' }, { id: 'O2', name: 'In Progress' }, { id: 'O3', name: 'Done' }] } }] }
  }] } } } } })
  const calls = []
  const gh = async (args) => {
    calls.push(args)
    const query = args.find((item) => typeof item === 'string' && item.startsWith('query='))
    if (query?.includes('mutation(')) return { stdout: '{"data":{}}' }
    if (query !== undefined) return { stdout: itemPayload }
    throw new Error('unexpected gh ' + args.join(' '))
  }
  const h = await tempSync({ gh })
  try {
    await h.sync.enqueue('o/r', 'T1')
    h.sync.state.repos['o/r'].links.T1 = { issue: 7, state: 'synced' }
    const ok = await h.sync.writeProjectStatus('o/r', { id: 'T1', stage: 'doing' })
    assert.equal(ok.ok, true)
    assert.equal(ok.status, 'In Progress')
    const mutation = calls.find((args) => args.some((item) => typeof item === 'string' && item.includes('mutation(')))
    assert.ok(mutation !== undefined, '发出了 mutation')
    assert.ok(mutation.includes('option=O2'), '写的是匹配到的选项')
    const noMatch = await h.sync.writeProjectStatus('o/r', { id: 'T1', stage: 'hold' })
    assert.equal(noMatch.ok, false)
    assert.match(noMatch.reason, /Todo、In Progress、Done/)
  } finally { await h.cleanup() }
  assert.equal(parseProjectItem(JSON.parse(itemPayload)).current, 'In Progress')
  assert.equal(projectStageOf({ state: 'merged' }), 'done')
  assert.equal(matchStatusOption('review', [{ id: 'x', name: 'In Review' }]).id, 'x')
})

test('建票：先按 marker 搜，没有才 create；重复触发不再建第二张', async () => {
  const { gh, calls } = fakeGh(createOk())
  const h = await tempSync({ gh })
  try {
    assert.deepEqual(await h.sync.enqueue('o/r', 'T1', { reason: 'new' }), { queued: true, id: 'T1', repo: 'o/r' })
    const report = await h.sync.flush()
    assert.equal(report[0].synced, true)
    assert.equal(report[0].issue, 7)
    assert.equal(calls[0][0], 'issue')
    assert.equal(calls[0][1], 'list')
    const creates = calls.filter((args) => args[1] === 'repos/o/r/issues' && args.includes('POST'))
    assert.equal(creates.length, 1)
    assert.ok(creates[0].some((arg) => arg.includes('<!-- relay-task:T1 -->')))
    const stored = JSON.parse(await readFile(join(h.root, SYNC_FILE), 'utf8'))
    assert.equal(stored.repos['o/r'].links.T1.issue, 7)
    assert.equal(stored.repos['o/r'].links.T1.state, 'synced')
    assert.equal(h.sync.getLink('o/r', 'T1').url, 'https://github.com/o/r/issues/7')
    // 再次变化：已有 issue，只 PATCH，不再 create
    await h.sync.enqueue('o/r', 'T1', { reason: 'done' })
    await h.sync.flush()
    assert.equal(calls.filter((args) => args[1] === 'repos/o/r/issues' && args.includes('POST')).length, 1)
    assert.ok(calls.some((args) => args[1] === 'repos/o/r/issues/7' && args.includes('PATCH')))
  } finally { await h.cleanup() }
})

test('重试前先搜：找到同 marker 的票就补链接，不再重复建票', async () => {
  const gh = async (args) => {
    if (args[0] === 'issue' && args[1] === 'list') {
      return { stdout: JSON.stringify([{ number: 9, url: 'https://github.com/o/r/issues/9', state: 'open', title: '[relay T1] 做点事', body: 'x\n<!-- relay-task:T1 -->\n' }]) }
    }
    if (args[1] === 'repos/o/r/issues/9' && args.includes('PATCH')) return { stdout: '{"state":"open"}' }
    throw new Error('unexpected ' + args.join(' '))
  }
  const h = await tempSync({ gh })
  try {
    await h.sync.enqueue('o/r', 'T1', { reason: 'retry' })
    await h.sync.flush()
    assert.equal(h.sync.getLink('o/r', 'T1').issue, 9)
    assert.equal(h.sync.getLink('o/r', 'T1').state, 'synced')
  } finally { await h.cleanup() }
})

test('issues 关闭时只排队、不出站；重新打开后仍会把队列发出去', async () => {
  const { gh, calls } = fakeGh(createOk())
  let enabled = false
  const h = await tempSync({ gh, repoStore: async () => ({ issues: enabled, closeOnTerminal: false }) })
  try {
    await h.sync.enqueue('o/r', 'T1', { reason: 'new' })
    await h.sync.flush()
    assert.equal(calls.length, 0)
    assert.equal(h.sync.getLink('o/r', 'T1').state, 'local')
    enabled = true
    await h.sync.flush()
    assert.equal(h.sync.getLink('o/r', 'T1').state, 'synced')
    assert.equal(h.sync.getLink('o/r', 'T1').issue, 7)
  } finally { await h.cleanup() }
})

test('unknown：网络类失败不当作成功，保留队列并按退避重试', async () => {
  let fail = true
  const gh = async (args) => {
    if (fail) {
      if (args[0] === 'issue') throw Object.assign(new Error('exit 1'), { stderr: 'dial tcp: i/o timeout' })
      throw new Error('unexpected ' + args.join(' '))
    }
    return createOk()(args)
  }
  const h = await tempSync({ gh })
  try {
    await h.sync.enqueue('o/r', 'T1', { reason: 'new' })
    const first = await h.sync.flush()
    assert.equal(first[0].unknown, true)
    assert.equal(h.sync.getLink('o/r', 'T1').state, 'unknown')
    assert.ok(Number(h.sync.getLink('o/r', 'T1').nextAttemptAt) > 0)
    const queueAfter = (await h.sync.summary('o/r')).queue
    assert.equal(queueAfter, 1, 'unknown 仍留在队列')
    fail = false
    h.advance(BACKOFF_MS[0] * 2)
    await h.sync.flush()
    assert.equal(h.sync.getLink('o/r', 'T1').state, 'synced')
    assert.equal((await h.sync.summary('o/r')).queue, 0)
  } finally { await h.cleanup() }
})

test('明确失败（404/422）记 failed；重试接口把它放回队列', async () => {
  const gh = async (args) => {
    if (args[0] === 'issue') throw Object.assign(new Error('exit 1'), { stderr: 'HTTP 422: Validation Failed' })
    throw new Error('unexpected ' + args.join(' '))
  }
  const h = await tempSync({ gh })
  try {
    await h.sync.enqueue('o/r', 'T1')
    const report = await h.sync.flush()
    assert.equal(report[0].failed, true)
    assert.equal(h.sync.getLink('o/r', 'T1').state, 'failed')
    assert.equal(await h.sync.retry('o/r', 'T1'), true)
    assert.equal(h.sync.getLink('o/r', 'T1').state, 'queued')
  } finally { await h.cleanup() }
})

test('审批门与关票：已合并已审批才评论+关票；待审批只更新、不关不评', async () => {
  let current = task({ state: 'merged', approval: 'pending', done: 'abc1234 可合并' })
  const { gh, calls } = fakeGh(createOk())
  const h = await tempSync({ gh, repoStore: switchesOf({ closeOnTerminal: true }), readTask: async () => current })
  try {
    await h.sync.enqueue('o/r', 'T1', { reason: 'done' })
    await h.sync.flush()
    assert.equal(calls.filter((args) => args[1] === 'repos/o/r/issues/7/comments').length, 0)
    assert.equal(calls.filter((args) => args.includes('state=closed')).length, 0)
    current = task({ state: 'merged', approval: 'approved', approvalNote: '看过提交', done: 'abc1234 可合并' })
    await h.sync.enqueue('o/r', 'T1', { reason: 'approve' })
    await h.sync.flush()
    assert.equal(calls.filter((args) => args[1] === 'repos/o/r/issues/7/comments').length, 1)
    assert.equal(calls.filter((args) => args.includes('state=closed')).length, 1)
    assert.equal(h.sync.getLink('o/r', 'T1').remoteState, 'closed')
  } finally { await h.cleanup() }
})

test('分类：网络错误 unknown，权限/校验错误 failed；summary 能给出状态文本', async () => {
  assert.equal(classifyGhFailure(Object.assign(new Error('x'), { stderr: 'HTTP 404: Not Found' })).unknown, false)
  assert.equal(classifyGhFailure(Object.assign(new Error('x'), { stderr: 'x509: certificate signed by unknown authority' })).unknown, true)
  assert.equal(classifyGhFailure(Object.assign(new Error('x'), { killed: true })).unknown, true)
  const h = await tempSync({ gh: fakeGh(createOk()).gh })
  try {
    await h.sync.enqueue('o/r', 'T1')
    await h.sync.flush()
    const text = describeIssueSync(await h.sync.summary('o/r'), { formatTime: (value) => String(value) })
    assert.match(text, /GitHub 同步：o\/r/)
    assert.match(text, /T1 · #7 · synced/)
  } finally { await h.cleanup() }
})

test('命令解析：/relay sync 状态、刷新、回填、重试、解绑、暂停', async () => {
  const { parseRelayCommand } = await import('../lib/core.js')
  assert.deepEqual(parseRelayCommand('sync'), { kind: 'sync-show' })
  assert.deepEqual(parseRelayCommand('sync status'), { kind: 'sync-show' })
  assert.deepEqual(parseRelayCommand('sync flush'), { kind: 'sync-flush' })
  assert.deepEqual(parseRelayCommand('sync backfill'), { kind: 'sync-backfill' })
  assert.deepEqual(parseRelayCommand('sync off'), { kind: 'sync-pause', paused: true })
  assert.deepEqual(parseRelayCommand('sync on'), { kind: 'sync-pause', paused: false })
  assert.deepEqual(parseRelayCommand('sync retry t12'), { kind: 'sync-retry', id: 'T12' })
  assert.deepEqual(parseRelayCommand('sync detach T12'), { kind: 'sync-detach', id: 'T12' })
  assert.equal(parseRelayCommand('sync retry').kind, 'invalid')
  assert.equal(parseRelayCommand('sync nope').kind, 'invalid')
})

test('labelSync：建缺失标签、收敛 relay:*、保留非 relay 标签，重复不重写', async () => {
  let current = [{ name: 'bug' }, { name: 'relay:merged' }]
  const calls = []
  const gh = async (args) => {
    calls.push(args)
    if (args[0] === 'issue' && args[1] === 'list') return { stdout: '[]' }
    if (args[1] === 'repos/o/r/issues' && args.includes('POST')) return { stdout: JSON.stringify({ number: 7, html_url: 'https://github.com/o/r/issues/7' }) }
    if (args[1] === 'repos/o/r/issues/7' && args.includes('PATCH') && !args.includes('state=closed')) return { stdout: '{"state":"open"}' }
    if (args[0] === 'label' && args[1] === 'list') return { stdout: JSON.stringify([{ name: 'relay:managed' }]) }
    if (args[0] === 'label' && args[1] === 'create') return { stdout: '{}' }
    if (args[0] === 'issue' && args[1] === 'view') return { stdout: JSON.stringify({ labels: current }) }
    if (args[0] === 'issue' && args[1] === 'edit') {
      const add = args.indexOf('--add-label') >= 0 ? args[args.indexOf('--add-label') + 1].split(',') : []
      const remove = args.indexOf('--remove-label') >= 0 ? args[args.indexOf('--remove-label') + 1].split(',') : []
      current = current.filter((item) => !remove.includes(item.name))
      for (const name of add) if (!current.some((item) => item.name === name)) current.push({ name })
      return { stdout: '{}' }
    }
    throw new Error('unexpected gh ' + args.join(' '))
  }
  const h = await tempSync({ gh, repoStore: switchesOf({ labelSync: true }) })
  try {
    await h.sync.enqueue('o/r', 'T1')
    await h.sync.flush()
    const creates = calls.filter((args) => args[0] === 'label' && args[1] === 'create').map((args) => args[2])
    assert.deepEqual(creates.sort(), ['relay:in-progress', 'relay:stage:doing'])
    const edits = calls.filter((args) => args[0] === 'issue' && args[1] === 'edit')
    assert.equal(edits.length, 1)
    assert.ok(edits[0].includes('--add-label'))
    assert.ok(edits[0].includes('--remove-label'))
    assert.ok(edits[0].includes('relay:merged'), '清掉过期的 relay 标签')
    assert.ok(current.some((item) => item.name === 'bug'), '非 relay 标签保留')
    assert.ok(current.some((item) => item.name === 'relay:managed'))
    assert.ok(current.some((item) => item.name === 'relay:in-progress'))
    // 再刷一次：标签已一致，不再写
    await h.sync.enqueue('o/r', 'T1', { reason: 'again' })
    await h.sync.flush()
    assert.equal(calls.filter((args) => args[0] === 'issue' && args[1] === 'edit').length, 1)
  } finally { await h.cleanup() }
})

test('labelSync 关闭时完全不碰标签', async () => {
  const calls = []
  const gh = async (args) => {
    calls.push(args)
    if (args[0] === 'issue' && args[1] === 'list') return { stdout: '[]' }
    if (args[1] === 'repos/o/r/issues' && args.includes('POST')) return { stdout: JSON.stringify({ number: 7 }) }
    if (args[1] === 'repos/o/r/issues/7' && args.includes('PATCH')) return { stdout: '{"state":"open"}' }
    throw new Error('unexpected gh ' + args.join(' '))
  }
  const h = await tempSync({ gh, repoStore: switchesOf({ labelSync: false }) })
  try {
    await h.sync.enqueue('o/r', 'T1')
    await h.sync.flush()
    assert.equal(calls.filter((args) => args[0] === 'label' || (args[0] === 'issue' && args[1] === 'view')).length, 0)
  } finally { await h.cleanup() }
})

test('mapIssues：父票 wayfinder:map、子票 wayfinder:task，正文 tasklist 降级并补上子票号', async () => {
  const snapshot = {
    T1: { id: 'T1', title: '地图', state: 'live', isMap: true, children: ['T2'], dependsOn: [], parentId: undefined },
    T2: { id: 'T2', title: '子票', state: 'open', isMap: false, children: [], dependsOn: ['T3'], parentId: 'T1' }
  }
  const issues = new Map()
  let next = 7
  const calls = []
  const field = (args, name) => {
    const hit = args.find((arg) => typeof arg === 'string' && arg.startsWith(`${name}=`))
    return hit === undefined ? undefined : hit.slice(name.length + 1)
  }
  const gh = async (args) => {
    calls.push(args)
    if (args[0] === 'issue' && args[1] === 'list') return { stdout: '[]' }
    if (args[0] === 'label' && args[1] === 'list') return { stdout: '[]' }
    if (args[0] === 'label' && args[1] === 'create') return { stdout: '{}' }
    if (args[0] === 'issue' && args[1] === 'view') return { stdout: JSON.stringify({ labels: [] }) }
    if (args[0] === 'issue' && args[1] === 'edit') return { stdout: '{}' }
    if (args[0] === 'api') {
      const path = args[1]
      if (path === 'repos/o/r/issues' && args.includes('POST')) {
        const number = next++
        issues.set(number, { number, title: field(args, 'title'), body: field(args, 'body'), state: 'open' })
        return { stdout: JSON.stringify({ number, html_url: `https://github.com/o/r/issues/${number}`, state: 'open' }) }
      }
      const one = /^repos\/o\/r\/issues\/(\d+)$/.exec(path)
      if (one !== null && args.includes('PATCH')) {
        const number = Number(one[1])
        const item = issues.get(number) ?? { number, state: 'open' }
        if (args.includes('state=closed')) item.state = 'closed'
        else {
          if (field(args, 'title') !== undefined) item.title = field(args, 'title')
          if (field(args, 'body') !== undefined) item.body = field(args, 'body')
        }
        issues.set(number, item)
        return { stdout: JSON.stringify({ state: item.state }) }
      }
      if (/^repos\/o\/r\/issues\/\d+\/comments$/.test(path)) return { stdout: '{}' }
    }
    throw new Error('unexpected gh ' + args.join(' '))
  }
  const h = await tempSync({
    gh,
    repoStore: switchesOf({ mapIssues: true }),
    readTask: async ({ taskId }) => snapshot[taskId]
  })
  try {
    await h.sync.enqueue('o/r', 'T1', { reason: 'map' })
    await h.sync.enqueue('o/r', 'T2', { reason: 'map' })
    await h.sync.flush()
    const byTitle = (part) => [...issues.values()].find((item) => String(item.title ?? '').includes(part))
    const parent = byTitle('[relay T1]')
    const child = byTitle('[relay T2]')
    assert.ok(parent && child, '父票和子票都建了')
    assert.match(parent.body, /- 地图：是/)
    assert.match(parent.body, /- \[ \] #\d+/, '父票正文 tasklist 补上子票号')
    assert.match(child.body, /- 父任务：#\d+/)
    assert.match(child.body, /- 依赖：T3/, '依赖没有 issue 时写任务号，不假装建好边')
    const createdLabels = calls.filter((args) => args[0] === 'label' && args[1] === 'create').map((args) => args[2])
    assert.ok(createdLabels.includes('wayfinder:map'))
    assert.ok(createdLabels.includes('wayfinder:task'))
    const edits = calls.filter((args) => args[0] === 'issue' && args[1] === 'edit')
    assert.ok(edits.some((args) => args.includes('wayfinder:map') || args.join(' ').includes('wayfinder:map')))
    assert.ok(edits.some((args) => args.join(' ').includes('wayfinder:task')))
  } finally { await h.cleanup() }
})

test('mapIssues 关闭时不加 wayfinder 标签、正文也不写地图结构', async () => {
  const calls = []
  const gh = async (args) => {
    calls.push(args)
    if (args[0] === 'issue' && args[1] === 'list') return { stdout: '[]' }
    if (args[1] === 'repos/o/r/issues' && args.includes('POST')) return { stdout: JSON.stringify({ number: 7 }) }
    if (args[1] === 'repos/o/r/issues/7' && args.includes('PATCH')) return { stdout: '{"state":"open"}' }
    throw new Error('unexpected gh ' + args.join(' '))
  }
  const h = await tempSync({
    gh,
    repoStore: switchesOf({ mapIssues: false }),
    readTask: async () => ({ id: 'T1', title: '地图', state: 'live', isMap: true, children: ['T2'], dependsOn: [] })
  })
  try {
    await h.sync.enqueue('o/r', 'T1')
    await h.sync.flush()
    assert.equal(calls.filter((args) => args[0] === 'label').length, 0)
    const create = calls.find((args) => args[1] === 'repos/o/r/issues' && args.includes('POST'))
    assert.ok(create !== undefined)
    assert.doesNotMatch(create.join(' '), /wayfinder/)
  } finally { await h.cleanup() }
})
