import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {lifePacePolicy,lifeVideoGate} from '../lib/life-pace-policy.mjs'
import {lifeExperienceReadiness} from '../lib/life-experience-readiness.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
const A='a'.repeat(16),START=Date.parse('2026-11-06T08:00:00')
const profiles={
  quiet:{autonomousPlannerMinutes:120,autonomousPlannerDailyLimit:12},
  natural:{autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:40},
  lively:{autonomousPlannerMinutes:10,autonomousPlannerDailyLimit:100},
  legacy:{autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:20},
}
const cfg=pace=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
  autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,...profiles[pace]})
const tmp=t=>{const dir=mkdtempSync(join(tmpdir(),'life-pace-dev10-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir}

test('生活档位只改变自主考虑窗口，任何档位都不能把视频工具限制为个位数',()=>{
 assert.deepEqual(['quiet','natural','lively','legacy'].map(x=>lifePacePolicy(cfg(x)).spontaneousWindowMinutes),[120,30,10,30])
 assert.deepEqual(['quiet','natural','lively','legacy'].map(x=>lifePacePolicy(cfg(x)).videoStartsPerDay),[null,null,null,null])
 assert.deepEqual(['quiet','natural','lively','legacy'].map(x=>lifePacePolicy(cfg(x)).videoCooldownMinutes),[20,20,20,20])
 assert.equal(lifeVideoGate(cfg('lively'),{videoStartsToday:61,lastVideoAt:START},START+20*60_000).eligible,true)
 assert.equal(lifeVideoGate(cfg('natural'),{videoStartsToday:55,lastVideoAt:START},START+19*60_000).reason,'video-launch-cooldown')
})

test('状态与委派门禁一致：没有新增每日视频轮次限制',()=>{
 const r=lifeExperienceReadiness({config:cfg('lively'),planner:{lifeRuns:3},
   events:{ok:true,videoStartsToday:51,lastVideoAt:START},capabilities:[{id:'bilibili.video-explore'}],at:START+20*60_000})
 assert.equal(r.videoStartLimit,null)
 assert.equal(r.videoCooldownMinutes,20)
 assert.equal(r.videoDelegationEligible,true)
 assert.equal(r.videoStartsToday,51)
 assert.ok(!('watchedVideos' in r))
})
function build(t,pace,{rest=false}={}){
 const dir=tmp(t),config=cfg(pace);let clock=START,modelCalls=0,starts=0
 const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>clock})
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock,getConfig:()=>config,getTodos:()=>[],
   getLifeAccountTag:()=>A,getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),
   getLifeCapabilities:()=>[{id:'bilibili.video-explore'}],
   offerLifeWake:e=>events.offer(e),settleLifeEvents:(ids,reason)=>events.settle(ids,reason),
   recordLifeDecision:x=>events.recordDecision(x),recordVideoStart:()=>events.recordVideoStart(),
   runLifeCapability:()=>{starts++;return {started:true}},
   invokeModel:async()=>{modelCalls++;return rest?'{"action":"skip"}':'{"action":"use_capability","capability":"bilibili.video-explore"}'},
   getLifeVoice:()=>'',executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
 return {planner,events,cfg:config,setClock:t=>clock=t,get starts(){return starts},get calls(){return modelCalls}}
}

test('活跃档可在同一天自主委派 50 轮，仍尊重单轮 20 分钟间隔',async t=>{
 const x=build(t,'lively'),base=Date.parse('2026-11-06T00:10:00')
 for(let i=0;i<50;i++){
   x.setClock(base+i*20*60_000)
   const result=await x.planner.tick({force:true})
   assert.equal(result.result,'capability-launched',`第${i+1}轮：${JSON.stringify(result)}`)
 }
 assert.equal(x.starts,50)
 assert.equal(x.events.status().videoStartsToday,50)
 x.setClock(base+49*20*60_000+10*60_000)
 assert.notEqual((await x.planner.tick({force:true})).result,'capability-launched')
})

test('自然档不限制每日视频次数，只调低自动考虑频率',async t=>{
 const x=build(t,'natural')
 assert.equal((await x.planner.tick({force:true})).result,'capability-launched')
 x.setClock(START+19*60_000)
 assert.notEqual((await x.planner.tick({force:true})).result,'capability-launched')
 x.setClock(START+30*60_000)
 assert.equal((await x.planner.tick({force:true})).result,'capability-launched')
 x.setClock(START+60*60_000)
 assert.equal((await x.planner.tick({force:true})).result,'capability-launched')
 assert.equal(x.starts,3)
})

test('活跃档模型自主选择休息时不会自动委派',async t=>{
 const x=build(t,'lively',{rest:true})
 const result=await x.planner.tick({force:true})
 assert.equal(result.result,'voluntary-rest')
 assert.equal(x.starts,0)
})

test('真实视频轮次完成通知跨重启持久保存，活跃档到期后可重新考虑',async t=>{
 const dir=tmp(t),config=cfg('lively')
 let clock=START,modelCalls=0,launches=0
 const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>clock})
 events.recordVideoStart()
 const round=events.recordVideoRoundStart({source:'life-agent'})
 clock+=1000
 events.recordVideoRoundFinish(round.id,{exitCode:0,pickedCount:2})
 events.offer({kind:'video-round-ended',platform:'bilibili',sourceKey:round.id})
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock,getConfig:()=>config,getTodos:()=>[],
   getLifeAccountTag:()=>A,getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),
   getLifeCapabilities:()=>[{id:'bilibili.video-explore'}],
   offerLifeWake:e=>events.offer(e),settleLifeEvents:(ids,reason)=>events.settle(ids,reason),
   recordLifeDecision:x=>events.recordDecision(x),recordVideoStart:()=>events.recordVideoStart(),
   runLifeCapability:()=>{launches++;return {started:true}},
   invokeModel:async()=>{modelCalls++;return '{"action":"skip"}'},
   getLifeVoice:()=>'',executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
 const early=await planner.tick({force:true})
 assert.equal(early.skipped,'video-feedback-waiting')
 assert.equal(modelCalls,0)
 assert.equal(events.status().pendingVideoFollowup,1)
 clock+=20*60_000
 // Recreate the authoritative account ledger from disk as after a restart.
 const afterRestart=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>clock})
 assert.equal(afterRestart.status().pendingVideoFollowup,1)
 // Restart the planner too: it must read the original persisted event,
 // not a process-local replay or a cached model answer.
 const afterPlanner=createAutonomousPlanner({dataDir:dir,now:()=>clock,getConfig:()=>config,getTodos:()=>[],
   getLifeAccountTag:()=>A,getLifeEvents:()=>afterRestart.peek(4),getLifeEventStatus:()=>afterRestart.status(),
   getLifeCapabilities:()=>[{id:'bilibili.video-explore'}],
   offerLifeWake:e=>afterRestart.offer(e),settleLifeEvents:(ids,reason)=>afterRestart.settle(ids,reason),
   recordLifeDecision:x=>afterRestart.recordDecision(x),recordVideoStart:()=>afterRestart.recordVideoStart(),
   runLifeCapability:()=>{launches++;return {started:true}},
   invokeModel:async()=>{modelCalls++;return '{"action":"skip"}'},
   getLifeVoice:()=>'',executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
 const next=await afterPlanner.tick({force:true})
 assert.equal(next.result,'voluntary-rest')
 assert.equal(modelCalls,1)
 assert.equal(launches,0)
 assert.equal(afterRestart.status().pendingVideoFollowup,0)
})
