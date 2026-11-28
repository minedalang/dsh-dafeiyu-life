import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'
import {buildVideoPerceptionHandoff,projectVideoModelView,projectVideoTodoModelView} from '../lib/video-perception-handoff.mjs'

const BV='BV1234567890'
const times=[10,25,35,40,55,65,70,80,90,115,120,131,146,161,171,176,186,201,211,231,256,281,291,311]
const sample={strategy:'videoshot-storyboard-stratified',sampler_version:10,
  index_frames_available:65,candidate_frames_scanned:65,candidates_examined:65,
  source_sheets_available:1,source_sheets_scanned:1,sheets_downloaded:1,
  timeline_scan_complete:true,scan_limited_by:'none',review_candidates_seconds:[],review_candidate_hints:[],
  frame_change_hints:times.map(second=>({second,pixel_change:.3,source:'python-videoshot-neighbor-diff'})),
  heat_hints:[],heat_source:'unavailable',frame_budget:24,storyboard_count:2,
  sprite_bytes:408313,low_resolution:true,frames_selected:24}
const make=()=>({ok:true,bvid:BV,status:'analyzed',image_source:'B站低清预览',times,
  sampling:sample,description:'分镜图1：大厅。\n\n分镜图2：飞机。',
  visionBoardReceipts:[
    {index:1,times:times.slice(0,12),status:'analyzed',description:'第一张图中有人经过大厅。'},
    {index:2,times:times.slice(12),status:'analyzed',description:'第二张图中可以看到飞机。'}]})
const handoff=v=>{
 const info={bvid:BV,title:'测试视频',duration:324}
 const evidence=buildVideoEvidenceBundle({bvid:BV,info,visual:v})
 const timeline={schema:'life-video-perception-timeline/v1',bvid:BV,anchors:[]}
 return {evidence,handoff:buildVideoPerceptionHandoff({bvid:BV,depth:'deep',info,visual:v,evidence,timeline})}
}
test('v10 two board receipts are represented individually without claiming semantic agreement',()=>{
 const {evidence,handoff:h}=handoff(make())
 assert.equal(evidence.sources.some(s=>s.kind==='preview_visual_analysis'),true)
 assert.equal(h.video.boardInterpretations.length,2)
 assert.deepEqual(h.video.observations.map(o=>o.boardIndex),[1,2])
 assert.equal(h.video.observations[1].fromMs,146000)
 assert.equal(h.video.observations[0].semanticAlignment,'not-independently-verified')
 assert.equal(h.review.verifiedAgreement,false)
})
test('partial storyboard cannot enter Life as complete model evidence',()=>{
 const v=make();v.status='vision_incomplete';delete v.description
 v.visionPartialDescription='仅第一张的部分回答'
 const {evidence,handoff:h}=handoff(v)
 assert.equal(evidence.sources.some(s=>s.kind==='preview_visual_analysis'),false)
 assert.equal(h.video.modelDescription,'')
 assert.deepEqual(h.video.observations,[])
})
test('wrongly mapped board time list cannot forge individually aligned observations',()=>{
 const v=make();v.visionBoardReceipts[1].times[0]=10
 const {handoff:h}=handoff(v)
 assert.deepEqual(h.video.boardInterpretations,[])
})
test('user-facing current version and debug explicitly expose per-board outcome',()=>{
 const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
 const page=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
 assert.match(client,/✨ 2\.8\.3 版本亮点/)
 assert.doesNotMatch(client,/✨ 2\.8\.1 版本亮点/)
 assert.match(page,/视觉模型逐张分镜回执/)
 assert.match(js,/分镜图 \$\{r\.index\} · 模型回执/)
 assert.ok(manifest.files.includes('docs/release/2.8.3-user-upgrade-guide.md'))
})

test('Life receives balanced local board information rather than only board one',async()=>{
 const {balancedUntrustedVideoSummary}=await import('../lib/life-video-read-admission.mjs')
 const rows=[
  {index:1,status:'model-generated-unverified',description:'甲'.repeat(800)},
  {index:2,status:'model-generated-unverified',description:'乙'.repeat(800)}]
 const summary=balancedUntrustedVideoSummary({modelDescription:rows[0].description,boardInterpretations:rows},600)
 assert.ok(summary.length<=600)
 assert.match(summary,/分镜图1/)
 assert.match(summary,/分镜图2/)
 assert.match(summary,/未核实语义/)
})

