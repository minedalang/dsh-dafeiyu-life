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
