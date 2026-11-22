import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {planGlobalPreviewFocusCandidates,verifyVideoFocusReview,diagnoseVideoFocusReceipt} from '../lib/video-focus-review.mjs'
import {verifiedOwnerFocusAnchors,planOwnerFocusDebugWindow} from '../lib/video-owner-focus-debug.mjs'
import {videoExplorationTier} from '../lib/video-exploration-budget.mjs'
import {runLifePostOverviewBatchReview} from '../lib/life-video-read-admission.mjs'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'

const BV='BV1234567890', ACCT='abcdef0123456789'
const times=[10,25,35,40,55,65,70,80,90,115,120,131,146,161,171,176,186,201,211,231,256,281,291,311]
const info={bvid:BV,duration:324,title:'测试视频'}
const sampling={strategy:'videoshot-storyboard-stratified',sampler_version:12,
  index_frames_available:65,candidate_frames_scanned:65,source_sheets_available:1,source_sheets_scanned:1,
  timeline_scan_complete:true,scan_limited_by:'none',candidates_examined:65,frames_selected:24,
  frame_budget:24,storyboard_count:2,tiles_per_storyboard:12,sheets_downloaded:1,
  sprite_bytes:400000,low_resolution:true,
  review_candidates_seconds:[65,70,120,186],heat_source:'unavailable',heat_hints:[],
  review_candidate_hints:[65,70,120,186].map(second=>({second,pixel_change:.25,source:'python-videoshot-neighbor-diff'})),
  frame_change_hints:times.map(second=>({second,pixel_change:.15,source:'python-videoshot-neighbor-diff'}))}
const lines=times.map((t,i)=>`R${Math.floor((i%12)/4)+1}C${i%4+1} [${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}]：${t===65?'人物在楼梯口右侧有金属扶手':'一名人物正在机场大厅行走，周围有灯光和指示标志。'}`)
function overview(description=lines.slice(0,12).join('\n')+'\n'+lines.slice(12).join('\n')){
  const visual={ok:true,bvid:BV,status:'analyzed',image_source:'B站低清预览',times,
    description,sampling,visionBoardReceipts:[{index:1,status:'analyzed',times:times.slice(0,12),description:'第1张分镜图完整内容'},
      {index:2,status:'analyzed',times:times.slice(12),description:'第2张分镜图完整内容'}]}
  return {ok:true,bvid:BV,info,visual,
    videoEvidence:buildVideoEvidenceBundle({bvid:BV,info,visual}),
    perceptionHandoff:{video:{source:'low-resolution-preview',frameTimesMs:times.map(t=>t*1000),
      modelDescription:description}}}
}

test('Qwen R1C1 [time] model descriptions match only real sampled frames and reach Life candidates',()=>{
  const found=planGlobalPreviewFocusCandidates({bvid:BV,overview:overview()})
  assert.equal(found.length,4)
  assert.equal(found.filter(c=>c.visualCue).length,4)
  assert.match(found.find(c=>c.atSeconds===65).visualCue,/楼梯口/)
  assert.ok(found.every(c=>c.visualCueSource==='unverified-visual-model-at-verified-time'))
  const forged=overview('R4C1 [01:05]：假的第四行不能成为图像描述\nR2C2 [99:55]：这个时间点未取帧不能调用视频工具。')
  const returned=planGlobalPreviewFocusCandidates({bvid:BV,overview:forged})
  assert.equal(returned.some(c=>c.visualCue),false)
  assert.ok(returned.every(c=>times.includes(c.atSeconds)))
})


test('Life pre-focus willingness receives bounded, explicitly unverified scene cues but may decline',async()=>{
  const source=overview()
  const candidates=planGlobalPreviewFocusCandidates({bvid:BV,overview:source})
  let proofInput,reads=0
  const result=await runLifePostOverviewBatchReview({bvid:BV,overview:source,candidates,
    tier:videoExplorationTier(24),getAccountTag:()=>ACCT,
    willingness:{decide:async input=>{proofInput=input;return {ok:false,action:'skip',reason:'life-prefers-rest'}},
      verify:()=>({ok:true}),receipt:()=>{}},
    chooseBatch:async()=>{throw Error('Life refused')},readFocus:async()=>{reads++;return {ok:true}}})
  assert.equal(result.status,'life-declined');assert.equal(reads,0)
  const hints=proofInput.evidence.candidateEvidence.unverifiedCandidateVisualCues
  assert.ok(hints.some(x=>x.atSeconds===65&&x.modelHypothesis.includes('楼梯口')))
  assert.ok(hints.length<=6)
  assert.ok(hints.every(x=>times.includes(x.atSeconds)))
})

