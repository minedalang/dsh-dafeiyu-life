import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeAgentEvents,projectVideoRoundFeedback} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

const A='a'.repeat(16),B='b'.repeat(16)
const START=Date.parse('2026-11-06T09:10:00Z')
const isolated=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-postvideo-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
function scenario(dir,{mode='active',response='{"action":"skip"}',availability=null}={}){
  let time=START,tag=A,modelCalls=0,videoLaunches=0
  const prompts=[],steps=[]
  const capabilityState={available:true,reason:'video-busy',...(availability||{})}
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:()=>time})
  const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:mode,
    autonomousPlannerDailyLimit:24,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>time,getConfig:()=>cfg,getTodos:()=>[],getLifeAccountTag:()=>tag,
    getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),offerLifeWake:e=>events.offer(e),
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:x=>events.recordDecision(x),
    getLifeCapabilities:()=>capabilityState.available?[{id:'bilibili.video-explore'}]:[],
    getLifeCapabilityReadiness:()=>({ok:true,blocked:capabilityState.available?[]:[{id:'bilibili.video-explore',platform:'bilibili',reason:capabilityState.reason}]}),
    recordVideoStart:()=>events.recordVideoStart(),
    runLifeCapability:()=>{videoLaunches++;return {started:true}},getLifeVoice:()=>'',
    beginDecisionTrace:()=>({step:(s,x)=>steps.push({stage:s,...x}),finish:()=>{},discard:()=>{}}),
    invokeModel:async p=>{prompts.push(p);modelCalls++;return response},
    executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
  return {events,planner,prompts,steps,cfg,capabilityState,get time(){return time},set time(x){time=x},
    get tag(){return tag},set tag(x){tag=x},get modelCalls(){return modelCalls},get videoLaunches(){return videoLaunches}}
}
function completedRound(x,{pickedCount=2,source='life-agent'}={}){
  x.events.recordVideoStart()
  const round=x.events.recordVideoRoundStart({source})
  x.time+=12_000
  x.events.recordVideoRoundFinish(round.id,{exitCode:0,pickedCount})
  x.events.offer({kind:'video-round-ended',platform:'bilibili',sourceKey:round.id})
  return round.id
}

test('a video completion wake is NOT consumed inside the 180-minute start cooldown',()=>isolated(async dir=>{
  const x=scenario(dir),id=completedRound(x)
  const before=x.planner.status().runs
  const result=await x.planner.tick({force:true})
  assert.equal(result.skipped,'video-feedback-waiting')
  assert.equal(result.diagnosticCode,'video-launch-cooldown')
  assert.equal(result.modelCalled,false)
  assert.ok(result.nextAt>x.time)
  assert.equal(x.planner.status().runs,before)
  assert.equal(x.modelCalls,0)
  assert.equal(x.videoLaunches,0)
  assert.equal(x.events.status().pendingVideoFollowup,1)
  assert.ok(x.events.status().recent.some(e=>e.kind==='video-round-ended'&&e.state==='pending'))
  assert.doesNotMatch(JSON.stringify(x.planner.status().lifeEvents),new RegExp(id))
}))

test('after cooldown the SAME event reaches the model with actual round proof and is settled once',()=>isolated(async dir=>{
  const x=scenario(dir),id=completedRound(x)
  assert.equal((await x.planner.tick({force:true})).skipped,'video-feedback-waiting')
  x.time+=180*60_000
  const result=await x.planner.tick({force:true})
  assert.equal(result.result,'voluntary-rest')
  assert.equal(x.modelCalls,1)
  assert.equal(x.events.status().pendingVideoFollowup,0)
  assert.equal(x.events.status().timeline[0].videoRoundFeedbackOffered,true)
  assert.ok(x.steps.some(s=>s.stage==='video-round-feedback'&&s.latestOutcome==='process-exited-zero'&&s.latestPickedKnown===true))
  assert.match(x.prompts[0],/"outcome":"process-exited-zero"/)
  assert.match(x.prompts[0],/"pickedCount":2/)
  assert.match(x.prompts[0],/process-lifecycle-only-not-video-viewed-or-audio-heard/)
  assert.doesNotMatch(x.prompts[0],new RegExp(id))
  assert.equal(x.videoLaunches,0,'model chose to rest, not launch')
}))

test('daily video start limit delays feedback without charging a model, rather than dropping the event',()=>isolated(async dir=>{
  const x=scenario(dir)
  completedRound(x)
  x.events.recordVideoStart()
  x.time+=180*60_000
  const result=await x.planner.tick({force:true})
  assert.equal(result.skipped,'video-feedback-waiting')
  assert.equal(result.diagnosticCode,'video-daily-limit')
  assert.equal(x.modelCalls,0)
  assert.equal(x.events.status().pendingVideoFollowup,1)
  assert.ok(result.nextAt>x.time)
}))