test('v14 paired-image results still require exact per-board proof at the Node evidence boundary',()=>{
 const v=make()
 v.sampling={...v.sampling,sampler_version:14,tiles_per_storyboard:12}
 const valid=handoff(v)
 assert.ok(valid.evidence.sources.some(s=>s.kind==='preview_visual_analysis'))
 assert.equal(valid.handoff.video.boardInterpretations.length,2)
 const wrong=make()
 wrong.sampling={...wrong.sampling,sampler_version:14,tiles_per_storyboard:12}
 wrong.visionBoardReceipts[1].status='incomplete'
 wrong.visionBoardReceipts[1].errorCode='vision_board_truncated'
 const rejected=handoff(wrong)
 assert.equal(rejected.evidence.sources.some(s=>s.kind==='preview_visual_analysis'),false)
 assert.equal(rejected.handoff.video.boardInterpretations.length,0)
 const swapped=make()
 swapped.sampling={...swapped.sampling,sampler_version:14,tiles_per_storyboard:12}
 swapped.visionBoardReceipts[1].times[0]=10
 assert.equal(handoff(swapped).evidence.sources.some(s=>s.kind==='preview_visual_analysis'),false)
})

test('incomplete board carries only exact partial cells to transient handoff, never full evidence',()=>{
 const v=make();v.status='vision_incomplete';v.error='incomplete';delete v.description
 v.sampling={...v.sampling,sampler_version:14,tiles_per_storyboard:12}
 v.visionBoardReceipts[1]={index:2,status:'incomplete',times:times.slice(12),gridCols:4,partialCells:[{cellIndex:2,time:161,description:'R1C2 [02:41]：机翼。'}]}
 const {evidence,handoff:h}=handoff(v)
 assert.equal(evidence.sources.some(s=>s.kind==='preview_visual_analysis'),false)
 assert.equal(h.video.modelDescription,'');assert.deepEqual(h.video.observations,[])
 assert.deepEqual(h.video.partialCellObservations,[{boardIndex:2,cellIndex:2,atMs:161000,description:'机翼。',status:'partial-model-generated-unverified'}])
 for(const mutate of [x=>x.visionBoardReceipts[1].partialCells[0].time=146,x=>x.visionBoardReceipts[1].partialCells[0].description='R1C1 [02:41]：机翼。',x=>x.visionBoardReceipts[1].times[0]=10,x=>x.sampling.strategy='unknown',x=>x.visionBoardReceipts[1].partialCells.push({...x.visionBoardReceipts[1].partialCells[0]})]){
  const bad=structuredClone(v);mutate(bad);assert.deepEqual(handoff(bad).handoff.video.partialCellObservations,[])
 }
})


test('complete first board of incomplete modern batch contributes only transient exact cells',()=>{
 const v=make();v.status='vision_incomplete';v.error='incomplete';delete v.description
 v.sampling={...v.sampling,sampler_version:14,tiles_per_storyboard:12}
 const clock=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`
 v.visionBoardReceipts[0].gridCols=4
 v.visionBoardReceipts[0].description=times.slice(0,12).map((t,i)=>`R${Math.floor(i/4)+1}C${i%4+1} [${clock(t)}]：可见鸟。`).join('\n')
 v.visionBoardReceipts[1]={index:2,status:'incomplete',times:times.slice(12),gridCols:4}
 const {evidence,handoff:h}=handoff(v)
 assert.equal(evidence.sources.some(s=>s.kind==='preview_visual_analysis'),false)
 assert.equal(h.video.partialCellObservations.length,12)
 assert.equal(h.video.partialCellObservations[11].atMs,131000)
 assert.equal(h.video.modelDescription,'');assert.deepEqual(h.video.observations,[])
 const bad=structuredClone(v);bad.visionBoardReceipts[0].description=bad.visionBoardReceipts[0].description.replace('[00:10]','[00:25]')
 assert.deepEqual(handoff(bad).handoff.video.partialCellObservations,[])
})

test('DSH and local modern full board receipts use identical evidence handoff',()=>{
 const v=make();v.sampling={...v.sampling,sampler_version:14,tiles_per_storyboard:12}
 v.visionBoardReceipts=v.visionBoardReceipts.map(r=>({...r,inferencePath:'dsh-independent'}))
 const {evidence,handoff:h}=handoff(v)
 assert.ok(evidence.sources.some(s=>s.kind==='preview_visual_analysis'))
 assert.equal(h.video.boardInterpretations.length,2)
 delete v.visionBoardReceipts
 assert.equal(handoff(v).evidence.sources.some(s=>s.kind==='preview_visual_analysis'),false)
})


test('partial observation reports real sampling and gaps without granting complete proof',async()=>{
 const v=make();v.status='vision_incomplete';v.error='incomplete';delete v.description
 v.sampling={...v.sampling,sampler_version:14,tiles_per_storyboard:12}
 const clock=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`
 v.visionBoardReceipts[0].gridCols=4
 v.visionBoardReceipts[0].description=times.slice(0,12).map((t,i)=>`R${Math.floor(i/4)+1}C${i%4+1} [${clock(t)}]：可见鸟。`).join('\n')
 const missing=[4,8,12]
 v.visionBoardReceipts[1]={index:2,status:'incomplete',times:times.slice(12),gridCols:4,
   partialCells:times.slice(12).flatMap((t,i)=>missing.includes(i+1)?[]:[{cellIndex:i+1,time:t,description:`R${Math.floor(i/4)+1}C${i%4+1} [${clock(t)}]：局部画面。`}])}
 const {evidence,handoff:h}=handoff(v),coverage=h.video.observationCoverage
 assert.equal(coverage.status,'partial');assert.equal(coverage.sampleSource,'low-resolution-preview')
 assert.equal(coverage.sampledFrameCount,24);assert.equal(coverage.describedFrameCount,21)
 assert.deepEqual(coverage.missingFrameTimesMs,missing.map(i=>times[11+i]*1000))
 assert.equal(coverage.completeObservation,false);assert.equal(h.video.visionStatus,'not-analyzed')
 assert.equal(evidence.sources.some(s=>s.kind==='preview_visual_analysis'),false)
 const {verifyEpisodeVideoVisual}=await import('../lib/life-episode-video-visual.mjs')
 assert.equal(verifyEpisodeVideoVisual({result:{ok:true,bvid:BV,viewDepth:'deep',visual:v,videoEvidence:evidence,perceptionHandoff:h,info:{duration:324}},bvid:BV,depth:'deep'}),null)
 const invalid=structuredClone(v);invalid.visionBoardReceipts[1].times[0]=10
 assert.equal(handoff(invalid).handoff.video.observationCoverage.describedFrameCount,0)
 const foreign=structuredClone(v);foreign.bvid='BV1234567891'
 assert.equal(handoff(foreign).handoff.video.observationCoverage.sampledFrameCount,0)
})

