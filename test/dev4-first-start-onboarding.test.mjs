import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {createFirstStart} from '../lib/first-start.mjs'
import {recommendFirstLifeSetup} from '../lib/quick-setup-options.mjs'
import {createHostSessionIntegration,createAutomaticSessionScope,SESSION_INTEGRATION_FILE} from '../lib/session-integration-policy.mjs'
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
  const messages=[],archived=[],agents=[{id:'session-native-test',followup:async m=>messages.push(m),inject:async m=>messages.push(m)}];const ws={id:'default-workspace',title:'默认工作区',sessionIds:['session-native-test']};const registry={list:()=>[ws],archivedSessionIds:archived}
  const ctx={get:k=>k==='dshHomePath'?(...p)=>join(home,...p):k==='workspaceRegistry'?registry:undefined,agents:{list:()=>agents},
    logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
  apply(ctx,{})
  const call=async(method,path,body,origin='http://127.0.0.1:8011')=>{
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
    req.method=method;req.url='/api/bili-duty/'+path;req.headers={host:'127.0.0.1:8011',origin}
    let status=200,payload=''
    await handler(req,{writeHead(x){status=x},end(x){payload=String(x||'')}})
    return {status,payload,json:()=>JSON.parse(payload)}
  }
  const state=await call('GET','onboarding/status')
  assert.equal(state.status,200);assert.equal(state.json().requiredReady,false)
  const firstLife=(await call('GET','onboarding/quick/options')).json();assert.equal(firstLife.recommendLife,true);assert.equal(firstLife.life.mode,'off')
  assert.equal(state.json().lifeSetupPending,true)
  // Re-creating the actual gate after the mandatory restart must retain the recommendation.
  assert.equal(createFirstStart({stateDir:join(home,'bili-duty'),credentialPath:join(home,'bili-duty','bili_credential.json'),headlessSync:{hasAnyVerified:()=>false}}).status().lifeSetupPending,true)
  assert.equal(state.json().localMemoryReady,true);assert.equal(state.json().capabilities.active.platform,true);assert.equal(state.json().capabilities.active.autonomous,true)
  assert.equal((await call('POST','main-session/memory/add',{text:'主人正在验证独立记忆',importance:.8})).status,200)
  const unbound=await call('POST','onboarding/bili/verify',{})
  assert.equal(unbound.status,400);assert.match(unbound.json().error,/冻结/)
  assert.equal((await call('GET','onboarding/status')).json().biliVerified,false)
  const stateDir=join(home,'bili-duty')
  writeFileSync(join(stateDir,'bili_credential.json'),JSON.stringify({dedeuserid:'10001',sessdata:'fixture',bili_jct:'fixture'}))
  const mismatch=await call('POST','onboarding/bili/verify',{})
  assert.equal(mismatch.status,400);assert.match(mismatch.json().error,/uid-mismatch/)
  assert.equal((await call('GET','onboarding/status')).json().biliVerified,false)
  rmSync(join(stateDir,'bili_credential.json'))
  assert.equal((await call('GET','manage')).status,200)
  assert.equal((await call('GET','manage.js')).status,200)
  assert.equal((await call('GET','status')).status,200)
  assert.equal((await call('POST','login/poll',{key:'fake'})).status!==423,true)
  // Config-only setup route is allowed before unlock. Executing anything
  // from the target Session is still disallowed (no early business actions).
  const mainSetup=await call('GET','main-session')
  assert.equal(mainSetup.status,200)
  assert.equal(typeof mainSetup.json().config,'object')
  const sessionDirectory=await call('GET','main-session?directory=1');assert.equal(sessionDirectory.status,200);assert.equal(sessionDirectory.json().nativeBindingAvailable,true)
  assert.equal(sessionDirectory.json().directoryProtocol,4);assert.equal(sessionDirectory.json().history,undefined);assert.equal(sessionDirectory.json().config,undefined)
  assert.deepEqual((await call('GET','main-session/sessions')).json(),sessionDirectory.json())
  assert.equal((await call('GET','main-session?directory=1',undefined,'https://outside.invalid')).status,403)
  assert.equal((await call('POST','main-session/bind',{})).status,400)
  const bindBody={confirm:'BIND_EXISTING_MAIN_SESSION',sessionId:'session-native-test',expectedId:''}
  assert.equal((await call('POST','main-session/bind',bindBody,'https://outside.invalid')).status,403)
  assert.equal((await call('POST','main-session/bind',{...bindBody,sessionId:'unknown'})).status,409)
  const bound=await call('POST','main-session/bind',bindBody);assert.equal(bound.status,200);assert.equal(bound.json().selectedId,'native-test')
  assert.deepEqual(messages,[]);assert.equal((await call('GET','main-session')).json().config.id,'native-test')
  assert.equal((await call('POST','main-session/bind',bindBody)).status,409)
  assert.equal((await call('POST','main-session/create',{confirm:'CREATE_AND_BIND_MAIN_SESSION',expectedId:'native-test'})).status,423)
  assert.equal((await call('GET','main-session/navigation')).status,423)
  archived.push('session-native-test');const afterArchive=(await call('GET','main-session?directory=1')).json();assert.equal(afterArchive.targetArchived,true);assert.equal(afterArchive.targetLive,false);assert.deepEqual(afterArchive.sessions,[])
  assert.equal((await call('POST','main-session/bind',{...bindBody,expectedId:'native-test'})).status,409)
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
 assert.match(page,/<h3>文字模型验证/);assert.match(page,/验证文字连接/)
 assert.match(page,/id="quick-memory-section"/)
 assert.match(page,/id="quick-life-save"/)
 assert.match(page,/id="quick-dm-save"/)
 assert.match(page,/id="quick-share-save"/)
 assert.doesNotMatch(page,/id="quick-memory-enabled"/)
 assert.doesNotMatch(page,/id="quick-reflection-enabled"/)
 assert.match(js,/onboarding\/welcome/)
 assert.match(js,/onboarding\/bili\/verify/)
 assert.match(client,/onOpenManage\(setupTab,setupAnchor\)/)
})