test('owner choice can inspect 24 actual time anchors, never invented or mismatched time',()=>{
  const source=overview()
  assert.deepEqual(verifiedOwnerFocusAnchors({bvid:BV,overview:source}),times)
  const good=planOwnerFocusDebugWindow({bvid:BV,overview:source,atSeconds:65,durationSeconds:15,
    tier:videoExplorationTier(24),globalNetworkBytes:410000})
  assert.equal(good.ok,true)
  assert.equal(good.plan.startSeconds,57.5)
  assert.equal(good.plan.endSeconds,72.5)
  assert.equal(good.plan.networkBudgetBytes,videoExplorationTier(24).bytes-410000)
  for(const atSeconds of [64,99999,undefined,'65'])assert.equal(planOwnerFocusDebugWindow({bvid:BV,
    overview:source,atSeconds,durationSeconds:15,tier:videoExplorationTier(24)}).ok,false)
  for(const durationSeconds of [0,3,121,'15',12.5])assert.equal(planOwnerFocusDebugWindow({bvid:BV,
    overview:source,atSeconds:65,durationSeconds,tier:videoExplorationTier(24)}).ok,false)
  assert.equal(planOwnerFocusDebugWindow({bvid:BV,overview:source,atSeconds:65,durationSeconds:40,
    tier:videoExplorationTier(12)}).reason,'focus-time-budget-exhausted')
  assert.equal(planOwnerFocusDebugWindow({bvid:BV,overview:source,atSeconds:65,durationSeconds:15,
    tier:videoExplorationTier(24),globalNetworkBytes:videoExplorationTier(24).bytes-100}).ok,false)
  assert.deepEqual(verifiedOwnerFocusAnchors({bvid:'BVbad',overview:source}),[])
  assert.deepEqual(verifiedOwnerFocusAnchors({bvid:BV,overview:{...source,videoEvidence:{...source.videoEvidence,
    sources:source.videoEvidence.sources.filter(x=>x.kind!=='preview_frames')}}}),[])
  assert.deepEqual(verifiedOwnerFocusAnchors({bvid:BV,overview:{...source,perceptionHandoff:{video:{
    ...source.perceptionHandoff.video,frameTimesMs:times.map(t=>t*1000).reverse()}}}}),[])
})

const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const START="      if(req.method==='POST'&&path.endsWith('/video-perception-debug/focus')){"
const END="      if(req.method==='POST'&&path.endsWith('/video-perception-debug/run')){"
function focusHarness({body={jobId:'job-id',atSeconds:65,durationSeconds:15},accountChanged=false,invalidVisual=false,offline=false}={}){
  const start=host.indexOf(START),end=host.indexOf(END,start)
  assert.ok(start>0&&end>start,'extract real owner-only route from index.js')
  const source=overview()
  const job={id:'job-id',account:'owner',at:Date.now(),status:'done',sourceMode:'owner-focus',
    lifeAccountTag:ACCT,ownerFocus:{status:'awaiting-selection',anchors:times},payload:source,images:[]}
  const calls=[];let account='owner',reads=0
  const ctx={req:{method:'POST'},path:'/api/bili-duty/video-perception-debug/focus',
    videoDebugJob:job,videoDebugWorkInFlight:false,Date,Math,JSON,String,Number,
    account,now:Date.now(),videoDebugExpiry:30*60_000,
    readBody:async()=>body,videoDebugAccount:()=>account,
    trustedLifeAccountTag:()=>ACCT,
    cfg:{visionEnabled:true,visionFrames:24},refreshCfg:()=>{},
    accountBinding:{status:()=>({blocked:false})},resolvedVisionMode:()=> 'independent_local',
    videoExplorationTier,planOwnerFocusDebugWindow,verifyVideoFocusReview,diagnoseVideoFocusReceipt,
    checkVideoDebugOllama:async()=>offline?{code:'ollama_service_offline',error:'Ollama 未启动'}:null,
    sendJson:(_res,status,payload)=>({status,payload}),res:{},
    saveVideoDebugSummary:()=>{},stateDir:'/test',
    // Owner Debug now runs this same visual operation through a separate,
    // single-tool MCP worker. Preserve the original business receipt assertions.
    callOwnerVideoDebugVision:async args=>ctx.call('bili_preview_vision',args),
    call:async(_tool,args)=>{
      reads++;calls.push(args)
      if(accountChanged)account='different-owner'
      return {ok:true,bvid:BV,status:invalidVisual?'unavailable':'analyzed',
        image_source:'B站公开视频片段（离线解码）',description:'真实解码画面里有人物走向楼梯。',
        focus_window:{startSeconds:args.focus_start_seconds,endSeconds:args.focus_end_seconds},
        sampling:{input_bytes:500000,network_budget_bytes:args.network_budget_bytes,
          frame_budget_limit:args.frame_budget_limit},debugCapture:{id:'a'.repeat(32),kind:'focus',bvid:BV,
          images:[{kind:'focus',file:'focus-01.jpg',times:[65],resolution:'640x360'}]}}
    },
    parseMaybeJson:x=>x,safeVideoDebugCapture:v=>v,
    buildVideoEvidenceBundle:({visual})=>({sources:[
      {kind:'decoded_video_frames',status:'sampled',timePointsMs:[65000]},
      {kind:'decoded_visual_analysis',status:'analyzed',timePointsMs:[65000]}]}),
    setTimeout:(callback)=>{ctx.watchdog=callback;return {unref(){}}},clearTimeout:()=>{},
    Promise,
  }
  runInNewContext(`async function invoke(){${host.slice(start,end)}\n}\nglobalThis.focusInvoke=invoke`,ctx)
  return {async run(){const response=await ctx.focusInvoke();await new Promise(r=>setTimeout(r,2));return response},
    job,calls,get reads(){return reads},ctx}
}

