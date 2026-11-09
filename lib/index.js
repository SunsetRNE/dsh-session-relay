/**
 * dsh-session-relay 外壳（尽量不改；改它需要重启 DSH）。
 *
 * 外壳只做注册：/relay 命令、peer_* 工具、协作上下文、设置/面板路由、会话事件转发。
 * 真正的逻辑在 impl.js 及其依赖里；每次加载先把 lib/ 下的实现文件复制到 .gen/<代次>/ 再导入，
 * 这样 Node 的模块缓存不会挡住新代码。/relay reload 或设置页的“重新加载”换一份新实现，
 * 旧实例的内存状态（跳数、限流、合并窗口里的汇报、重启等待）由新实例 adopt() 接管。
 *
 * 需要重启的改动：本文件、lib/client.js（界面）、package.json 的 dsh 字段、cordis.patch.yml。
 */
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { registerBundledSkills } from './bundled-skills.js'

export const name = 'dsh-session-relay'
export const inject = ['sessionController', 'workspaceRegistry', 'sessions']

/** 外壳接口版本：impl.js 的 REQUIRED_SHELL_API 大于它时，reload 会拒绝并提示重启。 */
export const SHELL_API = 1

const LIB = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(LIB)
const SHELL_FILES = ['index.js', 'client.js']
const ROUTE = '/api/dsha-session-relay'
const CONTEXT_ORDER = 130

function readPackage() {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) } catch { return {} }
}

function shellStamp() {
  const stamp = {}
  for (const file of SHELL_FILES) {
    try { stamp[file] = statSync(join(LIB, file)).mtimeMs } catch { stamp[file] = 0 }
  }
  return stamp
}

