/** 任务看板：定位、解析、认领目录对照、上下文注入。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boardContext, locateBoard, parseBoard, scanBoard } from '../lib/taskboard.js'

const BOARD = `# 看板

## 拉起会话用的一句话

\`\`\`text
读 TASKS.md，按「认领规则」认领一个任务。
\`\`\`

## 认领规则

1. mkdir claims/<任务号>

| 号 | 优先 | 任务 | 工作树 | 需要构建 | 状态 |
|---|---|---|---|---|---|
| T1 | P0 | 已完成的 | a | 是 | 已合入 build1 |
| T2 | P1 | 待认领的 | b | 是 | 待认领（立项） |
| T3 | P2 | 写着可认领但已被认领 | c | 否 | 可认领：规格见 x |
| T4 | P1 | 进行中 | d | 是 | 进行中 |

### T1 细节
| 不是 | 任务表 |
`

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'relay-board-'))
  await mkdir(join(root, '.agents/claims/T3'), { recursive: true })
  await mkdir(join(root, '.agents/claims/T4'), { recursive: true })
  await mkdir(join(root, '.agents/worktrees/fix/x/app'), { recursive: true })
  await writeFile(join(root, '.agents/TASKS.md'), BOARD)
  return root
}

test('parseBoard：只读第一张任务表，按表头取列，带出一句话与认领规则', () => {
  const parsed = parseBoard(BOARD)
  assert.deepEqual(parsed.rows.map((row) => row.id), ['T1', 'T2', 'T3', 'T4'])
  assert.equal(parsed.rows[1].title, '待认领的')
  assert.equal(parsed.hasClaimRules, true)
  assert.match(parsed.launchLine, /认领规则/)
})

test('scanBoard：从工作树目录往上找到；待认领以认领目录为准；上下文含路径', async () => {
  const root = await fixture()
  try {
    assert.equal((await locateBoard(join(root, '.agents/worktrees/fix/x/app'))).root, root)
    const board = await scanBoard(join(root, '.agents/worktrees/fix/x'))
    assert.deepEqual(board.open.map((row) => row.id), ['T2'])
    assert.deepEqual(board.claimed.map((row) => row.id), ['T3', 'T4'])
    const text = boardContext(board)
    assert.match(text, new RegExp(`任务看板就在 ${join(root, '.agents/TASKS.md').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.match(text, /待认领 1.*\n- T2 P1 待认领的/)
    assert.match(text, /只有用户让你认领/)
    assert.equal(await scanBoard(tmpdir()), undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})
