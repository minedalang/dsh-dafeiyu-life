import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
const A='a'.repeat(16),B='b'.repeat(16),T=Date.parse('2026-11-07T05:30:00Z')
const home=fn=>{const dir=mkdtempSync(join(tmpdir(),'dev13-life-'));try{return fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('多渠道拥塞仍为独立生活契机与视频回执保留席位，跨重启轮换优先来源',()=>home(dir=>{
 let t=T
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>t})
 for(let n=0;n<20;n++)e.offer({kind:'dm-received',platform:'bilibili',sourceKey:'dm-'+n})
 e.offer({kind:'video-round-ended',platform:'bilibili',sourceKey:'completed-round'})
 for(const kind of ['exploration-ready','friend-ready','todo-ready','public-ready','curiosity-ready','reflection-ready','experience-ready']){
  e.offer({kind,platform:'life',sourceKey:'source-'+kind})
 }
 let v=e.peek(4)
 assert.equal(v.length,4)
 assert.equal(v.filter(x=>x.kind==='dm-received').length,2)
 assert.equal(v.some(x=>x.kind==='video-round-ended'),true)
 assert.equal(v.some(x=>x.kind==='exploration-ready'),true)
 const visited=new Set()
 for(let n=0;n<7;n++){
  const curr=e.peek(4),cue=curr.find(x=>['exploration-ready','friend-ready','todo-ready','public-ready','curiosity-ready','reflection-ready','experience-ready'].includes(x.kind))
  assert.ok(cue)
  visited.add(cue.kind)
  e.recordDecision({eventIds:curr.map(x=>x.id),action:'skip',result:'voluntary-rest',mode:'active'})
 }
 assert.equal(visited.size,7,'跨轮公平选择应覆盖七种独立机会来源')
 const after=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>t})
 assert.equal(after.status().cueCursor,0,'轮换游标按账号持久保存')
 assert.deepEqual(after.peek(4).map(x=>x.kind),e.peek(4).map(x=>x.kind))
}))

test('已核验只读行动只在 active 模式登记一次匿名后续考虑，不重放原动作',()=>home(dir=>{
 let t=T,tag=A
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:()=>t})
 const row={action:'execute_read',result:'done',targetId:'private-uid-DoNotStore',mode:'active',verifiedReadKind:'todo-read'}
 assert.equal(e.recordDecision(row).followupQueued,true)
 assert.equal(e.recordDecision(row).followupQueued,false,'同轮重复回执不应重复生成机会')
 assert.equal(e.status().dueExperienceFollowup,false)
 assert.equal(e.peek(8).length,0)
 const text=readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8')
 assert.doesNotMatch(text,/DoNotStore|private-uid-DoNotStore/)
 t+=2*60_000+100
 assert.equal(e.status().dueExperienceFollowup,true)
 assert.equal(e.peek(8)[0].kind,'experience-ready')
 tag=B
 assert.equal(e.peek(8).length,0,'切换账号没有旧账号延续事件')
 tag=A
 e.settle(e.peek(8).map(x=>x.id),'considered')
 assert.equal(e.peek(8).length,0,'被明确考虑的延续事件不会导致自动循环')
}))

test('休息、失败、影子模式、模型输出自称成功都不会制造延续机会',()=>home(dir=>{
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>T})
 const cases=[
  {action:'skip',result:'voluntary-rest',verifiedReadKind:'todo-read'},
  {action:'execute_read',result:'failed',verifiedReadKind:'todo-read'},
  {action:'execute_read',result:'done',verifiedReadKind:'todo-read',failed:true},
  {action:'execute_read',result:'done',verifiedReadKind:'todo-read',mode:'shadow'},
  {action:'reflect',result:'completed',verifiedReadKind:'todo-read'},
  {action:'consider_social',result:'social-attended',verifiedReadKind:''},
 ]
 for(const x of cases)assert.equal(e.recordDecision({mode:'active',targetId:'x',...x}).followupQueued,false)
 assert.equal(e.status().pendingLifeCues,0)
}))

