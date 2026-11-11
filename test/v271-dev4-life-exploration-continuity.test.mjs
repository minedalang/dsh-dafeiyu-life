import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
import {verifyLifePublicMetadata} from '../lib/life-public-metadata.mjs'

const BV='BV1abcde1234', T=Date.parse('2026-11-06T18:00:00Z')
const A={dedeuserid:'123456',sessdata:'account-a'},B={dedeuserid:'654321',sessdata:'account-b'}
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-continuity-'));try{return await fn(dir)}finally{rmSync(dir,{force:true,recursive:true})}}
const config=()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:60,
  autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24})
const seed=(dir,tag)=>{
  const folder=join(dir,'video-discussion-reads');mkdirSync(folder,{recursive:true})
  writeFileSync(join(folder,new Date(T).toISOString().slice(0,10)+'.jsonl'),[
    {v:1,account:tag,bvid:BV,at:new Date(T-3600_000).toISOString(),kind:'comment_list_read',status:'read',verified:true,count:4},
    {v:1,account:tag,bvid:BV,at:new Date(T-3500_000).toISOString(),kind:'provisional_fish_reaction',reaction:'curious',subjective:true,question:'这个作者还有别的公开作品吗？'}
  ].map(JSON.stringify).join('\n')+'\n')
}
function harness(dir,{failedRead=false,receiptFails=false}={}){
  const clock={at:T};let credential=A,step=0,videoLaunches=0,readCalls=0
  const tag=()=>discussionAccountTag(credential)
  seed(dir,tag())
  const life=createLifeOpportunities({stateDir:dir,getCredential:()=>credential,now:()=>clock.at,getInterestEvidence:()=>[]})
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:tag,now:()=>clock.at})
  const traces=createLifeDecisionTrace({dataDir:dir,getAccountTag:tag,now:()=>clock.at})
  const planner=createAutonomousPlanner({dataDir:dir,getConfig:config,now:()=>clock.at,getLifeAccountTag:tag,
    getTodos:()=>[],getAcceptedActionReservations:()=>[],getLifeOpportunities:()=>life.list(),
    getLifeIntentionCues:()=>life.explorationCues(),getLifeIntentions:()=>life.continuations(),
    getActiveLifeIntentionReservations:()=>life.intentions({includeClosed:true}),
    getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),
    offerLifeWake:x=>events.offer(x),settleLifeEvents:(ids,reason)=>events.settle(ids,reason),
    recordLifeDecision:x=>events.recordDecision(x),beginDecisionTrace:params=>traces.begin(params),
    getLifeCapabilities:()=>[{id:'bilibili.video-explore'}],
    runLifeCapability:()=>({started:(videoLaunches++,true)}),recordVideoStart:()=>events.recordVideoStart(),
    beginLifeVideoExploration:(...args)=>life.beginVideoExploration(...args),
    recordExplorationCueFailure:(...args)=>receiptFails?{ok:false,error:'ledger-busy'}:life.failExplorationCueRead(...args),
    invokeModel:async()=>JSON.stringify(step++===0?{action:'begin_exploration',id:life.explorationCues()[0]?.id,
      goal:'我想了解这条公开评论提到的视频作者'}:{action:'use_capability',capability:'bilibili.video-explore'}),
    executeOpportunityRead:async bvid=>{readCalls++;return failedRead?{ok:false,code:'metadata-rate-limited'}:{ok:true,bvid,title:'可信公开资料'}},
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
  return {life,events,traces,planner,clock,tag,
    setAccount:v=>credential=v,get videoLaunches(){return videoLaunches},get readCalls(){return readCalls}}
}

test('closed original opportunity: a failed independent exploration produces metadata code and a separate retry, not generic preflight',()=>home(async dir=>{
  const x=harness(dir,{failedRead:true})
  const cue=x.life.explorationCues()[0]
  assert.ok(cue,'verified comment read is an eligible cue')
  assert.equal(x.life.decide(cue.id,'inspect',{result:'verified-metadata',title:'previously inspected'}).ok,true)
  assert.equal(x.life.list().length,0,'old opportunity is finished')
  assert.equal(x.life.explorationCues().length,1,'independent voluntary cue remains available')
  const outcome=await x.planner.tick({force:true})
  assert.equal(outcome.action,'begin_exploration')
  assert.equal(outcome.result,'metadata-read-failed')
  assert.equal(outcome.ok,false)
  assert.equal(outcome.diagnosticCode,'metadata-rate-limited')
  assert.equal(x.life.status().opportunities[0].status,'inspect','old verified opportunity must not be overwritten')
  assert.equal(x.life.status().explorationReadFailures[0].failureCode,'metadata-rate-limited')
  assert.equal(x.life.explorationCues().length,0,'cue is cooled independently')
  const steps=x.traces.get(outcome.traceId).run.steps
  assert.ok(steps.some(x=>x.type==='read-result'&&x.code==='metadata-rate-limited'))
  assert.ok(steps.some(x=>x.type==='action-result'&&x.result==='metadata-read-failed'))
  assert.ok(!steps.some(x=>x.type==='error'&&x.code==='action-preflight-error'))
  x.clock.at+=15*60_000
  assert.equal(x.life.explorationCues().length,1,'same cue may be reconsidered after bounded cooldown')
}))

