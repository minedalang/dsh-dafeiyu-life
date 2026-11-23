import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,copyFileSync,existsSync,readdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {migrateDomainOffline} from '../lib/storage-layout.mjs'
import {verifyVisionPythonCacheRoute} from '../lib/storage-vision-runtime-check.mjs'
import {verifyRelocatedModelRuntime} from '../lib/storage-model-runtime-check.mjs'

const put=(p,value)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,value)}
const run=async fn=>{
 const tmp=mkdtempSync(join(tmpdir(),'dev3-vision-route-')),root=join(tmp,'duty')
 try{
  mkdirSync(root)
  put(join(root,'.hf-cache','dummy'),'small')
  put(join(root,'embedding-runtime','dummy'),'small')
  put(join(root,'vision-cache','cached.json'),'{}')
  const target=join(tmp,'external','modelData')
  migrateDomainOffline({root,domain:'model',target,confirmedStopped:true})
  return await fn({root,target,tmp})
 }finally{rmSync(tmp,{recursive:true,force:true})}
}
test('path mismatch after migration fails fast before spawning Python or reading old C cache',()=>run(async({root,target})=>{
 put(join(root,'preview_vision.py'),'# real entrypoint presence checked before the route probe')
 let spawned=false
 const result=await verifyVisionPythonCacheRoute({root,python:'python3',env:{BILI_DUTY_HOME:root,DSH_MEDIA_CACHE_HOME:root},
  spawnImpl:()=>{spawned=true;throw Error('must not spawn')}})
 assert.deepEqual([result.ok,result.code],[false,'media_route_mismatch'])
 assert.equal(spawned,false)
 assert.ok(existsSync(join(target,'vision-cache','cached.json')))
}))
test('real Python preview cache writer round trips only on relocated modelData',t=>run(async({root,target})=>{
 const py=process.platform==='win32'?'python':'python3'
 if(spawnSync(py,['-c','from PIL import Image'],{timeout:5000}).status!==0){t.skip('Python and Pillow not installed in test runner');return}
 for(const name of ['preview_vision.py','video_traffic.py'])copyFileSync(new URL('../lib/'+name,import.meta.url),join(root,name))
 const env={...process.env,BILI_DUTY_HOME:root,DSH_MEDIA_CACHE_HOME:target}
 const ok=await verifyVisionPythonCacheRoute({root,python:py,env})
 assert.equal(ok.ok,true,JSON.stringify(ok))
 assert.equal(ok.code,'verified')
 assert.ok(existsSync(join(target,'vision-cache','cached.json')))
 assert.deepEqual(readdirSync(join(target,'vision-cache')).sort(),['cached.json'])
 assert.equal(existsSync(join(root,'vision-cache','cached.json')),true,'retained source is never touched')
}))
test('separate Ollama image success can no longer pass migration readiness if Python video route fails',()=>run(async({root})=>{
 const result=await verifyRelocatedModelRuntime({root,asrPython:'none',asrModel:'small',visionEnabled:true,
  embeddingRuntime:null,visionMode:'independent_local',visionPipelineProbe:async()=>({ok:false,code:'media_route_mismatch',reason:'mismatch'}),
  visionLocalModels:{verifyId:async()=>{throw Error('model selftest must not hide path failure')}}})
 assert.equal(result.checks.visionPipeline.code,'media_route_mismatch')
 assert.equal(result.checks.vision.ok,false)
 assert.equal(result.ready,false)
}))
test('visual feature disabled does not require Python inference runtime',()=>run(async({root})=>{
 const result=await verifyRelocatedModelRuntime({root,visionEnabled:false,visionPipelineProbe:async()=>{throw Error('should not run')}})
 assert.equal(result.checks.visionPipeline.notApplicable,true)
 assert.equal(result.checks.vision.notApplicable,true)
}))

test('all spawned video runtimes prioritize the migrated storage route over inherited shell env',()=>{
 const code=requireSource('index.js')
 assert.match(code,/const storagePyEnv = \(extra=\{\}\)=>pyEnv\(\{[\s\S]*?\.\.\.extra,[\s\S]*?HF_HOME:storageDataPath\(stateDir,'\.hf-cache'\),[\s\S]*?DSH_MEDIA_CACHE_HOME:storageDomainRoot\(stateDir,'media'\)/)
 assert.match(code,/env:visionEnv\(\{\.\.\.route\.env,BILI_DUTY_HOME:stateDir\}\)/)
 assert.match(code,/env:visionEnv\(\{\.\.\.dsh\.env,BILI_DUTY_HOME:stateDir\}\)/)
})
function requireSource(name){return readFileSync(new URL('../'+name,import.meta.url),'utf8')}
