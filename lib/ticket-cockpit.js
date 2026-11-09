/**
 * 票子流程驾驶舱（T15）：内置技能目录 / 票子判定 gates / 拉起首条消息。
 *
 * 只放纯函数与只读目录扫描：不跑 git、不写 GitHub、不发消息、不建会话。
 * 真正的会话创建与看板回填在 impl.js（launchTicket / setTicketStage），
 * 用户动作经 settings-route（ticket-launch / ticket-stage）。
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { STAGE_LABEL } from './taskstate.js'

/** 角色 → 默认技能（内置技能随包提供）。 */
export const TICKET_SKILLS = Object.freeze({ main: 'relay-main', worker: 'relay-worker', release: 'relay-release' })
export const TICKET_DEFAULT_SKILL = TICKET_SKILLS.worker
/** 驾驶舱阶段按钮的顺序（至少覆盖 待分诊 → 可认领 → 进行中 → 待审查）。 */
export const TICKET_STAGE_FLOW = Object.freeze(['triage', 'ready', 'doing', 'review'])
export const TICKET_STAGE_LABEL = STAGE_LABEL
/** 内置技能 provider 的标识与档位：与宿主「打包技能」的默认档位一致，项目 / 用户同名技能仍可覆盖。 */
export const BUNDLED_SKILL_PROVIDER = 'session-relay-bundled'
export const BUNDLED_SKILL_SOURCE = 'bundled'
export const BUNDLED_SKILL_RANK = 600
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 技能名必须是 kebab-case（与宿主 skills 服务校验一致）。 */
export function isSkillName(name) {
  return typeof name === 'string' && SKILL_NAME.test(name)
}

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 * 只用单行 key: value 子集（内置技能都这么写），不引入 YAML 依赖；
 * 解析失败 / 缺 name / description / 名字不是 kebab-case 时返回 undefined（安静跳过）。
 */
export function parseSkillFrontmatter(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (match === null) return undefined
  const front = match[1]
  const field = (key) => {
    const re = new RegExp('^\\s*' + key.replace(/-/g, '\\-') + '\\s*:\\s*(.+?)\\s*$', 'mi')
    const hit = re.exec(front)
    if (hit === null) return undefined
    let value = hit[1].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    return value.trim() === '' ? undefined : value.trim()
  }
  const parseBool = (value) => {
    const text2 = String(value ?? '').trim().toLowerCase()
    if (text2 === 'true' || text2 === 'yes' || text2 === 'on' || text2 === '1') return true
    if (text2 === 'false' || text2 === 'no' || text2 === 'off' || text2 === '0') return false
    return undefined
  }
  const name = field('name')
  const description = field('description')
  if (!isSkillName(name) || description === undefined) return undefined
  const whenToUse = field('whenToUse') ?? field('when-to-use')
  const disableModel = parseBool(field('disable-model-invocation'))
  const userInvocable = parseBool(field('user-invocable'))
  const body = text.slice(match[0].length)
  return {
    name,
    description,
    ...(whenToUse === undefined ? {} : { whenToUse }),
    invocation: { modelInvocable: disableModel !== true, userInvocable: userInvocable !== false },
    body: body.trim(),
    content: body.trim()
  }
}

/** 读一个技能根目录（<root>/<name>/SKILL.md），返回 name / description / whenToUse / path；目录不可读返回 []。 */
export async function readSkillCatalog(root) {
  if (typeof root !== 'string' || root === '') return []
  let entries = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSkillName(entry.name)) continue
    const file = join(root, entry.name, 'SKILL.md')
    let raw
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const parsed = parseSkillFrontmatter(raw)
    if (parsed === undefined || parsed.name !== entry.name) continue
    out.push({
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
      path: file
    })
  }
  return out.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * 技能选择（内置 + 项目 `.dsh/skills`）：同名时项目优先（与宿主 skill 档位一致：项目 100 < 内置 600）。
 * 返回 [{ name, description, source: 'bundled' | 'project' }]；角色默认见 TICKET_SKILLS。
 */
