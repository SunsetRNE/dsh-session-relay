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

export const GITHUB_HOST = 'github.com'
const LOGIN_TIMEOUT_MS = 15 * 60_000
const PROBE_TTL_MS = 60_000

/** 跑一次 gh，返回 { stdout, stderr }；失败抛出带 stderr 的错误。 */
function runGh(args, { timeout = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout, maxBuffer: 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' } }, (error, stdout, stderr) => {
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

export class GitHubIdentity {
  /**
   * @param opts.gh - (args, opts) => Promise<{ stdout, stderr }>（测试替换）
   * @param opts.bridge - { get(path), post(path, body), open(url) }（测试替换）
   * @param opts.spawnLogin - () => ChildProcess-like（测试替换）
   */
  constructor(path, auditPath, { gh = runGh, bridge = { get: bridgeGet, post: bridgePost, open: bridgeOpen }, spawnLogin, notify, now = Date.now, logger } = {}) {
    this.path = path
    this.auditPath = auditPath
    this.gh = gh
    this.bridge = bridge
    this.spawnLogin = spawnLogin ?? (() => spawn('gh', ['auth', 'login', '--web', '--hostname', GITHUB_HOST, '--git-protocol', 'https', '--skip-ssh-key'], {
      env: { ...process.env, BROWSER: 'true', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe']
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
        error: this.login.error ?? null, opened: this.login.opened ?? false
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

  /** 面板「登录 GitHub」。同一时间只有一个登录流程。 */
  async startLogin() {
    if (this.login !== null && this.login.state === 'pending') return this.view({ withCode: true })
    const startedAt = this.now()
    if (await this.shellManaged()) {
      // 壳负责界面与权限档位；relay 只发起、显示进度
      const res = await this.bridge.post('/app/github/login', { profile: 'private-workflow' })
      this.login = { state: 'pending', startedAt, expiresAt: Number(res?.expiresAt) || startedAt + LOGIN_TIMEOUT_MS, verificationUri: res?.verificationUri, userCode: res?.userCode, via: 'shell' }
      await this.audit({ event: 'login-start', via: 'shell' })
      return this.view({ withCode: true })
    }
    const child = this.spawnLogin()
    const flow = { state: 'pending', startedAt, expiresAt: startedAt + LOGIN_TIMEOUT_MS, via: 'gh', child, output: '' }
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
        await this.audit(flow.state === 'done'
          ? { event: 'login-done', login: current?.login ?? null, accountId: current?.accountId ?? null }
          : { event: 'login-' + flow.state, error: flow.error ?? null })
      })()
    })
    await this.audit({ event: 'login-start', via: 'gh' })
    await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 15_000).unref?.())])
    if (flow.verificationUri) {
      try { await this.bridge.open(flow.verificationUri); flow.opened = true } catch { flow.opened = false }
    }
    return this.view({ withCode: true })
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
