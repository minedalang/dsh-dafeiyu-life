import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,mkdirSync,existsSync,rmSync,readFileSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {createVisionEnvironmentRepair} from '../lib/vision-environment-repair.mjs'
import {visionPythonCandidates} from '../lib/vision-python-runtime.mjs'

function setup(){
  const root=mkdtempSync(join(tmpdir(),'vision-auto-'))
  const home=join(root,'home'),base=join(root,'Python312','python.exe'),main=join(root,'main','python.exe'),req=join(root,'requirements.txt')
  for(const p of [home,join(root,'Python312'),join(root,'main')])mkdirSync(p,{recursive:true})
  for(const p of [base,main])writeFileSync(p,'fake executable')
  writeFileSync(req,'mcp>=1,<2\n')
  return {root,home,base,main,req,clean(){rmSync(root,{recursive:true,force:true})}}
}
const status=(x)=>({ok:x,reason:x?'healthy':'runtime_permission_error'})

test('healthy existing visual Python is reused without install or rebuild',async()=>{
  const f=setup();let invoked=0,saved=''
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      preferred:()=>f.base,probe:()=>status(true),run:async()=>{invoked++;return {ok:true}},
      persist:async p=>{saved=p;return true}})
    const r=await repair.run();assert.equal(r.state,'ready');assert.equal(r.reason,'already_healthy');
    assert.equal(saved,f.base);assert.equal(invoked,0)
  }finally{f.clean()}
})

test('unhealthy main Python is skipped; native copies and deps are verified before publishing isolated path',async()=>{
  const f=setup();let published='',packages=false;const invocations=[]
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      preferred:()=>f.main,configured:()=>f.base,
      probe:(p,{requiresMcp})=>p===f.main?status(false):status(p===f.base?!requiresMcp:(!requiresMcp||packages)),
      run:async(cmd,args,opts)=>{
        invocations.push({cmd,args,opts})
        if(args[0]==='-m'&&args[1]==='venv'){
          mkdirSync(join(args[3],'Scripts'),{recursive:true});writeFileSync(join(args[3],'Scripts','python.exe'),'fake')
        }else if(args[0]==='-m'&&args[1]==='pip')packages=true
        return {ok:true}
      },persist:async path=>{published=path;return true}})
    const result=await repair.run()
    assert.equal(result.state,'ready');assert.equal(result.reason,'healthy_installed')
    assert.ok(published.includes('.vision-env-'));assert.ok(existsSync(published))
    assert.ok(invocations.some(x=>x.args[0]==='-m'&&x.args[1]==='venv'&&x.args[2]==='--copies'))
    assert.ok(invocations.every(x=>x.opts.cwd===f.home))
    assert.equal(existsSync(f.main),true);assert.ok(invocations.every(x=>x.cmd!==f.main))
  }finally{f.clean()}
})

test('advanced Python storage partition creates the rebuilt vision environment on the selected runtime disk',async()=>{
  const f=setup(),runtimeRoot=join(f.root,'D-drive','DSHData','pythonData');let published='',packages=false
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,runtimeRoot,requirementsFile:f.req,
      preferred:()=>f.main,configured:()=>f.base,
      probe:(p,{requiresMcp})=>p===f.main?status(false):p===f.base?status(!requiresMcp):status(!requiresMcp||packages),
      run:async(_cmd,args)=>{
        if(args[0]==='-m'&&args[1]==='venv'){
          const target=args[3];mkdirSync(join(target,'Scripts'),{recursive:true});writeFileSync(join(target,'Scripts','python.exe'),'new visual runtime')
        }else if(args[0]==='-m'&&args[1]==='pip')packages=true
        return {ok:true}
      },persist:async path=>{published=path;return true}})
    const result=await repair.run()
    assert.equal(result.state,'ready');assert.ok(published.startsWith(runtimeRoot))
    assert.equal(existsSync(dirname(dirname(published))),true)
    assert.equal(existsSync(f.base),true);assert.equal(existsSync(f.main),true)
  }finally{f.clean()}
})

