import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'

const A='a'.repeat(16),B='b'.repeat(16),T=Date.parse('2026-11-07T06:00:00Z')
async function home(fn){const dir=mkdtempSync(join(tmpdir(),'life-dev14-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('私信、评论、点赞等可信完成动作共享同一匿名跨进程续行账本，重复回执不叠加',()=>home(dir=>{
 let t=T,scope=A
 const events=()=>createLifeAgentEvents({stateDir:dir,getAccountTag:()=>scope,now:()=>t})
 for(const [i,kind] of ['dm_reply','comment_reply','share_video','video_like','video_collect','video_follow','video_comment','followup','owner_care'].entries()){
  const x=events().recordVerifiedCompletion({kind,sourceRef:(i+1).toString(16).repeat(16)})
  assert.equal(x.followupQueued,true,kind)
  assert.equal(events().recordVerifiedCompletion({kind,sourceRef:(i+1).toString(16).repeat(16)}).followupQueued,false)
 }
 assert.equal(events().peek(8).length,0,'not ready before safe continuation delay')
 assert.equal(events().status().timeline.filter(e=>e.verifiedActionKind).length,9)
 const raw=readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8')
 assert.doesNotMatch(raw,/private-recipient|sourceRef|recipientUid|private-text/)
 t+=2*60_000+1
 assert.equal(events().status().dueExperienceFollowup,true)
 assert.ok(events().peek(8).some(x=>x.kind==='experience-ready'))
 scope=B
 assert.equal(events().peek(8).length,0,'account change must not surface prior account cues')
 scope=A
 events().settle(events().peek(8).map(x=>x.id),'considered')
 assert.equal(events().status().timeline.filter(e=>e.verifiedActionKind).length,9)
}))

test('严格拒绝任意回执、未知种类和原始私人标识',()=>home(dir=>{
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>T})
 assert.deepEqual(e.recordVerifiedCompletion({kind:'dm_reply',sourceRef:'12345'}),{ok:false,reason:'unverified-completion-source'})
 assert.equal(e.recordVerifiedCompletion({kind:'dm_reply',sourceRef:'private-UID'}).ok,false)
 assert.equal(e.recordVerifiedCompletion({kind:'write_dynamic',sourceRef:'c'.repeat(16)}).ok,false,'accepted-unverified dynamic cannot qualify')
 assert.equal(e.recordVerifiedCompletion({kind:'explore_video',sourceRef:'c'.repeat(16)}).ok,false,'delegation is not a completed video round')
 assert.equal(e.status().timeline.length,0)
}))

test('Life 意愿层仅在真实 verified 结果且结算后通知，delegated/uncertain/accepted-unverified 均不创建续行',async()=>home(async dir=>{
 let t=T,scope=A
 const eventLedger=()=>createLifeAgentEvents({stateDir:dir,getAccountTag:()=>scope,now:()=>t})
 const observed=[]
 const engine=createLifeWillingness({dataDir:dir,getAccountTag:()=>scope,now:()=>t,
  getContext:()=>({voice:'自主生活'}),invokeModel:()=>'{"action":"act","candidateId":"reply","reason":"想回应"}',
  onVerifiedAction:(x)=>{observed.push(x.kind);eventLedger().recordVerifiedCompletion(x)}})
 async function choose(key,kind='dm_reply'){
  const r=await engine.decide({sourceKey:'verified-'+key,trigger:'social',candidates:[{id:'reply',kind,label:'有证据的自主动作'}]})
  assert.equal(r.ok,true,JSON.stringify(r));return r.proof
 }
 const first=await choose('known-1')
 assert.equal(engine.receipt(first,{status:'verified'}).ok,true)
 assert.equal(engine.receipt(first,{status:'verified'}).ok,true)
 assert.deepEqual(observed,['dm_reply'])
 assert.equal(eventLedger().status().timeline.length,1)
 for(const [i,status] of ['uncertain','delegated','accepted-unverified','not-sent'].entries()){
  const p=await choose('unknown-'+i)
  assert.equal(engine.receipt(p,{status}).ok,true)
 }
 assert.deepEqual(observed,['dm_reply'])
 assert.equal(eventLedger().status().timeline.length,1)
 const second=await choose('known-1')
 assert.equal(engine.receipt(second,{status:'verified'}).ok,true)
 assert.equal(eventLedger().status().timeline.length,1,'same canonical source cannot requeue after restart or another approval')
}))

test('账号在等待模型时切换后，旧账号的成功回执不能写到新账号',async()=>home(async dir=>{
 let scope=A
 const engine=createLifeWillingness({dataDir:dir,getAccountTag:()=>scope,
  getContext:()=>({voice:'自主生活'}),invokeModel:()=>'{"action":"act","candidateId":"comment","reason":"想回复"}',
  onVerifiedAction:x=>createLifeAgentEvents({stateDir:dir,getAccountTag:()=>scope}).recordVerifiedCompletion(x)})
 const r=await engine.decide({sourceKey:'comment-source',candidates:[{id:'comment',kind:'comment_reply',label:'评论'}]})
 assert.equal(r.ok,true)
 scope=B
 assert.equal(engine.receipt(r.proof,{status:'verified'}).ok,false)
 assert.equal(createLifeAgentEvents({stateDir:dir,getAccountTag:()=>B}).status().timeline.length,0)
}))

