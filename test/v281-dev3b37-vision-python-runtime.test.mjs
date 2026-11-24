import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,existsSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {VISION_PYTHON_PROBE_SOURCE,visionPythonCandidates,probeVisionPython,selectVisionPython} from '../lib/vision-python-runtime.mjs'

const root=mkdtempSync(join(tmpdir(),'dsh-python-gate-'))
const home=join(root,'home');mkdirSync(home)
const bad=join(root,'broken','python.exe'),good=join(root,'good','python.exe'),extra=join(root,'con','python.exe')
for(const file of [bad,good,extra]){mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,'fixture')}
process.on('exit',()=>{rmSync(root,{recursive:true,force:true})})
const receipt=(ok,deps=true,version=[3,12])=>({status:0,stdout:'VISION_PYTHON_CHECK:'+JSON.stringify({ok,version,deps})+'\n'})

test('Python candidate list rejects relative executables and duplicates',()=>{
 const list=visionPythonCandidates({preferred:bad,configured:bad,env:{BILI_DUTY_VISION_PYTHON:good},platform:'linux'})
 assert.deepEqual(list,[bad,good])
})
test('healthy Python requires both directory writes and all MCP imports',()=>{
 assert.deepEqual(probeVisionPython(good,{home,execute:()=>receipt(true,true)}),{ok:true,reason:'healthy'})
 assert.equal(probeVisionPython(bad,{home,execute:()=>receipt(false,true)}).reason,'runtime_permission_error')
 assert.equal(probeVisionPython(good,{home,execute:()=>receipt(true,false)}).reason,'missing_mcp_dependencies')
 assert.equal(probeVisionPython(good,{home,requiresMcp:false,execute:()=>receipt(true,false)}).ok,true)
})
test('fails closed on invalid/oversized/unexpected probe receipts, exit, version, timeout',()=>{
 assert.equal(probeVisionPython(bad,{home,execute:()=>({status:1,stdout:''})}).ok,false)
 assert.equal(probeVisionPython(bad,{home,execute:()=>({status:0,stdout:'not a check'})}).reason,'invalid_probe_receipt')
 assert.equal(probeVisionPython(bad,{home,execute:()=>receipt(true,true,[3,14])}).reason,'unsupported_python_version')
 assert.equal(probeVisionPython(bad,{home,execute:()=>({error:new Error('spawn fail')})}).ok,false)
 assert.equal(probeVisionPython(bad,{home,execute:()=>{throw Error('denied')}}).ok,false)
})
test('selects permitted healthy fallback, not a Python with a write denial',()=>{
 const attempts=[]
 const result=selectVisionPython({preferred:bad,configured:good,home,platform:'linux',
  execute:(file,args,opts)=>{attempts.push({file,args,opts});return receipt(file===good,true)}})
 assert.equal(result.ok,true);assert.equal(result.path,good);assert.equal(result.source,'fallback')
 assert.equal(attempts.length,2)
 for(const a of attempts){assert.equal(a.opts.shell,false);assert.equal(a.opts.windowsHide,true);assert.deepEqual(a.args,['-I','-']);assert.equal(a.opts.cwd,home);assert.ok(a.opts.input.includes('dsh-vision-health-'))}
})
test('if all interpreters fail, no unchecked Python is selected',()=>{
 const result=selectVisionPython({preferred:bad,configured:extra,home,platform:'linux',execute:()=>receipt(false,false)})
 assert.equal(result.ok,false);assert.equal(result.path,'')
})
test('no elevation or ACL changes are embedded in the runtime probe',()=>{
 const r=selectVisionPython({preferred:bad,home,platform:'linux',execute:()=>receipt(false,true)})
 assert.equal(r.ok,false)
})

test('reported failure follows the explicitly selected vision interpreter, not the unhealthy main venv',()=>{
 const first=selectVisionPython({preferred:good,configured:bad,home,platform:'linux',
   execute:(file)=>file===good?receipt(true,false):receipt(false,true)})
 assert.equal(first.ok,false)
 assert.equal(first.reason,'missing_mcp_dependencies')
 assert.equal(first.candidatesChecked,2)
 assert.equal(first.checks[1].reason,'runtime_permission_error')
})
test('write failure describes temp versus Duty Home without exposing filesystem paths',()=>{
 const reported=probeVisionPython(good,{home,execute:()=>({status:0,stdout:'VISION_PYTHON_CHECK:'+
   JSON.stringify({ok:false,version:[3,12],deps:true,stage:'duty_home'})+'\n'})})
 assert.deepEqual(reported,{ok:false,reason:'runtime_permission_error',stage:'duty_home'})
 assert.equal(JSON.stringify(reported).includes(root),false)
})
test('missing required modules are included only from the fixed allowlist',()=>{
 const r=probeVisionPython(good,{home,execute:()=>({status:0,stdout:'VISION_PYTHON_CHECK:'+
   JSON.stringify({ok:true,version:[3,12],deps:false,missingModules:['mcp','secret_user_path','bilibili_api']})+'\n'})})
 assert.deepEqual(r,{ok:false,reason:'missing_mcp_dependencies',missingModules:['mcp','bilibili_api']})
})

test('published relocated modelData is a mandatory Python write probe stage',()=>{
 const env={TEMP:home,TMP:home,DSH_MEDIA_CACHE_HOME:join(root,'external-modelData')}
 let received
 const result=probeVisionPython(good,{home,env,requiresMcp:false,execute:(_cmd,_args,opts)=>{
   received=opts.env.DSH_MEDIA_CACHE_HOME
   return {status:0,stdout:'VISION_PYTHON_CHECK:'+JSON.stringify({ok:false,version:[3,12],deps:true,stage:'media_cache'})+'\n'}
 }})
 assert.equal(received,env.DSH_MEDIA_CACHE_HOME)
 assert.deepEqual(result,{ok:false,reason:'runtime_permission_error',stage:'media_cache'})
})

test('isolated Python health source rejects unwritable migrated cache without creating data',t=>{
 const py=process.platform==='win32'?'python':'python3'
 const available=spawnSync(py,['-c','import sys'],{timeout:2500})
 if(available.status!==0){t.skip('Python not installed in test runner');return}
 const missingMedia=join(root,'external-missing-modelData')
 const env={...process.env,TEMP:home,TMP:home,DSH_MEDIA_CACHE_HOME:missingMedia}
 const exec=()=>spawnSync(py,['-I','-'],{cwd:home,env,input:VISION_PYTHON_PROBE_SOURCE,encoding:'utf8',timeout:4000})
 const out=exec()
 assert.equal(out.status,0,out.stderr)
 const raw=out.stdout.trim().split('VISION_PYTHON_CHECK:')[1]
 const payload=JSON.parse(raw)
 assert.equal(payload.ok,false)
 assert.equal(payload.stage,'media_cache')
 assert.equal(existsSync(missingMedia),false,'probe must never create a cache destination')
 mkdirSync(missingMedia)
 const yes=JSON.parse(exec().stdout.trim().split('VISION_PYTHON_CHECK:')[1])
 assert.equal(yes.ok,true)
 assert.equal(yes.writes.media_cache,true)
 assert.equal(readdirSync(missingMedia).length,0,'no probe data left in cache')
})
