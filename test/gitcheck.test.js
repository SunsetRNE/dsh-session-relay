/** 排号前只读 git 核对：用临时仓库（本地 bare 作 origin）验证，确认不写原仓库。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../lib/gitcheck.js'
import { scanWorkspace, reconcile, describeDeclarations, declarationSummaryLine, declaredPaths } from '../lib/declarations.js'

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false']
const run = (cwd, ...args) => git(cwd, [...ID, ...args])
const S = 'aaaaaaaa-0000-0000-0000-000000000001'

async function repo() {
  const base = await mkdtemp(join(tmpdir(), 'relay-git-'))
  const origin = join(base, 'origin.git')
  const root = join(base, 'work')
  await git(base, ['init', '-q', '--bare', '-b', 'main', origin])
  await git(base, ['init', '-q', '-b', 'main', root])
  await mkdir(join(root, 'ci'), { recursive: true }); await mkdir(join(root, 'tools'), { recursive: true }); await mkdir(join(root, 'app/src/main/java/x'), { recursive: true })
  await writeFile(join(root, 'ci/release-identity.json'), JSON.stringify({ versionCode: 293 }))
  await writeFile(join(root, 'tools/java-format-files.json'), JSON.stringify({ files: [] }))
  await writeFile(join(root, 'shared.txt'), 'base\n')
  await run(root, 'add', '-A'); await run(root, 'commit', '-qm', 'base')
  await git(root, ['remote', 'add', 'origin', origin]); await git(root, ['push', '-q', 'origin', 'main'])
  // 发布 tag 打在 base（build292），之后 main 前进到 build293 但未发布
  await run(root, 'tag', '-a', 'dsha-a-su-build292-20261103-073000', '-m', 'r')
  await run(root, 'tag', 'unrelated-v9')
  const wt = (name) => join(root, '.agents/worktrees/fix', name)
  const branch = async (name, edit) => {
    await git(root, ['worktree', 'add', '-q', '-b', `fix/${name}`, wt(name), 'origin/main'])
    await edit(wt(name)); await run(wt(name), 'add', '-A'); await run(wt(name), 'commit', '-qm', name)
    return (await git(wt(name), ['rev-parse', 'HEAD'])).stdout.trim()
  }
  const declare = (name, merge, extra = '') => writeFile(join(wt(name), '.SESSION-DONE'), `状态：已结束\n分支：fix/${name}\n会话：session-${S}\n合并：${merge}\n当前阶段：lintStandardRelease、check-ui-i18n、format-java 通过\n${extra}`)
  // 干净可合并
  const clean = await branch('clean', (dir) => writeFile(join(dir, 'a.txt'), 'a\n'))
  await declare('clean', `可合并（已提交 ${clean.slice(0, 8)}）`)
  // 冲突 + 未登记 java + 之后又提交 + 未提交改动
  const messy = await branch('messy', async (dir) => { await writeFile(join(dir, 'shared.txt'), 'messy\n'); await mkdir(join(dir, 'app/src/main/java/x'), { recursive: true }); await writeFile(join(dir, 'app/src/main/java/x/New.java'), 'class New {}\n') })
  await writeFile(join(wt('messy'), 'later.txt'), 'later\n'); await run(wt('messy'), 'add', '-A'); await run(wt('messy'), 'commit', '-qm', 'later')
  await writeFile(join(wt('messy'), 'shared.txt'), 'dirty\n')
  await declare('messy', `可合并（已提交 ${messy.slice(0, 8)}）`)
  // 待推送但已 cherry-pick 进 main
  const picked = await branch('picked', (dir) => writeFile(join(dir, 'p.txt'), 'p\n'))
  await declare('picked', `可合并（已提交 ${picked.slice(0, 8)}）`, `待推送 build294（${picked.slice(0, 8)}）\n`)
  await writeFile(join(root, 'shared.txt'), 'main moved\n')
  await run(root, 'add', '-A'); await run(root, 'commit', '-qm', 'main moves')
  await run(root, 'cherry-pick', picked)
  await git(root, ['push', '-q', 'origin', 'main']); await git(root, ['fetch', '-q', 'origin'])
  return { base, root, clean, messy, picked }
}

test('git 核对：HEAD 不符、未提交、冲突、未登记 java、等价补丁已在 main，且不写对象库', async () => {
  const r = await repo()
  try {
    const before = (await readdir(join(r.root, '.git/objects'))).length
    const scan = await scanWorkspace(r.root, { git: true, gitMemo: new Map() })
    assert.equal(scan.git.main.build, 'build293')
    const clean = scan.git.checks['.agents/worktrees/fix/clean']
    assert.equal(clean.commitMatches, true); assert.equal(clean.dirty, 0); assert.deepEqual(clean.conflicts, []); assert.equal(clean.behind, 2)
    const messy = scan.git.checks['.agents/worktrees/fix/messy']
    assert.equal(messy.commitMatches, false)
    assert.equal(messy.dirty, 1)
    assert.deepEqual(messy.conflicts, ['shared.txt'])
    assert.deepEqual(messy.unregisteredJava, ['app/src/main/java/x/New.java'])
    assert.equal(scan.git.checks['.agents/worktrees/fix/picked'].equivalentInMain, true)
    const view = reconcile(scan, {}, new Set([`session-${S}`]))
    // 已进 main，但「待推送 build294」还没发布（本机只有 build292 的 tag）：先不提示补「已合入」
    assert.deepEqual(view.landed.map((d) => d.rel), [])
    assert.deepEqual(view.inMainUnreleased.map((d) => d.rel), ['.agents/worktrees/fix/picked'])
    // 发布到 build294 后才可以补
    const releasedScan = { ...scan, git: { ...scan.git, main: { ...scan.git.main, released: { build: 'build294', tag: 't', commit: 'c' } } } }
    assert.deepEqual(reconcile(releasedScan, {}, new Set()).landed.map((d) => d.rel), ['.agents/worktrees/fix/picked'])
    const text = describeDeclarations(view, { labelFor: (id) => id, root: r.root })
    assert.match(text, /main 已到：build293（origin\/main [0-9a-f]{8}/)
    assert.match(text, /已发布：build292（tag dsha-a-su-build292-20261103-073000，[0-9a-f]{8}；来源：本机 tag）；build293 已进 main、本机未见发布 tag/)
    assert.equal(scan.git.main.released.build, 'build292')
    assert.match(text, /HEAD [0-9a-f]{8} ≠ 声明提交/)
    assert.match(text, /合并到 origin\/main 冲突涉及源码，要人看：shared\.txt/)
    assert.match(text, /未登记 tools\/java-format-files\.json：app\/src\/main\/java\/x\/New\.java/)
    assert.match(text, /等价补丁已在 origin\/main/)
    const summary = declarationSummaryLine(view, (id) => id)
    assert.match(summary, /已进 main 未发布 1/)
    // 摘要直接带分支和原因
    assert.match(summary, /排号核对有问题 1：fix\/messy（合并冲突 shared\.txt）/)
    // 补丁不等价但 build 号已到：归入“待人工核对”
    const fake = { ...scan, declarations: scan.declarations.map((d) => d.rel.endsWith('clean') ? { ...d, merge: 'pending', build: 'build290' } : d) }
    assert.deepEqual(reconcile(fake, {}, new Set()).maybeLanded.map((d) => d.rel), ['.agents/worktrees/fix/clean'])
    // merge-tree 的对象写在临时目录：原仓库对象目录数不变
    assert.equal((await readdir(join(r.root, '.git/objects'))).length, before)
  } finally { await rm(r.base, { recursive: true, force: true }) }
})

test('declaredPaths：去通配与注记，跳过省略号和单段路径', () => {
  assert.deepEqual(declaredPaths('docs/design/x/**、app/.../nethealth/**、util/NetworkHealthPolicy(+Test)、tools/i18n/messages-extra.json、MainActivity.java'),
    ['docs/design/x', 'util/NetworkHealthPolicy', 'tools/i18n/messages-extra.json'])
})

test('releasedText：没有 tag、已发布等于 main、号段', async () => {
  const { releasedText } = await import('../lib/declarations.js')
  assert.match(releasedText({ build: 'build294' }), /本机没有发布 tag/)
  assert.doesNotMatch(releasedText({ build: 'build292', released: { build: 'build292', tag: 't', commit: 'c' } }), /已进 main/)
  assert.match(releasedText({ build: 'build295', released: { build: 'build292', tag: 't', commit: 'c' } }), /build293–295 已进 main/)
})

test('远端发布 tag：以 GitHub 为准；提交本机没有时按号判断；失败退回本机并注明；缓存', async () => {
  const { RemoteTags, mainInfo } = await import('../lib/gitcheck.js')
  const { releasedText } = await import('../lib/declarations.js')
  const r = await repo()
  try {
    const head = (await git(r.root, ['rev-parse', 'origin/main'])).stdout.trim()
    let calls = 0
    const remote = new RemoteTags({ list: async () => { calls += 1; return [
      `${'1'.repeat(40)}\trefs/tags/dsha-a-su-build293-x`, `${head}\trefs/tags/dsha-a-su-build293-x^{}`,
      `${'2'.repeat(40)}\trefs/tags/dsha-a-su-build299-future`, 'junk'
    ].join('\n') } })
    const main = await mainInfo(r.root, { remoteTags: remote })
    assert.equal(main.released.build, 'build293')
    assert.equal(main.released.source, 'remote')
    assert.match(releasedText(main), /已发布：build293（.*来源：GitHub 发布 tag/)
    assert.doesNotMatch(releasedText(main), /已进 main/)
    await mainInfo(r.root, { remoteTags: remote })
    assert.equal(calls, 1)
    const failing = new RemoteTags({ list: async () => { throw new Error('超时') } })
    const fallback = await mainInfo(r.root, { remoteTags: failing })
    assert.equal(fallback.released.build, 'build292')
    assert.match(releasedText(fallback), /GitHub 未确认：超时/)
  } finally { await rm(r.base, { recursive: true, force: true }) }
})

test('冲突分档、--plan 只跑审过的脚本、登记过期', async () => {
  const { checkProblems, conflictTiers, checkSummary } = await import('../lib/declarations.js')
  const { formatPlan, checkBackground } = await import('../lib/gitcheck.js')
  const onlyDescriptor = { rel: 'x', head: 'a', commitMatches: true, dirty: 0, conflicts: ['app/src/main/assets/runtime-descriptor.json'] }
  assert.deepEqual(conflictTiers(onlyDescriptor).regenerable, ['app/src/main/assets/runtime-descriptor.json'])
  assert.deepEqual(checkProblems(onlyDescriptor), [])
  const mixed = { ...onlyDescriptor, conflicts: [...onlyDescriptor.conflicts, 'app/A.java'] }
  assert.match(checkProblems(mixed)[0], /涉及源码，要人看：app\/A\.java（另有可重算的/)
  assert.equal(checkSummary(mixed), '合并冲突 A.java')
  assert.match(checkProblems({ ...onlyDescriptor, formatPlan: { missing: 2, extra: 0 } })[0], /missing 2/)
  // 没审过的脚本不执行
  const dir = await mkdtemp(join(tmpdir(), 'relay-plan-'))
  try {
    await mkdir(join(dir, 'tools'), { recursive: true })
    await writeFile(join(dir, 'tools/format-java-tree.py'), 'open("PWNED", "w").write("x")\n')
    const result = await formatPlan(dir)
    assert.match(result.skipped, /没审核过不执行/)
    await assert.rejects(readdir(join(dir, 'PWNED')))
    assert.deepEqual((await readdir(dir)).sort(), ['tools'])
  } finally { await rm(dir, { recursive: true, force: true }) }
  const stale = await checkBackground({ rel: 'r', background: 'chain15.sh（pid 1999999）→ /nonexistent/x.log' })
  assert.equal(stale.stale, true)
  const closed = await checkBackground({ rel: 'r', background: 'chain15.sh（pid 1999999）已结束，退出码 0' })
  assert.equal(closed.stale, false)
})
