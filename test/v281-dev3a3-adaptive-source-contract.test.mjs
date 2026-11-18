import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildVideoEvidenceBundle,videoEvidenceFlags} from '../lib/video-evidence-bundle.mjs'
import {visionDecision} from '../lib/video-vision-policy.mjs'

const bv='BV1234567890'
const info={bvid:bv,title:'测试内容'}
const sample={ok:true,bvid:bv,status:'analyzed',image_source:'B站公开视频片段（离线解码）',
  times:[2,6,8],description:'画面有三段明显变化，未获取音频',sampling:{
    sampler_version:4,strategy:'decoded-scene-2fps',source_type:'bili-public-playurl-durl',
    candidates_examined:20,frames_selected:3,scene_candidates:3,cut_candidates:2,
    scene_change_seconds:[3.5,6.5],motion_hotspots_seconds:[4,4.5],
    clip_window:{startSeconds:0,endSeconds:10}}}

test('真实公开视频帧证据与低清预览严格分离',()=>{
 const result=buildVideoEvidenceBundle({bvid:bv,info,visual:sample})
 assert.ok(result)
 const frames=result.sources.find(x=>x.kind==='decoded_video_frames')
 assert.equal(frames.origin,'bili-public-playurl-ffmpeg')
 assert.equal(frames.coverage,'sampled-public-video-frames')
 assert.deepEqual(frames.timePointsMs,[2000,6000,8000])
 assert.deepEqual(frames.sampling.sceneChangePointsMs,[3500,6500])
 assert.equal(result.sources.some(x=>x.kind==='preview_frames'),false)
 assert.equal(result.sources.some(x=>x.kind==='decoded_visual_analysis'),true)
 assert.equal(result.observedVideoPlayback,false)
 assert.equal(result.analyzedOriginalAudio,false)
 assert.deepEqual(videoEvidenceFlags(result).decoded,true)
 assert.equal(videoEvidenceFlags(result).vision,true)
})

test('无法通过不匹配的采样元数据假装解码成功',()=>{
 const forged={...sample,sampling:{...sample.sampling,source_type:'web-unverified'}}
 const bundle=buildVideoEvidenceBundle({bvid:bv,info,visual:forged})
 assert.equal(bundle.sources.some(x=>x.kind==='decoded_video_frames'||x.kind==='preview_frames'),false)
 assert.equal(bundle.sources.some(x=>x.kind==='decoded_visual_analysis'||x.kind==='preview_visual_analysis'),false)
 assert.equal(bundle.verifiedContent,false)
 const wrongClip={...sample,sampling:{...sample.sampling,clip_window:{startSeconds:10,endSeconds:20}}}
 assert.equal(buildVideoEvidenceBundle({bvid:bv,info,visual:wrongClip}).sources.some(x=>x.kind==='decoded_video_frames'),false)
})

test('自适应失败回退后的官方预览只能生成 preview 证据',()=>{
 const fallback={ok:true,bvid:bv,status:'analyzed',description:'低清预览似乎有鱼形',
   image_source:'B站低清预览',times:[3,7],
   sampling:{sampler_version:3,strategy:'focus-window+local-thumbnail-difference',candidates_examined:6,frames_selected:2,sheets_downloaded:1},
   focus_window:{startSeconds:2,endSeconds:9},
   perception_source_requested:'adaptive',adaptive_fallback:{reason:'video_exceeds_24mb_limit',actual_source:'videoshot'}}
 const bundle=buildVideoEvidenceBundle({bvid:bv,info,visual:fallback})
 assert.ok(bundle.sources.some(x=>x.kind==='preview_frames'))
 assert.equal(bundle.sources.some(x=>x.kind==='decoded_video_frames'),false)
})

test('自主不看和略看不触发识图，正常/深入才申请工具',()=>{
 assert.equal(visionDecision({enabled:true,depth:'skim'}).attempt,false)
 assert.equal(visionDecision({enabled:true}).attempt,false)
 assert.equal(visionDecision({enabled:true,depth:'standard'}).attempt,true)
 assert.equal(visionDecision({enabled:true,depth:'deep'}).attempt,true)
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const watch=index.slice(index.indexOf('const executeWatchVideo = async'),index.indexOf('tool({',index.indexOf('const executeWatchVideo = async')))
 assert.match(watch,/const willInvokeVision=visionPlan\.attempt&&\['independent_dsh','independent_local'\]/)
 assert.match(watch,/perception_source:'adaptive'/)
 const mcp=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
 assert.match(mcp,/perception_source: str = "preview"/)
 assert.match(mcp,/perception_source not in \('preview','adaptive'\)/)
 assert.match(mcp,/_guard\("bili_preview_vision"\)/)
})