test('完成必需设置后 HTTP 业务路由解锁（显式模拟已验证测试夹具）',async()=>{
 const home=mkdtempSync(join(tmpdir(),'fish-firststart-unlocked-'))
 let handler
 try{
  const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
  apply(ctx,{})
  const stateDir=join(home,'bili-duty')
  const desktop=join(home,'profiles','desktop'),headless=join(home,'profiles','headless')
  mkdirSync(desktop,{recursive:true});mkdirSync(headless,{recursive:true})
  writeFileSync(join(desktop,'cordis.patch.yml'),'[]\n')
  writeFileSync(join(headless,'cordis.patch.yml'),'[]\n')
  const hash=createHash('sha256').update(JSON.stringify(['desktop','[]\n','','[]\n'])).digest('hex')
  writeFileSync(join(stateDir,'headless-model-verified.json'),JSON.stringify({version:1,verified:[{profile:'desktop',provider:'fixture',model:'fixture-model',fingerprint:hash}]}))
  const credential=join(stateDir,'bili_credential.json');writeFileSync(credential,JSON.stringify({dedeuserid:'10001',sessdata:'local-fixture-session',bili_jct:'local-fixture-csrf'}))
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
  assert.match(page, /id="fs-session-stage"[\s\S]*?id="fs-wizard-session"/)
  assert.match(js,/moveWizardControl\(\$\('main-session-id'\)\.closest/)
  assert.match(page, /id="fs-main-session-return"/)
  assert.match(page, /id="main-session-save"/)
  assert.match(js,/if\(!tabAvailable\(tab\)\)tab='firststart'/)
  assert.match(js,/if\(tab==='firststart'\)return true/)
  assert.match(js,/if\(\['home','models','life','reports'\]\.includes\(tab\)\)return true/)
  assert.match(js,/const loadHome=async\(\)=>\{\s*if\(platformSettingsUnavailable\(\)\)\{await loadMainSession\(\{setupOnly:true\}\);return;/)
  assert.match(js,/if\(setupOnly\)return;/)
  assert.match(page,/#panel-home\[data-setup-only="true"\] #main-session-test/)
  assert.match(server,/req\.method==='GET' && path==='\/api\/bili-duty\/main-session'/)
  assert.match(page,/id="quick-memory-section"/)
  assert.match(page,/id="quick-dm-save"/)
})


test('native settings account recovery reuses explicit same-origin endpoints without external browser',()=>{
 const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
 const block=client.slice(client.indexOf('const recoverAccount ='),client.indexOf('const onFavToday ='))
 assert.match(block,/jget\('\/account\/status'\)/)
 assert.match(block,/window\.confirm\([\s\S]*?jpost\('\/account\/confirm',\{uid:a\.pendingUid\}\)/)
 assert.match(block,/window\.confirm\([\s\S]*?jpost\('\/account\/resume',\{uid:a\.activeUid\}\)/)
 assert.match(block,/jpost\('\/onboarding\/bili\/verify',\{\}\)/)
 assert.doesNotMatch(block,/cookie|window\.open|\/open'|localStorage/i)
 assert.equal((client.match(/nativeAccountRecovery\(\)/g)||[]).length,1)
})


test('fresh install HTTP: staged scan, exact UID confirmation, restart, explicit review and online verification',async()=>{
 const home=mkdtempSync(join(tmpdir(),'fish-fresh-account-http-')),stateDir=join(home,'bili-duty')
 const originalFetch=globalThis.fetch;let handler,cleanups=[],navCalls=0
 const uid='10001'
 globalThis.fetch=async url=>{
   const path=String(url)
   if(path.startsWith('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?'))return {
     headers:{getSetCookie:()=>['SESSDATA=fixture-session; Path=/','bili_jct=fixture-jct; Path=/','DedeUserID='+uid+'; Path=/','buvid3=fixture-buvid; Path=/']},json:async()=>({data:{code:0}})}
   if(path==='https://api.bilibili.com/x/web-interface/nav'){navCalls++;return {ok:true,json:async()=>({code:0,data:{isLogin:true,mid:Number(uid),uname:'fixture'}})}}
   throw Error('offline fixture: unexpected fetch')
 }
 const start=()=>apply({get:k=>k==='dshHomePath'?(...p)=>join(home,...p):undefined,agents:{list:()=>[]},logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>{const r=f();if(typeof r==='function')cleanups.push(r);else if(r?.dispose)cleanups.push(()=>r.dispose());return r},settings:{describe(){return []}}},{})
 const stop=()=>{for(const fn of cleanups.reverse())try{fn()}catch{};cleanups=[]}
 const call=async(method,path,body,origin='http://127.0.0.1:8011')=>{
   const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=method;req.url='/api/bili-duty/'+path;req.headers={host:'127.0.0.1:8011',origin}
   let status=200,payload='';await handler(req,{writeHead(x){status=x},end(x){payload=String(x||'')}});return {status,data:JSON.parse(payload)}
 }
 try{
   start()
   assert.equal((await call('GET','account/status')).data.reason,'unbound')
   assert.equal((await call('POST','onboarding/bili/verify',{})).status,400)
   const staged=await call('POST','login/poll',{key:'fixture'})
   assert.equal(staged.status,200);assert.equal(staged.data.state,'staged');assert.equal(staged.data.pendingUid,uid)
   assert.equal((await call('GET','account/status')).data.activeUid,'');assert.equal(navCalls,0)
   assert.equal((await call('POST','account/confirm',{uid},'https://outside.invalid')).status,403)
   assert.notEqual((await call('POST','account/confirm',{uid:'20002'})).status,200);assert.equal(navCalls,0)
   const confirmed=await call('POST','account/confirm',{uid});assert.equal(confirmed.status,200);assert.equal(confirmed.data.verifiedUid,uid);assert.equal(navCalls,1)
   assert.equal((await call('GET','account/status')).data.reason,'restart-required')
   assert.notEqual((await call('POST','account/resume',{uid})).status,200)
   stop();start()
   assert.equal((await call('GET','account/status')).data.reason,'review-required')
   assert.equal((await call('POST','onboarding/bili/verify',{})).status,400)
   assert.notEqual((await call('POST','account/resume',{uid:'20002'})).status,200)
   assert.equal((await call('POST','account/resume',{uid})).data.blocked,false)
   assert.equal((await call('GET','account/status')).data.reason,'ready')
   const verified=await call('POST','onboarding/bili/verify',{});assert.equal(verified.status,200);assert.equal(verified.data.biliVerified,true);assert.equal(navCalls,2)
   assert.equal((await call('GET','onboarding/status')).data.biliVerified,true)
   assert.equal((await call('POST','onboarding/complete',{skipped:[]})).status,400,'headless model still required')
   assert.equal((await call('GET','life-memory/status')).status,423,'unfinished setup cannot access business APIs')
   const ledger=JSON.parse(readFileSync(join(stateDir,'account-binding.json'),'utf8'));assert.equal(ledger.activeUid,uid);assert.equal(ledger.accounts.length,1)
 }finally{stop();globalThis.fetch=originalFetch;rmSync(home,{recursive:true,force:true})}
})


test('持久模式请求即时失效旧代际，只有退出旧宿主后的新进程才激活',async()=>{
 const home=mkdtempSync(join(tmpdir(),'fish-integration-'))
 try{
  let alive=true
  const old=createHostSessionIntegration({dataDir:home,pid:1001,isPidAlive:()=>alive})
  const scope=createAutomaticSessionScope(old.getPolicy),prior=scope.capture()
  let release;const wait=new Promise(r=>release=r)
  const inFlight=scope.run(prior,async()=>{await wait;return scope.current()})
  assert.equal(scope.inFlight(),1)
  assert.throws(()=>old.requestMode({mode:'memory-foundation',expectedRevision:1,confirm:'REQUEST_SESSION_INTEGRATION_RESTART'}))
  assert.throws(()=>old.requestMode({mode:'memory-foundation',expectedRevision:0}))
  const request={mode:'memory-foundation',expectedRevision:0,confirm:'REQUEST_SESSION_INTEGRATION_RESTART'}
  assert.equal(old.requestMode(request).restartRequired,true)
  assert.equal(old.getPolicy().mode,'unavailable')
  release();assert.equal(await inFlight,false);assert.equal(scope.inFlight(),0)
  assert.equal(createHostSessionIntegration({dataDir:home,pid:1001,isPidAlive:()=>false}).getPolicy().mode,'unavailable')
  assert.equal(createHostSessionIntegration({dataDir:home,pid:1002,isPidAlive:()=>alive}).getPolicy().mode,'unavailable')
  alive=false
  const next=createHostSessionIntegration({dataDir:home,pid:1002,isPidAlive:()=>alive})
  assert.deepEqual(next.getPolicy(),{mode:'memory-foundation',revision:1})
  assert.equal(old.getPolicy().mode,'unavailable')
  assert.equal(next.requestMode({...request,mode:'autonomous-life',expectedRevision:1}).restartRequired,true)
  const restored=createHostSessionIntegration({dataDir:home,pid:1003,isPidAlive:()=>false})
  assert.deepEqual(restored.getPolicy(),{mode:'autonomous-life',revision:2})
  assert.equal(scope.isCurrent(prior),false)
  writeFileSync(join(home,SESSION_INTEGRATION_FILE),'broken')
  assert.equal(restored.getPolicy().mode,'unavailable')
  assert.equal(createHostSessionIntegration({dataDir:home}).getPolicy().mode,'unavailable')
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('真实宿主路由：无 B站凭证的记忆基座可写入及回忆，平台业务仍锁定',async()=>{
 const home=mkdtempSync(join(tmpdir(),'fish-foundation-http-'))
 let handler;const requests=[]
 const llm={listProviders:()=>[{id:'claude'}],async *stream(req){requests.push(req);const rows=JSON.parse(req.messages[0].content[0].text.split('<memory_index>')[1].split('</memory_index>')[0]);yield {type:'text-delta',text:JSON.stringify({memory_ids:[rows[0].id],confidence:.9})};yield {type:'finish',reason:{kind:'stop'}}}}
 try{
  const stateDir=join(home,'bili-duty');mkdirSync(stateDir,{recursive:true})
  writeFileSync(join(stateDir,SESSION_INTEGRATION_FILE),JSON.stringify({version:2,capabilities:{platform:false,autonomous:false,persona:false,automaticMemory:true,bridge:false},revision:1,pending:null}))
  const ctx={get:k=>k==='llm'?llm:k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
  apply(ctx,{mainSessionMemorySemanticEnabled:true,mainSessionMemoryModelProvider:'claude',mainSessionMemoryModelId:'claude-haiku-5-5'})
  const call=async(method,path,body,origin='http://127.0.0.1:8011')=>{
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);req.method=method;req.url='/api/bili-duty/'+path;req.headers={host:'127.0.0.1:8011',origin}
    let status=200,payload='';await handler(req,{writeHead(x){status=x},end(x){payload=String(x||'')}})
    return {status,json:()=>JSON.parse(payload)}
  }
  assert.equal((await call('POST','config',{mainSessionMemorySemanticEnabled:true,mainSessionMemoryModelProvider:'claude',mainSessionMemoryModelId:'claude-haiku-5-5'})).status,200)
  const state=(await call('GET','onboarding/status')).json()
  assert.equal(state.memoryFoundationReady,true);assert.equal(state.requiredReady,false);assert.equal(state.localMemoryReady,true);assert.equal(state.platformReady,false)
  assert.equal((await call('POST','login/start',{})).status,423)
  assert.equal((await call('GET','life-memory/status')).status,423)
  assert.equal((await call('POST','main-session/memory/add',{text:'主人正在研究珍珠贝母工艺',importance:.8})).status,200)
  const recalled=await call('POST','main-session/memory/recall',{query:'珍珠贝母'})
  assert.equal(recalled.status,200);assert.match(recalled.json().context,/珍珠贝母/)
  const garden=await call('GET','main-session/memory/garden');assert.equal(garden.status,200);assert.match(JSON.stringify(garden.json().rows),/珍珠贝母/)
  const neural=await call('GET','main-session/memory/neural');assert.equal(neural.status,200);assert.equal(neural.json().sourceCounts.recallableEpisodes,0);assert.match(JSON.stringify(neural.json().nodes),/珍珠贝母/)
  assert.equal((await call('GET','main-session/memory/neural/deep')).status,423)
  assert.equal(state.standaloneMemoryModelReady,false)
  assert.equal(requests.length,0)
  const desktop=join(home,'profiles','desktop','cordis.patch.yml'),target=join(home,'profiles','headless','cordis.patch.yml')
  mkdirSync(join(home,'profiles','desktop'),{recursive:true});mkdirSync(join(home,'profiles','headless'),{recursive:true})
  writeFileSync(desktop,'- id: llm-pi-ai\n  config:\n    providers:\n      claude:\n        api: anthropic-messages\n        models: [{id: claude-haiku-5-5}]\n');writeFileSync(target,'[]\n')
  const fingerprint=createHash('sha256').update(JSON.stringify(['desktop',readFileSync(desktop,'utf8'),'',readFileSync(target,'utf8')])).digest('hex')
  writeFileSync(join(stateDir,'headless-model-verified.json'),JSON.stringify({version:1,verified:[{profile:'desktop',provider:'claude',model:'claude-haiku-5-5',fingerprint}]}))
  assert.equal((await call('GET','onboarding/status')).json().standaloneMemoryModelReady,true)
  const remote=await call('POST','main-session/memory/recall',{query:'远洋油轮'})
  assert.equal(remote.status,200);assert.equal(remote.json().reason,'semantic');assert.equal(requests.length,1);assert.deepEqual(requests[0].tools,[])
  assert.equal((await call('GET','life-memory/status')).status,423)
  const credential=JSON.stringify({dedeuserid:'10001',sessdata:'fixture-only',bili_jct:'fixture-only'});writeFileSync(join(stateDir,'bili_credential.json'),credential)
  writeFileSync(join(stateDir,'first-start-v1.json'),JSON.stringify({version:1,completed:true,biliCredentialHash:createHash('sha256').update(credential).digest('hex')}))
  const verified=(await call('GET','onboarding/status')).json();assert.equal(verified.requiredReady,true);assert.equal(verified.platformReady,false);assert.equal(verified.localMemoryReady,true)
  const scoped=await call('GET','main-session/memory/neural');assert.equal(scoped.status,200);assert.equal(scoped.json().sourceCounts.recallableEpisodes,0);assert.equal(scoped.json().sourceCounts.learnedInterest,0);assert.equal(scoped.json().sourceCounts.verifiedPeople,0)
  assert.equal((await call('GET','main-session/memory/garden',undefined,'https://outside.invalid')).status,403)
  assert.equal((await call('POST','login/start',{})).status,423);assert.equal((await call('GET','life-memory/status')).status,423)
  rmSync(join(stateDir,'bili_credential.json'))
  writeFileSync(target,'# changed\n[]\n')
  assert.equal((await call('GET','onboarding/status')).json().standaloneMemoryModelReady,false)
  assert.equal((await call('POST','main-session/memory/recall',{query:'另一主题'})).json().usedModel,false);assert.equal(requests.length,1)
  const request={capabilities:{platform:true,autonomous:false,persona:false,automaticMemory:true,bridge:false},expectedRevision:1,confirm:'REQUEST_CAPABILITIES_RESTART'}
  assert.equal((await call('POST','onboarding/capabilities',request,'https://outside.invalid')).status,403)
  const next=await call('POST','onboarding/capabilities',request);assert.equal(next.status,200);assert.equal(next.json().restartRequired,true)
  assert.equal((await call('POST','main-session/memory/recall',{query:'珍珠贝母'})).status,423)
  assert.equal((await call('POST','login/start',{})).status,423)
  assert.equal((await call('GET','onboarding/status')).json().localMemoryReady,false)
  assert.equal((await call('GET','main-session/memory/garden')).status,423)
 }finally{rmSync(home,{recursive:true,force:true})}
})


test('独立能力代际：旧模式保守映射、待重启、关闭平台和过时代际',()=>{
 const home=mkdtempSync(join(tmpdir(),'fish-capability-'))
 try{
  writeFileSync(join(home,SESSION_INTEGRATION_FILE),JSON.stringify({version:1,mode:'memory-foundation',revision:4,pending:null}))
  let alive=true
  const old=createHostSessionIntegration({dataDir:home,pid:1001,isPidAlive:()=>alive})
  assert.deepEqual(old.getCapabilities(),{platform:true,autonomous:false,persona:false,automaticMemory:false,bridge:false})
  const capabilities={...old.getCapabilities(),platform:false,automaticMemory:true}
  const req={capabilities,expectedRevision:4,confirm:'REQUEST_CAPABILITIES_RESTART'}
  assert.throws(()=>old.requestCapabilities({...req,capabilities:{...capabilities,persona:'true'}}))
  assert.throws(()=>old.requestCapabilities({...req,expectedRevision:3}))
  assert.equal(old.requestCapabilities(req).restartRequired,true)
  assert.equal(old.getCapabilities(),null)
  assert.equal(createHostSessionIntegration({dataDir:home,pid:1002,isPidAlive:()=>alive}).getCapabilities(),null)
  alive=false
  const next=createHostSessionIntegration({dataDir:home,pid:1002,isPidAlive:()=>alive})
  assert.deepEqual(next.getCapabilities(),capabilities)
  assert.equal(next.getPolicy().revision,5)
  assert.equal(old.getCapabilities(),null)
  assert.throws(()=>next.requestMode({mode:'autonomous-life',expectedRevision:5,confirm:'REQUEST_SESSION_INTEGRATION_RESTART'}))
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('legacy initial social offer is inert; onboarding completion does not expose or activate it',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fish-initial-social-'));try{
 const args={stateDir:dir,credentialPath:join(dir,'bili_credential.json'),headlessSync:{hasAnyVerified:()=>true}};
 const fresh=createFirstStart(args);assert.equal(Object.hasOwn(fresh.status(),'initialSocialOffer'),false);
 writeFileSync(join(dir,'first-start-v1.json'),JSON.stringify({version:1,initialSocialOffer:true}));
 const restarted=createFirstStart(args);assert.equal(Object.hasOwn(restarted.status(),'initialSocialOffer'),false);writeFileSync(args.credentialPath,'test');restarted.verifyBili();assert.throws(()=>restarted.validateComplete(['bad']));assert.equal(restarted.complete([]).completed,true);assert.equal(Object.hasOwn(restarted.status(),'initialSocialOffer'),false);
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');const completion=source.slice(source.indexOf("if(path.endsWith('/complete'))"),source.indexOf("return sendJson(res,404,{ok:false,error:'未知的首次设置操作'}"));
 assert.ok(completion.includes('firstStart.complete(skipped)'));assert.doesNotMatch(completion,/initialSocial|scopedSocialGrants|saveExplicit/);
 }finally{rmSync(dir,{recursive:true,force:true})}
})


test('fresh Life recommendation persists across restart, without changing saved modes or treating a legacy installation as fresh',()=>{
 const home=mkdtempSync(join(tmpdir(),'fish-life-first-restart-'));try{
 const args={stateDir:home,credentialPath:join(home,'bili_credential.json'),headlessSync:{hasAnyVerified:()=>true}}
 const config={lifeAgentMode:'off',autonomousPlannerMinutes:180,autonomousPlannerDailyLimit:4};const old=JSON.stringify(config)
 const fresh=createFirstStart({...args,newInstall:true});assert.equal(fresh.status().lifeSetupPending,true);fresh.markWelcome();writeFileSync(args.credentialPath,'credential');fresh.verifyBili();fresh.complete([])
 const restarted=createFirstStart(args);assert.equal(restarted.status().lifeSetupPending,true);assert.equal(recommendFirstLifeSetup({pending:restarted.status().lifeSetupPending,config}),true)
 assert.equal(JSON.stringify(config),old);assert.equal(recommendFirstLifeSetup({pending:true,config,touchedKeys:new Set(['lifeAgentMode'])}),false)
 assert.equal(recommendFirstLifeSetup({pending:true,config,touchedKeys:new Set(['autonomousPlannerMinutes'])}),false)
 assert.equal(recommendFirstLifeSetup({pending:true,config,nativeUser:{lifeAgentMode:'off'}}),false)
 assert.equal(recommendFirstLifeSetup({pending:true,config:{...config,lifeAgentMode:'active'}}),false)
 restarted.finishLifeSetup();assert.equal(createFirstStart(args).status().lifeSetupPending,false)
 writeFileSync(join(home,'first-start-v1.json'),JSON.stringify({version:1,completed:true}));assert.equal(createFirstStart(args).status().lifeSetupPending,false)
 assert.equal(recommendFirstLifeSetup({pending:false,config}),false)
 }finally{rmSync(home,{recursive:true,force:true})}
})
