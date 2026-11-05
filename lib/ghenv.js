/**
 * gh 调用用的环境变量（本机 gh 入口 + DSHA 壳）。
 *
 * DSHA 的 gh 入口（/root/dsh-bin/gh）用 DSHA_GH_HOST_ROOT 拼 CA 包路径：
 *   $ROOT_HOST/usr/local/share/dsha/ca-certificates.crt，找不到才退回系统 CA 包。
 * 0.2.2-rc.1 起这个根目录是 /data/user/0/<包名>/files/linux/ubuntu，而它下面没有
 * usr/local/share/dsha/（Ubuntu 真身在 /data/data/<包名>/files/linux/ubuntu 那一份），
 * 于是 gh 改用旧的系统 CA 包去校验 api.github.com，报
 * `x509: certificate signed by unknown authority` —— 身份探测、CI 核验、登录全挂，
 * 报错还说“token 无效”，很容易误判成需要重新登录。
 *
 * 这里只在探测到这种情况时补一个 DSHA_GH_CA 指向真身那一份；用户或壳已经设了
 * DSHA_GH_CA、或者路径本来就正常时不动。DSHA 修好后这里自动失效，不需要改回来。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const CA_REL = 'usr/local/share/dsha/ca-certificates.crt'
const BASE = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' }
let resolved

/**
 * 算出补丁（默认只算一次）：{ DSHA_GH_CA } 或 {}。
 * exists 可注入，测试用自己的存在性判断，不碰真实文件系统。
 */
export function ghCaOverride(env = process.env, exists = existsSync) {
  if (exists === existsSync && resolved !== undefined) return resolved
  const patch = {}
  try {
    const root = env.DSHA_GH_HOST_ROOT
    if (typeof root !== 'string' || root === '' || env.DSHA_GH_CA !== undefined) return patch
    if (exists(join(root, CA_REL))) return patch
    // Android 上 /data/user/0/<包名> 与 /data/data/<包名> 是同一份数据的两个视图；
    // 这份 rootfs 只有在 /data/data 视图里才带着 DSHA 的 CA 包。
    const alias = root.replace('/data/user/0/', '/data/data/')
    if (alias !== root && exists(join(alias, CA_REL))) patch.DSHA_GH_CA = join(alias, CA_REL)
  } catch {}
  if (exists === existsSync) resolved = patch
  return patch
}

/** 给 gh 子进程用的环境变量。 */
export function ghEnv(env = process.env) {
  const override = ghCaOverride(env)
  return override.DSHA_GH_CA === undefined ? { ...env, ...BASE } : { ...env, ...BASE, ...override }
}

/** 测试用：清掉缓存。 */
export function resetGhEnvCache() {
  resolved = undefined
}
