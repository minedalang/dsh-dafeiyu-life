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
const start = source.indexOf("      const openExternalManagementLink = href => {")
const end = source.indexOf('\n\n      const patch = async (p, what) => {', start)
assert.ok(start > 0 && end > start, 'management handler exists')
const handlerSource = source.slice(start, end)
function browser({userAgent = 'Android', protocol = 'https:', fetchImpl, postImpl, maxTouchPoints = 0, innerWidth = 1024} = {}) {
  const navigated = [], errors = [], posts = [], requests = [], results = [], expanded = []; let nonce=0
  const window = {navigator: {userAgent, maxTouchPoints}, innerWidth, location: {protocol, host: protocol==='dsh-app:'?'app':'localhost', assign(url) {navigated.push(url)}}}
  const fetch = async (...args) => {requests.push(args); return fetchImpl?.(...args)}
  const jpost = async (...args) => {posts.push(args); return postImpl?.(...args)}
  const openManage = runInNewContext(handlerSource + '\nonOpenManage', {
    window, fetch, jpost, URL, crypto:{randomUUID:()=>`rpc-${++nonce}`}, AbortController, AbortSignal, setTimeout, clearTimeout, manageOpenAbort:{current:null},setManageOpening(){},setManageNotice:v=>results.push(v),setBrowserAuthExpanded:v=>expanded.push(v),setManageBrowser() {}, setPairCode(){},setPairResult:v=>results.push(v),pairAbort:{current:null}, document:{body:{appendChild(){}},createElement(){return {click(){navigated.push(this.href)},remove(){}}}}, setManageError: text => errors.push(text), say() {},
  })
  const openLogin = runInNewContext(handlerSource + '\nonOpenBrowserLogin', {window, fetch, jpost, URL, document:{body:{appendChild(){}},createElement(){return {click(){navigated.push(this.href)},remove(){}}}}, setManageError: text => errors.push(text)})
  return {openManage, openLogin, navigated, errors, posts, requests, results, expanded}
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

test('Desktop 不支持官方登录时仍打开干净的外部浏览器入口，不占用主聊天窗口', async () => {
  const app = browser({protocol:'dsh-app:',userAgent:'Windows',fetchImpl:()=>({ok:true,headers:{get:name=>name==='content-type'?'text/html':'1'}}),postImpl:()=>({ok:true,openIn:'external-browser',path:'/api/bili-duty/manage?tab=firststart#fs-deps-card',url:'http://127.0.0.1:8603/api/bili-duty/browser?tab=firststart#fs-deps-card'})})
  await app.openManage('firststart','fs-deps-card')
  assert.equal(app.posts.length,1)
  assert.equal(app.posts[0][1].external,true)
  assert.deepEqual(app.navigated,['http://127.0.0.1:8603/api/bili-duty/browser?tab=firststart#fs-deps-card'])
  assert.equal(app.requests[0][1].referrerPolicy,'no-referrer');assert.equal(app.requests[1][0],'/api/remoteConnection/loginUrl');assert.ok(app.expanded.at(-1))
  await app.openManage('firststart','fs-deps-card',true)
  assert.equal(app.posts.length,1)
  assert.equal(app.navigated.at(-1),'/api/bili-duty/manage?tab=firststart#fs-deps-card')
})

test('Desktop direct official login uses the actual local Host root without opening or probing management', async()=>{
  for(const origin of ['http://127.0.0.1:4498','http://localhost:8603','http://[::1]:8603']){
    const app=browser({protocol:'dsh-app:',postImpl:()=>({ok:true,openIn:'external-browser',path:'/api/bili-duty/manage',url:origin+'/api/bili-duty/browser'})})
    await app.openLogin();assert.deepEqual(app.navigated,[origin+'/']);assert.equal(app.requests.length,0);assert.equal(app.posts.length,1)
  }
  for(const url of ['https://evil.example/api/bili-duty/browser','http://127.0.0.1:4498/api/bili-duty/browser?token=bad','http://user:pw@localhost:4498/api/bili-duty/browser']){
    const app=browser({protocol:'dsh-app:',postImpl:()=>({ok:true,openIn:'external-browser',path:'/api/bili-duty/manage',url})})
    await app.openLogin();assert.deepEqual(app.navigated,[]);assert.match(app.errors.at(-1),/可信本机浏览器入口/)
  }
  const mobile=browser({protocol:'https:'});await mobile.openLogin();assert.equal(mobile.posts.length,0);assert.deepEqual(mobile.navigated,[])
})

test('Desktop refuses an unexpected or credential-bearing external URL', async()=>{
  const app=browser({protocol:'dsh-app:',fetchImpl:()=>({ok:true,headers:{get:name=>name==='content-type'?'text/html':'1'}}),postImpl:()=>({ok:true,openIn:'external-browser',path:'/api/bili-duty/manage',url:'http://127.0.0.1:8603/api/bili-duty/browser?token=secret'})})
  await app.openManage()
  assert.equal(app.navigated.length,0)
  assert.match(app.errors.at(-1),/可信本机浏览器入口/)
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
    assert.match(page.body, /href="\/" aria-label="返回 DSH 主界面"/)
    assert.match(page.body, /\.manage-return-bar\{position:sticky;top:0/)
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


test('public browser launcher is static and isolated from all owner routes',async()=>{
  const home=mkdtempSync(join(tmpdir(),'fish-browser-guide-'));const routes=[]
  try{
    const ctx={get:k=>k==='dshHomePath'?(...p)=>join(home,...p):undefined,logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {rejection:401}}},webServer:{getOrigin(){return 'http://127.0.0.1:8603'},register(x){routes.push(x);return{dispose(){}}}},effect:f=>f(),settings:{describe(){return[]}}}
    apply(ctx,{})
    const guide=routes.find(r=>r.path==='/api/bili-duty/browser'), prefix=routes.find(r=>r.path==='/api/bili-duty')
    assert.equal(guide.kind,'exact');assert.equal(guide.auth,'anonymous');assert.equal(prefix.auth,'required')
    const call=async(route,method,url,headers,peer,body)=>{
      const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url,headers})
      let status,out,text;await route.handler(req,{writeHead(n,h){status=n;out=h},end(v){text=String(v??'')}},peer);return {status,out,text}
    }
    const host={host:'127.0.0.1:8603'}, owner={principal:{kind:'owner'}}
    const page=await call(guide,'GET',guide.path,host)
    assert.equal(page.status,200);assert.match(page.text,/href="\/"/);assert.doesNotMatch(page.text,/dafeiyu-management" content="1"/)
    assert.match(page.out['content-security-policy'],/script-src 'sha256-/)
    assert.match(page.text,/无需另一台设备/)
    assert.match(page.text,/<button id="retry" type="button">重新检查<\/button>/)
    const script=page.text.match(/<script>([\s\S]+)<\/script>/)[1]
    const {createHash}=await import('node:crypto');assert.ok(page.out['content-security-policy'].includes(createHash('sha256').update(script).digest('base64')))
    const style=page.text.match(/<style>([\s\S]+)<\/style>/)[1]
    assert.ok(page.out['content-security-policy'].includes("style-src 'sha256-"+createHash('sha256').update(style).digest('base64')+"'"))
    assert.equal((await call(guide,'POST',guide.path,host)).status,405)
    assert.equal((await call(guide,'GET',guide.path,{...host,'sec-fetch-site':'cross-site'})).status,403)
    assert.equal((await call(prefix,'GET','/api/bili-duty/config',host)).status,401)
    const open=await call(prefix,'POST','/api/bili-duty/open',{...host,'x-dafeiyu-management-intent':'1'},owner,{what:'manage',external:true,tab:'models'})
    assert.equal(open.status,200);assert.equal(JSON.parse(open.text).url,'http://127.0.0.1:8603/api/bili-duty/browser?tab=models')
    assert.equal((await call(prefix,'POST','/api/bili-duty/open',host,owner,{what:'manage',external:true})).status,403)
    for(const status of [200,401,403]){
      const nodes={status:{},login:{addEventListener(){}},retry:{addEventListener(){}}}, navigated=[]
      runInNewContext(script,{URL,AbortSignal,location:{href:'http://127.0.0.1:8603/api/bili-duty/browser?tab=models',replace:p=>navigated.push(p)},document:{getElementById:id=>nodes[id]},fetch:async()=>({ok:status===200,status,headers:{get:n=>n==='x-dafeiyu-management'?'1':'text/html'}}),clearInterval,setInterval})
      await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(navigated,status===200?['/api/bili-duty/manage?tab=models']:[])
      if(status!==200)assert.equal(nodes.login.hidden,status!==401)
    }
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('external target is derived only from the trusted host origin',async()=>{
  const {managementBrowserUrl}=await import('../lib/management-host-auth.mjs')
  assert.equal(managementBrowserUrl({getOrigin:()=> 'http://127.0.0.1:8603'},'firststart','fs-deps-card'),'http://127.0.0.1:8603/api/bili-duty/browser?tab=firststart#fs-deps-card')
  for(const bad of ['https://example.org','http://127.0.0.1:8603/?token=x','http://user:pw@localhost:8603','file:///a']) assert.throws(()=>managementBrowserUrl({getOrigin:()=>bad}))
})

test('pairing approval uses the actual host HTTP RPC envelope without injected Remote, only after exact code and authority',async()=>{
  const approveSource=source.slice(source.indexOf('      const pairingRpc ='),source.indexOf('      const browserRecovery='))
  const live={id:'request',code:'ABCD2345',authority:'http://127.0.0.1:8603',expiresInMs:5000}
  const trusted={ok:true,openIn:'external-browser',path:'/api/bili-duty/manage',url:live.authority+'/api/bili-duty/browser'}
  const cases=[{rows:[live],valid:true},{rows:[live],code:'abcd2345',valid:true},{rows:[{...live,expiresInMs:0}]},{rows:[{...live,authority:'http://localhost:8603'}]},{rows:[live,live]},{rows:[{...live,code:'ABCDEFGH'}]},{rows:[live],code:'ABCD2340'},{rows:[live],response:{...trusted,url:trusted.url+'?token=bad'}},{rows:[live],response:{...trusted,url:'https://evil.example/api/bili-duty/browser'}},{rows:[live],http:401},{rows:[live],http:403},{rows:[live],http:404},{rows:[live],http:503},{rows:[live],badId:true},{rows:[live],html:true},{rows:[live],denied:true},{rows:[live],decisionFail:true},{rows:[live],protocol:'https:'}]
  for(const entry of cases){
    const decisions=[],errors=[],messages=[],calls=[];let n=0
    const fetch=async(path,opts)=>{
      const b=JSON.parse(opts.body);calls.push(b.method)
      assert.equal(path,'/api/'+b.method);assert.equal(b.type,'client-request');assert.equal(opts.credentials,'same-origin');assert.equal(opts.redirect,'error');assert.equal(opts.method,'POST');assert.equal(opts.headers['content-type'],'application/json')
      assert.ok(opts.signal instanceof AbortSignal);assert.ok(!opts.signal.aborted);assert.match(b.rpcId,/^rpc-/)
      if(entry.http)return {ok:false,status:entry.http}
      if(b.method==='remoteConnection/pairingRequests')assert.deepEqual(b.payload,{args:{}})
      else{assert.equal(b.method,'remoteConnection/decidePairing');assert.deepEqual(b.payload,{args:{id:'request',decision:'allow'}});decisions.push([b.payload.args.id,b.payload.args.decision])}
      const result=entry.denied?{ok:false,error:{code:'remote-connection/owner-required',message:'do not expose',details:{}}}:{ok:true,value:b.method.endsWith('/pairingRequests')?{requests:entry.rows,pollIntervalMs:2000}:entry.decisionFail?'unavailable':'approved'}
      return {ok:true,headers:{get:()=>entry.html?'text/html':'application/json'},json:async()=>({type:'server-response',rpcId:entry.badId?'wrong':b.rpcId,result})}
    }
    const approve=runInNewContext(approveSource+'\napproveBrowser',{URL,window:{location:{protocol:entry.protocol||'dsh-app:',host:'app'}},crypto:{randomUUID:()=>`rpc-${++n}`},fetch,jpost:async()=>entry.response||trusted,pairPending:{current:false},pairAbort:{current:null},pairCode:entry.code||'ABCD 2345',manageBrowser:null,setPairBusy(){},setManageNotice(){},setManageError:e=>errors.push(e),setPairCode(){},setPairResult:m=>messages.push(m),AbortController,setTimeout,clearTimeout})
    await approve();assert.deepEqual(decisions,entry.valid||entry.decisionFail?[['request','allow']]:[])
    if(entry.valid){assert.deepEqual(calls,['remoteConnection/pairingRequests','remoteConnection/decidePairing']);assert.match(messages.at(-1),/DSH 已批准/)}else{assert.ok(errors.at(-1));assert.doesNotMatch(errors.at(-1),/do not expose/);assert.ok(calls.length<=2)}
    if(entry.http===404)assert.match(errors.at(-1),/未提供浏览器配对接口/)
    if(entry.http===401)assert.match(errors.at(-1),/原生会话未认证/)
  }
  assert.doesNotMatch(source,/pairingRemote|ctx\.inject\(\['remote\.remoteConnection'\]/)
})

test('fresh and established Desktop users render the same full native settings, with browser auth first',()=>{
  const h=(tag,props,...children)=>({tag,props,children})
  const react={createElement:h,useState:v=>[v,()=>{}],useRef:v=>({current:v}),useEffect(){}}
  const all=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(c=>Array.isArray(c)?c.flatMap(all):all(c))]:[]
  for(const st of [null,{config:{},venvReady:false,onboarding:{welcomeCompleted:false}},{config:{},venvReady:true,onboarding:{welcomeCompleted:false}},{config:{},venvReady:true,onboarding:{welcomeCompleted:true}}]){
    // Execute real Panel using synthetic status, not a mock of the first-start branch.
    const src=source.replace('const [st, setSt, fails, maintenance, setMaintenance] = useStatus(5000)','const [st, setSt, fails, maintenance, setMaintenance] = [testStatus,()=>{},0,null,()=>{}]').replace("    return {\n      inject: ['slots'],","    return {Panel,\n      inject: ['slots'],")
    const host={location:{protocol:'dsh-app:',host:'app'}};let panel
    runInNewContext(src,{window:{...host,__ModuleLoader__:{load:spec=>{panel=spec.factory(()=>react).Panel}}},testStatus:st,URL,AbortController,setTimeout,clearTimeout})
    assert.equal(typeof panel,'function');const tree=panel(),nodes=all(tree),text=JSON.stringify(tree)
    const auth=nodes.findIndex(n=>n.props?.['aria-label']==='管理中心浏览器授权')
    assert.ok(auth>=0);assert.doesNotMatch(text,/在自己的浏览器中打开管理中心|通常无需手动登录/);assert.doesNotMatch(text,/当前 DSH 主人身份/);assert.match(text,/浏览器也能访问完整的 DSH 功能/);assert.match(text,/浏览器授权与故障恢复/);assert.ok(nodes.some(n=>n.props?.['aria-expanded']===false));assert.match(text,/打开 DSH 官方登录页/);assert.match(text,/八位浏览器配对码/);assert.match(text,/在 DSH 内打开管理中心/);assert.match(text,/不用另一台设备/);assert.doesNotMatch(text,/欢迎来到大肥鱼 · 首次配置/)
    if(st){const master=nodes.findIndex(n=>n.props?.label==='🐳 大肥鱼总开关');assert.ok(master>auth);assert.match(text,/账号与运行环境/);if(!st.onboarding.welcomeCompleted)assert.match(text,/首次使用：点击打开管理中心/)}
    else assert.match(text,/在独立浏览器中打开管理中心/)
  }
  assert.match(source,/onOpenManage\(setupTab,setupAnchor\)/)
  assert.match(source,/setupAnchor=needsSetup&&!st\.venvReady\?'fs-deps-card'/)
})


test('Desktop official owner login is requested only on explicit open; a changed port obtains a new link; clean management URL carries no credential',async()=>{
  let origin='http://127.0.0.1:4498', secret='synthetic-first';const calls=[]
  const app=browser({protocol:'dsh-app:',fetchImpl:(path,opts)=>{
    if(path!=='/api/remoteConnection/loginUrl')return {ok:true,headers:{get:n=>n==='content-type'?'text/html':'1'}}
    const b=JSON.parse(opts.body);calls.push(b);assert.equal(opts.credentials,'same-origin');assert.equal(opts.redirect,'error');assert.equal(opts.cache,'no-store');assert.equal(opts.referrerPolicy,'no-referrer');assert.deepEqual(b.payload,{args:{}})
    return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({type:'server-response',rpcId:b.rpcId,result:{ok:true,value:origin+'/?token='+secret}})}
  },postImpl:(_,b)=>({ok:true,openIn:'external-browser',path:'/api/bili-duty/manage?tab='+b.tab,url:origin+'/api/bili-duty/browser?tab='+b.tab})})
  assert.equal(calls.length,0)
  await app.openManage('models');assert.deepEqual(app.navigated,[origin+'/?token='+secret,origin+'/api/bili-duty/browser?tab=models&auto=1']);assert.equal(app.results.at(-1),'请查看大肥鱼管理中心标签页。')
  origin='http://127.0.0.1:7823';secret='synthetic-next';await app.openManage('models');assert.deepEqual(app.navigated.slice(-2),[origin+'/?token='+secret,origin+'/api/bili-duty/browser?tab=models&auto=1'])
  assert.equal(calls.length,2);assert.notEqual(calls[0].rpcId,calls[1].rpcId);assert.doesNotMatch(JSON.stringify([app.errors,app.results,app.posts]),/synthetic-/)
  await app.openManage('models','',true);assert.equal(calls.length,2);assert.equal(app.navigated.at(-1),'/api/bili-duty/manage?tab=models')
})

test('owner login failure, wrong origin/path or extra URL fields fall back without exposing returned data',async()=>{
  const origin='http://127.0.0.1:4498', clean=origin+'/api/bili-duty/browser'
  const bad=[{value:'https://example.com/?token=synthetic-secret'},{value:'http://127.0.0.1:9999/?token=synthetic-secret'},{value:origin+'/api/bili-duty/manage?token=synthetic-secret'},{value:origin+'/?token=synthetic-secret&next=/'},{value:origin+'/?token=synthetic-secret&token=other'},{value:origin+'/?token=synthetic-secret#x'},{value:'http://u:p@127.0.0.1:4498/?token=synthetic-secret'},{value:origin+'/?token='},{value:42},{badId:true},{http:401},{http:403},{http:404},{http:503},{denied:true},{network:true}]
  for(const c of bad){
    const app=browser({protocol:'dsh-app:',fetchImpl:(path,opts)=>{
      if(path!=='/api/remoteConnection/loginUrl')return {ok:true,headers:{get:n=>n==='content-type'?'text/html':'1'}}
      if(c.network)throw Error('synthetic-secret')
      if(c.http)return {ok:false,status:c.http}
      const b=JSON.parse(opts.body);return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({type:'server-response',rpcId:c.badId?'bad':b.rpcId,result:c.denied?{ok:false,error:{code:'remote-connection/token-unavailable',message:'synthetic-secret'}}:{ok:true,value:c.value}})}
    },postImpl:()=>({ok:true,openIn:'external-browser',path:'/api/bili-duty/manage',url:clean})})
    await app.openManage();assert.deepEqual(app.navigated,[clean]);assert.ok(app.expanded.at(-1));assert.equal(app.results.at(-1),'若未能打开管理中心，请按下方指引授权。');assert.doesNotMatch(JSON.stringify([app.errors,app.results,app.posts]),/synthetic-secret/)
  }
})

test('automatic launcher waits for real owner HTML, never treats a login response as success, stops on denial or timeout',async()=>{
  const {managementBrowserLanding}=await import('../lib/management-host-auth.mjs');let html
  managementBrowserLanding({method:'GET'},{writeHead(){},end(x){html=x}})
  const script=html.match(/<script>([\s\S]+)<\/script>/)[1]
  for(const outcome of ['success','denial','timeout','wrong-html']){
    let tick=null,now=0,response=401;const navigated=[],nodes={status:{},login:{addEventListener(){}},retry:{addEventListener(){}}}
    runInNewContext(script,{URL,AbortSignal,Date:{now:()=>now},location:{href:'http://127.0.0.1:4498/api/bili-duty/browser?tab=firststart&auto=1#fs-deps-card',replace:p=>navigated.push(p)},document:{getElementById:id=>nodes[id]},fetch:async(path,opts)=>{assert.equal(path,'/api/bili-duty/manage?tab=firststart');assert.equal(opts.credentials,'same-origin');return {ok:response===200,status:response,headers:{get:n=>n==='x-dafeiyu-management'?(outcome==='wrong-html'?'':'1'):'text/html'}}},setInterval(fn){tick=fn;return 1},clearInterval(){tick=null}})
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(navigated,[]);assert.equal(typeof tick,'function');assert.equal(nodes.status.textContent,'正在打开管理中心，请稍候。')
    if(outcome==='timeout')now=30001;else response=outcome==='denial'?403:200
    tick();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(navigated,outcome==='success'?['/api/bili-duty/manage?tab=firststart#fs-deps-card']:[]);assert.equal(tick,null)
  }
})
