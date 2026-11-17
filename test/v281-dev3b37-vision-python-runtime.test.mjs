import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {visionPythonCandidates,probeVisionPython,selectVisionPython} from '../lib/vision-python-runtime.mjs'

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
