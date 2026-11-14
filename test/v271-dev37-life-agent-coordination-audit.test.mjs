import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createUniversalLifeEpisodes} from '../lib/life-universal-episodes.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {lifeVideoGate} from '../lib/life-pace-policy.mjs'
import {createLifeCapabilities} from '../lib/life-capabilities.mjs'

const A='a'.repeat(16),B='b'.repeat(16),T=Date.parse('2026-11-08T12:00:00Z')
const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerMinutes:5,
 autonomousPlannerDailyLimit:24,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,homeRecommendationsEnabled:true}
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-life-coordination-'));try{await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('manual and autonomous video subprocesses share a launch cooldown, without spending planner quota for manual rounds',()=>withDir(async dir=>{
 let clock=T
 const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>clock})
 const round=events.recordVideoRoundStart({source:'manual'})
 clock+=2000
 events.recordVideoRoundFinish(round.id,{exitCode:0,pickedCount:1})
 const budget=events.status()
 assert.equal(budget.videoStartsToday,0,'manual run must not be relabeled as a Life planner launch')
 assert.equal(lifeVideoGate(cfg,budget,clock).reason,'video-launch-cooldown')
 assert.equal(lifeVideoGate(cfg,budget,T+20*60_000).eligible,false)
 assert.equal(lifeVideoGate(cfg,budget,T+30*60_000).eligible,true)
 assert.equal(lifeVideoGate(cfg,{...budget,lastVideoAt:0,recentVideoRounds:[{state:'completed',startedAt:T+30*60_000}]},clock).eligible,true, 'future-stamped records cannot invent a cooldown')
}))

test('capability admission explains video launch cooldown and never claims it affects non-video capabilities',()=>{
 let eligible=false,called=0
 const caps=createLifeCapabilities([
  {id:'bilibili.video-explore',risk:'delegated-existing-permissions',available:()=>eligible?{ok:true}:{ok:false,reason:'video-launch-cooldown'},execute:()=>{called++;return {started:true}}},
  {id:'notes.reflect',risk:'read',available:()=>({ok:true}),execute:()=>({ok:true})}
 ])
 assert.equal(caps.inspect().blocked.find(x=>x.id==='bilibili.video-explore').reason,'video-launch-cooldown')
 assert.deepEqual(caps.list().map(x=>x.id),['notes.reflect'])
 assert.equal(caps.run('bilibili.video-explore').started,false)
 assert.equal(caps.run('bilibili.video-explore').reason,'video-launch-cooldown','late admission preserves the precise safe cause')
 assert.equal(called,0)
 eligible=true
 assert.equal(caps.run('bilibili.video-explore').started,true)
 assert.equal(called,1)
})

test('generic Life rest does not pause an unrelated active Episode while considering a completed video feedback',()=>withDir(async dir=>{
 let clock=T
 const episodes=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>A,now:()=>clock})
 const first=episodes.record({sourceRef:'todo:unrelated',receiptId:'accepted-read-101',action:'execute_read',kind:'todo',outcome:'verified'})
 const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>clock})
 const round=events.recordVideoRoundStart({source:'life-agent'})
 clock+=1000
 events.recordVideoRoundFinish(round.id,{exitCode:0,pickedCount:0})
 events.offer({kind:'video-round-ended',platform:'bilibili',sourceKey:round.id})
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock,getConfig:()=>cfg,getTodos:()=>[],
   getLifeAccountTag:()=>A,getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),
   getLifeEpisodeContext:()=>episodes.list(),onEpisodeAction:r=>episodes.record(r),pauseLifeEpisode:o=>episodes.pauseLatest(o),
   getLifeCapabilities:()=>[],getLifeIntentionCues:()=>[],getLifeIntents:()=>[],getLifeIntentions:()=>[],
   getLifeOpportunities:()=>[],getFriendInitiatives:()=>[],
   offerLifeWake:x=>events.offer(x),settleLifeEvents:(ids,reason)=>events.settle(ids,reason),
   recordLifeDecision:r=>events.recordDecision(r),
   invokeModel:async()=>'{"action":"skip","reason":"不想开始新行动"}',
   executeRead:async()=>({ok:true}),updateTodo:async()=>({ok:true}),reflect:async()=>({ok:true})})
 const result=await planner.tick({force:true})
 assert.equal(result.result,'voluntary-rest')
 assert.equal(episodes.list({includeClosed:true}).find(x=>x.id===first.episode.id).status,'active',
   'rest about video feedback does not randomly pause a prior TODO')
}))

