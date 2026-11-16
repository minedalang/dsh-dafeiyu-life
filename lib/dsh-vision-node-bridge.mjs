/**
 * Narrow Windows Desktop CLI bridge for the Python vision wrapper.
 * Python -> node.exe -> Electron Desktop Host CLI (spawn, shell:false).
 * A JSON packet arrives over stdin; neither the model prompt nor credentials
 * appear in the bridge command line or persistent files.
 * This is NOT a generic subprocess runner.
 */
import { spawn } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const inTree = (parent, target) => {
  const rel = relative(parent, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..\\`) && !rel.startsWith('../') && !isAbsolute(rel)
}
const pathEq = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

export function validateVisionBridgePacket(packet, env = process.env) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw Error('bad_packet')
  const { exe, argv, cwd, timeoutMs } = packet
  const home = String(env.BILI_DUTY_HOME || '')
  if (typeof exe !== 'string' || !isAbsolute(exe) || basename(exe).toLowerCase() !== 'deepseek harness.exe') throw Error('bad_executable')
  if (!existsSync(exe)) throw Error('missing_executable')
  const root = dirname(exe)
  const asar = join(root, 'resources', 'app.asar')
  const expected = join(asar, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  if (!existsSync(asar)) throw Error('missing_desktop_bundle')
  if (!Array.isArray(argv) || argv.length < 5 || argv.length > 10 || argv.some(a => typeof a !== 'string' || a.length > 24000)) throw Error('bad_arguments')
  if (argv[0] !== '--expose-internals' || !pathEq(argv[1], expected) || argv[2] !== '--profile' || argv[3] !== 'headless') throw Error('not_desktop_host')
  if (!isAbsolute(home) || typeof cwd !== 'string' || !isAbsolute(cwd)) throw Error('bad_workdir')
  const hostCwd = String(env.BILI_VISION_DSH_WORKDIR || '')
  if (!pathEq(cwd, home) && (!isAbsolute(hostCwd) || !pathEq(cwd, hostCwd))) throw Error('untrusted_workdir')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 240000) throw Error('bad_timeout')
  const tail = argv.slice(4)
  let patch = ''
  if (tail[0] === '--patch') {
    patch = tail[1]
    if (typeof patch !== 'string' || !isAbsolute(patch) || !inTree(home, patch) || !patch.toLowerCase().endsWith('.yml')) throw Error('bad_patch')
    try { if (!lstatSync(patch).isFile()) throw Error('bad_patch_file') } catch { throw Error('bad_patch_file') }
    tail.splice(0, 2)
  }
  const dump = tail.length === 1 && (tail[0] === '--dump-config' || tail[0] === '--dump-default-config')
  const run = patch && tail.length === 1 && tail[0].length > 0 && !tail[0].startsWith('--') && tail[0].length <= 24000
  if (!dump && !run) throw Error('bad_operation')
  if (dump && tail[0] === '--dump-config' && !patch && argv.includes('--patch')) throw Error('bad_dump')
  return { exe, argv, cwd, timeoutMs }
}

export async function launchVisionBridge(packet, env = process.env) {
  const { exe, argv, cwd, timeoutMs } = validateVisionBridgePacket(packet, env)
  return await new Promise(resolveDone => {
    let finished = false
    let bytesOut = 0, bytesErr = 0
    let child
    const finish = (code, why = '') => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (why) process.stderr.write(`dsh_bridge_${why}\n`)
      resolveDone(code)
    }
    try {
      child = spawn(exe, argv, { cwd, env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, shell: false,
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch { return resolveDone(122) }
    const timer = setTimeout(() => { try { child.kill() } catch {} finish(124, 'timeout') }, timeoutMs)
    const feed = (chunk, output, isErr) => {
      if (finished) return
      if (isErr) bytesErr += chunk.length
      else bytesOut += chunk.length
      if (bytesOut > 8000000 || bytesErr > 1000000) {
        try { child.kill() } catch {}
        return finish(125, 'output_limit')
      }
      output.write(chunk)
    }
    child.stdout?.on('data', chunk => feed(chunk, process.stdout, false))
    child.stderr?.on('data', chunk => feed(chunk, process.stderr, true))
    child.on('error', () => finish(122, 'launch_error'))
    child.on('close', code => finish(Number.isInteger(code) ? code : 123, ''))
  })
}

async function main() {
  // Never accept arguments containing model prompts, commands or secrets.
  if (process.argv.length > 2) process.exit(126)
  let input = '', tooLarge = false
  for await (const chunk of process.stdin) {
    input += chunk.toString('utf8')
    if (Buffer.byteLength(input, 'utf8') > 65000) { tooLarge = true; break }
  }
  if (tooLarge) process.exit(126)
  let packet
  try { packet = JSON.parse(input) } catch { process.exit(126) }
  try { process.exitCode = await launchVisionBridge(packet) }
  catch { process.stderr.write('dsh_bridge_invalid_packet\n'); process.exitCode = 126 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