export async function collectTicketSkills({ bundledDir, projectDir } = {}) {
  const [bundled, project] = await Promise.all([readSkillCatalog(bundledDir), readSkillCatalog(projectDir)])
  const byName = new Map()
  for (const row of bundled) byName.set(row.name, { ...row, source: BUNDLED_SKILL_SOURCE })
  for (const row of project) byName.set(row.name, { ...row, source: 'project' })
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/** 服务的技能视图：列表 + 角色默认 + 默认技能是否可用（不存在不报错，交给 gates 说明原因）。 */
export async function ticketSkillsView({ bundledDir, projectDir } = {}) {
  const list = await collectTicketSkills({ bundledDir, projectDir })
  const names = new Set(list.map((item) => item.name))
  return {
    list: list.map((item) => ({ name: item.name, description: item.description, source: item.source })),
    roles: { ...TICKET_SKILLS },
    defaultSkill: TICKET_DEFAULT_SKILL,
    available: names.has(TICKET_DEFAULT_SKILL)
  }
}

function clipText(text, max) {
  const value = String(text ?? '')
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 1)) + '…'
}

/**
 * 每票的判定（服务端算好交给 UI；UI 只显示，不自己猜）。
 * 输入都是普通数据：认领目录状态、持有者分类、依赖、阶段、审批、合并批准、Release、技能。
 * 输出 gates：launch / wake 是否可用与原因，deps / stage / approval / skill / merge / release 明细。
 */
