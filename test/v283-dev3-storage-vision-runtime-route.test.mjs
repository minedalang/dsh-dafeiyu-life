import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,copyFileSync,existsSync,readdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {spawn,spawnSync} from 'node:child_process'
import {migrateDomainOffline,storageLayoutStatus,storageDomainRoot} from '../lib/storage-layout.mjs'
import {migrateLargeDataOffline,largeDataStatus} from '../lib/storage-large-data-v2.mjs'
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
test('V2 core media route runs real Python probe instead of demanding a relocated V1 media partition',()=>run(async({root,tmp})=>{
 put(join(root,'preview_vision.py'),'# present')
 const target=join(tmp,'v2','data')
 migrateLargeDataOffline({root,target,legacy:storageLayoutStatus(root),confirmedStopped:true,
  python:process.execPath,runtimeProbe:()=>true})
 assert.equal(largeDataStatus(root).configured,true)
 assert.equal(storageLayoutStatus(root).domains.media.configured,false)
 const media=storageDomainRoot(root,'media')
 assert.equal(media,join(root,'runtime-media-v2'))
 let started=false
 const result=await verifyVisionPythonCacheRoute({root,python:process.execPath,
  env:{BILI_DUTY_HOME:root,DSH_MEDIA_CACHE_HOME:media},
  spawnImpl:()=>{started=true;return spawn(process.execPath,['-e',
   "process.stdout.write('VISION_ROUTE_PROBE:ok\\n')"],{stdio:['ignore','pipe','ignore']})}})
 assert.equal(started,true,'V2 must reach Python instead of failing on retired V1 media status')
 assert.equal(result.ok,true,JSON.stringify(result))
 assert.match(result.reason,/当前生效缓存目录/)
}))
test('V2 real Python cache writer round trips in core sandbox, not in external model library',t=>run(async({root,tmp})=>{
 const py=process.platform==='win32'?'python':'python3'
 if(spawnSync(py,['-c','from PIL import Image'],{timeout:5000}).status!==0){
  t.skip('Python and Pillow not installed in test runner');return
 }
 for(const name of ['preview_vision.py','video_traffic.py'])copyFileSync(new URL('../lib/'+name,import.meta.url),join(root,name))
 const target=join(tmp,'v2','data')
 migrateLargeDataOffline({root,target,legacy:storageLayoutStatus(root),confirmedStopped:true,
  python:process.execPath,runtimeProbe:()=>true})
 const media=storageDomainRoot(root,'media')
 mkdirSync(media,{recursive:true})
 const result=await verifyVisionPythonCacheRoute({root,python:py,
  env:{...process.env,BILI_DUTY_HOME:root,DSH_MEDIA_CACHE_HOME:media}})
 assert.equal(result.ok,true,JSON.stringify(result))
 assert.equal(existsSync(join(target,'vision-cache')),false,'V2 must never write the external model library')
 assert.equal(existsSync(join(root,'vision-cache','cached.json')),true,'old cache remains untouched')
}))
test('V2 rejects old external cache route before launching Python',()=>run(async({root,tmp,target:legacy})=>{
 put(join(root,'preview_vision.py'),'# present')
 migrateLargeDataOffline({root,target:join(tmp,'v2','data'),legacy:storageLayoutStatus(root),
  confirmedStopped:true,python:process.execPath,runtimeProbe:()=>true})
 let started=false
 const result=await verifyVisionPythonCacheRoute({root,python:process.execPath,
  env:{BILI_DUTY_HOME:root,DSH_MEDIA_CACHE_HOME:legacy},
  spawnImpl:()=>{started=true;throw Error('wrong route must not launch')}})
 assert.equal(result.ok,false)
 assert.equal(result.code,'media_route_mismatch')
 assert.equal(started,false)
}))
test('slow Windows-style Python import reports its last stage instead of calling the route broken',()=>run(async({root,target})=>{
 put(join(root,'preview_vision.py'),'# present')
 const result=await verifyVisionPythonCacheRoute({root,python:'python',env:{BILI_DUTY_HOME:root,DSH_MEDIA_CACHE_HOME:target},
  timeoutMs:1100,
  spawnImpl:()=>spawn(process.execPath,['-e',
   "process.stdout.write('VISION_ROUTE_STAGE:python_started\\nVISION_ROUTE_STAGE:routes_validated\\nVISION_ROUTE_STAGE:pillow_imported\\n');setInterval(()=>{},1000)"],
   {stdio:['ignore','pipe','ignore']})})
 assert.equal(result.ok,false)
 assert.equal(result.code,'python_timeout')
 assert.equal(result.stage,'pillow_imported')
 assert.match(result.reason,/准备导入预览模块/)
 assert.doesNotMatch(result.reason,new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
}))

test('blocked Python cache atomic replacement reports the actual file operation',()=>run(async({root,target})=>{
 put(join(root,'preview_vision.py'),'# present')
 const result=await verifyVisionPythonCacheRoute({root,python:'python',env:{BILI_DUTY_HOME:root,DSH_MEDIA_CACHE_HOME:target},
  timeoutMs:1100,
  spawnImpl:()=>spawn(process.execPath,['-e',
   "process.stdout.write('VISION_ROUTE_STAGE:python_started\\nVISION_ROUTE_STAGE:preview_imported\\nVISION_ROUTE_STAGE:writer_replace_start\\n');setInterval(()=>{},1000)"],
   {stdio:['ignore','pipe','ignore']})})
 assert.equal(result.code,'python_timeout')
 assert.equal(result.stage,'writer_replace_start')
 assert.match(result.reason,/Python 原子替换/)
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

test('V2 native migration verifier uses a fresh fixed-model test and does not accept old, busy or wrong-disk evidence',()=>run(async({root,tmp})=>{
 const {nativeMigrationReviewEvidence}=await import('../lib/storage-model-runtime-check.mjs')
 const target=join(tmp,'v2','data')
 migrateLargeDataOffline({root,target,legacy:storageLayoutStatus(root),confirmedStopped:true,python:process.execPath,runtimeProbe:()=>true})
 const storage=largeDataStatus(root),id='qwen3.5-2b'
 let runs=0,result={testedAt:'old',answer:'old image',finishReason:'stop'},busy=false
 const runtime={paths:{root:join(root,'embedding-runtime'),modelRoot:storage.embeddingModelDir,visionRoot:storage.visionModelDir},
  status:()=>({server:{ready:true}}),embedQuery:async()=>new Float32Array(1024),
  runVision:async(action,model)=>{assert.equal(action,'verify');assert.equal(model,id);runs++;result={testedAt:'new',answer:'new image',finishReason:'stop'};return result},
  visionStatus:async()=>({busy,runtime:{installed:true},models:[{id,filesPresent:true,result}]})}
 const opts={root,embeddingRuntime:runtime,visionEnabled:true,visionMode:'independent_native',visionLocalModel:id,visionPipelineProbe:async()=>({ok:true})}
 const wrong=await verifyRelocatedModelRuntime({...opts,embeddingRuntime:{...runtime,paths:{...runtime.paths,visionRoot:join(root,'embedding-runtime','vision-models')}}})
 assert.equal(wrong.checks.vision.ok,false);assert.equal(runs,0)
 const blocked=await verifyRelocatedModelRuntime({...opts,visionPipelineProbe:async()=>({ok:false})})
 assert.equal(blocked.checks.vision.ok,false);assert.equal(runs,0)
 const verified=await verifyRelocatedModelRuntime(opts)
 assert.equal(runs,1);assert.equal(verified.checks.vision.pendingReview,true);assert.equal(verified.checks.vision.reviewId,'new');assert.equal(verified.ready,false)
 const review={root,runtime,model:id,reviewId:'new'}
 assert.equal((await nativeMigrationReviewEvidence(review)).answer,'new image')
 await assert.rejects(nativeMigrationReviewEvidence({...review,reviewId:'old'}),/失效/)
 busy=true;await assert.rejects(nativeMigrationReviewEvidence(review),/失效/);busy=false
 result={...result,finishReason:'length'};await assert.rejects(nativeMigrationReviewEvidence(review),/失效/)
 rmSync(join(target,'.dafeiyu-large-data-v2.json'));await assert.rejects(nativeMigrationReviewEvidence(review),/标记/)
}))
