/**
 * 工作树声明（只读）：按 DSH-A-mod AGENTS.md「多会话并行约定」读取
 *   <工作区>/.ACTIVE-SESSION、<工作区>/.agents/worktrees/<type>/<name>/.ACTIVE-SESSION | .SESSION-DONE
 *   <工作区>/.agents/claims/<任务号>/owner | done | abandoned
 * 并与协作看板对照。约定要点：
 * - 合并 / 发布以声明为准，不按空闲时长猜会话是否结束；
 * - 只合并 .SESSION-DONE 且「合并」为可合并的工作树；.ACTIVE-SESSION 或没有声明的一律不动、先问用户；
 * - 「已合入 buildNNN（sha）」只在推送成功后由合并会话追加，「待推送 buildNNN」表示排队待推。
 * 本模块绝不写任何声明文件，只给主会话和用户提示。
 */
import { constants as FS_CONSTANTS } from 'node:fs'
import { opendir, open, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parseFiles } from './core.js'
import { enrichWithGit, scanBackground } from './gitcheck.js'

export const DECL_FILES = ['.ACTIVE-SESSION', '.SESSION-DONE']
export const SCAN_LIMITS = Object.freeze({ worktrees: 256, claims: 512, declarations: 256, pathsPerDeclaration: 128, overlapPairs: 50_000 })
const MAX_FILE = 16 * 1024
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const SESSION_RE = new RegExp(`(?:session-)?(${UUID})`, 'i')
const SESSION_ALL_RE = new RegExp(`(?:session-)?(${UUID})`, 'gi')
const FIELD_RE = /^([^\s：:]{1,8})[：:]\s*(.*)$/

/** 去掉 session- 前缀的小写 UUID，用来比对（声明里两种写法都有）。 */
export function bareId(id) {
  const match = SESSION_RE.exec(String(id ?? ''))
  return match === null ? String(id ?? '') : match[1].toLowerCase()
}

/** 规范成 DSH 会话 id（session-<uuid>）。 */
export function normalizeSessionId(text) {
  const match = SESSION_RE.exec(String(text ?? ''))
  return match === null ? undefined : `session-${match[1].toLowerCase()}`
}

/**
 * 解析一份声明。
 * @returns {{ fields: Record<string,string>, trailer: string[], holder?: string, previous: string[], branch?: string,
 *   merge: 'merged'|'pending'|'mergeable'|'blocked'|'abandoned'|'unknown', build?: string, commit?: string }}
 */
