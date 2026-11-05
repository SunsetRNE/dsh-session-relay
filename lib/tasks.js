/**
 * 任务看板的状态查询与归档（.agents/TASKS.md + .agents/claims/<号>）。
 *
 * 问题：已修好的任务一直留在 TASKS.md 里（表格行 + 越写越长的「### T<号>」详情），没有归档，
 * 看板不断变大；也没法快速知道哪些还在等人认领、谁接手了、是否真的合进了 origin/main、持有者是否已经死了。
 *
 * - classifyTasks：把表格行、详情段、认领目录、git（只读）与会话状态对起来，给每个任务一个状态。
 * - planArchive / applyArchive：把已合入 / 已放弃的任务从 TASKS.md 挪到 TASKS-archive.md（去重），
 *   先预览（planId 绑定当前文件内容），确认后才写；写前备份、原子替换。
 *
 * git 只读：不 fetch、不改 refs；整个看板只跑固定几条 git 命令（rev-list / log 一次性取全），不按提交逐个开进程。
 */
import { createHash } from 'node:crypto'
import { constants as FS_CONSTANTS } from 'node:fs'
import { mkdir, open, opendir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { git } from './gitcheck.js'
import { clip, clipUtf8, formatTime, oneLine, RelayError, shortId } from './core.js'
import { normalizeSessionId } from './declarations.js'

export const ARCHIVE_FILE = 'TASKS-archive.md'
export const BACKUP_DIR = 'backups'
export const MAX_DOC = 2 * 1024 * 1024
export const REPORT_BUDGET = 6 * 1024
export const HEAVY_TOKENS = 600_000 // 与 core.js CONTEXT_BUDGET.heavy 一致；classifyTasks 可传 heavyTokens
export const STALE_IDLE_MS = 6 * 3600_000
const MAX_CLAIMS = 512
const MAX_CLAIM_FILE = 64 * 1024
const KEEP_BACKUPS = 10
const ARCHIVED_MARK = /<!-- archived:([A-Za-z]*\d+[A-Za-z0-9._-]*) /g

/** 状态与显示顺序。 */
export const TASK_STATES = {
  open: '待认领',
  dead: '持有者已失效',
  stale: '持有者久未活动',
  live: '进行中',
  queued: '待合并',
  partial: '部分合入',
  likely: '疑似已合入',
  merged: '已合入',
  abandoned: '已放弃 / 作废',
  unknown: '状态不明'
}
export const ARCHIVABLE = new Set(['merged', 'abandoned'])

// ------------------------------------------------------------------ 读文件

async function readBounded(path, maxBytes) {
  let handle
  try {
    handle = await open(path, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NONBLOCK)
    const info = await handle.stat()
    if (!info.isFile()) return undefined
    if (info.size > maxBytes) return { tooLarge: true, size: info.size }
    const buffer = Buffer.alloc(info.size)
    if (info.size > 0) await handle.read(buffer, 0, info.size, 0)
    return { text: buffer.toString('utf8'), size: info.size, mtimeMs: info.mtimeMs, mode: info.mode }
  } catch { return undefined
  } finally { if (handle !== undefined) await handle.close().catch(() => {}) }
}

// ------------------------------------------------------------------ 解析看板

function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

const TASK_ID = /^[A-Za-z]*\d+[A-Za-z0-9._-]*$/

/**
 * 解析 TASKS.md：带「号」「状态」列的表格行，与「### <号> …」详情段；都带行号，归档时按行删除。
 * @returns {{ lines, rows: Array<{ id, priority, title, worktree, status, line }>, sections: Map<id, { start, end, heading }>, archivedIds: Set }}
 */
export function parseTaskDoc(text) {
  const lines = String(text ?? '').split('\n')
  const rows = []
  const sections = new Map()
  let header
  let inTable = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim().startsWith('|')) {
      const row = cells(line)
      if (!inTable) {
        inTable = true
        header = row.includes('号') && row.some((cell) => cell.includes('状态')) ? row : undefined
        continue
      }
      if (header === undefined || row.every((cell) => /^:?-{2,}:?$/.test(cell) || cell === '')) continue
      const pick = (name) => { const at = header.findIndex((cell) => cell.includes(name)); return at < 0 ? undefined : row[at] }
      const id = pick('号')
      if (!id || !TASK_ID.test(id)) continue
      rows.push({ id, priority: pick('优先') ?? '', title: pick('任务') ?? '', worktree: pick('工作树') ?? '', status: pick('状态') ?? '', line: index })
      continue
    }
    inTable = false
  }
  // 详情段：### <号> 标题，到下一个同级或更高级标题为止
  const headings = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(\S+)/.exec(lines[index])
    if (match) headings.push({ index, level: match[1].length, word: match[2] })
  }
  for (let at = 0; at < headings.length; at += 1) {
    const heading = headings[at]
    if (heading.level < 3 || !TASK_ID.test(heading.word)) continue
    let end = lines.length
    for (const next of headings.slice(at + 1)) if (next.level <= heading.level) { end = next.index; break }
    // 段落后的空行留给下一段
    if (!sections.has(heading.word)) sections.set(heading.word, { start: heading.index, end, heading: lines[heading.index].trim() })
  }
  const archivedIds = new Set([...String(text ?? '').matchAll(ARCHIVED_MARK)].map((match) => match[1]))
  return { lines, rows, sections, archivedIds }
}