test('shadow can inspect real round result but never delegates video or claims viewing',()=>isolated(async dir=>{
  const x=scenario(dir,{mode:'shadow',response:'{"action":"use_capability","capability":"bilibili.video-explore"}'})
  completedRound(x,{pickedCount:null})
  x.time+=180*60_000
  const result=await x.planner.tick({force:true})
  assert.equal(result.result,'shadow-would-explore')
  assert.equal(x.videoLaunches,0)
  assert.match(x.prompts[0],/"pickedCount":null/)
  assert.equal(x.events.status().timeline[0].videoRoundFeedbackOffered,true)
}))

test('feedback projection rejects fake fields, stale/future events and mistaken sensory claims',()=>{
  const t=START,base={source:'life-agent',state:'completed',endedAt:t-1000,pickedCount:1,
    bvid:'BV1LEAK00000',uid:'123456',cookie:'secret',title:'private'}
  const rows=[base,{...base,source:'rogue'}, {...base,endedAt:t+1000},
    {...base,endedAt:t-49*3600_000}, {...base,state:'started'},
    {...base,state:'failed',pickedCount:50}, {...base,source:'manual',state:'interrupted',pickedCount:7}]
  const result=projectVideoRoundFeedback(rows,{at:t})
  assert.equal(result.length,3)
  assert.ok(result.some(r=>r.outcome==='process-exited-zero'&&r.pickedCount===1))
  assert.ok(result.filter(r=>r.outcome!=='process-exited-zero').every(r=>r.pickedCount===null))
  const json=JSON.stringify(result)
  assert.doesNotMatch(json,/LEAK|uid|cookie|secret|private|title/i)
  assert.ok(result.every(r=>r.proof.includes('not-video-viewed')))
  assert.deepEqual(projectVideoRoundFeedback([{...base,state:'unverified-interruption'}],{at:t}),[])
})

test('account switch revokes old video wake and cannot expose earlier round in next account prompt',()=>isolated(async dir=>{
  const x=scenario(dir)
  completedRound(x)
  x.tag=B
  assert.equal(x.events.status().pendingVideoFollowup,0)
  x.events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'new-account'})
  const result=await x.planner.tick({force:true})
  assert.equal(result.result,'voluntary-rest')
  assert.ok(x.prompts[0].includes('"recentVideoRoundFeedback":[]'))
  assert.equal(x.events.status().timeline[0].videoRoundFeedbackOffered,false)
  x.tag=A
  assert.equal(x.events.status().pendingVideoFollowup,1)
}))

test('production and UI reference the existing account-scoped lifecycle and never open a social send path',()=>{
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const planner=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
  const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(source,/getLifeEventStatus:\(\)=>lifeAgentEvents.status\(\)/)
  assert.match(planner,/projectVideoRoundFeedback\(budget\?\.recentVideoRounds/)
  assert.match(planner,/settleLifeEvents\(others.map\(e=>e.id\),'considered'\)/)
  assert.match(ui,/videoFeedbackNote/)
  assert.match(ui,/videoRoundFeedbackOffered/)
  assert.doesNotMatch(planner,/sendBiliDm|bili_send_comment|autoFollowUser/)
})

test('completed-round signals outrank periodic quiet events, without displacing manual/social signals',()=>isolated(dir=>{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>START})
  for(let i=0;i<5;i++)events.offer({kind:'quiet-window',platform:'life',sourceKey:'quiet-'+i})
  events.offer({kind:'video-round-ended',platform:'bilibili',sourceKey:'round-1'})
  assert.equal(events.peek(2)[0].kind,'video-round-ended')
  events.offer({kind:'exploration-ready',platform:'life',sourceKey:'exploration-1'})
  events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'social-1'})
  events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'manual-1'})
  assert.deepEqual(events.peek(4).map(e=>e.kind),['manual-wake','dm-received','exploration-ready','video-round-ended'])
}))

test('true video round end uses stable random round receipt for an account-specific wake, not launch timestamp',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(index,/lifeAgentEvents\.offer\(\{kind:'video-round-ended',platform:'bilibili',sourceKey:videoRoundReceiptId\}\)/)
  assert.doesNotMatch(index,/const videoRoundLifeEventKey=String\(Date\.now\(\)\)/)
})

test('read-only status estimates earliest followup without granting capability, quota or model decision',async()=>{
  const {lifeExperienceReadiness}=await import('../lib/life-experience-readiness.mjs')
  const config={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:10}
  const ev={ok:true,pending:1,pendingSocial:0,pendingVideoFollowup:1,videoStartsToday:1,lastVideoAt:START}
  let state=lifeExperienceReadiness({config,planner:{runs:1},events:ev,at:START+60_000,capabilities:[{id:'bilibili.video-explore'}]})
  assert.equal(state.pendingVideoFollowup,1)
  assert.equal(state.videoDelegationEligible,false)
  assert.equal(state.videoFeedbackEarliestAt,START+180*60_000)
  assert.equal(lifeExperienceReadiness({config,planner:{runs:1},events:{...ev,pendingVideoFollowup:0},at:START+60_000}).videoFeedbackEarliestAt,null)
  state=lifeExperienceReadiness({config,planner:{runs:1},events:{...ev,videoStartsToday:2},at:START+60_000,capabilityReadiness:{blocked:[{id:'bilibili.video-explore',platform:'bilibili',reason:'daily-video-quota'}]}})
  assert.ok(state.videoFeedbackEarliestAt>START+60_000)
  assert.equal(lifeExperienceReadiness({config:{...config,lifeAgentMode:'off'},planner:{runs:1},events:ev,at:START+60_000}).videoFeedbackEarliestAt,null)
})

