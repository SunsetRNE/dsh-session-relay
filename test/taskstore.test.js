/** 任务库（1.10）：归档冷存按整段搬迁，保留最新段，旧的写 tasks-archive.jsonl。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { coldStoreArchive } from '../lib/taskstore.js'

function section(id, stamp) {
  return `## ${stamp} 归档 1 个\n\n<!-- archived:${id} ${stamp} -->\n### ${id} 任务${id}\n\n- 归档：${stamp}，已合入\n${'x'.repeat(200)}\n`
}

test('归档冷存：超过上限时最老的整段移入 tasks-archive.jsonl，保留最新段', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-cold-'))
  try {
    const storeRoot = join(root, 'store')
    const dir = join(storeRoot, '.agents')
    await mkdir(dir, { recursive: true })
    const text = `# DSHA 任务归档（测试）\n\n${section('T1', '2026-11-01 10:00 UTC')}${section('T2', '2026-11-02 10:00 UTC')}${section('T3', '2026-11-03 10:00 UTC')}`
    await writeFile(join(dir, 'TASKS-archive.md'), text)

    const cold = await coldStoreArchive({ storeRoot, maxBytes: 500, now: 1_700_000_000_000 })
    assert.ok(cold !== undefined)
    assert.equal(cold.moved, 2)
    assert.ok(cold.afterBytes <= 500)

    const kept = await readFile(join(dir, 'TASKS-archive.md'), 'utf8')
    assert.match(kept, /T3/)
    assert.doesNotMatch(kept, /T1|T2/)
    const lines = (await readFile(join(dir, 'tasks-archive.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(lines.map((item) => item.id), ['T1', 'T2'])
    assert.match(lines[0].block, /^<!-- archived:T1 /)
    assert.ok(lines.every((item) => item.coldAt === 1_700_000_000_000))

    // 再调一次：已在上限内，不动
    assert.equal(await coldStoreArchive({ storeRoot, maxBytes: 500 }), undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('归档冷存：只有一段或文件不存在时不动', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-cold-'))
  try {
    const storeRoot = join(root, 'store')
    const dir = join(storeRoot, '.agents')
    await mkdir(dir, { recursive: true })
    assert.equal(await coldStoreArchive({ storeRoot, maxBytes: 10 }), undefined)
    await writeFile(join(dir, 'TASKS-archive.md'), `# 归档\n\n${section('T1', '2026-11-01 10:00 UTC')}`)
    assert.equal(await coldStoreArchive({ storeRoot, maxBytes: 10 }), undefined)
    assert.match(await readFile(join(dir, 'TASKS-archive.md'), 'utf8'), /T1/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
