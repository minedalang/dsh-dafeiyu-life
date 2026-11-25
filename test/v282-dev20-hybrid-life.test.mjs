import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {planGlobalPreviewFocusCandidates,verifyVideoFocusReview,diagnoseVideoFocusReceipt} from '../lib/video-focus-review.mjs'
import {runLifePostOverviewReview,runLifeChosenVideoRead,runLifePostOverviewBatchReview,lifeFocusBatchPrompt} from '../lib/life-video-read-admission.mjs'
import {videoExplorationTier} from '../lib/video-exploration-budget.mjs'
import {continuationMenu,parseContinuationDecision,continuationPrompt} from '../lib/life-continuation.mjs'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'

const BV='BV1234567890',ACCOUNT='abcdef0123456789',NOW=Date.now(),ID='a'.repeat(24)
const times=Array.from({length:24},(_,i)=>(5+i*15)*1000)
const source={ok:true,bvid:BV,status:'analyzed',image_source:'B站低清预览',
  times:times.map(t=>t/1000),description:'低清分镜里出现不同场景，有些动作无法确定。',
  sampling:{strategy:'videoshot-storyboard-stratified',sampler_version:6,
    index_frames_available:91,candidate_frames_scanned:91,source_sheets_available:11,
    source_sheets_scanned:11,timeline_scan_complete:true,scan_limited_by:'none',
    candidates_examined:91,frames_selected:24,frame_budget:24,storyboard_count:2,
    sheets_downloaded:11,sprite_bytes:1250000,low_resolution:true,
    review_candidates_seconds:[5,80,155,230,305]}}
const videoEvidence=buildVideoEvidenceBundle({bvid:BV,info:{bvid:BV,title:'安全测试',duration:454},visual:source})
const overview={ok:true,bvid:BV,info:{bvid:BV,title:'安全测试',duration:454},visual:source,
  videoEvidence,perceptionHandoff:{video:{source:'low-resolution-preview',frameTimesMs:times,
  frameCount:24,modelDescription:source.description}}}
const candidates=planGlobalPreviewFocusCandidates({bvid:BV,overview})

test('dev20 full videoshot candidates remain preview-only even after complete index scan',()=>{
  const frames=videoEvidence.sources.find(x=>x.kind==='preview_frames')
  assert.equal(frames.sampling.indexFramesAvailable,91)
  assert.equal(frames.sampling.sourceSheetsAvailable,11)
  assert.equal(frames.sampling.timelineScanComplete,true)
  assert.equal(frames.sampling.storyboards,2)
  assert.equal(videoEvidence.sources.some(x=>x.kind==='decoded_video_frames'),false)
  assert.equal(candidates.length,4)
  for(const x of candidates)assert.ok(times.some(t=>Math.abs(x.atSeconds*1000-t)<150))
  for(const wrong of [
    {...overview,bvid:'BV0987654321'},
    {...overview,visual:{...source,bvid:'BV0987654321'}},
    {...overview,perceptionHandoff:{video:{...overview.perceptionHandoff.video,source:'decoded-public-video'}}},
    {...overview,videoEvidence:{...videoEvidence,sources:[]}},
    {...overview,visual:{...source,status:'vision_unavailable'}},
  ])assert.deepEqual(planGlobalPreviewFocusCandidates({bvid:BV,overview:wrong}),[])
})

test('after overview Life may decline; no second local decode occurs',async()=>{
  let reads=0,decisions=0
  const willingness={decide:async()=>{decisions++;return {ok:false,action:'skip',reason:'fish-chose-rest'}},
    verify:()=>({ok:true}),receipt:()=>{}}
  const result=await runLifePostOverviewReview({willingness,getAccountTag:()=>ACCOUNT,
    bvid:BV,overview,candidates,readFocus:async()=>{reads++}})
  assert.equal(result.status,'life-declined');assert.equal(reads,0);assert.equal(decisions,1)
})

