import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, mkdtempSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {runInNewContext} from 'node:vm'
import {apply} from '../index.js'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
// Exercise the real button handler without loading the entire React/settings host.
const start = source.indexOf('      const onOpenManage = async (tab = \'\') => {')
const end = source.indexOf('\n\n      const patch = async (p, what) => {', start)
assert.ok(start > 0 && end > start, 'management handler exists')
const handlerSource = source.slice(start, end)
function browser({userAgent = 'Android', protocol = 'https:', fetchImpl, postImpl, maxTouchPoints = 0, innerWidth = 1024} = {}) {
  const navigated = [], errors = [], posts = [], requests = []
  const window = {navigator: {userAgent, maxTouchPoints}, innerWidth, location: {protocol, assign(url) {navigated.push(url)}}}
  const fetch = async (...args) => {requests.push(args); return fetchImpl?.(...args)}
  const jpost = async (...args) => {posts.push(args); return postImpl?.(...args)}
  const openManage = runInNewContext(handlerSource + '\nonOpenManage', {
    window, fetch, jpost, setManageError: text => errors.push(text), say() {},
  })
  return {openManage, navigated, errors, posts, requests}
}

test('安卓 HTTPS 同源入口：由当前 WebView 打开，不触发后台系统浏览器', async () => {
  const app = browser({fetchImpl: () => ({ok: true, headers: {get: name => name === 'content-type' ? 'text/html; charset=utf-8' : name === 'x-dafeiyu-management' ? '1' : ''}})})
  await app.openManage('firststart')
  assert.deepEqual(app.navigated, ['/api/bili-duty/manage?tab=firststart'])
  assert.equal(app.posts.length, 0)
  assert.equal(app.requests.length, 1)
  assert.equal(app.requests[0][1].credentials, 'same-origin')
  assert.equal(app.requests[0][1].redirect, 'follow')
  assert.equal(app.errors.at(-1), "")
})

test('安卓远程网关拒绝管理页时，留在设置页并显示安全原因', async () => {
  const app = browser({fetchImpl: () => ({ok: false, status: 403})})
  await app.openManage()
  assert.deepEqual(app.navigated, [])
  assert.match(app.errors.at(-1), /HTTP 403/)
  assert.match(app.errors.at(-1), /不要直接将电脑本机 DSH 端口暴露到公网/)
  assert.equal(app.posts.length, 0)
})

test('DSH Mobile 只使用当前已配对网关路径：私有 scheme 不能跳到手机的 127.0.0.1', async () => {
  const app = browser({protocol: 'dsh:'})
  await app.openManage()
  assert.deepEqual(app.navigated, [])
  assert.equal(app.posts.length, 0)
  assert.match(app.errors.at(-1), /不是 DSH Mobile 的 HTTP\(S\) 配对页面/)
})

test('DSH Mobile 响应 200 但跳转到了登录 HTML 时拒绝静默导航', async () => {
  const app = browser({fetchImpl: () => ({ok: true, headers: {get: () => 'text/html'}, text: async () => '<html><title>重新登录</title></html>'})})
  await app.openManage()
  assert.deepEqual(app.navigated, [])
  assert.match(app.errors.at(-1), /不是大肥鱼管理中心/)
})

test('网关剥离非必要自定义响应头时，通过管理页标记确认，不将 HTML 误当登录页', async () => {
  const app = browser({fetchImpl: () => ({ok: true, headers: {get: name => name === 'content-type' ? 'text/html' : ''}, text: async () => '<meta name="dafeiyu-management" content="1">很长的管理中心页面'})})
  await app.openManage('models')
  assert.deepEqual(app.navigated, ['/api/bili-duty/manage?tab=models'])
})

test('平板触控设备采用网关同源导航，即使 UA 不包含 Android', async () => {
  const app = browser({userAgent: 'Mozilla/5.0 (Linux; Tablet)', innerWidth: 690, maxTouchPoints: 5,
    fetchImpl: () => ({ok: true, headers: {get: name => name === 'content-type' ? 'text/html' : '1'}})})
  await app.openManage()
  assert.deepEqual(app.navigated, ['/api/bili-duty/manage'])
  assert.equal(app.posts.length, 0)
})

test('桌面入口继续委托宿主打开，不导航当前设置页', async () => {
  const app = browser({userAgent: 'Mozilla/5.0 Windows NT 10.0', postImpl: () => ({ok: true})})
  await app.openManage()
  assert.equal(app.posts.length, 1)
  assert.equal(app.posts[0][1].what, 'manage')
  assert.deepEqual(app.navigated, [])
})

