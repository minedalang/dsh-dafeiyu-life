import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'
import {buildVideoPerceptionTimeline} from '../lib/video-perception-timeline.mjs'
import {buildVideoPerceptionHandoff} from '../lib/video-perception-handoff.mjs'
import {planVideoFocusReview,verifyVideoFocusReview} from '../lib/video-focus-review.mjs'
import {createLocalVisionModelManager} from '../lib/local-vision-model-manager.mjs'
const BV='BV1bkW86bEkj',info={bvid:BV,title:'当你不理一只想和你玩的大肥鱼'}
const moments=[.5,2,3.5,5.5,8,10.5,13,14.5,16.5,18.5,23,25,28,29.5,32,34,35.5,37,38.5,40.5,45,48.5,51,58]
const sample={sampler_version:6,strategy:'decoded-storyboard-stratified-2fps',source_type:'bili-public-playurl-durl',
  input_bytes:2661333,network_budget_bytes:52428800,remote_video_bytes:2661333,download_mode:'complete-bounded',download_ranges:1,
  clip_window:{startSeconds:0,endSeconds:60},sampled_windows:[{startSeconds:0,endSeconds:60}],video_duration_seconds:60,
  heat_source:'unavailable',viewer_heat_is_content_evidence:false,depth:'deep',frame_plan:24,frame_budget:24,
  storyboard_count:2,candidates_examined:118,frames_selected:24,scene_change_seconds:[23],motion_hotspots_seconds:[28.5,37,48.5]}
const visual={ok:true,status:'analyzed',bvid:BV,image_source:'B站公开视频片段（离线解码）',
  description:'有些动作不确定，需要看清楚床边那段可能的互动',times:moments,sampling:sample}
const bundle=v=>buildVideoEvidenceBundle({bvid:BV,info,visual:v})

test('real v6 24-frame sample now survives evidence gate and Life handoff',()=>{
 const evidence=bundle(visual)
 assert.equal(evidence.sources.find(x=>x.kind==='decoded_video_frames').timePointsMs.length,24)
 assert.equal(evidence.sources.find(x=>x.kind==='decoded_visual_analysis').status,'analyzed')
 const timeline=buildVideoPerceptionTimeline({bvid:BV,evidence,visual})
 const handoff=buildVideoPerceptionHandoff({bvid:BV,depth:'deep',info,visual,evidence,timeline})
 assert.equal(handoff.coverageAssessment.level,'visual-only')
 assert.equal(handoff.video.frameCount,24)
 assert.equal(handoff.video.source,'decoded-public-video')
 assert.equal(handoff.video.observations[0].uncertainty,'not-frame-by-frame')
 assert.equal(handoff.coverageAssessment.videoIsFullyObserved,false)
})

test('v6 rejects forged range totals, wrong download identities or unverified times',()=>{
 for(const change of [
   {input_bytes:52428801},{network_budget_bytes:52428801},
   {remote_video_bytes:1},{download_mode:'untrusted'},
   {download_mode:'complete-bounded',input_bytes:2650000},
 ]){
   const forged={...visual,sampling:{...sample,...change}}
   assert.equal(bundle(forged).sources.some(x=>x.kind==='decoded_video_frames'),false,JSON.stringify(change))
 }
 assert.equal(bundle({...visual,times:[...moments.slice(0,23),61]}).sources.some(x=>x.kind==='decoded_video_frames'),false)
})

test('deep ambiguous overview selects focus window only from trusted scene/motion within shared byte budget',()=>{
 const primary=bundle(visual),plan=planVideoFocusReview({bvid:BV,depth:'deep',visual,evidence:primary})
 assert.equal(plan.status,'ready')
 assert.equal(plan.startSeconds,17)
 assert.equal(plan.endSeconds,29)
 assert.equal(plan.networkBudgetBytes,25165824)
 assert.equal(plan.remainingBytes,52428800-2661333)
 const focusVisual={...visual,times:[18,19,20,21,22,23],focus_window:{startSeconds:17,endSeconds:29},
   sampling:{...sample,depth:'deep',frame_plan:12,frame_budget:12,storyboard_count:1,
     sampled_windows:[{startSeconds:17,endSeconds:29}],sampled_duration_seconds:12,
     input_bytes:2661333,network_budget_bytes:25165824,frames_selected:6,candidates_examined:24,
     frame_pixel_size:[384,216]}}
 const focusEvidence=bundle(focusVisual)
 assert.ok(focusEvidence.sources.some(x=>x.kind==='decoded_video_frames'))
 const review=verifyVideoFocusReview({bvid:BV,plan,result:focusVisual,evidence:focusEvidence})
 assert.equal(review.pixelSize[0],384)
 assert.equal(review.frameTimesMs.length,6)
 assert.equal(review.reviewStatus,'model-observation-not-independent-semantic-proof')
 assert.equal(verifyVideoFocusReview({bvid:BV,plan,result:{...focusVisual,bvid:'BV1234567890'},evidence:focusEvidence}),null)
 assert.equal(verifyVideoFocusReview({bvid:BV,plan,result:{...focusVisual,sampling:{...focusVisual.sampling,input_bytes:40000000}},evidence:focusEvidence}),null)
 assert.equal(planVideoFocusReview({bvid:BV,depth:'standard',visual,evidence:primary}),null)
 assert.equal(planVideoFocusReview({bvid:BV,depth:'deep',visual:{...visual,description:'画面清楚'},evidence:primary}),null)
})

test('bare official Ollama digest normalizes for human approval and survives a fresh manager',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fish-digest-bare-'));const raw='c'.repeat(64)
 const fetchImpl=async url=>new Response(JSON.stringify(url.endsWith('/api/tags')?
    {models:[{name:'openbmb/minicpm-v4.7:1b',digest:raw}]}:
    {message:{content:'画面中有蓝发人物和蓝色衣服'}}),{status:200})
 try{
   let m=createLocalVisionModelManager({stateDir:dir,fetchImpl})
   const probe=await m.verifyId('minicpm-v4.7-1b')
   assert.equal((await m.review('minicpm-v4.7-1b',{reviewId:probe.reviewId,accepted:true})).verified,true)
   assert.match(readFileSync(join(dir,'local-vision-approvals.json'),'utf8'),/sha256:c{64}/)
   m=createLocalVisionModelManager({stateDir:dir,fetchImpl})
   assert.equal((await m.list()).models[1].verified,true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('quick setup reflects real readiness and debug has an honest indeterminate activity bar',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(html,/id="video-debug-progressbar"/)
 assert.match(js,/bar\.removeAttribute\('value'\)/)
 assert.match(js,/input\.disabled=ready/)
 assert.match(js,/实际 FFmpeg 合成视频帧解码自测通过/)
 const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(server,/focusReviewSuggestion/); assert.match(server,/life-decision-required/)
 assert.match(server,/speechAttempt/)
})
