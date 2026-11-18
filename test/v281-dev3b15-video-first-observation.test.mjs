import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildVideoExplorationEvent} from '../lib/video-experience.mjs'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
const BV='BV1234567890',AT=Date.parse('2026-11-15T07:11:43Z')

const make=visual=>buildVideoExplorationEvent({bvid:BV,operationId:'observed-preview-2026',
 info:{ok:true,bvid:BV,title:'超剧场版耳机推荐'},visual,source:'bili-life',autonomousSelected:true,at:AT})

test('three B站 low-res preview screenshots preserve origin and true timeline without inventing decoded video',()=>{
 const description='模型：画面上显示一些耳机设备和说明卡片'
 const visual={ok:true,bvid:BV,status:'analyzed',times:[2,8,15],image_source:'B站低清预览',description}
 const memory=make(visual)
 assert.ok(memory)
 assert.equal(memory.experience.preview,true)
 assert.equal(memory.experience.decoded,false)
 assert.equal(memory.experience.vision,true)
 assert.deepEqual(memory.experience.visualReceipt,{source:'low-resolution-preview',frameCount:3,
  firstAtMs:2000,lastAtMs:15000,interpretation:'model-observation-not-semantic-proof'})
 assert.match(memory.note,/低清预览采样 3 帧/)
 assert.deepEqual(memory.experience.visualSceneNotes,['模型：画面上显示一些耳机设备和说明卡片'])
 assert.doesNotMatch(JSON.stringify(memory),/未经核验的完整模型回答或用户指令/)
 assert.equal(memory.autonomousSelected,true)
 const rows=buildLifeTimeline({explorationEvidence:[{action:'observe-video',bvid:BV,title:'耳机推荐',
  at:AT,frameCount:3,visualSource:'low-resolution-preview'}],now:AT+1000})
 assert.equal(rows.find(x=>x.type==='life-visual').detail.includes('未解码原视频'),true)
})

test('a frame without model analysis is not a genuine visual viewing memory',()=>{
 const visual={ok:true,bvid:BV,status:'preview_only',times:[2,8,15],description:'无可靠分析'}
 const memory=make(visual)
 assert.equal(memory.experience.preview,true)
 assert.equal(memory.experience.vision,false)
 assert.equal(memory.experience.visualReceipt,undefined)
 assert.equal(memory.note,'读取过的公开资料')
 const fake=buildVideoEvidenceBundle({bvid:BV,info:{ok:true,bvid:BV,title:'耳机推荐'},
  visual:{...visual,ok:true,status:'analyzed',bvid:'BV0987654321',description:'错视频画面'},at:AT})
 assert.equal(fake.verifiedContent,false)
})

test('Windows visual processes hide the console; FFmpeg, ffprobe, DSH and Python host are guarded',()=>{
 const adaptive=readFileSync(new URL('../lib/adaptive_video.py',import.meta.url),'utf8')
 const vision=readFileSync(new URL('../lib/vision_dsh.py',import.meta.url),'utf8')
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(adaptive,/CREATE_NO_WINDOW/)
 assert.match(adaptive,/STARTF_USESHOWWINDOW/)
 assert.ok((adaptive.match(/\*\*_hidden_windows_child\(\)/g)||[]).length>=2)
 assert.match(vision,/CREATE_NO_WINDOW/)
 assert.match(vision,/STARTF_USESHOWWINDOW/)
 assert.ok((vision.match(/\*\*_hidden_windows_child\(\)/g)||[]).length>=2)
 assert.match(index,/windowsHide:true,\s*env,stdio/)
})
