import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,relative,isAbsolute} from 'node:path'
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
  assert.match(backend,/installOutcome = installedHealthy && venvReadyNow\(\) \? 'ready' : 'failed'/)
  assert.match(backend,/if \(!venvReadyNow\(\)\) return sendJson\(res,409,\{ok:false,error:'B站主依赖尚未就绪/)
})

test('fresh install: status remains unready and QR start is blocked before dependencies exist',async()=>{
  const home=mkdtempSync(join(tmpdir(),'fish-coldstart-deps-'))
  let handler
  try{
    const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
      logger:{info(){},warn(){}},tools:{register(){}},
      connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(opts){handler=opts.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
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
  assert.match(section,/try\{main=await request\('\/status'\)\}catch\(e\)\{setupMainReady=null;setupMainInstalling=false;\$\('fs-bili-start'\)\.disabled=true;renderSetupGuide\(onboarding\);throw e\}/)
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
      logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
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
      logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
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

test('offline QR route uses the plugin-local Python on Windows/Linux without network or credential leakage',async()=>{
  const {mkdirSync,writeFileSync}=await import('node:fs')
  const {spawnSync}=await import('node:child_process')
  const home=mkdtempSync(join(tmpdir(),'fish-qr-success-'))
  const originalFetch=global.fetch
  let handler
  try{
    const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
      logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
    apply(ctx,{})
    const state=join(home,'bili-duty'),venv=join(state,'.venv')
    // A real local venv supplies the actual native executable. No Windows symlink,
    // Linux shell wrapper, network access, or preinstalled qrcode is required.
    const basePython=process.env.PYTHON||(process.platform==='win32'?'python':'python3')
    const built=spawnSync(basePython,['-m','venv','--without-pip',venv],{encoding:'utf8',timeout:90000,windowsHide:true})
    assert.equal(built.status,0,`local Python venv must work: ${built.error?.code||built.status}`)
    // Probe the *created* venv rather than assuming Python 3.12: CI currently
    // uses 3.11, while developer machines may use a different minor version.
    const py=process.platform==='win32'?join(venv,'Scripts','python.exe'):join(venv,'bin','python')
    const probe=spawnSync(py,['-c','import sysconfig; print(sysconfig.get_paths()["purelib"])'],
      {encoding:'utf8',timeout:15000,windowsHide:true})
    assert.equal(probe.status,0,`venv site-packages probe failed: ${probe.error?.code||probe.stderr||probe.status}`)
    const packages=probe.stdout.trim()
    const rel=relative(venv,packages)
    assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'site-packages must reside in the test venv')
    for(const dep of ['bilibili_api','mcp','qrcode'])mkdirSync(join(packages,dep),{recursive:true})
    // Hermetic qrcode.py verifies the JS=>venv=>PNG bridge, not the external QR
    // encoding library. Real QR encoding is an installation/runtime acceptance.
    const fakeQr=[
      'from pathlib import Path',
      'import struct, zlib',
      'def _chunk(tag, raw):',
      '    return struct.pack("!I", len(raw))+tag+raw+struct.pack("!I",zlib.crc32(tag+raw)&0xffffffff)',
      'class _FixtureImage:',
      '    def __init__(self, value):',
      '        if not value.startswith("https://example.invalid/qr?key="): raise ValueError("unexpected QR URL")',
      '    def save(self, path):',
      '        png=(b"\\x89PNG\\r\\n\\x1a\\n"+_chunk(b"IHDR",struct.pack("!IIBBBBB",1,1,8,2,0,0,0))',
      '             +_chunk(b"IDAT",zlib.compress(b"\\x00\\x00\\x80\\xff"))+_chunk(b"IEND",b""))',
      '        Path(path).write_bytes(png)',
      'def make(value): return _FixtureImage(value)',
    ].join('\n')+'\n'
    writeFileSync(join(state,'qrcode.py'),fakeQr)
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


// Exercise the production runInstall body on a simulated Windows host. No
// network access, real package install, system ACL modification or real user data.
async function runColdInstall({uv='uv',explicit='',base='',old=false,failProbe='',failPackages=false,failCreate=false,highVersion=false}={}){
  const {runInNewContext}=await import('node:vm')
  const source=read('index.js'),body=source.slice(source.indexOf('  const runInstall = () => {'),source.indexOf('  /** 「测一下」'))
  const home='C:/fixture',root=home+'/.venv',py=root+'/Scripts/python.exe';let files=new Set(old?[root,py]:[]),logs=[],calls=[],stages=[],published=[],renames=[]
  let depReady=old,created=false
  const rename=(from,to)=>{assert.ok(files.has(from),from);assert.ok(!files.has(to),to);files=new Set([...files].map(f=>f===from||f.startsWith(from+'/')?to+f.slice(from.length):f));renames.push([from,to])}
  const sandbox={process:{platform:'win32',env:explicit?{BILI_DUTY_VENV_PYTHON:explicit}:{},cwd:()=>home},join:(...xs)=>xs.join('/'),pluginDir:'C:/plugin',stateDir:home,cfg:{pythonPath:'python'},
    storageDataPath:(_home,...xs)=>home+'/'+xs.join('/'),venvPython:()=>py,existsSync:f=>files.has(f),
    readFileSync:()=>{if(highVersion)return 'version = 3.14.1';throw Error('absent')},renameSync:rename,
    resolveUv:async()=>uv,probeCmd:async()=>!!base,storagePyEnv:()=>({}),
    selectVisionPython:()=>base?{ok:true,path:base}:{ok:false,reason:'missing_runtime'},
    probeVisionPython:(p,{requiresMcp})=>{calls.push(['probe',p,requiresMcp]);if(p!==py)return {ok:p===base,reason:p===base?'healthy':'missing_runtime'};
      if(!created)return {ok:false,reason:'runtime_permission_error',stage:'temp'};
      return failProbe===(requiresMcp?'final':'initial')?{ok:false,reason:'runtime_permission_error',stage:'media_cache'}:{ok:true,reason:'healthy'}},
    spawnLogged:async(cmd,args)=>{calls.push([cmd,...args]);if(args[0]==='venv'||args[1]==='venv'){created=true;files.add(root);files.add(py);depReady=false;return failCreate?1:0}
      if(failPackages)return 1;depReady=true;return 0},persistCfg:async v=>{published.push(v);return {host:{ok:true}}},missingVenvDeps:()=>depReady?[]:['mcp'],venvReadyNow:()=>files.has(py)&&depReady,
    installLogFile:'fixture.log',appendInstall:s=>logs.push(s),log:()=>{},installing:false,installOutcome:'',installFailureHint:'',installProgress:{phase:'idle',completed:0},visionPythonCache:null,
    installStage:(phase,completed)=>{sandbox.installProgress={phase,completed};stages.push([phase,completed])}}
  const accepted=runInNewContext(body+'\nrunInstall()',sandbox);assert.equal(accepted.started,true)
  for(let n=0;sandbox.installing&&n<100;n++)await new Promise(resolve=>setImmediate(resolve))
  assert.equal(sandbox.installing,false)
  return {sandbox,calls,stages,logs:logs.join(''),published,renames,files,root,py}
}

test('Windows clean install provisions pinned managed Python through uv and checks exact new executable before packages',async()=>{
  const r=await runColdInstall()
  assert.deepEqual(r.stages,[['checking',0],['environment',1],['packages',2],['verifying',3],['ready',4]])
  assert.equal(r.sandbox.installOutcome,'ready')
  assert.deepEqual([...r.calls[0]],['uv','venv','--seed','--python','3.12','--managed-python',r.root])
  assert.deepEqual([...r.calls[1]],['probe',r.py,false]);assert.equal(r.calls[2][1],'pip');assert.deepEqual([...r.calls.at(-1)],['probe',r.py,true])
  assert.equal(r.published[0].pythonPath,r.py)
})
test('failed managed Python probe never installs packages or publishes readiness; failed candidate is preserved',async()=>{
  const r=await runColdInstall({failProbe:'initial'})
  assert.equal(r.sandbox.installOutcome,'failed');assert.deepEqual(r.stages.at(-1),['failed',1]);assert.equal(r.published.length,0)
  assert.equal(r.calls.some(c=>c.includes('pip')),false);assert.match(r.logs,/runtime_permission_error \/ media_cache/)
  assert.equal(r.files.has(r.root),false);assert.ok(r.renames[0][1].startsWith(r.root+'.failed-'))
})
test('unhealthy old environment restored when replacement creation or final validation fails',async()=>{
  for(const params of [{old:true,failCreate:true},{old:true,failProbe:'final'},{old:true,highVersion:true,failPackages:true}]){
    const r=await runColdInstall(params)
    assert.equal(r.sandbox.installOutcome,'failed');assert.equal(r.published.length,0);assert.equal(r.files.has(r.py),true)
    assert.ok(r.renames[0][1].startsWith(r.root+'.'));assert.equal(r.renames.at(-1)[1],r.root);assert.notEqual(r.stages.at(-1)[1],4)
  }
})
test('explicit invalid interpreter is not silently replaced, missing uv fails safely, supported version selector provisions via uv',async()=>{
  for(const params of [{explicit:'C:/invalid/python.exe'},{uv:''}]){
    const r=await runColdInstall(params);assert.equal(r.sandbox.installOutcome,'failed');assert.equal(r.calls.some(c=>c.includes('venv')),false);assert.equal(r.published.length,0)
  }
  const r=await runColdInstall({explicit:'3.11'});assert.equal(r.sandbox.installOutcome,'ready');assert.equal(r.calls[0][4],'3.11')
})
test('main dependency progress has a dedicated real-stage bar and failure log disclosure',()=>{
  const html=read('lib/management-console.html'),js=read('lib/management-console.js')
  for(const id of ['fs-main-deps-progress-wrap','fs-main-deps-progress','fs-main-deps-stage','fs-main-deps-count','fs-main-deps-details'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1)
  assert.match(js,/const p=main\.installProgress\|\|\{\}/);assert.match(js,/phase==='ready'\?4:steps/)
  assert.match(js,/lastMainInstallPhase!=='failed'\)\$\('fs-main-deps-details'\)\.open=true/)
})