test('model view removes repeated visual prose and raw debug without mutating internal receipt',()=>{
 const v=make();v.sampling={...v.sampling,sampler_version:14,tiles_per_storyboard:12}
 v.description=v.visionBoardReceipts.map(r=>`分镜图${r.index}：\n${r.description}`).join('\n\n')
 v.visionBoardReceipts[0].debugRawAttempts=[{text:'raw-only-model-output'}]
 const {evidence,handoff:h}=handoff(v)
 const result={ok:true,action:'watch',bvid:BV,visual:v,videoEvidence:evidence,perceptionHandoff:h}
 const before=structuredClone(result),projected=projectVideoModelView(result)
 assert.deepEqual(result,before)
 assert.equal(projected.modelView,'life-video-model-view/v1')
 assert.equal(projected.visual.description,undefined)
 assert.equal(projected.visual.visionBoardReceipts[0].debugRawAttempts,undefined)
 assert.equal(projected.perceptionHandoff.video.observationCoverage.status,'complete-sampled')
 const serialized=JSON.stringify(projected)
 for(const r of v.visionBoardReceipts)assert.equal(serialized.split(r.description).length-1,1)
 assert.equal(projected.perceptionHandoff.video.boardInterpretations[0].descriptionRef,'perceptionHandoff.video.modelDescription')
 assert.equal(projected.perceptionHandoff.video.observations[0].descriptionRef,'perceptionHandoff.video.modelDescription')
 // Legacy nonidentical aggregate and board text remain accessible once each.
 const old=make(),legacy=handoff(old)
 const view=projectVideoModelView({...result,visual:old,perceptionHandoff:legacy.handoff})
 assert.equal(view.perceptionHandoff.video.boardInterpretations[0].description,old.visionBoardReceipts[0].description)
 assert.equal(view.perceptionHandoff.video.observations[0].description,undefined)
 assert.equal(view.perceptionHandoff.video.observations[0].descriptionRef,'perceptionHandoff.video.boardInterpretations[index=1].description')
 const failure={ok:false,error:'unavailable'};assert.equal(projectVideoModelView(failure),failure)
})


test('mounted TODO watch result uses the same compact view after settlement; other TODOs unchanged',()=>{
 const v=make(),{evidence,handoff:h}=handoff(v)
 const task={ok:true,item:{status:'done'},result:{ok:true,data:{ok:true,action:'watch',bvid:BV,visual:v,videoEvidence:evidence,perceptionHandoff:h}}}
 const view=projectVideoTodoModelView(task)
 assert.equal(view.result.data.modelView,'life-video-model-view/v1')
 assert.equal(view.result.data.visual.description,undefined)
 assert.equal(task.result.data.visual.description,v.description)
 assert.equal(view.item,task.item)
 const other={ok:true,result:{ok:true,data:{ok:true,action:'like'}}};assert.equal(projectVideoTodoModelView(other),other)
 const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(server,/runTodo: async \(id\) => projectVideoTodoModelView\(await runOwnerTodoWithFollowup\(id\)\)/)
})