export function ticketGates({
  claim,
  holder,
  deps = [],
  stage,
  approval,
  merge,
  release,
  skill,
  skills = [],
  terminal
} = {}) {
  const claimState = claim === null || claim === undefined ? 'none' : (claim.state ?? 'claimed')
  const endedByClaim = claimState === 'done' || claimState === 'abandoned'
  const ended = terminal === 'merged' || terminal === 'abandoned' || terminal === 'archived' || endedByClaim
  const claimed = claimState === 'claimed'
  const holderState = claimed ? (holder?.state ?? 'unknown') : 'none'
  const holderSession = holder?.sessionId ?? claim?.holder ?? null
  const holderLabel = holder?.label ?? null
  const holderWhy = holder?.why ?? null
  const holderAlive = claimed && holderState === 'live'
  const holderStale = claimed && holderState === 'stale'
  const holderDead = claimed && holderState === 'dead'
  const holderUnknown = claimed && holderState === 'unknown'

  const pending = (Array.isArray(deps) ? deps : []).filter((item) => item?.ended !== true)
  const depsOk = pending.length === 0

  const stageValue = stage === undefined || stage === null || stage === '' ? null : String(stage)
  const stageOk = ended ? false : stageValue === null || stageValue === 'ready'
  const stageReason = ended
    ? '已结束，只读'
    : stageValue === null
      ? '按可认领处理'
      : stageValue === 'ready'
        ? '可认领'
        : `当前阶段是「${TICKET_STAGE_LABEL[stageValue] ?? stageValue}」，先点到「可认领」`

  const approvalValue = approval === undefined || approval === null || approval === '' ? null : String(approval)
  const approvalOk = approvalValue !== 'rejected'
  const approvalReason = approvalValue === 'rejected' ? '审批已打回' : approvalValue === 'pending' ? '待审批' : approvalValue === 'approved' ? '已审批' : '未审批'

  const skillName = typeof skill === 'string' && skill !== '' ? skill : TICKET_DEFAULT_SKILL
  const skillList = Array.isArray(skills) ? skills : []
  const skillExists = skillList.includes(skillName)
  const skillReason = skillExists ? '已安装' : (skillList.length === 0 ? `没有读到技能目录；技能 ${skillName} 不能确认` : `技能 ${skillName} 不存在`)

  // 合并流水线（T14/T18）：stage 是 origin 已合入 / 本地已合入·待推送 / 已批准 / 可合并 / 已发布等；
  // approved 只表示「合并批准记录」，与任务审批（approval）分开，UI 也分开标注（T19）。
  const mergeApproved = merge?.approved === true
  const mergeStage = typeof merge?.stage === 'string' && merge.stage !== '' ? merge.stage : (mergeApproved ? 'approved' : null)
  const mergeView = {
    stage: mergeStage,
    status: typeof merge?.status === 'string' ? merge.status : null,
    approved: mergeApproved,
    sha: typeof merge?.sha === 'string' && merge.sha !== '' ? merge.sha : null,
    stale: merge?.stale === true,
    pendingPush: merge?.pendingPush === true || mergeStage === 'local-merged',
    merged: typeof merge?.merged === 'string' && merge.merged !== '' ? merge.merged : null,
    localMerged: typeof merge?.localMerged === 'string' && merge.localMerged !== '' ? merge.localMerged : null,
    tag: typeof merge?.tag === 'string' && merge.tag !== '' ? merge.tag : null
  }
  // 版本：未发布时给待发版本（releaseSummary.nextTag，当前 2.4.4）；只有已发布才给实际 tag。
  const releaseView = {
    nextTag: typeof release?.nextTag === 'string' && release.nextTag !== '' ? release.nextTag : null,
    tag: typeof release?.tag === 'string' && release.tag !== '' ? release.tag : null,
    released: release?.released === true
  }

  let launchReason = null
  if (ended) launchReason = '已合入 / 已结束：只读，不再拉起'
  else if (holderAlive) launchReason = `已有活跃持有者${holderLabel ? ' ' + holderLabel : ''}；用「打开会话」或「唤醒」`
  else if (holderStale) launchReason = '持有者久未活动：先唤醒或让它交接，避免两个会话同时改'
  else if (holderUnknown) launchReason = '持有者状态不明：先打开 / 唤醒核对，别直接拉起'
  else if (!depsOk) launchReason = `依赖未结束：${pending.map((item) => item.id).join('、')}`
  else if (!stageOk) launchReason = stageReason
  else if (!approvalOk) launchReason = approvalReason
  else if (!skillExists) launchReason = skillReason

  const launchAllowed = launchReason === null
  const wakeAllowed = claimed && !ended && !holderDead
  const wakeReason = !claimed ? '还没有持有者，拉起新会话' : ended ? '已结束，只读' : holderDead ? '持有者已失效：可拉起新会话接手' : null

  return {
    ended,
    claim: claimState,
    holder: {
      sessionId: holderSession,
      label: holderLabel,
      state: holderState,
      alive: holderAlive,
      replaceable: holderDead,
      why: holderWhy
    },
    deps: {
      ok: depsOk,
      total: Array.isArray(deps) ? deps.length : 0,
      ended: (Array.isArray(deps) ? deps.length : 0) - pending.length,
      pending: pending.map((item) => ({ id: String(item.id), title: item.title === undefined ? null : String(item.title), state: item.state ?? null }))
    },
    stage: { value: stageValue, ok: stageOk, reason: stageReason },
    approval: { value: approvalValue, ok: approvalOk, reason: approvalReason },
    skill: { name: skillName, exists: skillExists, reason: skillReason },
    merge: mergeView,
    release: releaseView,
    launch: { allowed: launchAllowed, reason: launchReason },
    wake: { allowed: wakeAllowed, reason: wakeReason }
  }
}

/** 依赖明细：把依赖任务号变成 { id, title, ended, state }（ended 由认领 / 看板状态推出）。 */
export function ticketDependencyViews(dependsOn, { rowOf, openIds, claimedIds, endedIds } = {}) {
  const rows = rowOf instanceof Map ? rowOf : new Map()
  const open = openIds instanceof Set ? openIds : new Set()
  const claimed = claimedIds instanceof Set ? claimedIds : new Set()
  const endedSet = endedIds instanceof Set ? endedIds : new Set()
  return (Array.isArray(dependsOn) ? dependsOn : []).map((id) => {
    const key = String(id ?? '').trim().toUpperCase()
    const row = rows.get(key)
    const ended = endedSet.has(key) || (!open.has(key) && !claimed.has(key) && /已合入|已完成|已放弃|已结束|已发布/.test(String(row?.status ?? '')))
    const state = ended ? 'ended' : claimed.has(key) ? 'claimed' : open.has(key) ? 'open' : null
    return { id: key, title: row?.title === undefined ? null : String(row.title), ended, state }
  })
}

