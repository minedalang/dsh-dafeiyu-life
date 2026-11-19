import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {planGlobalPreviewFocusCandidates} from '../lib/video-focus-review.mjs'
import {runLifePostOverviewReview,runLifeChosenVideoRead} from '../lib/life-video-read-admission.mjs'
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
  const willingness={decide:async()=>{decisions++;return {ok:false,reason:'fish-chose-rest'}},
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
  assert.match(host,/runLifePostOverviewReview\(/)
  assert.match(host,/focus_start_seconds:plan\.startSeconds/)
  assert.match(planner,/choice\.action==='focus_video'/)
  assert.match(planner,/verifyVideoFocusReview/)
  assert.match(planner,/focusCandidates:visualObservation/)
})
