import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {lifeTransitionReadiness} from '../lib/life-transition-readiness.mjs'

const A='a'.repeat(16),B='b'.repeat(16),T=Date.parse('2026-11-05T12:00:00Z')
const inHome=async fn=>{
  const dir=mkdtempSync(join(tmpdir(),'life-fairness-'))
  try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}
}
function fixture(dir,{model=()=>'{"action":"skip"}',todos=()=>[],read=async()=>({ok:true})}={}){
  let at=T,account=A,calls=0
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>account,now:()=>at})
  const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
    autonomousPlannerMinutes:5,autonomousPlannerDailyLimit:24,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>at,getConfig:()=>cfg,getTodos:todos,
    getLifeAccountTag:()=>account,getLifeEvents:()=>events.peek(4),recordLifeDecision:x=>events.recordDecision(x),
    offerLifeWake:x=>events.offer(x),settleLifeEvents:(ids,why)=>events.settle(ids,why),
    getLifeEventStatus:()=>({...events.status(),videoStartsToday:2,lastVideoAt:at}),
    getLifeCapabilities:()=>[],invokeModel:async p=>{calls++;return await model(p)},
    executeRead:read,updateTodo:async()=>({ok:true}),reflect:async()=>({ok:true})})
  return {events,planner,get calls(){return calls},advance:ms=>{at+=ms},account:a=>{account=a}}
}

test('choosing one verified DM signal preserves an unrelated comment for a later bounded choice',()=>inHome(async dir=>{
  const x=fixture(dir,{model:p=>{
    const e=JSON.parse(p.split('\n').at(-1)).lifeCapabilityOpportunities.events
    return JSON.stringify({action:'consider_social',id:e.find(x=>x.kind==='dm-received')?.id||e[0].id})
  }})
  const dm=x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'private-person-765:msg-abc'})
  const comment=x.events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'public-person-123:comment-xyz'})
  assert.equal((await x.planner.tick({force:true})).result,'social-signal-considered')
  let status=x.events.status()
  assert.equal(status.considered,1)
  assert.equal(status.retryable,1)
  assert.equal(status.pendingSocial,0,'not selected is not due immediately')
  assert.equal(status.unselectedWaiting,1)
  assert.equal(status.timeline[0].selectedSocialKind,'dm-received')
  assert.equal(status.timeline[0].notSelectedWaiting,1)
  assert.equal(status.timeline[0].reviewEvents,0)
  assert.equal(status.recent.find(e=>e.kind==='comment-received').result,'not-selected-this-turn')
  assert.equal(status.recent.find(e=>e.kind==='comment-received').passovers,1)
  assert.equal(status.recent.find(e=>e.kind==='comment-received').retryAt,T+30*60_000)
  assert.equal(x.events.peek().length,0)
  x.advance(30*60_000)
  assert.deepEqual(x.events.peek().map(e=>e.id),[comment.id])
  await x.planner.tick({force:true})
  status=x.events.status()
  assert.equal(status.considered,2)
  assert.equal(status.unselectedWaiting,0)
  assert.equal(status.pendingSocial,0)
  assert.equal(x.calls,2)
  assert.equal(x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'private-person-765:msg-abc'}).created,false)
  assert.doesNotMatch(readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8'),/private-person-765|public-person-123|comment-xyz/)
  assert.equal(dm.ok,true)
}))

test('a valid choice about an accepted TODO does not consume unrelated social signals',()=>inHome(async dir=>{
  const id='123e4567-e89b-12d3-a456-426614174000'
  const task={id,type:'inspect_my_space',status:'open',source:'owner',title:'查询当前公开页面'}
  const x=fixture(dir,{todos:()=>[task],model:()=>JSON.stringify({action:'execute_read',id})})
  x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'conversation-123'})
  x.events.offer({kind:'manual-wake',platform:'life',sourceKey:'manual-click-1'})
  const res=await x.planner.tick({force:true})
  assert.equal(res.result,'done')
  const st=x.events.status()
  assert.equal(st.considered,2,'manual request and exact TODO cue are acknowledged')
  assert.equal(st.recent.find(e=>e.kind==='todo-ready').state,'considered')
  assert.equal(st.retryable,2,'unrelated DM and verified-read followup are both preserved, not silently considered')
  assert.equal(st.recent.find(e=>e.kind==='experience-ready').state,'retryable')
  assert.equal(st.recent.find(e=>e.kind==='dm-received').result,'not-selected-this-turn')
  assert.equal(st.recent.find(e=>e.kind==='manual-wake').result,'considered')
  assert.equal(st.timeline[0].selectedSocialKind,'')
  assert.equal(st.timeline[0].notSelectedWaiting,1)
  assert.equal(x.planner.status().runs,1)
}))

test('three valid rounds without selection give a bounded terminal not-selected reason, not model failure',()=>inHome(async dir=>{
  const x=fixture(dir)
  const row=x.events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'rounds-3'})
  for(const [i,delay] of [30*60_000,2*60*60_000,6*60*60_000].entries()){
    assert.equal(x.events.settle([row.id],'not-selected').updated,1)
    const st=x.events.status(),item=st.recent[0]
    assert.equal(item.failures,0)
    assert.equal(item.passovers,i+1)
    if(i<2){assert.equal(item.state,'retryable');assert.equal(item.retryAt,T+([0,30*60_000][i])+delay)}
    else{assert.equal(item.state,'considered');assert.equal(item.result,'unselected-after-three-turns');assert.equal(st.unselectedWaiting,0)}
    x.advance(delay)
  }
  assert.equal(x.events.peek().length,0)
  assert.equal(x.events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'rounds-3'}).created,false)
}))

