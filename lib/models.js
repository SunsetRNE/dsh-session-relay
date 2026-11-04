/**
 * 新建会话指定模型（0.19.0）。
 *
 * DSH 的 sessionController.create 不收模型；能给单个会话设模型的只有 selectModel，
 * 而它会顺手（后台、不等待）把这次选择存成全局默认模型。这里的做法：
 *   1. 调 selectModel 前读 agentDefaultModel.currentSelection() 记下原默认；
 *   2. selectModel 之后立即 saveSelection(原默认)：默认模型的保存按提交顺序串行，
 *      我们这次一定排在 selectModel 的那次之后，最后落盘的是原默认；
 *   3. 再读一次核对；对不上就报错（会话已建好，只是默认模型被改了，提示用户去改回）。
 * 读不到 agentDefaultModel 服务时不调 selectModel（宁可不设模型，也不悄悄改全局默认）。
 *
 * 选择的表示：{ provider, model, reasoningEffort? }；undefined 表示「跟随默认」。
 */
import { RelayError } from './core.js'

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,159}$/
const EFFORT_RE = /^[A-Za-z0-9._-]{1,32}$/

/** 规范化一个模型选择；不合法返回 undefined。'default' / null / '' 也是 undefined（跟随默认）。 */
export function sanitizeModel(value) {
  if (value === undefined || value === null || value === '' || value === 'default') return undefined
  if (typeof value !== 'object') return undefined
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (!ID_RE.test(provider) || provider.includes('/') || !ID_RE.test(model)) return undefined
  const effort = typeof value.reasoningEffort === 'string' ? value.reasoningEffort.trim() : ''
  return { provider, model, ...(effort !== '' && EFFORT_RE.test(effort) ? { reasoningEffort: effort } : {}) }
}

export function sameModel(a, b) {
  return a?.provider === b?.provider && a?.model === b?.model && (a?.reasoningEffort ?? undefined) === (b?.reasoningEffort ?? undefined)
}

/** 显示用：provider/model@effort。 */
export function modelLabel(selection) {
  const clean = sanitizeModel(selection)
  if (clean === undefined) return '跟随默认'
  return `${clean.provider}/${clean.model}${clean.reasoningEffort ? '@' + clean.reasoningEffort : ''}`
}

/**
 * 解析命令行写法：provider/model[@effort]，或只写 model[@effort]（在目录里唯一时）；default 表示跟随默认。
 * @param catalog - sessionController.modelCatalog() 的结果；没有时只接受完整的 provider/model
 * @returns 选择对象；'default' 返回 null
 */
export function parseModelSpec(spec, catalog) {
  const text = String(spec ?? '').trim()
  if (text === '') throw new RelayError('需要模型：provider/model[@推理强度]，或 default', 'bad_model')
  if (text === 'default' || text === '默认') return null
  const at = text.lastIndexOf('@')
  const head = at > 0 ? text.slice(0, at) : text
  const effort = at > 0 ? text.slice(at + 1) : undefined
  const slash = head.indexOf('/')
  const groups = catalog?.groups ?? []
  let provider
  let model
  if (slash > 0 && (catalog === undefined || groups.some((group) => group.id === head.slice(0, slash)))) {
    provider = head.slice(0, slash)
    model = head.slice(slash + 1)
  } else {
    const hits = groups.flatMap((group) => group.models.filter((item) => item.id === head).map(() => group.id))
    if (hits.length === 0) throw new RelayError(`找不到模型 ${head}${groups.length > 0 ? '（写成 provider/model；可用的服务商：' + groups.map((group) => group.id).join('、') + '）' : ''}`, 'unknown_model')
    if (hits.length > 1) throw new RelayError(`模型 ${head} 在多个服务商下都有（${hits.join('、')}），请写成 provider/model`, 'ambiguous_model')
    provider = hits[0]
    model = head
  }
  const selection = sanitizeModel({ provider, model, reasoningEffort: effort })
  if (selection === undefined || (effort !== undefined && selection.reasoningEffort === undefined)) throw new RelayError(`模型写法不对：${text}`, 'bad_model')
  return validateAgainstCatalog(selection, catalog)
}

/** 有目录时核对服务商、模型、推理强度都在目录里；没有目录时原样返回（由 DSH 的 selectModel 最终校验）。 */
export function validateAgainstCatalog(selection, catalog) {
  if (catalog === undefined || selection === undefined) return selection
  const group = (catalog.groups ?? []).find((item) => item.id === selection.provider)
  if (group === undefined) throw new RelayError(`服务商 ${selection.provider} 现在不可用`, 'unknown_model')
  const model = group.models.find((item) => item.id === selection.model)
  if (model === undefined) throw new RelayError(`服务商 ${selection.provider} 下没有模型 ${selection.model}`, 'unknown_model')
  if (selection.reasoningEffort !== undefined) {
    const efforts = model.reasoning?.efforts?.map((item) => item.id) ?? []
    if (!efforts.includes(selection.reasoningEffort)) {
      throw new RelayError(efforts.length === 0 ? `模型 ${selection.model} 不支持推理强度` : `模型 ${selection.model} 的推理强度只能是 ${efforts.join(' / ')}`, 'bad_effort')
    }
  }
  return selection
}

