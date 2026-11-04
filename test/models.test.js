import test from 'node:test'
import assert from 'node:assert/strict'
import { applySessionModel, defaultModelService, modelFromEvents, modelLabel, parseModelSpec, sanitizeModel, withDefaultEffort } from '../lib/models.js'

const catalog = {
  default: { provider: 'a', model: 'm1' },
  groups: [
    { id: 'a', name: 'A', models: [{ id: 'm1' }, { id: 'shared' }, { id: 'r', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }] },
    { id: 'b', name: 'B', models: [{ id: 'shared' }, { id: 'org/model-x' }] }
  ]
}

test('parseModelSpec：provider/model、只写模型名、推理强度、default、歧义与错误', () => {
  assert.deepEqual(parseModelSpec('a/m1', catalog), { provider: 'a', model: 'm1' })
  assert.deepEqual(parseModelSpec('m1', catalog), { provider: 'a', model: 'm1' })
  assert.deepEqual(parseModelSpec('a/r@high', catalog), { provider: 'a', model: 'r', reasoningEffort: 'high' })
  // 模型 id 自己带斜杠：服务商按目录认
  assert.deepEqual(parseModelSpec('b/org/model-x', catalog), { provider: 'b', model: 'org/model-x' })
  assert.deepEqual(parseModelSpec('org/model-x', catalog), { provider: 'b', model: 'org/model-x' })
  assert.equal(parseModelSpec('default', catalog), null)
  assert.throws(() => parseModelSpec('shared', catalog), /多个服务商/)
  assert.throws(() => parseModelSpec('a/nope', catalog), /没有模型 nope/)
  assert.throws(() => parseModelSpec('a/m1@high', catalog), /不支持推理强度/)
  assert.throws(() => parseModelSpec('a/r@max', catalog), /只能是 low \/ high/)
  assert.throws(() => parseModelSpec('', catalog), /需要模型/)
})

test('modelFromEvents：取最后的请求头，之后的 model/selection 优先；适配器默认的强度不算', () => {
  assert.equal(modelFromEvents([]), undefined)
  const header = (config, adapterDefaults) => ({ type: 'request/header', data: { header: { config, ...(adapterDefaults ? { adapterDefaults } : {}) } } })
  assert.deepEqual(modelFromEvents([header({ provider: 'a', model: 'r', reasoningEffort: 'low' }, { reasoningEffort: true })]), { provider: 'a', model: 'r' })
  assert.deepEqual(modelFromEvents([header({ provider: 'a', model: 'r', reasoningEffort: 'high' })]), { provider: 'a', model: 'r', reasoningEffort: 'high' })
  assert.deepEqual(modelFromEvents([header({ provider: 'a', model: 'm1' }), { type: 'model/selection', data: { provider: 'b', model: 'shared' } }]), { provider: 'b', model: 'shared' })
  assert.deepEqual(modelFromEvents([{ type: 'model/selection', data: { provider: 'b', model: 'shared' } }, header({ provider: 'a', model: 'm1' })]), { provider: 'a', model: 'm1' })
})

test('withDefaultEffort：和全局默认同一个模型、没写强度时带上默认强度；写了或不同模型不动', () => {
  const base = { provider: 'z', model: 'astra', reasoningEffort: 'max' }
  assert.deepEqual(withDefaultEffort({ provider: 'z', model: 'astra' }, base), { provider: 'z', model: 'astra', reasoningEffort: 'max' })
  assert.deepEqual(withDefaultEffort({ provider: 'z', model: 'astra', reasoningEffort: 'low' }, base), { provider: 'z', model: 'astra', reasoningEffort: 'low' })
  assert.deepEqual(withDefaultEffort({ provider: 'z', model: 'luna' }, base), { provider: 'z', model: 'luna' })
  assert.deepEqual(withDefaultEffort({ provider: 'z', model: 'astra' }, { provider: 'z', model: 'astra' }), { provider: 'z', model: 'astra' })
  assert.deepEqual(withDefaultEffort({ provider: 'z', model: 'astra' }, undefined), { provider: 'z', model: 'astra' })
})

test('sanitizeModel / modelLabel', () => {
  assert.equal(sanitizeModel('default'), undefined)
  assert.equal(sanitizeModel({ provider: 'a/b', model: 'x' }), undefined)
  assert.equal(modelLabel(undefined), '跟随默认')
  assert.equal(modelLabel({ provider: 'a', model: 'r', reasoningEffort: 'high' }), 'a/r@high')
})

test('applySessionModel：恢复原默认并核对；核对不上报错；严格上下文里读不到服务也不抛', async () => {
  let current = { provider: 'a', model: 'm1' }
  let queue = Promise.resolve()
  const defaults = {
    currentSelection: () => ({ ...current }),
    saveSelection: (next) => { const done = queue.then(() => { current = { ...next } }); queue = done.catch(() => {}); return done }
  }
  const ctx = {
    get: (name) => (name === 'agentDefaultModel' ? defaults : undefined),
    sessionController: { selectModel: async (req) => { void defaults.saveSelection(req); return { selected: { provider: req.provider, model: req.model } } } }
  }
  const done = await applySessionModel(ctx, 's1', { provider: 'b', model: 'shared' })
  assert.deepEqual(done.selected, { provider: 'b', model: 'shared' })
  assert.deepEqual(current, { provider: 'a', model: 'm1' })
  // 有人在我们恢复之后又改了默认：如实报错
  const sneaky = { ...ctx, sessionController: { selectModel: async (req) => { void defaults.saveSelection(req); setTimeout(() => {}, 0); return { selected: req } } } }
  const realSave = defaults.saveSelection
  defaults.saveSelection = async (next) => { await realSave(next); current = { provider: 'z', model: 'other' } }
  await assert.rejects(() => applySessionModel(sneaky, 's2', { provider: 'b', model: 'shared' }), /全局默认模型现在是 z\/other/)
  defaults.saveSelection = realSave
  const strict = new Proxy({ get: () => undefined }, { get(target, key) { if (!(key in target)) throw new Error('not injected'); return target[key] } })
  assert.equal(defaultModelService(strict), undefined)
})