export function parseDeclaration(text) {
  const fields = {}
  const trailer = []
  let last
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') continue
    const match = FIELD_RE.exec(line)
    if (match !== null && !/^(已合入|待推送)/.test(line)) {
      last = match[1]
      fields[last] = fields[last] === undefined ? match[2] : `${fields[last]}\n${match[2]}`
    } else if (/^(已合入|待推送)/.test(line)) {
      trailer.push(line)
    } else if (last !== undefined) {
      fields[last] += `\n${line}`
    }
  }
  const sessionText = fields['会话'] ?? ''
  const holder = normalizeSessionId(sessionText)
  const previous = [...sessionText.matchAll(SESSION_ALL_RE)].map((m) => `session-${m[1].toLowerCase()}`).filter((id) => id !== holder)
  const branch = (fields['分支'] ?? '').split(/[（(\s]/)[0] || undefined
  const mergeText = fields['合并'] ?? ''
  const merged = [...trailer].reverse().find((line) => line.startsWith('已合入'))
  const pending = [...trailer].reverse().find((line) => line.startsWith('待推送'))
  let merge = 'unknown'
  let build
  if (merged !== undefined) { merge = 'merged'; build = /build\d+/.exec(merged)?.[0] }
  else if (pending !== undefined) { merge = 'pending'; build = /build\d+/.exec(pending)?.[0] }
  else if (/放弃/.test(mergeText)) merge = 'abandoned'
  else if (/不可合并|勿合并/.test(mergeText)) merge = 'blocked'
  else if (/可合并/.test(mergeText)) merge = 'mergeable'
  const commit = /(?:已提交|提交)\s*`?([0-9a-f]{7,40})/.exec(mergeText)?.[1]
    ?? /[（(]([0-9a-f]{7,40})[）)]/.exec(merged ?? pending ?? '')?.[1]
  return { fields, trailer, holder, previous, branch, merge, ...(build ? { build } : {}), ...(commit ? { commit } : {}) }
}

/** 解析 claims/<任务号>/owner：第一行是认领者，「接手 <id> <时间>」行是后来的持有者。 */
export function parseClaimOwner(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let holder = normalizeSessionId(lines[0])
  for (const line of lines.slice(1)) {
    if (/^接手/.test(line)) holder = normalizeSessionId(line) ?? holder
  }
  return holder
}

async function readSmall(path) {
  let handle
  try {
    handle = await open(path, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NONBLOCK)
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_FILE) return undefined
    const buffer = Buffer.alloc(info.size)
    if (info.size > 0) await handle.read(buffer, 0, info.size, 0)
    return { text: buffer.toString('utf8'), mtimeMs: info.mtimeMs }
  } catch { return undefined
  } finally { if (handle !== undefined) await handle.close().catch(() => {}) }
}

async function subdirs(path, limit = Number.MAX_SAFE_INTEGER) {
  const names = []
  let truncated = false
  let handle
  try {
    handle = await opendir(path)
    for await (const entry of handle) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      if (names.length >= limit) { truncated = true; break }
      names.push(entry.name)
    }
  } catch {}
  return { names: names.sort(), truncated }
}

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

/**
 * 扫描一个工作区根目录。
 * @returns {Promise<{ root, scannedAt, declarations: Array, undeclared: string[], claims: Array }>}
 */
export async function scanWorkspace(root, { worktreeDirs = ['.agents/worktrees'], claimsDir = '.agents/claims', now = Date.now, git = false, gitMemo, remoteTags, limits = {} } = {}) {
  const budget = { ...SCAN_LIMITS, ...limits }
  const declarations = []
  const undeclared = []
  const truncated = { worktrees: false, claims: false, declarations: false }
  let worktreesSeen = 0
  const visit = async (dir) => {
    let found = false
    for (const name of DECL_FILES) {
      if (declarations.length >= budget.declarations) { truncated.declarations = true; break }
      const file = await readSmall(join(dir, name))
      if (file === undefined) continue
      found = true
      const parsed = parseDeclaration(file.text)
      declarations.push({
        dir, rel: relative(root, dir) || '.', file: name, kind: name === '.ACTIVE-SESSION' ? 'active' : 'done', mtimeMs: file.mtimeMs,
        holder: parsed.holder, previous: parsed.previous, branch: parsed.branch, merge: parsed.merge, build: parsed.build, commit: parsed.commit,
        mergeText: parsed.fields['合并'], phase: parsed.fields['当前阶段'], content: parsed.fields['内容'], files: parsed.fields['占用文件'], updated: parsed.fields['更新'],
        background: parsed.fields['后台任务']
      })
    }
    return found
  }
  await visit(root)
  outer: for (const base of worktreeDirs) {
    const top = join(root, base)
    const first = await subdirs(top, Math.max(0, budget.worktrees - worktreesSeen))
    if (first.truncated) truncated.worktrees = true
    for (const name of first.names) {
      if (worktreesSeen >= budget.worktrees || declarations.length >= budget.declarations) { truncated.worktrees ||= worktreesSeen < budget.worktrees; break outer }
      const dir1 = join(top, name)
      // 一层（.agents/worktrees/<name>）或两层（.agents/worktrees/<type>/<name>）；带 .git 的才是工作树
      if (await exists(join(dir1, '.git'))) {
        worktreesSeen += 1
        if (!(await visit(dir1))) undeclared.push(relative(root, dir1))
        continue
      }
      const second = await subdirs(dir1, Math.max(0, budget.worktrees - worktreesSeen))
      if (second.truncated) truncated.worktrees = true
      for (const child of second.names) {
        if (worktreesSeen >= budget.worktrees || declarations.length >= budget.declarations) { truncated.worktrees = true; break outer }
        worktreesSeen += 1
        const dir2 = join(dir1, child)
        const declared = await visit(dir2)
        if (!declared && (await exists(join(dir2, '.git')))) undeclared.push(relative(root, dir2))
      }
    }
  }
  const claims = []
  const claimsRoot = join(root, claimsDir)
  const claimDirs = await subdirs(claimsRoot, budget.claims)
  if (claimDirs.truncated) truncated.claims = true
  for (const task of claimDirs.names) {
    const owner = await readSmall(join(claimsRoot, task, 'owner'))
    const done = await readSmall(join(claimsRoot, task, 'done'))
    const abandoned = await readSmall(join(claimsRoot, task, 'abandoned'))
    claims.push({
      task, holder: owner === undefined ? undefined : parseClaimOwner(owner.text),
      state: done !== undefined ? 'done' : abandoned !== undefined ? 'abandoned' : 'claimed',
      ...(done !== undefined ? { note: done.text.trim().split(/\r?\n/)[0].slice(0, 200) } : {})
    })
  }
  claims.sort((a, b) => a.task.localeCompare(b.task, 'en', { numeric: true }))
  const result = { root, scannedAt: now(), declarations, undeclared, claims, background: await scanBackground(declarations, { now }).catch(() => []), truncated: Object.values(truncated).some(Boolean), limits: budget }
  const targets = declarations.filter((decl) => (decl.kind === 'done' && decl.merge === 'mergeable') || decl.merge === 'pending')
  if (!git || targets.length === 0 || !(await exists(join(root, '.git')))) return git ? { ...result, git: { main: undefined, checks: {} } } : result
  return enrichWithGit(root, result, { memo: gitMemo, now, remoteTags })
}

/** 「占用文件」里的路径：去掉 /** 之类通配后缀和 (+Test) 注记；含省略号或通配的跳过；太宽的（单段目录）不比。 */
export function declaredPaths(text, limit = SCAN_LIMITS.pathsPerDeclaration) {
  return parseFiles(String(text ?? '').replace(/[（(][^）)]*[）)]/g, ' '))
    .map((path) => path.replace(/\/\*\*?$/, '').replace(/\/\*$/, ''))
    .filter((path) => !/\.\.\.|…|\*/.test(path) && path.includes('/'))
    .slice(0, limit)
}

/** 多个活跃声明同时占用的路径（相同或父子路径），有固定比较预算。 */
export function declarationOverlaps(declarations, { maxPairs = SCAN_LIMITS.overlapPairs, maxPaths = SCAN_LIMITS.pathsPerDeclaration } = {}) {
  const active = declarations.filter((decl) => decl.kind === 'active' && decl.merge !== 'merged' && decl.files)
    .map((decl) => ({ decl, paths: declaredPaths(decl.files, maxPaths) })).filter((item) => item.paths.length > 0)
  const byPath = new Map()
  let pairs = 0
  let truncated = false
  outer: for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      for (const a of active[i].paths) for (const b of active[j].paths) {
        pairs += 1
        if (pairs > maxPairs) { truncated = true; break outer }
        if (!(a === b || a.startsWith(b + '/') || b.startsWith(a + '/'))) continue
        const path = a.length <= b.length ? a : b
        if (!byPath.has(path)) byPath.set(path, new Set())
        byPath.get(path).add(active[i].decl.rel).add(active[j].decl.rel)
      }
    }
  }
  const result = [...byPath].map(([path, rels]) => ({ path, rels: [...rels] })).sort((a, b) => b.rels.length - a.rels.length || a.path.localeCompare(b.path))
  return truncated ? Object.assign(result, { truncated: true, pairs, limit: maxPairs }) : result
}

/** 活跃声明多少天没更新才在摘要里提示。 */
export const IDLE_NOTICE_DAYS = 3

/** 声明「更新：」字段的时间（几种写法都认），读不出来用文件修改时间。 */
export function declUpdatedMs(decl) {
  const text = String(decl?.updated ?? '').split('\n')[0].trim()
  const match = /(\d{4}-\d{2}-\d{2})[T\s]+(\d{1,2}:\d{2}(?::\d{2})?)\s*(Z|UTC)?/.exec(text)
  if (match !== null) {
    const ms = Date.parse(`${match[1]}T${match[2].length === 4 ? '0' + match[2] : match[2]}${match[2].split(':').length === 2 ? ':00' : ''}Z`)
    if (Number.isFinite(ms)) return ms
  }
  return decl?.mtimeMs
}

export function idleDays(decl, now = Date.now()) {
  const at = declUpdatedMs(decl)
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 86_400_000)) : 0
}

/** 看板加上声明结论：看板报可合并但声明已写「已合入」的，标 declMerged，不再进可合并队列。 */
export function annotateBoard(board, view) {
  if (view === undefined || !(view.readyMerged?.length > 0)) return board
  const next = { ...board }
  for (const item of view.readyMerged) {
    if (next[item.sessionId] !== undefined) next[item.sessionId] = { ...next[item.sessionId], declMerged: item.decl.build ?? '已合入' }
  }
  return next
}

/**
 * 声明与看板对照。
 * @param scan - scanWorkspace 结果
 * @param board - { sessionId: entry }（本工作区可见看板）
 * @param live - 现存（未归档）根会话 id 集合
 */
export function reconcile(scan, board, live, { now = Date.now } = {}) {
  const declarations = scan?.declarations ?? []
  const alive = new Set([...(live ?? [])].map(bareId))
  const index = new Map()
  for (const decl of declarations) {
    if (decl.holder === undefined) continue
    const key = bareId(decl.holder)
    if (!index.has(key)) index.set(key, [])
    index.get(key).push(decl)
  }
  /** 按会话 id（带不带 session- 都行）取它持有的声明。 */
  const byHolder = { get: (sessionId) => index.get(bareId(sessionId)) }
  const active = declarations.filter((decl) => decl.kind === 'active')
  const candidates = declarations.filter((decl) => decl.kind === 'done' && decl.merge === 'mergeable')
  const pending = declarations.filter((decl) => decl.merge === 'pending')
  // 已合入但还是 .ACTIVE-SESSION：持有者没按约定交还（改名 .SESSION-DONE）
  const mergedActive = active.filter((decl) => decl.merge === 'merged')
  const orphans = active.filter((decl) => decl.merge !== 'merged' && (decl.holder === undefined || !alive.has(bareId(decl.holder))))
  const mismatches = []
  for (const [sessionId, entry] of Object.entries(board ?? {})) {
    const own = (byHolder.get(sessionId) ?? []).filter((decl) => decl.rel !== '.' || decl.kind === 'active')
    if (own.length === 0) continue
    const activeOwn = own.filter((decl) => decl.kind === 'active')
    // 看板报可合并，但对应声明已写「已合入」：不该再排队
    const sameBranch = (decl) => entry.branch === undefined || decl.branch === undefined || decl.branch === entry.branch
    const merged = own.find((decl) => decl.merge === 'merged' && sameBranch(decl))
    const stillOpen = own.some((decl) => (decl.merge === 'mergeable' || decl.merge === 'pending') && sameBranch(decl))
    if (entry.status === 'ready' && merged !== undefined && !stillOpen) {
      mismatches.push({ sessionId, kind: 'ready-merged', decl: merged })
      continue
    }
    if (entry.status === 'ready' && activeOwn.some((decl) => decl.merge === 'blocked' || decl.merge === 'unknown') && !own.some((decl) => decl.merge === 'mergeable')) {
      mismatches.push({ sessionId, kind: 'ready-not-declared', decl: activeOwn[0] })
    }
    if ((entry.status === 'done' || entry.status === 'abandoned') && activeOwn.length > 0) {
      mismatches.push({ sessionId, kind: 'done-still-active', decl: activeOwn[0] })
    }
    if (['working', 'blocked', 'question'].includes(entry.status) && activeOwn.length === 0 && own.every((decl) => decl.kind === 'done') && own.some((decl) => decl.mtimeMs > (entry.updatedAt ?? 0))) {
      mismatches.push({ sessionId, kind: 'declared-done', decl: own[0] })
    }
  }
  const git = scan?.git
  // 待推送但提交已在 origin/main（祖先或等价补丁）：该补「已合入」
  // 「可以补已合入」要两个条件：提交已在 origin/main（祖先或等价补丁），且对应 build 已发布
  const releasedNo = Number(/\d+/.exec(git?.main?.released?.build ?? '')?.[0])
  const buildNo = (decl) => Number(/\d+/.exec(decl.build ?? '')?.[0])
  const isReleased = (decl) => Number.isFinite(releasedNo) && (!Number.isFinite(buildNo(decl)) || buildNo(decl) <= releasedNo)
  const inMain = pending.filter((decl) => git?.checks?.[decl.rel]?.inMain || git?.checks?.[decl.rel]?.equivalentInMain)
  const landed = inMain.filter(isReleased)
  const inMainUnreleased = inMain.filter((decl) => !isReleased(decl))
  // 补丁不等价（发布时手工解过冲突）但 origin/main 的 build 号已到声明的「待推送 buildNNN」：很可能已合入，需人工核对
  const mainBuild = Number(/\d+/.exec(git?.main?.build ?? '')?.[0])
  const maybeLanded = pending.filter((decl) => !inMain.includes(decl) && Number.isFinite(mainBuild) && buildNo(decl) <= mainBuild)
  // 活跃声明几天没更新（只提示，不推断已结束）
  const idle = active.filter((decl) => decl.merge !== 'merged').map((decl) => ({ decl, days: idleDays(decl, now()) }))
    .filter((item) => item.days >= IDLE_NOTICE_DAYS).sort((a, b) => b.days - a.days)
  return {
    byHolder, isLive: (id) => alive.has(bareId(id)), active, candidates, pending, mergedActive, orphans, mismatches,
    undeclared: scan?.undeclared ?? [], claims: scan?.claims ?? [],
    overlaps: declarationOverlaps(declarations), main: git?.main, checks: git?.checks ?? {}, background: scan?.background ?? git?.background ?? [], landed, inMainUnreleased, maybeLanded, idle,
    readyMerged: mismatches.filter((item) => item.kind === 'ready-merged')
  }
}

export const MERGE_LABEL = { merged: '已合入', pending: '待推送', mergeable: '可合并', blocked: '不可合并', abandoned: '放弃', unknown: '未写明' }

const MISMATCH_TEXT = {
  'ready-merged': '看板仍报可合并，但声明已写「已合入」（已移出可合并队列；提交核对确在 origin/main 后插件会自动标为完成，核对不到时对方汇报一次 done 即可）',
  'ready-not-declared': '看板报可合并，但声明仍是活跃且「合并」未写可合并（合并前先改声明为 .SESSION-DONE 并写明可合并）',
  'done-still-active': '看板报已完成 / 已放弃，但声明还是 .ACTIVE-SESSION（结束时应改名 .SESSION-DONE）',
  'declared-done': '声明已改为 .SESSION-DONE，看板仍是进行中（汇报一次 done 或 ready）'
}

export function mismatchText(kind) {
  return MISMATCH_TEXT[kind] ?? kind
}

function declLabel(decl) {
  return `${decl.rel}${decl.branch && !decl.rel.endsWith(decl.branch) ? `（${decl.branch}）` : ''}`
}

/** 主会话上下文里的一行摘要：只有计数与少量名字，内容随声明文件变化。 */
export function declarationSummaryLine(view, labelFor) {
  if (view === undefined) return undefined
  const parts = [`活跃 ${view.active.length}`]
  if (view.candidates.length > 0) parts.push(`可合并待排号 ${view.candidates.length}（${view.candidates.slice(0, 4).map(declLabel).join('、')}${view.candidates.length > 4 ? '…' : ''}）`)
  if (view.pending.length > 0) parts.push(`待推送 ${view.pending.length}`)
  if (view.mergedActive.length > 0) parts.push(`已合入未交还 ${view.mergedActive.length}`)
  if (view.orphans.length > 0) parts.push(`持有者已不在 ${view.orphans.length}`)
  if (view.undeclared.length > 0) parts.push(`无声明工作树 ${view.undeclared.length}`)
  if (view.landed?.length > 0) parts.push(`可以补「已合入」${view.landed.length}（${view.landed.slice(0, 3).map(shortRel).join('、')}）`)
  if (view.inMainUnreleased?.length > 0) parts.push(`已进 main 未发布 ${view.inMainUnreleased.length}`)
  if (view.maybeLanded?.length > 0) parts.push(`build 号已到、待人工核对 ${view.maybeLanded.length}（${view.maybeLanded.slice(0, 3).map(shortRel).join('、')}）`)
  const skip = new Set((view.maybeLanded ?? []).map((decl) => decl.rel))
  const problems = Object.values(view.checks ?? {}).filter((check) => !skip.has(check.rel) && checkProblems(check).length > 0)
  if (problems.length > 0) parts.push(`排号核对有问题 ${problems.length}：${problems.slice(0, 3).map((check) => `${shortRel(check)}（${checkSummary(check)}）`).join('、')}${problems.length > 3 ? '…' : ''}`)
  const bg = (view.background ?? []).filter((item) => item.attention)
  if (bg.length > 0) parts.push(`后台任务需看 ${bg.length}（${bg.slice(0, 3).map((item) => `${shortRel(item)}：${backgroundSummary(item)}`).join('、')}）`)
  if (view.idle?.length > 0) parts.push(`活跃但 ${IDLE_NOTICE_DAYS} 天以上没更新 ${view.idle.length}（${view.idle.slice(0, 3).map((item) => `${shortRel(item.decl)} ${item.days} 天`).join('、')}；只是提示，是否结束问用户）`)
  if (view.overlaps?.length > 0) parts.push(`活跃声明占用重叠 ${view.overlaps.length} 处`)
  const head = `工作树声明：${parts.join(' · ')}。`
  const issues = view.mismatches.slice(0, 3).map((item) => `⚠ ${labelFor(item.sessionId)}：${mismatchText(item.kind)}`)
  return [...(view.main ? [mainRefLine(view.main)] : []), head + '合并 / 发布以声明为准；明细 /relay decl 或 peer_workspace declarations=true。', ...issues].join('\n')
}

/**
 * origin/main 的实际位置（本机最近一次 fetch / push 时的值，插件不 fetch）。
 * stamp=false（上下文默认）不写 fetch / 查询时间：时间每轮都可能变，会打掉提示缓存；
 * /relay decl 等给人看的输出传 stamp=true。
 */
export function mainRefLine(main, { stamp = false } = {}) {
  if (main?.sha === undefined) return ''
  // 上下文版：英文短句、不带时间；给人看的（stamp=true，/relay decl）保持中文原样
  if (!stamp) return `Verified: origin/main ${main.build ?? 'build ?'} (${main.short} "${main.subject}", last local fetch/push); ${releasedContext(main)}. In main ≠ released, report them separately; git fetch --tags to refresh. Trust this over the version line text.`
  const when = main.updatedAt ? new Date(main.updatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '时间未知'
  const mainPart = `main 已到：${main.build ?? '版本号未知'}（origin/main ${main.short}「${main.subject}」${stamp ? `，截至 ${when} 的 fetch / push` : '，本机最近一次 fetch / push'}）`
  return `${mainPart}；${releasedText(main, { stamp })}。进 main ≠ 已发布；说进度时两者分开讲，需要更新先 git fetch（含 tag）。与版本线文字不一致时以这一行的插件核验为准。`
}

/** 旁观会话用的一行：只给 main 与已发布，不含说明和时间。 */
export function mainBriefLine(main) {
  if (main?.sha === undefined) return ''
  const released = main.released?.build === undefined ? 'released: unknown' : `released: ${main.released.build} (tag ${main.released.tag})`
  return `Verified: main=${main.build ?? main.short} (${main.short}), ${released}; trust this over the line.`
}

/** 上下文用的已发布状态（英文，不带查询时间）。 */
function releasedContext(main) {
  const released = main?.released
  const remote = released?.source === 'remote'
  const where = remote ? 'GitHub tag' : released?.remoteError ? `local tag, GitHub unconfirmed: ${released.remoteError}` : 'local tag'
  if (released?.build === undefined) return remote ? `released: no release tag on GitHub for anything in main (${where})` : `released: no local release tag, unknown (${where})`
  const mainNo = Number(/\d+/.exec(main?.build ?? '')?.[0])
  const relNo = Number(/\d+/.exec(released.build)[0])
  const range = mainNo - relNo === 1 ? `build${mainNo}` : `build${relNo + 1}–${mainNo}`
  const gap = Number.isFinite(mainNo) && mainNo > relNo ? `; ${range} in main without a release tag (${remote ? 'release running or failed' : 'maybe releasing, or tags not fetched'})` : ''
  return `released: ${released.build} (tag ${released.tag}, ${released.commit}; ${where})${gap}`
}

/** 已发布部分：本机可见的最新发布 tag，以及已进 main 但没见到发布 tag 的号段。 */
export function releasedText(main, { stamp = true } = {}) {
  const released = main?.released
  const mainNo = Number(/\d+/.exec(main?.build ?? '')?.[0])
  const remote = released?.source === 'remote'
  const where = remote ? `GitHub 发布 tag${stamp ? `，${formatClock(released.checkedAt)} 查询` : ''}` : released?.remoteError ? `本机 tag；GitHub 未确认：${released.remoteError}` : '本机 tag'
  if (released?.build === undefined) return remote ? `已发布：GitHub 上没有已进 main 的发布 tag（${where}）` : `已发布：本机没有发布 tag，无法判断（${where}）`
  const relNo = Number(/\d+/.exec(released.build)[0])
  const range = mainNo - relNo === 1 ? `build${mainNo}` : `build${relNo + 1}–${mainNo}`
  const gap = Number.isFinite(mainNo) && mainNo > relNo
    ? `；${range} 已进 main、${remote ? '还没有发布 tag（发布进行中或失败）' : '本机未见发布 tag（可能还在发布，或 tag 没 fetch）'}`
    : ''
  return `已发布：${released.build}（tag ${released.tag}，${released.commit}；来源：${where}）${gap}`
}

function formatClock(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) + ' UTC' : '时间未知'
}

/** 排号前核对的问题项（空数组 = 没发现问题）。 */
export function checkProblems(check) {
  if (check === undefined) return []
  if (check.error) return [check.error]
  if (check.inMain || check.equivalentInMain) return []
  const problems = []
  if (check.commitMissing) problems.push(`声明提交 ${check.commitMissing} 在仓库里找不到`)
  if (check.commitMatches === false) problems.push(`分支 HEAD ${check.head.slice(0, 8)} ≠ 声明提交（对方之后又提交过，不能直接挑）`)
  if (check.dirty > 0) problems.push(`工作树有 ${check.dirty} 个未提交改动`)
  const tiers = conflictTiers(check)
  if (tiers.source.length > 0) problems.push(`合并到 origin/main 冲突涉及源码，要人看：${tiers.source.join('、')}${tiers.regenerable.length > 0 ? `（另有可重算的 ${tiers.regenerable.join('、')}）` : ''}`)
  if (check.conflicts?.error) problems.push(`冲突检查失败：${check.conflicts.error}`)
  if (check.unregisteredJava?.length > 0) problems.push(`新增 .java 未登记 tools/java-format-files.json：${check.unregisteredJava.join('、')}`)
  const plan = check.formatPlan
  if (plan?.missing > 0 || plan?.extra > 0) problems.push(`format-java-tree --plan：missing ${plan.missing}、extra ${plan.extra}（格式清单要补登记，否则 CI 完整格式检查会失败）${plan.dirty ? '；按工作树当前文件计，含未提交改动' : ''}`)
  if (plan?.error) problems.push(`format-java-tree --plan 失败：${plan.error}`)
  return problems
}

/** 可重算的生成文件：冲突只在这些文件时基本可以直接合。 */
export const REGENERABLE = [/(^|\/)runtime-descriptor\.json$/]

export function conflictTiers(check) {
  const list = Array.isArray(check?.conflicts) ? check.conflicts : []
  const regenerable = list.filter((path) => REGENERABLE.some((re) => re.test(path)))
  return { regenerable, source: list.filter((path) => !regenerable.includes(path)) }
}

/** 摘要里一句话的原因（最要紧的一项）。 */
export function checkSummary(check) {
  if (check?.error) return check.error.slice(0, 60)
  const tiers = conflictTiers(check)
  const base = (path) => path.split('/').pop()
  if (tiers.source.length > 0) return `合并冲突 ${tiers.source.slice(0, 2).map(base).join('、')}${tiers.source.length > 2 ? ' 等' : ''}`
  if (check.commitMatches === false) return 'HEAD 已不是声明提交'
  if (check.commitMissing) return '声明提交找不到'
  if (check.unregisteredJava?.length > 0 || check.formatPlan?.missing > 0 || check.formatPlan?.extra > 0) return '格式清单未登记'
  if (check.formatPlan?.error) return 'format-java-tree --plan 失败'
  if (check.dirty > 0) return '有未提交改动'
  return '见明细'
}

function shortRel(item) {
  return String(item?.rel ?? '').replace(/^\.agents\/worktrees\//, '')
}

function backgroundSummary(item) {
  if (item.stale) return '进程已退出、没写退出码'
  const skipped = item.logs.find((log) => log.skipped)
  if (skipped) return `日志跳过：${skipped.skipped}`
  const stopped = item.logs.find((log) => log.stopped)
  if (stopped) return `日志末行「${stopped.last.slice(0, 40)}」`
  if (item.logs.some((log) => log.missing)) return '日志不存在'
  return '进程已退出'
}

function checkLines(check) {
  if (check === undefined) return []
  if (check.inMain) return ['  ✓ 提交已是 origin/main 祖先']
  if (check.equivalentInMain) return ['  ✓ 等价补丁已在 origin/main（cherry-pick）']
  const lines = checkProblems(check).map((text) => `  ⚠ ${text}`)
  const tiers = conflictTiers(check)
  if (tiers.source.length === 0 && tiers.regenerable.length > 0) lines.push(`  · 合并冲突只在 ${tiers.regenerable.join('、')}（可重算，基本可以直接合）`)
  if (check.formatPlan?.skipped) lines.push(`  · 没跑 format-java-tree --plan：${check.formatPlan.skipped}`)
  else if (check.formatPlan && !check.formatPlan.error && !(check.formatPlan.missing > 0) && !(check.formatPlan.extra > 0)) lines.push('  ✓ format-java-tree --plan：missing 0、extra 0')
  if (check.ahead !== undefined) lines.push(`  距 origin/main：领先 ${check.ahead}、落后 ${check.behind}`)
  if (check.gates) {
    const missing = [!check.gates.lint && 'lintStandardRelease', !check.gates.i18n && 'check-ui-i18n', !check.gates.format && 'format-java'].filter(Boolean)
    if (missing.length > 0) lines.push(`  声明里没提到跑过：${missing.join('、')}（推前自己跑）`)
  }
  return lines
}

function backgroundLine(item) {
  const parts = [
    ...item.pids.map((p) => `pid ${p.pid} ${p.alive ? '在运行' : '已退出'}`),
    ...item.logs.map((log) => log.missing ? `${log.path} 不存在` : log.skipped ? `${log.path} 已跳过（${log.skipped}）` : `${log.path} 最后一行「${log.last}」（${Math.round(log.ageMs / 60000)} 分钟前）${log.stopped ? ' ⚠' : ''}`)
  ]
  return `- ${item.rel}${item.attention ? ' ⚠' : ''}：${item.stale ? '登记过期（进程已退出，声明没写退出码）；' : ''}${parts.join('；') || item.text}`
}

/** 工作会话：本会话持有的活跃声明与不一致提醒（没有就不输出）。 */
export function workerDeclarationLines(view, sessionId, entry) {
  if (view === undefined) return []
  const own = (view.byHolder.get(sessionId) ?? []).filter((decl) => decl.kind === 'active')
  const lines = own.slice(0, 2).map((decl) => `Your worktree declaration: ${decl.rel}/${decl.file} (phase: ${(decl.phase ?? '—').split('\n')[0].slice(0, 60)}; merge: ${MERGE_LABEL[decl.merge]}). Update 更新/当前阶段/合并/后台任务 before each reply; rename to .SESSION-DONE when finished.`)
  for (const item of view.mismatches.filter((m) => m.sessionId === sessionId)) lines.push(`⚠ ${mismatchText(item.kind)}`)
  void entry
  return lines
}

/** /relay decl 与 peer_workspace declarations=true 的完整文本。 */
export function describeDeclarations(view, { labelFor, root, limit = 30 }) {
  if (view === undefined) return '本工作区没有登记路径，读不到工作树声明。'
  const holderText = (decl) => decl.holder === undefined ? '持有者未写' : view.isLive(decl.holder) ? labelFor(decl.holder) : `${decl.holder.slice(8, 16)}（会话已不在）`
  const idleOf = new Map((view.idle ?? []).map((item) => [item.decl, item.days]))
  const row = (decl) => `- ${declLabel(decl)} · ${decl.kind === 'active' ? '活跃' : '已结束'}${idleOf.has(decl) ? ` · ${idleOf.get(decl)} 天没更新` : ''} · 合并：${MERGE_LABEL[decl.merge]}${decl.build ? ' ' + decl.build : ''}${decl.commit ? ' ' + decl.commit : ''} · ${holderText(decl)}${decl.phase ? ' · ' + decl.phase.split('\n')[0].slice(0, 60) : ''}`
  const section = (title, items, render = row) => items.length === 0 ? [] : ['', `【${title}】${items.length}`, ...items.slice(0, limit).map(render), ...(items.length > limit ? [`…另有 ${items.length - limit} 项`] : [])]
  const activeOthers = view.active.filter((decl) => !view.orphans.includes(decl) && !view.mergedActive.includes(decl) && decl.merge !== 'pending')
  return [
    ...(view.main ? [mainRefLine(view.main, { stamp: true })] : []),
    `工作树声明（${root}，只读，按 AGENTS.md 多会话并行约定）：活跃 ${view.active.length} · 可合并待排号 ${view.candidates.length} · 待推送 ${view.pending.length}`,
    ...section('看板与声明不一致', view.mismatches, (item) => `- ${labelFor(item.sessionId)} · ${declLabel(item.decl)}：${mismatchText(item.kind)}`),
    ...section('可合并待排号（.SESSION-DONE 且写明可合并，尚无「待推送 / 已合入」）', view.candidates, (decl) => [row(decl), ...checkLines(view.checks?.[decl.rel])].join('\n')),
    ...section('待推送', view.pending.filter((decl) => !(view.maybeLanded ?? []).includes(decl)), (decl) => [row(decl), ...checkLines(view.checks?.[decl.rel])].join('\n')),
    ...section('可以补「已合入」：提交已在 origin/main 且该 build 已发布（由合并会话按约定追加）', view.landed ?? []),
    ...section('提交已进 origin/main，但该 build 还没发布（发布成功后再补「已合入」）', view.inMainUnreleased ?? []),
    ...section('origin/main 的 build 号已到「待推送」的号，但补丁对不上（可能手工解过冲突，请人工核对后再补「已合入」）', view.maybeLanded ?? []),
    ...section('已合入但声明仍活跃（应由持有者改名 .SESSION-DONE；持有者已不在时问用户）', view.mergedActive),
    ...section('持有者会话已不在（不要自行接手或删除，先问用户）', view.orphans),
    ...section('活跃', activeOthers),
    ...section('没有声明的工作树（按约定一律不动，先问用户）', view.undeclared, (rel) => `- ${rel}`),
    ...section('活跃声明「占用文件」重叠', view.overlaps ?? [], (item) => `- ${item.path}：${item.rels.join('、')}`),
    ...section('登记的后台任务', view.background ?? [], backgroundLine),
    ...section('任务认领（claims）未结束', view.claims.filter((claim) => claim.state === 'claimed'), (claim) => `- ${claim.task} · ${claim.holder === undefined ? '持有者未写' : view.isLive(claim.holder) ? labelFor(claim.holder) : claim.holder.slice(8, 16) + '（会话已不在）'}`),
    '',
    '插件不会改任何声明文件：改名 .SESSION-DONE、追加「已合入 buildNNN」由持有者或合并会话按约定执行。'
  ].join('\n')
}

/**
 * 带缓存的扫描器：上下文渲染是同步的，用最近一次结果，过期就在后台刷新（不阻塞模型步骤）。
 */
export const DECLARATION_CACHE_LIMIT = 32

export class DeclarationIndex {
  constructor({ ttlMs = 20_000, scan = scanWorkspace, scanOptions = {}, now = Date.now, logger, maxRoots = DECLARATION_CACHE_LIMIT, retryBaseMs = 2_000, retryMaxMs = 30_000 } = {}) {
    this.ttlMs = ttlMs
    this.scanFn = scan
    this.scanOptions = scanOptions
    this.now = now
    this.logger = logger
    this.maxRoots = maxRoots
    this.retryBaseMs = retryBaseMs
    this.retryMaxMs = retryMaxMs
    this.cache = new Map()
  }

  touch(root, slot) {
    this.cache.delete(root)
    this.cache.set(root, slot)
    while (this.cache.size > this.maxRoots) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      const item = this.cache.get(oldest)
      if (item?.pending !== undefined) {
        this.cache.delete(oldest)
        this.cache.set(oldest, item)
        if ([...this.cache.values()].every((value) => value?.pending !== undefined)) break
        continue
      }
      this.cache.delete(oldest)
    }
  }

  /** 同步取缓存；过期或没有时触发后台刷新。 */
  peek(root) {
    if (typeof root !== 'string' || root === '') return undefined
    const slot = this.cache.get(root)
    if (slot !== undefined) this.touch(root, slot)
    if (slot === undefined || (this.now() - slot.at > this.ttlMs && this.now() >= (slot.retryAt ?? 0))) void this.refresh(root).catch(() => {})
    return slot?.result
  }

  /** 异步取最新结果（命令、面板用）。 */
  async get(root, { maxAgeMs = this.ttlMs } = {}) {
    if (typeof root !== 'string' || root === '') return undefined
    const slot = this.cache.get(root)
    const now = this.now()
    if (slot?.pending !== undefined) return slot.pending
    if (slot !== undefined) this.touch(root, slot)
    if (slot?.retryAt > now) return slot.result
    if (maxAgeMs > 0 && slot !== undefined && slot.at > 0 && slot.result !== undefined && now - slot.at <= maxAgeMs) return slot.result
    return this.refresh(root)
  }

  refresh(root) {
    const slot = this.cache.get(root)
    const now = this.now()
    if (slot?.pending !== undefined) return slot.pending
    if (slot?.retryAt > now) return Promise.resolve(slot.result)
    const pending = this.scanFn(root, this.scanOptions).then((result) => {
      this.touch(root, { at: this.now(), result, failures: 0 })
      return result
    }, (error) => {
      this.logger?.warn?.(`session-relay: scan declarations in ${root} failed: ${error?.message ?? error}`)
      const previous = this.cache.get(root)
      const failures = (previous?.failures ?? 0) + 1
      const retryAt = this.now() + Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** Math.min(6, failures - 1)))
      this.touch(root, { at: this.now(), result: previous?.result, failures, retryAt })
      return previous?.result
    })
    this.touch(root, { ...(slot ?? { at: 0, result: undefined }), pending })
    return pending
  }

  adopt(previous) {
    for (const [root, slot] of previous?.cache ?? []) if (slot.result !== undefined) this.touch(root, { at: slot.at, result: slot.result, failures: slot.failures ?? 0, retryAt: slot.retryAt })
  }
}
