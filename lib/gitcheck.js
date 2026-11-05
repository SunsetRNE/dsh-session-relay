/**
 * 发布排号前的只读 git 核对（主会话 b660fdf1 列的手工检查项）：
 * - origin/main 实际 sha 与 build 号（ci/release-identity.json 的 versionCode），注入上下文，免得工作会话说错进度；
 * - 可合并 / 待推送声明：分支 HEAD 是否等于声明提交、工作树未提交改动、与 origin/main 的距离、
 *   模拟合并到 origin/main 是否冲突、新增 .java 是否登记 tools/java-format-files.json、声明是否提到 lint / i18n 门禁、
 *   提交是否已是 origin/main 祖先（待补「已合入」）；
 * - 活跃声明的「后台任务」：登记的 pid 是否还活着、日志最后一行是否 STOP / 失败。
 *
 * 只读约定：不 fetch、不改 refs / index / 工作树；所有命令带 GIT_OPTIONAL_LOCKS=0；
 * merge-tree 写出的对象放进临时对象目录（真实对象库作 alternates），结束即删，不进仓库。
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as FS_CONSTANTS } from 'node:fs'
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GIT_TIMEOUT = 15_000
export const MAX_LOG_BYTES = 4 * 1024

export function git(cwd, args, { env = {}, timeout = GIT_TIMEOUT, allowExit = [] } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...env } }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
      if (code === 0 || allowExit.includes(code)) resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      else reject(new Error(`git ${args[0]} 失败（${code}）：${String(stderr).trim().slice(0, 200) || error?.message}`))
    })
  })
}

/**
 * 解析 `git worktree list --porcelain`。返回 [{ path, branch?, head?, detached?, bare? }]。
 * DSH 0.2.2 的「更改请求与工作树」把新工作树建在 <仓库>/.agents/worktrees/<名字>，
 * 分支名 dsh-<会话 id 前 8 位>-<4 位随机>；这类工作树不写 relay 的声明文件。
 */
export function parseWorktreeList(text) {
  const rows = []
  let current
  const flush = () => { if (current !== undefined) { rows.push(current); current = undefined } }
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trimEnd()
    if (line === '') { flush(); continue }
    const space = line.indexOf(' ')
    const key = space === -1 ? line : line.slice(0, space)
    const value = space === -1 ? '' : line.slice(space + 1)
    if (key === 'worktree') { flush(); current = { path: value }; continue }
    if (current === undefined) continue
    if (key === 'HEAD') current.head = value
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'detached') current.detached = true
    else if (key === 'bare') current.bare = true
  }
  flush()
  return rows
}

/** 已登记的本地工作树（只读；失败返回空数组，不打扰调用方）。 */
export async function worktreeList(root, { timeout = GIT_TIMEOUT } = {}) {
  try {
    const { stdout } = await git(root, ['worktree', 'list', '--porcelain'], { timeout })
    return parseWorktreeList(stdout)
  } catch { return [] }
}

async function mtime(path) {
  try { return (await stat(path)).mtimeMs } catch { return undefined }
}

/**
 * 远端发布 tag（git ls-remote --tags origin，只读，不 fetch、不写本地 ref / tag）。
 * 缓存：成功 10 分钟，失败 2 分钟后才重试；超时 8 秒。返回 { tags: [{ tag, number, commit }], at } 或抛错。
 */
export class RemoteTags {
  constructor({ ttlMs = 10 * 60_000, failTtlMs = 2 * 60_000, timeoutMs = 8_000, now = Date.now, list } = {}) {
    this.ttlMs = ttlMs
    this.failTtlMs = failTtlMs
    this.timeoutMs = timeoutMs
    this.now = now
    this.list = list ?? ((root) => git(root, ['ls-remote', '--tags', 'origin'], { timeout: this.timeoutMs }).then((r) => r.stdout))
    this.cache = new Map()
  }