test('成功的内部反思获得下次考虑，失败与影子判断没有续行',()=>home(dir=>{
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>T})
 assert.equal(e.recordDecision({mode:'active',action:'reflect',result:'completed'}).followupQueued,true)
 assert.equal(e.recordDecision({mode:'shadow',action:'reflect',result:'completed'}).followupQueued,false)
 assert.equal(e.recordDecision({mode:'active',action:'reflect',result:'skipped'}).followupQueued,false)
 assert.equal(e.recordDecision({mode:'active',action:'reflect',result:'completed',failed:true}).followupQueued,false)
 assert.equal(e.status().waitingLifeCues,1)
}))

test('时间线只展示来自实际确认的互动，不能将模型选择或受理中的动态算作完成',()=>{
 const rows=buildLifeTimeline({now:T+100,lifeDecisions:[
  {at:T,mode:'active',action:'verified_write',result:'verified-action',verifiedActionKind:'comment_reply',failed:false},
  {at:T,mode:'active',action:'verified_write',result:'verified-action',verifiedActionKind:'dm_reply',failed:false},
  {at:T,mode:'active',action:'verified_write',result:'verified-action',verifiedActionKind:'write_dynamic',failed:false},
  {at:T,mode:'active',action:'verified_write',result:'accepted-unverified',verifiedActionKind:'comment_reply',failed:false},
  {at:T,mode:'shadow',action:'verified_write',result:'verified-action',verifiedActionKind:'video_like',failed:false},
 ]})
 assert.equal(rows.filter(x=>x.type==='life-write').length,2)
 assert.ok(rows.every(x=>!x.detail.includes('已看完')))
})

test('可信评论完成后自然档可在普通 30 分钟周期之前重新考虑独立生活契机',async()=>home(async dir=>{
 const {createAutonomousPlanner}=await import('../lib/autonomous-planner.mjs')
 let t=T,considered=0
 const events=()=>createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>t})
 const friendId='d'.repeat(24)
 const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
  autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:40,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>t,getConfig:()=>cfg,getLifeAccountTag:()=>A,
  getTodos:()=>[],getLifeEvents:()=>events().peek(4),getLifeEventStatus:()=>events().status(),
  offerLifeWake:x=>events().offer(x),settleLifeEvents:(ids,why)=>events().settle(ids,why),
  recordLifeDecision:x=>events().recordDecision(x),getLifeCapabilities:()=>[],
  getFriendInitiatives:()=>[{id:friendId,eligible:true,outboundEnabled:false,stage:'known'}],
  recordFriendInitiative:()=>({ok:true}),runFriendInitiative:async()=>{throw Error('no write')},
  invokeModel:async()=>{considered++;return JSON.stringify({action:'review_friend',id:friendId})},
  executeRead:async()=>({ok:true}),updateTodo:async()=>({ok:true}),reflect:async()=>({ok:true})})
 // A real platform confirmation is handed over only after its original send
 // transaction is committed. The Life wake is never the original send payload.
 events().recordVerifiedCompletion({kind:'comment_reply',sourceRef:'d'.repeat(16)})
 assert.equal(events().status().dueExperienceFollowup,false)
 t+=9*60_000
 const result=await planner.tick()
 assert.equal(result.action,'review_friend',JSON.stringify(result))
 assert.equal(considered,1)
 assert.equal(events().status().dueExperienceFollowup,false)
}))

test('可信自主联系熟人成功后才能续行，单纯考虑和不确定发送均不续行',()=>home(dir=>{
 let t=T
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>t})
 const ref='trusted-friend-candidate-not-stored'
 assert.equal(e.recordDecision({mode:'active',action:'review_friend',targetId:ref,result:'friend-considered-no-send'}).followupQueued,false)
 assert.equal(e.recordDecision({mode:'active',action:'reach_out_friend',targetId:ref,result:'friend-message-uncertain'}).followupQueued,false)
 assert.equal(e.recordDecision({mode:'active',action:'reach_out_friend',targetId:ref,result:'friend-message-sent',failed:true}).followupQueued,false)
 assert.equal(e.recordDecision({mode:'active',action:'reach_out_friend',targetId:ref,result:'friend-message-sent'}).followupQueued,true)
 assert.equal(e.recordDecision({mode:'active',action:'reach_out_friend',targetId:ref,result:'friend-message-sent'}).followupQueued,false)
 const raw=readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8')
 assert.doesNotMatch(raw,/trusted-friend-candidate-not-stored/)
 assert.equal(e.status().timeline[0].verifiedActionKind,'friend_outreach')
 t+=9*60_000
 assert.equal(e.status().dueExperienceFollowup,true)
}))
