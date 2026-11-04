/**
 * 设置页「会话协作」、监督面板与侧栏状态点共用的 Host 接口。
 *
 * GET ?view=settings（默认）| board | marks
 * POST { action, ... }：模板、版本线、回复、设主会话、退出协作、新建空白会话、重启时机、热重载。
 * 这些动作都是用户本人在页面上点的：只走已登录的本机页面，不提供给模型工具。
 *
 * - 路由走 DSH connection 守卫（已登录的本机页面），POST 另外要求同源；
 * - 读写与 /relay tpl、/relay line 是同一份存储（TemplateStore / CoordStore），
 *   设置页保存的模板，下一条 /relay new --tpl 立即能用；
 * - 设置页写的版本线记为“用户设定”，与 /relay line 等价。
 */
import { COMMAND_REFERENCE, LINE_LIMIT, RelayError, TEXT_LIMIT, USAGE_NOTES, templateName } from './core.js'

export const ROUTE = '/api/dsha-session-relay'
const BODY_LIMIT = TEXT_LIMIT * 4 + 1024

function respond(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  })
  res.end(payload)
}

/** 浏览器发出的 Origin 必须与请求 Host 相同；缺失 Origin 由 connection 守卫判定。 */
function sameOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined || origin === '') return true
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

async function readBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (Buffer.byteLength(body) > BODY_LIMIT) throw Object.assign(new Error('body too large'), { code: 'payload-too-large' })
  }
  return body
}

