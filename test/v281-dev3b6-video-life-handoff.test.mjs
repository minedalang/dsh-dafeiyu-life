import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'
import {buildVideoPerceptionTimeline} from '../lib/video-perception-timeline.mjs'
import {buildVideoPerceptionHandoff} from '../lib/video-perception-handoff.mjs'

const bv='BV1234567890',other='BV1234567891'
const info={bvid:bv,title:'长视频：实际声画材料'}
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

const make=(subtitle,visual,depth='deep')=>{
  const evidence=buildVideoEvidenceBundle({bvid:bv,info,subtitle,visual})
  const timeline=buildVideoPerceptionTimeline({bvid:bv,evidence,subtitle,visual})
  return buildVideoPerceptionHandoff({bvid:bv,depth,info,subtitle,visual,evidence,timeline})
}

test('same BV official timed captions + proven preview vision are present but not semantic proof',()=>{
  const sub={bvid:bv,text:'第十秒讲到交通规则',timed_segments:[{startSeconds:9,endSeconds:12,text:'第十秒讲到交通规则'}]}
  const v={bvid:bv,status:'analyzed',description:'画面是道路，两辆车行驶',times:[10],image_source:'B站官方预览低清图'}
  const handoff=make(sub,v)
  assert.equal(handoff.speech.source,'official-subtitles')
  assert.equal(handoff.video.source,'low-resolution-preview')
  assert.equal(handoff.video.frameCount,1)
  assert.equal(handoff.video.modelDescription,v.description)
  assert.equal(handoff.speech.segments[0].startMs,9000)
  assert.equal(handoff.review.verifiedAgreement,false)
  assert.equal(handoff.review.verifiedContradiction,false)
  assert.equal(handoff.timeAlignment.reviewCandidates[0].comparison,'not-semantically-verified')
})

test('Whisper text cannot be called official subtitles or actual listening',()=>{
  const s={bvid:bv,source:'local-asr',text:'可能是演讲内容',segments:[{startSeconds:1,endSeconds:4,text:'可能是演讲内容'}]}
  const h=make(s,null)
  assert.equal(h.speech.source,'machine-asr')
  assert.ok(h.speech.limitations.includes('not-original-audio-listening'))
  assert.equal(h.video.modelDescription,'')
  assert.equal(h.video.frameCount,0)
})

test('a foreign BV cannot contaminate speech, frame description, or OCR',()=>{
  const s={bvid:other,text:'另一条视频的字幕',timed_segments:[{startSeconds:1,endSeconds:2,text:'不属于当前视频'}]}
  const v={bvid:other,status:'analyzed',description:'另一条视频画面',times:[1]}
  const h=make(s,v)
  assert.equal(h.speech.source,'unavailable')
  assert.equal(h.video.modelDescription,'')
  assert.deepEqual(h.ocr,[])
  assert.equal(buildVideoPerceptionHandoff({bvid:other,evidence:{schema:'life-video-evidence/v1',bvid:bv},timeline:{schema:'life-video-perception-timeline/v1',bvid:bv}}),null)
})

test('OCR only survives evidence-validated, exact frame anchor receipt',()=>{
  const o={bvid:bv,status:'analyzed',image_source:'B站官方预览低清图',description:'看到了手机',times:[5],
    ocr:{engine:'tesseract-cli',segments:[{atSeconds:5,text:'测试中文',confidence:93}]}}
  const h=make(null,o)
  assert.deepEqual(h.ocr,[])
  assert.equal(h.review.status,'requires-life-semantic-review')
})

test('depth remains autonomous and unavailable visual does not create an observed image',()=>{
  const h=make({bvid:bv,text:'无图像时有字幕'},null,'skim')
  assert.equal(h.depth,'skim')
  assert.equal(h.video.source,'none')
  assert.equal(h.review.verifiedAgreement,false)
})

test('production returns exactly projected handoff and read-only debug run skips durable histories',()=>{
  const server=read('index.js')
  assert.match(server,/perceptionHandoff=buildVideoPerceptionHandoff/)
  assert.match(server,/return lifePayload/)
  assert.match(server,/if\(!dryRun&&\(!isLifeEpisodeFocus\|\|focusIsVerifiedAndNovel\)&&\s*!\(args\.record_session===false&&parseMaybeJson\(vision\)\?\.status==='cached'\)\)try\{/)
  assert.match(server,/if\(!dryRun&&args\.record_session!==false\)/)
  assert.match(server,/__debugDryRun:true/)
  assert.match(server,/videoDebugExpiry=VIDEO_CACHE_RETENTION\.capture/)
  assert.match(server,/req\.socket\?\.remoteAddress/)
  assert.match(server,/origin.*host/)
  assert.match(server,/videoDebugJob===job&&job\.status==='running'/)
  const ui=read('lib/management-console.html'),client=read('lib/management-console.js')
  assert.match(ui,/video-perception-final-debug/)
  assert.match(ui,/video-debug-json/)
  assert.match(client,/JSON\.stringify\(payload,null,2\)/)
  assert.match(client,/\/video-perception-debug\/run/)
  assert.doesNotMatch(client,/videoDebug.*innerHTML/)
})
