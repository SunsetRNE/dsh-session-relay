/**
 * 任务 ↔ PR 只读关联（R0，2.0.0）。
 *
 * - 只读：用本机 gh 读 PR 状态（state / mergeable / reviewDecision / checks），失败记 unknown，不猜。
 * - 关联只由用户命令 `/relay task pr <任务号> <号|URL>` 建立；模型没有对应工具。
 * - PR 不反推任务状态：合并/审批结果只作证据，stage / approval 仍只由用户或主会话记录。
 * - relay 不代开 PR、不代合并；状态缓存在任务库 state.json 的 pr 字段，按需刷新（不做后台轮询）。
 */
import { execFile } from 'node:child_process'
import { formatTime, RelayError } from './core.js'
import { ghEnv } from './ghenv.js'

/** 状态缓存多久后再次查看时自动刷新（按需探测，不做后台轮询）。 */
export const PR_STATUS_TTL_MS = 2 * 60_000
const MAX_NUMBER = 2_000_000_000
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** 执行一次 gh，返回 { stdout, stderr }；测试可替换。 */
function runGh(args, { timeout = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout, maxBuffer: 2 * 1024 * 1024, env: ghEnv(process.env) }, (error, stdout, stderr) => {
      if (error) { error.stderr = String(stderr ?? ''); error.stdout = String(stdout ?? ''); reject(error) } else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

function badRef() {
  return new RelayError('PR 只认号（123）或完整 URL（https://github.com/owner/repo/pull/123）', 'bad_pr')
}

/**
 * 解析用户给的 PR 号 / URL。
 * @returns {{ number: number, repo?: string }}
 */
export function parsePullRef(input) {
  const text = String(input ?? '').trim()
  const number = /^#?(\d{1,10})$/.exec(text)
  if (number !== null) {
    const value = Number(number[1])
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_NUMBER) throw badRef()
    return { number: value }
  }
  const url = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)\/pulls?\/(\d{1,10})\/?(?:[?#]\S*)?$/i.exec(text)
  if (url !== null && REPO_RE.test(`${url[1]}/${url[2]}`)) {
    const value = Number(url[3])
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_NUMBER) throw badRef()
    return { number: value, repo: `${url[1]}/${url[2]}` }
  }
  const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d{1,10})$/.exec(text)
  if (short !== null) {
    const value = Number(short[3])
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_NUMBER) throw badRef()
    return { number: value, repo: `${short[1]}/${short[2]}` }
  }
  throw badRef()
}

function firstLine(error) {
  const text = String(error?.stderr ?? error?.message ?? error ?? '').trim()
  return (text.split('\n').find((line) => line.trim() !== '') ?? '').slice(0, 200)
}

/**
 * 把 gh 的 statusCheckRollup 汇总成计数。不猜：只认明确的结论，其余算 pending。
 */
export function summarizeChecks(rollup) {
  const list = Array.isArray(rollup) ? rollup : []
  let passing = 0
  let pending = 0
  let failing = 0
  for (const item of list) {
    const typename = String(item?.__typename ?? '')
    if (typename === 'StatusContext' || (typename !== 'CheckRun' && typeof item?.state === 'string')) {
      const state = String(item.state).toUpperCase()
      if (state === 'SUCCESS') passing += 1
      else if (state === 'FAILURE' || state === 'ERROR') failing += 1
      else pending += 1
      continue
    }
    const status = String(item?.status ?? '').toUpperCase()
    const conclusion = String(item?.conclusion ?? '').toUpperCase()
    if (status !== 'COMPLETED') pending += 1
    else if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) passing += 1
    else failing += 1
  }
  const total = passing + pending + failing
  return { total, passing, pending, failing, state: failing > 0 ? 'fail' : pending > 0 ? 'pending' : total > 0 ? 'pass' : 'none' }
}

/**
 * 只读探测一个 PR。失败不抛：返回 source=unknown 和一行错误，保留缓存由调用方决定。
 * @returns {{ source: 'ok'|'unknown', probedAt: number, status?, error? }}
 */