/**
 * 拉起会话的首条消息：把票子的完整字段写进去，并明确要求先加载技能。
 * 由用户在面板点「拉起会话」触发；服务端已代为登记认领（见 impl.launchTicket）。
 */
export function ticketLaunchText({
  task,
  title,
  body,
  priority,
  boardPath,
  claimsPath,
  sessionId,
  alias,
  workspaceTitle,
  coordinatorLabel,
  skill = TICKET_DEFAULT_SKILL,
  branch,
  worktree,
  stage,
  approval,
  deps = [],
  children = [],
  parent,
  issue,
  pr,
  line,
  baseline
} = {}) {
  const taskId = String(task ?? '').trim().toUpperCase()
  const who = `你是${workspaceTitle ? `工作区「${workspaceTitle}」` : ''}新拉起的工作会话${alias ? ` @${alias}` : ''}（id ${sessionId}）${coordinatorLabel ? `，主会话是 ${coordinatorLabel}` : ''}。`
  const depText = Array.isArray(deps) && deps.length > 0
    ? deps.map((item) => `${item.id}${item.title ? ' ' + item.title : ''}（${item.ended ? '已结束' : '未结束'}${item.state ? ' · ' + item.state : ''}）`).join('；')
    : '无'
  const childText = Array.isArray(children) && children.length > 0 ? children.map((item) => `${item.id ?? item}${item.title ? ' ' + item.title : ''}`).join('；') : '无'
  const issueText = issue ? `#${issue.number}${issue.url ? '（' + issue.url + '）' : ''}` : '未关联'
  const prText = pr ? `#${pr.number}${pr.url ? '（' + pr.url + '）' : ''}${pr.label ? ' · ' + pr.label : ''}` : '未关联'
  const stageText = stage ? (TICKET_STAGE_LABEL[stage] ?? stage) : '未设置'
  const approvalText = approval === 'approved' ? '已审批' : approval === 'rejected' ? '已打回' : approval === 'pending' ? '待审批' : '未审批'
  return [
    who + '你的任务：完成下面这张票，不要换票。',
    '',
    `票：${taskId}${priority ? ' ' + priority : ''} ${title ?? ''}`.trim(),
    `阶段：${stageText} · 审批：${approvalText}`,
    `依赖：${depText}`,
    `子票：${childText}`,
    `父任务：${parent ? `${parent.id ?? parent}${parent.title ? ' ' + parent.title : ''}` : '无'}`,
    `issue：${issueText}`,
    `PR：${prText}`,
    `版本线：${line ? clipText(String(line), 500) : '未设置'}`,
    baseline ? `基线：${baseline}` : null,
    '',
    `先加载技能：调用 skill 工具加载内置技能「${skill}」，再按它和看板认领规则开工。`,
    `看板：${boardPath ?? ''}；本票认领记录：${claimsPath ?? ''}/${taskId}/owner（已由用户代你登记，owner 是你的 id；不要再改认领别的任务）。`,
    `工作树 / 分支：${worktree ? `工作树 ${worktree}` : '按看板认领规则建'}${branch ? `，分支 ${branch}` : ''}。目录已被占用或规则不一致时按看板「认领规则」另建，并把实际分支 / 工作树写进 .ACTIVE-SESSION 和汇报。`,
    '',
    '票正文（含验收）：',
    clipText(String(body ?? '').trim(), 6000) || '（详情段为空，用 peer_tasks id=' + taskId + ' 看结论）',
    '',
    '收尾：串行测试、写 .SESSION-DONE，用 peer_task action=done text="<提交号> 可否合并" 写结论，再用 peer_report status=ready 汇报（写清 commit / 分支 / 测试数 / 文件）。',
    '边界：推送、合并到 main、打 tag、发 Release、安装、操作手机都要先问用户；不 push、不合并、不发版。'
  ].filter((row) => row !== null).join('\n')
}
