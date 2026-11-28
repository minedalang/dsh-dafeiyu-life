import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {readProductionVisionStatus} from '../lib/vision-production-status.mjs'
import {systemHealthSnapshot} from '../lib/system-health-projection.mjs'

const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const ui=source('lib/management-console.js')
const html=source('lib/management-console.html')
const server=source('index.js')

// A migrated cache write failure must not be mistaken for DSH model routing.
test('video Debug labels saved Ollama route separately from actual visual result and cache failure',()=>{
  const py=source('lib/preview_vision.py')
  const worker=source('vendor/bilibili-mcp/mcp_server.py')
  assert.match(ui,/当前视觉模型配置（不是 DSH 主对话模型）/)
  assert.match(ui,/本轮视觉回执（与当前配置分开）/)
  assert.match(ui,/observedVisual\.cacheSaved===false/)
  assert.match(py,/os\.open\(/)
  assert.match(py,/cacheErrorCode/)
  assert.match(worker,/result\.get\('cacheErrorCode'\) or result\.get\('errorCode'\)/)
  assert.match(worker,/result\['mode'\]='independent_local'/)
})


function storageHarness(response){
  const start=ui.indexOf('  const loadStorageLocation=async()=>{')
  const end=ui.indexOf("  $('storage-refresh').addEventListener",start)
  assert.ok(start>0&&end>start,'actual V2 management loader found')
  const script=ui.slice(start,end)
  const elements=new Map(),notices=[]
  const $=id=>{
    if(!elements.has(id))elements.set(id,{id,dataset:{},hidden:false,disabled:false,textContent:'',
      replaceChildren(){},appendChild(){},querySelector(){return {textContent:''}}})
    return elements.get(id)
  }
  const request=async()=>{if(response instanceof Error)throw response;return response}
  const storageNotice=(...args)=>notices.push(args)
  const runner=new Function('$','request','storageNotice',`let storageModelCheckTicket='';
    const node=()=>({});const add=()=>{};const storageSize=n=>String(n||0);
    ${script}
    return loadStorageLocation;`)
  return {load:runner($,request,storageNotice),$,notices}
}
test('V2 storage loader renders the actual core/model paths and reports read errors, without legacy archive actions',async()=>{
  const x={currentDir:'C:/core',largeDataV2:{configured:true,target:'D:/large'},migrationJob:{status:'idle'},usage:{buckets:[]}}
  const h=storageHarness(x)
  await h.load()
  assert.equal(h.$('storage-current-path').textContent,'C:/core')
  assert.equal(h.$('storage-large-v2-current').textContent,'D:/large')
  assert.equal(h.$('storage-retained-model-check').disabled,false)
  assert.ok(h.notices.some(n=>n[0]==='storage-migration-job-status'))
  const failed=storageHarness(new Error('storage temporarily unavailable'))
  await assert.rejects(failed.load(),/temporarily unavailable/)
  assert.ok(failed.notices.some(n=>n[0]==='storage-migration-job-status'&&n[1]==='danger'))
  assert.equal(failed.$('storage-overview').dataset.state,'danger')
})

test('V2 actual model runtime verification is independent from retired old-copy cleanup routes',()=>{
  const runtime=server.slice(server.indexOf("if(path==='/api/bili-duty/storage/verify-model-runtime')"),
    server.indexOf("if(path==='/api/bili-duty/storage/review-model-vision')"))
  assert.match(runtime,/verifyRelocatedModelRuntime\(/)
  assert.doesNotMatch(runtime,/inspectRetainedModelCopies\(/)
  assert.doesNotMatch(html,/id="storage-retained-model-copy-check"/)
  assert.doesNotMatch(ui,/request\('\/storage\/verify-retained-model'/)
  assert.doesNotMatch(server,/\/api\/bili-duty\/storage\/schedule-model-cleanup/)
})

test('production vision status separates current route from last model attempt with safe error codes',()=>{
  const folder=mkdtempSync(join(tmpdir(),'dev3-vision-final-'))
  try{
    const file=join(folder,'vision-production-last.json')
    writeFileSync(file,JSON.stringify({version:1,at:Date.now(),ok:false,status:'vision_unavailable',
      mode:'independent_local',model:'qwen3.5:4b',errorCode:'ollama_request_timeout'}))
    assert.deepEqual(readProductionVisionStatus(folder)?.mode,'independent_local')
    assert.equal(readProductionVisionStatus(folder)?.errorCode,'ollama_request_timeout')
    writeFileSync(file,JSON.stringify({version:1,at:Date.now(),ok:false,status:'vision_unavailable',
      mode:'independent_local',model:'untrusted\nsecret',errorCode:'private raw failure'}))
    assert.equal(readProductionVisionStatus(folder)?.model,'')
    assert.equal(readProductionVisionStatus(folder)?.errorCode,null)
  }finally{rmSync(folder,{recursive:true,force:true})}
  assert.match(server,/visionRoute:\{mode:resolvedVisionMode\(\),enabled:cfg\.visionEnabled===true,[\s\S]{0,150}localModel:/)
  assert.match(server,/lastAttempt:attempt/)
  assert.match(ui,/当前视频视觉：Ollama/)
  assert.match(ui,/不会自动改用 DSH 模型/)
})

test('new diagnostic export includes only bounded vision route and model failure code',()=>{
  const py=source('vendor/bilibili-mcp/mcp_server.py')
  const bat=source('tools/导出B站日志.bat')
  assert.match(py,/\'errorCode\': reason if reason in allowed_codes else 'unclassified'/)
  assert.match(bat,/visionSelection.*vision_config_diag/)
  assert.match(bat,/\'errorCode\': vision\.get\('errorCode'\) if vision\.get\('errorCode'\) in allowed_error else 'unknown'/)
  assert.match(bat,/allowed_local = \('qwen3\.5-2b', 'qwen3\.5-4b', 'minicpm-v4\.7-1b'\)/)
  const diag=bat.slice(bat.indexOf('# This was previously absent'),bat.indexOf('life_file = root/'))
  assert.doesNotMatch(diag,/vision_status\s*=\s*vision\b/)
  assert.doesNotMatch(diag,/vision_status\[[^\]]+\]\s*=\s*vision\['(?:model|description|bvid|answer|error)'\]/)
})


test('video health labels CURRENT selected Ollama model, never last DSH model; failure code is actionable',()=>{
  const time=Date.now()
  const common={now:time,schedulerExpected:false,lifeExpected:false}
  const old=systemHealthSnapshot({...common,vision:{configured:true,mode:'independent_local',model:'Qwen 4B',
    at:time-1000,ok:false,lastAttempt:{mode:'independent_dsh',model:'gpt-6-luna',errorCode:null}}})
  const v1=old.channels.find(c=>c.id==='video-vision')
  assert.equal(v1.model,'Qwen 4B');assert.equal(v1.state,'unknown');assert.match(v1.detail,/旧模式/)
  const current=systemHealthSnapshot({...common,vision:{configured:true,mode:'independent_local',model:'Qwen 4B',
    at:time-1000,ok:false,lastAttempt:{mode:'independent_local',errorCode:'ollama_model_missing'}}})
  const v2=current.channels.find(c=>c.id==='video-vision')
  assert.equal(v2.model,'Qwen 4B');assert.equal(v2.state,'failed');assert.match(v2.detail,/未安装/)
  const switched=systemHealthSnapshot({...common,vision:{configured:true,mode:'independent_local',model:'Qwen 4B',
    backendModel:'qwen3.5:4b',at:time-1000,ok:true,
    lastAttempt:{mode:'independent_local',model:'qwen3.5:2b',status:'analyzed'}}})
  const v3=switched.channels.find(c=>c.id==='video-vision')
  assert.equal(v3.state,'unknown');assert.match(v3.detail,/已更换/)
})



test('migrated media partition is shared by standalone DSH and reused-video visual observations',()=>{
  const isolated=source('lib/vision_dsh.py')
  const mcp=source('vendor/bilibili-mcp/mcp_server.py')
  assert.match(isolated,/cached=Path\(env\.get\('DSH_MEDIA_CACHE_HOME'\) or home\)/)
  assert.match(isolated,/cache_error=_save_vision_cache\(cached,record\)/)
  assert.match(mcp,/_VISION_CACHE_HOME = Path\(os\.environ\.get\('DSH_MEDIA_CACHE_HOME'\) or _DUTY_HOME\)/)
  assert.equal((mcp.match(/_VISION_CACHE_HOME\s*\/\s*'vision-cache'/g)||[]).length,3)
  assert.doesNotMatch(mcp,/cache\s*=\s*_DUTY_HOME\s*\/\s*'vision-cache'/)
  assert.match(mcp,/_save_vision_cache\(cache,record\)/)
})

test('incomplete production vision replaces stale success, live probe warns before another inference and recovery is not viewing',()=>{
 const folder=mkdtempSync(join(tmpdir(),'vision-incomplete-'));const at=Date.now()
 try{const file=join(folder,'vision-production-last.json');const failure={version:1,at,ok:false,status:'vision_incomplete',mode:'independent_local',model:'qwen3.5:4b',errorCode:'ollama_service_offline'};writeFileSync(file,JSON.stringify(failure));const last=readProductionVisionStatus(folder);assert.equal(last.status,'vision_incomplete');assert.equal(last.errorCode,'ollama_service_offline');writeFileSync(file,JSON.stringify({...failure,ok:true}));assert.equal(readProductionVisionStatus(folder),null)
 const common={configured:true,mode:'independent_local',backendModel:'qwen3.5:4b',at,ok:false,lastAttempt:last};const snap=state=>systemHealthSnapshot({now:at,vision:{...common,localProbe:{at,state}}});assert.equal(snap('unavailable').issues.find(i=>i.id==='vision').canRestoreOllama,true);assert.equal(snap('ready').issues.some(i=>i.id==='vision'),false);assert.equal(snap('ready').channels.find(c=>c.id==='video-vision').state,'failed');assert.equal(snap('model-missing').issues.find(i=>i.id==='vision').code,'ollama-model-missing');assert.equal(snap('unverified').issues.find(i=>i.id==='vision').code,'ollama-model-unverified');assert.equal(snap('port-conflict').issues.find(i=>i.id==='vision').code,'ollama-port-conflict');assert.equal(snap('port-conflict').issues.find(i=>i.id==='vision').canRestoreOllama,false);assert.ok(systemHealthSnapshot({now:at,vision:{...common,ok:true,localProbe:{at,state:'unavailable'}}}).issues.some(i=>i.id==='vision'))
 assert.equal(systemHealthSnapshot({now:at,vision:{...common,configured:false,localProbe:{at,state:'unavailable'}}}).issues.some(i=>i.id==='vision'),false)
 }finally{rmSync(folder,{recursive:true,force:true})}
})