test('advanced rebuild does not reuse the previous plugin-owned vision venv from the old home',async()=>{
  const f=setup(),runtimeRoot=join(f.root,'external-python');let saved='',packages=false
  const oldManaged=join(f.home,'.vision-env-old','Scripts','python.exe')
  mkdirSync(join(f.home,'.vision-env-old','Scripts'),{recursive:true});writeFileSync(oldManaged,'old managed python')
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,runtimeRoot,requirementsFile:f.req,
      preferred:()=>oldManaged,configured:()=>f.base,
      probe:(p,{requiresMcp})=>p===oldManaged?status(true):p===f.base?status(!requiresMcp):status(!requiresMcp||packages),
      run:async(_cmd,args)=>{
        if(args[0]==='-m'&&args[1]==='venv'){
          const target=args[3];mkdirSync(join(target,'Scripts'),{recursive:true});writeFileSync(join(target,'Scripts','python.exe'),'new managed python')
        }else if(args[0]==='-m'&&args[1]==='pip')packages=true
        return {ok:true}
      },persist:async path=>{saved=path;return true}})
    const result=await repair.run()
    assert.equal(result.state,'ready');assert.ok(saved.startsWith(runtimeRoot))
    assert.equal(readFileSync(oldManaged,'utf8'),'old managed python')
  }finally{f.clean()}
})

test('if every interpreter fails unprivileged probe, installer remains fail-closed',async()=>{
  const f=setup();let calls=0,save=0
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      preferred:()=>f.base,configured:()=>f.main,probe:()=>status(false),
      run:async()=>{calls++;return {ok:true}},persist:async()=>{save++;return true}})
    const result=await repair.run();assert.equal(result.state,'failed');assert.equal(result.reason,'no_healthy_base_python')
    assert.equal(calls,0);assert.equal(save,0)
  }finally{f.clean()}
})

test('incomplete native venv creation never changes existing runtime',async()=>{
  const f=setup();let save=0
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      preferred:()=>f.base,probe:(_,{requiresMcp})=>status(!requiresMcp),
      run:async()=>({ok:false}),persist:async()=>{save++}})
    const result=await repair.run();assert.equal(result.state,'failed');assert.equal(result.reason,'vision_venv_creation_failed')
    assert.equal(existsSync(f.base),true);assert.equal(save,0)
  }finally{f.clean()}
})

test('failed dependency installation is not considered repaired and cannot update cfg',async()=>{
  const f=setup();let save=0
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      preferred:()=>f.base,probe:(_,{requiresMcp})=>status(!requiresMcp),
      run:async(_cmd,args)=>{
        if(args[1]==='venv'){
          mkdirSync(join(args[3],'Scripts'),{recursive:true});writeFileSync(join(args[3],'Scripts','python.exe'),'fake')
          return {ok:true}
        }
        return {ok:false}
      },findUv:async()=>'',persist:async()=>{save++}})
    const result=await repair.run();assert.equal(result.state,'failed');assert.equal(result.reason,'vision_dependencies_install_failed');assert.equal(save,0)
  }finally{f.clean()}
})

test('a duplicate click cannot start a second installer while the first is in progress',async()=>{
  const f=setup();let release
  try{
    const gate=new Promise(resolve=>{release=resolve})
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      preferred:()=>f.base,probe:(_,{requiresMcp})=>status(!requiresMcp),
      run:async()=>{await gate;return {ok:false}},persist:async()=>true})
    assert.equal(repair.start().started,true)
    assert.equal(repair.start().busy,true)
    assert.equal(repair.status().installing,true)
    release()
    // runRepair is async; settled after the awaited spawn completes
    for(let i=0;i<50&&repair.status().installing;i++)await new Promise(r=>setTimeout(r,5))
    assert.equal(repair.status().installing,false)
  }finally{f.clean()}
})

test('native UI has a single opt-in repair action, fixed routes and no script dependency',()=>{
  const root=new URL('../',import.meta.url)
  const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
  const ui=readFileSync(new URL('lib/management-console.js',root),'utf8')
  const index=readFileSync(new URL('index.js',root),'utf8')
  const mod=readFileSync(new URL('lib/vision-environment-repair.mjs',root),'utf8')
  assert.match(html,/id="vision-python-auto-repair"/)
  assert.match(ui,/request\('\/dsh-vision\/repair',\{\}\)/)
  assert.match(index,/path==='\/api\/bili-duty\/dsh-vision\/repair'/)
  assert.match(index,/sec-fetch-site/)
  assert.match(mod,/shell:false/)
  assert.doesNotMatch(mod,/icacls|takeown|runas|powershell\.exe/i)
})

