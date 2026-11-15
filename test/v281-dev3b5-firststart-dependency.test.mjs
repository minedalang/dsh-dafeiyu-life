import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('new-user onboarding exposes the main dependency installer and real status, not just a QR fallback',()=>{
  const html=read('lib/management-console.html'), js=read('lib/management-console.js'), backend=read('index.js')
  for(const id of ['fs-main-deps-install','fs-main-deps-status','fs-main-deps-log','fs-main-deps-refresh'])
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id)
  assert.match(html,/id="fs-bili-start"[^>]*disabled/)
  assert.match(js,/installPhase/)
  assert.match(js,/installTail/)
  assert.match(js,/request\('\/install',\{\}\)/)
  assert.match(js,/installing/)
  assert.match(backend,/installOutcome = code === 0 && venvReadyNow\(\) \? 'ready' : 'failed'/)
  assert.match(backend,/if \(!venvReadyNow\(\)\) return sendJson\(res,409,\{ok:false,error:'B站主依赖尚未就绪/)
})

test('fresh install: status remains unready and QR start is blocked before dependencies exist',async()=>{
  const home=mkdtempSync(join(tmpdir(),'fish-coldstart-deps-'))
  let handler
  try{
    const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
      logger:{info(){},warn(){}},tools:{register(){}},
      webServer:{register(opts){handler=opts.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
    apply(ctx,{})
    const call=async(method,path)=>{
      const req=Readable.from(method==='POST'?[Buffer.from('{}')]:[])
      req.method=method;req.url='/api/bili-duty/'+path
      req.headers={host:'127.0.0.1:8761',origin:'http://127.0.0.1:8761','sec-fetch-site':'same-origin'}
      req.socket={remoteAddress:'::1'}
      let code=0,body=''
      await handler(req,{writeHead(status){code=status},end(data){body=String(data||'')}})
      return {code,body:JSON.parse(body)}
    }
    const status=await call('GET','status')
    assert.equal(status.code,200)
    assert.equal(status.body.venvReady,false)
    assert.equal(status.body.installing,false)
    assert.equal(status.body.installPhase,'not-ready')
    // Cross-site installation attempts must fail BEFORE entering the actual installer.
    const req=Readable.from([Buffer.from('{}')]);req.method='POST';req.url='/api/bili-duty/install'
    req.headers={host:'127.0.0.1:8761',origin:'https://evil.example','sec-fetch-site':'cross-site'}
    req.socket={remoteAddress:'::1'}
    let denyStatus=0,denyBody=''
    await handler(req,{writeHead(n){denyStatus=n},end(d){denyBody=String(d||'')}})
    assert.equal(denyStatus,403)
    assert.match(denyBody,/拒绝来自其他网站|只接受本机同源请求/)
    const qr=await call('POST','login/start')
    assert.equal(qr.code,409)
    assert.equal(qr.body.ok,false)
    assert.match(qr.body.error,/主依赖尚未就绪/)
    assert.equal(qr.body.key,undefined)
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('core dependency probe is independent of optional FFmpeg/Whisper probes',()=>{
  const js=read('lib/management-console.js')
  const section=js.slice(js.indexOf('const refreshSetupDependencies=async()=>{'),js.indexOf("$('fs-main-deps-refresh').addEventListener"))
  assert.match(section,/const main=await request\('\/status'\)/)
  assert.match(section,/\$\('fs-bili-start'\)\.disabled=!mainReady/)
  assert.match(section,/try\{[\s\S]*?request\('\/video-dependencies\/status'\)/)
  assert.match(section,/catch\(e\)\{[\s\S]*?不影响主依赖安装与 B站扫码/)
  assert.ok(section.indexOf("$('fs-bili-start').disabled")<section.indexOf("request('/video-dependencies/status')"), 'QR readiness is rendered before probing optional addons')
})

test('main dependency installation endpoint is restricted to a local same-origin browser',async()=>{
  const home=mkdtempSync(join(tmpdir(),'fish-install-guard-'))
  let handler
  try{
    const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
      logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
    apply(ctx,{})
    const call=async(origin,remote='::1')=>{
      const req=Readable.from([Buffer.from('{}')]);req.method='POST';req.url='/api/bili-duty/install';
      req.headers={host:'127.0.0.1:8761',origin,'sec-fetch-site':'same-origin'}
      req.socket={remoteAddress:remote}
      let code=0,data='';await handler(req,{writeHead(n){code=n},end(content){data=String(content||'')}})
      return {code,data}
    }
    assert.equal((await call('https://malicious.example')).code,403)
    assert.equal((await call('http://127.0.0.1:8761','192.168.1.20')).code,403)
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('a fake package directory is insufficient to assert a working QR: failure gives repair advice without leaking QR key',async()=>{
  const {mkdirSync,writeFileSync,existsSync}=await import('node:fs')
  const home=mkdtempSync(join(tmpdir(),'fish-qr-broken-env-'))
  const originalFetch=global.fetch
  let handler
  try{
    const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
      logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
    apply(ctx,{})
    const state=join(home,'bili-duty'),venv=join(state,'.venv')
    const packages=process.platform==='win32'?join(venv,'Lib','site-packages'):join(venv,'lib','python3.12','site-packages')
    const py=process.platform==='win32'?join(venv,'Scripts','python.exe'):join(venv,'bin','python')
    for(const path of [packages,join(venv,process.platform==='win32'?'Scripts':'bin')])mkdirSync(path,{recursive:true})
    for(const dep of ['bilibili_api','mcp','qrcode'])mkdirSync(join(packages,dep))
    writeFileSync(py,'invalid executable', {mode:0o755})
    // A QR failure must not manufacture a login credential.
    global.fetch=async()=>({json:async()=>({data:{qrcode_key:'PRIVATE-QR-KEY',url:'https://passport.bilibili.com/private?key=PRIVATE-QR-KEY'}})})
    const call=async(method,path)=>{
      const req=Readable.from(method==='POST'?[Buffer.from('{}')]:[])
      req.method=method;req.url='/api/bili-duty/'+path
      req.headers={host:'127.0.0.1:8761',origin:'http://127.0.0.1:8761','sec-fetch-site':'same-origin'}
      req.socket={remoteAddress:'::1'}
      let code=0,text='';await handler(req,{writeHead(n){code=n},end(c){text=String(c||'')}})
      return {code,text,body:JSON.parse(text)}
    }
    const before=await call('GET','status');assert.equal(before.code,200);assert.equal(before.body.venvReady,true)
    const qr=await call('POST','login/start')
    assert.equal(qr.code,503,qr.text)
    assert.equal(qr.body.ok,false)
    assert.match(qr.body.error,/二维码生成失败/)
    assert.doesNotMatch(qr.text,/PRIVATE-QR-KEY|passport\.bilibili\.com/)
    assert.equal(existsSync(join(state,'bili_credential.json')),false)
    assert.equal(existsSync(join(state,'qrcode_login.png')),false)
  }finally{global.fetch=originalFetch;rmSync(home,{recursive:true,force:true})}
})

test('offline QR happy path: main runtime ready and a working QR Python produce PNG without remote B站 requests',
  {skip:process.platform==='win32' || (await import('node:child_process')).spawnSync('python3',['-c','import qrcode']).status!==0},async()=>{
  const {mkdirSync,writeFileSync}=await import('node:fs')
  const {spawnSync}=await import('node:child_process')
  const home=mkdtempSync(join(tmpdir(),'fish-qr-success-'))
  const originalFetch=global.fetch
  let handler
  try{
    const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
      logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
    apply(ctx,{})
    const state=join(home,'bili-duty'),venv=join(state,'.venv')
    const packages=join(venv,'lib','python3.12','site-packages')
    mkdirSync(packages,{recursive:true});mkdirSync(join(venv,'bin'),{recursive:true})
    for(const dep of ['bilibili_api','mcp','qrcode'])mkdirSync(join(packages,dep))
    const python=spawnSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).stdout.trim()
    writeFileSync(join(venv,'bin','python'),'#!/bin/sh\nexec '+JSON.stringify(python)+' "$@"\n',{mode:0o755})
    global.fetch=async()=>({json:async()=>({data:{qrcode_key:'QR-FIXTURE-KEY',url:'https://example.invalid/qr?key=QR-FIXTURE-KEY'}})})
    const req=Readable.from([Buffer.from('{}')]);req.method='POST';req.url='/api/bili-duty/login/start'
    req.headers={host:'127.0.0.1:8761',origin:'http://127.0.0.1:8761','sec-fetch-site':'same-origin'}
    req.socket={remoteAddress:'::1'}
    let code=0,raw='';await handler(req,{writeHead(n){code=n},end(c){raw=String(c||'')}})
    assert.equal(code,200,raw)
    const result=JSON.parse(raw)
    assert.equal(result.ok,true)
    assert.equal(result.key,'QR-FIXTURE-KEY')
    assert.match(result.qr,/^data:image\/png;base64,/)
    const png=Buffer.from(result.qr.slice('data:image/png;base64,'.length),'base64')
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
    assert.doesNotMatch(raw,/example\.invalid/)
  }finally{global.fetch=originalFetch;rmSync(home,{recursive:true,force:true})}
})
