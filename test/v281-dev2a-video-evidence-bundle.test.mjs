import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildVideoEvidenceBundle,videoEvidenceFlags,VIDEO_EVIDENCE_SCHEMA} from '../lib/video-evidence-bundle.mjs'
import {buildVideoExplorationEvent} from '../lib/video-experience.mjs'

const BV='BV1234567890', OTHER='BV0987654321', AT=Date.parse('2026-11-14T08:00:00Z')
const base = extra => ({bvid:BV,info:{ok:true,bvid:BV,title:'过山车上的紧急会议'},at:AT,...extra})
const make = extra => buildVideoEvidenceBundle(base(extra))

test('2.8.1-dev.2a: reading public metadata is not watching or hearing the video',()=>{
 const result=make()
 assert.equal(result.schema,VIDEO_EVIDENCE_SCHEMA)
 assert.equal(result.observedVideoPlayback,false)
 assert.equal(result.analyzedOriginalAudio,false)
 assert.equal(result.verifiedContent,false)
 assert.deepEqual(result.sources.map(x=>x.kind),['metadata'])
 assert.equal(videoEvidenceFlags(result).vision,false)
})

test('2.8.1-dev.2a: subtitle and local ASR are different sources; no fabricated audio perception',()=>{
 const sub=make({subtitle:{bvid:BV,text:'这是画面里的字幕文字和演讲文本'}})
 assert.equal(videoEvidenceFlags(sub).subtitle,true)
 assert.equal(videoEvidenceFlags(sub).asr,false)
 const asr=make({subtitle:{source:'local-asr',text:'这是本地模型真实返回的转写文本'}})
 assert.equal(videoEvidenceFlags(asr).asr,true)
 assert.equal(videoEvidenceFlags(asr).subtitle,false)
 assert.equal(asr.analyzedOriginalAudio,false)
 const evt=buildVideoExplorationEvent({bvid:BV,operationId:'operation-asr-01',info:{title:'过山车上的紧急会议'},
   subtitle:{source:'local-asr',text:'这是本地模型真实返回的转写文本'},at:AT})
 assert.equal(evt.experience.asr,true)
 assert.equal(evt.experience.subtitle,false)
 assert.equal(evt.experience.evidenceSchema,VIDEO_EVIDENCE_SCHEMA)
})

test('2.8.1-dev.2a: preview-only result is a sampled image receipt, NOT recognized visual content',()=>{
 const result=make({visual:{ok:true,bvid:BV,status:'preview_only',times:[18.2,0,18.2,9.4],
   image_source:'B站低清预览',description:'错误地附带的描述不能升级证据'}})
 assert.deepEqual(result.sources.find(s=>s.kind==='preview_frames').timePointsMs,[0,9400,18200])
 assert.equal(result.sources.some(s=>s.kind==='preview_visual_analysis'),false)
 assert.equal(result.verifiedContent,false)
 assert.equal(result.observedVideoPlayback,false)
})

test('2.8.1-dev.2a: vision observation may refer only to sampled low-res frames',()=>{
 const result=make({visual:{ok:true,bvid:BV,status:'analyzed',description:'一个人正在过山车上开会',times:[5.2,15.5]}})
 const vision=result.sources.find(s=>s.kind==='preview_visual_analysis')
 assert.equal(vision.coverage,'sampled-low-resolution-frames')
 assert.deepEqual(vision.timePointsMs,[5200,15500])
 assert.equal(result.verifiedContent,true)
 assert.equal(result.observedVideoPlayback,false)
 const legacy=make({visual:{status:'cached',description:'只有旧版摘要，没有保存取帧时间'}})
 assert.equal(legacy.sources.find(s=>s.kind==='preview_visual_analysis').timeAnchor,'unavailable')
 assert.equal(legacy.sources.some(s=>s.kind==='preview_frames'),false)
})

test('2.8.1-dev.2a: explicit subtitle segment second markers are preserved; ambiguous units are not guessed',()=>{
 const result=make({subtitle:{text:'这个视频有逐段字幕可以阅读和检索',segments:[
  {startSeconds:3.25,endSeconds:4.0},{start:1000,end:3000},
  {startSeconds:9.2,endSeconds:8.1},{start_seconds:11,end_seconds:12}]}})
 assert.deepEqual(result.sources.find(s=>s.kind==='subtitle').spans,[
  {startMs:3250,endMs:4000},{startMs:11000,endMs:12000}])
})

test('2.8.1-dev.2a: unrelated BV cannot inject subtitle, visual, comment, or danmaku evidence',()=>{
 const result=make({subtitle:{bvid:OTHER,text:'这不是本视频的字幕'},
  visual:{bvid:OTHER,status:'analyzed',times:[3],description:'别的视频的画面'},
  comments:{bvid:OTHER,comments:[{content:'别的视频评论'}]},
  danmaku:{bvid:OTHER,danmakus:[{text:'另一条弹幕'}]}})
 assert.deepEqual(result.sources.map(s=>s.kind),['metadata'])
 assert.equal(result.verifiedContent,false)
 assert.equal(make({info:{ok:true,bvid:OTHER,title:'错误目标'}}),null)
 assert.equal(make({info:{ok:false,bvid:BV,title:'无效回执'}}),null)
 assert.equal(make({bvid:'not-a-bv'}),null)
})

test('2.8.1-dev.2a: failed/placeholder tools must not become verified observations',()=>{
 const result=make({subtitle:{text:'该视频没有字幕'},
  visual:{ok:true,status:'analyzed',description:'未生成预览',times:[20]}})
 assert.deepEqual(result.sources.map(s=>s.kind),['metadata','preview_frames'])
 assert.equal(result.verifiedContent,false)
})

test('2.8.1-dev.2a: comments/danmaku are third-party and never turn into video content',()=>{
 const result=make({comments:{comments:[{content:'有意思'},{content:''}]},danmaku:{danmakus:[{text:'哈哈哈'}]}})
 assert.equal(result.sources.find(s=>s.kind==='public_comments').count,1)
 assert.equal(result.sources.find(s=>s.kind==='danmaku').count,1)
 assert.equal(result.verifiedContent,false)
 assert.ok(result.sources.every(s=>!('text' in s)&&!('uid' in s)))
})

test('2.8.1-dev.2a: no raw image, transcript, third-party text, URL or secret may enter bundle',()=>{
 const secret='private-credential-do-not-persist'
 const result=make({subtitle:{text:'这段是合法字幕'+secret},
   visual:{status:'analyzed',description:'有画面 '+secret,times:[1],frames:[{bytes:Buffer.from('secret')}]},
   comments:{comments:[{uid:'123',content:'秘密'+secret}]}})
 const serialized=JSON.stringify(result)
 assert.ok(!serialized.includes(secret))
 assert.ok(!serialized.includes('bytes'))
 assert.ok(!serialized.includes('uid'))
 assert.ok(!serialized.includes('\"frames\":'))
 assert.ok(serialized.length < 2600)
})

test('2.8.1-dev.2a: production read tool returns provenance, but no new write/send path',()=>{
 const main=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(main,/const videoEvidence=buildVideoEvidenceBundle\(/)
 assert.match(main,/return \{ok:true,action:'watch',bvid,viewDepth:visionPlan.depth,visionDecision:visionPlan.reason,info,videoEvidence/)
 const bundle=readFileSync(new URL('../lib/video-evidence-bundle.mjs',import.meta.url),'utf8')
 assert.doesNotMatch(bundle,/\b(?:bili_video_like|bili_comment_manual|lifeWillingness\.decide)\s*\(/)
})