  async get(root) {
    const slot = this.cache.get(root)
    if (slot?.pending) return slot.pending
    if (slot && this.now() - slot.at < (slot.error ? this.failTtlMs : this.ttlMs)) {
      if (slot.error) throw slot.error
      return slot.result
    }
    const pending = this.list(root).then((stdout) => {
      const byTag = new Map()
      for (const line of String(stdout).split('\n')) {
        const [object, ref] = line.trim().split(/\s+/)
        const match = /^refs\/tags\/(.+?)(\^\{\})?$/.exec(ref ?? '')
        if (!match || !/^[0-9a-f]{40}$/.test(object ?? '')) continue
        const number = Number(/build(\d+)/.exec(match[1])?.[1])
        if (!Number.isFinite(number)) continue
        // 附注 tag 的 ^{} 行才是提交；轻量 tag 只有一行
        if (match[2] || !byTag.has(match[1])) byTag.set(match[1], { tag: match[1], number, commit: object })
      }
      const result = { tags: [...byTag.values()].sort((a, b) => b.number - a.number).slice(0, 256), at: this.now() }
      this.cache.delete(root)
      this.cache.set(root, { at: this.now(), result })
      while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value)
      return result
    }, (error) => {
      this.cache.delete(root)
      this.cache.set(root, { at: this.now(), error })
      while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value)
      throw error
    })
    this.cache.set(root, { ...(slot ?? {}), pending })
    return pending
  }
}

/**
 * 已发布 = 本机 tag 与远端 tag 里，已并入 origin/main 的最大 build 号。
 * 远端 tag 指向的提交本机没有时，号不超过 main 的 build 号才算（本机未 fetch 那段历史）。
 */
export async function releasedInfo(root, sha, mainBuild, remoteTags) {
  const local = await latestReleaseTag(root, sha).catch(() => undefined)
  if (remoteTags === undefined) return local === undefined ? undefined : { ...local, source: 'local' }
  let remote
  try { remote = await remoteTags.get(root) } catch (error) {
    return { ...(local ?? {}), source: 'local', remoteError: String(error?.message ?? error).slice(0, 160) }
  }
  const mainNo = Number(/\d+/.exec(mainBuild ?? '')?.[0])
  let best
  const candidates = [...remote.tags]
    .filter((item) => !Number.isFinite(mainNo) || item.number <= mainNo)
    .sort((a, b) => b.number - a.number)
    .slice(0, 32)
  for (const item of candidates) {
    if (best !== undefined) break
    const ancestor = await git(root, ['merge-base', '--is-ancestor', item.commit, sha], { allowExit: [1, 128] }).then((r) => r.code === 0 ? true : r.code === 1 ? false : undefined, () => undefined)
    if (ancestor === true || (ancestor === undefined && Number.isFinite(mainNo) && item.number <= mainNo)) best = item
  }
  const pick = best !== undefined && (local === undefined || best.number >= Number(/\d+/.exec(local.build)[0]))
    ? { build: `build${best.number}`, tag: best.tag, commit: best.commit.slice(0, 8) }
    : local
  return pick === undefined ? { source: 'remote', checkedAt: remote.at } : { ...pick, source: 'remote', checkedAt: remote.at }
}

/** origin/main 的 sha、build 号、标题与最近一次更新时间（fetch 或 push）。 */
export async function mainInfo(root, { remoteTags } = {}) {
  const sha = (await git(root, ['rev-parse', '--verify', '-q', 'refs/remotes/origin/main'])).stdout.trim()
  let build
  try {
    const identity = JSON.parse((await git(root, ['show', `${sha}:ci/release-identity.json`])).stdout)
    if (Number.isFinite(identity.versionCode)) build = `build${identity.versionCode}`
  } catch {}
  const subject = (await git(root, ['log', '-1', '--format=%s', sha]).catch(() => ({ stdout: '' }))).stdout.trim()
  let updatedAt
  try {
    const value = Number((await git(root, ['reflog', 'show', '-1', '--format=%ct', 'refs/remotes/origin/main'])).stdout.trim()) * 1000
    if (Number.isFinite(value) && value > 0) updatedAt = value
  } catch {}
  const commonDir = (await git(root, ['rev-parse', '--git-common-dir'])).stdout.trim()
  const fetched = await mtime(join(commonDir.startsWith('/') ? commonDir : join(root, commonDir), 'FETCH_HEAD'))
  if (fetched !== undefined && (updatedAt === undefined || fetched > updatedAt)) updatedAt = fetched
  const released = await releasedInfo(root, sha, build, remoteTags)
  return { sha, short: sha.slice(0, 8), ...(build ? { build } : {}), subject: subject.slice(0, 120), ...(updatedAt ? { updatedAt } : {}), ...(released ? { released } : {}) }
}