test('real owner focus route runs one bounded original-video read without Life decisions or memory writes',async()=>{
  const h=focusHarness();const result=await h.run()
  assert.equal(result.status,202)
  assert.equal(h.reads,1)
  assert.equal(h.calls[0].perception_source,'adaptive')
  assert.equal(h.calls[0].view_depth,'deep')
  assert.equal(h.calls[0].capture_for_debug,true)
  assert.equal(h.calls[0].focus_start_seconds,57.5)
  assert.equal(h.calls[0].focus_end_seconds,72.5)
  assert.equal(h.job.status,'done');assert.equal(h.job.ownerFocus.status,'focused')
  assert.equal(h.job.ownerFocus.focusWindows.length,1)
  assert.equal(h.job.ownerFocus.visuals.length,1)
  assert.ok(h.job.payload.debugOwnerFocus.status==='focused')
  assert.equal(h.job.images.length,1)
  assert.equal(h.ctx.videoDebugWorkInFlight,false)
})

test('owner route forbids fabricated time, second attempt, account mismatch and unsafe visual success',async()=>{
  const fake=focusHarness({body:{jobId:'job-id',atSeconds:66,durationSeconds:15}})
  assert.equal((await fake.run()).status,400);assert.equal(fake.reads,0)
  const mismatch=focusHarness({body:{jobId:'wrong',atSeconds:65,durationSeconds:15}})
  assert.equal((await mismatch.run()).status,409);assert.equal(mismatch.reads,0)
  const changed=focusHarness({accountChanged:true})
  assert.equal((await changed.run()).status,202);assert.equal(changed.job.ownerFocus.status,'running')
  assert.equal(changed.job.images.length,0)
  const invalid=focusHarness({invalidVisual:true})
  assert.equal((await invalid.run()).status,202)
  assert.equal(invalid.job.ownerFocus.status,'focus-unavailable')
  assert.equal(invalid.job.ownerFocus.focusWindows.length,0)
  assert.equal((await invalid.run()).status,409)
})

test('owner focus rejects offline Ollama without creating a video read or losing the validated overview',async()=>{
  const h=focusHarness({offline:true});const result=await h.run()
  assert.equal(result.status,409)
  assert.equal(result.payload.code,'ollama_service_offline')
  assert.equal(h.reads,0)
  assert.equal(h.job.status,'done')
  assert.equal(h.job.ownerFocus.status,'awaiting-selection')
})

test('management UI visibly exposes two-step manual test without mixing Life choice or external writes',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(html,/<option value="owner-focus">主人局部识图专项/)
  assert.match(html,/id="video-debug-owner-focus-anchor"/)
  assert.match(html,/id="video-debug-owner-focus-run"/)
  assert.match(js,/ownerFocus\.anchors\.includes\(atSeconds\)/)
  assert.match(js,/request\('\/video-perception-debug\/focus'/)
  assert.match(host,/job\.ownerFocus\?\.status!=='awaiting-selection'/)
  assert.match(host,/!\['preview','adaptive','life-two-stage','owner-focus'\]\.includes/)
  assert.doesNotMatch(host.slice(host.indexOf(START),host.indexOf(END)),/lifeWillingness|recordEvents|sendComment|bili_like/)
})
