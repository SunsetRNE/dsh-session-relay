/**
 * 内置技能 provider（Deck 式：技能随插件包提供，不要求用户手装）。
 *
 * - 目录：`<包根>/bundled-skills/<技能名>/SKILL.md`（package.json 的 files 已包含）；
 * - 注册：`ctx.inject(['skills'], ...)` 里调 `registerBundledSkills(skillsService)`；
 *   宿主没有 skills 服务时这里安静返回 undefined，不影响插件其它功能；
 * - 技能内容按需读盘，改 SKILL.md 不需要重新注册（宿主缓存会按 skills/change 或下次查询失效）。
 *
 * 与宿主 `dsh-skill-filesystem` 的约定对齐：候选带 name / description / whenToUse /
 * invocation / source / provider / rank / locator / resourceBase / path；get() 返回完整正文。
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUNDLED_SKILL_PROVIDER, BUNDLED_SKILL_RANK, BUNDLED_SKILL_SOURCE, parseSkillFrontmatter, readSkillCatalog } from './ticket-cockpit.js'

/** 包根下的 bundled-skills（本模块在 lib/ 里；测试 / 直接 import 时也成立）。 */
export function defaultBundledSkillsDir() {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), '..', 'bundled-skills')
  } catch {
    return undefined
  }
}

/**
 * 构造只读 provider。list() 每个目录读一次 SKILL.md 的 frontmatter；get() 再读正文。
 * 读不到目录 / 单个坏文件都只跳过，不抛错（宿主会记录 provider 警告，不影响其它技能）。
 */
export function createBundledProvider({ dir = defaultBundledSkillsDir(), providerName = BUNDLED_SKILL_PROVIDER, rank = BUNDLED_SKILL_RANK } = {}) {
  return {
    name: providerName,
    async list(options) {
      options?.signal?.throwIfAborted?.()
      const rows = await readSkillCatalog(dir)
      options?.signal?.throwIfAborted?.()
      return rows.map((row) => ({
        name: row.name,
        description: row.description,
        ...(row.whenToUse === undefined ? {} : { whenToUse: row.whenToUse }),
        invocation: { modelInvocable: true, userInvocable: true },
        source: BUNDLED_SKILL_SOURCE,
        provider: providerName,
        rank,
        locator: { path: row.path, directory: dirname(row.path) },
        resourceBase: { kind: 'directory', path: dirname(row.path) },
        path: row.path
      }))
    },
    async get(candidate, options) {
      options?.signal?.throwIfAborted?.()
      const file = candidate?.locator?.path ?? candidate?.path
      if (typeof file !== 'string' || file === '') return undefined
      let raw
      try {
        raw = await readFile(file, 'utf8')
      } catch {
        return undefined
      }
      options?.signal?.throwIfAborted?.()
      const parsed = parseSkillFrontmatter(raw)
      if (parsed === undefined || parsed.name !== candidate?.name) return undefined
      const directory = dirname(file)
      return {
        name: parsed.name,
        description: parsed.description,
        ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
        invocation: parsed.invocation,
        source: BUNDLED_SKILL_SOURCE,
        provider: providerName,
        resourceBase: { kind: 'directory', path: directory },
        path: file,
        content: parsed.content
      }
    }
  }
}

/**
 * 注册随包技能。host 可以是 skills 服务本身，也可以是带 `.skills` 的上下文。
 * 没有 skills 服务 / 没有 registerProvider / 注册抛错都安静返回 undefined。
 * @returns skills.registerProvider 给的 disposer（宿主接管），或 undefined
 */
export function registerBundledSkills(host, { dir, providerName, rank } = {}) {
  try {
    const skills = host !== null && typeof host === 'object' && typeof host.registerProvider === 'function' ? host : host?.skills
    if (skills === null || skills === undefined || typeof skills.registerProvider !== 'function') return undefined
    const provider = createBundledProvider({ dir, providerName, rank })
    return skills.registerProvider(() => provider)
  } catch {
    return undefined
  }
}