test('offline PowerShell scripts parse as UTF-8 with BOM in Windows PowerShell 5.1',()=>{
  const root=new URL('../',import.meta.url)
  for(const file of ['repair-dsh-python-runtime.ps1','repair-dsh-vision-python.ps1']){
    const buf=readFileSync(new URL('tools/'+file,root))
    assert.deepEqual([...buf.subarray(0,3)],[0xef,0xbb,0xbf])
    assert.ok(buf.toString('utf8').includes('Python'))
  }
})

test('Windows candidate discovery recognizes ordinary Python installs without Conda',()=>{
  const f=setup()
  try{
    const list=visionPythonCandidates({preferred:f.base,platform:'win32',home:f.home,workdir:f.home,
      env:{Path:join(f.root,'Python312')+';'+join(f.root,'main'),USERPROFILE:join(f.root,'none')}})
    assert.ok(list.includes(f.base));assert.ok(list.includes(f.main))
  }finally{f.clean()}
})

test('first-time Windows users without Python can bootstrap through uv, but the new runtime must still pass health tests',async()=>{
  const f=setup();let newPython='',installed=false,saved=''
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      probe:(p,{requiresMcp})=>p===newPython?status(!requiresMcp||installed):status(false),
      findUv:async()=>join(f.root,'uv.exe'),
      run:async(_cmd,args)=>{
        if(args[0]==='venv'){
          newPython=join(args[4],'Scripts','python.exe')
          mkdirSync(join(args[4],'Scripts'),{recursive:true});writeFileSync(newPython,'fake')
        }else if(args[0]==='-m'&&args[1]==='pip')installed=true
        return {ok:true}
      },persist:async path=>{saved=path;return true}})
    const result=await repair.run()
    assert.equal(result.state,'ready');assert.equal(saved,newPython)
    assert.equal(existsSync(f.base),true);assert.ok(saved.includes('.vision-env-'))
  }finally{f.clean()}
})

test('uv-bootstrap newly created Python blocked by Windows policy never becomes active',async()=>{
  const f=setup();let save=0
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      probe:()=>status(false),findUv:async()=>join(f.root,'uv.exe'),
      run:async(_cmd,args)=>{
        mkdirSync(join(args[4],'Scripts'),{recursive:true});writeFileSync(join(args[4],'Scripts','python.exe'),'fake');return {ok:true}
      },persist:async()=>{save++}})
    const result=await repair.run();assert.equal(result.state,'failed');assert.equal(result.reason,'runtime_permission_error');assert.equal(save,0)
  }finally{f.clean()}
})

test('when Conda base is healthy but lacks ensurepip, uv fallback touches only the new visual directory',async()=>{
  const f=setup();let published='',modulesReady=false,bootstrapped=false,uvAttempt=0
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      preferred:()=>f.base,
      probe:(p,{requiresMcp})=>p===f.base?status(!requiresMcp):status(!requiresMcp||modulesReady),
      run:async(cmd,args)=>{
        if(args[0]==='-m'&&args[1]==='venv')return {ok:false}
        if(args[0]==='venv'){
          uvAttempt++
          assert.deepEqual(args.slice(0,5),['venv','--clear','--seed','--python',f.base])
          const target=args[5];assert.ok(target.startsWith(f.home))
          mkdirSync(join(target,'Scripts'),{recursive:true});writeFileSync(join(target,'Scripts','python.exe'),'fixture')
          bootstrapped=true
          return {ok:true}
        }
        if(args[0]==='-m'&&args[1]==='pip')modulesReady=true
        return {ok:true}
      },findUv:async()=>join(f.root,'uv.exe'),persist:async p=>{published=p;return true}})
    const outcome=await repair.run()
    assert.equal(outcome.state,'ready');assert.equal(uvAttempt,1);assert.equal(bootstrapped,true)
    assert.ok(published.includes('.vision-env-'));assert.equal(existsSync(f.base),true)
  }finally{f.clean()}
})

