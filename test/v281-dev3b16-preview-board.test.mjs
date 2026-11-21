import test from 'node:test'
import assert from 'node:assert/strict'
import {buildVideoEvidenceBundle,videoEvidenceFlags} from '../lib/video-evidence-bundle.mjs'
const BV='BV1234567890'
const times=Array.from({length:24},(_,i)=>i*5+2)
const sampling={strategy:'videoshot-storyboard-stratified',sampler_version:5,candidates_examined:48,
  frames_selected:24,frame_budget:24,storyboard_count:2,sheets_downloaded:6,sprite_bytes:361726,low_resolution:true}
const visual={ok:true,bvid:BV,status:'analyzed',times,image_source:'B站低清预览',
  description:'在不同时间段可见不同的角色和物品，细节因低清无法确认。',sampling}
const make=v=>buildVideoEvidenceBundle({bvid:BV,info:{bvid:BV,title:'预览拼图测试'},visual:v})
test('2.8.1-dev.3b.16: 24 storyboard preview tiles are low-res, not decoded video',()=>{
  const bundle=make(visual),src=bundle.sources.find(x=>x.kind==='preview_frames')
  assert.equal(src.timePointsMs.length,24)
  assert.equal(src.sampling.storyboards,2)
  assert.equal(src.sampling.frameBudget,24)
  assert.equal(src.sampling.lowResolution,true)
  assert.ok(bundle.sources.some(x=>x.kind==='preview_visual_analysis'))
  const flags=videoEvidenceFlags(bundle)
  assert.equal(flags.preview,true);assert.equal(flags.decoded,false)
  assert.equal(bundle.observedVideoPlayback,false)
  assert.equal(bundle.analyzedOriginalAudio,false)
})
test('v9 long-index preview evidence stays sampled and cannot claim full coverage',()=>{
  const selected=[100,1200,2500,3500,4900,5900]
  const sample={strategy:'videoshot-storyboard-stratified',sampler_version:9,
    index_frames_available:6000,candidate_frames_scanned:1400,
    source_sheets_available:60,source_sheets_scanned:48,timeline_scan_complete:false,
    scan_limited_by:'tile-cap',candidates_examined:1400,frames_selected:6,
    frame_budget:24,storyboard_count:1,sheets_downloaded:48,sprite_bytes:500000,
    low_resolution:true,review_candidates_seconds:selected.slice(0,4),
    review_candidate_hints:selected.slice(0,4).map(second=>({second,pixel_change:.1,
      source:'python-videoshot-neighbor-diff'})),
    frame_change_hints:selected.map(second=>({second,pixel_change:.1,
      source:'python-videoshot-neighbor-diff'})),heat_source:'unavailable',heat_hints:[]}
  const long={...visual,times:selected,sampling:sample}
  const source=make(long).sources.find(x=>x.kind==='preview_frames')
  assert.ok(source,'new v9 records from Python must survive the Node evidence verifier')
  assert.equal(source.sampling.indexFramesAvailable,6000)
  assert.equal(source.sampling.timelineScanComplete,false)
  assert.equal(source.sampling.scanLimitedBy,'tile-cap')
  assert.deepEqual(source.timePointsMs,selected.map(second=>second*1000))
  for(const broken of [
    {...sample,index_frames_available:300001},
    {...sample,candidate_frames_scanned:1401,candidates_examined:1401},
    {...sample,source_sheets_scanned:49},
    {...sample,timeline_scan_complete:true},
    {...sample,heat_hints:[{second:123456,heat:.5}]},
    {...sample,scan_limited_by:'unsafe-unknown'},
  ]){
    assert.equal(make({...long,sampling:broken}).sources.some(s=>s.kind==='preview_frames'),false)
  }
})
test('2.8.1-dev.3b.16: unknown or oversized thumbnail evidence is rejected',()=>{
  for(const v of [
    {...visual,sampling:{...sampling,sprite_bytes:9*1024*1024}},
    {...visual,sampling:{...sampling,storyboard_count:1}},
    {...visual,sampling:{...sampling,frames_selected:3}},
    {...visual,sampling:{...sampling,low_resolution:false}},
    {...visual,image_source:'B站公开视频片段（离线解码）'},
  ]){
    const bundle=make(v)
    assert.equal(bundle.sources.some(x=>x.kind==='preview_frames'),false)
    assert.equal(bundle.sources.some(x=>x.kind==='decoded_video_frames'),false)
  }
})
