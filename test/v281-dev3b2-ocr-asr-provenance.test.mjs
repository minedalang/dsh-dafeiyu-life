import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'
import {buildVideoPerceptionTimeline} from '../lib/video-perception-timeline.mjs'
const bvid='BV1234567890',info={bvid,title:'离线样本'}
const visual={ok:true,bvid,status:'analyzed',image_source:'B站公开视频片段（离线解码）',
  times:[6,14],description:'画面来自真实离线采样',
  sampling:{sampler_version:5,strategy:'decoded-storyboard-stratified-2fps',source_type:'bili-public-playurl-durl',
    video_duration_seconds:40,sampled_windows:[{startSeconds:0,endSeconds:25}],frame_plan:24,
    depth:'deep',frame_budget:24,frames_selected:2,storyboard_count:1,candidates_examined:40,
    heat_source:'unavailable',viewer_heat_is_content_evidence:false,ocr_engine:'tesseract-cli',ocr_attempted:2},
  ocr:{engine:'tesseract-cli',attempted:2,segments:[{atSeconds:6,text:'画面中的文字',confidence:92},
    {atSeconds:14,text:'第二段文字',confidence:78}]}}

test('OCR evidence is a machine estimate from decoded timestamps, not content certainty',()=>{
 const e=buildVideoEvidenceBundle({bvid,info,visual})
 const ocr=e.sources.find(s=>s.kind==='frame_ocr')
 assert.deepEqual(ocr.timePointsMs,[6000,14000])
 assert.equal(ocr.status,'machine-extracted')
 assert.equal(JSON.stringify(e).includes('画面中的文字'),false)
 const tl=buildVideoPerceptionTimeline({bvid,evidence:e,visual})
 assert.equal(tl.anchors[0].frameOcr.excerpt,'画面中的文字')
 assert.equal(tl.anchors[1].frameOcr.confidence,78)
 assert.equal(tl.sourceAvailability.ocr,'machine-extracted')
 assert.equal(tl.alignment,'time-proximity-only')
 assert.equal(e.analyzedOriginalAudio,false)
 assert.ok(tl.limitations.includes('ocr-machine-estimate-not-verified'))
})
test('OCR never moves onto preview, wrong BV, forged seconds or unvalidated engine',()=>{
 for(const change of [
   {image_source:'B站低清预览'},
   {ocr:{...visual.ocr,engine:'visual-model'}},
   {ocr:{...visual.ocr,segments:[{atSeconds:999,text:'幻觉OCR',confidence:94}]}},
   {sampling:{...visual.sampling,ocr_engine:'unavailable'}},
   {ocr:{...visual.ocr,attempted:99}},
   {ocr:{...visual.ocr,attempted:1}},
 ]){
   const e=buildVideoEvidenceBundle({bvid,info,visual:{...visual,...change}})
   assert.ok(!e.sources.some(s=>s.kind==='frame_ocr'))
 }
 const e=buildVideoEvidenceBundle({bvid,info,visual})
 const wrong={...visual,bvid:'BV0987654321'}
 assert.equal(buildVideoPerceptionTimeline({bvid,evidence:e,visual:wrong}).sourceAvailability.ocr,'not-observed')
})
test('Whisper timestamps use nearbyAsr, not nearbyCaptions; no audio listening claim',()=>{
 const asr={bvid,source:'local-asr',asr_evidence:'faster-whisper-machine-transcript',text:'你好，这是一句测试',
   timed_segments:[{startSeconds:5.5,endSeconds:6.5,text:'你好，这是一句测试'}],
   can_claim_audio_listened:false}
 const e=buildVideoEvidenceBundle({bvid,info,subtitle:asr,visual})
 const tl=buildVideoPerceptionTimeline({bvid,evidence:e,subtitle:asr,visual})
 assert.equal(tl.anchors[0].nearbyAsr[0].excerpt,'你好，这是一句测试')
 assert.equal(tl.anchors[0].nearbyCaptions,undefined)
 assert.equal(tl.sourceAvailability.timedAsrSegments,1)
 assert.equal(tl.sourceAvailability.timedCaptionSegments,0)
 assert.equal(tl.sourceAvailability.originalAudio,'machine-transcribed-not-listened')
 assert.equal(e.sources.find(s=>s.kind==='asr_transcript').reliability,'machine-estimate-not-human-verified')
 const missing={...asr,timed_segments:[{from:9,to:10,text:'不能推断时间单位'}]}
 const untimed=buildVideoPerceptionTimeline({bvid,evidence:buildVideoEvidenceBundle({bvid,info,subtitle:missing}),subtitle:missing})
 assert.equal(untimed.anchors.length,0)
})
test('headless read-only OCR module stages, fingerprints and output routing exist',()=>{
 const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
 assert.match(source('lib/state.mjs'),/frame_ocr\.py/)
 assert.match(source('index.js'),/OCR 采样脚本版本不一致/)
 assert.match(source('vendor/bilibili-mcp/mcp_server.py'),/\['timed_segments'\]/)
 assert.match(source('lib/vision_dsh.py'),/'ocr':observed\.get\('ocr'\)/)
})