test('长期被别的选择掩盖的真实契机，六小时后源仍有效才可重新候选；失败与未知不会复活',()=>home(dir=>{
 let t=T
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>t})
 const k={kind:'friend-ready',platform:'life',sourceKey:'verified-two-way'}
 const offered=e.offer(k)
 for(let round=0;round<3;round++){
  assert.equal(e.settle([offered.id],'not-selected').updated,1)
  if(round<2)t+=[30,120][round]*60_000+1
 }
 assert.equal(e.status().recent.find(x=>x.kind==='friend-ready').result,'unselected-after-three-turns')
 assert.equal(e.offer(k).reoffered,undefined,'最后一次没被选中后不能立刻绕过退避')
 t+=6*3600_000+1
 const result=e.offer(k)
 assert.equal(result.reoffered,true)
 assert.equal(result.id,offered.id)
 const fail=e.offer({kind:'todo-ready',sourceKey:'broken-source'})
 for(let n=0;n<3;n++){
  if(n>0)t+=[0,6,11][n]*60_000
  e.settle([fail.id],'model-error')
 }
 t+=8*3600_000
 assert.equal(e.offer({kind:'todo-ready',sourceKey:'broken-source'}).reoffered,undefined)
 assert.equal(e.status().failed,1)
}))

test('Life 可以在普通 30 分钟间隔尚未结束时，自主续行刚完成的真实只读行动',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev13-life-tick-'))
 try{
  let at=T,readDone=false,calls=0,friendsReviewed=0
  const todo={id:'11111111-1111-4111-8111-111111111111',type:'check_notifications',status:'open',createdAt:at}
  const friendId='c'.repeat(24)
  const events=()=>createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>at})
  const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:40,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
  const create=()=>createAutonomousPlanner({dataDir:dir,now:()=>at,getConfig:()=>cfg,getLifeAccountTag:()=>A,
   getTodos:()=>todo.status==='open'?[todo]:[],getLifeEvents:()=>events().peek(4),getLifeEventStatus:()=>events().status(),
   offerLifeWake:e=>events().offer(e),settleLifeEvents:(ids,reason)=>events().settle(ids,reason),recordLifeDecision:r=>events().recordDecision(r),
   getLifeCapabilities:()=>[],getFriendInitiatives:()=>readDone?[{id:friendId,eligible:true,outboundEnabled:false,stage:'known'}]:[],
   recordFriendInitiative:()=>{friendsReviewed++;return {ok:true}},runFriendInitiative:async()=>{throw Error('cannot send')},
   invokeModel:async()=>{calls++;return JSON.stringify(calls===1?{action:'execute_read',id:todo.id}:{action:'review_friend',id:friendId})},
   executeRead:async()=>{readDone=true;todo.status='done';return {ok:true}},updateTodo:async()=>{},reflect:async()=>({ok:true})})
  assert.equal((await create().tick({force:true})).result,'done')
  assert.equal(calls,1)
  assert.equal(events().status().dueExperienceFollowup,false)
  at+=9*60_000
  const again=await create().tick()
  assert.equal(again.action,'review_friend',JSON.stringify(again))
  assert.equal(friendsReviewed,1)
  assert.equal(calls,2)
  assert.equal(events().status().dueExperienceFollowup,false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('高频社交事件不会挤掉仍待考虑的跨源 Life 契机',()=>home(dir=>{
 const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>T})
 const kinds=['friend-ready','todo-ready','public-ready','curiosity-ready','reflection-ready']
 const cueIds=kinds.map(kind=>e.offer({kind,sourceKey:'trusted-'+kind}).id)
 for(let n=0;n<180;n++)e.offer({kind:'comment-received',platform:'bilibili',sourceKey:'many-comments-'+n})
 const persisted=JSON.parse(readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8'))
 assert.ok(persisted.events.length<=120)
 for(const id of cueIds)assert.equal(persisted.events.some(x=>x.id===id),true)
 assert.equal(new Set(e.peek(4).map(x=>x.kind)).has('friend-ready'),true)
}))

test('真实生活时间线新增已核验只读记录，不从模型意图伪造发布、听歌或社交',()=>{
 const base={at:T,mode:'active',action:'execute_read',result:'done',verifiedReadKind:'todo-read',eventRefs:['a'.repeat(16)]}
 const rows=buildLifeTimeline({lifeDecisions:[base,{...base,at:T-1000,mode:'shadow'},{...base,at:T-2000,result:'failed'},
  {...base,at:T-3000,verifiedReadKind:''},{...base,at:T-4000,action:'reach_out_friend',result:'done'}],now:T+1000})
 assert.equal(rows.length,1)
 assert.equal(rows[0].type,'life-read')
 assert.match(rows[0].detail,/不代表看完视频/)
 assert.equal(Boolean(rows[0].url),false)
})

test('向管理中心输出的只读回执仅来自当前账号现有匿名 Life 账本',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(index,/lifeDecisions=ledger\?\.timeline/)
 assert.match(index,/buildLifeTimeline\(\{watched,videoRounds,lifeDecisions/)
 assert.match(ui,/counts\['life-read'\]/)
})
