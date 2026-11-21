import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {explainVideoVisionFailure} from '../lib/video-visual-failure.mjs'
import {diagnoseVideoFocusReceipt} from '../lib/video-focus-review.mjs'

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const host=read('index.js')

test('visual failure explains offline/model/timeout before any visual-evidence validation',()=>{
  for(const [code,hint] of [
    ['ollama_service_offline','未启动'],['ollama_model_missing','未安装'],
    ['ollama_request_timeout','超时'],['ollama_http_error','返回错误'],
    ['ollama_connection_failed','无法连接']]){
    const visual={status:'vision_incomplete',visionBoardReceipts:[
      {status:'incomplete',errorCode:code}, {status:'incomplete',errorCode:code}]}
    const diagnostic=explainVideoVisionFailure(visual)
    assert.equal(diagnostic.code,code)
    assert.match(diagnostic.message,new RegExp(hint))
    assert.equal(diagnostic.boardsFailed,2)
  }
  assert.equal(explainVideoVisionFailure({status:'analyzed',description:'真实模型回答'}),null)
  assert.equal(explainVideoVisionFailure({status:'cached',description:'已验证缓存'}),null)
  assert.equal(explainVideoVisionFailure({status:'preview_only'}),null)
  assert.equal(explainVideoVisionFailure({status:'vision_incomplete',visionBoardReceipts:[{status:'incomplete',errorCode:'unsafe-injection'}]}).code,'vision_incomplete')
})

test('local model outage after focus FFmpeg decode remains model-stage failure, not provenance rejection',()=>{
  const diagnosis=diagnoseVideoFocusReceipt({result:{ok:true,status:'vision_unavailable',
    errorCode:'ollama_service_offline',times:[60,61,62],sampling:{sampler_version:8}}})
  assert.equal(diagnosis.stage,'visual-model')
  assert.equal(diagnosis.code,'ollama_service_offline')
  assert.equal(diagnosis.decodedFrames,3)
})

test('real server video-debug run route rejects offline Ollama before starting any job or B站 read',async()=>{
  const start=host.indexOf("      if(req.method==='POST'&&path.endsWith('/video-perception-debug/run')){")
  const end=host.indexOf("      return sendJson(res,405,{ok:false,error:'不支持的方法'})",start)
  assert.ok(start>0&&end>start)
  const ctx={req:{method:'POST'},path:'/api/bili-duty/video-perception-debug/run',
    videoDebugWorkInFlight:false,readBody:async()=>({bvid:'BV1234567890',sourceMode:'owner-focus',depth:'standard'}),
    validBv:bv=>/^BV[A-Za-z0-9]{10}$/.test(bv),cfg:{visionEnabled:true,visionLocalModel:'qwen3.5-2b'},
    resolvedVisionMode:()=> 'independent_local',refreshCfg:()=>{},
    checkVideoDebugOllama:async()=>({code:'ollama_service_offline',error:'本地 Ollama 服务未启动'}),
    sendJson:(_res,status,value)=>({status,value}),res:{},Math,Date,JSON,String,Array,Number}
  runInNewContext(`async function route(){${host.slice(start,end)}\n}\nglobalThis.go=route`,ctx)
  const result=await ctx.go()
  assert.equal(result.status,409)
  assert.equal(result.value.code,'ollama_service_offline')
  assert.equal(ctx.videoDebugWorkInFlight,false)
  assert.equal(ctx.videoDebugJob,undefined)
})

test('management diagnosis shows Ollama outage as service failure, not failed Life evidence review',()=>{
  const html=read('lib/management-console.html'), ui=read('lib/management-console.js')
  assert.match(html,/id="video-debug-service-status"/)
  assert.match(ui,/checkVideoDebugService\(\{force:true\}\)/)
  assert.match(ui,/await requireVideoDebugService\(\)/)
  assert.match(ui,/本地 Ollama 未启动，视频识图未开始/)
  assert.match(ui,/不是 Life 拒绝观看，也不是证据校验器拒绝有效回答/)
  assert.doesNotMatch(ui,/模型可能已返回文字，但证据验证器未接受为可靠视觉观察/)
  const routeStart=host.indexOf("      const checkVideoDebugOllama=async()=>{")
  assert.ok(routeStart>0)
  assert.match(host.slice(routeStart,routeStart+750),/await localVisionModels\.list\(\)/)
  assert.match(host,/visionFailure=explainVideoVisionFailure\(result\?\.visual\)/)
})