export class Shell {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.config = config
    this.stageRoot = config.stageRoot ?? join(ROOT, '.gen')
    this.keepGenerations = config.keepGenerations ?? 3
    this.mod = undefined
    this.relay = undefined
    this.generation = 0
    this.loadedVersion = undefined
    this.loadedAt = undefined
    this.lastError = undefined
    this.slots = new Map()
    this.connection = undefined
    this.chain = Promise.resolve()
    this.bootStamp = shellStamp()
    this.bootVersion = readPackage().version
    this.api = {
      reload: (reason) => this.reload(reason),
      versionInfo: () => this.versionInfo(),
      current: () => this.relay
    }
    this.ready = this.reload('boot')
  }

  current() {
    return this.relay
  }

  versionInfo() {
    const pkg = readPackage()
    const stamp = shellStamp()
    const shellChanged = SHELL_FILES.filter((file) => stamp[file] !== this.bootStamp[file])
    const diskApi = Number(pkg.relay?.shellApi ?? SHELL_API)
    return {
      loaded: this.loadedVersion,
      disk: pkg.version,
      boot: this.bootVersion,
      shellApi: SHELL_API,
      generation: this.generation,
      loadedAt: this.loadedAt,
      needsRestart: diskApi > SHELL_API || shellChanged.length > 0,
      shellChanged,
      ...(this.lastError === undefined ? {} : { lastError: this.lastError })
    }
  }

  /** 把实现文件复制到新的代次目录（留在包目录内，裸模块名照常从包的 node_modules 解析）。 */
  async stage() {
    const dir = join(this.stageRoot, `g${Date.now().toString(36)}-${this.generation + 1}`)
    await mkdir(dir, { recursive: true })
    for (const file of await readdir(LIB)) {
      if (!file.endsWith('.js') || SHELL_FILES.includes(file)) continue
      await copyFile(join(LIB, file), join(dir, file))
    }
    return dir
  }

  async prune(keep) {
    try {
      const generationOf = (name) => Number(name.split('-').pop())
      const entries = (await readdir(this.stageRoot)).filter((name) => name.startsWith('g')).sort((a, b) => generationOf(a) - generationOf(b))
      const others = entries.filter((name) => join(this.stageRoot, name) !== keep)
      for (const name of others.slice(0, Math.max(0, others.length - (this.keepGenerations - 1)))) {
        await rm(join(this.stageRoot, name), { recursive: true, force: true })
      }
    } catch {}
  }

  /** 串行加载一份新实现；失败时保留旧实现，返回说明文字（不抛错）。 */
  reload(reason = 'command') {
    const run = this.chain.then(() => this.load(reason))
    this.chain = run.catch(() => {})
    return run
  }

  async load(reason) {
    const before = this.loadedVersion
    let dir
    try {
      const pkg = readPackage()
      const diskApi = Number(pkg.relay?.shellApi ?? SHELL_API)
      if (diskApi > SHELL_API) throw new Error(`磁盘上的 ${pkg.version} 需要外壳接口 ${diskApi}，当前外壳是 ${SHELL_API}；请重启 DSH`)
      dir = await this.stage()
      const mod = await import(pathToFileURL(join(dir, 'impl.js')).href)
      if (Number(mod.REQUIRED_SHELL_API ?? 1) > SHELL_API) throw new Error(`新实现需要外壳接口 ${mod.REQUIRED_SHELL_API}；请重启 DSH`)
      const relay = mod.createRelay(this.ctx, { ...this.config, shell: this.api, connection: () => this.connection, bundledSkillsDir: join(ROOT, 'bundled-skills') })
      await relay.adopt(this.relay)
      await relay.ready()
      const previous = this.relay
      this.mod = mod
      this.relay = relay
      this.generation += 1
      this.loadedVersion = pkg.version
      this.loadedAt = Date.now()
      this.lastError = undefined
      this.installAll()
      if (previous !== undefined) await previous.dispose().catch(() => {})
      await this.prune(dir)
      if (reason === 'boot') return `已加载 ${pkg.version}`
      return before === pkg.version ? `已重新加载 ${pkg.version}（第 ${this.generation} 次加载）` : `已从 ${before ?? '无'} 换到 ${pkg.version}（第 ${this.generation} 次加载）`
    } catch (error) {
      this.lastError = error?.message ?? String(error)
      this.ctx.logger?.warn?.(`session-relay: load (${reason}) failed: ${error?.stack ?? error}`)
      if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => {})
      if (this.mod === undefined) this.installAll()
      return `重新加载失败：${this.lastError}${before === undefined ? '' : `。仍在使用 ${before}`}`
    }
  }

  /** 绑定一个注入上下文（commands 或 tools）；返回解绑函数。 */
  bind(kind, subctx) {
    const slot = { kind, ctx: subctx, disposers: [] }
    this.slots.set(kind, slot)
    this.install(slot)
    return () => {
      this.uninstall(slot)
      if (this.slots.get(kind) === slot) this.slots.delete(kind)
    }
  }

  installAll() {
    for (const slot of this.slots.values()) this.install(slot)
  }

  uninstall(slot) {
    for (const dispose of slot.disposers.splice(0)) {
      try { if (typeof dispose === 'function') dispose() } catch {}
    }
  }

  install(slot) {
    this.uninstall(slot)
    try {
      if (slot.kind === 'commands') {
        const definition = this.mod === undefined ? this.fallbackCommand() : this.mod.commandDefinition(this.relay)
        slot.disposers.push(slot.ctx.commands.register(definition))
      } else if (slot.kind === 'tools' && this.mod !== undefined) {
        for (const tool of this.mod.toolDefinitions(this.relay)) slot.disposers.push(slot.ctx.tools.register(tool))
      }
    } catch (error) {
      this.ctx.logger?.warn?.(`session-relay: register ${slot.kind} failed: ${error?.stack ?? error}`)
    }
  }

  /** 实现一次都没加载成功时的最小命令：只能看错误、重试加载。 */
  fallbackCommand() {
    return {
      definitionId: CommandDefinitionId('dsh-session-relay'),
      name: 'relay',
      description: '平级会话互通（实现未加载）',
      input: { hint: 'reload' },
      handler: async (invocation) => {
        if (String(invocation.rawInput ?? '').trim() === 'reload') return { kind: 'success', text: await this.reload('command') }
        return { kind: 'error', text: `插件实现没有加载成功：${this.lastError ?? '原因未知'}。修好后发 /relay reload 重试。` }
      }
    }
  }

  contextText(agent) {
    try { return this.mod?.contextText(this.relay, agent) ?? '' } catch { return '' }
  }

  handle(req, res) {
    const handler = this.relay?.routeHandler
    if (handler !== undefined) return handler(req, res)
    const payload = JSON.stringify({ ok: false, error: 'unavailable', message: this.lastError ?? '插件还在加载' })
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' })
    res.end(payload)
  }

  async dispose() {
    await this.chain.catch(() => {})
    for (const slot of this.slots.values()) this.uninstall(slot)
    this.slots.clear()
    await this.relay?.dispose().catch(() => {})
  }
}

export function apply(ctx, config = {}) {
  const shell = new Shell(ctx, config ?? {})
  ctx.on('session/event', (session, event) => { try { shell.relay?.observe(session, event) } catch {} })
  ctx.on('session/disposed', (session) => { try { shell.relay?.guard.forget(session.id); shell.relay?.lastAssistant.delete(session.id) } catch {} })
  ctx.on('agent/status', ({ agent, status }) => { try { shell.relay?.onStatus(agent, status) } catch {} })
  ctx.inject(['commands'], (commandCtx) => { commandCtx.effect(() => shell.bind('commands', commandCtx), 'dsh-session-relay: /relay') })
  ctx.inject(['tools'], (toolCtx) => { toolCtx.effect(() => shell.bind('tools', toolCtx), 'dsh-session-relay: peer tools') })
  // 内置技能（T15）：随包 bundled-skills/ 注册成一层 provider；宿主没有 skills 服务时安静降级。
  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.effect(() => registerBundledSkills(skillCtx.skills, { dir: join(ROOT, 'bundled-skills') }), 'dsh-session-relay: bundled skills')
  })
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.context({
      name: 'session-relay:coordination',
      order: CONTEXT_ORDER,
      interpolate: false,
      text: (context) => shell.contextText(context.agent)
    })
  })
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    shell.connection = webCtx.connection
    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: ROUTE, handler: (req, res) => shell.handle(req, res) }), 'dsh-session-relay: route')
  })
  ctx.effect?.(() => () => { void shell.dispose() })
  return shell
}