/** 页面需要的完整快照。 */
export async function snapshot(relay) {
  await relay.ready()
  await relay.templates.reload()
  const templates = Object.entries(relay.templates.snapshot())
    .map(([name, value]) => ({ name, text: value.text, updatedAt: value.updatedAt ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))
  // 每个工作区（侧栏登记）各有一条版本线；line 保留为主工作区那一条，兼容旧界面
  const groups = relay.groupsOverview()
  const primary = groups.find((group) => group.primary) ?? groups[0]
  return {
    templates,
    groups,
    line: primary?.line ?? null,
    lineWorkspace: primary?.id ?? null,
    limits: { text: TEXT_LIMIT, line: LINE_LIMIT },
    reference: COMMAND_REFERENCE,
    notes: USAGE_NOTES,
    version: relay.versionInfo()
  }
}

const BOARD_ACTIONS = new Set(['reply', 'set-main', 'clear-main', 'leave', 'join', 'open', 'restart-watch', 'restart-cancel',
  'handoff-save', 'handoff-ask', 'handoff-auto', 'handoff-discard', 'handoff-confirm', 'assign', 'claim', 'auto-pin', 'takeover', 'wake'])

/** 监督面板动作：返回 { result, board }。 */
async function performBoard(relay, body) {
  const action = body.action
  const fromSession = typeof body.fromSession === 'string' && body.fromSession !== '' ? body.fromSession : undefined
  const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId !== '' ? body.workspaceId : undefined
  let result = {}
  if (action === 'reply') {
    const mode = ['followup', 'steer', 'queue'].includes(body.mode) ? body.mode : 'followup'
    const sent = await relay.send({ caller: undefined, target: String(body.target ?? ''), text: body.text, mode, origin: 'user', fromId: fromSession })
    result = { sessionId: sent.sessionId, wasRunning: sent.wasRunning }
  } else if (action === 'set-main') {
    const { sessionId } = await relay.resolve(String(body.target ?? ''), undefined, { fromId: fromSession })
    const previous = await relay.setCoordinator(sessionId, relay.ctx.sessions.get?.(sessionId))
    result = { sessionId, previous: previous ?? null }
  } else if (action === 'clear-main') {
    result = { previous: (await relay.clearCoordinator({ sessionId: fromSession, workspaceId })).previous ?? null }
  } else if (action === 'leave') {
    const { sessionId } = await relay.resolve(String(body.target ?? ''), undefined, { allowBoard: true, fromId: fromSession })
    if (relay.coord.isCoordinator(sessionId)) throw new RelayError('这是主会话；要卸任请先指定别的主会话', 'is_coordinator')
    await relay.coord.leave(sessionId)
    result = { sessionId }
  } else if (action === 'join') {
    const { sessionId } = await relay.resolve(String(body.target ?? ''), undefined, { fromId: fromSession })
    if (relay.coord.isCoordinator(sessionId)) throw new RelayError('这是主会话，不用加入', 'is_coordinator')
    await relay.coord.join(sessionId)
    // 加入的是它所在工作区（侧栏登记）的协作
    const owner = relay.coordinatorFor(sessionId)
    if (owner !== undefined && owner !== sessionId) await relay.coord.link(sessionId, owner)
    if (relay.coord.state.board[sessionId]?.status === undefined) await relay.coord.upsert(sessionId, { status: 'working', summary: '由用户加入协作' })
    result = { sessionId }
  } else if (action === 'open') {
    result = await relay.openBlank({
      caller: undefined,
      cwd: typeof body.cwd === 'string' && body.cwd.trim() !== '' ? body.cwd.trim() : undefined,
      alias: typeof body.alias === 'string' && body.alias.trim() !== '' ? body.alias.trim() : undefined,
      join: body.join === true,
      fromId: fromSession
    })
  } else if (action === 'takeover') {
    // 用户在面板卡片上点「交接」并确认
    const str = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    result = await relay.takeover({
      source: String(body.source ?? ''), to: str(body.to) ?? 'new', alias: str(body.alias), note: str(body.note),
      mode: body.mode === 'queue' ? 'queue' : 'followup', fromId: fromSession
    })
  } else if (action === 'wake') {
    // 用户在面板卡片上点「唤醒」
    const str = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    result = await relay.wake({
      target: String(body.target ?? ''), force: body.force === 'resume' || body.force === 'new' ? body.force : undefined,
      alias: str(body.alias), note: str(body.note), fromId: fromSession
    })
  } else if (action === 'auto-pin') {
    result = await relay.setAutoPin({ sessionId: fromSession, workspaceId, enabled: body.enabled === true })
  } else if (action === 'claim') {
    // 用户在面板上点「拉起认领会话」：按用户指令发首条消息
    result = await relay.launchClaimer({
      caller: undefined, origin: 'user', fromId: fromSession,
      task: typeof body.task === 'string' && body.task.trim() !== '' ? body.task.trim() : undefined,
      alias: typeof body.alias === 'string' && body.alias.trim() !== '' ? body.alias.trim() : undefined
    })
  } else if (action === 'assign') {
    const done = await relay.assign({ caller: undefined, target: String(body.target ?? ''), value: body.value, origin: 'user', notify: body.notify !== false, fromId: fromSession })
    result = { sessionId: done.sessionId, assigned: done.entry.assigned }
  } else if (action.startsWith('handoff-')) {
    // 交接都在用户本人的页面上点：确认只走这里或 /relay handoff confirm，模型工具只能起草
    const key = relay.handoffKey({ sessionId: fromSession, workspaceId })
    if (action === 'handoff-save') {
      const draft = await relay.saveHandoffDraft({ key, notes: body.notes, by: 'user', from: relay.coord.group(key).coordinator?.sessionId })
      result = { draftId: draft.id }
    } else if (action === 'handoff-ask') {
      const asked = await relay.askHandoffDraft(key)
      result = { sessionId: asked.sessionId, wasRunning: asked.wasRunning }
    } else if (action === 'handoff-auto') {
      const draft = await relay.autoHandoffDraft(key)
      result = { draftId: draft.id }
    } else if (action === 'handoff-discard') {
      result = { discarded: await relay.handoffs.discardDraft(key) }
    } else {
      const to = typeof body.to === 'string' && body.to.trim() !== '' ? body.to.trim() : 'new'
      const alias = typeof body.alias === 'string' && body.alias.trim() !== '' ? body.alias.trim() : undefined
      // 面板上确认前可改说明：先存再交
      if (typeof body.notes === 'string' && body.notes.trim() !== '') await relay.saveHandoffDraft({ key, notes: body.notes, by: relay.handoffs.draft(key)?.by ?? 'user', from: relay.coord.group(key).coordinator?.sessionId })
      result = await relay.confirmHandoff({ key, to, alias, allowEmpty: body.force === true, mode: body.mode === 'queue' ? 'queue' : 'followup' })
    }
  } else if (action === 'watch-cancel') {
    await relay.cancelWatch({ origin: 'user', id: body.id })
  } else if (action === 'restart-watch') {
    relay.restart.start()
  } else if (action === 'restart-cancel') {
    relay.restart.cancel()
  }
  const options = {
    ...(fromSession === undefined ? {} : { session: fromSession }),
    ...(fromSession === undefined && workspaceId !== undefined ? { workspaceId } : {}),
    ...(body.scope === 'all' ? { scope: 'all' } : {})
  }
  return { result, board: await relay.board(undefined, options) }
}

/** 执行一个页面动作；返回新快照。失败抛 RelayError，由路由转成 400。 */
export async function perform(relay, body) {
  await relay.ready()
  const action = body?.action
  if (BOARD_ACTIONS.has(action)) return performBoard(relay, body)
  if (action === 'tasks') {
    // 面板是用户操作：可以执行归档；内容是纯文本报告（与 /relay tasks 相同）
    const fromSession = typeof body.fromSession === 'string' && body.fromSession !== '' ? body.fromSession : undefined
    const archive = body.archive === 'preview' || body.archive === 'apply' ? body.archive : undefined
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string' && /^[A-Za-z]*\d+[A-Za-z0-9._-]*$/.test(id)).slice(0, 200) : undefined
    const text = await relay.tasksText(fromSession, {
      ...(archive === undefined ? {} : { archive }),
      ...(typeof body.planId === 'string' ? { planId: body.planId } : {}),
      ...(ids?.length ? { ids } : {}),
      ...(typeof body.id === 'string' && body.id !== '' ? { id: body.id } : {})
    }, { origin: 'user' })
    return { result: { text, ...(archive === 'preview' ? { planId: /apply ([0-9a-f]{12})/.exec(text)?.[1] ?? null } : {}) } }
  }
  if (action === 'reload') {
    if (relay.shell?.reload === undefined) throw new RelayError('当前外壳不支持热重载，需要重启 DSH 一次', 'no_reload')
    const message = await relay.shell.reload('settings')
    // 重载后由新实现回答快照
    const current = relay.shell.current?.() ?? relay
    return { message, ...(await snapshot(current)) }
  }
  if (action === 'save') {
    const name = templateName(body.name)
    const previous = body.previousName === undefined || body.previousName === null ? undefined : templateName(body.previousName)
    if (previous !== name && relay.templates.snapshot()[name] !== undefined && body.overwrite !== true) {
      throw new RelayError(`已有同名模板 "${name}"`, 'template_exists')
    }
    await relay.templates.save(name, body.text)
    if (previous !== undefined && previous !== name) await relay.templates.remove(previous)
  } else if (action === 'remove') {
    await relay.templates.remove(body.name)
  } else if (action === 'line') {
    await relay.setLine({ caller: undefined, text: body.text, origin: 'user', workspaceId: lineTarget(relay, body) })
  } else if (action === 'line-clear') {
    await relay.clearLine({ workspaceId: lineTarget(relay, body) })
  } else {
    throw new RelayError('未知操作', 'bad_action')
  }
  return snapshot(relay)
}

/** 设置页改哪个工作区的版本线：显式 workspaceId，否则主工作区。 */
function lineTarget(relay, body) {
  if (typeof body.workspaceId === 'string' && body.workspaceId !== '') return body.workspaceId
  return relay.primaryGroupKey()
}

function boardOptions(params) {
  const session = params.get('session')
  const workspaceId = params.get('workspace')
  return {
    ...(typeof session === 'string' && session !== '' ? { session } : {}),
    ...((session === null || session === '') && typeof workspaceId === 'string' && workspaceId !== '' ? { workspaceId } : {}),
    ...(params.get('scope') === 'all' ? { scope: 'all' } : {})
  }
}

async function read(relay, req) {
  let params = new URLSearchParams()
  try { params = new URL(req.url ?? '/', 'http://local').searchParams } catch {}
  const view = params.get('view') ?? 'settings'
  if (view === 'marks') { await relay.ready(); return relay.marks() }
  if (view === 'board') return relay.board(undefined, boardOptions(params))
  if (view === 'activity') {
    await relay.ready()
    const ids = String(params.get('ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean)
    return { activity: await relay.activityOf(ids) }
  }
  if (view === 'wake-plan') {
    // 面板「唤醒」表单：只读预判，不发消息
    return { wake: await relay.wakePreview(String(params.get('target') ?? ''), { fromId: params.get('fromSession') ?? undefined }) }
  }
  return snapshot(relay)
}

export function createHandler(connection, relay, logger) {
  return async (req, res) => {
    try {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) return respond(res, rejection, { ok: false, error: 'access-denied' })
      if (req.method === 'GET') return respond(res, 200, { ok: true, ...(await read(relay, req)) })
      if (req.method !== 'POST') return respond(res, 405, { ok: false, error: 'method-not-allowed' })
      if (!sameOrigin(req)) return respond(res, 403, { ok: false, error: 'cross-origin' })
      let body
      try { body = JSON.parse(await readBody(req)) } catch (error) {
        if (error?.code === 'payload-too-large') return respond(res, 413, { ok: false, error: 'payload-too-large' })
        return respond(res, 400, { ok: false, error: 'invalid-body' })
      }
      return respond(res, 200, { ok: true, ...(await perform(relay, body)) })
    } catch (error) {
      if (error instanceof RelayError) {
        try { respond(res, 400, { ok: false, error: error.code, message: error.message }) } catch {}
        return
      }
      logger?.warn?.(`session-relay: settings route failed: ${error?.stack ?? error}`)
      try { respond(res, 500, { ok: false, error: 'failed' }) } catch {}
    }
  }
}

export const createRouteHandler = createHandler
