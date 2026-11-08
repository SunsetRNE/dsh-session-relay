/**
 * 侧栏「PR / 问题 / 分支」三个列表的只读数据 + 用户点击的写动作。
 *
 * 边界：
 * - 读：gh / git 只读；缓存 60 秒（force 绕过）。
 * - 写：PR 审批 / 评论 / 关闭重开、分支删除 / fetch 只由用户在侧栏点击；
 *   模型没有对应工具，路由层再校验 user === true。写前走 github.requireIdentity()，写后刷新缓存。
 * - 远端分支用本地 origin/* 引用（上次 fetch 的状态），刷新由用户点「拉取」；
 *   删除远端分支走 `git push origin --delete`，要求确认名等于分支名。
 */
import { execFile } from 'node:child_process'
import { RelayError } from './core.js'
import { ghEnv } from './ghenv.js'

// 5 分钟：侧栏列表优先快；刷新按钮 force=1，写动作后 invalidate 对应 key
export const LIST_TTL_MS = 300_000
export const LIST_LIMIT = 50
const GH_TIMEOUT_MS = 30_000
const GIT_TIMEOUT_MS = 20_000
export const MAX_COMMENT = 4000

function runGh(args, { timeout = GH_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout, maxBuffer: 4 * 1024 * 1024, env: ghEnv(process.env) }, (error, stdout, stderr) => {
      if (error) { error.stderr = String(stderr ?? ''); error.stdout = String(stdout ?? ''); reject(error) } else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

function runGit(args, { timeout = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { error.stderr = String(stderr ?? ''); error.stdout = String(stdout ?? ''); reject(error) } else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/** gh / git 失败信息：取 stderr 第一行，别把整段命令回显给界面。 */
export function commandError(error, fallback = '命令失败') {
  const raw = error?.stderr ?? error?.message ?? error
  const text = typeof raw === 'string' ? raw.trim().split('\n')[0] : ''
  return text === '' ? fallback : text.slice(0, 240)
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
export function requireRepo(repo) {
  const text = String(repo ?? '').trim()
  if (!REPO_RE.test(text)) throw new RelayError('仓库要写成 owner/name', 'bad_repo')
  return text
}

const PR_DECISIONS = new Set(['', 'APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])
export function parsePullRequests(text) {
  let rows
  try { rows = JSON.parse(String(text ?? '')) } catch { throw new RelayError('gh pr list 返回的不是 JSON', 'bad_gh_output') }
  if (!Array.isArray(rows)) throw new RelayError('gh pr list 返回的不是数组', 'bad_gh_output')
  return rows.map((row) => ({
    number: Number(row?.number),
    title: String(row?.title ?? ''),
    author: String(row?.author?.login ?? ''),
    url: String(row?.url ?? ''),
    draft: row?.isDraft === true,
    reviewDecision: PR_DECISIONS.has(String(row?.reviewDecision ?? '')) ? String(row?.reviewDecision ?? '') : String(row?.reviewDecision ?? ''),
    merged: row?.mergedAt !== null && row?.mergedAt !== undefined && String(row?.mergedAt) !== '',
    updatedAt: String(row?.updatedAt ?? ''),
    comments: Array.isArray(row?.comments) ? row.comments.length : Number(row?.comments ?? 0),
    additions: Number(row?.additions) || 0,
    deletions: Number(row?.deletions) || 0,
    changedFiles: Number(row?.changedFiles) || 0,
    head: String(row?.headRefName ?? ''),
    base: String(row?.baseRefName ?? '')
  })).filter((row) => Number.isSafeInteger(row.number) && row.number > 0).slice(0, LIST_LIMIT)
}

export function parseIssues(text) {
  let rows
  try { rows = JSON.parse(String(text ?? '')) } catch { throw new RelayError('gh issue list 返回的不是 JSON', 'bad_gh_output') }
  if (!Array.isArray(rows)) throw new RelayError('gh issue list 返回的不是数组', 'bad_gh_output')
  return rows.map((row) => ({
    number: Number(row?.number),
    title: String(row?.title ?? ''),
    author: String(row?.author?.login ?? ''),
    url: String(row?.url ?? ''),
    updatedAt: String(row?.updatedAt ?? ''),
    comments: Array.isArray(row?.comments) ? row.comments.length : Number(row?.comments ?? 0),
    labels: (Array.isArray(row?.labels) ? row.labels : []).map((label) => (typeof label === 'string' ? label : label?.name)).filter(Boolean).slice(0, 8),
    assignees: (Array.isArray(row?.assignees) ? row.assignees : []).map((entry) => (typeof entry === 'string' ? entry : entry?.login)).filter(Boolean).slice(0, 8)
  })).filter((row) => Number.isSafeInteger(row.number) && row.number > 0).slice(0, LIST_LIMIT)
}

/** git for-each-ref（\x00 分隔）→ 本地分支。 */
export function parseLocalBranches(stdout) {
  const out = []
  for (const line of String(stdout ?? '').split('\n')) {
    if (line.trim() === '') continue
    const [head, name, sha, upstream, track, at, ...subject] = line.split('\x00')
    if (typeof name !== 'string' || name === '') continue
    const ahead = /ahead (\d+)/.exec(track ?? '')
    const behind = /behind (\d+)/.exec(track ?? '')
    out.push({
      name,
      sha: String(sha ?? ''),
      current: String(head ?? '').trim() === '*',
      upstream: typeof upstream === 'string' && upstream !== '' ? upstream : null,
      ahead: ahead === null ? 0 : Number(ahead[1]),
      behind: behind === null ? 0 : Number(behind[1]),
      at: String(at ?? '') === '' ? null : String(at),
      subject: subject.join('\x00')
    })
  }
  return out
}

/** git worktree list --porcelain → 工作树（path / branch / head）。 */
export function parseWorktrees(stdout) {
  const out = []
  let current = {}
  for (const raw of String(stdout ?? '').split('\n')) {
    const line = raw.trim()
    if (line === '') {
      if (current.path !== undefined) out.push(current)
      current = {}
      continue
    }
    const space = line.indexOf(' ')
    const key = space === -1 ? line : line.slice(0, space)
    const value = space === -1 ? '' : line.slice(space + 1)
    if (key === 'worktree') current.path = value
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'HEAD') current.head = value
    else if (key === 'detached') current.detached = true
    else if (key === 'bare') current.bare = true
  }
  if (current.path !== undefined) out.push(current)
  return out
}

/** git for-each-ref refs/remotes/origin → 远端分支（去掉 origin/ 前缀，跳过 origin/HEAD）。 */
export function parseRemoteBranches(stdout) {
  const out = []
  for (const line of String(stdout ?? '').split('\n')) {
    if (line.trim() === '') continue
    const [full, sha, at, ...subject] = line.split('\x00')
    if (typeof full !== 'string' || !full.startsWith('origin/')) continue
    const name = full.slice('origin/'.length)
    if (name === 'HEAD' || name === '') continue
    out.push({
      name,
      sha: String(sha ?? ''),
      at: String(at ?? '') === '' ? null : String(at),
      subject: subject.join('\x00')
    })
  }
  return out
}

/** `git symbolic-ref --short refs/remotes/origin/HEAD` → main；读不到返回 undefined。 */
export function parseDefaultBranch(stdout) {
  const text = String(stdout ?? '').trim()
  if (text === '') return undefined
  return text.startsWith('origin/') ? text.slice('origin/'.length) : text
}

const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/
export function validateBranchName(name) {
  const text = String(name ?? '')
  if (!BRANCH_RE.test(text)) throw new RelayError('分支名只能包含字母、数字和 . _ / -（且不能以 - 开头）', 'bad_branch_name')
  if (text.includes('..') || text.includes('@{') || text.endsWith('/') || text.endsWith('.lock')) {
    throw new RelayError('分支名不合法', 'bad_branch_name')
  }
  return text
}

/** 删除前的纯校验：默认分支 / 当前分支不可删；远端只做默认分支保护，本地未合并要 force。 */
export function assertBranchDeletable({ name, defaultBranch, current, merged, remote, force }) {
  const branch = validateBranchName(name)
  if (defaultBranch !== undefined && branch === defaultBranch) throw new RelayError(`不能删除默认分支 ${branch}`, 'protected_branch')
  if (remote !== true && current === true) throw new RelayError(`不能删除当前分支 ${branch}`, 'current_branch')
  if (remote !== true && merged !== true && force !== true) throw new RelayError(`分支 ${branch} 还没合并；要删就勾选「强制删除未合并分支」`, 'branch_unmerged')
  return branch
}

const PR_REVIEW_STATE = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes-requested', COMMENTED: 'commented', DISMISSED: 'dismissed', PENDING: 'pending' }

export function parsePullDetail(text) {
  let row
  try { row = JSON.parse(String(text ?? '')) } catch { throw new RelayError('gh pr view 返回的不是 JSON', 'bad_gh_output') }
  if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new RelayError('gh pr view 返回的不是对象', 'bad_gh_output')
  const number = Number(row.number)
  if (!Number.isSafeInteger(number) || number <= 0) throw new RelayError('PR 号缺失', 'bad_gh_output')
  const authors = (list) => (Array.isArray(list) ? list : []).map((entry) => ({
    login: String(entry?.author?.login ?? entry?.user?.login ?? ''),
    body: typeof entry?.body === 'string' ? entry.body : '',
    createdAt: String(entry?.createdAt ?? entry?.submittedAt ?? ''),
    state: entry?.state === undefined ? null : String(entry.state)
  })).filter((entry) => entry.login !== '')
  const files = (Array.isArray(row.files) ? row.files : []).map((entry) => ({
    path: String(entry?.path ?? ''),
    additions: Number(entry?.additions) || 0,
    deletions: Number(entry?.deletions) || 0,
    changeType: String(entry?.changeType ?? '')
  })).filter((entry) => entry.path !== '').slice(0, 100)
  return {
    number,
    title: String(row.title ?? ''),
    body: typeof row.body === 'string' ? row.body : '',
    author: String(row.author?.login ?? ''),
    state: String(row.state ?? ''),
    isDraft: row.isDraft === true,
    merged: row.mergedAt !== null && row.mergedAt !== undefined,
    url: String(row.url ?? ''),
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
    comments: authors(row.comments),
    additions: Number(row.additions) || 0,
    deletions: Number(row.deletions) || 0,
    changedFiles: Number(row.changedFiles) || files.length,
    files,
    reviews: (Array.isArray(row.reviews) ? row.reviews : []).map((entry) => ({
      login: String(entry?.author?.login ?? entry?.user?.login ?? ''),
      body: typeof entry?.body === 'string' ? entry.body : '',
      submittedAt: String(entry?.submittedAt ?? ''),
      state: PR_REVIEW_STATE[String(entry?.state ?? '')] ?? String(entry?.state ?? '').toLowerCase()
    })).filter((entry) => entry.login !== '')
  }
}

export class GitHubLists {
  /**
   * @param {object} opts
   * @param {(args: string[], opts?: object) => Promise<{stdout: string, stderr: string}>} opts.gh
   * @param {(args: string[], opts?: object) => Promise<{stdout: string, stderr: string}>} opts.git
   * @param {{requireIdentity: () => Promise<void>}} opts.identity
   * @param {(file: string, record: object) => Promise<void>} opts.audit
   */
  constructor({ gh = runGh, git = runGit, identity, audit, now = Date.now, ttlMs = LIST_TTL_MS, logger } = {}) {
    this.gh = gh
    this.git = git
    this.identity = identity
    this.audit = audit
    this.now = now
    this.ttlMs = ttlMs
    this.logger = logger
    this.cache = new Map()
    // 同一个 key 的并发 gh 只跑一次（侧栏首屏计数和页签同时打开时共用）
    this.pending = new Map()
  }

  async guard() {
    if (this.identity !== undefined && typeof this.identity.requireIdentity === 'function') await this.identity.requireIdentity()
  }

  async cached(key, force, load) {
    const hit = this.cache.get(key)
    if (force !== true && hit !== undefined && this.now() - hit.at < this.ttlMs) return hit.value
    const pending = this.pending.get(key)
    if (pending !== undefined) return pending
    const task = (async () => {
      try {
        const value = await load()
        // 期间被 invalidate（用户写了）就不要把旧结果写回缓存
        if (this.pending.get(key) === task) this.cache.set(key, { at: this.now(), value })
        return value
      } finally {
        if (this.pending.get(key) === task) this.pending.delete(key)
      }
    })()
    this.pending.set(key, task)
    return task
  }

  invalidate(prefix) {
    for (const key of [...this.cache.keys()]) if (key.startsWith(prefix)) this.cache.delete(key)
    // 在途的旧请求也放弃：写之后的下一次读要重新跑 gh，不和写之前的请求共用
    for (const key of [...this.pending.keys()]) if (key.startsWith(prefix)) this.pending.delete(key)
  }

  async pullRequests(repo, { force = false, state = 'open' } = {}) {
    const clean = requireRepo(repo)
    const prState = state === 'closed' ? 'closed' : 'open'
    return this.cached('pr:' + prState + ':' + clean, force, async () => {
      await this.guard()
      const args = ['pr', 'list', '--repo', clean, '--state', prState, '--limit', String(LIST_LIMIT),
        '--json', 'number,title,author,reviewDecision,isDraft,updatedAt,comments,url,headRefName,baseRefName,mergedAt,additions,deletions,changedFiles']
      return { repo: clean, state: prState, items: parsePullRequests((await this.gh(args)).stdout), fetchedAt: this.now() }
    })
  }

  async pullRequestDetail(repo, number, { force = false } = {}) {
    const clean = requireRepo(repo)
    const n = Number(number)
    if (!Number.isSafeInteger(n) || n <= 0) throw new RelayError('PR 号要是正整数', 'bad_number')
    return this.cached('prd:' + clean + ':' + n, force, async () => {
      await this.guard()
      const args = ['pr', 'view', String(n), '--repo', clean,
        '--json', 'number,title,body,author,state,isDraft,mergedAt,url,createdAt,updatedAt,comments,reviews,files,additions,deletions,changedFiles']
      return { repo: clean, detail: parsePullDetail((await this.gh(args)).stdout), fetchedAt: this.now() }
    })
  }

  async issues(repo, { force = false } = {}) {
    const clean = requireRepo(repo)
    return this.cached('issue:' + clean, force, async () => {
      await this.guard()
      const args = ['issue', 'list', '--repo', clean, '--state', 'open', '--limit', String(LIST_LIMIT),
        '--json', 'number,title,author,labels,assignees,updatedAt,comments,url']
      return { repo: clean, items: parseIssues((await this.gh(args)).stdout), fetchedAt: this.now() }
    })
  }

  /** 本地 + 远端分支（远端用本机 origin/* 引用；需要最新请先 fetch）。 */
  async branches(path, { repo, force = false } = {}) {
    if (typeof path !== 'string' || path === '') throw new RelayError('缺少工作区路径', 'no_workspace')
    return this.cached('branches:' + path, force, async () => {
      const localFormat = '%(HEAD)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:iso-strict)%00%(subject)'
      const remoteFormat = '%(refname:short)%00%(objectname)%00%(committerdate:iso-strict)%00%(subject)'
      const [localRes, remoteRes, headRes, worktreeRes] = await Promise.all([
        this.git(['-C', path, 'for-each-ref', '--format=' + localFormat, 'refs/heads']),
        this.git(['-C', path, 'for-each-ref', '--format=' + remoteFormat, 'refs/remotes/origin']).catch(() => ({ stdout: '' })),
        this.git(['-C', path, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => ({ stdout: '' })),
        this.git(['-C', path, 'worktree', 'list', '--porcelain']).catch(() => ({ stdout: '' }))
      ])
      const worktreeOf = new Map(parseWorktrees(worktreeRes.stdout).filter((item) => typeof item.branch === 'string' && item.branch !== '').map((item) => [item.branch, item.path]))
      const local = parseLocalBranches(localRes.stdout)
      for (const branch of local) branch.worktree = worktreeOf.get(branch.name) ?? null
      const current = local.find((branch) => branch.current)?.name
      let defaultBranch = parseDefaultBranch(headRes.stdout)
      if (defaultBranch === undefined) defaultBranch = local.some((branch) => branch.name === 'main') ? 'main' : local.some((branch) => branch.name === 'master') ? 'master' : undefined
      const merged = new Set()
      if (defaultBranch !== undefined) {
        try {
          const mergedRes = await this.git(['-C', path, 'branch', '--merged', defaultBranch])
          for (const line of String(mergedRes.stdout ?? '').split('\n')) {
            const name = line.replace(/^\*?\s*/, '').trim()
            if (name !== '') merged.add(name)
          }
        } catch {}
      }
      for (const branch of local) branch.merged = merged.has(branch.name)
      return { path, repo: repo ?? null, current: current ?? null, defaultBranch: defaultBranch ?? null, local, remote: parseRemoteBranches(remoteRes.stdout), fetchedAt: this.now() }
    })
  }

  async fetch(path) {
    if (typeof path !== 'string' || path === '') throw new RelayError('缺少工作区路径', 'no_workspace')
    await this.guard()
    const result = await this.git(['-C', path, 'fetch', '--prune', 'origin'])
    this.invalidate('branches:' + path)
    return { ok: true, stderr: String(result.stderr ?? '').trim().slice(0, 200) }
  }

  /** 用户点击：PR 审批 / 评论 / 关闭重开。 */
  async prAction(repo, number, action, { body } = {}) {
    const clean = requireRepo(repo)
    const n = Number(number)
    if (!Number.isSafeInteger(n) || n <= 0) throw new RelayError('PR 号要是正整数', 'bad_number')
    const text = typeof body === 'string' ? body.trim() : ''
    if (text.length > MAX_COMMENT) throw new RelayError(`评论最多 ${MAX_COMMENT} 字`, 'comment_too_long')
    let args
    if (action === 'approve') args = ['pr', 'review', String(n), '--repo', clean, '--approve']
    else if (action === 'request-changes') {
      if (text === '') throw new RelayError('请求修改要写说明', 'comment_required')
      args = ['pr', 'review', String(n), '--repo', clean, '--request-changes', '--body', text]
    } else if (action === 'comment') {
      if (text === '') throw new RelayError('评论不能为空', 'comment_required')
      args = ['pr', 'comment', String(n), '--repo', clean, '--body', text]
    } else if (action === 'close') args = ['pr', 'close', String(n), '--repo', clean]
    else if (action === 'reopen') args = ['pr', 'reopen', String(n), '--repo', clean]
    else throw new RelayError(`未知的 PR 动作：${action}`, 'bad_pr_action')
    if (action === 'approve' && text !== '') args.push('--body', text)
    await this.guard()
    const result = await this.gh(args)
    // 列表缓存键是 pr:<open|closed>:<repo>，详情是 prd:<repo>:<号>；写后一起清，避免详情 / 计数还看旧状态
    this.invalidate('pr:open:' + clean)
    this.invalidate('pr:closed:' + clean)
    this.invalidate('prd:' + clean + ':')
    await this.writeAudit({ event: 'pr-' + action, repo: clean, number: n, body: text.slice(0, 500), stderr: String(result.stderr ?? '').trim().slice(0, 200) })
    return { ok: true, action, number: n }
  }

  /** 用户点击：删除本地 / 远端分支。调用前由 impl 保证路径来自已登记工作区。 */
  async deleteBranch({ path, name, remote = false, force = false, confirm } = {}) {
    if (typeof path !== 'string' || path === '') throw new RelayError('缺少工作区路径', 'no_workspace')
    const branch = validateBranchName(name)
    if (remote === true && String(confirm ?? '') !== branch) throw new RelayError('删除远端分支要在确认框里输入分支名', 'confirm_mismatch')
    const snapshot = await this.branches(path, { force: true })
    if (snapshot.defaultBranch !== null && branch === snapshot.defaultBranch) throw new RelayError(`不能删除默认分支 ${branch}`, 'protected_branch')
    if (remote !== true && branch === snapshot.current) throw new RelayError(`不能删除当前分支 ${branch}`, 'current_branch')
    if (remote !== true) {
      const target = snapshot.local.find((item) => item.name === branch)
      if (target === undefined) throw new RelayError(`本地没有分支 ${branch}`, 'branch_not_found')
      if (typeof target.worktree === 'string' && target.worktree !== '') {
        throw new RelayError(`分支 ${branch} 被工作树占用：${target.worktree}。先移除该工作树（git worktree remove <路径>）再删分支；有未提交改动不要强删。`, 'branch_in_worktree')
      }
      assertBranchDeletable({ name: branch, defaultBranch: snapshot.defaultBranch ?? undefined, current: branch === snapshot.current, merged: target.merged === true, remote: false, force })
    } else {
      assertBranchDeletable({ name: branch, defaultBranch: snapshot.defaultBranch ?? undefined, current: false, merged: true, remote: true, force })
    }
    await this.guard()
    const args = remote === true
      ? ['-C', path, 'push', 'origin', '--delete', branch]
      : ['-C', path, 'branch', force === true ? '-D' : '-d', branch]
    const result = await this.git(args)
    this.invalidate('branches:' + path)
    await this.writeAudit({ event: remote === true ? 'branch-delete-remote' : 'branch-delete-local', path, branch, force: force === true, stderr: String(result.stderr ?? '').trim().slice(0, 200) })
    return { ok: true, remote: remote === true, branch }
  }

  async writeAudit(record) {
    if (typeof this.audit !== 'function') return
    try { await this.audit(record) } catch (error) { this.logger?.warn?.(`session-relay: list audit failed: ${error?.message ?? error}`) }
  }
}