// ------------------------------------------------------------------ 认领目录

/** 读 claims/<号>：owner（含接手链）、done / abandoned 文本、其它文件名。 */
export async function readClaims(claimsRoot, { limit = MAX_CLAIMS } = {}) {
  const claims = new Map()
  let truncated = false
  let handle
  try {
    handle = await opendir(claimsRoot)
    for await (const entry of handle) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      if (claims.size >= limit) { truncated = true; break }
      claims.set(entry.name, { id: entry.name })
    }
  } catch {}
  await Promise.all([...claims.values()].map(async (claim) => {
    const dir = join(claimsRoot, claim.id)
    const [owner, done, abandoned] = await Promise.all(['owner', 'done', 'abandoned'].map((name) => readBounded(join(dir, name), MAX_CLAIM_FILE)))
    const lines = String(owner?.text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    let holder = normalizeSessionId(lines[0])
    const chain = holder === undefined ? [] : [holder]
    for (const line of lines.slice(1)) {
      if (!/^接手/.test(line)) continue
      const next = normalizeSessionId(line)
      if (next !== undefined) { holder = next; chain.push(next) }
    }
    claim.holder = holder
    claim.chain = chain
    claim.claimedAt = owner?.mtimeMs
    if (done?.text !== undefined) { claim.done = done.text.trim(); claim.doneAt = done.mtimeMs }
    if (abandoned?.text !== undefined) { claim.abandoned = abandoned.text.trim(); claim.abandonedAt = abandoned.mtimeMs }
    try { claim.files = (await readdir(dir)).filter((name) => !['owner', 'done', 'abandoned'].includes(name)).slice(0, 12) } catch { claim.files = [] }
  }))
  return { claims, truncated }
}

// ------------------------------------------------------------------ 交付提交

const BASE_BEFORE = /(基于|父提交|变基到|rebase 到|在|须在|main\s*=|origin\/main\s*=?|=)\s*[`（(]?\s*$/i
const BASE_AFTER = /^\s*[`）)]?\s*(之后|以后|之上|build\d+\)?\s*$)/i
const VOID_AFTER = /^[^。；;\n]{0,24}(作废|勿合|废弃|不要合|已废|弃用)/

/**
 * 从 done / 状态文本里找交付提交：8–40 位十六进制且不是纯数字（日期、字节数）；
 * 跳过「基于 / 须在 … 之后 / main=」这类基线提交；「作废 / 勿合」的单独列出。
 */
export function deliverableCommits(text) {
  const source = String(text ?? '')
  const keep = []
  const voided = new Set()
  const base = new Set()
  for (const match of source.matchAll(/(?<![0-9A-Za-z])([0-9a-f]{8,40})(?![0-9A-Za-z])/g)) {
    const sha = match[1]
    if (/^\d+$/.test(sha)) continue
    const before = source.slice(Math.max(0, match.index - 14), match.index)
    const after = source.slice(match.index + sha.length, match.index + sha.length + 40)
    // 同一提交任何一处写了作废，就算作废；只当基线出现过的不算交付
    if (VOID_AFTER.test(after)) { voided.add(sha); continue }
    if (BASE_BEFORE.test(before) || BASE_AFTER.test(after)) { base.add(sha); continue }
    if (!keep.includes(sha)) keep.push(sha)
  }
  return { commits: keep.filter((sha) => !voided.has(sha)), voided: [...voided] }
}

/** 明确写着合入 / 发布了。 */
const MERGED_TEXT = /已合入|已随\s*build\d+.*发布|合入\s*build\d+|已发布|发布成功|全部发布/
const ABANDON_TEXT = /^放弃|已放弃|作废|不再做|取消|不做了|撤销立项/

// ------------------------------------------------------------------ git（一次取全）

/**
 * 读 origin/main 的提交集合与主题（各一次 git 调用），之后对每个提交只做内存查找。
 * @returns {Promise<{ sha, short, reach: Set<string>, subjects: Map<subject, {sha, time}[]>, reverts: Set<subject>, taskMentions: string } | undefined>}
 */
export async function loadMainIndex(root, { ref = 'refs/remotes/origin/main' } = {}) {
  let sha
  try { sha = (await git(root, ['rev-parse', '--verify', '-q', ref])).stdout.trim() } catch { return undefined }
  if (sha === '') return undefined
  const [list, log] = await Promise.all([
    git(root, ['rev-list', '--max-count=20000', sha], { timeout: 20_000 }),
    git(root, ['log', '--max-count=4000', '--format=%H%x09%ct%x09%s', sha], { timeout: 20_000 })
  ])
  const reach = new Set(list.stdout.split('\n').filter(Boolean))
  const subjects = new Map()
  const reverts = new Set()
  const recent = []
  for (const line of log.stdout.split('\n')) {
    const [full, time, ...rest] = line.split('\t')
    if (!full) continue
    const subject = rest.join('\t').trim()
    const list = subjects.get(subject) ?? []
    list.push({ sha: full, time: Number(time) * 1000 })
    subjects.set(subject, list)
    const reverted = /^Revert "(.+)"$/.exec(subject)
    if (reverted) reverts.add(reverted[1])
    recent.push({ subject, time: Number(time) * 1000 })
  }
  return { sha, short: sha.slice(0, 8), reach, subjects, reverts, recent }
}

