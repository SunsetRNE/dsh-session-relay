/**
 * 插件任务库（1.8）：任务看板的事实源移到插件数据目录，仓库里的 .agents/TASKS.md
 * 和 .agents/claims 变成只读导出快照。
 *
 * 存储布局（每工作区一份，复用现有 markdown/claims 解析与写操作）：
 *   <插件数据目录>/tasks/<workspace-group>/.agents/TASKS.md
 *   <插件数据目录>/tasks/<workspace-group>/.agents/claims/<号>/{owner,done,abandoned,…}
 *   <插件数据目录>/tasks/<workspace-group>/.agents/TASKS-archive.md
 *   <插件数据目录>/tasks/<workspace-group>/meta.json   { importedAt, sourceFile, exportRoot }
 *
 * 首次访问时从工作区现有的 .agents/TASKS.md + claims 导入；之后只导出、不回读。
 */
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { locateBoard } from './taskboard.js'

export const TASK_STORE_DIR = 'tasks'
export const TASK_STORE_BOARD_DIR = '.agents'
export const COLD_ARCHIVE_FILE = 'tasks-archive.jsonl'

export function taskStoreRoot(base, groupKey) {
  return join(base, TASK_STORE_DIR, groupKey)
}

async function isFile(path) {
  try { return (await stat(path)).isFile() } catch { return false }
}

async function isDir(path) {
  try { return (await stat(path)).isDirectory() } catch { return false }
}

function importStamp(now = Date.now()) {
  return new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')
}

async function readMeta(storeRoot) {
  try { return JSON.parse(await readFile(join(storeRoot, 'meta.json'), 'utf8')) } catch { return undefined }
}

/** 把工作区现有看板导入插件目录；已有插件看板时直接返回。 */
export async function ensureTaskStore({ base, groupKey, workspacePath, start }) {
  const storeRoot = taskStoreRoot(base, groupKey)
  const storeBoard = join(storeRoot, TASK_STORE_BOARD_DIR, 'TASKS.md')
  if (await isFile(storeBoard)) {
    const meta = await readMeta(storeRoot)
    return { storeRoot, exportRoot: meta?.exportRoot ?? workspacePath, imported: false }
  }
  const located = await locateBoard(start ?? workspacePath ?? '')
  if (located === undefined) return undefined
  await mkdir(join(storeRoot, TASK_STORE_BOARD_DIR), { recursive: true })
  await cp(located.file, storeBoard, { preserveTimestamps: true })
  const workspaceBoardDir = dirname(located.file)
  for (const name of ['TASKS-archive.md']) {
    if (await isFile(join(workspaceBoardDir, name))) await cp(join(workspaceBoardDir, name), join(storeRoot, TASK_STORE_BOARD_DIR, name), { preserveTimestamps: true })
  }
  const claims = join(workspaceBoardDir, 'claims')
  try { await cp(claims, join(storeRoot, TASK_STORE_BOARD_DIR, 'claims'), { recursive: true, preserveTimestamps: true }) } catch { /* 没有 claims 目录 */ }
  const exportRoot = located.root
  await writeFile(join(storeRoot, 'meta.json'), JSON.stringify({ importedAt: Date.now(), sourceFile: located.file, exportRoot }, null, 2))
  return { storeRoot, exportRoot, imported: true, sourceFile: located.file }
}

/**
 * 强制重新导入（/relay task import --force）：用工作区导出的看板覆盖插件任务库。
 * 只有用户或主会话能触发；覆盖前把任务库现有的 TASKS.md / TASKS-archive.md / claims 备份到
 * .agents/backups/import/<时间戳>/，备份失败就整体失败，不动任务库。
 * @returns 导入来源、备份路径；来源看板不存在时返回 undefined。
 */
export async function forceImportTaskStore({ storeRoot, exportRoot, now = Date.now() }) {
  const meta = await readMeta(storeRoot)
  const source = meta?.sourceFile ?? join(exportRoot, TASK_STORE_BOARD_DIR, 'TASKS.md')
  if (!(await isFile(source))) return undefined
  const sourceDir = dirname(source)
  const storeDir = join(storeRoot, TASK_STORE_BOARD_DIR)
  const backup = join(storeDir, 'backups', 'import', importStamp(now))
  await mkdir(backup, { recursive: true, mode: 0o700 })
  for (const name of ['TASKS.md', 'TASKS-archive.md']) {
    if (await isFile(join(storeDir, name))) await cp(join(storeDir, name), join(backup, name), { preserveTimestamps: true })
  }
  if (await isDir(join(storeDir, 'claims'))) await cp(join(storeDir, 'claims'), join(backup, 'claims'), { recursive: true, preserveTimestamps: true })
  // 覆盖看板；工作区有归档和认领目录时一并镜像，没有就保留任务库原有的。
  await mkdir(storeDir, { recursive: true })
  await cp(source, join(storeDir, 'TASKS.md'), { preserveTimestamps: true })
  if (await isFile(join(sourceDir, 'TASKS-archive.md'))) await cp(join(sourceDir, 'TASKS-archive.md'), join(storeDir, 'TASKS-archive.md'), { preserveTimestamps: true })
  if (await isDir(join(sourceDir, 'claims'))) {
    await rm(join(storeDir, 'claims'), { recursive: true, force: true })
    await cp(join(sourceDir, 'claims'), join(storeDir, 'claims'), { recursive: true, preserveTimestamps: true })
  }
  await writeFile(join(storeRoot, 'meta.json'), JSON.stringify({
    ...(meta ?? {}), importedAt: now, sourceFile: source, exportRoot, forcedAt: now
  }, null, 2))
  return { source, backup, exportRoot }
}

