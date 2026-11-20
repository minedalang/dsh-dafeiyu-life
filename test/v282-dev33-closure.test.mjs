import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildVideoEvidenceBundle} from '../lib/video-evidence-bundle.mjs'
import {buildVideoPerceptionHandoff} from '../lib/video-perception-handoff.mjs'
import {getLocalVisionModel,LOCAL_VISION_MODELS} from '../lib/local-vision-model-manager.mjs'
const BV='BV1234567890'
const stamps=[10,25,35,40,55,65,70,80,90,115,120,131,146,161,171,176,186,201,211,231,256,281,291,311]
const makes=(tiles=4)=>{
 const boardCount=Math.ceil(stamps.length/tiles)
 const sampling={strategy:'videoshot-storyboard-stratified',sampler_version:12,tiles_per_storyboard:tiles,
  index_frames_available:65,candidate_frames_scanned:65,candidates_examined:65,
  source_sheets_available:1,source_sheets_scanned:1,sheets_downloaded:1,
  timeline_scan_complete:true,scan_limited_by:'none',review_candidates_seconds:[],review_candidate_hints:[],
  frame_change_hints:stamps.map(second=>({second,pixel_change:.3,source:'python-videoshot-neighbor-diff'})),
  heat_hints:[],heat_source:'unavailable',frame_budget:24,storyboard_count:boardCount,
  sprite_bytes:408313,low_resolution:true,frames_selected:24}
 const receipts=Array.from({length:boardCount},(_,i)=>({index:i+1,times:stamps.slice(i*tiles,(i+1)*tiles),
  status:'analyzed',description:'分镜画面'+(i+1)+':人群和指示牌的局部观察。'}))
 return {ok:true,bvid:BV,status:'analyzed',image_source:'B站低清预览',times:stamps,
  sampling,description:receipts.map(r=>r.description).join('\n'),visionBoardReceipts:receipts}
}
const verify=v=>{
 const info={bvid:BV,title:'可信元数据',duration:324}
 const evidence=buildVideoEvidenceBundle({bvid:BV,info,visual:v})
 const timeline={schema:'life-video-perception-timeline/v1',bvid:BV,anchors:[]}
 return {evidence,handoff:buildVideoPerceptionHandoff({bvid:BV,depth:'deep',info,visual:v,evidence,timeline})}
}
for(const tiles of [4,6,12])test(`v12 的${tiles}格分镜完整进入视觉证据并交给 Life`,()=>{
 const v=makes(tiles),{evidence,handoff}=verify(v)
 assert.ok(evidence.sources.some(s=>s.kind==='preview_frames'))
 assert.ok(evidence.sources.some(s=>s.kind==='preview_visual_analysis'))
 assert.equal(handoff.video.boardInterpretations.length,24/tiles)
 assert.equal(evidence.sources.find(s=>s.kind==='preview_frames').sampling.tilesPerStoryboard,tiles)
 assert.equal(handoff.video.boardInterpretations.at(-1).toMs,311000)
})
test('伪造格数、分镜缺漏、重排时间或缺少模型正文绝不升级为Life视觉证据',()=>{
 for(const modify of [v=>v.sampling.tiles_per_storyboard=5,
   v=>v.visionBoardReceipts.pop(),v=>v.visionBoardReceipts[1].times[0]=10,
   v=>v.visionBoardReceipts[2].description='']){
   const v=makes(4);modify(v)
   const {evidence,handoff}=verify(v)
   assert.equal(evidence.sources.some(s=>s.kind==='preview_visual_analysis'),false)
   assert.deepEqual(handoff.video.boardInterpretations,[])
 }
})
test('新增2B型号仍走固定Ollama白名单，页面显存为建议且包含CPU模式',()=>{
 const model=getLocalVisionModel('qwen3.5-2b')
 assert.equal(model.ollama,'qwen3.5:2b')
 assert.equal(LOCAL_VISION_MODELS.length,3)
 assert.equal(getLocalVisionModel('user-supplied:2b'),null)
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(html,/MiniCPM-V 4\.7 1B · 不建议常规使用/)
 assert.match(html,/无独立显卡、显存不足/)
 assert.match(html,/CPU.*系统内存运行/)
 assert.match(html,/id="local-vision-hardware-guide"/)
})
test('独立视频方案保存不接触私信社交权限；模型ASR自动语言正确接线',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(js,/request\('\/video-vision\/plan',\{visionFrames:frames,visionBoardTiles:tiles\}\)/)
 const route=host.slice(host.indexOf("if (req.method === 'POST' && path === '/api/bili-duty/video-vision/plan')"),host.indexOf("if (req.method === 'GET' && path === '/api/bili-duty/config')"))
 assert.match(route,/persistCfg\(\{visionFrames:frames,visionBoardTiles:tiles\}\)/)
 assert.doesNotMatch(route,/dmFollowAutonomyEnabled/) // no unrelated boolean write
 assert.match(host,/BILI_ASR_LANGUAGE:cfg.asrLanguage\|\|'auto'/)
})
test('调试页明确区分视觉模型回执、证据验证器接收和Life交接',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(js,/Whisper 转写复用与语种/)
 assert.match(js,/Life 视觉证据接收/)
 assert.match(js,/分镜图 \${r.index} · 模型回执与 Life 接收/)
})
