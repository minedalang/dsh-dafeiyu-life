import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
const ACCOUNT='a'.repeat(16)
const start=Date.parse('2026-11-05T12:00:00Z')
const home=async run=>{const dir=mkdtempSync(join(tmpdir(),'life-wake-hotfix-'));try{return await run(dir)}finally{rmSync(dir,{force:true,recursive:true})}}
function rig(dir,{mode='shadow',getEvents,model}={}){
  let t=start,calls=0,launches=0
  const config={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:mode,
    autonomousPlannerDailyLimit:12,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>ACCOUNT,now:()=>t})
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>t,getConfig:()=>config,getTodos:()=>[],
    getLifeAccountTag:()=>ACCOUNT,getLifeEvents:getEvents||(()=>events.peek()),
    getLifeEventStatus:()=>events.status(),offerLifeWake:e=>events.offer(e),
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:e=>events.recordDecision(e),
    getLifeCapabilities:()=>[{id:'mocksite.video-explore',risk:'read'}],
    runLifeCapability:()=>{launches++;return {started:true}},recordVideoStart:()=>events.recordVideoStart(),
    getLifeIntentionCues:()=>[{id:'interest-1',source:'interest-milestone',topic:'游戏配乐',stage:'recent'}],
    invokeModel:async prompt=>{calls++;return model?model(prompt):JSON.stringify({action:'skip',reason:'今天想休息'})},
    executeRead:async()=>({ok:true}),updateTodo:()=>{},reflect:async()=>({ok:true})})
  return {events,planner,config,advance:ms=>{t+=ms},get calls(){return calls},get launches(){return launches}}
}
test('manual force bypasses six-hour cue-only automatic throttle, without bypassing quota',()=>home(async dir=>{
  const r=rig(dir,{mode:'off'})
  assert.equal((await r.planner.tick({force:true})).action,'skip')
  r.advance(10*60_000)
  const automatic=await r.planner.tick()
  assert.equal(automatic.skipped,'life-exploration-cooldown')
  assert.equal(automatic.nextAt,start+6*3600_000)
  const manual=await r.planner.tick({force:true})
  assert.equal(manual.action,'skip')
  assert.equal(r.calls,2)
  assert.equal(r.launches,0)
  r.config.autonomousPlannerDailyLimit=2
  assert.equal((await r.planner.tick({force:true})).skipped,'quota')
}))
test('an explicit wake is not buried under 31 pending genuine events and repeated clicks do not accumulate',()=>home(async dir=>{
  const r=rig(dir)
  for(let i=0;i<31;i++)r.events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'verified-'+i})
  const first=r.events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'click-1'})
  const current=r.events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'click-2'})
  assert.notEqual(first.id,current.id)
  assert.equal(r.events.status().pending,32,'31 incoming genuine events + exactly 1 pending manual event')
  assert.equal(r.events.status().pendingSocial,31)
  const picked=r.events.peek()
  assert.equal(picked[0].id,current.id,'manual event must reach the bounded model view')
  assert.equal(picked.length,4)
  assert.equal(picked.filter(x=>x.kind==='comment-received').length,3)
  assert.equal((await r.planner.tick({force:true})).action,'skip')
  assert.equal(r.calls,1)
  assert.equal(r.launches,0,'shadow must never launch a video or write externally')
  assert.equal(r.events.status().pendingSocial,28,'a real backlog remains and is not silently erased')
  assert.equal(r.events.status().timeline[0].kinds.includes('manual-wake'),true)
}))
test('a broken life-event inbox reports a diagnostic instead of a misleading exploration cooldown',()=>home(async dir=>{
  const r=rig(dir,{getEvents:()=>{throw Error('synthetic corrupt ledger')}})
  const res=await r.planner.tick({force:true})
  assert.equal(res.ok,false)
  assert.equal(res.diagnosticCode,'life-events-unavailable')
  assert.equal(r.calls,0)
  assert.equal(r.launches,0)
}))
test('manual deduplication preserves idempotent same source and never clears social events',()=>home(dir=>{
  const r=rig(dir)
  const social=r.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'verified-dm'})
  const manual=r.events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'click'})
  assert.equal(r.events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'click'}).created,false)
  assert.equal(r.events.status().pending,2)
  assert.equal(r.events.peek()[0].id,manual.id)
  assert.equal(r.events.peek()[1].id,social.id)
}))