test('a second willingness veto is distinguishable from executor outage in Life decision result',()=>withDir(async dir=>{
 let clock=T
 const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>clock})
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock,getConfig:()=>cfg,getTodos:()=>[],
   getLifeAccountTag:()=>A,getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),
   getLifeCapabilities:()=>[{id:'bilibili.video-explore'}],
   offerLifeWake:x=>events.offer(x),settleLifeEvents:(ids,why)=>events.settle(ids,why),
   recordLifeDecision:r=>events.recordDecision(r),
   invokeModel:async()=>'{"action":"browse_home"}',
   runLifeCapability:async()=>({started:false,reason:'life-declined-video'}),
   executeRead:async()=>({ok:true}),updateTodo:async()=>({ok:true}),reflect:async()=>({ok:true})})
 const result=await planner.tick({force:true})
 assert.equal(result.action,'browse_home')
 assert.equal(result.result,'capability-not-started')
 assert.equal(result.diagnosticCode,'life-declined-video')
 assert.equal(events.status().videoStartsToday,0)
}))

test('production video adapter does not repeat the Planner willingness vote; it performs technical checks before spawn',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const start=source.indexOf("const lifeCapabilities=createLifeCapabilities")
 const end=source.indexOf("const lifeDecisionTrace=createLifeDecisionTrace",start)
 const block=source.slice(start,end)
 const inspect=block.indexOf('const admission=lifeCapabilities.inspect()')
 const spawn=block.indexOf("const launched=runDuty('life-agent'")
 assert.ok(start>=0&&end>start&&inspect>0&&spawn>inspect)
 assert.doesNotMatch(block,/lifeWillingness\?\.decide\(/)
 assert.doesNotMatch(block,/lifeWillingness\?\.verify\(/)
 assert.match(block,/trustedLifeAccountTag\(\)!==scopeBefore/)
})

test('a voluntary rest delays repeated due-Episode wakeups without pausing an unrelated Episode',()=>withDir(async dir=>{
 let clock=T,modelCalls=0
 const options={...cfg,autonomousPlannerMinutes:30,homeRecommendationsEnabled:false}
 const intent={id:'intent-only',status:'ready',expiresAt:T+24*3600_000,nextAt:T-1,
   episodeSteps:1,episodeMaxSteps:5,videos:[],creatorVideos:[]}
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock,getConfig:()=>options,
   getTodos:()=>[],getLifeAccountTag:()=>A,getLifeEvents:()=>[],
   getLifeEventStatus:()=>({ok:true,lastVideoAt:0,videoStartsToday:0}),
   getLifeIntentionCues:()=>[],getLifeIntents:()=>[],getLifeIntentions:()=>[intent],
   getLifeOpportunities:()=>[],getFriendInitiatives:()=>[],getLifeCapabilities:()=>[],
   isLifeEpisodeDue:()=>true,getLifeEpisodeSourceState:()=>null,
   invokeModel:async()=>{modelCalls++;return '{"action":"skip","reason":"先休息"}'},
   executeRead:async()=>({ok:true}),updateTodo:async()=>({ok:true}),reflect:async()=>({ok:true})})
 assert.equal((await planner.tick({force:true})).result,'voluntary-rest')
 assert.equal(modelCalls,1)
 clock+=3*60_000
 assert.equal((await planner.tick()).skipped,'cooldown','due Episode does not cause another model call two minutes after an explicit rest')
 assert.equal(modelCalls,1)
 clock+=27*60_000
 assert.equal((await planner.tick()).result,'voluntary-rest')
 assert.equal(modelCalls,2,'normal Life interval preserves the chance to reconsider later')
}))

test('DM/评论先完成真实上下文读取与专业提议，再调用唯一 Life 意愿审批',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 for(const marker of ['const stopLiveDm=','const stopLiveComment=']){
  const pos=source.indexOf(marker)
  const start=source.lastIndexOf('generateReply: async (req) => {',pos)
  const end=source.indexOf(marker==='const stopLiveDm='?'return attachSocialProof(generated,owner,sealed.proof)':'return attachSocialProof(normalized,owner,sealed.proof)',pos)
  const block=source.slice(start,end)
  assert.ok(start>=0&&end>pos)
  assert.ok(block.indexOf('interactionBatcher.generate')>=0)
  assert.ok(block.indexOf('adoptSocialDecisionQueued')>block.indexOf('interactionBatcher.generate'))
  assert.doesNotMatch(block,/lifeWillingness\?\.decide\(/)
  assert.match(block,/lifeEpisodeContext|evidence:\{episode:/)
 }
})
