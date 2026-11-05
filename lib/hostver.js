/**
 * 宿主 DSH 版本，以及「这个版本支持哪些新东西」。
 *
 * 从 1.1.0 起插件只支持 DSH 0.2.2-rc.1 及以上（engines.dsh 同步收紧）：
 * 官方「更改请求与工作树」（forge）在 0.2.2 才有，声明外置、工作树分支自动识别这类
 * 新功能都以它为前提。更老的宿主不再保证可用，也不再作为兼容基准维护。
 *
 * 这里只做「读版本 + 比较」，不拦加载：老宿主上插件仍尽力工作，只是把依赖 0.2.2 的
 * 提示与整段功能降级，不报错、不假装支持。
 */
import { createRequire } from 'node:module'

/** 第一个带官方工作树的版本。 */
export const FORGE_SINCE = '0.2.2-rc.1'

const require = createRequire(import.meta.url)

/** 宿主版本字符串；先问 dsh 本体，再问同批发布的工具包，都拿不到就当未知。 */
export function hostVersion() {
  for (const spec of ['@deepseek-ai/dsh/package.json', '@deepseek-ai/dsh-tools/package.json']) {
    try {
      const version = require(spec)?.version
      if (typeof version === 'string' && version !== '') return version
    } catch {}
  }
  return undefined
}

/** 拆出 [major, minor, patch, prerelease[]]；不合法返回 undefined。 */
export function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(text ?? '').trim())
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? [] : match[4].split('.')]
}

/** semver 口径的比较：a >= b 返回 true；任一不可解析时返回 undefined（调用方自己决定怎么降级）。 */
export function atLeast(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === undefined || right === undefined) return undefined
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index]
  }
  // 有预发布标记的小于同号正式版；都有时按段比较（数字比字符串小）
  const [leftPre, rightPre] = [left[3], right[3]]
  if (leftPre.length === 0 || rightPre.length === 0) return leftPre.length === 0 && rightPre.length === 0 ? true : leftPre.length === 0
  for (let index = 0; index < Math.max(leftPre.length, rightPre.length); index += 1) {
    const one = leftPre[index]
    const two = rightPre[index]
    if (one === undefined) return false
    if (two === undefined) return true
    const oneNumber = /^\d+$/.test(one)
    const twoNumber = /^\d+$/.test(two)
    if (oneNumber && twoNumber) { if (Number(one) !== Number(two)) return Number(one) > Number(two); continue }
    if (oneNumber !== twoNumber) return oneNumber
    if (one !== two) return one > two
  }
  return true
}

/** 当前宿主是否支持官方工作树（forge）。版本未知时按不支持处理，避免给出假提示。 */
export function forgeWorktreesSupported(version = hostVersion()) {
  return atLeast(version, FORGE_SINCE) === true
}
