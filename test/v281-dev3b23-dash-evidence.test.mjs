import test from 'node:test'
import assert from 'node:assert/strict'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'
const bvid='BV1234567890', info={bvid,title:'离线 DASH 时间窗样例'}
const windows=[{startSeconds:120,endSeconds:122},{startSeconds:1120,endSeconds:1122},{startSeconds:2120,endSeconds:2122},{startSeconds:3120,endSeconds:3122}]
const times=[120,121,1120,1121,2120,2121,3120,3121]
const sample={sampler_version:7,strategy:'decoded-storyboard-stratified-2fps',source_type:'bili-public-playurl-dash',
  input_bytes:3400000,network_budget_bytes:25165824,remote_video_bytes:130000000,
  download_mode:'indexed-dash-sidx-byte-ranges',download_ranges:7,
  video_duration_seconds:3800,clip_window:{startSeconds:0,endSeconds:3800},sampled_windows:windows,
  sampled_duration_seconds:8,heat_source:'unavailable',viewer_heat_is_content_evidence:false,
  depth:'deep',frame_plan:12,frame_budget:12,frames_selected:8,storyboard_count:1,candidates_examined:16}
const visual={bvid,ok:true,status:'analyzed',image_source:'B站公开视频片段（离线解码）',description:'读取四个不同时段的真实画面，原始音轨不可用',times,sampling:sample}
const evidence = v => buildVideoEvidenceBundle({bvid,info,visual:v})
test('v7 DASH four-hour sampled timeline yields actual decoded evidence with honest limited coverage',()=>{
 const result=evidence(visual)
 assert.ok(result)
 assert.equal(result.sources.find(x=>x.kind==='decoded_video_frames')?.timePointsMs.length,8)
 assert.ok(result.sources.find(x=>x.kind==='decoded_visual_analysis'))
 assert.equal(result.observedVideoPlayback,false)
 assert.equal(result.analyzedOriginalAudio,false)
})
test('v7 refuses to promote forged range identity, overbudget, unsupported source or invalid durations',()=>{
 const changes=[
  {input_bytes:25165825},{remote_video_bytes:1},{download_mode:'complete-bounded'},
  {source_type:'untrusted'},{video_duration_seconds:14401}, {download_ranges:0},
  {sampled_windows:[{startSeconds:5000,endSeconds:5001}]},
 ]
 for (const change of changes) {
   const candidate={...visual,sampling:{...sample,...change}}
   assert.equal(evidence(candidate).sources.some(x=>x.kind==='decoded_video_frames'),false,JSON.stringify(change))
 }
})
test('v7 DURL remains accepted, v6 must not forge a DASH receipt',()=>{
 const progressive={...visual,sampling:{...sample,source_type:'bili-public-playurl-durl',download_mode:'indexed-mp4-byte-ranges'}}
 assert.ok(evidence(progressive).sources.find(x=>x.kind==='decoded_video_frames'))
 const legacy={...visual,sampling:{...sample,sampler_version:6}}
 assert.equal(evidence(legacy).sources.some(x=>x.kind==='decoded_video_frames'),false)
})
