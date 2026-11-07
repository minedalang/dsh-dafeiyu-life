import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeFriendInitiatives,friendInitiativePace} from '../lib/life-friend-initiatives.mjs'
import {plannerActionMenu,createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
const START=Date.parse('2026-11-07T10:00:00Z'), A='a'.repeat(16),B='b'.repeat(16)
const entry={uid:'123456789',stage:'known',incoming:2,outgoing:3,count:5,activeDays:2,lastAt:START-30*3600_000}
const cfg=()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',lifeProactiveFriendDmEnabled:false,
 autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:40,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,
 friendDirectory:JSON.stringify([{uid:'123456789',name:'好友',dm:true}]),dmOwnerUid:'99999'})
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'dsh-friend-dev11-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let tag=A,at=START,settings=cfg(),relationships=[{...entry}];const engine=createLifeFriendInitiatives({dataDir:dir,getAccountTag:()=>tag,getConfig:()=>settings,getRelationships:()=>relationships,now:()=>at});return {dir,engine,settings,relationships,setAccount:x=>tag=x,setNow:x=>at=x}}
test('关系机会不需要视频，必须有经过许可的双向真人互动，且匿名持久保存',t=>{const x=fixture(t);let rows=x.engine.eligible();assert.equal(rows.length,1);assert.equal(rows[0].source,'relationship-metadata');assert.equal(rows[0].outboundEnabled,false);assert.equal(plannerActionMenu({friends:rows,videoEligible:false}).some(x=>x.action==='reach_out_friend'),false);x.settings.lifeProactiveFriendDmEnabled=true;rows=x.engine.eligible();assert.equal(rows[0].outboundEnabled,true);assert.equal(x.engine.mark(rows[0].id,{action:'reserve'}).ok,true);assert.equal(x.engine.eligible().length,0);assert.equal(x.engine.lookup(rows[0].id,{allowReserved:true})?.uid,entry.uid);assert.equal(x.engine.mark(rows[0].id,{action:'sent'}).ok,true);assert.equal(x.engine.eligible().length,0);const ledger=readFileSync(join(x.dir,'life-friend-initiatives',A+'.json'),'utf8');assert.ok(!ledger.includes('123456789'));assert.ok(!ledger.includes('好友'))})
test('延期、未知发送结果与账户隔离：不得自动重发',t=>{const x=fixture(t);x.settings.lifeProactiveFriendDmEnabled=true;let id=x.engine.eligible()[0].id;assert.equal(x.engine.mark(id,{action:'review'}).ok,true);assert.equal(x.engine.eligible().length,0);x.setNow(START+13*3600_000);assert.equal(x.engine.eligible().length,1);assert.equal(x.engine.mark(id,{action:'reserve'}).ok,true);assert.equal(x.engine.mark(id,{action:'uncertain'}).ok,true);assert.equal(x.engine.eligible().length,0);x.setAccount(B);assert.equal(x.engine.eligible().length,1);assert.notEqual(x.engine.eligible()[0].id,id);x.setAccount('unverified');assert.throws(()=>x.engine.eligible(),/account-unverified/)})
test('撤销白名单、退出活跃模式及缺少双向证据都会撤销主动联系',t=>{const x=fixture(t);x.settings.lifeProactiveFriendDmEnabled=true;let id=x.engine.eligible()[0].id;x.settings.friendDirectory='[]';assert.equal(x.engine.eligible().length,0);x.settings.friendDirectory=cfg().friendDirectory;x.relationships[0].outgoing=0;assert.equal(x.engine.eligible().length,0);x.relationships[0].outgoing=3;x.settings.lifeAgentMode='shadow';assert.equal(x.engine.eligible()[0].outboundEnabled,false);x.settings.lifeAgentMode='off';assert.equal(x.engine.eligible().length,0);assert.equal(friendInitiativePace({autonomousPlannerMinutes:10,autonomousPlannerDailyLimit:100}).considerAgainAfterHours,12);assert.ok(id)})
test('Life 在没有视频 Agent、待办或视频线索时仍能主动考虑熟人',async t=>{const x=fixture(t);const events=createLifeAgentEvents({stateDir:x.dir,getAccountTag:()=>A,now:()=>START});let calls=0,toolCalls=0;const planner=createAutonomousPlanner({dataDir:x.dir,now:()=>START,getConfig:()=>x.settings,getTodos:()=>[],getLifeAccountTag:()=>A,
 getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),offerLifeWake:e=>events.offer(e),settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:v=>events.recordDecision(v),
 getFriendInitiatives:()=>x.engine.eligible(),recordFriendInitiative:(id,choice)=>x.engine.mark(id,choice),runFriendInitiative:async()=>{toolCalls++;return {ok:true,confirmed:true}},getLifeCapabilities:()=>[],
 invokeModel:async prompt=>{calls++;const id=x.engine.eligible()[0].id;return JSON.stringify({action:'review_friend',id})},getLifeVoice:()=>'',executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})});
 const r=await planner.tick({force:true});assert.equal(r.result,'friend-considered-no-send',JSON.stringify(r));assert.equal(calls,1);assert.equal(toolCalls,0);
})

