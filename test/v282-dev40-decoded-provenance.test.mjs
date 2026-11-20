import test from 'node:test'
import assert from 'node:assert/strict'
import {buildVideoEvidenceBundle,decodedFrameProvenanceReason} from '../lib/video-evidence-bundle.mjs'
import {diagnoseVideoFocusReceipt} from '../lib/video-focus-review.mjs'
import {ownerFocusSafeReport} from '../lib/video-debug-receipt.mjs'

const BV='BV1234567890'
const times=[56,57,62,63.5,66.5,67.5,72,73.5,76,77.5,82,83]
const windows=[56,62,66,72,76,82].map(t=>({startSeconds:t,endSeconds:t+1.95}))
const source={sampler_version:8,strategy:'decoded-storyboard-stratified-2fps',source_type:'bili-public-playurl-dash',
  input_bytes:602228,selected_track_input_bytes:602228,network_budget_bytes:50*1048576,
  source_attempts:['dash-indexed'],remote_video_bytes:8083591,
  download_mode:'indexed-dash-sidx-byte-ranges',download_ranges:9,
  sampled_windows:windows,video_duration_seconds:160,heat_source:'unavailable',viewer_heat_is_content_evidence:false,
  depth:'deep',frame_plan:24,frame_budget:24,frame_budget_limit:24,frames_selected:12,storyboard_count:1,candidates_examined:36}
const visual={ok:true,bvid:BV,status:'analyzed',description:'实际获取原视频的十二个采样帧，已分别进行受限图像模型分析。',
  image_source:'B站公开视频片段（离线解码）',focus_window:{startSeconds:55,endSeconds:85},times,sampling:source}
const plan={status:'ready',startSeconds:55,endSeconds:85,networkBudgetBytes:50*1048576}
const getEvidence=v=>buildVideoEvidenceBundle({bvid:BV,info:{bvid:BV,title:'离线视频测试'},visual:v})
const check=v=>diagnoseVideoFocusReceipt({bvid:BV,plan,result:v,evidence:getEvidence(v)})
test('six signed DASH fragments at a 30s focus window yield 12 real video frames',()=>{
  assert.equal(decodedFrameProvenanceReason(visual),'accepted')
  assert.equal(check(visual).code,'focus-evidence-verified')
  assert.equal(getEvidence(visual).sources.find(x=>x.kind==='decoded_video_frames')?.timePointsMs.length,12)
})
test('a valid audited fallback must account for total traffic and selected track separately',()=>{
  const fallback={...visual,sampling:{...source,
    input_bytes:12_000_000,selected_track_input_bytes:602228,remote_video_bytes:8_083_591,
    source_attempts:['durl-complete','durl-mp4-indexed','dash-indexed']}}
  assert.equal(decodedFrameProvenanceReason(fallback),'accepted')
  assert.equal(check(fallback).code,'focus-evidence-verified')
  for(const sample of [
    {...fallback.sampling,selected_track_input_bytes:9_000_000},
    {...fallback.sampling,selected_track_input_bytes:0},
    {...fallback.sampling,source_attempts:['dash-indexed']},
    {...fallback.sampling,source_attempts:['malicious','dash-indexed']},
    {...fallback.sampling,input_bytes:52_428_801},
    {...fallback.sampling,network_budget_bytes:52_428_801},
  ]){
    const v={...fallback,sampling:sample}
    assert.equal(decodedFrameProvenanceReason(v),'transfer-bytes')
    assert.equal(check(v).code,'decoded-frame-provenance-rejected')
    assert.equal(check(v).provenanceReason,'transfer-bytes')
  }
})
test('legacy receipts without explicit final-track bytes keep historical strict behavior',()=>{
  const old={...visual,sampling:{...source,input_bytes:12_000_000,
    source_attempts:['durl-complete','dash-indexed'],remote_video_bytes:8_083_591,
    selected_track_input_bytes:undefined}}
  assert.equal(decodedFrameProvenanceReason(old),'transfer-bytes')
  assert.equal(check(old).provenanceReason,'transfer-bytes')
})
test('provenance rejects invalid windows, time offsets, and forged source identities with precise safe reasons',()=>{
  const variants=[
    [{...visual,sampling:{...source,source_type:'untrusted'}},'source'],
    [{...visual,sampling:{...source,video_duration_seconds:16000}},'video-duration'],
    [{...visual,sampling:{...source,sampled_windows:[{startSeconds:90,endSeconds:90}]}},'sampled-windows'],
    [{...visual,times:[...times.slice(0,-1),85.5]},'sampled-times'],
    [{...visual,sampling:{...source,download_mode:'complete-bounded'}},'transfer-mode'],
    [{...visual,sampling:{...source,frame_budget:2}},'frame-counts'],
    [{...visual,sampling:{...source,heat_source:'model-recommended'}},'heat-source'],
  ]
  for(const [v,expected] of variants){
    assert.equal(decodedFrameProvenanceReason(v),expected)
    assert.equal(check(v).code,'decoded-frame-provenance-rejected')
    assert.equal(check(v).provenanceReason,expected)
    assert.ok(!getEvidence(v).sources.some(x=>x.kind==='decoded_video_frames'))
  }
})
test('diagnostic export preserves only finite allowlisted rule names',()=>{
  const job={sourceMode:'owner-focus',status:'done',updatedAt:Date.now(),ownerFocus:{
    status:'focus-unavailable',selectedTargets:[{durationSeconds:30}],focusWindows:[],
    focusDiagnosis:{...check({...visual,sampling:{...source,input_bytes:9e9}}),bvid:'private',secret:'private'}}}
  const report=ownerFocusSafeReport(job,'private-account')
  assert.equal(report.code,'decoded-frame-provenance-rejected')
  assert.equal(report.provenanceReason,'transfer-bytes')
  assert.ok(!JSON.stringify(report).includes('private'))
  job.ownerFocus.focusDiagnosis.provenanceReason='https://untrusted.invalid/path'
  assert.ok(!('provenanceReason' in ownerFocusSafeReport(job,'private-account')))
})
