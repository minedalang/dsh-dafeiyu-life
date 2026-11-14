import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {visionDecision} from '../lib/video-vision-policy.mjs'
import {validatePlannerDecision} from '../lib/autonomous-planner.mjs'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'
const source = name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const bvid='BV1234567890'

test('无字幕没有强制调用，不看不产生视觉意愿，深度由模型显式选择',()=>{
 assert.equal(visionDecision({enabled:true,subtitle:null}).attempt,false)
 assert.equal(visionDecision({enabled:true,subtitle:null,depth:'skim'}).attempt,false)
 assert.equal(visionDecision({enabled:true,subtitle:null,depth:'standard'}).attempt,true)
 assert.equal(visionDecision({enabled:true,subtitle:{text:'这是一段真实的字幕文字信息。'},depth:'deep'}).attempt,true)
 assert.equal(visionDecision({enabled:false,depth:'deep'}).attempt,false)
 assert.equal(visionDecision({enabled:true,depth:'deep',quotaRemaining:0}).attempt,false)
})
test('Life 同一次 TODO 选择可携带视频深度，不向非视频动作扩权',()=>{
 const rows=[{id:'read1',type:'watch_video'},{id:'read2',type:'search_videos'}]
 assert.equal(validatePlannerDecision('{"action":"execute_read","id":"read1","viewDepth":"deep"}',rows).viewDepth,'deep')
 assert.equal(validatePlannerDecision('{"action":"execute_read","id":"read2","viewDepth":"deep"}',rows).viewDepth,undefined)
 assert.equal(validatePlannerDecision('{"action":"execute_read","id":"read1","viewDepth":"hacked"}',rows).viewDepth,undefined)
 assert.equal(validatePlannerDecision('{"action":"skip","viewDepth":"deep"}',rows).action,'skip')
 const idx=source('index.js'), planner=source('lib/autonomous-planner.mjs')
 assert.match(idx,/view_depth:readActionContext.getStore\(\)\?\.viewDepth/)
 assert.match(planner,/executeRead\(fresh.id,\{viewDepth:outcome.viewDepth\}\)/)
 assert.match(source('prompts/duty.md'),/先自主决定看不看/)
})
test('重点复查只建立有时间锚点的低清证据，不假装看完视频',()=>{
 const ev=buildVideoEvidenceBundle({bvid,info:{bvid,title:'虚构测试视频'},
    visual:{ok:true,bvid,status:'analyzed',description:'画面存在多个彩色图形',
      times:[30,40],focus_window:{startSeconds:21,endSeconds:51},sampling:{
        sampler_version:3,strategy:'focus-window+local-thumbnail-difference',
        candidates_examined:3,frames_selected:2,sheets_downloaded:1}},at:Date.now()})
 const frames=ev.sources.find(x=>x.kind==='preview_frames')
 assert.equal(frames.sampling.selection,'focus-window+thumbnail-dedup')
 assert.deepEqual(frames.sampling.focusWindowMs,{startMs:21000,endMs:51000})
 assert.equal(ev.observedVideoPlayback,false)
 assert.equal(ev.analyzedOriginalAudio,false)
 assert.equal(ev.verifiedContent,true)
})
test('局部复查只接受 BV 和有限秒数，不提供 URL/文件路径与写动作',()=>{
 const mcp=source('vendor/bilibili-mcp/mcp_server.py')
 assert.match(mcp,/async def bili_preview_vision\(bvid: str, focus_start_seconds: float = -1.0/)
 assert.match(mcp,/_normalize_focus_window\(focus_start_seconds,focus_end_seconds\)/)
 assert.match(mcp,/_guard\("bili_preview_vision"\)/)
 assert.match(source('lib/preview_vision.py'),/focus-window\+local-thumbnail-difference/)
 assert.doesNotMatch(mcp,/async def bili_preview_vision\(.*url/)
})
