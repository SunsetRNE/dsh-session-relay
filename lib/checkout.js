/**
 * 会话当前在哪个 checkout、哪个分支、从哪儿分叉（只读）。
 *
 * 目的：官方「更改请求与工作树」（DSH 0.2.2 起）会自动把会话放进新的 git 工作树里，
 * 这时候卡片上如果没有 worker 自己汇报的分支，就看不出它在哪儿干活。这里直接从宿主拿
 * 会话的工作目录（workingDirectory 服务 + 会话对象），再用 git 读分支与分叉点。
 *
 * 成本控制：git 调用按目录缓存 60 秒、最多 256 条；每次看板最多补 16 个会话。
 * 读不到就当没有（工作目录不在 git 里、宿主没有 workingDirectory 服务、会话没加载……），
 * 绝不因为这里失败而让看板报错。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'

export const CHECKOUT_TTL_MS = 60_000
export const CHECKOUT_MAX = 256
export const CHECKOUT_PER_BOARD = 16

function runGit(cwd, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } }, (error, stdout) => {
      resolve(error === null ? String(stdout).trim() : undefined)
    })
  })
}

/** 解析 `git rev-parse --show-toplevel --abbrev-ref HEAD --git-dir --git-common-dir` 的输出。 */
export function parseCheckoutOutput(text, cwd) {
  const lines = String(text ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '')
  if (lines.length < 4) return undefined
  const [root, head, gitDir, commonDir] = lines
  return { path: root === '' ? cwd : root, branch: head === 'HEAD' ? undefined : head, detached: head === 'HEAD', linked: gitDir !== commonDir }
}

/**
 * 读一个目录的 checkout 信息：{ path, branch?, detached, linked, base?, repositoryRoot? }。
 * base 只在它是 linked worktree 时给（HEAD 与默认分支的 merge-base），也就是「从哪儿分叉的」。
 */
export async function checkoutOf(cwd) {
  if (typeof cwd !== 'string' || cwd === '' || !existsSync(cwd)) return undefined
  const raw = await runGit(cwd, ['rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD', '--git-dir', '--git-common-dir'])
  const parsed = parseCheckoutOutput(raw, cwd)
  if (parsed === undefined) return undefined
  if (!parsed.linked) return { ...parsed }
  // linked worktree：分叉点是 HEAD 与默认分支（优先 origin/main）的 merge-base
  for (const base of ['origin/main', 'main']) {
    const mergeBase = await runGit(cwd, ['merge-base', 'HEAD', base])
    if (mergeBase !== undefined && mergeBase !== '') return { ...parsed, base: mergeBase, baseRef: base }
  }
  return { ...parsed }
}

/** 带缓存的读取（按目录）。 */
export function createCheckoutCache({ now = Date.now, ttlMs = CHECKOUT_TTL_MS, max = CHECKOUT_MAX, read = checkoutOf } = {}) {
  const entries = new Map()
  return {
    async get(cwd) {
      if (typeof cwd !== 'string' || cwd === '') return undefined
      const hit = entries.get(cwd)
      if (hit !== undefined && now() - hit.at < ttlMs) return hit.value
      const value = await read(cwd).catch(() => undefined)
      entries.set(cwd, { at: now(), value })
      while (entries.size > max) entries.delete(entries.keys().next().value)
      return value
    },
    clear: () => entries.clear(),
    size: () => entries.size
  }
}

/** 会话当前工作目录：宿主 workingDirectory 服务优先，其次会话对象上的 cwd / directory。 */
export function sessionCwd(ctx, sessionId) {
  try {
    const session = ctx?.sessions?.get?.(sessionId)
    if (session === undefined || session === null) return undefined
    const service = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined
    const fromService = service?.get?.(session)
    if (typeof fromService === 'string' && fromService !== '') return fromService
    for (const key of ['cwd', 'directory', 'workingDirectory']) {
      const value = session[key]
      if (typeof value === 'string' && value !== '') return value
    }
  } catch {}
  return undefined
}
