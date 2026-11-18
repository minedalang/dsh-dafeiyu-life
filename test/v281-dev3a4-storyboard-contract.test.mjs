import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'
const src=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const bvid='BV1234567890',info={bvid,title:'示例视频'}
const windows=Array.from({length:8},(_,i)=>({startSeconds:50+i*150,endSeconds:65+i*150}))
const times=windows.flatMap(w=>[w.startSeconds+1,w.startSeconds+4,w.startSeconds+7,w.startSeconds+10,w.startSeconds+13,w.startSeconds+14])
const valid={ok:true,bvid,status:'analyzed',image_source:'B站公开视频片段（离线解码）',description:'多个真实解码片段的画面包含不同场景，但未取得完整音轨',times,
  sampling:{sampler_version:5,strategy:'decoded-storyboard-stratified-2fps',source_type:'bili-public-playurl-durl',
   clip_window:{startSeconds:0,endSeconds:1200},sampled_windows:windows,sampled_duration_seconds:120,
   video_duration_seconds:1200,heat_source:'bili-danmaku-xml-density',viewer_heat_is_content_evidence:false,
   depth:'deep',frame_plan:48,frame_budget:48,storyboard_count:4,candidates_examined:240,frames_selected:48}}
test('48 frames of decoded storyboards are accepted only when each timestamp belongs to decoded windows',()=>{
 const bundle=buildVideoEvidenceBundle({bvid,info,visual:valid})
 const frame=bundle.sources.find(s=>s.kind==='decoded_video_frames')
 assert.ok(frame)
 assert.equal(frame.timePointsMs.length,48)
 assert.equal(frame.sampling.storyboards,4)
 assert.equal(bundle.verifiedContent,true)
 assert.equal(bundle.observedVideoPlayback,false)
 assert.equal(bundle.analyzedOriginalAudio,false)
 assert.ok(bundle.sources.some(s=>s.kind==='decoded_visual_analysis'))
 const forged={...valid,times:[...times.slice(0,-1),1190]}
 assert.equal(buildVideoEvidenceBundle({bvid,info,visual:forged}).sources.some(s=>s.kind==='decoded_video_frames'),false)
 const heatFaked={...valid,sampling:{...valid.sampling,viewer_heat_is_content_evidence:true}}
 assert.equal(buildVideoEvidenceBundle({bvid,info,visual:heatFaked}).sources.some(s=>s.kind==='decoded_video_frames'),false)
})
test('frame plans are explicitly available and old high-energy videoshot sampling is removed',()=>{
 const html=src('lib/management-console.html'),ui=src('lib/management-console.js'),index=src('index.js'),preview=src('lib/preview_vision.py'),mcp=src('vendor/bilibili-mcp/mcp_server.py')
 for(const num of [12,24,48]) assert.match(html,new RegExp('data-vision-frame-plan="'+num+'"'))
 assert.match(index,/visionFrames: z\.natural\(\)\.default\(24\)/)
 assert.match(ui,/syncVisionFramePlan/)
 assert.match(mcp,/view_depth: str = "standard"/)
 assert.doesNotMatch(preview,/_pbp_curve|_high_energy_indices|_sample_high_energy/)
 assert.match(preview,/_pick_indices/)
 assert.ok(existsSync(new URL('../docs/architecture/assets/video-danmaku-heat-illustration.svg',import.meta.url)))
 const readme=src('README.md')
 assert.match(readme,/## 🎥 视频感知与模型选择/)
 // Detailed graphics were relocated to the maintained architecture guide.
 // Do not force retired diagrams back into the public README just to pass.
 const architecture=src('docs/architecture/2.8.1-video-perception-dev3a4.md')
 assert.match(architecture,/video-danmaku-heat-illustration\.svg/)
 assert.match(architecture,/```mermaid/)
})