test('Windows external modelData cannot repair with an unattested arbitrary runtime directory',async()=>{
  const f=setup(),media=join(f.root,'relocated-modelData'),runtimeRoot=join(f.root,'custom-python-root')
  mkdirSync(media)
  let probes=0,installs=0,saved=0
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,runtimeRoot,requirementsFile:f.req,
      env:{DSH_MEDIA_CACHE_HOME:media,BILI_DUTY_HOME:f.home},preferred:()=>f.base,
      probe:()=>{probes++;return {ok:true}},run:async()=>{installs++;return {ok:true}},
      persist:async()=>{saved++;return true}})
    const result=await repair.run()
    assert.equal(result.state,'failed')
    assert.equal(result.reason,'trusted_host_runtime_required')
    assert.equal(result.stage,'prepare_runtime')
    assert.equal(probes,0)
    assert.equal(installs,0)
    assert.equal(saved,0)
    assert.equal(existsSync(runtimeRoot),false)
  }finally{f.clean()}
})

test('repeated unsuccessful repair is throttled without creating more environments',async()=>{
  const f=setup();let attempt=0,now=100000
  try{
    const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,
      clock:()=>now,cooldownMs:600000,env:{},
      preferred:()=>f.base,probe:(python,opts)=>({ok:python===f.base&&!opts.requiresMcp,reason:'missing_mcp_dependencies'}),
      run:async(_cmd,args)=>{
        if(args[0]==='-m'&&args[1]==='venv')attempt++
        return {ok:false}
      },persist:async()=>{throw Error('must never publish')}})
    assert.equal((await repair.run()).state,'failed')
    assert.equal(attempt,1)
    assert.equal(repair.start().reason,'repair_retry_cooldown')
    assert.equal((await repair.run()).reason,'repair_retry_cooldown')
    assert.equal(attempt,1)
    now+=600001
    assert.equal((await repair.run()).state,'failed')
    assert.equal(attempt,2)
  }finally{f.clean()}
})

test('Windows external modelData forbids rebuilding another Low-inheriting environment inside Duty Home',async()=>{
 const f=setup();let installs=0
 try{
  const external=join(f.root,'external-modelData');mkdirSync(external)
  const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,runtimeRoot:f.home,
    requirementsFile:f.req,env:{DSH_MEDIA_CACHE_HOME:external},
    preferred:()=>f.base,probe:()=>status(true),run:async()=>{installs++;return {ok:true}}})
  const result=await repair.run()
  assert.equal(result.state,'failed')
  assert.equal(result.reason,'trusted_host_runtime_required')
  assert.equal(result.stage,'prepare_runtime')
  assert.equal(installs,0)
  assert.equal(existsSync(join(f.home,'.vision-env-')),false)
 }finally{f.clean()}
})

