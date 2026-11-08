/**
 * 发布状态卡（设置页「发布」区）的只读事实整理。
 *
 * 这里只有纯函数：版本号推进、阶段条、发版清单命令。真正的 git / gh / 文件读取在 impl.js 里做，
 * 读失败原样带 reason 回来，界面显示「未知」而不是猜。UI 不执行 push / tag / Release / install。
 */

/** '2.4.2' → { major, minor, patch }；不合法返回 undefined。 */
export function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(text ?? '').trim())
  if (match === null) return undefined
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined
  return { major, minor, patch }
}

/** 下一个 patch 版本：2.4.2 → 2.4.3；解析失败返回 undefined。 */
export function bumpPatch(version) {
  const parsed = parseVersion(version)
  if (parsed === undefined) return undefined
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
}

/**
 * 当前 package.json 版本对应的 tag 是否已存在，以及「随哪个版本发布」。
 * - tag 不存在：package.json 已经 bump 到待发版本 → 随 v<version> 发布；
 * - tag 已存在（这个版本已发布）：下一个补丁版本 → 随 v<version+1> 发布。
 */
export function nextReleaseVersion({ version, tags = [] } = {}) {
  const clean = String(version ?? '').trim()
  const tagList = (Array.isArray(tags) ? tags : []).map((item) => String(item ?? '').trim()).filter(Boolean)
  const versionTag = clean === '' ? '' : `v${clean}`
  const tagExists = versionTag !== '' && tagList.includes(versionTag)
  const next = clean === '' ? undefined : (tagExists ? bumpPatch(clean) : clean)
  return {
    version: clean === '' ? undefined : clean,
    tag: versionTag === '' ? undefined : versionTag,
    tagExists,
    nextVersion: next,
    nextTag: next === undefined ? undefined : `v${next}`
  }
}

function stage(key, state) {
  return { key, state }
}

/**
 * 阶段条：准备 → 测试 → 打包 → 已 push → tag → Release → 市场。
 * 每个阶段只报事实或「未知 / 需要本地做」，不把读不到的东西写成完成；文案在客户端按 i18n 渲染。
 */
export function releaseStages(facts = {}) {
  const prepared = facts.prepared
  const release = facts.release ?? { state: 'unknown' }
  const stages = []
  stages.push(stage('prepare', prepared === undefined || prepared === null ? 'unknown' : (prepared.changelog && prepared.notes ? 'done' : 'pending')))
  // 测试没有落盘结果：面板不假装知道，只说明测试要在本地串行跑
  stages.push(stage('test', 'unknown'))
  stages.push(stage('pack', facts.packed ? 'done' : 'pending'))
  stages.push(stage('push', facts.pushed === true ? 'done' : facts.pushed === false ? 'pending' : 'unknown'))
  stages.push(stage('tag', facts.tagExists ? 'done' : 'pending'))
  stages.push(stage('release', release.state === 'ready' ? 'done' : release.state === 'missing' ? 'pending' : 'unknown'))
  stages.push(stage('market', 'unknown'))
  return stages
}

/** 「复制发版清单命令」的内容：只复制命令，不在面板里执行。 */
export function releaseCommand({ version } = {}) {
  const clean = String(version ?? '').trim()
  const v = clean === '' ? 'vX.Y.Z' : `v${clean}`
  const file = clean === '' ? 'dsh-session-relay-X.Y.Z.tgz' : `dsh-session-relay-${clean}.tgz`
  const notes = clean === '' ? 'docs/release-notes-X.Y.Z.md' : `docs/release-notes-${clean}.md`
  return [
    'node --test --test-concurrency=1 test/*.test.js',
    'npm pack --pack-destination dist',
    `git tag ${v} <发版提交>`,
    `gh release create ${v} dist/${file} --title ${v} --notes-file ${notes}`
  ].join('\n')
}