/**
 * 归档冷存（1.10）：TASKS-archive.md 超过 maxBytes 时，把最老的整段归档移进
 * 任务库内的 tasks-archive.jsonl（一行一个任务/一段），保留最新的若干段。
 * 整段搬迁保证 `## … 归档 N 个` 的计数仍然准确；工作区导出只保留 markdown 快照。
 */
export async function coldStoreArchive({ storeRoot, maxBytes = 1024 * 1024, now = Date.now() }) {
  const dir = join(storeRoot, TASK_STORE_BOARD_DIR)
  const archivePath = join(dir, 'TASKS-archive.md')
  if (!(await isFile(archivePath))) return undefined
  const text = await readFile(archivePath, 'utf8')
  const beforeBytes = Buffer.byteLength(text, 'utf8')
  if (beforeBytes <= maxBytes) return undefined
  const chunks = text.split(/\n(?=##\s)/)
  const header = chunks[0]
  const sections = chunks.slice(1)
  if (sections.length < 2) return undefined
  const size = (value) => Buffer.byteLength(value, 'utf8')
  // 从最新一段往前保留，至少保留最新一段；更老的整段移到冷存。
  let keptBytes = size(header)
  let keepFrom = sections.length
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const sectionBytes = size(sections[index]) + 1
    if (index < sections.length - 1 && keptBytes + sectionBytes > maxBytes) break
    keptBytes += sectionBytes
    keepFrom = index
  }
  if (keepFrom <= 0) return undefined
  const cold = []
  for (const section of sections.slice(0, keepFrom)) {
    const head = /^##\s+(.+?)\s+归档\s+\d+\s+个/.exec(section)
    const archivedAt = head?.[1]?.trim()
    const markers = [...section.matchAll(/<!-- archived:([A-Za-z]*\d+[A-Za-z0-9._-]*)\s+([^>]*)-->/g)]
    if (markers.length === 0) {
      cold.push({ id: null, archivedAt, section: section.trim() })
      continue
    }
    for (let index = 0; index < markers.length; index += 1) {
      const start = markers[index].index
      const end = index + 1 < markers.length ? markers[index + 1].index : section.length
      cold.push({ id: markers[index][1], archivedAt, block: section.slice(start, end).trim() })
    }
  }
  if (cold.length === 0) return undefined
  const coldPath = join(dir, COLD_ARCHIVE_FILE)
  const existing = await readFile(coldPath, 'utf8').catch(() => '')
  const lines = cold.map((item) => JSON.stringify({ ...item, coldAt: now }))
  const coldTmp = `${coldPath}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(coldTmp, `${existing}${existing !== '' && !existing.endsWith('\n') ? '\n' : ''}${lines.join('\n')}\n`, { mode: 0o600 })
  await rename(coldTmp, coldPath)
  const kept = header + sections.slice(keepFrom).map((section) => `\n${section}`).join('')
  const archiveTmp = `${archivePath}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(archiveTmp, kept, { mode: 0o600 })
  await rename(archiveTmp, archivePath)
  return { moved: cold.length, beforeBytes, afterBytes: size(kept), coldFile: coldPath }
}

async function copyAtomic(from, to) {
  await mkdir(dirname(to), { recursive: true })
  const tmp = `${to}.tmp-${process.pid}-${Date.now()}`
  await cp(from, tmp, { force: true })
  await rename(tmp, to)
}

/** 把插件任务库导出到工作区（只读快照）：TASKS.md、claims/、TASKS-archive.md。 */
export async function exportTaskStore({ storeRoot, exportRoot }) {
  if (typeof storeRoot !== 'string' || typeof exportRoot !== 'string') return false
  const storeBoardDir = join(storeRoot, TASK_STORE_BOARD_DIR)
  const board = join(storeBoardDir, 'TASKS.md')
  if (!(await isFile(board))) return false
  const targetDir = join(exportRoot, TASK_STORE_BOARD_DIR)
  await mkdir(targetDir, { recursive: true })
  await copyAtomic(board, join(targetDir, 'TASKS.md'))
  const archive = join(storeBoardDir, 'TASKS-archive.md')
  if (await isFile(archive)) await copyAtomic(archive, join(targetDir, 'TASKS-archive.md'))
  const claims = join(storeBoardDir, 'claims')
  try { await cp(claims, join(targetDir, 'claims'), { recursive: true, force: true }) } catch { /* 没有认领目录 */ }
  return true
}

/** 归档后把认领目录移出活动 claims（保留在 .archived-claims/），并同步删掉工作区导出里的对应目录。 */
export async function retireTaskClaims({ storeRoot, exportRoot, ids }) {
  for (const id of ids ?? []) {
    const from = join(storeRoot, TASK_STORE_BOARD_DIR, 'claims', id)
    const to = join(storeRoot, '.archived-claims', id)
    await mkdir(dirname(to), { recursive: true }).catch(() => {})
    await rename(from, to).catch(() => {})
    if (typeof exportRoot === 'string') await rm(join(exportRoot, TASK_STORE_BOARD_DIR, 'claims', id), { recursive: true, force: true }).catch(() => {})
  }
}

/** 导出快照的展示路径（模型/用户看到的仍是工作区里的 .agents/TASKS.md）。 */
export function exportPaths(exportRoot) {
  return {
    file: join(exportRoot, TASK_STORE_BOARD_DIR, 'TASKS.md'),
    claimsRoot: join(exportRoot, TASK_STORE_BOARD_DIR, 'claims'),
    archiveFile: join(exportRoot, TASK_STORE_BOARD_DIR, 'TASKS-archive.md')
  }
}
