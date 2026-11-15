import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {planVideoMomentFollowup} from '../lib/video-moment-followup.mjs'
import {systemHealthSnapshot} from '../lib/system-health-projection.mjs'
const BV='BV1bkW86bEkj'
test('明确时间能触发新视频局部复查，且不能越出视频真实时长',()=>{
 const p=planVideoMomentFollowup({bvid:BV,durationSeconds:300,atSeconds:60,afterSeconds:3})
 assert.equal(p.ok,true);assert.equal(p.origin,'explicit-time')
 assert.ok(p.startSeconds<=63&&p.endSeconds>=63)
 assert.equal(p.endSeconds-p.startSeconds,12)
 assert.equal(planVideoMomentFollowup({bvid:BV,durationSeconds:60,atSeconds:100}).reason,'time-out-of-range')
 assert.equal(planVideoMomentFollowup({bvid:'bad',durationSeconds:300,atSeconds:60}).ok,false)
})
test('只有此前核验的唯一事件锚点才能根据语义补看；未知片段不能凭弹幕猜测',()=>{
 const prior=[{fromMs:40_000,toMs:43_000,description:'有人从桌子上掉下来'}]
 const p=planVideoMomentFollowup({bvid:BV,durationSeconds:60,description:'有人从桌子上掉下来',priorObservations:prior,afterSeconds:4})
 assert.equal(p.origin,'observed-event-anchor');assert.ok(p.startSeconds<47&&p.endSeconds>47)
 assert.equal(planVideoMomentFollowup({bvid:BV,durationSeconds:60,description:'桌子上掉下来',priorObservations:[]}).reason,'time-anchor-required')
 assert.equal(planVideoMomentFollowup({bvid:BV,durationSeconds:60,description:'有人从桌子上掉下来',priorObservations:[...prior,...prior]}).reason,'time-anchor-required')
})
test('后台状态只使用最近本地回执：成功绿色、失败红色、未配置和缺回执均不可冒充已启动',()=>{
 const now=Date.now()
 const mk=(vision)=>systemHealthSnapshot({now,vision,scheduler:{running:true,checks:{
  dm:{enabled:true,lastResult:'completed',lastFinishedAt:now-5000},
  replies:{enabled:true,lastResult:'error',lastFinishedAt:now-9000},
  mentions:{enabled:true,lastResult:'skipped',lastFinishedAt:now-9000}}}})
 const healthy=mk({configured:true,at:now-1000,ok:true,model:'MiniCPM-V 4.7 1B'})
 assert.equal(healthy.channels[0].state,'ok');assert.equal(healthy.channels[0].model,'MiniCPM-V 4.7 1B')
 assert.equal(healthy.channels.find(x=>x.id==='dm').state,'ok')
 assert.equal(healthy.channels.find(x=>x.id==='replies').state,'failed')
 assert.equal(healthy.channels.find(x=>x.id==='mentions').state,'unknown')
 assert.equal(mk({configured:true,at:now,ok:false}).channels[0].state,'failed')
 assert.equal(mk({configured:false,at:now,ok:true}).channels[0].state,'disabled')
 assert.equal(mk({configured:true}).channels[0].state,'unknown')
 assert.equal(mk({configured:true,at:now-25*60*60*1000,ok:true}).channels[0].state,'unknown')
})
test('视频补看工具、固定 ASR 上下游超时与运行 UI 已接入，均不增加写动作',()=>{
 const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const client=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const python=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
 assert.match(server,/name:'bili_video_revisit_moment'/)
 assert.match(server,/planVideoMomentFollowup/)
 assert.match(server,/verifyVideoFocusReview/)
 assert.match(server,/timeoutMs:390_000/)
 assert.match(python,/BILI_ASR_TIMEOUT_SECONDS/)
 assert.match(python,/timeout=timeout_seconds/)
 assert.match(ui,/models-local-vision-active/)
 assert.match(ui,/health-channel-chip\[data-state="failed"\]/)
 assert.match(client,/Array\.isArray\(data\.channels\)/)
 assert.match(client,/chip\.title=detail/)
})