test('manual wake during cooldown may be settled without discarding original video completion signal',()=>isolated(async dir=>{
  const x=scenario(dir)
  completedRound(x)
  x.events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'manual-videogate'})
  assert.equal((await x.planner.tick({force:true})).skipped,'video-feedback-waiting')
  const rows=x.events.status().recent
  assert.equal(rows.find(e=>e.kind==='manual-wake')?.state,'considered')
  assert.equal(rows.find(e=>e.kind==='video-round-ended')?.state,'pending')
}))

test('busy video child preserves previous round feedback without burning model quota; free child can proceed',()=>isolated(async dir=>{
  const x=scenario(dir,{availability:{available:false,reason:'video-busy'}})
  completedRound(x)
  x.time+=180*60_000
  const skipped=await x.planner.tick({force:true})
  assert.equal(skipped.skipped,'video-feedback-waiting')
  assert.equal(skipped.diagnosticCode,'video-agent-busy')
  assert.equal(x.modelCalls,0)
  assert.equal(x.events.status().pendingVideoFollowup,1)
  x.capabilityState.available=true
  const resumed=await x.planner.tick({force:true})
  assert.equal(resumed.result,'voluntary-rest')
  assert.equal(x.modelCalls,1)
  assert.equal(x.events.status().pendingVideoFollowup,0)
}))

test('capability inspection only exposes allowlisted reasons and keeps execution permission separate',async()=>{
  const {createLifeCapabilities}=await import('../lib/life-capabilities.mjs')
  let available={ok:false,reason:'secret account uid 123, cookie=abc'}
  let calls=0
  const reg=createLifeCapabilities([{id:'bilibili.video-explore',risk:'delegated-existing-permissions',
    available:()=>available,execute:()=>{calls++;return {started:true}}}])
  assert.deepEqual(reg.list(),[])
  assert.deepEqual(reg.inspect().blocked,[{id:'bilibili.video-explore',platform:'bilibili',reason:'adapter-unavailable'}])
  assert.equal(reg.run('bilibili.video-explore').started,false)
  assert.equal(calls,0)
  available={ok:false,reason:'video-busy'}
  assert.equal(reg.inspect().blocked[0].reason,'video-busy')
  available={ok:true}
  assert.equal(reg.list().length,1)
  assert.equal(reg.run('bilibili.video-explore').started,true)
  assert.equal(calls,1)
  assert.doesNotMatch(JSON.stringify(reg.inspect()),/cookie|uid 123|abc/)
})

test('a zero exit alone cannot issue a life wake when persisted completion receipt failed',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(index,/let verifiedVideoRoundCompletion=false/)
  assert.match(index,/verifiedVideoRoundCompletion=completed\?\.ok===true&&completed\?\.updated===true&&completed\?\.state==='completed'/)
  assert.match(index,/if\(code===0&&verifiedVideoRoundCompletion&&videoRoundReceiptId&&lifeAgentEvents/)
  assert.doesNotMatch(index,/if\(code===0&&videoRoundReceiptId&&lifeAgentEvents/)
})

test('followup timestamp never advertises a time earlier than BOTH daily gate and launch cooldown',async()=>{
  const {lifeExperienceReadiness}=await import('../lib/life-experience-readiness.mjs')
  const t=Date.parse('2026-11-06T23:50:00Z')
  const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:10}
  const event={ok:true,pending:1,pendingVideoFollowup:1,videoStartsToday:2,lastVideoAt:t}
  const inspected=lifeExperienceReadiness({config:cfg,planner:{runs:2},events:event,
    capabilities:[{id:'bilibili.video-explore'}],at:t})
  assert.ok(inspected.videoFeedbackEarliestAt>=t+180*60_000)
  const exhausted=lifeExperienceReadiness({config:cfg,planner:{runs:10},events:{...event,videoStartsToday:0,lastVideoAt:0},
    capabilities:[{id:'bilibili.video-explore'}],at:t})
  assert.ok(exhausted.videoFeedbackEarliestAt>t)
  const busy=lifeExperienceReadiness({config:cfg,planner:{runs:2},events:{...event,videoStartsToday:0,lastVideoAt:0},
    capabilities:[],capabilityReadiness:{blocked:[{id:'bilibili.video-explore',platform:'bilibili',reason:'video-busy'}]},at:t})
  assert.equal(busy.videoFeedbackEarliestAt,null)
  assert.ok(busy.blockers.includes('video-agent-busy'))
})
