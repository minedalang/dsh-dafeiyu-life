import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'
const T=Date.parse('2026-11-10T10:32:40+08:00'),TAG='1234567890abcdef'
const cfg={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,
  autonomousPlannerMinutes:180,autonomousPlannerDailyLimit:60,
  autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
const temp=async cb=>{const d=mkdtempSync(join(tmpdir(),'life-readable-'));try{return await cb(d)}finally{rmSync(d,{recursive:true,force:true})}}
const makeEvents=dir=>createLifeAgentEvents({stateDir:dir,getAccountTag:()=>TAG,now:()=>T})
const makePlanner=(dir,events,answer,extra={})=>createAutonomousPlanner({dataDir:dir,now:()=>T,
  getConfig:()=>cfg,getTodos:()=>[],getLifeAccountTag:()=>TAG,
  getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),
  getLifeCapabilities:()=>[],
  settleLifeEvents:(ids,reason)=>events.settle(ids,reason),
  recordLifeDecision:r=>events.recordDecision(r),
  invokeModel:async()=>JSON.stringify(answer),
  executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false}),...extra})

test('3 real social cues + model skip: diary says 3 cues, offers actual reason category, no send claim',()=>temp(async dir=>{
  const events=makeEvents(dir)
  for(let n=0;n<3;n++)events.offer({kind:n===0?'dm-received':'comment-received',platform:'bilibili',sourceKey:'social-'+n})
  const p=makePlanner(dir,events,{action:'skip',reason:'我有私密想法，电话18888888888，先休息',restReasonCode:'need-rest'})
  const r=await p.tick({socialWake:true})
  assert.equal(r.result,'voluntary-rest')
  const ledger=events.status().timeline[0]
  assert.equal(ledger.decisionOrigin,'social')
  assert.equal(ledger.restReasonCode,'need-rest')
  assert.equal(ledger.modelReasonProvided,true)
  assert.equal(ledger.options.social,3)
  const diary=buildLifeTimeline({lifeDecisions:[ledger],now:T+3000})
  assert.equal(diary.length,1)
  assert.equal(diary[0].type,'life-rest')
  assert.match(diary[0].title,/留意到新消息/)
  assert.match(diary[0].detail,/3 个私信与评论提醒/)
  assert.match(diary[0].detail,/想先休息/)
  assert.doesNotMatch(diary[0].detail,/专业 Agent|模型|候选筛选/)
  assert.doesNotMatch(JSON.stringify({ledger,diary}),/18888888888|私密想法|\buid\b|姓名/)
}))

test('A skip with an unapproved reason code cannot inject model prose into user timeline',()=>temp(async dir=>{
 const events=makeEvents(dir)
 events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'comment-private'})
 const r=await makePlanner(dir,events,{action:'skip',reason:'姓名张某 密码 secret',restReasonCode:'姓名张某 密码 secret'}).tick({socialWake:true})
 assert.equal(r.action,'skip')
 const ledger=events.status().timeline[0]
 assert.equal(ledger.restReasonCode,'')
 assert.equal(ledger.modelReasonProvided,true)
 const diary=buildLifeTimeline({lifeDecisions:[ledger],now:T+3000})
 assert.match(diary[0].detail,/留意到 1 个评论提醒/)
 assert.doesNotMatch(diary[0].detail,/模型|原因类别|未公开/)
 assert.doesNotMatch(JSON.stringify({ledger,diary}),/姓名张某|secret/)
}))

test('Social signal attention is not social sending or real read of message contents',()=>temp(async dir=>{
 const events=makeEvents(dir)
 const a=events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'social-private'})
 const result=await makePlanner(dir,events,{action:'consider_social',id:a.id,reason:'愿意留意'},
  {getLifeSocialPreview:()=>({ok:false})}).tick({socialWake:true})
 assert.equal(result.result,'social-signal-considered')
 const diary=buildLifeTimeline({lifeDecisions:events.status().timeline,now:T+3000})
 assert.equal(diary.length,1)
 assert.equal(diary[0].type,'life-consider')
 assert.match(diary[0].title,/私信提醒/)
 assert.match(diary[0].detail,/还没有打开具体内容或发送回复/)
 assert.doesNotMatch(diary[0].title,/回复了/)
}))

test('A model rest is distinct from an empty menu, failure and missing social signals',()=>{
 const rows=buildLifeTimeline({now:T+1000,lifeDecisions:[
  {at:T-3000,mode:'active',action:'skip',result:'voluntary-rest',options:{social:0,todos:2,opportunities:1},kinds:[],restReasonCode:'not-interested'},
  {at:T-2000,mode:'active',action:'skip',result:'no-actionable-options',options:{social:0},kinds:[]},
  {at:T-1000,mode:'active',action:'skip',result:'invalid-decision',options:{social:4},kinds:['dm-received']},
 ]})
 assert.deepEqual(rows.map(x=>x.type),['life-rest'])
 const rest=rows.find(x=>x.type==='life-rest')
 assert.match(rest.detail,/2项待办/)
 assert.match(rest.detail,/没有让她产生行动兴趣/)
 assert.ok(!rows.some(x=>x.type==='life-idle'),'无可用候选是调度诊断，不是生活事件')
})

test('Owner outreach queued is not presented as a confirmed delivered message',()=>temp(async dir=>{
 const events=makeEvents(dir)
 events.recordDecision({eventIds:[],action:'talk_to_owner',result:'owner-chat-queued',mode:'active',options:{}})
 const rows=buildLifeTimeline({lifeDecisions:events.status().timeline,now:T+3000})
 assert.equal(rows.length,1)
 assert.equal(rows[0].type,'life-consider')
 assert.match(rows[0].title,/主人/)
 assert.match(rows[0].detail,/尚未确认/)
 assert.doesNotMatch(rows[0].title,/已发送|送达/)
}))

test('Life user timeline shows actual verified new read actions, not raw intention',()=>{
 const rows=buildLifeTimeline({now:T+3000,lifeDecisions:[
  {at:T,mode:'active',action:'inspect_creator_space',result:'verified-creator-videos'},
  {at:T+1000,mode:'active',action:'inspect_creator_space',result:'creator-read-failed'},
  {at:T+2000,mode:'active',action:'review_video_feedback',result:'video-feedback-considered'},
 ]})
 assert.deepEqual(rows.map(x=>x.type),['life-consider','life-consider'])
 assert.match(rows.find(x=>/创作者/.test(x.title)).detail,/只读取并核验/)
})

test('Regular DM/comment specialist scheduler does not wait for Life 180-minute interval',async()=>{
 let dm=0,comments=0
 const scheduler=createInteractionScheduler({
  dm:{poll:async()=>{dm++;return {sent:0}}},
  comments:{poll:async()=>{comments++;return {sent:0}}},
  getConfig:()=>({...cfg,dmWatch:true,dmWatchMinutes:1,commentWatchReplies:true,commentReplyWatchMinutes:1}),
  now:()=>T,logger:{error(){}}})
 // Call tick immediately: no planner clock, model, quota or Life interval is consulted.
 scheduler.start()
 await scheduler.tick()
 assert.equal(dm,1)
 assert.equal(comments,1)
 scheduler.stop()
})
