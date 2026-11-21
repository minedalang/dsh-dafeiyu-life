import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {planGlobalPreviewFocusCandidates} from '../lib/video-focus-review.mjs'
import {runLifePostOverviewReview} from '../lib/life-video-read-admission.mjs'
import {continuationMenu,parseContinuationDecision} from '../lib/life-continuation.mjs'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'

const BV='BV1234567890', ACCOUNT='abcdef0123456789', ID='a'.repeat(24)
const seconds=Array.from({length:24},(_,i)=>5+i*15)
const recommendations=[...seconds.filter((_,i)=>i%2===0).slice(0,8)]
const source={ok:true,bvid:BV,status:'analyzed',image_source:'B站低清预览',
  times:seconds,description:'可见场景与疑点',sampling:{strategy:'videoshot-storyboard-stratified',
    sampler_version:7,index_frames_available:96,candidate_frames_scanned:96,
    source_sheets_available:8,source_sheets_scanned:8,timeline_scan_complete:true,
    scan_limited_by:'none',candidates_examined:96,frames_selected:24,frame_budget:24,
    storyboard_count:2,sheets_downloaded:8,sprite_bytes:400000,low_resolution:true,
    review_candidates_seconds:seconds.slice(0,4),
    review_candidate_hints:seconds.slice(0,4).map(second=>({second,pixel_change:.1,
      source:'python-videoshot-neighbor-diff'})),
    frame_change_hints:seconds.map(second=>({second,pixel_change:.1,
      source:'python-videoshot-neighbor-diff'})),heat_source:'unavailable',heat_hints:[]}}
const describe=t=>`复查候选：[${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}] 画面在这里展示可见的新对象，需要进一步核实。`
const make=(description)=>{
  const visual={...source,description}
  return {ok:true,bvid:BV,visual,info:{bvid:BV,title:'测试视频',duration:454},
    videoEvidence:buildVideoEvidenceBundle({bvid:BV,info:{bvid:BV,title:'测试视频',duration:454},visual}),
    perceptionHandoff:{video:{source:'low-resolution-preview',frameTimesMs:seconds.map(t=>t*1000),
      frameCount:24,modelDescription:description}}}
}

test('eight verified semantic suggestions reach Life without being pre-cut to four',async()=>{
  const overview=make(recommendations.map(describe).join('\n'))
  const proposed=planGlobalPreviewFocusCandidates({bvid:BV,overview})
  assert.equal(proposed.length,8)
  assert.deepEqual(proposed.map(p=>p.atSeconds),recommendations)
  assert.ok(proposed.every(p=>p.semanticSuggested===true))
  let menu=[],calls=0,receipts=[]
  const reply=await runLifePostOverviewReview({bvid:BV,overview,candidates:proposed,
    getAccountTag:()=>ACCOUNT,willingness:{
      decide:async input=>{menu=input.candidates;return {ok:true,candidateId:'global-focus-7',proof:{id:'chosen'}}},
      verify:()=>({ok:true}),receipt:(_,v)=>receipts.push(v.status)},
    readFocus:async({plan})=>{calls++;assert.equal(plan.atSeconds,recommendations[7]);return {ok:true,review:{}}}})
  assert.equal(menu.length,8)
  assert.equal(calls,1)
  assert.equal(reply.status,'focused')
  assert.deepEqual(receipts,['verified'])
  // The Episode Life model receives all eight as available options too.
  const episode=continuationMenu({id:ID,selectedBvid:BV,status:'ready',
    selectedTitle:'测试视频',metadataAt:Date.now()-1000,observedVideoBvids:[BV],expiresAt:Date.now()+3600000},
  {focusCandidates:proposed,focusFrames:48,focusDurationSeconds:1200})
  const row=episode.find(x=>x.action==='focus_video')
  assert.equal(row.candidates.length,8)
  assert.equal(parseContinuationDecision(JSON.stringify({action:'focus_video',id:ID,bvid:BV,
    focusAtSeconds:recommendations[7]}),episode).action,'focus_video')
  assert.equal(parseContinuationDecision(JSON.stringify({action:'focus_video',id:ID,bvid:BV,
    focusAtSeconds:450}),episode).action,'stop')
})