test('真实关系账本按当前账号提取证据；旧无账号标签的经历不授权主动联系',async t=>{
  const {recordFriendInteraction,listFriendRelationships}=await import('../lib/friend-relationships.mjs')
  const dir=mkdtempSync(join(tmpdir(),'dsh-friend-scope-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const roster=JSON.stringify([{uid:'123456789',dm:true}]),uid='123456789'
  for(let i=0;i<7;i++)recordFriendInteraction(dir,{uid,source:i%2?'dm':'comment',direction:i%2?'incoming':'outgoing',eventId:'legacy-'+i,friendDirectory:roster,now:START-(7-i)*DAY})
  assert.ok(listFriendRelationships(dir,roster,START).length)
  assert.equal(listFriendRelationships(dir,roster,START,{accountTag:A}).length,0)
  for(let i=0;i<6;i++)recordFriendInteraction(dir,{uid,source:'dm',direction:i%2?'incoming':'outgoing',eventId:'new-'+i,friendDirectory:roster,accountTag:A,now:START-(6-i)*DAY})
  assert.equal(listFriendRelationships(dir,roster,START,{accountTag:A}).length,1)
  assert.equal(listFriendRelationships(dir,roster,START,{accountTag:B}).length,0)
})

test('无视频的熟人主动外发：只在明确授权时启动一次已审核发送器',async t=>{
  const x=fixture(t);x.settings.lifeProactiveFriendDmEnabled=true
  const events=createLifeAgentEvents({stateDir:x.dir,getAccountTag:()=>A,now:()=>START})
  let calls=0,sends=0
  const planner=createAutonomousPlanner({dataDir:x.dir,now:()=>START,getConfig:()=>x.settings,getTodos:()=>[],getLifeAccountTag:()=>A,
    getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),offerLifeWake:e=>events.offer(e),settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:v=>events.recordDecision(v),
    getFriendInitiatives:()=>x.engine.eligible(),recordFriendInitiative:(id,choice)=>x.engine.mark(id,choice),
    runFriendInitiative:async()=>{sends++;return {ok:true,confirmed:true}},getLifeCapabilities:()=>[],
    invokeModel:async()=>{calls++;return JSON.stringify({action:'reach_out_friend',id:x.engine.eligible()[0].id})},
    getLifeVoice:()=>'',executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
  const out=await planner.tick({force:true});assert.equal(out.result,'friend-message-sent',JSON.stringify(out));assert.equal(sends,1);assert.equal(calls,1)
  const repeat=await planner.tick({force:true});assert.notEqual(repeat.result,'friend-message-sent');assert.equal(sends,1)
})
const DAY=86_400_000
