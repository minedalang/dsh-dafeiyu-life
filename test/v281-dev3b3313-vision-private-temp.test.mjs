import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {ensureVisionTempDir,visionPythonTempEnv,visionTempPath} from '../lib/vision-python-runtime.mjs'
import {createVisionEnvironmentRepair} from '../lib/vision-environment-repair.mjs'

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'dev3313-')),home=join(root,'home'),base=join(root,'Python312','python.exe'),req=join(root,'req.txt')
  mkdirSync(home);mkdirSync(join(root,'Python312'));writeFileSync(base,'fake');writeFileSync(req,'mcp\n')
  return {root,home,base,req,clean(){rmSync(root,{recursive:true,force:true})}}
}

test('a blocked global TEMP is replaced only in the visual child environment',()=>{
  const f=fixture()
  try{
    const parentEnv={TEMP:join(f.root,'denied-temp'),TMP:join(f.root,'denied-tmp'),TMPDIR:join(f.root,'denied-tmpdir'),Path:'C:\\Python312'}
    const original={...parentEnv}
    const result=visionPythonTempEnv({home:f.home,env:parentEnv,create:true})
    const expected=join(f.home,'tmp','vision')
    assert.equal(result.TEMP,expected);assert.equal(result.TMP,expected);assert.equal(result.TMPDIR,expected)
    assert.equal(existsSync(expected),true)
    assert.deepEqual(parentEnv,original)
    assert.equal(ensureVisionTempDir(f.home,{create:false}),expected)
    assert.equal(visionTempPath(f.home),expected)
  }finally{f.clean()}
})

test('read-only entry probe never creates a missing temp directory',()=>{
  const f=fixture()
  try{
    assert.throws(()=>visionPythonTempEnv({home:f.home,env:{TEMP:'blocked'},create:false}),/vision_temp_unavailable/)
    assert.equal(existsSync(join(f.home,'tmp')),false)
  }finally{f.clean()}
})

test('a link or file placed at the plugin temp path is rejected, not followed or changed',()=>{
  const f=fixture()
  try{
    const target=join(f.root,'external');mkdirSync(target)
    mkdirSync(join(f.home,'tmp'))
    try{symlinkSync(target,join(f.home,'tmp','vision'),'dir')}
    catch(error){if(!['EPERM','EACCES'].includes(error?.code))throw error;writeFileSync(join(f.home,'tmp','vision'),'file')}
    assert.throws(()=>visionPythonTempEnv({home:f.home,env:{},create:true}),/vision_temp_unavailable/)
    assert.equal(existsSync(target),true)
  }finally{f.clean()}
})

test('repair creates a venv and checks, installs and persists using the same local temp, without Conda',async()=>{
  const f=fixture();let installed=false,committed='',created='',checked=0
  try{
    const blocked=join(f.root,'system-temp-denied')
    const externalEnv={TEMP:blocked,TMP:blocked,TMPDIR:blocked,Path:join(f.root,'Python312')}
    const checkEnv=opts=>{
      const expected=join(f.home,'tmp','vision')
      assert.equal(opts.env.TEMP,expected);assert.equal(opts.env.TMP,expected);assert.equal(opts.env.TMPDIR,expected)
      assert.ok(existsSync(expected));checked++
    }
    const repair=createVisionEnvironmentRepair({home:f.home,requirementsFile:f.req,platform:'win32',env:externalEnv,
      preferred:()=>f.base,findUv:async()=>'',
      probe:async(p,opts)=>{
        checkEnv(opts)
        return {ok:!opts.requiresMcp||(p===created&&installed),reason:opts.requiresMcp&&!installed?'missing_mcp_dependencies':'healthy'}
      },
      run:async(cmd,args,opts)=>{
        checkEnv(opts)
        if(args[0]==='-m'&&args[1]==='venv'){
          created=join(args[3],'Scripts','python.exe')
          mkdirSync(join(args[3],'Scripts'),{recursive:true});writeFileSync(created,'fake')
        }
        if(args[0]==='-m'&&args[1]==='pip')installed=true
        return {ok:true}
      },
      persist:async p=>{committed=p;return true},
    })
    const result=await repair.run()
    assert.equal(result.state,'ready');assert.equal(result.reason,'healthy_installed')
    assert.equal(committed,created);assert.ok(checked>=5)
    assert.equal(externalEnv.TEMP,blocked);assert.equal(existsSync(f.base),true)
  }finally{f.clean()}
})

test('if the plugin-local temp is blocked, repair fails before starting or persisting any Python',async()=>{
  const f=fixture();let runs=0,probes=0,saves=0
  try{
    writeFileSync(join(f.home,'tmp'),'file, not directory')
    const repair=createVisionEnvironmentRepair({home:f.home,requirementsFile:f.req,platform:'win32',preferred:()=>f.base,
      probe:async()=>{probes++;return {ok:true}},run:async()=>{runs++;return {ok:true}},persist:async()=>{saves++}})
    const result=await repair.run()
    assert.equal(result.state,'failed');assert.equal(result.reason,'vision_temp_unavailable')
    assert.equal(runs,0);assert.equal(probes,0);assert.equal(saves,0)
  }finally{f.clean()}
})

test('production visual MCP, image selftest, model entry and installer connect to plugin-local temporary environment',()=>{
  const root=new URL('../',import.meta.url)
  const index=readFileSync(new URL('index.js',root),'utf8')
  const repair=readFileSync(new URL('lib/vision-environment-repair.mjs',root),'utf8')
  const helpers=readFileSync(new URL('lib/vision-python-runtime.mjs',root),'utf8')
  assert.match(index,/ensureVisionTempDir\(stateDir,\{create:true\}\)/)
  assert.match(index,/const visionEnv=extra=>visionPythonTempEnv/)
  assert.match(index,/env:visionEnv\(\),requiresMcp:true/)
  assert.match(index,/env:environment,requiresMcp:true,timeoutMs:3000/)
  assert.match(index,/const env=visionEnv\(\{BILI_DUTY_HOME:stateDir,BILI_VISION_DSH_ARGV:/)
  assert.match(index,/const env=visionEnv\(\{BILI_VISION_ENABLED:'0'/)
  assert.match(index,/BILI_VISION_PYTHON_REQUIRED/)
  assert.ok(index.includes("'          TMPDIR: '+yq(posix(visionTempPath(stateDir)))"))
  assert.match(repair,/visionPythonTempEnv\(\{home,env,create:true\}\)/)
  assert.match(repair,/probe\(childPython,\{home,env:repairEnv,requiresMcp:true\}\)/)
  assert.match(helpers,/TEMP:temp,TMP:temp,TMPDIR:temp/)
  assert.doesNotMatch(repair,/icacls|takeown|runas|powershell\.exe/i)
})
