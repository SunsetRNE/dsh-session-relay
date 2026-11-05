/**
 * 任务树（1.9）：父子关系与依赖，存插件任务库旁的 graph.json。
 * markdown 看板继续存任务正文/状态；这里只存结构，避免把树塞进表格。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export class TaskGraph {
  constructor(storeRoot) {
    this.path = join(storeRoot, 'graph.json')
    this.state = { version: 1, tasks: {} }
    this.loaded = false
    this.chain = Promise.resolve()
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'))
      if (parsed !== null && typeof parsed === 'object' && parsed.tasks !== null && typeof parsed.tasks === 'object') {
        this.state = { version: 1, tasks: { ...parsed.tasks } }
      }
    } catch { /* 文件不存在或损坏：从空树开始 */ }
    this.loaded = true
    return this.state
  }

  get(id) {
    return this.state.tasks[id] ?? { parentId: null, dependsOn: [] }
  }

  children(parentId) {
    return Object.entries(this.state.tasks).filter(([, value]) => value?.parentId === parentId).map(([id]) => id).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }

  subtree(id) {
    const out = [id]
    for (let at = 0; at < out.length; at += 1) {
      for (const child of this.children(out[at])) if (!out.includes(child)) out.push(child)
    }
    return out
  }

  async mutate(fn) {
    const runIt = this.chain.then(async () => {
      if (!this.loaded) await this.load()
      const next = { version: 1, tasks: { ...this.state.tasks } }
      const result = fn(next)
      await mkdir(dirname(this.path), { recursive: true }).catch(() => {})
      const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`
      await writeFile(tmp, JSON.stringify(next, null, 2))
      await rename(tmp, this.path).catch(async (error) => { await rm(tmp, { force: true }).catch(() => {}); throw error })
      this.state = next
      return result
    })
    this.chain = runIt.catch(() => {})
    return runIt
  }

  async set(id, { parentId = null, dependsOn = [] } = {}) {
    return this.mutate((next) => { next.tasks[id] = { parentId, dependsOn: [...new Set(dependsOn)] } })
  }

  async remove(ids) {
    return this.mutate((next) => { for (const id of ids ?? []) delete next.tasks[id] })
  }
}