test('unknown existing TODO execution freezes only its manual trigger; unrelated DM is not mistaken for the failed tool',()=>inHome(async dir=>{
  const id='123e4567-e89b-12d3-a456-426614174000'
  const todo={id,type:'inspect_my_space',status:'open',source:'owner',title:'核实公开空间'}
  const x=fixture(dir,{todos:()=>[todo],model:()=>JSON.stringify({action:'execute_read',id}),
    read:async()=>{throw Error('tool result unknown: private payload must not persist')}})
  x.events.offer({kind:'manual-wake',platform:'life',sourceKey:'manual-unknown-read'})
  x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'independent-private-dm'})
  const result=await x.planner.tick({force:true})
  assert.equal(result.ok,false)
  assert.equal(result.diagnosticCode,'action-outcome-unknown')
  const st=x.events.status()
  assert.equal(st.needsReview,1)
  assert.equal(st.retryable,2,'unselected DM and independent TODO cue wait for later consideration')
  assert.equal(st.recent.find(e=>e.kind==='manual-wake').state,'review')
  assert.equal(st.recent.find(e=>e.kind==='dm-received').result,'not-selected-this-turn')
  assert.equal(st.timeline[0].reviewEvents,1)
  assert.equal(st.timeline[0].notSelectedWaiting,2)
  assert.doesNotMatch(readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8'),/private payload|independent-private-dm/)
}))

test('model failures still retry under technical-failure counter, without becoming voluntary nonselection',()=>inHome(async dir=>{
  const x=fixture(dir,{model:()=>'{invalid!'})
  x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'bad-model-response'})
  assert.equal((await x.planner.tick({force:true})).ok,false)
  const row=x.events.status().recent[0]
  assert.equal(row.state,'retryable')
  assert.equal(row.result,'invalid-model-output')
  assert.equal(row.failures,1)
  assert.equal(row.passovers,0)
}))

test('a model choosing rest explicitly acknowledges offered events; no forced social followup',()=>inHome(async dir=>{
  const x=fixture(dir)
  x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'chooses-rest'})
  assert.equal((await x.planner.tick({force:true})).result,'voluntary-rest')
  assert.equal(x.events.status().retryable,0)
  assert.equal(x.events.status().considered,1)
}))

test('unselected event account scopes, legacy v1 schema and v1 source dedup remain intact',()=>inHome(dir=>{
  const x=fixture(dir)
  const event=x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'account-a-private'})
  x.events.settle([event.id],'not-selected')
  x.account(B)
  assert.equal(x.events.status().unselectedWaiting,0)
  assert.equal(x.events.peek().length,0)
  x.events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'account-b'})
  assert.equal(x.events.status().pending,1)
  x.account(A)
  assert.equal(x.events.status().unselectedWaiting,1)
  assert.equal(JSON.parse(readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8')).version,1)
}))

test('shadow evidence is diagnostic only; both-channel sampling cannot grant handoff or release',()=>{
  const args={config:{masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active'},accountReady:true,
    planner:{lifeEvents:{ok:true}},handoff:{ok:true,accountReady:true,channels:{dm:{},comment:{}}},
    transactions:{ok:true,accountReady:true,channels:{dm:{},comment:{}}}}
  const noSamples=lifeTransitionReadiness(args)
  assert.equal(noSamples.status.socialShadow.diagnostic,'not-observed')
  assert.equal(noSamples.checks.find(x=>x.id==='social-shadow-sampling').status,'passed') // diagnostic shadow comparison retired, never release proof
  const s={enabled:true,mode:'read-only-shadow',byChannel:{
    dm:{paired:7,agreed:6,disagreed:1},comment:{paired:6,agreed:5,disagreed:1}}}
  const x=lifeTransitionReadiness({...args,shadow:s})
  assert.equal(x.status.socialShadow.diagnostic,'short-window-observed')
  assert.equal(x.status.socialShadow.productionHandoffProof,false)
  assert.equal(x.releaseReady,false)
  assert.equal(x.status.oldSocialOwner,true)
  assert.equal(x.checks.find(c=>c.id==='social-shadow-sampling').status,'passed') // retired second-opinion shadow must never become a production release vote
  const high=lifeTransitionReadiness({...args,shadow:{...s,byChannel:{...s.byChannel,dm:{paired:7,agreed:2,disagreed:5}}}})
  assert.equal(high.status.socialShadow.diagnostic,'high-disagreement')
  const incomplete=lifeTransitionReadiness({...args,shadow:{...s,byChannel:{...s.byChannel,comment:{paired:0}}}})
  assert.equal(incomplete.status.socialShadow.diagnostic,'insufficient-samples')
  const accountMissing=lifeTransitionReadiness({...args,accountReady:false,shadow:s})
  assert.equal(accountMissing.status.socialShadow.diagnostic,'not-observed')
  assert.equal(accountMissing.status.socialShadow.paired,0)
  assert.doesNotMatch(JSON.stringify(x),/private.*123456|senderUid|platformReceipt/)
})