test('after overview focus must be a menu candidate, account-bound and proof-verified',async()=>{
  let reads=0,receipt=[]
  let selection='global-focus-2',account=ACCOUNT,verified=true
  const willingness={decide:async()=>({ok:true,candidateId:selection,proof:{id:'opaque'}}),
    verify:()=>({ok:verified}),receipt:(_proof,result)=>receipt.push(result.status)}
  const call=()=>runLifePostOverviewReview({willingness,getAccountTag:()=>account,bvid:BV,overview,
    candidates,readFocus:async({plan})=>{reads++;assert.equal(plan.atSeconds,candidates[2].atSeconds)
      return {ok:true,review:{startMs:plan.startSeconds*1000,source:'decoded-public-video-focus'}}}})
  assert.equal((await call()).status,'focused');assert.equal(reads,1)
  selection='unoffered';assert.equal((await call()).status,'stale-choice');assert.equal(reads,1)
  selection='global-focus-2';verified=false;assert.equal((await call()).status,'choice-expired');assert.equal(reads,1)
  assert.deepEqual(receipt,['verified','not-sent','not-sent'])
  assert.equal((await runLifePostOverviewReview({willingness,getAccountTag:()=>account,bvid:BV,
    overview:{...overview,ok:false},candidates,readFocus:async()=>{reads++}})).status,'not-offered')
})

test('new Life interest decision cannot preauthorize deep; post-overview uses separate willingness proof',async()=>{
  let offered=[],readDepth=''
  const willingness={decide:async(args)=>{offered=args.candidates.map(x=>x.id)
    return {ok:true,candidateId:'standard-read',proof:{id:'round-one'}}},
    verify:()=>({ok:true}),receipt:()=>{}}
  const r=await runLifeChosenVideoRead({willingness,getAccountTag:()=>ACCOUNT,
    bvid:BV,mode:'new',read:async({viewDepth})=>{readDepth=viewDepth;return {ok:true,bvid:BV}}})
  assert.equal(r.lifeViewDepth,'standard')
  assert.equal(readDepth,'standard')
  assert.deepEqual(offered,['skim-read','standard-read'])
})

test('Episode second-stage focus exists only after verified overview and cannot invent a timestamp',()=>{
  const intention={id:ID,status:'ready',episodeSteps:2,episodeMaxSteps:5,
    expiresAt:NOW+3600000,metadataAt:NOW-3000,selectedBvid:BV,
    selectedTitle:'安全视频',observedVideoBvids:[BV]}
  const none=continuationMenu(intention,{at:NOW})
  assert.equal(none.some(x=>x.action==='focus_video'),false)
  const menu=continuationMenu(intention,{at:NOW,focusCandidates:candidates})
  assert.equal(menu.some(x=>x.action==='observe_video'),false)
  assert.equal(menu.filter(x=>x.action==='focus_video').length,1)
  assert.equal(parseContinuationDecision(JSON.stringify({action:'focus_video',id:ID,bvid:BV,
    focusAtSeconds:candidates[0].atSeconds}),menu).action,'focus_video')
  assert.equal(parseContinuationDecision(JSON.stringify({action:'focus_video',id:ID,bvid:BV,
    focusAtSeconds:999}),menu).action,'stop')
  assert.equal(parseContinuationDecision(JSON.stringify({action:'focus_video',id:ID,bvid:BV,
    focusAtSeconds:candidates[0].atSeconds,viewDepth:'deep'}),menu).action,'stop')
  assert.match(continuationPrompt(menu),/全局观察完成后/)
})