test('后端仅返回 URL 时不打开系统浏览器，非本机来源仍拒绝', async () => {
  const home = mkdtempSync(join(tmpdir(), 'fish-android-manage-'))
  let handler
  try {
    const ctx = {get: k => k === 'dshHomePath' ? (...p) => join(home, ...p) : undefined,
      logger: {info() {}, warn() {}}, tools: {register() {}},
      webServer: {register(x) {handler = x.handler; return {dispose() {}}}},
      effect: f => f(), settings: {describe() {return []}}}
    apply(ctx, {})
    const call = async (headers, body) => {
      const req = Readable.from([Buffer.from(JSON.stringify(body))])
      req.method = 'POST'; req.url = '/api/bili-duty/open'; req.headers = headers
      let status, payload
      await handler(req, {writeHead(code) {status = code}, end(text) {payload = String(text)}})
      return {status, result: JSON.parse(payload)}
    }
    const okay = await call({host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080'},
      {what: 'manage', tab: 'firststart', resolveOnly: true})
    assert.equal(okay.status, 200)
    assert.equal(okay.result.url, 'http://127.0.0.1:3080/api/bili-duty/manage?tab=firststart')
    assert.equal('opened' in okay.result, false)
    const bad = await call({host: 'dsh.example.com', origin: 'https://dsh.example.com'},
      {what: 'manage', resolveOnly: true})
    assert.equal(bad.status, 403)
  } finally {rmSync(home, {recursive: true, force: true})}
})

test('DSH Mobile 网关的已配对同源代理可访问 HTML/JS，跨站和伪造 Host 仍被拦截', async () => {
  const home = mkdtempSync(join(tmpdir(), 'fish-mobile-gateway-'))
  let handler
  try {
    const ctx = {get: k => k === 'dshHomePath' ? (...p) => join(home, ...p) : undefined,
      logger: {info() {}, warn() {}}, tools: {register() {}},
      webServer: {register(x) {handler = x.handler; return {dispose() {}}}},
      effect: f => f(), settings: {describe() {return []}}}
    apply(ctx, {})
    const call = async (path, headers) => {
      const req = Readable.from([])
      req.method = 'GET'; req.url = path; req.headers = headers
      let status, headersOut, body
      await handler(req, {writeHead(code, h) {status = code; headersOut = h}, end(text) {body = String(text ?? '')}})
      return {status, headers: headersOut, body}
    }
    // 网关已做设备配对/HTTPS/CSRF；向本机上游转发普通插件路由。
    const upstreamHeaders = {host: '127.0.0.1:3080', referer: 'http://127.0.0.1:3080/', 'sec-fetch-site': 'same-origin'}
    const page = await call('/api/bili-duty/manage?tab=firststart', upstreamHeaders)
    assert.equal(page.status, 200)
    assert.equal(page.headers['x-dafeiyu-management'], '1')
    assert.match(page.body, /meta name="dafeiyu-management" content="1"/)
    assert.match(page.body, /href="\/" aria-label="返回 DSH Mobile"/)
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/)
    const js = await call('/api/bili-duty/manage.js', upstreamHeaders)
    assert.equal(js.status, 200)
    // 模拟配对网关代理后的 JSON 写入，确认管理页可以保存配置而非只能打开静态 HTML。
    const post = async (headers, body) => {
      const req = Readable.from([Buffer.from(JSON.stringify(body))])
      req.method = 'POST'; req.url = '/api/bili-duty/config'; req.headers = headers
      let status, responseBody
      await handler(req, {writeHead(code) {status = code}, end(text) {responseBody = String(text ?? '')}})
      return {status, json: JSON.parse(responseBody)}
    }
    const saved = await post({...upstreamHeaders, origin: 'http://127.0.0.1:3080', 'content-type': 'application/json'}, {perDay: 2})
    assert.equal(saved.status, 200)
    assert.equal(saved.json.ok, true)
    const blockedWrite = await post({...upstreamHeaders, origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site'}, {perDay: 3})
    assert.equal(blockedWrite.status, 403)
    const xsite = await call('/api/bili-duty/manage', {...upstreamHeaders, 'sec-fetch-site': 'cross-site'})
    assert.equal(xsite.status, 403)
    const forged = await call('/api/bili-duty/manage', {host: 'public.example:443', origin: 'https://public.example:443', 'x-forwarded-host': '127.0.0.1:3080'})
    assert.equal(forged.status, 403)
    const crossOrigin = await call('/api/bili-duty/manage', {host: '127.0.0.1:3080', origin: 'https://attacker.example'})
    assert.equal(crossOrigin.status, 403)
  } finally {rmSync(home, {recursive: true, force: true})}
})
