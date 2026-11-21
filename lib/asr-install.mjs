/**
 * Bounded mirror fallback for the optional local faster-whisper environment.
 * A stalled mirror is abandoned; it must not pin the whole installer forever.
 */
export const ASR_INSTALL_TIMEOUT_EXIT_CODE = 124

const FALLBACK_MIRRORS = Object.freeze([
  'https://mirrors.ustc.edu.cn/pypi/simple',
  'https://mirrors.aliyun.com/pypi/simple'
])

export function normalizeAsrMirrors(primary = '') {
  const candidates = [primary, 'https://pypi.tuna.tsinghua.edu.cn/simple', ...FALLBACK_MIRRORS]
  const result = []
  for (const candidate of candidates) {
    let url
    try { url = new URL(String(candidate || '').trim()) } catch { continue }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) continue
    const value = url.href.replace(/\/+$/, '')
    if (!result.includes(value)) result.push(value)
  }
  return result
}

export async function installAsrPythonPackages({
  mirrors = [],
  uvCmd = '',
  python = '',
  packages = [],
  spawnTo,
  sink = () => {},
  idleTimeoutMs = 180_000,
  totalTimeoutMs = 15 * 60_000
} = {}) {
  if (!Array.isArray(mirrors) || !mirrors.length ||
      typeof python !== 'string' || !python ||
      !Array.isArray(packages) || !packages.length ||
      typeof spawnTo !== 'function') {
    throw new TypeError('Invalid ASR package installation request')
  }

  let lastCode = 1
  let lastMirror = ''
  for (const mirror of mirrors) {
    lastMirror = mirror
    sink(`\n—— 镜像：${mirror}\n`)
    const timeout = { sink, idleTimeoutMs, totalTimeoutMs, timeoutAction: '正在终止并切换下一个镜像。' }

    if (uvCmd) {
      const uvArgs = ['pip', 'install', '--python', python, '-i', mirror, ...packages]
      const uvOptions = {...timeout, env: {
        UV_HTTP_TIMEOUT: '20', UV_HTTP_CONNECT_TIMEOUT: '10', UV_HTTP_RETRIES: '1'
      }}
      const uvCode = await spawnTo(uvCmd, uvArgs, uvOptions)
      if (uvCode === 0) return { ok: true, code: 0, mirror, runner: 'uv' }
      if (uvCode === ASR_INSTALL_TIMEOUT_EXIT_CODE) {
        lastCode = uvCode
        sink('uv 安装长时间没有下载进展，已终止当前进程并切换下一个镜像；不会继续等待当前镜像。\n')
        continue
      }
      sink(`uv 安装失败（exit ${uvCode}），在同一镜像尝试 pip 备用入口。\n`)
      lastCode = uvCode
    }

    const pipArgs = ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input',
      '--timeout', '20', '--retries', '1', '-i', mirror, ...packages]
    const pipCode = await spawnTo(python, pipArgs, timeout)
    if (pipCode === 0) return { ok: true, code: 0, mirror, runner: 'pip' }
    lastCode = pipCode
    if (pipCode === ASR_INSTALL_TIMEOUT_EXIT_CODE) {
      sink('pip 安装长时间没有下载进展，已终止当前进程并切换下一个镜像。\n')
    } else {
      sink(`pip 安装失败（exit ${pipCode}），尝试下一个镜像。\n`)
    }
  }
  return { ok: false, code: lastCode, mirror: lastMirror }
}
