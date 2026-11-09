/**
 * 设置页「会话协作」、监督面板与侧栏状态点共用的 Host 接口。
 *
 * GET ?view=settings（默认）| board | marks
 * POST { action, ... }：模板、版本线、回复、设主会话、退出协作、新建空白会话、重启时机、热重载；
 *   建任务看板（task-init）、常设授权（delegate）、回答主会话提问（ask-answer / ask-dismiss）、开发者模式（dev-mode）、解除唤醒暂停（unattended-resume）。
 * 这些动作都是用户本人在页面上点的：只走已登录的本机页面，不提供给模型工具。
 *
 * - 路由走 DSH connection 守卫（已登录的本机页面），POST 另外要求同源；
 * - 读写与 /relay tpl、/relay line 是同一份存储（TemplateStore / CoordStore），
 *   设置页保存的模板，下一条 /relay new --tpl 立即能用；
 * - 设置页写的版本线记为“用户设定”，与 /relay line 等价。
 */
import { createHash } from 'node:crypto'
import { ARCHIVE_REASONS, COMMAND_REFERENCE, LINE_LIMIT, RelayError, TEXT_LIMIT, USAGE_NOTES, templateName } from './core.js'

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
  // 第一次打开设置页就读出身份（之后用缓存，后台按间隔刷新）
  if (relay.githubAuto && relay.github.current === undefined) await relay.github.probe().catch(() => {})
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
    version: relay.versionInfo(),
    // 设置页「GitHub 账号」：本机共用一个 gh 登录，不分工作区；验证码只给面板
    github: relay.githubView({ withCode: true })
  }
}

const BOARD_ACTIONS = new Set(['reply', 'set-main', 'clear-main', 'leave', 'join', 'open', 'restart-watch', 'restart-cancel',
  'handoff-save', 'handoff-ask', 'handoff-auto', 'handoff-discard', 'handoff-confirm', 'assign', 'claim', 'auto-pin', 'takeover', 'wake', 'prune-archived',
  'task-init', 'task-approval', 'task-split', 'task-pr', 'ticket-launch', 'ticket-takeover', 'ticket-stage', 'delegate', 'delegate-clear', 'ask-answer', 'ask-dismiss', 'unattended-resume', 'board-line', 'role-model', 'dev-mode',
  'mail-read', 'mail-mark', 'merge-approve', 'merge-later', 'merge-reject', 'repo-switch', 'repo-refresh', 'sync-flush', 'sync-backfill', 'sync-pause', 'sync-retry', 'sync-detach', 'project-status-write',
  'github-refresh', 'github-login', 'github-login-cancel', 'github-relogin', 'github-reset-login', 'github-pin', 'github-unpin',
  'repo-watch-start', 'repo-watch-update', 'repo-watch-stop', 'repo-watch-toggle', 'repo-watch-ack', 'repo-watch-check',
  'pr-review', 'pr-comment', 'pr-state', 'pr-ai-review', 'pr-review-record', 'pr-flag', 'branch-delete', 'branch-fetch', 'branch-cleanup'])

/**
 * 面板表单里的模型：缺省 / 'follow' = 跟随（角色模型或原会话）；'default' = DSH 全局默认；
 * 对象 { provider, model, reasoningEffort? } = 当场指定。其余写法当成跟随，不报错。
 */