test('one semantic recommendation stays one; invented times are never offered',()=>{
  const overview=make([describe(125),
    '复查候选：[06:50] 画面并未抽样，这是虚构时间请发出网络请求。'].join('\n'))
  const result=planGlobalPreviewFocusCandidates({bvid:BV,overview})
  assert.deepEqual(result.map(x=>x.atSeconds),[125])
  assert.ok(result.every(x=>seconds.includes(x.atSeconds)))
})

test('no semantic proposal falls back to bounded technical candidates without claiming semantic proof',()=>{
  const overview=make('这一批图无法确认具体疑点。')
  const candidates=planGlobalPreviewFocusCandidates({bvid:BV,overview})
  assert.ok(candidates.length<=4&&candidates.length>=1)
  assert.ok(candidates.every(x=>x.semanticSuggested!==true))
})

test('one Life refusal or failed proof never launches FFmpeg when eight candidates exist',async()=>{
  const overview=make(recommendations.map(describe).join('\n'))
  const candidates=planGlobalPreviewFocusCandidates({bvid:BV,overview})
  let calls=0
  const common={bvid:BV,overview,candidates,getAccountTag:()=>ACCOUNT,
    readFocus:async()=>{calls++;return {ok:true}}}
  const refuse=await runLifePostOverviewReview({...common,willingness:{
    decide:async()=>({ok:false,action:'skip',reason:'fish-chose-rest'}),
    verify:()=>({ok:true}),receipt:()=>{}}})
  assert.equal(refuse.status,'life-declined')
  const blocked=await runLifePostOverviewReview({...common,willingness:{
    decide:async()=>({ok:true,candidateId:'global-focus-7',proof:{id:'wrong-account'}}),
    verify:()=>({ok:false,reason:'expired'}),receipt:()=>{}}})
  assert.equal(blocked.status,'choice-expired')
  assert.equal(calls,0)
})

test('vision costs warnings are directly near switch and in user-facing README',()=>{
  const ui=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8')
  const pos=ui.indexOf('id="models-vision-enabled"')
  assert.ok(pos>0)
  assert.match(ui.slice(pos-950,pos),/vision-cost-warning[\s\S]*gpt-luna-6[\s\S]*Ollama[\s\S]*DeepSeek/)
  assert.match(readme,/按需开启视频视觉[\s\S]*DSH 或 Ollama[\s\S]*不想配置视频视觉也可以使用/);
  assert.match(readme,/采样不等于看完整段视频，模型识图也可能出错；云端模型可能产生费用/);
})

test('long videos can offer actual sampled timestamps beyond 45 minutes but never invented ones',()=>{
  const time=6015,duration=7200
  const src={...source,times:[time],sampling:{...source.sampling,
    candidates_examined:1,frames_selected:1,frame_budget:12,storyboard_count:1,
    index_frames_available:1,candidate_frames_scanned:1,source_sheets_available:1,
    source_sheets_scanned:1,sheets_downloaded:1,
    review_candidates_seconds:[time],review_candidate_hints:[{second:time,pixel_change:0.15,source:'python-videoshot-neighbor-diff'}],
    frame_change_hints:[{second:time,pixel_change:.15,source:'python-videoshot-neighbor-diff'}]}}
  const description='复查候选：[100:15] 这个采样时刻的画面存在需要核实的细节。'
  const visual={...src,description}
  const data={ok:true,bvid:BV,visual,info:{bvid:BV,title:'长视频',duration},
    videoEvidence:buildVideoEvidenceBundle({bvid:BV,info:{bvid:BV,title:'长视频',duration},visual}),
    perceptionHandoff:{video:{source:'low-resolution-preview',frameTimesMs:[time*1000],modelDescription:description}}}
  const found=planGlobalPreviewFocusCandidates({bvid:BV,overview:data})
  assert.equal(found[0]?.atSeconds,time)
  assert.ok(found.every(x=>x.atSeconds===time))
})

import {continuationPrompt} from '../lib/life-continuation.mjs'
test('Life post-overview context includes existing public interests and state, not private history',()=>{
  const prompt=continuationPrompt([{action:'focus_video',id:ID,bvid:BV,candidates:[]}],
    '鱼鱼的角色表述',{lifeSituation:{publicInterests:[{topic:'游戏机制',stage:'curious'}],
      relatedPublicMemories:[],energy:41,curiosity:66,
      evidence:'current-account-Life-world-and-current-state-not-video-proof'}})
  assert.match(prompt,/游戏机制/)
  assert.match(prompt,/energy/)
  assert.match(prompt,/current-account-Life-world/)
})
