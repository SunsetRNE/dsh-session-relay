/**
 * DSHA 3091 桥：只用来发手机通知。凭据从宿主写入的头文件读取，不进 URL、不进日志。
 */
import { readFile } from 'node:fs/promises'

const HEADERS_FILE = '/root/.dsh/.bridge_headers'
const PORT_FILE = '/root/.dsh/.bridge_port'

async function bridgePort() {
  try {
    const raw = (await readFile(PORT_FILE, 'utf8')).trim()
    if (/^[0-9]{1,5}$/.test(raw)) {
      const port = Number(raw)
      if (port >= 1 && port <= 65535) return port
    }
  } catch {}
  return 3091
}

async function bridgeHeaders() {
  const headers = {}
  const text = await readFile(HEADERS_FILE, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    headers[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  if (Object.keys(headers).length === 0) throw new Error('桥凭据为空')
  return headers
}

export async function bridgeNotify(title, text) {
  const url = new URL(`http://127.0.0.1:${await bridgePort()}/app/notify`)
  url.searchParams.set('title', title)
  url.searchParams.set('text', text)
  const response = await fetch(url, { headers: await bridgeHeaders(), signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`桥返回 HTTP ${response.status}`)
}

/** GET 一个桥端点，返回解析后的 JSON（/app/version 等返回 { result: "KEY=value…" }）。凭据走头，不进 URL。 */
export async function bridgeGet(path) {
  const url = new URL(`http://127.0.0.1:${await bridgePort()}${path}`)
  const response = await fetch(url, { headers: await bridgeHeaders(), signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`桥返回 HTTP ${response.status}`)
  return response.json()
}

export async function bridgePost(path, body) {
  const url = new URL(`http://127.0.0.1:${await bridgePort()}${path}`)
  const response = await fetch(url, { method: 'POST', headers: { ...(await bridgeHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`桥返回 HTTP ${response.status}`)
  return response.json()
}

/** 用户在面板点「登录 GitHub」后打开授权页；只允许 https://github.com/。 */
export async function bridgeOpen(target) {
  if (!/^https:\/\/github\.com\//.test(String(target))) throw new Error('只打开 github.com 的页面')
  const url = new URL(`http://127.0.0.1:${await bridgePort()}/app/open`)
  url.searchParams.set('url', target)
  const response = await fetch(url, { headers: await bridgeHeaders(), signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`桥返回 HTTP ${response.status}`)
}