function modelChoice(value) {
  if (value === 'default') return 'default'
  if (value && typeof value === 'object' && typeof value.provider === 'string' && typeof value.model === 'string') {
    return { provider: value.provider, model: value.model, ...(typeof value.reasoningEffort === 'string' && value.reasoningEffort !== '' ? { reasoningEffort: value.reasoningEffort } : {}) }
  }
  return undefined
}

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
    // 面板上「退出协作」点的是自己：先把主会话一并取消再退，不再让用户先去绕 /relay main clear
    if (relay.coord.isCoordinator(sessionId)) {
      if (sessionId !== fromSession) throw new RelayError('对方是本工作区主会话；要让别的主会话接手请它自己执行 /relay main here', 'is_coordinator')
      await relay.clearCoordinator({ sessionId, workspaceId })
    }
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
      asMain: body.role === 'main',
      fromId: fromSession,
      model: modelChoice(body.model)
    })
  } else if (action === 'takeover') {
    // 用户在面板卡片上点「交接」并确认
    const str = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    result = await relay.takeover({
      source: String(body.source ?? ''), to: str(body.to) ?? 'new', alias: str(body.alias), note: str(body.note),
      mode: body.mode === 'queue' ? 'queue' : 'followup', fromId: fromSession, model: modelChoice(body.model)
    })
  } else if (action === 'wake') {
    // 用户在面板卡片上点「唤醒」
    const str = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    result = await relay.wake({
      target: String(body.target ?? ''), force: body.force === 'resume' || body.force === 'new' ? body.force : undefined,
      alias: str(body.alias), note: str(body.note), fromId: fromSession, model: modelChoice(body.model)
    })
  } else if (action === 'prune-archived') {
    // 面板归档分区的「清理」：二次确认后才发；默认不清「提交本机已不存在」
    const reasons = Array.isArray(body.reasons) ? body.reasons.filter((item) => ARCHIVE_REASONS.includes(item)) : undefined
    const done = await relay.pruneArchived({ key: relay.handoffKey({ sessionId: fromSession, workspaceId }), reasons, dryRun: body.dryRun === true })
    result = { dropped: done.dropped.map((item) => ({ sessionId: item.sessionId, reason: item.reason })), kept: done.kept.length, dryRun: done.dryRun }
  } else if (action === 'repo-switch') {
    // 面板「GitHub 仓库」开关：只由用户点；模型没有写入口
    result = await relay.setRepoSwitch({ sessionId: fromSession, workspaceId, key: body.key, enabled: body.enabled === true })
  } else if (action === 'repo-refresh') {
    // 面板「重新探测」：只读，绕过 10 分钟缓存
    result = { repo: await relay.refreshRepo({ sessionId: fromSession, workspaceId }) }
  } else if (action === 'sync-flush' || action === 'sync-backfill' || action === 'sync-pause' || action === 'sync-retry' || action === 'sync-detach') {
    // 同步队列动作：只由用户在侧栏/设置页点，模型没有写入口
    if (fromSession === undefined) throw new RelayError('需要会话视角才能操作同步队列', 'no_session')
    if (action === 'sync-retry' || action === 'sync-detach') {
      const id = String(body.id ?? '').trim().toUpperCase()
      if (!/^T\d+$/.test(id)) throw new RelayError('任务号无效', 'bad_id')
      result = { text: await relay.syncAction(fromSession, { kind: action, id }) }
    } else if (action === 'sync-pause') {
      result = { text: await relay.syncAction(fromSession, { kind: action, paused: body.paused === true }) }
    } else {
      result = { text: await relay.syncAction(fromSession, { kind: action }) }
    }
  } else if (action === 'task-split') {
    // 动态页「拆分子任务」：只由用户点；建 T10.1… 并写父子 / 串行依赖
    if (fromSession === undefined) throw new RelayError('需要会话视角才能拆分任务', 'no_session')
    const task = String(body.task ?? '').trim().toUpperCase()
    if (!/^[A-Za-z]*\d+[A-Za-z0-9._-]*$/.test(task)) throw new RelayError('父任务号无效', 'bad_id')
    const raw = Array.isArray(body.subtasks) ? body.subtasks : String(body.subtasks ?? '').split(/\|\||\n/)
    const subtasks = raw.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 20)
    if (subtasks.length === 0) throw new RelayError('至少写一个子任务标题', 'need_subtasks')
    result = { text: await relay.taskSplit(fromSession, { id: task, subtasks, serial: body.serial === true }, { origin: 'user' }) }
  } else if (action === 'task-pr') {
    // 动态页「关联 PR」：只由用户点；关联后只读探测，不改任务阶段/审批
    if (fromSession === undefined) throw new RelayError('需要会话视角才能关联 PR', 'no_session')
    const task = String(body.task ?? '').trim().toUpperCase()
    if (!/^[A-Za-z]*\d+[A-Za-z0-9._-]*$/.test(task)) throw new RelayError('任务号无效', 'bad_id')
    const target = typeof body.pr === 'string' ? body.pr.trim() : ''
    if (body.clear !== true && target === '') throw new RelayError('PR 号或 URL 不能为空', 'bad_pr')
    const session = relay.ctx.sessions.get?.(fromSession)
    result = { text: await relay.taskPr(fromSession, body.clear === true ? { id: task, clear: true } : { id: task, target }, { cwd: relay.cwdOf(session) }) }
  } else if (action === 'task-init') {
    // 面板「初始化」卡片：只由用户点；目录由插件按工作区推出（不收面板传的路径）
    const done = await relay.initTaskBoard({ sessionId: fromSession, workspaceId })
    result = { file: done.file }
  } else if (action === 'project-status-write') {
    // 用户点「写回 Projects」；只写 Status 字段，模型没有写入口
    if (fromSession === undefined) throw new RelayError('需要会话视角才能写项目状态', 'no_session')
    result = await relay.writeProjectStatus({ sessionId: fromSession, taskId: body.task })
  } else if (action === 'ticket-launch') {
    // 票子驾驶舱「拉起会话」：只由用户点；服务端复核 gates 后建会话并回填认领 / 分支 / 工作树 / stage=doing。
    if (fromSession === undefined) throw new RelayError('需要会话视角才能拉起', 'no_session')
    const task = String(body.task ?? '').trim().toUpperCase()
    if (!/^[A-Za-z]*\d+[A-Za-z0-9._-]*$/.test(task)) throw new RelayError('任务号无效', 'bad_id')
    const str = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    result = await relay.launchTicket({
      sessionId: fromSession, task,
      alias: str(body.alias),
      skill: str(body.skill),
      model: modelChoice(body.model)
    })
  } else if (action === 'ticket-takeover') {
    // 票子驾驶舱「交接给新会话」：只由用户点；服务端复核交接门禁后建会话、把认领转过去、通知原持有者。
    if (fromSession === undefined) throw new RelayError('需要会话视角才能交接', 'no_session')
    const task = String(body.task ?? '').trim().toUpperCase()
    if (!/^[A-Za-z]*\d+[A-Za-z0-9._-]*$/.test(task)) throw new RelayError('任务号无效', 'bad_id')
    const str = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    result = await relay.takeoverTicket({
      sessionId: fromSession, task,
      alias: str(body.alias),
      skill: str(body.skill),
      model: modelChoice(body.model)
    })
  } else if (action === 'ticket-stage') {
    // 票子驾驶舱的阶段按钮：用户点，只写本地 stage（待分诊 / 可认领 / 进行中 / 待审查…）。
    if (fromSession === undefined) throw new RelayError('需要会话视角才能改阶段', 'no_session')
    result = await relay.setTicketStage({
      sessionId: fromSession,
      workspaceId,
      task: String(body.task ?? '').trim().toUpperCase(),
      stage: body.stage
    })
  } else if (action === 'task-approval') {
    // 任务详情「审核」按钮：只由用户点；模型工具没有审批入口
    if (fromSession === undefined) throw new RelayError('需要会话视角才能审批任务', 'no_session')
    result = { text: await relay.taskApproval(fromSession, {
      id: String(body.id ?? '').trim().toUpperCase(),
      approved: body.approved === true,
      note: typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : undefined
    }) }
  } else if (action === 'board-line') {
    // 面板「初始化」卡片写版本线：与设置页 line 同一存储，但返回看板
    const done = await relay.setLine({ caller: undefined, text: body.text, origin: 'user', workspaceId: workspaceId ?? relay.handoffKey({ sessionId: fromSession }) })
    result = { key: done.key }
  } else if (action === 'delegate') {
    const done = await relay.setDelegation({ sessionId: fromSession, workspaceId, text: body.text })
    result = { key: done.key }
  } else if (action === 'delegate-clear') {
    result = { previous: (await relay.clearDelegation({ sessionId: fromSession, workspaceId })).previous ?? null }
  } else if (action === 'ask-answer') {
    result = await relay.answerAsk({ sessionId: fromSession, workspaceId, id: body.id, option: typeof body.option === 'string' ? body.option : '' })
  } else if (action === 'ask-dismiss') {
    result = await relay.dismissAsk({ sessionId: fromSession, workspaceId, id: body.id })
  } else if (action === 'unattended-resume') {
    result = await relay.resumeWakes({ sessionId: fromSession, workspaceId })
  } else if (action === 'dev-mode') {
    // 面板「开发者模式」：只由用户点；全局开关，限时
    result = await relay.setDevMode({ enabled: body.enabled === true, hours: body.hours === undefined || body.hours === null || body.hours === '' ? undefined : Number(body.hours) })
  } else if (action.startsWith('github-')) {
    // 面板 / 侧栏「GitHub 账号」：只由用户点（登录、补权限、锁定、解锁）；tier 是权限档位
    const tier = typeof body.tier === 'string' && body.tier !== '' ? body.tier : undefined
    result = { github: await relay.githubAction(action, { tier }) }
  } else if (action.startsWith('repo-watch-')) {
    const id = typeof body.id === 'string' ? body.id : undefined
    if (action === 'repo-watch-start') {
      result = await relay.startRepoWatch({ fromSession, user: true, request: {
        repo: body.repo, goal: body.goal, intervalSec: body.intervalSec,
        filters: { labels: body.labels, ignoreLabels: body.ignoreLabels, allowAuthors: body.allowAuthors, onlyAssigned: body.onlyAssigned, assignee: body.assignee, skipClosed: body.skipClosed, skipBots: body.skipBots, skipDrafts: body.skipDrafts },
        activeHours: body.activeHours, ackLabel: body.ackLabel, batchLimit: body.batchLimit, maxWakesPerHour: body.maxWakesPerHour, observe: body.observe, backlogHours: body.backlogHours
      } })
    } else if (action === 'repo-watch-update') {
      if (id === undefined) throw new RelayError('repo-watch-update 需要 id', 'bad_watch_id')
      result = await relay.updateRepoWatch({ id, fromSession, user: true, patch: { ...body, action: undefined, fromSession: undefined, id: undefined } })
    } else if (action === 'repo-watch-stop') {
      if (id === undefined) throw new RelayError('repo-watch-stop 需要 id', 'bad_watch_id')
      result = await relay.stopRepoWatch({ id, fromSession, user: true })
    } else if (action === 'repo-watch-toggle') {
      if (id === undefined) throw new RelayError('repo-watch-toggle 需要 id', 'bad_watch_id')
      result = await relay.toggleRepoWatch({ id, enabled: body.enabled === true, fromSession, user: true })
    } else if (action === 'repo-watch-ack') {
      if (id === undefined) throw new RelayError('repo-watch-ack 需要 id', 'bad_watch_id')
      result = await relay.ackRepoWatch({ id, numbers: body.numbers, fromSession, user: true })
    } else {
      if (id === undefined) throw new RelayError('repo-watch-check 需要 id', 'bad_watch_id')
      result = await relay.checkRepoWatch({ id, fromSession, user: true })
    }
  } else if (action === 'pr-review') {
    const verdict = body.verdict === 'request-changes' ? 'request-changes' : body.verdict === 'approve' ? 'approve' : undefined
    if (verdict === undefined) throw new RelayError('PR 审批只能是 approve / request-changes', 'bad_verdict')
    result = await relay.prAction({ action: verdict, number: body.number, body: body.body, fromSession, user: true })
  } else if (action === 'pr-comment') {
    result = await relay.prAction({ action: 'comment', number: body.number, body: body.body, fromSession, user: true })
  } else if (action === 'pr-state') {
    const state = body.state === 'reopen' ? 'reopen' : body.state === 'close' ? 'close' : undefined
    if (state === undefined) throw new RelayError('PR 状态只能是 close / reopen', 'bad_state')
    result = await relay.prAction({ action: state, number: body.number, fromSession, user: true })
  } else if (action === 'pr-ai-review') {
    // 用户点「AI 审核」：在本工作区拉起一个只读审核会话，去看这个 PR 的最新改动
    result = await relay.launchPrReview({ fromId: fromSession, number: body.number, model: modelChoice(body.model) })
  } else if (action === 'pr-review-record') {
    // PR 详情「记录结论」：只由用户点；只写本地审核记录 + 审计，不写 GitHub
    if (fromSession === undefined) throw new RelayError('需要会话视角才能记录审核结论', 'no_session')
    result = await relay.prReviewRecord({
      fromSession,
      number: body.number,
      verdict: body.verdict,
      note: body.note,
      source: body.source,
      user: true
    })
  } else if (action === 'pr-flag') {
    // PR 详情「忽略 / 拒绝」：只由用户点；只写本地标记 + 审计，可取消，不写 GitHub
    if (fromSession === undefined) throw new RelayError('需要会话视角才能标记 PR', 'no_session')
    result = await relay.prFlag({
      fromSession,
      number: body.number,
      flag: body.flag,
      on: body.on === true,
      user: true
    })
  } else if (action === 'branch-delete') {
    result = await relay.branchAction({
      action: 'delete', workspaceId, name: body.name, remote: body.remote === true,
      force: body.force === true, confirm: body.confirm, removeWorktree: body.removeWorktree === true, fromSession, user: true
    })
  } else if (action === 'branch-fetch') {
    result = await relay.branchAction({ action: 'fetch', workspaceId, fromSession, user: true })
  } else if (action === 'branch-cleanup') {
    result = await relay.cleanupBranches({ items: body.items, confirm: body.confirm === true, fromSession, user: true })
  } else if (action === 'auto-pin') {
    result = await relay.setAutoPin({ sessionId: fromSession, workspaceId, enabled: body.enabled === true })
  } else if (action === 'claim') {
    // 用户在面板上点「拉起认领会话」：按用户指令发首条消息
    result = await relay.launchClaimer({
      caller: undefined, origin: 'user', fromId: fromSession,
      task: typeof body.task === 'string' && body.task.trim() !== '' ? body.task.trim() : undefined,
      alias: typeof body.alias === 'string' && body.alias.trim() !== '' ? body.alias.trim() : undefined,
      model: modelChoice(body.model)
    })
  } else if (action === 'role-model') {
    // 面板「新建会话用的模型」：只由用户点；model 为 'default' / 缺省时改回跟随默认
    const role = body.role === 'main' ? 'main' : body.role === 'worker' ? 'worker' : undefined
    if (role === undefined) throw new RelayError('角色只能是 main 或 worker', 'bad_role')
    const choice = modelChoice(body.model)
    const done = await relay.setRoleModel({ sessionId: fromSession, workspaceId, role, spec: choice === 'default' ? null : choice ?? null })
    result = { key: done.key, models: done.models }
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
      result = await relay.confirmHandoff({ key, to, alias, allowEmpty: body.force === true, mode: body.mode === 'queue' ? 'queue' : 'followup', model: modelChoice(body.model) })
    }
  } else if (action === 'mail-read' || action === 'mail-mark') {
    if (fromSession === undefined) throw new RelayError('需要会话视角才能操作邮箱', 'no_session')
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : (typeof body.id === 'string' && body.id !== '' ? [body.id] : [])
    result = { text: await relay.mailMarkText(fromSession, { ids, state: action === 'mail-read' ? 'read' : (body.state ?? 'read') }) }
  } else if (action === 'merge-approve' || action === 'merge-later' || action === 'merge-reject') {
    // 用户在看板上批准 / 稍后 / 打回合并：只记录 + 通知，不跑 git（推送 / 合并仍要用户在主会话同意）
    const kind = action === 'merge-approve' ? 'approve' : action === 'merge-later' ? 'later' : 'reject'
    result = await relay.mergeDecision({
      sessionId: fromSession,
      workspaceId,
      target: String(body.target ?? ''),
      action: kind,
      sha: typeof body.sha === 'string' ? body.sha : undefined,
      reason: typeof body.reason === 'string' ? body.reason : undefined
    })
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
  return { result, board: await relay.board(undefined, { ...options, githubCode: true }) }
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
    // 面板默认渲染结构化分组；预览/单任务仍用文本。
    let panel
    if (archive === undefined && (typeof body.id !== 'string' || body.id === '')) {
      panel = await relay.tasksPanel(fromSession).catch(() => null)
    }
    return { result: { text, ...(panel === undefined || panel === null ? {} : { panel }), ...(archive === 'preview' ? { planId: /apply ([0-9a-f]{12})/.exec(text)?.[1] ?? null } : {}) } }
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

/** 看板内容的短哈希。只用于「有没有变」，不是安全校验。 */
export function boardVersion(board) {
  return createHash('sha1').update(JSON.stringify(board)).digest('base64url').slice(0, 16)
}

async function read(relay, req) {
  let params = new URLSearchParams()
  try { params = new URL(req.url ?? '/', 'http://local').searchParams } catch {}
  const view = params.get('view') ?? 'settings'
  if (view === 'marks') { await relay.ready(); return relay.marks() }
  if (view === 'board') {
    const board = await relay.board(undefined, { ...boardOptions(params), githubCode: true, lightweight: params.get('light') === '1', withTasks: params.get('tasks') === '1' })
    // 内容版本：客户端带上次的 since，没变就只回版本号（侧栏轮询不再每次传整份看板、也不重画）
    const version = boardVersion(board)
    if (params.get('since') === version) return { notModified: true, version }
    return { ...board, version }
  }
  if (view === 'project-status') {
    await relay.ready()
    const session = params.get('session')
    const task = params.get('task')
    if (typeof session !== 'string' || session === '') throw new RelayError('需要会话视角才能读项目状态', 'no_session')
    return { projectStatus: await relay.projectStatusFor({ sessionId: session, taskId: typeof task === 'string' ? task : '' }) }
  }
  if (view === 'mail') {
    await relay.ready()
    return relay.mailView({
      session: params.get('session') ?? undefined,
      workspaceId: params.get('workspace') ?? undefined,
      unread: params.get('unread') === '1',
      limit: Number(params.get('limit')) || 20
    })
  }
  if (view === 'models') {
    // 面板模型下拉：目录 + 本工作区两组角色模型（只读）
    const options = boardOptions(params)
    return { models: await relay.modelsView({ sessionId: options.session, workspaceId: options.workspaceId }) }
  }
  if (view === 'activity') {
    await relay.ready()
    const ids = String(params.get('ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean)
    return { activity: await relay.activityOf(ids) }
  }
  if (view === 'watch-status') {
    await relay.ready()
    const session = params.get('session') ?? undefined
    return { watchStatus: relay.repoWatchView({ groupKey: session === undefined ? undefined : relay.groupKeyOf(session), sessionId: session }) }
  }
  if (view === 'rail-counts') {
    await relay.ready()
    return { counts: await relay.railCounts({ fromSession: params.get('session') ?? undefined, workspaceId: params.get('workspace') ?? undefined }) }
  }
  if (view === 'pr-list') {
    await relay.ready()
    return { prs: await relay.prListView({ fromSession: params.get('session') ?? undefined, workspaceId: params.get('workspace') ?? undefined, force: params.get('force') === '1', state: params.get('state') === 'closed' ? 'closed' : 'open' }) }
  }
  if (view === 'pr-detail') {
    await relay.ready()
    const number = Number(params.get('number'))
    if (!Number.isSafeInteger(number) || number <= 0) throw new RelayError('PR 号要是正整数', 'bad_number')
    return { prDetail: await relay.prDetailView({ fromSession: params.get('session') ?? undefined, workspaceId: params.get('workspace') ?? undefined, number, force: params.get('force') === '1' }) }
  }
  if (view === 'issue-list') {
    await relay.ready()
    return { issues: await relay.issueListView({ fromSession: params.get('session') ?? undefined, workspaceId: params.get('workspace') ?? undefined, force: params.get('force') === '1' }) }
  }
  if (view === 'branch-list') {
    await relay.ready()
    return { branches: await relay.branchListView({ force: params.get('force') === '1' }) }
  }
  if (view === 'branch-cleanup') {
    await relay.ready()
    return { cleanup: await relay.branchCleanupView({ force: params.get('force') === '1' }) }
  }
  if (view === 'release') {
    // 设置页「发布」区：只读发布事实（package.json / git / tag / gh Release / 本地 tgz）
    await relay.ready()
    return { release: await relay.releaseView({
      sessionId: params.get('session') ?? undefined,
      workspaceId: params.get('workspace') ?? undefined,
      force: params.get('force') === '1'
    }) }
  }
  if (view === 'wake-plan') {
    // 面板「唤醒」表单：只读预判，不发消息
    return { wake: await relay.wakePreview(String(params.get('target') ?? ''), { fromId: params.get('fromSession') ?? undefined }) }
  }
  if (view === 'find') {
    // 面板「找会话」：按 id / 别名 / 标题，只读
    const scope = params.get('scope') === 'all' ? 'all' : 'workspace'
    const query = params.get('q') ?? ''
    const mainOnly = params.get('main') === '1' || params.get('main') === 'true'
    if (query.trim() === '' && !mainOnly) throw new RelayError('搜索内容不能为空', 'empty_query')
    return { find: await relay.findSessions({ query, scope, mainOnly, session: params.get('session') ?? undefined, workspaceId: params.get('workspace') ?? undefined }, req.signal) }
  }
  if (view === 'search') {
    const bool = (name) => params.get(name) === '1' || params.get(name) === 'true'
    const number = (name) => params.get(name) === null ? undefined : Number(params.get(name))
    const query = params.get('q') ?? params.get('query') ?? ''
    const scope = params.get('scope') === 'all' ? 'all' : 'workspace'
    const workspaceId = params.get('workspace') ?? params.get('workspaceId') ?? undefined
    const fromSession = params.get('fromSession') ?? undefined
    const turn = number('turn')
    const maxSessions = number('maxSessions')
    const maxHits = number('maxHits')
    const validNumber = (value, name, { positive = false } = {}) => {
      if (value === undefined) return
      if (!Number.isSafeInteger(value) || (positive ? value < 1 : value < 0)) throw new RelayError(`${name} 要是${positive ? '正' : '非负'}整数`, 'bad_search_option')
    }
    validNumber(turn, 'turn')
    validNumber(maxSessions, 'maxSessions', { positive: true })
    validNumber(maxHits, 'maxHits', { positive: true })
    if (maxSessions !== undefined && maxSessions > 60) throw new RelayError('maxSessions 不能超过 60', 'bad_search_option')
    if (maxHits !== undefined && maxHits > 200) throw new RelayError('maxHits 不能超过 200', 'bad_search_option')
    if (scope === 'all' && workspaceId !== undefined) throw new RelayError('scope=all 不能同时指定 workspace', 'bad_search_scope')
    if (query.trim() === '') throw new RelayError('搜索内容不能为空', 'empty_query')
    return {
      search: await relay.panelSearch({
        query, scope, workspaceId, fromSession,
        ...(bool('regex') ? { regex: true } : {}),
        ...(bool('caseSensitive') || bool('case') ? { caseSensitive: true } : {}),
        ...(params.get('kinds') ? { kinds: params.get('kinds') } : {}),
        ...(params.get('tool') ? { tool: params.get('tool') } : {}),
        ...(turn === undefined ? {} : { turn }),
        ...(maxSessions === undefined ? {} : { maxSessions }),
        ...(maxHits === undefined ? {} : { maxHits })
      }, { signal: req.signal })
    }
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
      // 非 RelayError 也把原始信息带回面板：否则只剩「操作失败」，没法诊断（本地页面，不涉密）
      try { respond(res, 500, { ok: false, error: 'failed', message: String(error?.message ?? error) }) } catch {}
    }
  }
}

export const createRouteHandler = createHandler
