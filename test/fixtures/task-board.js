/** 测试用任务看板：临时 git 仓库（带 origin/main）+ .agents/TASKS.md + claims。 */
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim()

async function commit(dir, file, subject, when) {
  await writeFile(join(dir, file), subject + '\n')
  g(dir, 'add', file)
  execFileSync('git', ['commit', '-q', '-m', subject], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_AUTHOR_DATE: `${when} +0000`, GIT_COMMITTER_DATE: `${when} +0000` } })
  return g(dir, 'rev-parse', 'HEAD')
}

/**
 * 仓库：main 上 base → A(T1) → picked(同主题 B') → mentions T5；分支 feature 上 B（主题与 B' 相同）、C（不在 main）。
 */
export async function fixture(at) {
  const dir = at ?? await mkdtemp(join(tmpdir(), 'relay-tasks-'))
  g(dir, 'init', '-q', '-b', 'main')
  const base = await commit(dir, 'a', 'base', '2026-01-01T00:00:00')
  g(dir, 'checkout', '-q', '-b', 'feature')
  const b = await commit(dir, 'b', 'fix: picked later', '2026-01-02T00:00:00')
  const c = await commit(dir, 'c', 'feat: still pending', '2026-01-02T01:00:00')
  const v = await commit(dir, 'v', 'feat: voided attempt', '2026-01-02T02:00:00')
  g(dir, 'checkout', '-q', 'main')
  const a = await commit(dir, 'a2', 'feat: task one', '2026-01-03T00:00:00')
  await commit(dir, 'b2', 'fix: picked later', '2026-01-03T01:00:00')
  await commit(dir, 'r', 'chore(release): build9 includes T5 follow-up', '2026-01-03T02:00:00')
  g(dir, 'update-ref', 'refs/remotes/origin/main', 'main')
  const board = join(dir, '.agents')
  await mkdir(join(board, 'claims'), { recursive: true })
  const doc = [
    '# 看板', '', '## 认领规则', '', '1. mkdir', '', '## 任务', '',
    '| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |',
    '|---|---|---|---|---|---|',
    `| T1 | P0 | 任务一 | a | 是 | 已合入 build2（${a.slice(0, 8)}） |`,
    `| T2 | P1 | 任务二 | b | 是 | 已完成：${b.slice(0, 8)} 可合并（基于 ${base.slice(0, 8)}） |`,
    '| T3 | P1 | 任务三 | c | 是 | 待认领 |',
    '| T4 | P2 | 任务四 | d | 是 | 待认领 |',
    `| T5 | P2 | 任务五 | e | 是 | 已完成：${c.slice(0, 8)} 可合并 |`,
    '| T6 | P2 | 任务六 | f | 否 | 待认领 |',
    `| T7 | P3 | 任务七 | g | 否 | 已完成：${c.slice(0, 8)} 可合并 |`,
    '| T7 | P3 | 任务七重复 | g | 否 | 待认领 |',
    '',
    '### T1 任务一详情', '', '- 过程记录 1', '- 过程记录 2', '',
    '### T3 任务三详情', '', '- 要做的事', '',
    '### T5 任务五详情', '', '- 很长的记录', ''
  ].join('\n')
  await writeFile(join(board, 'TASKS.md'), doc)
  const claim = async (id, owner, extra = {}) => {
    await mkdir(join(board, 'claims', id))
    await writeFile(join(board, 'claims', id, 'owner'), owner)
    for (const [name, text] of Object.entries(extra)) await writeFile(join(board, 'claims', id, name), text)
    // 认领时间设在 main 上那几个提交之前（真实场景：先认领，之后才发布）
    const claimed = new Date('2026-01-01T12:00:00Z')
    await utimes(join(board, 'claims', id, 'owner'), claimed, claimed)
  }
  await claim('T1', 'session-11111111-0000-0000-0000-000000000001\n2026-01-01 UTC\n', { done: `${a.slice(0, 8)} 可合并` })
  await claim('T2', 'session-22222222-0000-0000-0000-000000000002\n', { done: `${b.slice(0, 8)} 可合并（基于 ${base.slice(0, 8)}）\n旧 ${v.slice(0, 8)} 作废勿合` })
  await claim('T3', 'session-33333333-0000-0000-0000-000000000003\n接手 session-44444444-0000-0000-0000-000000000004 2026-01-02 UTC\n')
  await claim('T4', 'session-55555555-0000-0000-0000-000000000005\n')
  await claim('T5', 'session-66666666-0000-0000-0000-000000000006\n', { done: `${c.slice(0, 8)} 可合并` })
  await claim('T6', 'session-77777777-0000-0000-0000-000000000007\n', { abandoned: '用户决定不做了' })
  return { dir, board, file: join(board, 'TASKS.md'), a, b, c, v, base, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

