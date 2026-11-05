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

export function taskStoreRoot(base, groupKey) {
  return join(base, TASK_STORE_DIR, groupKey)
}

async function isFile(path) {
  try { return (await stat(path)).isFile() } catch { return false }
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
