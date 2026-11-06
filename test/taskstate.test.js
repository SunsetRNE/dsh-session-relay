/** 任务本地状态：stage / approval 的存取、校验和审批记录。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APPROVALS, STAGES, TaskState, normalizeApproval, normalizeStage } from '../lib/taskstate.js'

test('stage/approval 校验：只认枚举，空值表示清除', () => {
  assert.deepEqual([...STAGES], ['triage', 'ready', 'doing', 'review', 'hold', 'dropped'])
  assert.deepEqual([...APPROVALS], ['pending', 'approved', 'rejected'])
  assert.equal(normalizeStage('review'), 'review')
  assert.equal(normalizeStage(''), undefined)
  assert.throws(() => normalizeStage('nope'), /未知阶段/)
  assert.equal(normalizeApproval('approved'), 'approved')
  assert.throws(() => normalizeApproval('ok'), /未知审批状态/)
})

test('TaskState：按任务号存盘、null 清字段、全空删条目、重开读回', async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-state-'))
  try {
    const state = new TaskState(root)
    await state.load()
    await state.set('t1', { stage: 'review', approval: 'pending' })
    assert.deepEqual(state.get('T1'), { stage: 'review', approval: 'pending' })
    const again = new TaskState(root)
    await again.load()
    assert.deepEqual(again.get('T1'), { stage: 'review', approval: 'pending' })
    await again.set('T1', { approval: 'approved', approvalBy: 'session-x' })
    assert.equal(again.get('T1').approval, 'approved')
    await again.set('T1', { stage: null, approval: null, approvalBy: null })
    assert.deepEqual(again.get('T1'), {})
    const parsed = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'))
    assert.equal(parsed.version, 1)
    assert.deepEqual(parsed.tasks, {})
  } finally { await rm(root, { recursive: true, force: true }) }
})