/** 交付提交的本地信息：完整 sha、主题、提交时间（一次 git log --no-walk）。 */
export async function describeCommits(root, shas) {
  const out = new Map()
  const wanted = [...new Set(shas)].slice(0, 400)
  if (wanted.length === 0) return out
  // 不存在的提交会让 git log 整体失败，所以先逐批 rev-parse（cat-file --batch-check 一次搞定）
  const check = await new Promise((resolve) => {
    import('node:child_process').then(({ spawn }) => {
      const child = spawn('git', ['cat-file', '--batch-check=%(objectname) %(objecttype)'], { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } })
      let stdout = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.on('error', () => { clearTimeout(timer); resolve('') })
      child.on('close', () => { clearTimeout(timer); resolve(stdout) })
      child.stdin.end(wanted.map((sha) => `${sha}^{commit}`).join('\n') + '\n')
    }, () => resolve(''))
  })
  const resolved = new Map()
  check.split('\n').forEach((line, index) => {
    const [full, type] = line.trim().split(' ')
    if (type === 'commit' && index < wanted.length) resolved.set(wanted[index], full)
  })
  const fulls = [...new Set(resolved.values())]
  if (fulls.length === 0) return out
  const log = await git(root, ['log', '--no-walk=unsorted', '--format=%H%x09%ct%x09%s', ...fulls], { timeout: 20_000 }).catch(() => ({ stdout: '' }))
  const info = new Map()
  for (const line of log.stdout.split('\n')) {
    const [full, time, ...rest] = line.split('\t')
    if (full) info.set(full, { full, time: Number(time) * 1000, subject: rest.join('\t').trim() })
  }
  for (const [sha, full] of resolved) if (info.has(full)) out.set(sha, info.get(full))
  return out
}

/**
 * 一个交付提交在 origin/main 上的情况：
 * in（祖先）/ picked（同主题提交出现在它之后的 main 上，发布会话 cherry-pick 或重写过）/ reverted / missing（本机没有）/ out。
 */
export function commitOnMain(sha, info, index) {
  if (index === undefined) return { sha, state: 'unknown' }
  if (info === undefined) return { sha, state: 'missing' }
  const subject = info.subject
  if (index.reverts.has(subject)) return { sha, state: 'reverted', subject }
  if (index.reach.has(info.full)) return { sha, state: 'in', subject }
  const same = (index.subjects.get(subject) ?? []).find((item) => item.time >= info.time - 60_000)
  if (same !== undefined && subject.length >= 8) return { sha, state: 'picked', subject, as: same.sha.slice(0, 8) }
  return { sha, state: 'out', subject }
}

/** main 上在 since 之后有没有提交主题提到任务号（发布提交常写「T41 …」）。 */
function mentionedOnMain(id, index, since = 0) {
  if (index === undefined) return undefined
  const pattern = new RegExp(`(?<![A-Za-z0-9])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`)
  return index.recent.find((item) => item.time >= since && pattern.test(item.subject))
}

// ------------------------------------------------------------------ 分类

/**
 * 持有者会话状态（由调用方提供，插件里用 sessionController / sessions / sessionQuery 查）。
 * @typedef {{ exists: boolean, archived?: boolean, running?: boolean, updatedAt?: number, lastEnd?: { kind, code? , at? }, contextTokens?: number }} HolderInfo
 */

function holderVerdict(info, now) {
  if (info === undefined) return { state: 'unknown', why: '查不到' }
  if (!info.exists) return { state: 'dead', why: '会话已不存在' }
  if (info.archived) return { state: 'dead', why: '会话已归档' }
  if (info.running) return { state: 'live', why: '运行中' }
  const end = info.lastEnd
  if (end !== undefined && (end.kind === 'error' || end.kind === 'interrupted' || end.kind === 'aborted')) {
    return { state: 'dead', why: `最后一轮${end.kind === 'error' ? `出错${end.code ? ' ' + end.code : ''}` : end.kind === 'aborted' ? '被中止' : '被打断'}${end.at ? `（${formatTime(end.at)}）` : ''}，之后没有新消息` }
  }
  if (Number.isFinite(info.updatedAt) && now - info.updatedAt > STALE_IDLE_MS) return { state: 'stale', why: `空闲 ${Math.round((now - info.updatedAt) / 3600_000)} 小时` }
  return { state: 'live', why: '空闲' }
}

/**
 * 给每个任务定状态。
 * @param doc - parseTaskDoc 结果
 * @param claims - readClaims().claims
 * @param ctx - { index（loadMainIndex）, commits（describeCommits 结果）, holders: Map<sessionId, HolderInfo>, now }
 */
/** 归档文件里已有的任务号。 */
export function archivedIdsOf(archiveText) {
  return new Set([...String(archiveText ?? '').matchAll(ARCHIVED_MARK)].map((match) => match[1]))
}