test('successful metadata exploration invites a fresh optional video-agent choice; neither step invents viewing',()=>home(async dir=>{
  const x=harness(dir)
  const first=await x.planner.tick({force:true})
  assert.equal(first.result,'verified-metadata')
  assert.equal(first.ok,true)
  assert.equal(x.readCalls,1)
  assert.equal(x.videoLaunches,0,'mere metadata does not start the video agent')
  assert.ok(x.events.status().recentVerifiedReads.some(e=>e.kind==='video-metadata'),
    'real metadata should be eligible as verified recent read, not as completed watching')
  assert.equal(x.events.status().videoStartsToday,0)
  assert.ok(x.events.peek().some(e=>e.kind==='exploration-ready'),
    'a real follow-up event exists, not a fake watched-video event')
  assert.ok(x.traces.get(first.traceId).run.steps.some(e=>e.type==='next-wake'&&e.code==='exploration-ready'))
  x.clock.at+=5*60_000
  const second=await x.planner.tick({force:true})
  assert.equal(second.action,'use_capability')
  assert.equal(second.result,'capability-launched')
  assert.equal(x.videoLaunches,1)
  assert.equal(x.events.status().videoStartsToday,1,'a launch is not a confirmed watched-video receipt')
  assert.ok(!x.events.peek().some(e=>e.kind==='exploration-ready'),'follow-up is settled after choice')
}))

test('failed cue journal has a distinct code after read result and does not overwrite old opportunity',()=>home(async dir=>{
  const x=harness(dir,{failedRead:true,receiptFails:true})
  const cue=x.life.explorationCues()[0]
  assert.equal(x.life.decide(cue.id,'inspect',{result:'verified-metadata'}).ok,true)
  const result=await x.planner.tick({force:true})
  assert.equal(result.diagnosticCode,'exploration-cue-receipt-failed')
  assert.equal(result.result,'model-or-execution-error')
  assert.equal(x.life.status().opportunities[0].status,'inspect')
  const steps=x.traces.get(result.traceId).run.steps
  assert.ok(steps.some(x=>x.type==='read-result'&&x.code==='metadata-rate-limited'))
  assert.ok(steps.some(x=>x.type==='error'&&x.code==='exploration-cue-receipt-failed'))
  assert.equal(x.events.status().needsReview,0,'read-only failure is not an unknown platform write')
}))

test('three failed independent cue reads cool down without permanently pausing exploration; account remains isolated',()=>home(async dir=>{
  const x=harness(dir,{failedRead:true});const id=x.life.explorationCues()[0].id
  for(const [i,delay] of [0,15*60_000,60*60_000].entries()){
    x.clock.at+=delay
    const row=x.life.failExplorationCueRead(id,'metadata-rate-limited',x.tag())
    assert.equal(row.ok,true);assert.equal(row.failures,i+1)
  }
  assert.equal(x.life.explorationCues().length,0)
  assert.equal(x.life.status().explorationReadFailures[0].paused,false)
  x.clock.at+=6*60*60_000
  assert.ok(x.life.explorationCues().some(c=>c.id===id))
  x.setAccount(B)
  assert.deepEqual(x.life.status().explorationReadFailures,[])
  x.setAccount(A)
  assert.equal(x.life.status().explorationReadFailures[0].failures,3)
}))

test('metadata gate classifies Bilibili -412 as rate limited and cannot fake a successful receipt',()=>{
  assert.equal(verifyLifePublicMetadata(BV,{code:-412,message:'request refused'}).code,'metadata-rate-limited')
  assert.equal(verifyLifePublicMetadata(BV,{ok:false,error:{code:-412,message:'blocked'}}).code,'metadata-rate-limited')
  assert.equal(verifyLifePublicMetadata(BV,{code:-101,message:'request refused'}).code,'metadata-account-unavailable')
  assert.equal(verifyLifePublicMetadata(BV,{data:{bvid:BV,title:'真实标题'}}).ok,true)
})