/**
 * 「已发布」与「main 到哪一版」分开：取已并入 origin/main、名字带 buildNNN 的最大号 tag（发布流程打的 tag）。
 * 只看本机已有的 tag（不 fetch），所以结论是“本机可见的最新发布”。
 */
export async function latestReleaseTag(root, sha) {
  const out = (await git(root, ['for-each-ref', '--merged', sha, '--format=%(refname:short)%09%(objectname)%09%(*objectname)%09%(creatordate:unix)', 'refs/tags'])).stdout
  let best
  for (const line of out.split('\n')) {
    const [tag, object, peeled, created] = line.split('\t')
    const number = Number(/build(\d+)/.exec(tag ?? '')?.[1])
    if (!Number.isFinite(number)) continue
    if (best === undefined || number > best.number) best = { number, tag, commit: (peeled || object).slice(0, 8), createdAt: Number(created) * 1000 }
  }
  return best === undefined ? undefined : { build: `build${best.number}`, tag: best.tag, commit: best.commit, ...(best.createdAt ? { createdAt: best.createdAt } : {}) }
}

/** 模拟把 commit 合并进 base：返回冲突文件（不写仓库）。 */
export async function mergeConflicts(root, base, commit) {
  const objects = (await git(root, ['rev-parse', '--git-path', 'objects'])).stdout.trim()
  const real = objects.startsWith('/') ? objects : join(root, objects)
  const scratch = await mkdtemp(join(tmpdir(), 'relay-mt-'))
  try {
    const result = await git(root, ['merge-tree', '--write-tree', '--name-only', '--no-messages', base, commit], {
      env: { GIT_OBJECT_DIRECTORY: scratch, GIT_ALTERNATE_OBJECT_DIRECTORIES: real }, allowExit: [1]
    })
    if (result.code === 0) return []
    return result.stdout.split('\n').slice(1).map((line) => line.trim()).filter(Boolean).slice(0, 20)
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}

/** 新增 .java 是否在该提交的 tools/java-format-files.json 里（只看 app/src/<集>/java/ 下的）。 */
export async function unregisteredJava(root, base, commit) {
  const added = (await git(root, ['diff', '--name-only', '--diff-filter=A', `${base}...${commit}`, '--', '*.java'])).stdout
    .split('\n').map((line) => line.trim()).filter((path) => /^app\/src\/[^/]+\/java\//.test(path))
  if (added.length === 0) return []
  let listed
  try { listed = new Set(JSON.parse((await git(root, ['show', `${commit}:tools/java-format-files.json`])).stdout).files ?? []) } catch { return [] }
  return added.filter((path) => !listed.has(path)).slice(0, 20)
}

/**
 * tools/format-java-tree.py --plan：只在脚本内容与人工审过的版本逐字节一致时才执行。
 * 审过的两版（origin/main c8901236 及更早 8321228e）里 --plan 只读 lock / 清单 / 源码目录，
 * 打印 missing / extra 计数后在建报告目录、跑格式化器之前 return 0；不写文件。
 * 脚本变了就不执行，只报“脚本已变、未重新审核”。
 */
export const FORMAT_PLAN_SCRIPT = 'tools/format-java-tree.py'
export const AUDITED_FORMAT_PLAN = new Set([
  '73b7d1b733f72da4ce367430fd53829768d6faf9e90a2f5639aec3383feec5bd',
  'a8949a5e7a875cf1fda20799458b848868f40779952ab98e297c8d659a41e965'
])

export async function formatPlan(dir, { audited = AUDITED_FORMAT_PLAN, timeout = 30_000 } = {}) {
  const script = join(dir, FORMAT_PLAN_SCRIPT)
  let bytes
  try { bytes = await readFile(script) } catch { return { skipped: '工作树里没有 tools/format-java-tree.py' } }
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (!audited.has(hash)) return { skipped: `脚本内容已变（sha256 ${hash.slice(0, 12)}），没审核过不执行`, hash }
  return new Promise((resolve) => {
    // -B 与 PYTHONDONTWRITEBYTECODE：不留 __pycache__；-s：不读用户 site-packages
    execFile('python3', ['-B', '-s', script, '--plan'], { cwd: dir, timeout, maxBuffer: 1024 * 1024, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', LC_ALL: 'C.UTF-8' } }, (error, stdout, stderr) => {
      const match = /missing:\s*(\d+);\s*extra:\s*(\d+)/.exec(String(stdout))
      if (match !== null && !error) resolve({ missing: Number(match[1]), extra: Number(match[2]), hash })
      else resolve({ error: (String(stderr).trim().split('\n').pop() || error?.message || '没有输出 missing / extra').slice(0, 160), hash })
    })
  })
}

function gateMentions(decl) {
  const text = [decl.phase, decl.mergeText, decl.content].filter(Boolean).join('\n')
  return { lint: /lintStandardRelease|lint\s*0\s*错误|Lint 通过/i.test(text), i18n: /check-ui-i18n|i18n/i.test(text), format: /format-java|java-format/i.test(text) }
}

/**
 * 核对一份可合并 / 待推送声明。memo 按 (提交, HEAD, origin/main) 缓存贵的结果（合并模拟、登记检查）。
 */
export async function checkDeclaration(root, decl, main, memo = new Map(), { runFormatPlan = true } = {}) {
  const out = { rel: decl.rel }
  try {
    out.head = (await git(decl.dir, ['rev-parse', 'HEAD'])).stdout.trim()
  } catch (error) {
    out.error = `读不到分支 HEAD：${error.message}`
    return out
  }
  const commit = decl.commit === undefined ? undefined : await git(root, ['rev-parse', '--verify', '-q', `${decl.commit}^{commit}`]).then((r) => r.stdout.trim(), () => undefined)
  if (decl.commit !== undefined && commit === undefined) out.commitMissing = decl.commit
  out.commitMatches = commit === undefined ? undefined : out.head === commit
  const status = await git(decl.dir, ['status', '--porcelain', '--untracked-files=no']).then((r) => r.stdout.split('\n').filter(Boolean).length, () => undefined)
  if (status !== undefined) out.dirty = status
  const target = commit ?? out.head
  if (main?.sha === undefined) return out
  out.inMain = (await git(root, ['merge-base', '--is-ancestor', target, main.sha], { allowExit: [1] })).code === 0
  if (out.inMain) return out
  // 发布会话常 cherry-pick：原提交不会成为祖先，但等价补丁已在 origin/main（git cherry 行首 "-"）
  try {
    const lines = (await git(root, ['cherry', main.sha, target])).stdout.split('\n').filter(Boolean)
    if (lines.length > 0 && lines.every((line) => line.startsWith('-'))) { out.equivalentInMain = true; return out }
  } catch {}
  const key = `${root}|${target}|${main.sha}`
  if (!memo.has(key)) {
    memo.set(key, (async () => {
      const counts = (await git(root, ['rev-list', '--left-right', '--count', `${main.sha}...${target}`])).stdout.trim().split(/\s+/).map(Number)
      const base = (await git(root, ['merge-base', main.sha, target])).stdout.trim()
      const [conflicts, java] = await Promise.all([
        mergeConflicts(root, main.sha, target).catch((error) => ({ error: error.message })),
        unregisteredJava(root, base, target).catch(() => [])
      ])
      return { behind: counts[0], ahead: counts[1], conflicts, unregisteredJava: java }
    })().catch((error) => ({ error: error.message })))
  }
  Object.assign(out, await memo.get(key))
  if (runFormatPlan) {
    // 按工作树当前文件跑（含未提交改动）；同一 HEAD / 改动数 / origin/main 只跑一次
    const planKey = `${root}|plan|${decl.dir}|${out.head}|${out.dirty ?? '?'}|${main.sha}`
    if (!memo.has(planKey)) memo.set(planKey, formatPlan(decl.dir).catch((error) => ({ error: error.message })))
    out.formatPlan = { ...(await memo.get(planKey)), ...(out.dirty > 0 ? { dirty: true } : {}) }
  }
  out.gates = gateMentions(decl)
  return out
}

/** 日志末行：停下 / 失败，或完成（推送链的 PUSH_DONE、CHAIN16_DONE 等）。 */
export const STOP_LINE = /\bSTOP\b|FAIL|失败|\berror\b|中止/i
export const DONE_LINE = /(^|[\s_])DONE\b|_DONE\b|全部完成|已完成/

/** 只读日志尾部；拒绝目录、FIFO、设备和超大文件，避免扫描被阻塞或 OOM。 */
async function readLogTail(path, limit = MAX_LOG_BYTES) {
  let handle
  try {
    handle = await open(path, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NONBLOCK)
    const info = await handle.stat()
    if (!info.isFile()) return { skipped: '不是普通文件' }
    if (info.size > limit) return { skipped: `文件超过 ${limit} 字节` }
    const size = Math.min(info.size, limit)
    const buffer = Buffer.alloc(size)
    if (size > 0) await handle.read(buffer, 0, size, Math.max(0, info.size - size))
    return { info, buffer }
  } catch (error) {
    return { error }
  } finally {
    if (handle !== undefined) await handle.close().catch(() => {})
  }
}

/** 「后台任务」字段：pid 是否存活，日志最后一行与停留时间。 */
export async function checkBackground(decl, { now = Date.now } = {}) {
  const text = decl.background ?? ''
  if (text.trim() === '' || /^无/.test(text.trim())) return undefined
  const pids = [...text.matchAll(/pid\s*[:：]?\s*(\d{2,7})/gi)].map((m) => Number(m[1]))
  const logs = [...new Set([...text.matchAll(/(\/[^\s，,；;）)]+\.log)/g)].map((m) => m[1]))]
  const result = { rel: decl.rel, text: text.split('\n')[0].slice(0, 160), pids: [], logs: [] }
  for (const pid of pids.slice(0, 4)) result.pids.push({ pid, alive: (await mtime(`/proc/${pid}`)) !== undefined })
  for (const path of logs.slice(0, 3)) {
    try {
      const tailResult = await readLogTail(path)
      if (tailResult.error) {
        result.logs.push({ path, missing: true })
        continue
      }
      if (tailResult.skipped) {
        result.logs.push({ path, skipped: tailResult.skipped })
        continue
      }
      const { info, buffer } = tailResult
      const tail = buffer.toString('utf8').split('\n').map((line) => line.trim()).filter(Boolean)
      const last = (tail[tail.length - 1] ?? '').slice(0, 200)
      result.logs.push({ path, last, ageMs: now() - info.mtimeMs, mtimeMs: info.mtimeMs, stopped: STOP_LINE.test(last), finished: DONE_LINE.test(last) })
    } catch {
      result.logs.push({ path, missing: true })
    }
  }
  // 进程都已退出、声明里却没写退出码：登记过期（约定要求结束时写明退出码）
  result.stale = result.pids.length > 0 && result.pids.every((item) => !item.alive) && !/退出码|exit\s*code|rc\s*=|已结束|已退出/i.test(text)
  result.attention = result.stale || result.pids.some((item) => !item.alive) || result.logs.some((item) => item.missing || item.skipped || item.stopped)
  return result
}

/** 活跃声明登记的后台任务（不依赖 git）。 */
export async function scanBackground(declarations, { now = Date.now } = {}) {
  const background = []
  for (const decl of declarations.filter((item) => item.kind === 'active')) {
    const item = await checkBackground(decl, { now }).catch(() => undefined)
    if (item !== undefined) background.push(item)
  }
  return background
}

/** 扫描结果上补 git 核对；仓库不是 git 或没有 origin/main 时只返回 undefined 字段。 */
export async function enrichWithGit(root, scan, { memo = new Map(), now = Date.now, remoteTags, formatPlan: runFormatPlan = true } = {}) {
  const targets = scan.declarations.filter((decl) => (decl.kind === 'done' && decl.merge === 'mergeable') || decl.merge === 'pending')
  if (targets.length === 0) return { ...scan, git: { main: undefined, checks: {} } }
  let main
  try { main = await mainInfo(root, { remoteTags }) } catch { main = undefined }
  const checks = {}
  for (const decl of targets.slice(0, 12)) {
    try { checks[decl.rel] = await checkDeclaration(root, decl, main, memo, { runFormatPlan }) } catch (error) { checks[decl.rel] = { rel: decl.rel, error: error.message } }
  }
  // memo 只留与当前 origin/main 相关的条目
  if (main?.sha) for (const key of [...memo.keys()]) if (key.startsWith(`${root}|`) && !key.endsWith(`|${main.sha}`)) memo.delete(key)
  return { ...scan, git: { main, checks } }
}