export function classifyTasks(doc, claims, { index, commits = new Map(), holders = new Map(), now = Date.now(), archived = new Set(), heavyTokens = HEAVY_TOKENS } = {}) {
  const ids = []
  const seen = new Set()
  for (const row of doc.rows) if (!seen.has(row.id)) { seen.add(row.id); ids.push(row.id) }
  for (const id of doc.sections.keys()) if (!seen.has(id)) { seen.add(id); ids.push(id) }
  for (const id of claims.keys()) if (!seen.has(id)) { seen.add(id); ids.push(id) }
  const duplicates = new Map()
  for (const row of doc.rows) duplicates.set(row.id, (duplicates.get(row.id) ?? 0) + 1)
  const tasks = []
  for (const id of ids) {
    const row = doc.rows.find((item) => item.id === id)
    const section = doc.sections.get(id)
    const claim = claims.get(id)
    const statusText = row?.status ?? ''
    const notes = []
    if ((duplicates.get(id) ?? 0) > 1) notes.push(`表格里有 ${duplicates.get(id)} 行`)
    if (doc.archivedIds.has(id) || archived.has(id)) notes.push('已归档过又出现')
    const task = { id, title: row?.title || section?.heading.replace(/^#+\s*\S+\s*/, '') || '', priority: row?.priority ?? '', statusText, row, section, claim, notes, holder: claim?.holder }
    const sectionBytes = section === undefined ? 0 : Buffer.byteLength(doc.lines.slice(section.start, section.end).join('\n'), 'utf8')
    task.bytes = sectionBytes + (row === undefined ? 0 : Buffer.byteLength(doc.lines[row.line], 'utf8'))
    // 交付提交：有 done 就以 done（认领者写的结论）为准；表格里的提交只在表格写明「已合入」时用来确认合入
    const primary = deliverableCommits(claim?.done !== undefined ? [claim.done, claim.abandoned].filter(Boolean).join('\n') : statusText)
    const table = claim?.done !== undefined ? deliverableCommits(statusText) : { commits: [], voided: [] }
    const voidedAll = new Set([...primary.voided, ...table.voided])
    task.commits = primary.commits.filter((sha) => !voidedAll.has(sha)).map((sha) => commitOnMain(sha, commits.get(sha), index))
    task.voided = [...voidedAll]
    const tableMerged = MERGED_TEXT.test(statusText)
    const tableCommits = table.commits.filter((sha) => !voidedAll.has(sha)).map((sha) => commitOnMain(sha, commits.get(sha), index))
    let onMain = task.commits.filter((item) => item.state === 'in' || item.state === 'picked')
    let offMain = task.commits.filter((item) => item.state === 'out')
    // 表格写明已合入、且表格引用的提交都在 main 上：认领者交付的提交被重写过也算合入
    if (offMain.length > 0 && tableMerged && tableCommits.length > 0 && tableCommits.every((item) => item.state === 'in' || item.state === 'picked')) {
      onMain = [...onMain, ...tableCommits]
      task.commits = [...task.commits, ...tableCommits]
      offMain = []
    }
    const reverted = task.commits.filter((item) => item.state === 'reverted')
    // 只认认领之后 main 上的提交（认领目录建立时间）；没有认领信息就不限
    const mention = mentionedOnMain(id, index, Number.isFinite(claim?.claimedAt) ? claim.claimedAt - 3600_000 : 0)
    const textMerged = tableMerged || MERGED_TEXT.test(claim?.done?.split('\n').filter(Boolean).at(-1) ?? '')
    const holderInfo = claim?.holder === undefined ? undefined : holders.get(claim.holder)
    if (holderInfo?.contextTokens !== undefined) task.holderTokens = holderInfo.contextTokens
    if (claim?.abandoned !== undefined || (ABANDON_TEXT.test(statusText) && claim?.done === undefined)) {
      task.state = 'abandoned'
      task.why = clip(claim?.abandoned ?? statusText, 120)
    } else if (reverted.length > 0) {
      task.state = 'abandoned'
      task.why = `提交在 main 上已被 revert（${reverted.map((item) => item.sha).join('、')}）`
    } else if (claim?.done !== undefined || (claim === undefined && (textMerged || task.commits.length > 0))) {
      if (task.commits.length > 0 && offMain.length === 0 && onMain.length > 0) {
        task.state = 'merged'
        task.why = onMain.map((item) => item.state === 'picked' ? `${item.sha}→${item.as}` : item.sha).join(' ')
      } else if (onMain.length > 0 && offMain.length > 0) {
        task.state = textMerged ? 'merged' : 'partial'
        task.why = `在 main：${onMain.map((item) => item.sha).join(' ')}；不在：${offMain.map((item) => item.sha).join(' ')}`
      } else if (offMain.length > 0) {
        task.state = mention !== undefined ? 'likely' : 'queued'
        task.why = mention !== undefined ? `main 上 ${formatTime(mention.time)} 有提交提到 ${id}：「${clip(mention.subject, 50)}」，但交付提交 ${offMain.map((item) => item.sha).join(' ')} 对不上，请核对` : `${offMain.map((item) => item.sha).join(' ')} 还不在 origin/main`
      } else if (textMerged) {
        task.state = 'merged'
        task.why = '文字写明已合入（没有可核对的提交号）'
      } else {
        task.state = mention !== undefined ? 'likely' : 'queued'
        task.why = mention !== undefined ? `main 上有提交提到 ${id}：「${clip(mention.subject, 50)}」` : '已写完成，但没有可核对的提交号'
      }
    } else if (claim !== undefined) {
      const verdict = holderVerdict(holderInfo, now)
      task.state = verdict.state === 'unknown' ? 'live' : verdict.state
      task.why = `${claim.holder === undefined ? 'owner 里没有会话 id' : shortId(claim.holder)}：${verdict.why}${claim.chain.length > 1 ? `；已接手 ${claim.chain.length - 1} 次` : ''}`
      if (/待认领|可认领/.test(statusText)) notes.push('表格还写着待认领')
    } else if (/待认领|可认领/.test(statusText) || statusText === '') {
      task.state = 'open'
      task.why = ''
    } else {
      task.state = 'unknown'
      task.why = clip(statusText, 80)
    }
    if (task.state !== 'open' && /待认领|可认领/.test(statusText) && claim !== undefined && !notes.includes('表格还写着待认领')) notes.push('表格还写着待认领')
    // 要不要开新会话做：持有者已死，或者它的上下文已经很大
    const heavy = task.holderTokens !== undefined && task.holderTokens >= heavyTokens
    if (task.state === 'dead' || task.state === 'stale') task.fresh = heavy ? `原会话上下文约 ${Math.round(task.holderTokens / 1000)}k，必须开新会话接手，不要唤醒原会话` : '用新会话接手（/relay takeover 或 claim），不要唤醒原会话'
    else if (task.state === 'live' && heavy) task.fresh = `持有者上下文约 ${Math.round(task.holderTokens / 1000)}k，建议让它停在可交接处，换新会话（/relay takeover）`
    else if (task.state === 'open' && task.bytes > 3000) task.fresh = `详情 ${Math.round(task.bytes / 1024)}KB，用 /relay claim 开新会话做`
    tasks.push(task)
  }
  return tasks
}

// ------------------------------------------------------------------ 渲染

const STATE_ORDER = ['dead', 'stale', 'open', 'live', 'likely', 'partial', 'queued', 'unknown', 'merged', 'abandoned']

function line(task, { brief = false } = {}) {
  const head = `${task.id}${task.priority ? ' ' + task.priority : ''} ${clip(task.title, brief ? 28 : 44)}`
  const why = task.why ? ` · ${clip(task.why, brief ? 70 : 140)}` : ''
  const fresh = task.fresh && !brief ? ` · ⚑ ${task.fresh}` : ''
  const notes = task.notes.length > 0 ? ` · ⚠ ${task.notes.join('，')}` : ''
  return `- ${head}${why}${fresh}${notes}`
}

/**
 * 紧凑报告：先给计数，再按状态分组列出（已合入 / 已放弃只给号，不展开）。
 * @param options - { states?: string[], limit, budget, board, main, archivable }
 */
export function renderTaskReport(tasks, { states, limit = 12, budget = REPORT_BUDGET, board, main, docBytes, sessionNote } = {}) {
  const counts = new Map()
  for (const task of tasks) counts.set(task.state, (counts.get(task.state) ?? 0) + 1)
  const archivable = tasks.filter((task) => ARCHIVABLE.has(task.state) && (task.row !== undefined || task.section !== undefined))
  const archivableBytes = archivable.reduce((sum, task) => sum + task.bytes, 0)
  const lines = [
    `<task-status board="${board ?? ''}">`,
    `看板 ${docBytes === undefined ? '' : `${Math.round(docBytes / 1024)}KB · `}共 ${tasks.length} 个任务；origin/main ${main?.short ?? '未知'}。` + STATE_ORDER.filter((state) => counts.has(state)).map((state) => `${TASK_STATES[state]} ${counts.get(state)}`).join(' · '),
    ...(archivable.length > 0 ? [`可归档 ${archivable.length} 个（约 ${Math.round(archivableBytes / 1024)}KB）：/relay tasks archive 预览，确认后移到 ${ARCHIVE_FILE}。`] : []),
    ...(sessionNote ? [sessionNote] : [])
  ]
  const wanted = states === undefined ? STATE_ORDER : STATE_ORDER.filter((state) => states.includes(state))
  for (const state of wanted) {
    const group = tasks.filter((task) => task.state === state)
    if (group.length === 0) continue
    if ((state === 'merged' || state === 'abandoned') && states === undefined) {
      lines.push(`${TASK_STATES[state]}（${group.length}）：${group.map((task) => task.id).join(' ')}`)
      continue
    }
    lines.push('', `${TASK_STATES[state]}（${group.length}）：`)
    for (const task of group.slice(0, limit)) lines.push(line(task, { brief: state === 'merged' || state === 'abandoned' }))
    if (group.length > limit) lines.push(`…另有 ${group.length - limit} 个（--state ${state} --limit ${group.length} 看全部）`)
  }
  lines.push('单个任务：/relay tasks <号>；状态说明：待合并 = 已写完但交付提交不在 origin/main；疑似已合入 = main 上有提交提到任务号但提交号对不上。', '</task-status>')
  const text = lines.join('\n')
  return Buffer.byteLength(text, 'utf8') <= budget ? text : clipUtf8(text, budget, '\n…（超出预算已截断；用 --state 缩小范围）\n</task-status>')
}

/** 单个任务：表格行、认领链、交付提交逐个核对、详情段大小（不贴全文）。 */
export function renderTaskDetail(task, { budget = REPORT_BUDGET, labelFor = shortId } = {}) {
  const lines = [
    `<task id="${task.id}">`,
    `${task.id}${task.priority ? ' ' + task.priority : ''} ${task.title}`,
    `状态：${TASK_STATES[task.state]}${task.why ? ' · ' + task.why : ''}`,
    ...(task.fresh ? [`⚑ ${task.fresh}`] : []),
    ...(task.notes.length > 0 ? [`⚠ ${task.notes.join('，')}`] : []),
    ...(task.row ? [`表格状态：${clip(task.row.status, 400)}`] : ['表格里没有这一行']),
    ...(task.claim ? [`认领：${task.claim.chain.map((id) => labelFor(id)).join(' → ') || '（owner 无会话 id）'}${task.claim.claimedAt ? ` · ${formatTime(task.claim.claimedAt)}` : ''}${task.holderTokens !== undefined ? ` · 持有者上下文约 ${Math.round(task.holderTokens / 1000)}k` : ''}`] : ['没有认领目录']),
    ...(task.claim?.done ? [`done：${clip(task.claim.done.split('\n').filter(Boolean).at(-1), 300)}${task.claim.done.split('\n').filter(Boolean).length > 1 ? `（共 ${task.claim.done.split('\n').filter(Boolean).length} 段，只显示最后一段）` : ''}`] : []),
    ...(task.claim?.abandoned ? [`abandoned：${clip(task.claim.abandoned, 300)}`] : []),
    ...(task.commits.length > 0 ? ['交付提交：' + task.commits.map((item) => `${item.sha} ${({ in: '在 main', picked: `已挑入 main（${item.as}）`, reverted: '已被 revert', missing: '本机没有', out: '不在 main', unknown: '未核对' })[item.state]}`).join('；')] : []),
    ...(task.voided.length > 0 ? [`标明作废：${task.voided.join(' ')}`] : []),
    ...(task.section ? [`详情段：TASKS.md 第 ${task.section.start + 1}–${task.section.end} 行，约 ${Math.round(task.bytes / 1024 * 10) / 10}KB（需要时再读那几行）`] : []),
    ...(task.claim?.files?.length ? [`认领目录里另有：${task.claim.files.join('、')}`] : []),
    '</task>'
  ]
  const text = lines.join('\n')
  return Buffer.byteLength(text, 'utf8') <= budget ? text : clipUtf8(text, budget, '\n…\n</task>')
}

// ------------------------------------------------------------------ 归档

function planHash(docText, archiveText, ids) {
  return createHash('sha256').update(docText).update('\0').update(archiveText ?? '').update('\0').update(ids.join(',')).digest('hex').slice(0, 12)
}

/**
 * 归档计划（不写文件）。
 * @param ids - 指定任务号；省略时取全部「已合入 / 已放弃」。
 * @returns {{ planId, items: Array<{ id, state, why, bytes, duplicate }>, skipped: Array<{ id, reason }>, beforeBytes, afterBytes, newDoc, archiveAppend }}
 */
export function planArchive({ docText, archiveText = '', tasks, ids, now = Date.now() }) {
  const doc = parseTaskDoc(docText)
  const already = new Set([...String(archiveText).matchAll(ARCHIVED_MARK)].map((match) => match[1]))
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const skipped = []
  let chosen
  if (ids !== undefined && ids.length > 0) {
    chosen = []
    for (const id of ids) {
      const task = byId.get(id)
      if (task === undefined) { skipped.push({ id, reason: '看板里没有' }); continue }
      if (task.state === 'live' || task.state === 'open') { skipped.push({ id, reason: `${TASK_STATES[task.state]}，不能归档` }); continue }
      chosen.push(task)
    }
  } else {
    chosen = tasks.filter((task) => ARCHIVABLE.has(task.state))
  }
  chosen = chosen.filter((task) => doc.rows.some((row) => row.id === task.id) || doc.sections.has(task.id))
  const remove = new Set()
  const items = []
  const blocks = []
  const stamp = new Date(now).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  for (const task of chosen) {
    const rows = doc.rows.filter((row) => row.id === task.id)
    const section = doc.sections.get(task.id)
    for (const row of rows) remove.add(row.line)
    if (section !== undefined) for (let at = section.start; at < section.end; at += 1) remove.add(at)
    const duplicate = already.has(task.id)
    items.push({ id: task.id, state: task.state, why: task.why, bytes: task.bytes, duplicate })
    const body = [
      `<!-- archived:${task.id} ${stamp} -->`,
      section === undefined ? `### ${task.id} ${task.title}`.trimEnd() : doc.lines[section.start],
      '',
      `- 归档：${stamp}，${TASK_STATES[task.state]}${task.why ? '（' + oneLine(task.why) + '）' : ''}${duplicate ? '；此前已归档过，这次是又出现在看板上的重复记录' : ''}`,
      ...rows.map((row) => `- 原表格行：${oneLine(doc.lines[row.line])}`),
      ...(task.claim?.done ? ['- claims done（原文）：', '', '```text', clipUtf8(task.claim.done, 8 * 1024), '```'] : []),
      ...(task.claim?.abandoned ? ['- claims abandoned（原文）：', '', '```text', clipUtf8(task.claim.abandoned, 4 * 1024), '```'] : []),
      ...(section === undefined ? [] : ['', ...doc.lines.slice(section.start + 1, section.end)])
    ]
    blocks.push(body.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd())
  }
  const kept = doc.lines.filter((_, at) => !remove.has(at))
  // 表格下方留一行指引（只留一行，重复归档时替换而不是追加）
  const allArchived = [...new Set([...already, ...items.map((item) => item.id)])].sort((a, b) => Number(/\d+/.exec(a)) - Number(/\d+/.exec(b)))
  const pointer = `> 已归档 ${allArchived.length} 个任务（${clip(allArchived.join(' '), 400)}），详情见同目录 ${ARCHIVE_FILE}；查询状态用 /relay tasks。`
  const existing = kept.findIndex((text) => text.startsWith('> 已归档 ') && text.includes(ARCHIVE_FILE))
  if (items.length > 0) {
    if (existing >= 0) kept[existing] = pointer
    else {
      const tableEnd = (() => {
        const lastRow = Math.max(-1, ...doc.rows.filter((row) => !remove.has(row.line)).map((row) => row.line - [...remove].filter((at) => at < row.line).length))
        return lastRow >= 0 ? lastRow + 1 : kept.findIndex((text) => /^##\s*任务/.test(text)) + 1
      })()
      kept.splice(Math.max(0, tableEnd), 0, '', pointer)
    }
  }
  const newDoc = kept.join('\n').replace(/\n{3,}/g, '\n\n')
  const header = archiveText.trim() === '' ? `# DSHA 任务归档（由 dsh-session-relay 从 TASKS.md 移入；只追加，不进仓库）\n\n` : ''
  const archiveAppend = items.length === 0 ? '' : `${header}${archiveText.trim() === '' ? '' : '\n'}## ${stamp} 归档 ${items.length} 个\n\n${blocks.join('\n\n')}\n`
  const ids2 = items.map((item) => item.id)
  return {
    planId: planHash(docText, archiveText, ids2),
    items, skipped,
    beforeBytes: Buffer.byteLength(docText, 'utf8'),
    afterBytes: Buffer.byteLength(newDoc, 'utf8'),
    newDoc, archiveAppend
  }
}

export function renderArchivePlan(plan, { applied = false, backup, ids } = {}) {
  if (plan.items.length === 0) return ['没有可归档的任务（只归档「已合入」「已放弃 / 作废」的；指定任务号可强制归档其它非进行中的）。', ...plan.skipped.map((item) => `- 跳过 ${item.id}：${item.reason}`)].join('\n')
  const lines = [
    applied ? `已归档 ${plan.items.length} 个任务：TASKS.md ${Math.round(plan.beforeBytes / 1024)}KB → ${Math.round(plan.afterBytes / 1024)}KB；原文已追加到 ${ARCHIVE_FILE}。` : `预览：归档 ${plan.items.length} 个任务，TASKS.md ${Math.round(plan.beforeBytes / 1024)}KB → ${Math.round(plan.afterBytes / 1024)}KB（详情段和表格行原样移到 ${ARCHIVE_FILE}，表格下留一行指引）。`,
    ...plan.items.map((item) => `- ${item.id} ${TASK_STATES[item.state]}${item.why ? ' · ' + clip(item.why, 90) : ''}${item.duplicate ? ' · 归档里已有（重复记录）' : ''}`),
    ...plan.skipped.map((item) => `- 跳过 ${item.id}：${item.reason}`)
  ]
  if (applied) lines.push(`备份：${backup}。要退回就用备份覆盖 TASKS.md，并删掉 ${ARCHIVE_FILE} 末尾这一段。`)
  else lines.push(`确认执行：/relay tasks archive apply ${plan.planId}${ids?.length ? ' ' + ids.join(' ') : ''}（模型用 peer_tasks archive=apply plan_id=${plan.planId}${ids?.length ? ` ids=${ids.join(',')}` : ''}）。预览之后看板被改过会拒绝，重新预览即可。`)
  return lines.join('\n')
}

async function atomicWrite(path, text, mode) {
  const temp = join(dirname(path), `.${basename(path)}.relay-${process.pid}-${Date.now().toString(36)}`)
  await writeFile(temp, text, { mode: mode ?? 0o600, flag: 'wx' })
  try { await rename(temp, path) } catch (error) { await rm(temp, { force: true }).catch(() => {}); throw error }
}

/**
 * 执行归档：先备份 TASKS.md（和归档文件），再写归档文件、再替换 TASKS.md。
 * 校验 planId：从预览到确认之间看板被改过就拒绝。
 */
export async function applyArchive({ boardFile, planId, tasks, ids, now = Date.now() }) {
  const doc = await readBounded(boardFile, MAX_DOC)
  if (doc?.text === undefined) throw new RelayError(doc?.tooLarge ? `看板超过 ${MAX_DOC / 1024 / 1024}MB，请先手工拆分` : '读不到看板', 'board_unreadable')
  const archivePath = join(dirname(boardFile), ARCHIVE_FILE)
  const archive = await readBounded(archivePath, MAX_DOC * 4)
  if (archive?.tooLarge) throw new RelayError(`${ARCHIVE_FILE} 过大，请先手工轮换`, 'archive_too_large')
  const plan = planArchive({ docText: doc.text, archiveText: archive?.text ?? '', tasks, ids, now })
  if (plan.planId !== planId) throw new RelayError('看板在预览之后被改过（或任务状态变了），没有写入；重新执行 /relay tasks archive 预览', 'stale_plan')
  if (plan.items.length === 0) throw new RelayError('没有可归档的任务', 'nothing_to_archive')
  const backups = join(dirname(boardFile), BACKUP_DIR)
  await mkdir(backups, { recursive: true, mode: 0o700 })
  const tag = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')
  const backup = join(backups, `TASKS-${tag}.md`)
  await writeFile(backup, doc.text, { mode: 0o600, flag: 'wx' })
  if (archive?.text !== undefined) await writeFile(join(backups, `TASKS-archive-${tag}.md`), archive.text, { mode: 0o600, flag: 'wx' })
  // 只保留最近 KEEP_BACKUPS 份
  try {
    const names = (await readdir(backups)).filter((name) => /^TASKS-(archive-)?\d{8}T\d{6}Z\.md$/.test(name)).sort()
    for (const prefix of ['TASKS-2', 'TASKS-archive-']) {
      const group = names.filter((name) => name.startsWith(prefix === 'TASKS-2' ? 'TASKS-' : prefix) && (prefix === 'TASKS-2' ? !name.startsWith('TASKS-archive-') : true))
      for (const name of group.slice(0, Math.max(0, group.length - KEEP_BACKUPS))) await rm(join(backups, name), { force: true })
    }
  } catch {}
  await atomicWrite(archivePath, (archive?.text ?? '') + plan.archiveAppend, archive?.mode)
  await atomicWrite(boardFile, plan.newDoc, doc.mode)
  return { plan, backup }
}

/** 看板大小（给上下文用的便宜检查：只 stat）。 */
export async function boardSize(file) {
  try { return (await stat(file)).size } catch { return undefined }
}

/** 一个事件序列化后的字符数；拿来给上下文 token 定上限。 */
export function eventChars(event) {
  try { return JSON.stringify(event)?.length ?? 0 } catch { return 0 }
}

/** 一次模型调用 usage 里的上下文 token（输入 + 缓存命中 + 缓存写入，优先 totalTokens）。 */
export function usageTokens(usage) {
  return Number(usage?.totalTokens) || ((Number(usage?.inputTokens) || 0) + (Number(usage?.cacheReadTokens) || 0) + (Number(usage?.cacheWriteTokens) || 0))
}

/**
 * 上下文估算 = 供应商报的 token，但不超过会话至今产生的事件字符数。
 * 有的中转（实测 zdxjl2/gpt-6-astra）报的 prompt_tokens 会是实际请求的数倍：新会话第二步就报 400k–700k，
 * 而整个会话才 14 万字符。窗口里的 token 不可能多于会话产生过的全部字符（实测正常供应商最高约 0.8 token/字符），
 * 所以拿累计字符兜底；字符数未知（undefined）时原样返回。
 */
export function boundContextTokens(reported, chars) {
  if (!(reported > 0)) return undefined
  return Number.isFinite(chars) && chars > 0 ? Math.min(reported, chars) : reported
}

/**
 * 从会话事件里取持有者判断需要的几项：最后一个 turn/end（之后有没有新的用户 / 中继消息）、
 * 最近一次模型调用的上下文 token（见 usageTokens，按 boundContextTokens 以累计字符封顶）。
 */
export function tailFacts(events) {
  let lastEnd
  let lastPromptAt
  let contextTokens
  let lastTime
  let chars = 0
  for (const event of Array.isArray(events) ? events : []) {
    chars += eventChars(event)
    if (Number.isFinite(event?.time)) lastTime = event.time
    if (event?.type === 'turn/end') lastEnd = { kind: event.data?.reason?.kind ?? 'unknown', code: event.data?.reason?.error?.code, at: event.time }
    else if (event?.type === 'user/message') {
      const kind = (event.data?.message ?? event.data)?.source?.kind
      if (kind === 'user' || kind === 'agent-message') lastPromptAt = event.time
    } else if (event?.type === 'assistant/message' || event?.type === 'assistant/attempt') {
      const usage = event.data?.usage ?? [...(event.data?.stream ?? [])].reverse().find((item) => item?.chunk?.type === 'usage')?.chunk?.usage
      const total = boundContextTokens(usageTokens(usage), chars)
      if (total !== undefined) contextTokens = total
    }
  }
  // 出错之后用户又发了消息：会话已经被继续用，不算死
  if (lastEnd !== undefined && lastPromptAt !== undefined && lastPromptAt > lastEnd.at) lastEnd = { ...lastEnd, resumed: true }
  return { lastEnd: lastEnd?.resumed ? undefined : lastEnd, contextTokens, lastTime }
}
