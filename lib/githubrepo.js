/**
 * GitHub 仓库能力探测 + 仓库开关（R0，2.0.0）。
 *
 * - 探测只读：用本机 gh 读仓库信息 / 默认分支保护 / labels / sub-issues 支持情况，
 *   结果缓存在插件数据目录（按 owner/repo，多个工作区共享），失败记 unknown，不猜。
 * - 开关按仓库存，只有用户命令（/relay repo on|off）和之后的面板能改；模型没有写入口。
 * - 依赖不满足时开关不可用并给出原因（例：仓库没开 issues 就不能开投影）。
 * - 本模块不写 GitHub，也不代开任何东西。
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { RelayError } from './core.js'
import { ghEnv } from './ghenv.js'

const PROBE_TTL_MS = 10 * 60_000

/** 开关键：顺序即展示顺序。 */
export const SWITCH_KEYS = Object.freeze(['issues', 'mapIssues', 'prLink', 'approvalGate', 'closeOnTerminal', 'labelSync', 'projectStatus'])
export const DEFAULT_SWITCHES = Object.freeze({
  issues: false,
  mapIssues: false,
  prLink: false,
  approvalGate: true,
  closeOnTerminal: false,
  labelSync: false,
  projectStatus: false
})
export const SWITCH_LABEL = Object.freeze({
  issues: 'issue 投影',
  mapIssues: '地图票（sub-issues）',
  prLink: '关联 PR（只读）',
  approvalGate: '合并前审批门',
  closeOnTerminal: '终态后关 issue',
  labelSync: 'relay 标签同步',
  projectStatus: 'Projects 状态'
})
export const SWITCH_HINT = Object.freeze({
  issues: '按任务建 issue、评论、改 open/closed',
  mapIssues: '父任务建地图票，子任务建 sub-issue；不支持时降级为正文 tasklist',
  prLink: '任务关联 PR，只读展示 review / checks / 可合并性',
  approvalGate: 'merged 前必须有本地审批记录（纯本地，默认开）',
  closeOnTerminal: '终态且写完总结后关 issue；仍需人/主会话显式触发',
  labelSync: '写 relay:stage:* / relay:merged 等标签',
  projectStatus: '把 stage 写进 GitHub Projects 的 Status 字段'
})

