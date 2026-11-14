import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createEmotionalState} from '../lib/emotional-state.mjs'
import {usableSubtitle,visionDecision} from '../lib/video-vision-policy.mjs'

const dir=()=>mkdtempSync(join(tmpdir(),'dafeiyu-vision-emotion-'))
test('看不看、看多深由鱼鱼自己选择；无字幕不再强制视觉；开关与额度为硬限制',()=>{
 assert.equal(usableSubtitle({message:'该视频没有字幕'}),false)
 assert.equal(usableSubtitle({text:'字幕by 张三'}),false)
 assert.equal(usableSubtitle('{"error":"subtitle failed"}'),false)
 assert.equal(usableSubtitle({text:'这里是一段真实完整的字幕内容，希望你能理解。'}),true)
 assert.equal(visionDecision({subtitle:{message:'该视频没有字幕'},enabled:true}).kind,'skipped')
 assert.equal(visionDecision({subtitle:{message:'该视频没有字幕'},enabled:true,depth:'standard'}).attempt,true)
 assert.equal(visionDecision({subtitle:{message:'该视频没有字幕'},enabled:true,depth:'deep'}).attempt,true)
 assert.equal(visionDecision({subtitle:null,enabled:true,depth:'skim',visualQuestion:true}).attempt,false)
 assert.equal(visionDecision({subtitle:{text:'完整且可用的字幕线索已经拿到了'},enabled:true}).attempt,false)
 assert.equal(visionDecision({subtitle:{text:'完整且可用的字幕线索已经拿到了'},enabled:true,visualQuestion:true}).attempt,true)
 assert.equal(visionDecision({subtitle:null,enabled:false}).attempt,false)
 assert.equal(visionDecision({subtitle:null,enabled:true,quotaRemaining:0,depth:'deep'}).kind,'unavailable')
 assert.equal(visionDecision({subtitle:null,enabled:true,roundRemaining:0,depth:'standard'}).attempt,false)
})
test('持续开心与温暖不再把活力/社交意愿/好奇心/正向度刷成100',()=>{
 const home=dir();let now=1793700000000
 try{
  const x=createEmotionalState({dataDir:home,now:()=>now})
  for(let i=0;i<30;i++){x.update({mood:i%3?'joyful':'warm',intensity:3,source:'comment'});now+=2*60*1000}
  const s=x.snapshot()
  assert.ok(s.sociality>60&&s.sociality<90,`sociality=${s.sociality}`)
  assert.ok(s.energy>60&&s.energy<90,`energy=${s.energy}`)
  assert.ok(s.curiosity>40&&s.curiosity<80,`curiosity=${s.curiosity}`)
  assert.ok(s.valence>30&&s.valence<90,`valence=${s.valence}`)
  x.update({mood:'tired',intensity:3,source:'life-reflection'})
  assert.ok(x.snapshot().energy<s.energy)
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('历史已贴顶状态在新事件后自然回落，旧快照不重写或伪造',()=>{
 const home=dir();let now=1793700000000
 try{
  const x=createEmotionalState({dataDir:home,now:()=>now})
  x.update({mood:'joyful',intensity:2,source:'dm'})
  const file=join(home,'life-memory','emotional-state.json')
  const stored=JSON.parse(readFileSync(file,'utf8'))
  for(const key of ['energy','curiosity','sociality','valence'])stored.current[key]=100
  writeFileSync(file,JSON.stringify(stored))
  now+=1000
  x.update({mood:'curious',intensity:2,source:'comment'})
  const snap=x.snapshot()
  assert.ok(snap.energy<100&&snap.sociality<100&&snap.valence<100)
  assert.equal(snap.history.length,2)
  assert.equal(snap.history[0].state.energy<100,true)
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('视频 Agent 与值班章程明确两次自主意愿，不强制缺字幕就识图',()=>{
 const idx=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const charter=readFileSync(new URL('../prompts/duty.md',import.meta.url),'utf8')
 assert.match(idx,/由鱼鱼自主选择观看与深度/)
 assert.doesNotMatch(idx,/没有可用字幕\/转写文本.*必须优先调用一次 bili_preview_vision/)
 assert.match(idx,/visionDecision\(\{subtitle,enabled:/)
 assert.match(charter,/鱼鱼先自主决定看不看，再自主选择略看、正常了解或深入探索/)
 assert.match(idx,/view_depth:\{type:'string'/)
 const mcp=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
 assert.match(mcp,/async def bili_subtitle\(bvid: str, auto_vision_on_missing: bool = False\)/)
 assert.match(mcp,/auto_vision_on_missing and os\.environ\.get\('BILI_VISION_ENABLED'\)/)
 assert.match(mcp,/await bili_preview_vision\(bvid\)/)
 assert.match(idx,/getSubtitle:\(bvid\)=>call\('bili_subtitle',\{bvid,auto_vision_on_missing:false\}\)/)
})