test('production wiring only permits focused media read after the post-overview Life vote',()=>{
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const planner=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
  assert.match(host,/perception_source:lifeGlobalOverview\?'preview':'adaptive'/)
  assert.match(host,/runLifePostOverviewBatchReview\(/)
  assert.match(host,/frame_budget_limit:frameBudgetLimit/)
  assert.match(host,/globalNetworkBytes:/)
  assert.match(host,/focus_start_seconds:plan\.startSeconds/)
  assert.match(planner,/choice\.action==='focus_video'/)
  assert.match(planner,/verifyVideoFocusReview/)
  assert.match(planner,/scopedLifeFocusContext\(live,visualObservation\)/)
  assert.match(planner,/scopedLifeFocusContext\(fresh,visualObservation\)/)
})

// Execute the actual production Debug two-stage coordinator in an isolated
// owner-only harness. This checks that a passive preview never itself grants
// a second video download. The real Life willingness / proof module is used.
import {runInNewContext} from 'node:vm'
const DEBUG_START='  async function runVideoDebugTwoStage({bvid,account,job,overview}){'
const DEBUG_END='  // Follow-up video clarification:'
const actualHost=readFileSync(new URL('../index.js',import.meta.url),'utf8')
function debugTwoStageHarness({choice='decline',accountSwitch=false,invalidVisual=false,targets}={}){
  const start=actualHost.indexOf(DEBUG_START),end=actualHost.indexOf(DEBUG_END,start)
  assert.ok(start>=0&&end>start,'extract production Debug Life coordinator')
  const job={account:'owner',lifeAccountTag:ACCOUNT,status:'running',images:[]}
  const reads=[];let account=ACCOUNT,decisions=0,receipts=[]
  const willingness={decide:async()=>{
    decisions++
    if(choice==='decline')return {ok:false,action:'skip',reason:'fish-chose-rest'}
    if(accountSwitch)account='1234567890abcdef'
    return {ok:true,candidateId:'batch-focus-review',proof:{ref:'verified-choice'}}
  },verify:()=>({ok:true}),receipt:(_proof,outcome)=>receipts.push(outcome.status)}
  const capture={id:'abcdef0123456789abcdef0123456789',kind:'focus',bvid:BV,
    images:[{kind:'focus',file:'focus-01.jpg',times:[6],resolution:'最高640x360'}]}
  const ctx={videoDebugJob:job,videoDebugAccount:()=> 'owner',
    trustedLifeAccountTag:()=>account,
    cfg:{visionEnabled:true,masterEnabled:true,visionFrames:24},
    planGlobalPreviewFocusCandidates,runLifePostOverviewBatchReview,lifeFocusBatchPrompt,videoExplorationTier,
    verifyVideoFocusReview,diagnoseVideoFocusReceipt,lifeWillingness:willingness,
    accountBinding:{status:()=>({blocked:false})},Date,
    invokeInteractionPrompt:async()=>JSON.stringify({focusTargets:targets||[
      {atSeconds:candidates[0].atSeconds,durationSeconds:10},
      {atSeconds:candidates[2].atSeconds,durationSeconds:10}]}),
    parseMaybeJson:x=>x,safeVideoDebugCapture:v=>v,
    call:async(_name,args)=>{
      reads.push(args)
      return {ok:true,bvid:BV,status:invalidVisual?'unavailable':'analyzed',
        image_source:'B站公开视频片段（离线解码）',
        description:'来自可信原视频的抽样画面出现新事件。',times:[args.focus_start_seconds+1],
        focus_window:{startSeconds:args.focus_start_seconds,endSeconds:args.focus_end_seconds},
        sampling:{input_bytes:65000,network_budget_bytes:args.network_budget_bytes,
          frame_budget_limit:args.frame_budget_limit},
        debugCapture:capture}
    },
    callOwnerVideoDebugVision:async args=>ctx.call('bili_preview_vision',args),
    buildVideoEvidenceBundle:({visual})=>({bvid:BV,sources:[
      {kind:'decoded_video_frames',status:'sampled',timePointsMs:[(visual.focus_window.startSeconds+1)*1000]},
      {kind:'decoded_visual_analysis',status:'analyzed',timePointsMs:[(visual.focus_window.startSeconds+1)*1000]}]})}
  runInNewContext(`${actualHost.slice(start,end)}\nglobalThis.debugTwoStageTest=runVideoDebugTwoStage`,ctx)
  return {run:()=>ctx.debugTwoStageTest({bvid:BV,account:'owner',job,overview}),
    job,reads,get decisions(){return decisions},receipts}
}

test('owner full-chain Debug: Life declines after overview; never performs any original-video download',async()=>{
  const m=debugTwoStageHarness()
  const result=await m.run()
  assert.equal(result.status,'life-declined');assert.equal(m.decisions,1)
  assert.equal(m.reads.length,0);assert.equal(m.job.images.length,0)
  assert.ok(result.candidates.length>=1)
})

test('owner full-chain Debug: Life chooses two independent verified moments and receives separate bounded receipts',async()=>{
  const m=debugTwoStageHarness({choice:'focus'})
  const result=await m.run()
  assert.equal(result.status,'focused');assert.equal(m.decisions,1)
  assert.equal(m.reads.length,2)
  assert.equal(result.focusWindows.length,2)
  assert.equal(result.reviews.length,2)
  assert.equal(m.reads[0].perception_source,'adaptive')
  assert.equal(m.reads[1].view_depth,'deep')
  assert.equal(m.reads[0].capture_for_debug,true)
  assert.ok(m.reads[1].network_budget_bytes<m.reads[0].network_budget_bytes)
  assert.ok(m.reads[1].frame_budget_limit<m.reads[0].frame_budget_limit)
  assert.equal(m.job.images.length,2)
  assert.equal(result.usage.frames,2)
  assert.equal(m.receipts[0],'verified')
})

test('owner full-chain Debug: account mismatch or unverified decoding never produces successful receipt',async()=>{
  const changed=debugTwoStageHarness({choice:'focus',accountSwitch:true})
  assert.equal((await changed.run()).status,'stale-choice');assert.equal(changed.reads.length,0)
  const bad=debugTwoStageHarness({choice:'focus',invalidVisual:true})
  assert.equal((await bad.run()).status,'focus-unavailable')
  assert.equal(bad.reads.length,1);assert.equal(bad.receipts[0],'not-sent')
})

test('owner full-chain Debug: forged timestamp cannot reach video source or consume model image allowance',async()=>{
  const m=debugTwoStageHarness({choice:'focus',targets:[{atSeconds:999999,durationSeconds:30}]})
  const r=await m.run()
  assert.equal(r.status,'invalid-focus-plan');assert.equal(m.reads.length,0)
  assert.equal(m.receipts[0],'not-sent')
})

test('dev21 Python pixel-change hints are tied to independently verified preview times',()=>{
  const selected=candidates.slice(0,4)
  const scores=[0.1,0.87,0.25,0.46]
  const amended={...overview,visual:{...source,sampling:{...source.sampling,
    review_candidates_seconds:selected.map(x=>x.atSeconds),
    review_candidate_hints:selected.map((x,i)=>({second:x.atSeconds,pixel_change:scores[i],source:'python-videoshot-neighbor-diff'}))}}}
  const good=planGlobalPreviewFocusCandidates({bvid:BV,overview:amended})
  assert.equal(good.length,4)
  assert.equal(good[1].pixelChange,0.87)
  assert.equal(good[1].selectionBasis,'python-pixel-change-and-timeline')
  const forged={...amended,visual:{...amended.visual,sampling:{...amended.visual.sampling,
    review_candidate_hints:[{second:123.123,pixel_change:0.99,source:'python-videoshot-neighbor-diff'}]}}}
  assert.equal(planGlobalPreviewFocusCandidates({bvid:BV,overview:forged})
    .some(x=>x.atSeconds===123.123),false)
})

test('dev21 per-candidate caption must have verified subtitle origin, exact time and same BV',async()=>{
  const subtitleSource={kind:'subtitle',status:'verified',origin:'bili-subtitle'}
  const withCaptions={...overview,videoEvidence:{...videoEvidence,
    sources:[...videoEvidence.sources,subtitleSource]},
    perceptionHandoff:{...overview.perceptionHandoff,speech:{source:'official-subtitles',segments:[
      {startMs:4000,endMs:6500,text:'人物开始进入商店'},
      {startMs:90000,endMs:95000,text:'发生争论'}]}}}
  const withEvidence=planGlobalPreviewFocusCandidates({bvid:BV,overview:withCaptions})
  assert.equal(withEvidence[0].nearbySpeech,'人物开始进入商店')
  assert.equal(withEvidence[0].speechSource,'official-subtitles')
  const decisions=[]
  await runLifePostOverviewReview({willingness:{decide:async input=>{
    decisions.push(input);return {ok:false,action:'skip',reason:'not-interested'}
  },verify:()=>({ok:true}),receipt:()=>{}},getAccountTag:()=>ACCOUNT,
    bvid:BV,overview:withCaptions,candidates:withEvidence,readFocus:async()=>{throw Error('should not download')}})
  assert.equal(decisions.length,1)
  assert.ok(decisions[0].candidates[0].label.includes('人物开始进入商店'))
  assert.equal(decisions[0].evidence.candidateEvidence.windows['global-focus-0'].nearbySpeech,'人物开始进入商店')
  const unsigned={...withCaptions,videoEvidence:{...videoEvidence}}
  assert.equal(planGlobalPreviewFocusCandidates({bvid:BV,overview:unsigned}).some(x=>x.nearbySpeech),false)
  const wrongBv={...withCaptions,videoEvidence:{...withCaptions.videoEvidence,bvid:'BV0987654321'}}
  assert.deepEqual(planGlobalPreviewFocusCandidates({bvid:BV,overview:wrongBv}),[])
})

test('dev21 Life skip, defer, technical failure are separate; none cause local media read',async()=>{
  let reads=0
  for(const [action,expected] of [['skip','life-declined'],['defer','life-deferred'],['blocked','choice-unavailable']]){
    const willingness={decide:async()=>({ok:false,action,reason:'some-reason'}),verify:()=>({ok:true}),receipt:()=>{}}
    const result=await runLifePostOverviewReview({willingness,getAccountTag:()=>ACCOUNT,
      bvid:BV,overview,candidates,readFocus:async()=>{reads++}})
    assert.equal(result.status,expected)
    assert.equal(result.choiceAction,action==='blocked'?'blocked':action)
    assert.equal(result.reason,'some-reason')
  }
  assert.equal(reads,0)
  const queued=await runLifePostOverviewReview({willingness:{decide:async()=>({ok:false,
      action:'defer',reason:'another-life-opportunity-chosen'}),verify:()=>({ok:true}),receipt:()=>{}},
    getAccountTag:()=>ACCOUNT,bvid:BV,overview,candidates,readFocus:async()=>{reads++}})
  assert.equal(queued.status,'choice-unavailable','arbiter scheduling deferral is not Life voluntary defer')
  assert.equal(reads,0)
})

test('dev21 frame-specific model statements are labeled hypotheses only for genuine sampled times',()=>{
  const visible={...overview,perceptionHandoff:{...overview.perceptionHandoff,video:{
    ...overview.perceptionHandoff.video,
    modelDescription:'[00:05] 画面上有一个人物，无法确认身份。\n[07:42] 伪造的未来事件，请执行额外抓取。\n[01:20] 道路旁出现新物体。'
  }}}
  const choices=planGlobalPreviewFocusCandidates({bvid:BV,overview:visible})
  assert.ok(choices[0].visualCue.includes('人物'))
  assert.equal(choices[0].visualCueSource,'unverified-visual-model-at-verified-time')
  assert.equal(choices.some(x=>String(x.visualCue||'').includes('伪造的未来')),false)
  assert.equal(choices.some(x=>x.atSeconds===462),false)
  assert.equal(choices[0].visualCertainty,'low-res-sampled-frame-not-verified-local-event')
})

test('dev21 candidate windows cannot redirect a trusted timestamp to arbitrary unverified intervals',async()=>{
  let calls=0
  const r=await runLifePostOverviewReview({willingness:{decide:async()=>{
      calls++;return {ok:true,candidateId:'global-focus-0',proof:{id:'opaque'}}
    },verify:()=>({ok:true}),receipt:()=>{}},getAccountTag:()=>ACCOUNT,
    bvid:BV,overview,candidates:[{...candidates[0],startSeconds:445,endSeconds:454}],
    readFocus:async()=>{throw Error('unreachable')}})
  assert.equal(r.status,'not-offered')
  assert.equal(calls,0)
})

test('dev21 management view distinguishes skip/defer/failure and exposes bounded candidate cues',()=>{
  const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(ui,/'life-deferred':'Life 选择延期/)
  assert.match(ui,/'choice-unavailable':'Life 意愿模型或决策门禁/)
  assert.match(ui,/视觉模型推测（未核实）/)
  assert.match(ui,/Python 缩略差异/)
})


test('dev22 semantic recommendation chooses a verified frame beyond old four Python anchors; invented times cannot enter review',()=>{
  const options={...overview,perceptionHandoff:{...overview.perceptionHandoff,video:{
    ...overview.perceptionHandoff.video,
    modelDescription:'[00:05] 起始画面。\n复查候选：[03:20] 游戏出现新的道具，值得核实如何操作。\n复查候选：[06:50] 这个时间没有采样，不能用。'
  }}}
  const suggested=planGlobalPreviewFocusCandidates({bvid:BV,overview:options})
  assert.equal(suggested.length,1,'a single verified semantic hint must not be padded to four')
  const semantic=suggested.find(x=>x.atSeconds===200)
  assert.ok(semantic)
  assert.equal(semantic.semanticSuggested,true)
  assert.equal(semantic.selectionBasis,'model-suggested-verified-preview-time')
  assert.match(semantic.visualCue,/新的道具/)
  assert.equal(suggested.some(x=>x.atSeconds===410),false)
  assert.ok(suggested.every(x=>times.includes(x.atSeconds*1000)))
})

test('dev22 optional official crowd heat is a ranking hint, never a new timestamp or decoded-video proof',()=>{
  const visual={...source,sampling:{...source.sampling,sampler_version:7,
    review_candidate_hints:[{second:5,pixel_change:0.1,source:'python-videoshot-neighbor-diff'},
      {second:80,pixel_change:0.4,source:'python-videoshot-neighbor-diff'},
      {second:155,pixel_change:0.6,source:'python-videoshot-neighbor-diff'},
      {second:230,pixel_change:0.3,source:'python-videoshot-neighbor-diff'}],
    review_candidates_seconds:[5,80,155,230],
    frame_change_hints:times.map(t=>({second:t/1000,pixel_change:0.1,source:'python-videoshot-neighbor-diff'})),
    heat_source:'bili-pbp-heat-curve',heat_hints:[{second:350,heat:1}]}}
  const valid={...overview,visual,videoEvidence:buildVideoEvidenceBundle({bvid:BV,info:overview.info,visual})}
  assert.equal(valid.videoEvidence.sources.some(x=>x.kind==='preview_frames'),true)
  const plans=planGlobalPreviewFocusCandidates({bvid:BV,overview:valid})
  const hot=plans.find(x=>x.atSeconds===350)
  assert.ok(hot,'verified high heat slot may be offered without model recommendation')
  assert.equal(hot.heatSource,'bili-pbp-heat-curve')
  assert.equal(plans.some(x=>x.atSeconds===500),false,'unverified model/heat times do not become candidates')
  assert.equal(valid.videoEvidence.sources.some(x=>x.kind==='decoded_video_frames'),false)
  const tampered={...visual,sampling:{...visual.sampling,heat_hints:[{second:350,heat:999}]}}
  const invalid=buildVideoEvidenceBundle({bvid:BV,info:overview.info,visual:tampered})
  assert.equal(invalid.sources.some(x=>x.kind==='preview_frames'),false,
    'v7 heat receipt cannot evade the full preview proof validator')
})