/** 执行一次 gh，返回 { stdout, stderr }；测试可替换。 */
function runGh(args, { timeout = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout, maxBuffer: 2 * 1024 * 1024, env: ghEnv(process.env) }, (error, stdout, stderr) => {
      if (error) { error.stderr = String(stderr ?? ''); error.stdout = String(stdout ?? ''); reject(error) } else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/** 从 remote URL 解析 owner/repo（https / ssh / git@ 都认）；不是 GitHub 返回 undefined。 */
export function parseRepoUrl(url) {
  const text = String(url ?? '').trim()
  if (text === '') return undefined
  const match = /(?:github\.com[/:])([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?$/i.exec(text)
  if (match === null) return undefined
  const owner = match[1]
  const name = match[2]
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) return undefined
  return `${owner}/${name}`
}

/** 读工作目录的 origin URL → owner/repo；没有 git / 没有 origin / 不是 GitHub 返回 undefined。 */
export async function originRepo(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return undefined
  const url = await new Promise((resolve) => {
    execFile('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { timeout: 5_000 }, (error, stdout) => {
      resolve(error ? undefined : String(stdout ?? '').trim())
    })
  })
  return parseRepoUrl(url)
}

/** 探测结果里「有没有该能力」：可用/不可用 + 原因。 */
export function switchAvailability(record, key) {
  if (key === 'approvalGate') return { ok: true }
  const probe = record?.probe
  if (probe === undefined || probe.source !== 'ok') return { ok: false, reason: '还没有探测到仓库能力（先 /relay repo refresh）' }
  const repo = probe.repo ?? {}
  if (key === 'prLink') return { ok: true }
  if (key === 'projectStatus') return repo.hasProjects === true ? { ok: true } : { ok: false, reason: '仓库没有开 Projects' }
  if (key === 'issues' || key === 'closeOnTerminal' || key === 'labelSync') {
    return repo.hasIssues === true ? { ok: true } : { ok: false, reason: '仓库没有开 issues' }
  }
  if (key === 'mapIssues') {
    if (repo.hasIssues !== true) return { ok: false, reason: '仓库没有开 issues' }
    if (probe.subIssues === 'unsupported') return { ok: false, reason: '仓库/gh 不支持 sub-issues（可改用正文 tasklist，但先要人工确认）' }
    return { ok: true }
  }
  return { ok: false, reason: '未知开关' }
}

function safeName(repo) {
  return String(repo).replace(/[^A-Za-z0-9._-]+/g, '__')
}

export class GithubRepoStore {
  /**
   * @param base - 插件数据目录（与任务库同级的 repos/）
   * @param opts.gh - (args) => Promise<{stdout,stderr}>（测试替换）
   * @param opts.now - 时钟
   */
  constructor(base, { gh = runGh, now = Date.now } = {}) {
    this.base = base
    this.gh = gh
    this.now = now
    this.cache = new Map()
  }

  path(repo) {
    return join(this.base, 'repos', `${safeName(repo)}.json`)
  }

  async load(repo) {
    const cached = this.cache.get(repo)
    if (cached !== undefined) return cached
    let parsed
    try { parsed = JSON.parse(await readFile(this.path(repo), 'utf8')) } catch { parsed = undefined }
    const record = {
      version: 1,
      repo,
      probedAt: Number(parsed?.probedAt) || 0,
      probe: parsed?.probe,
      switches: { ...DEFAULT_SWITCHES, ...(parsed?.switches ?? {}) }
    }
    this.cache.set(repo, record)
    return record
  }

  async save(record) {
    const path = this.path(record.repo)
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.tmp-${process.pid}-${this.now()}`
    await writeFile(tmp, JSON.stringify(record, null, 2), { mode: 0o600 })
    await rename(tmp, path)
    this.cache.set(record.repo, record)
  }

  async ghJson(args) {
    const { stdout } = await this.gh(args)
    return JSON.parse(stdout)
  }

  /** 只读探测仓库能力；force=true 绕过缓存。失败不抛，记录 state=error。 */
  async probe(repo, { force = false } = {}) {
    const record = await this.load(repo)
    if (!force && record.probedAt > 0 && this.now() - record.probedAt < PROBE_TTL_MS) return record
    const probe = { source: 'error', error: null, repo: {}, protection: { state: 'unknown', requiredReviews: 0, requiredChecks: [], enforceAdmins: false }, labels: [], labelsState: 'unknown', subIssues: 'unknown' }
    try {
      const info = await this.ghJson(['api', `repos/${repo}`])
      probe.source = 'ok'
      probe.repo = {
        hasIssues: info?.has_issues === true,
        hasProjects: info?.has_projects === true,
        hasDiscussions: info?.has_discussions === true,
        defaultBranch: typeof info?.default_branch === 'string' ? info.default_branch : 'main',
        merge: { merge: info?.allow_merge_commit === true, squash: info?.allow_squash_merge === true, rebase: info?.allow_rebase_merge === true },
        deleteBranchOnMerge: info?.delete_branch_on_merge === true,
        permissions: { admin: info?.permissions?.admin === true, maintain: info?.permissions?.maintain === true, push: info?.permissions?.push === true, triage: info?.permissions?.triage === true }
      }
    } catch (error) {
      probe.error = String(error?.stderr ?? error?.message ?? error).trim().split('\n')[0].slice(0, 200)
      record.probedAt = this.now()
      record.probe = probe
      await this.save(record)
      return record
    }
    // 分支保护：404=没开；403=没权限；其它=unknown
    try {
      const protection = await this.ghJson(['api', `repos/${repo}/branches/${probe.repo.defaultBranch}/protection`])
      probe.protection = {
        state: 'on',
        requiredReviews: Number(protection?.required_pull_request_reviews?.required_approving_review_count) || 0,
        requiredChecks: Array.isArray(protection?.required_status_checks?.contexts) ? protection.required_status_checks.contexts.slice(0, 20) : [],
        enforceAdmins: protection?.enforce_admins?.enabled === true
      }
    } catch (error) {
      const text = `${error?.stderr ?? ''} ${error?.message ?? ''}`
      if (/HTTP 404|Branch not protected|Not Found/i.test(text)) probe.protection = { ...probe.protection, state: 'none' }
      else probe.protection = { ...probe.protection, state: 'unknown', error: text.trim().split('\n')[0].slice(0, 160) }
    }
    // labels（只读计数，探测失败不影响主判定）
    try {
      const labels = await this.ghJson(['api', `repos/${repo}/labels?per_page=100`])
      if (Array.isArray(labels)) { probe.labels = labels.map((item) => item?.name).filter((name) => typeof name === 'string').slice(0, 100); probe.labelsState = 'ok' }
    } catch { probe.labelsState = 'unknown' }
    // sub-issues 支持：拿一张票试端点；没有票记 unknown，不猜
    try {
      const issues = await this.ghJson(['api', `repos/${repo}/issues?state=all&per_page=1`])
      if (Array.isArray(issues) && issues.length > 0 && typeof issues[0]?.number === 'number') {
        try {
          await this.ghJson(['api', `repos/${repo}/issues/${issues[0].number}/sub_issues`])
          probe.subIssues = 'supported'
        } catch (error) {
          const text = `${error?.stderr ?? ''} ${error?.message ?? ''}`
          probe.subIssues = /HTTP 404|Not Found/i.test(text) ? 'unsupported' : 'unknown'
        }
      }
    } catch { probe.subIssues = 'unknown' }
    record.probedAt = this.now()
    record.probe = probe
    await this.save(record)
    return record
  }

  /** 取开关（不探测）。 */
  async switches(repo) {
    const record = await this.load(repo)
    return { ...record.switches }
  }

  /** 用户命令改开关：只认 SWITCH_KEYS；开之前核对能力。 */
  async setSwitch(repo, key, value) {
    if (!SWITCH_KEYS.includes(key)) throw new RelayError(`未知仓库开关 ${key}；可选：${SWITCH_KEYS.join(' / ')}`, 'bad_switch')
    if (value === true) {
      const record = await this.probe(repo)
      const available = switchAvailability(record, key)
      if (!available.ok) throw new RelayError(`这个仓库不能开「${SWITCH_LABEL[key]}」：${available.reason}`, 'switch_unavailable')
    }
    const record = await this.load(repo)
    const previous = record.switches[key]
    record.switches = { ...record.switches, [key]: value }
    record.switchesUpdatedAt = this.now()
    record.switchesUpdatedBy = 'user'
    await this.save(record)
    return { record, previous, changed: previous !== value }
  }
}

/** 命令输出：能力 + 开关 + 用法。 */
export function describeRepo(record) {
  const probe = record.probe
  const lines = [`GitHub 仓库：${record.repo}`]
  if (probe === undefined || probe.source !== 'ok') {
    lines.push(`能力探测：失败/${probe?.source ?? '未探测'}${probe?.error ? `（${probe.error}）` : ''}`)
  } else {
    const repo = probe.repo
    const merge = [repo.merge?.merge ? 'merge' : null, repo.merge?.squash ? 'squash' : null, repo.merge?.rebase ? 'rebase' : null].filter(Boolean).join('/') || '未知'
    const protection = probe.protection?.state === 'on'
      ? `开（required reviews ${probe.protection.requiredReviews}，checks ${probe.protection.requiredChecks.length}）`
      : probe.protection?.state === 'none' ? '未开' : '未知'
    lines.push(`能力：issues ${repo.hasIssues ? '开' : '关'} · projects ${repo.hasProjects ? '开' : '关'} · 合并方式 ${merge} · 合并后删分支 ${repo.deleteBranchOnMerge ? '开' : '关'}`)
    lines.push(`main 保护：${protection} · labels ${probe.labels.length}（${probe.labelsState}） · sub-issues ${probe.subIssues === 'supported' ? '支持' : probe.subIssues === 'unsupported' ? '不支持' : '未知'}`)
  }
  lines.push('仓库开关（只由你改；模型没有写入口）：')
  for (const key of SWITCH_KEYS) {
    const value = record.switches[key] === true ? '开' : '关'
    const available = switchAvailability(record, key)
    lines.push(`- ${key}（${SWITCH_LABEL[key]}）：${value}${available.ok ? '' : ` · 不可用：${available.reason}`}`)
  }
  lines.push('用法：/relay repo refresh ｜ /relay repo on <开关> ｜ /relay repo off <开关>')
  return lines.join('\n')
}
