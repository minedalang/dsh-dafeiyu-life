import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {createFirstStart} from '../lib/first-start.mjs'
import {apply} from '../index.js'
import {createHash} from 'node:crypto'

test('新用户和老用户第一次都必须看到欢迎引导；只验证凭据不能自动跳过',()=>{
 const home=mkdtempSync(join(tmpdir(),'fish-firststart-'))
 try{
  let verified=false
  const credential=join(home,'bili_credential.json'),sync={hasAnyVerified:()=>verified}
  const gate=createFirstStart({stateDir:home,credentialPath:credential,headlessSync:sync})
  assert.equal(gate.status().welcomeSeen,false)
  assert.equal(gate.status().completed,false)
  assert.equal(gate.status().requiredReady,false)
  assert.throws(()=>gate.complete([]),/不能跳过/)
  // Old user with an existing credential remains unverified until a live MCP check.
  writeFileSync(credential,'{"existing-user":"preserve"}')
  assert.equal(gate.status().hasCredential,true)
  assert.equal(gate.status().biliVerified,false)
  assert.equal(readFileSync(credential,'utf8'),'\u007b"existing-user":"preserve"}')
  gate.markWelcome();assert.equal(gate.status().welcomeSeen,true)
  gate.verifyBili();assert.equal(gate.status().biliVerified,true)
  verified=true
  assert.equal(gate.status().requiredReady,true)
  assert.equal(gate.status().completed,false)
  assert.match(gate.message(),/确认完成/)
  gate.complete(['main-session','life-memory'])
  assert.equal(gate.status().completed,true)
  assert.deepEqual(gate.status().skipped,['main-session','life-memory'])
  assert.throws(()=>gate.complete(['headless']),/未知/)
  // Changing credentials invalidates the local check without deleting existing data.
  writeFileSync(credential,'new-credential')
  assert.equal(gate.status().completed,false)
  gate.verifyBili()
  assert.equal(gate.status().completed,true)
  verified=false;assert.equal(gate.status().completed,false)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('服务端初始状态禁止业务 API，保留管理页面、状态、扫码及安全检查',async()=>{
 const home=mkdtempSync(join(tmpdir(),'fish-firststart-http-'))
 let handler
 try{
  const ctx={get:k=>k==='dshHomePath'?(...p)=>join(home,...p):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
  apply(ctx,{})
  const call=async(method,path,body)=>{
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
    req.method=method;req.url='/api/bili-duty/'+path;req.headers={host:'127.0.0.1:8011',origin:'http://127.0.0.1:8011'}
    let status=200,payload=''
    await handler(req,{writeHead(x){status=x},end(x){payload=String(x||'')}})
    return {status,payload,json:()=>JSON.parse(payload)}
  }
  const state=await call('GET','onboarding/status')
  assert.equal(state.status,200);assert.equal(state.json().requiredReady,false)
  assert.equal((await call('GET','manage')).status,200)
  assert.equal((await call('GET','manage.js')).status,200)
  assert.equal((await call('GET','status')).status,200)
  assert.equal((await call('POST','login/poll',{key:'fake'})).status!==423,true)
  // Config-only setup route is allowed before unlock. Executing anything
  // from the target Session is still disallowed (no early business actions).
  const mainSetup=await call('GET','main-session')
  assert.equal(mainSetup.status,200)
  assert.equal(typeof mainSetup.json().config,'object')
  const sessionTest=await call('POST','main-session/test',{})
  assert.equal(sessionTest.status,423)
  const sessionSave=await call('POST','config',{mainSessionBridgeEnabled:false,mainSessionAutoSync:false})
  assert.equal(sessionSave.status,200)
  const forbidden=await call('GET','life-memory/status')
  assert.equal(forbidden.status,423)
  assert.match(forbidden.json().error,/快速设置/)
  const complete=await call('POST','onboarding/complete',{skipped:['life-memory']})
  assert.equal(complete.status,400)
  const welcome=await call('POST','onboarding/welcome',{})
  assert.equal(welcome.status,200);assert.equal(welcome.json().welcomeSeen,true)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('管理中心与 DSH 插件页都提供醒目 First Start 入口及强制状态',()=>{
 const page=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
 assert.match(page,/data-tab="firststart"/)
 assert.match(page,/id="panel-firststart"/)
 assert.match(page,/id="fs-warning"/)
 assert.match(page,/检测已有登录/)
 assert.match(page,/Headless 模型验证/)
 assert.match(page,/<p>以后可以调整记忆整理、反思批次和恢复推荐设置值。<\/p><div class="fs-recommend-tip" role="note">/)
 assert.match(page,/老用户升级建议：使用新版记忆与反思推荐值/)
 assert.match(page,/不会自动覆盖旧设置，也不会更改模型、开关或已有记忆/)
 assert.match(page,/\.fs-recommend-tip\{[^}]*border-left:5px/)
 assert.match(js,/onboarding\/welcome/)
 assert.match(js,/onboarding\/bili\/verify/)
 assert.match(client,/打开管理中心，开始配置/)
})


test('完成必需设置后 HTTP 业务路由解锁（显式模拟已验证测试夹具）',async()=>{
 const home=mkdtempSync(join(tmpdir(),'fish-firststart-unlocked-'))
 let handler
 try{
  const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
  apply(ctx,{})
  const stateDir=join(home,'bili-duty')
  const desktop=join(home,'profiles','desktop'),headless=join(home,'profiles','headless')
  mkdirSync(desktop,{recursive:true});mkdirSync(headless,{recursive:true})
  writeFileSync(join(desktop,'cordis.patch.yml'),'[]\n')
  writeFileSync(join(headless,'cordis.patch.yml'),'[]\n')
  const hash=createHash('sha256').update(JSON.stringify(['desktop','[]\n','','[]\n'])).digest('hex')
  writeFileSync(join(stateDir,'headless-model-verified.json'),JSON.stringify({version:1,verified:[{profile:'desktop',provider:'fixture',model:'fixture-model',fingerprint:hash}]}))
  const credential=join(stateDir,'bili_credential.json');writeFileSync(credential,'test-credential-placeholder')
  const gate=createFirstStart({stateDir,credentialPath:credential,headlessSync:{hasAnyVerified:()=>true}})
  gate.verifyBili();gate.markWelcome();gate.complete([])
  const req=Readable.from([]);req.method='GET';req.url='/api/bili-duty/life-memory/status';req.headers={host:'127.0.0.1:8011'}
  let status=0,payload=''
  await handler(req,{writeHead(x){status=x},end(x){payload=String(x||'')}})
  assert.equal(status,200,payload)
  assert.notEqual(JSON.parse(payload).blocked,true)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('验证 Overlay 使用 Headless 安全策略允许的文件名；重新同步必须修复被清空的 YAML 父节点',()=>{
 const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const sync=readFileSync(new URL('../lib/headless-model-sync.mjs',import.meta.url),'utf8')
 const security=readFileSync(new URL('../lib/headless-security.mjs',import.meta.url),'utf8')
 assert.match(server,/writeSecureHeadlessOverlay\(join\(stateDir,'headless-model-test-overlay\.yml'\)/)
 assert.doesNotMatch(server,/headless-provider-verify-overlay\.yml/)
 assert.match(security,/'model-test': 'headless-model-test-overlay\.yml'/)
 assert.match(sync,/if\(t\.rows\[index\]\.config == null\)/)
 assert.match(sync,/t\.rows\[index\]\.config\.providers == null/)
})


test('首次设置主 Session 入口不跳回欢迎页：允许配置但隐藏实际执行业务按钮',()=>{
  const page=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(page, /03 · 主 Session[\s\S]*?data-open-tab="home"/)
  assert.match(page, /id="fs-main-session-return"/)
  assert.match(page, /id="main-session-save"/)
  assert.match(js,/!\['firststart','models','home'\]\.includes\(tab\)/)
  assert.match(js,/const loadHome=async\(\)=>\{\s*if\(onboarding && !onboarding\.completed\)\{await loadMainSession\(\{setupOnly:true\}\)/)
  assert.match(js,/if\(setupOnly\)return;/)
  assert.match(page,/#panel-home\[data-setup-only="true"\] #main-session-test/)
  assert.match(server,/req\.method==='GET' && path==='\/api\/bili-duty\/main-session'/)
  assert.match(page,/id="fs-life-settings".*disabled/)
  assert.match(page,/id="fs-personality-settings".*disabled/)
})