/**
 * 从会话事件里取当前模型：最后一个 request/header 的 config，之后若有 model/selection（下一次请求起生效的选择）以它为准。
 * 没有任何请求、也没选过模型的空白会话返回 undefined（它会用当时的默认模型）。
 */
export function modelFromEvents(events) {
  let found
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'request/header') {
      const config = event.data?.header?.config
      if (typeof config?.provider === 'string' && typeof config?.model === 'string') {
        const adapterDefault = event.data?.header?.adapterDefaults?.reasoningEffort === true
        found = { provider: config.provider, model: config.model, ...(config.reasoningEffort !== undefined && !adapterDefault ? { reasoningEffort: String(config.reasoningEffort) } : {}) }
      }
    } else if (event?.type === 'model/selection') {
      const picked = sanitizeModel(event.data)
      if (picked !== undefined) found = picked
    }
  }
  return found
}

/** 从活会话对象取当前模型：先看事件快照（含之后的 model/selection），没有再看 requestHeader()。 */
export function modelOfSession(session) {
  if (session === undefined) return undefined
  let events
  try { events = session.snapshotEvents?.() } catch {}
  const fromEvents = modelFromEvents(events)
  if (fromEvents !== undefined) return fromEvents
  try {
    const config = session.requestHeader?.()?.config
    if (typeof config?.provider === 'string' && typeof config?.model === 'string') return { provider: config.provider, model: config.model, ...(config.reasoningEffort !== undefined ? { reasoningEffort: String(config.reasoningEffort) } : {}) }
  } catch {}
  return undefined
}

/** 取 DSH 的默认模型服务（cordis ctx.get；老版本直接挂在 ctx 上）。 */
export function defaultModelService(ctx) {
  let service
  try { service = ctx?.get?.('agentDefaultModel') } catch {}
  // 严格注入的上下文直接读未注入属性会抛错
  if (service === undefined) { try { service = ctx?.agentDefaultModel } catch {} }
  return typeof service?.currentSelection === 'function' && typeof service?.saveSelection === 'function' ? service : undefined
}

/**
 * 给一个会话设模型，并保证全局默认模型不变。
 * @returns { selected, restored: boolean } selected 是 DSH 规范化后的选择
 */
export async function applySessionModel(ctx, sessionId, selection) {
  const clean = sanitizeModel(selection)
  if (clean === undefined) return { selected: undefined, restored: false }
  const controller = ctx?.sessionController
  if (typeof controller?.selectModel !== 'function') throw new RelayError('这个 DSH 版本不支持给会话设模型（没有 sessionController.selectModel）', 'model_unsupported')
  const defaults = defaultModelService(ctx)
  if (defaults === undefined) throw new RelayError('读不到 DSH 的默认模型服务：为免改动全局默认模型，没有给新会话设模型（会话已按默认模型建好）', 'model_default_unavailable')
  const original = defaults.currentSelection()
  const done = await controller.selectModel({ sessionId, provider: clean.provider, model: clean.model, ...(clean.reasoningEffort === undefined ? {} : { reasoningEffort: clean.reasoningEffort }) })
  const selected = sanitizeModel(done?.selected) ?? clean
  // selectModel 已在后台排队保存「本会话的选择」为默认；我们的保存排在它后面，最后落盘的是原默认
  try {
    await defaults.saveSelection(original)
  } catch (error) {
    throw new RelayError(`会话已设为 ${modelLabel(selected)}，但恢复全局默认模型失败（${error?.message ?? error}）：请在 DSH 设置里把默认模型改回 ${modelLabel(original)}`, 'model_default_restore_failed')
  }
  const now = defaults.currentSelection()
  if (!sameModel(sanitizeModel(now), sanitizeModel(original))) {
    throw new RelayError(`会话已设为 ${modelLabel(selected)}，但全局默认模型现在是 ${modelLabel(now)}（原来是 ${modelLabel(original)}）：请在 DSH 设置里改回`, 'model_default_changed')
  }
  return { selected, restored: true }
}

/**
 * 选的模型和 DSH 全局默认是同一个、又没写推理强度时，带上全局默认的推理强度
 * （否则请求不带强度，会落到服务商默认，和「默认模型」的行为不一致）。
 */
export function withDefaultEffort(selection, globalDefault) {
  const clean = sanitizeModel(selection)
  const base = sanitizeModel(globalDefault)
  if (clean === undefined || clean.reasoningEffort !== undefined || base?.reasoningEffort === undefined) return clean
  if (clean.provider !== base.provider || clean.model !== base.model) return clean
  return { ...clean, reasoningEffort: base.reasoningEffort }
}

/** 精简目录给面板：服务商分组、模型 id/名称、推理强度、默认。 */
export function compactCatalog(catalog) {
  if (catalog === undefined) return undefined
  return {
    default: sanitizeModel(catalog.default) ?? null,
    groups: (catalog.groups ?? []).map((group) => ({
      id: group.id, name: group.name,
      models: (group.models ?? []).map((model) => ({
        id: model.id, name: model.name,
        ...(model.reasoning === undefined ? {} : { efforts: (model.reasoning.efforts ?? []).map((effort) => ({ id: effort.id, name: effort.name })), defaultEffort: model.reasoning.defaultEffort ?? null })
      }))
    })),
    failures: (catalog.failures ?? []).map((item) => ({ id: item.id, name: item.name }))
  }
}
