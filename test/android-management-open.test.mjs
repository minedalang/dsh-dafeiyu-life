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
const start = source.indexOf("      const onOpenManage = async (tab = '', anchor = '') => {")
const end = source.indexOf('\n\n      const patch = async (p, what) => {', start)
assert.ok(start > 0 && end > start, 'management handler exists')
const handlerSource = source.slice(start, end)
function browser({userAgent = 'Android', protocol = 'https:', fetchImpl, postImpl, maxTouchPoints = 0, innerWidth = 1024} = {}) {
  const navigated = [], errors = [], posts = [], requests = []
  const window = {navigator: {userAgent, maxTouchPoints}, innerWidth, location: {protocol, host: protocol==='dsh-app:'?'app':'localhost', assign(url) {navigated.push(url)}}}
  const fetch = async (...args) => {requests.push(args); return fetchImpl?.(...args)}
  const jpost = async (...args) => {posts.push(args); return postImpl?.(...args)}
  const openManage = runInNewContext(handlerSource + '\nonOpenManage', {
    window, fetch, jpost, document:{body:{appendChild(){}},createElement(){return {click(){navigated.push(this.href)},remove(){}}}}, setManageError: text => errors.push(text), say() {},
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
  assert.equal(app.requests[0][1].redirect, 'manual')
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
  assert.match(app.errors.at(-1), /不是受支持的 DSH Desktop 或 HTTP\(S\) 登录\/配对页面/)
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

test('Desktop 在已认证的同源主窗口打开，不向外部浏览器传递身份', async () => {
  const app = browser({protocol:'dsh-app:',userAgent:'Windows',fetchImpl:()=>({ok:true,headers:{get:name=>name==='content-type'?'text/html':'1'}})})
  await app.openManage('firststart','fs-deps-card')
  assert.equal(app.posts.length,0)
  assert.deepEqual(app.navigated,['/api/bili-duty/manage?tab=firststart#fs-deps-card'])
  assert.equal(app.requests[0][1].referrerPolicy,'no-referrer')
})

test('后端仅返回 URL 时不打开系统浏览器，非本机来源仍拒绝', async () => {
  const home = mkdtempSync(join(tmpdir(), 'fish-android-manage-'))
  let handler
  try {
    const ctx = {get: k => k === 'dshHomePath' ? (...p) => join(home, ...p) : undefined,
      logger: {info() {}, warn() {}}, tools: {register() {}},
      connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer: {register(x) {handler = x.handler; return {dispose() {}}}},
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
    assert.equal(okay.result.path, '/api/bili-duty/manage?tab=firststart')
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
      connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer: {register(x) {handler = x.handler; return {dispose() {}}}},
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
    assert.match(page.body, /href="\/" aria-label="返回 DSH"/)
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

// Real host contracts: the caller's HTTP headers cannot manufacture an owner.
test('rc.5 and alpha host owner contracts fail closed, never call alpha admit', async()=>{
  const {managementOwnerStatus,explicitManagementIntent}=await import('../lib/management-host-auth.mjs')
  const req={headers:{host:'127.0.0.1:3080','x-dafeiyu-management-intent':'1'}}
  const owner={principal:{kind:'owner'}}, guest={principal:{kind:'device'}}
  const alpha={connection:{admit(){assert.fail('alpha must not call admit')}}}
  assert.equal(await managementOwnerStatus(alpha,req,owner),200)
  assert.equal(await managementOwnerStatus(alpha,req,guest),403)
  assert.equal(await managementOwnerStatus(alpha,req),503)
  assert.equal(await managementOwnerStatus({},req),503)
  const legacy=result=>({connection:{requestRejection(){},admit(){return result}}})
  assert.equal(await managementOwnerStatus(legacy({peer:owner}),req),200)
  assert.equal(await managementOwnerStatus(legacy({peer:guest}),req),403)
  assert.equal(await managementOwnerStatus(legacy({rejection:401}),req),401)
  assert.equal(await managementOwnerStatus(legacy({rejection:403}),req),403)
  assert.equal(await managementOwnerStatus(legacy({}),req),503)
  assert.equal(explicitManagementIntent(req),true)
  assert.equal(explicitManagementIntent({headers:{host:req.headers.host}}),false)
  assert.equal(explicitManagementIntent({headers:{...req.headers,origin:'https://evil.example'}}),false)
  assert.equal(explicitManagementIntent({headers:{...req.headers,'sec-fetch-site':'cross-site'}}),false)
  assert.equal(explicitManagementIntent({headers:{'x-dafeiyu-management-intent':'1'}}),false)
})
test('production prefix requires owner for HTML, JS, reads and writes on both contracts',async()=>{
  const home=mkdtempSync(join(tmpdir(),'fish-host-auth-'));let route,admission={rejection:401}
  try{
    const ctx={get:k=>k==='dshHomePath'?(...p)=>join(home,...p):undefined,logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return admission}},webServer:{register(x){route=x;return{dispose(){}}}},effect:f=>f(),settings:{describe(){return[]}}}
    apply(ctx,{})
    assert.equal(route.auth,'required')
    const call=async(path,peer,method='GET',headers={host:'127.0.0.1:3080','x-dafeiyu-management-intent':'1'})=>{
      const req=Readable.from(method==='POST'?[Buffer.from('{"perDay":2}')]:[]);Object.assign(req,{method,url:'/api/bili-duty/'+path,headers})
      let status,body;await route.handler(req,{writeHead(n){status=n},end(s){body=String(s??'')}},peer);return{status,body}
    }
    for(const path of ['manage','manage.js','config']){
      assert.equal((await call(path)).status,401)
      assert.equal((await call(path,{principal:{kind:'device'}})).status,403)
    }
    assert.equal((await call('config',undefined,'POST')).status,401)
    const owner={principal:{kind:'owner'}}
    assert.equal((await call('manage',owner)).status,200)
    assert.equal((await call('manage.js',owner)).status,200)
    assert.equal((await call('config',owner,'POST')).status,200)
    assert.equal((await call('config',owner,'POST',{host:'127.0.0.1:3080',origin:'https://evil.example','x-dafeiyu-management-intent':'1'})).status,403)
    admission={peer:owner}
    assert.equal((await call('manage')).status,200)
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('V2 migration maintenance requires authenticated owner and explicit cancellation intent',async()=>{
  const {mkdirSync,writeFileSync}=await import('node:fs')
  const {fileURLToPath}=await import('node:url')
  const {registerMigrationMaintenance}=await import('../lib/storage-migration-maintenance.mjs')
  const {queueDomainMigration,readMigrationJob}=await import('../lib/storage-migration-queue.mjs')
  const home=mkdtempSync(join(tmpdir(),'fish-v2-host-auth-')),root=join(home,'bili-duty');mkdirSync(root)
  const put=(file,data)=>{mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,data)}
  put(join(root,'embedding-runtime','Qwen3-Embedding-0.6B-Q8_0.gguf'),'test-model')
  let route;const disposers=[];const owner={principal:{kind:'owner'}}
  try{
    queueDomainMigration({root,domain:'large',target:join(home,'target'),workerScript:'fake.mjs',parentPid:91231,spawnImpl:()=>({pid:43218,unref(){}})})
    const ctx={connection:{requestRejection(){},admit(){return {rejection:401}}},webServer:{register(x){route=x;return()=>{}}},effect(f){disposers.push(f())}}
    assert.equal(registerMigrationMaintenance(ctx,{root,pluginDir:fileURLToPath(new URL('..',import.meta.url))}),true)
    assert.equal(route.auth,'required')
    const call=async(path,peer,method='GET',intent=false)=>{
      const req=Readable.from(method==='POST'?[Buffer.from(JSON.stringify({jobId:readMigrationJob(root).id,confirm:true}))]:[])
      Object.assign(req,{method,url:'/api/bili-duty/'+path,headers:{host:'127.0.0.1:3080',...(intent?{'x-dafeiyu-management-intent':'1'}:{})},socket:{remoteAddress:'127.0.0.1'}})
      let status;await route.handler(req,{writeHead(n){status=n},end(){}},peer);return status
    }
    assert.equal(await call('migration/status'),401)
    assert.equal(await call('migration/status',{principal:{kind:'device'}}),403)
    assert.equal(await call('migration/status',owner),200)
    assert.equal(await call('migration/cancel',owner,'POST'),403)
    assert.equal(await call('migration/cancel',undefined,'POST',true),401)
    assert.equal(await call('migration/cancel',owner,'POST',true),202)
  }finally{for(const dispose of disposers)if(typeof dispose==='function')dispose();rmSync(home,{recursive:true,force:true})}
})
