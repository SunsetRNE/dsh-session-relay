/**
 * GitHub 身份：relay 接管 gh 登录、锁定账号、换号报警。
 *
 * - 身份来源：壳在 /app/version 带 GITHUB_CREDENTIALS=1 时读壳的 /app/github/status（relay 不取 token）；
 *   否则用本机 gh（共用的 hosts.yml，所有会话同一个身份）。
 * - 登录：面板发起。壳支持时走壳的 /app/github/login；否则后台跑 `gh auth login --web`，
 *   把一次性验证码和网址交给面板显示，经设备桥 /app/open 打开授权页（不在 DSHA 里就只显示网址）。
 *   验证码只在内存里、只给面板，不写日志和审计，不进模型上下文。
 * - 锁定：用户在面板点「这是我」后记下账号数字 id（login 改名不算换号）。之后发现不一致就标红、发一次通知、
 *   暂停 relay 自己的 gh 调用（requireIdentity）。
 * - 审计：登录发起 / 成功 / 失败、锁定、解锁、发现不一致，追加到 github-audit.jsonl。
 *
 * github.json: { version: 1, pinned: { accountId, login, host, pinnedAt } | null }
 */
import { execFile, spawn } from 'node:child_process'
import { appendFile, mkdir, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { RelayError, writeJsonAtomic } from './core.js'
import { bridgeGet, bridgeOpen, bridgePost } from './bridge.js'
import { ghEnv } from './ghenv.js'

export const GITHUB_HOST = 'github.com'
/**
 * 2.0.0 起默认申请全部经典 OAuth scope（用户 2026-11-06 决定「全部授权」）。
 * 覆盖版本管理、仓库设置、组织/团队、webhooks、Projects、Packages、Codespaces 等；
 * 不含 offline_access（会改变 token 生命周期，gh 的过期凭据刷新另算）。
 * GitHub 会把被高级 scope 隐含的低级 scope 归一化，列全是为了表达「不挑权限」。
 */
export const LOGIN_SCOPES = Object.freeze([
  'repo', 'repo:status', 'repo_deployment', 'public_repo', 'repo:invite', 'security_events',
  'admin:repo_hook', 'write:repo_hook', 'read:repo_hook',
  'admin:org', 'write:org', 'read:org', 'admin:org_hook',
  'admin:public_key', 'write:public_key', 'read:public_key',
  'admin:gpg_key', 'write:gpg_key', 'read:gpg_key',
  'gist', 'notifications',
  'user', 'read:user', 'user:email', 'user:follow',
  'project', 'read:project', 'delete_repo',
  'write:packages', 'read:packages', 'delete:packages',
  'codespace', 'workflow', 'read:audit_log'
])
/**
 * 权限分档（用户 2026-11-06 定的三档）：登录和「补足权限」都按所选档位申请。
 * 已授予的 scope 不会因为选低档自动收回；降档要在 GitHub 设置里撤销授权后重登。
 */
export const SCOPE_TIERS = Object.freeze({
  basic: Object.freeze(['repo', 'read:org', 'gist', 'workflow']),
  repo: Object.freeze(['repo', 'read:org', 'gist', 'workflow', 'admin:repo_hook', 'project', 'read:project', 'security_events', 'notifications', 'read:user', 'user:email', 'read:packages', 'write:packages']),
  all: LOGIN_SCOPES
})
/** 档位名归一：不认识的按默认「仓库管理」处理，避免把登录卡死。 */
export function tierName(tier) {
  return Object.hasOwn(SCOPE_TIERS, tier) ? tier : 'repo'
}
export function tierScopes(tier) {
  return SCOPE_TIERS[tierName(tier)]
}
const LOGIN_TIMEOUT_MS = 15 * 60_000
const PROBE_TTL_MS = 60_000

/** 跑一次 gh，返回 { stdout, stderr }；失败抛出带 stderr 的错误。 */
function runGh(args, { timeout = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout, maxBuffer: 1024 * 1024, env: ghEnv(process.env) }, (error, stdout, stderr) => {
      if (error) { error.stderr = String(stderr ?? ''); reject(error) } else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/** 从 `gh api -i user` 的输出里取账号与 scope。 */
export function parseUserResponse(text) {
  const raw = String(text ?? '')
  const split = raw.search(/\r?\n\r?\n/)
  const head = split >= 0 ? raw.slice(0, split) : ''
  const body = split >= 0 ? raw.slice(split).trim() : raw.trim()
  let user
  try { user = JSON.parse(body) } catch { return undefined }
  if (!user || typeof user.login !== 'string' || !Number.isFinite(user.id)) return undefined
  const scopeLine = /^x-oauth-scopes:\s*(.*)$/im.exec(head)
  const scopes = scopeLine ? scopeLine[1].split(',').map((item) => item.trim()).filter(Boolean) : []
  return { login: user.login, accountId: user.id, scopes }
}

/** gh 登录输出里的一次性验证码与网址（gh 打到 stderr）。 */
export function parseDeviceLogin(text) {
  const raw = String(text ?? '')
  const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(raw)?.[1]
  const url = /(https:\/\/github\.com\/login\/device)\b/.exec(raw)?.[1]
  return code && url ? { userCode: code.toUpperCase(), verificationUri: url } : undefined
}

/** /app/version 的 KEY=value 文本里有没有 GITHUB_CREDENTIALS=1。 */
export function shellHasGithub(versionText) {
  return /(^|\n)GITHUB_CREDENTIALS=1\s*($|\n)/.test(String(versionText ?? ''))
}

/**
 * GitHub 会把被高级 scope 隐含的低级 scope 归一化掉（如 repo ⊃ repo:status，admin:org ⊃ read:org）。
 * 核对时先把已授予 scope 展平成隐含闭包，避免把归一化误报成「没授予」。
 */
export const IMPLIED_SCOPES = Object.freeze({
  repo: Object.freeze(['repo:status', 'repo_deployment', 'public_repo', 'repo:invite', 'security_events']),
  'admin:org': Object.freeze(['write:org', 'read:org']),
  'admin:repo_hook': Object.freeze(['write:repo_hook', 'read:repo_hook']),
  'admin:public_key': Object.freeze(['write:public_key', 'read:public_key']),
  'admin:gpg_key': Object.freeze(['write:gpg_key', 'read:gpg_key']),
  user: Object.freeze(['read:user', 'user:email', 'user:follow']),
  project: Object.freeze(['read:project']),
  'write:packages': Object.freeze(['read:packages'])
})

/** 已授予 scope 的隐含闭包。 */
export function impliedScopes(granted) {
  const out = new Set()
  for (const scope of granted ?? []) {
    out.add(scope)
    for (const child of IMPLIED_SCOPES[scope] ?? []) out.add(child)
  }
  return out
}

/** 请求里真正没被覆盖的 scope（按隐含闭包判断）。 */
export function missingScopes(requested, granted) {
  const have = impliedScopes(granted)
  return [...new Set(requested ?? [])].filter((scope) => !have.has(scope))
}

/** gh 登录 / 补权限用的参数（测试直接核对，不真的起进程）。 */
export function loginArgs(kind = 'login', scopes = LOGIN_SCOPES) {
  const list = scopes.join(',')
  return kind === 'refresh'
    ? ['auth', 'refresh', '--hostname', GITHUB_HOST, '--scopes', list]
    : ['auth', 'login', '--web', '--hostname', GITHUB_HOST, '--git-protocol', 'https', '--skip-ssh-key', '--scopes', list]
}

export class GitHubIdentity {
  /**
   * @param opts.gh - (args, opts) => Promise<{ stdout, stderr }>（测试替换）
   * @param opts.bridge - { get(path), post(path, body), open(url) }（测试替换）
   * @param opts.spawnLogin - (kind: 'login' | 'refresh') => ChildProcess-like（测试替换）
   */
  constructor(path, auditPath, { gh = runGh, bridge = { get: bridgeGet, post: bridgePost, open: bridgeOpen }, spawnLogin, notify, now = Date.now, logger } = {}) {
    this.path = path
    this.auditPath = auditPath
    this.gh = gh
    this.bridge = bridge
    this.spawnLogin = spawnLogin ?? ((kind, scopes) => spawn('gh', loginArgs(kind, scopes ?? LOGIN_SCOPES), {
      env: { ...ghEnv(process.env), BROWSER: 'true' }, stdio: ['pipe', 'pipe', 'pipe']
    }))
    this.notify = notify
    this.now = now
    this.logger = logger
    this.pinned = null
    this.loaded = false
    this.current = undefined
    this.checkedAt = 0
    this.login = null
    this.alerted = undefined
    this.chain = Promise.resolve()
    this.probing = undefined
  }

  async load() {
    let parsed
    try { parsed = JSON.parse(await readFile(this.path, 'utf8')) } catch (error) {
      if (error instanceof SyntaxError) await rename(this.path, `${this.path}.corrupt-${this.now()}`).catch(() => {})
      else if (error?.code !== 'ENOENT') throw error
    }
    const pin = parsed?.version === 1 ? parsed.pinned : null
    this.pinned = pin && Number.isFinite(pin.accountId) && typeof pin.login === 'string' ? { accountId: pin.accountId, login: pin.login, host: pin.host ?? GITHUB_HOST, pinnedAt: Number(pin.pinnedAt) || 0 } : null
    this.loaded = true
    return this.pinned
  }

  save() {
    const run = this.chain.then(() => writeJsonAtomic(this.path, { version: 1, pinned: this.pinned }))
    this.chain = run.catch(() => {})
    return run
  }

  async audit(record) {
    if (this.auditPath === undefined) return
    try {
      await mkdir(dirname(this.auditPath), { recursive: true })
      await appendFile(this.auditPath, JSON.stringify({ at: new Date(this.now()).toISOString(), ...record }) + '\n', { mode: 0o600 })
    } catch {}
  }

  /** 壳是否已经接管 GitHub 凭据（T50）。读不到桥就当没有。 */
  async shellManaged() {
    try { return shellHasGithub((await this.bridge.get('/app/version'))?.result) } catch { return false }
  }

  /** 读一次当前身份。@returns { source, state, login?, accountId?, scopes?, error? } */
  async probe() {
    if (this.probing) return this.probing
    this.probing = (async () => {
      let found
      if (await this.shellManaged()) {
        try {
          const status = await this.bridge.get('/app/github/status')
          found = status?.state === 'READY' && Number.isFinite(status.accountId)
            ? { source: 'shell', state: 'ready', login: status.login, accountId: status.accountId, scopes: Array.isArray(status.scopes) ? status.scopes : [], generation: status.credentialGeneration }
            : { source: 'shell', state: status?.state === 'MISSING' ? 'missing' : 'error', error: String(status?.state ?? 'UNAVAILABLE') }
        } catch (error) { found = { source: 'shell', state: 'error', error: String(error?.message ?? error) } }
      } else {
        try {
          const user = parseUserResponse((await this.gh(['api', '-i', 'user'])).stdout)
          found = user === undefined ? { source: 'gh', state: 'error', error: 'gh 返回的不是账号信息' } : { source: 'gh', state: 'ready', ...user }
        } catch (error) {
          const text = `${error?.stderr ?? ''} ${error?.message ?? ''}`
          if (error?.code === 'ENOENT') found = { source: 'gh', state: 'unavailable', error: '本机没有 gh' }
          else if (/gh auth login|not logged in|HTTP 401|Bad credentials/i.test(text)) found = { source: 'gh', state: 'missing', error: '还没有登录 GitHub' }
          else found = { source: 'gh', state: 'error', error: text.trim().split('\n')[0].slice(0, 200) || 'gh 调用失败' }
        }
      }
      this.current = found
      this.checkedAt = this.now()
      await this.checkMismatch()
      return found
    })().finally(() => { this.probing = undefined })
    return this.probing
  }

  /** 缓存超过 TTL 才重读。 */
  async fresh(maxAge = PROBE_TTL_MS) {
    if (this.current === undefined || this.now() - this.checkedAt > maxAge) await this.probe()
    return this.view()
  }

  /** ok / mismatch / unpinned / missing / unavailable / error */
  match() {
    const current = this.current
    if (current === undefined) return 'unknown'
    if (current.state !== 'ready') return current.state
    if (this.pinned === null) return 'unpinned'
    return current.accountId === this.pinned.accountId ? 'ok' : 'mismatch'
  }

  async checkMismatch() {
    const verdict = this.match()
    const key = verdict === 'mismatch' ? `mismatch:${this.current.accountId}` : (verdict === 'missing' && this.pinned !== null ? 'missing' : undefined)
    if (key === undefined) { this.alerted = undefined; return }
    if (this.alerted === key) return
    this.alerted = key
    const text = verdict === 'mismatch'
      ? `当前 GitHub 账号是 ${this.current.login}（${this.current.accountId}），不是锁定的 ${this.pinned.login}。relay 已暂停自己的 gh 调用；去「会话协作」设置确认`
      : `锁定的 GitHub 账号 ${this.pinned.login} 已退出登录。relay 已暂停自己的 gh 调用；去「会话协作」设置重新登录`
    await this.audit({ event: verdict, login: this.current?.login ?? null, accountId: this.current?.accountId ?? null, pinned: this.pinned.accountId })
    if (this.notify) await Promise.resolve(this.notify('GitHub 身份变了', text)).catch(() => {})
  }

  /** 面板与看板用：不含验证码以外的任何秘密；验证码只在登录进行中给面板。 */
  view({ withCode = false } = {}) {
    const current = this.current
    return {
      match: this.match(),
      // 每档的 scope 清单带给面板/侧栏，前端据此判断「已补足」并显示档位
      tiers: SCOPE_TIERS,
      source: current?.source ?? null,
      state: current?.state ?? null,
      login: current?.login ?? null,
      accountId: current?.accountId ?? null,
      scopes: current?.scopes ?? [],
      error: current?.error ?? null,
      checkedAt: this.checkedAt || null,
      pinned: this.pinned,
      loginFlow: this.login === null ? null : {
        state: this.login.state, startedAt: this.login.startedAt, expiresAt: this.login.expiresAt,
        verificationUri: this.login.verificationUri ?? null, ...(withCode ? { userCode: this.login.userCode ?? null } : {}),
        error: this.login.error ?? null, opened: this.login.opened ?? false,
        ...(Array.isArray(this.login.missing) && this.login.missing.length > 0 ? { missing: this.login.missing.slice(0, 10), missingTotal: this.login.missing.length } : {})
      }
    }
  }

  /** relay 自己要用 gh 之前调：身份不对就拒绝（没锁定时放行，保持旧行为）。 */
  async requireIdentity() {
    if (!this.loaded) await this.load().catch(() => {})
    // 没锁定：不查、不拦（保持旧行为，也不为每次核验多跑一次 gh）
    if (this.pinned === null) return
    await this.fresh()
    const verdict = this.match()
    if (verdict === 'mismatch') throw new RelayError(`GitHub 当前账号 ${this.current.login} 不是锁定的 ${this.pinned.login}，relay 暂停自己的 gh 调用；请用户在「会话协作」设置里确认`, 'github_mismatch')
    if (verdict === 'missing' && this.pinned !== null) throw new RelayError(`锁定的 GitHub 账号 ${this.pinned.login} 已退出登录；请用户在「会话协作」设置里重新登录`, 'github_missing')
  }

  /** 用户在面板点「这是我」：锁定当前账号。 */
  async pin() {
    const current = await this.probe()
    if (current.state !== 'ready') throw new RelayError('当前没有已登录的 GitHub 账号，先登录', 'github_missing')
    this.pinned = { accountId: current.accountId, login: current.login, host: GITHUB_HOST, pinnedAt: this.now() }
    await this.save()
    await this.audit({ event: 'pin', login: current.login, accountId: current.accountId, source: current.source })
    this.alerted = undefined
    return this.view()
  }

  async unpin() {
    const was = this.pinned
    this.pinned = null
    await this.save()
    if (was !== null) await this.audit({ event: 'unpin', login: was.login, accountId: was.accountId })
    this.alerted = undefined
    return this.view()
  }

  /**
   * 面板 / 侧栏「登录 GitHub」。同一时间只有一个登录流程。
   * refresh=true 且已登录时跑 `gh auth refresh -s <所选档位 scope>` 补权限；没登录就退回登录。
   */
  async startLogin({ refresh = false, tier = 'repo' } = {}) {
    if (this.login !== null && this.login.state === 'pending') return this.view({ withCode: true })
    const startedAt = this.now()
    const useRefresh = refresh === true && this.current?.state === 'ready'
    if (await this.shellManaged()) {
      // 壳负责界面与权限档位；relay 只发起、显示进度
      const res = await this.bridge.post('/app/github/login', { profile: 'private-workflow' })
      this.login = { state: 'pending', startedAt, expiresAt: Number(res?.expiresAt) || startedAt + LOGIN_TIMEOUT_MS, verificationUri: res?.verificationUri, userCode: res?.userCode, via: 'shell' }
      await this.audit({ event: 'login-start', via: 'shell' })
      return this.view({ withCode: true })
    }
    const scopes = tierScopes(tier)
    const child = this.spawnLogin(useRefresh ? 'refresh' : 'login', scopes)
    const flow = { state: 'pending', startedAt, expiresAt: startedAt + LOGIN_TIMEOUT_MS, via: 'gh', refresh: useRefresh, tier: tierName(tier), scopes, child, output: '' }
    this.login = flow
    // 监听必须在起进程后同步挂上：先 await 别的会漏掉早到的验证码输出
    const ready = new Promise((resolve) => {
      const onData = (chunk) => {
        if (flow.output.length < 8192) flow.output += String(chunk)
        const found = parseDeviceLogin(flow.output)
        if (found && flow.userCode === undefined) {
          flow.userCode = found.userCode
          flow.verificationUri = found.verificationUri
          // gh 在打印验证码后等回车再「打开浏览器」；BROWSER=true 让它什么都不开，由我们经设备桥打开
          try { child.stdin?.write('\n') } catch {}
          resolve()
        }
      }
      child.stderr?.on('data', onData)
      child.stdout?.on('data', onData)
      child.on('exit', () => resolve())
      child.on('error', () => resolve())
    })
    const timer = setTimeout(() => { if (flow.state === 'pending') { flow.state = 'expired'; try { child.kill() } catch {} } }, LOGIN_TIMEOUT_MS)
    timer.unref?.()
    child.on('error', (error) => { if (flow.state === 'pending') { flow.state = 'failed'; flow.error = error?.code === 'ENOENT' ? '本机没有 gh' : String(error?.message ?? error) } })
    child.on('exit', (code) => {
      clearTimeout(timer)
      void (async () => {
        if (flow.state === 'pending') flow.state = code === 0 ? 'done' : 'failed'
        if (flow.state === 'failed' && !flow.error) flow.error = flow.output.split('\n').map((line) => line.trim()).filter((line) => line && !/one-time code|clipboard|xsel|xclip|Termux/i.test(line)).pop()?.slice(0, 200) ?? 'gh 登录没有完成'
        delete flow.child
        flow.userCode = undefined
        const current = await this.probe().catch(() => undefined)
        if (flow.state === 'done' && current?.state === 'ready') {
          // GitHub 可能只授予部分 scope：把缺的记下来，面板明确告警，不假装成功
          const granted = Array.isArray(current.scopes) ? current.scopes : []
          const missing = missingScopes(flow.scopes, granted)
          flow.granted = granted
          flow.missing = missing
          if (missing.length > 0) flow.error = `GitHub 只授予了 ${granted.length} 项，缺 ${missing.length} 项`
        }
        await this.audit(flow.state === 'done'
          ? { event: 'login-done', login: current?.login ?? null, accountId: current?.accountId ?? null, tier: flow.tier ?? null, requested: (flow.scopes ?? []).length, granted: (flow.granted ?? []).length, missing: (flow.missing ?? []).length }
          : { event: 'login-' + flow.state, error: flow.error ?? null })
      })()
    })
    await this.audit({ event: 'login-start', via: 'gh', refresh: useRefresh, tier: tierName(tier) })
    await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 15_000).unref?.())])
    if (flow.verificationUri) {
      try { await this.bridge.open(flow.verificationUri); flow.opened = true } catch { flow.opened = false }
    }
    return this.view({ withCode: true })
  }

  /** 「退出后重新登录」：refresh 在个别环境下拿不到新 scope 时的确定路径（会清掉当前 token）。 */
  async resetLogin({ tier = 'repo' } = {}) {
    if (this.login !== null && this.login.state === 'pending') return this.view({ withCode: true })
    try { await this.gh(['auth', 'logout', '--hostname', GITHUB_HOST]) } catch { /* 没登录时继续 */ }
    this.current = undefined
    this.checkedAt = 0
    await this.audit({ event: 'login-reset', tier: tierName(tier) })
    return this.startLogin({ tier })
  }

  async cancelLogin() {
    const flow = this.login
    if (flow === null || flow.state !== 'pending') return this.view()
    flow.state = 'cancelled'
    flow.userCode = undefined
    try { flow.child?.kill() } catch {}
    await this.audit({ event: 'login-cancelled' })
    return this.view()
  }

  dispose() {
    if (this.login?.state === 'pending') { try { this.login.child?.kill() } catch {} }
  }
}
