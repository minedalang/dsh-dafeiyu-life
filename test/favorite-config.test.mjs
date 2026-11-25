import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const backend = readFileSync(join(root, 'index.js'), 'utf8')
const frontend = readFileSync(join(root, 'client.js'), 'utf8')

test('favFolderId is included in the /config POST accepted-field list', () => {
  const route = backend.slice(backend.indexOf("path === '/api/bili-duty/config')", backend.indexOf("path === '/api/bili-duty/status')")))
  const list = route.match(/for \(const k of \[([\s\S]*?)\]\) \{/)
  assert.ok(list, 'config route accepted fields array must be found')
  assert.match(list[1], /'favFolderId'/)
})

test('favorite selection is validated against server response before success', () => {
  assert.match(frontend, /Object\.prototype\.hasOwnProperty\.call\(p, 'favFolderId'\)/)
  assert.match(frontend, /savedFid !== wantedFid/)
})

test('v2.4.84 removes mass backfill and provides opt-in AI-controlled actions', () => {
  assert.match(frontend, /允许大肥鱼自己决定点赞/)
  assert.match(frontend, /允许大肥鱼自己建夹、选择性收藏/)
  assert.match(backend, /整轮批量收藏已经取消/)
  assert.doesNotMatch(backend, /favToday\('auto'\)/)
})

// 真走宿主 HTTP 路由，避免配置项已在 schema/clampPatch 定义但忘加到 POST 白名单。
test('POST /config persists selected favorite folder and allows clearing it', async () => {
  const { apply } = await import('../index.js')
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { Readable } = await import('node:stream')
  const home = mkdtempSync(join(tmpdir(), 'bili-favorite-route-'))
  let route
  const ctx = {
    get(key) { return key === 'dshHomePath' ? (...parts) => join(home, ...parts) : undefined },
    logger: { info() {}, warn() {} },
    tools: { register() {} },
    connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer: { register(spec) { route = spec; return { dispose() {} } } },
    effect(callback) { return callback() },
    settings: { describe() { return [] } },
    slots: { inject() {}, register() {} },
  }
  try {
    apply(ctx, {})
    assert.ok(route?.handler, 'HTTP handler was not registered')
    async function save(fid) {
      const req = Readable.from([Buffer.from(JSON.stringify({ favFolderId: fid }))])
      req.method = 'POST'
      req.url = '/api/bili-duty/config'
      req.headers = { host: 'localhost' }
      let code = 0, result
      const res = { writeHead(c) { code = c }, end(body) { result = JSON.parse(body) } }
      await route.handler(req, res)
      assert.equal(code, 200)
      assert.equal(result.config.favFolderId, fid)
      const saved = JSON.parse(readFileSync(join(home, 'bili-duty', 'config.json'), 'utf8'))
      assert.equal(saved.favFolderId, fid)
      assert.ok(saved._set.includes('favFolderId'))
    }
    await save(123456)
    await save(0)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