test('offline environment quarantine protects explicit interpreters, dependency bases and unrelated data; no deletion',async()=>{
 const {inspectVisionEnvironments,quarantineVisionEnvironments}=await import('../lib/vision-environment-maintenance.mjs')
 const f=setup(),now=1800000000000
 try{
  const active='.vision-env-1794883710603-ba2c0851',unused='.vision-env-1794884037756-af9fda09',base='.vision-env-1794888820105-cbab4d42-0'
  for(const name of [active,unused,base]){mkdirSync(join(f.home,name,'Scripts'),{recursive:true});writeFileSync(join(f.home,name,'Scripts','python.exe'),'test executable');writeFileSync(join(f.home,name,'pyvenv.cfg'),'home = '+f.root+'\n')}
  writeFileSync(join(f.home,active,'pyvenv.cfg'),'home = '+join(f.home,base)+'\n')
  const python=join(f.home,active,'Scripts','python.exe');const cfg=join(f.home,'config.json');writeFileSync(cfg,JSON.stringify({pythonPath:python,visionPythonPath:python}));mkdirSync(join(f.home,'life-memory'));writeFileSync(join(f.home,'life-memory','episodic.json'),'unchanged')
  const options={root:f.home,configured:python,preferred:python,selected:python,env:{},platform:'win32',now}
  const plan=inspectVisionEnvironments(options);assert.equal(plan.available,true,plan.reason);assert.equal(plan.count,1);assert.equal(plan.entries.find(r=>r.name===active).status,'protected');assert.equal(plan.entries.find(r=>r.name===base).status,'protected');assert.equal(plan.entries.find(r=>r.name===unused).status,'candidate')
  const offline={token:plan.token,platform:'win32',env:{},now:now+1000};assert.throws(()=>quarantineVisionEnvironments({...offline,checkStopped:()=>({ok:false})}),/仍有/);assert.ok(existsSync(join(f.home,unused)))
  writeFileSync(cfg,JSON.stringify({pythonPath:python,visionPythonPath:python,changed:true}));assert.throws(()=>quarantineVisionEnvironments({...offline,checkStopped:()=>({ok:true})}),/已变化/);assert.ok(existsSync(join(f.home,unused)))
  writeFileSync(cfg,JSON.stringify({pythonPath:python,visionPythonPath:python}));assert.throws(()=>quarantineVisionEnvironments({...offline,now:now+31*60_000,checkStopped:()=>({ok:true})}),/失效/)
  const result=quarantineVisionEnvironments({...offline,checkStopped:()=>({ok:true})});assert.equal(result.ok,true,result.error);assert.equal(result.moved.length,1);assert.equal(existsSync(join(f.home,unused)),false);assert.equal(readFileSync(join(f.home,unused.replace('.vision-env-','.vision-retired-'),'Scripts','python.exe'),'utf8'),'test executable');assert.ok(existsSync(python));assert.equal(readFileSync(join(f.home,'life-memory','episodic.json'),'utf8'),'unchanged')
  const after=inspectVisionEnvironments(options);assert.equal(after.count,0);assert.ok(after.entries.some(r=>r.status==='retired'))
  assert.equal(inspectVisionEnvironments({...options,preferred:''}).available,false);assert.equal(inspectVisionEnvironments({...options,repairBusy:true}).available,false)
 }finally{f.clean()}
})


test('dev.30 failed fresh repair removes only the exclusively created unpublished directory',async()=>{
 const f=setup(),historical=join(f.home,'.vision-env-1794883710603-ba2c0851');mkdirSync(historical);writeFileSync(join(historical,'keep'),'old')
 try{
  const repair=createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,preferred:()=>f.base,probe:(_,{requiresMcp})=>status(!requiresMcp),run:async(_cmd,args)=>{if(args[1]==='venv')writeFileSync(join(args[3],'partial'),'new');return {ok:false,reason:'nonzero_exit'}},persist:async()=>{throw Error('never publish')}})
  const result=await repair.run();assert.equal(result.state,'failed');assert.ok(result.removedAttempts>=1);assert.deepEqual(readdirSync(f.home).filter(x=>x.startsWith('.vision-env-')), [historical.split(/[\\/]/).at(-1)]);assert.equal(readFileSync(join(historical,'keep'),'utf8'),'old');assert.ok(existsSync(f.base))
 }finally{f.clean()}
})

test('dev.30 timeout and uncertain publication retain the attempted runtime rather than deleting a potentially used interpreter',async()=>{
 const f=setup();let target='',mode='timeout'
 try{
  const create=()=>createVisionEnvironmentRepair({platform:'win32',home:f.home,requirementsFile:f.req,preferred:()=>f.base,probe:(p,{requiresMcp})=>status(p===f.base?!requiresMcp:!!target&&p===join(target,'Scripts','python.exe')),run:async(_cmd,args)=>{if(args[1]==='venv'){target=args[3];mkdirSync(join(target,'Scripts'),{recursive:true});writeFileSync(join(target,'Scripts','python.exe'),'test');if(mode==='timeout')return {ok:false,reason:'timeout'}}return {ok:true}},persist:async()=>false})
  let r=await create().run();assert.equal(r.state,'failed');assert.equal(r.retainedAttempts,1);assert.ok(existsSync(target));const first=target
  mode='persist';r=await create().run();assert.equal(r.reason,'vision_path_save_failed');assert.ok(existsSync(target));assert.ok(existsSync(first));assert.ok(existsSync(f.base))
 }finally{f.clean()}
})