export async function probePull(repo, number, { gh = runGh, now = Date.now } = {}) {
  const at = now()
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) return { source: 'unknown', probedAt: at, error: '仓库名不对（要 owner/repo）' }
  if (!Number.isSafeInteger(number) || number <= 0) return { source: 'unknown', probedAt: at, error: 'PR 号不对' }
  try {
    const { stdout } = await gh(['pr', 'view', String(number), '--repo', repo, '--json', 'url,state,isDraft,mergeable,reviewDecision,statusCheckRollup,mergedAt,headRefOid,baseRefName'])
    const info = JSON.parse(stdout)
    if (info === null || typeof info !== 'object') throw new Error('gh 返回的不是 JSON 对象')
    const state = ['OPEN', 'CLOSED', 'MERGED'].includes(info.state) ? info.state : 'UNKNOWN'
    const mergeable = ['MERGEABLE', 'CONFLICTING', 'UNKNOWN'].includes(info.mergeable) ? info.mergeable : 'UNKNOWN'
    const reviewDecision = ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(info.reviewDecision) ? info.reviewDecision : ''
    return {
      source: 'ok',
      probedAt: at,
      status: {
        url: typeof info.url === 'string' ? info.url : undefined,
        state,
        draft: info.isDraft === true,
        mergedAt: typeof info.mergedAt === 'string' ? info.mergedAt : null,
        mergeable,
        reviewDecision,
        checks: summarizeChecks(info.statusCheckRollup),
        headSha: typeof info.headRefOid === 'string' ? info.headRefOid : undefined,
        base: typeof info.baseRefName === 'string' ? info.baseRefName : undefined
      }
    }
  } catch (error) {
    return { source: 'unknown', probedAt: at, error: firstLine(error) || 'gh 查询失败' }
  }
}

/** 探测结果合并进关联记录：成功覆盖状态，失败保留上次状态但标 unknown。 */
export function mergeProbe(pr, probe) {
  const next = { ...pr, probedAt: probe.probedAt, source: probe.source === 'ok' ? 'ok' : 'unknown' }
  delete next.error
  if (probe.error !== undefined) next.error = probe.error
  if (probe.status !== undefined) next.status = probe.status
  return next
}

const REVIEW_LABEL = { APPROVED: '审批通过', CHANGES_REQUESTED: '要求修改', REVIEW_REQUIRED: '待审批' }

/** 状态文案（不含 PR 号）；面板 / 侧栏 / 模型详情共用。 */
export function prStatusText(pr) {
  if (pr === undefined || pr === null || !Number.isSafeInteger(pr.number)) return ''
  if (pr.source !== 'ok' || pr.status === undefined) return '状态未知'
  const status = pr.status
  const parts = []
  if (status.state === 'MERGED') parts.push('已合并')
  else if (status.state === 'CLOSED') parts.push('已关闭')
  else parts.push(status.draft ? '草稿' : 'OPEN')
  if (status.state === 'OPEN' && status.draft !== true) {
    if (status.mergeable === 'MERGEABLE') parts.push('可合并')
    else if (status.mergeable === 'CONFLICTING') parts.push('有冲突')
  }
  if (REVIEW_LABEL[status.reviewDecision] !== undefined) parts.push(REVIEW_LABEL[status.reviewDecision])
  const checks = status.checks
  if (checks !== undefined && Number(checks.total) > 0) {
    const detail = Number(checks.failing) > 0 ? ` · 失败 ${checks.failing}` : Number(checks.pending) > 0 ? ` · 进行中 ${checks.pending}` : ''
    parts.push(`checks ${checks.passing}/${checks.total} 通过${detail}`)
  }
  return parts.join(' · ')
}

/** 一行状态文案（带 PR 号）。 */
export function prLabel(pr) {
  if (pr === undefined || pr === null || !Number.isSafeInteger(pr.number)) return ''
  return `PR #${pr.number} · ${prStatusText(pr)}`
}

/** 模型 / 命令用的一行：带 URL。 */
export function prLine(pr) {
  const label = prLabel(pr)
  if (label === '') return ''
  return pr.url ? `${label} · ${pr.url}` : label
}

/** 侧栏 / 面板用的结构化摘要。 */
export function summarizePr(pr) {
  if (pr === undefined || pr === null || !Number.isSafeInteger(pr.number)) return undefined
  return {
    number: pr.number,
    url: typeof pr.url === 'string' ? pr.url : undefined,
    repo: typeof pr.repo === 'string' ? pr.repo : undefined,
    source: pr.source === 'ok' ? 'ok' : 'unknown',
    label: prLabel(pr)
  }
}

/** 命令输出：多行详情，失败时说明原因并给上次缓存。 */
export function describePrDetail(pr) {
  const lines = [`PR #${pr.number}${pr.repo ? `（${pr.repo}）` : ''}`, `URL：${pr.url ?? '未知'}`]
  if (pr.source === 'ok' && pr.status !== undefined) {
    lines.push(`状态：${prStatusText(pr)}`)
    if (pr.status.headSha) lines.push(`head：${String(pr.status.headSha).slice(0, 12)}${pr.status.base ? ` → ${pr.status.base}` : ''}`)
  } else {
    lines.push(`状态：未知${pr.error ? `（${pr.error}）` : ''}`)
    if (pr.status !== undefined) lines.push(`上次缓存：${prStatusText({ ...pr, source: 'ok' })}`)
    lines.push('只读查询失败不影响本地任务；可以稍后 /relay task pr <任务号> refresh 重试。')
  }
  if (Number.isFinite(pr.probedAt) && pr.probedAt > 0) lines.push(`缓存：${formatTime(pr.probedAt)}（按需只读探测，不代开 PR、不代合并）`)
  return lines.join('\n')
}
