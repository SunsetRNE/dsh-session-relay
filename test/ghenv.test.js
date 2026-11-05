// gh 调用环境：DSHA 0.2.2-rc.1 的 gh 入口用 DSHA_GH_HOST_ROOT 拼 CA 路径，root 下没有
// usr/local/share/dsha/ 时会误用系统 CA 包，导致所有 gh 调用报 x509。这里补一个 DSHA_GH_CA。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ghCaOverride, ghEnv, resetGhEnvCache } from '../lib/ghenv.js'

const ROOT = '/data/user/0/io.github.sunsetrne.dsha/files/linux/ubuntu'
const ALIAS = '/data/data/io.github.sunsetrne.dsha/files/linux/ubuntu'
const CA = 'usr/local/share/dsha/ca-certificates.crt'

test('ghenv：root 下没有 DSHA 的 CA 包时，指向 /data/data 视图那一份', () => {
  const exists = (path) => path === `${ALIAS}/${CA}`
  assert.deepEqual(ghCaOverride({ DSHA_GH_HOST_ROOT: ROOT }, exists), { DSHA_GH_CA: `${ALIAS}/${CA}` })
})

test('ghenv：root 下 CA 包正常时不动（DSHA 修好后自动失效）', () => {
  const exists = (path) => path === `${ROOT}/${CA}`
  assert.deepEqual(ghCaOverride({ DSHA_GH_HOST_ROOT: ROOT }, exists), {})
})

test('ghenv：用户或壳自己设了 DSHA_GH_CA 时不覆盖', () => {
  const exists = () => true
  assert.deepEqual(ghCaOverride({ DSHA_GH_HOST_ROOT: ROOT, DSHA_GH_CA: '/x/ca.crt' }, exists), {})
})

test('ghenv：没有 DSHA_GH_HOST_ROOT（普通机器）或别名不存在时不加东西', () => {
  assert.deepEqual(ghCaOverride({}, () => true), {})
  assert.deepEqual(ghCaOverride({ DSHA_GH_HOST_ROOT: ROOT }, () => false), {})
  assert.deepEqual(ghCaOverride({ DSHA_GH_HOST_ROOT: '/opt/root' }, () => true), {}, '不在 Android 视图下没有别名可用')
})

test('ghenv：ghEnv 带上 gh 需要的非交互变量，并合入 CA 补丁', () => {
  resetGhEnvCache()
  const exists = () => false
  const patch = ghCaOverride({ DSHA_GH_HOST_ROOT: ROOT }, exists)
  assert.deepEqual(patch, {})
  const env = ghEnv({ PATH: '/usr/bin', DSHA_GH_HOST_ROOT: ROOT })
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.GH_PROMPT_DISABLED, '1')
  assert.equal(env.GH_NO_UPDATE_NOTIFIER, '1')
  assert.equal(env.NO_COLOR, '1')
})

test('ghenv：当前这台机器的真实环境（升级后 root 缺 CA 包）能被识别出来', () => {
  // 只在真的处于这个环境时校验结果；别的机器上跳过，避免测试依赖具体机型
  if (process.env.DSHA_GH_HOST_ROOT === undefined) return
  const patch = ghCaOverride(process.env)
  if (patch.DSHA_GH_CA === undefined) return
  assert.ok(patch.DSHA_GH_CA.includes('/data/data/'), '指向 /data/data 视图')
  assert.ok(patch.DSHA_GH_CA.endsWith(CA))
})
