import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {LifeResourceAdmissionError} from '../lib/life-resource-scheduler.mjs'

const ACCOUNT='a'.repeat(16),NOW=Date.parse('2026-11-16T12:00:00Z')
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life339-resource-refund-'));try{await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const build=(dir,model)=>{
 const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>ACCOUNT,now:()=>NOW})
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>NOW,
  getLifeAccountTag:()=>ACCOUNT,getLifeEvents:()=>events.peek(4),
  offerLifeWake:x=>events.offer(x),settleLifeEvents:(ids,reason)=>events.settle(ids,reason),getLifeEventStatus:()=>events.status(),
  getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
  getTodos:()=>[],getLifeCapabilities:()=>[],invokeModel:model,executeRead:async()=>({ok:false}),updateTodo:async()=>{},reflect:async()=>({ok:false})})
 events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'opaque-social-event-1'})
 return {events,planner}
}
test('admission timeout before any model work neither charges Life quota nor poisons provider health',()=>withDir(async dir=>{
 const r=build(dir,async()=>{throw new LifeResourceAdmissionError('life-resource-wait-timeout')})
 const out=await r.planner.tick({force:true})
 assert.equal(out.ok,false)
 assert.equal(out.diagnosticCode,'life-resource-deferred')
 assert.equal(out.result,'resource-deferred')
 assert.equal(r.planner.status().runs,0)
 assert.equal(r.planner.status().modelFailureStreak,0)
 assert.equal(r.planner.status().modelRetryAt,0)
 assert.equal(r.events.status().pendingSocial,1,'same verified signal remains pending for later Life attention')
 const persisted=JSON.parse(readFileSync(join(dir,'autonomous-planner.json'),'utf8'))
 assert.equal(persisted.runs,0)
 assert.equal(persisted.modelFailureStreak,0)
}))
test('provider execution errors are not refunded as scheduler congestion',()=>withDir(async dir=>{
 const r=build(dir,async()=>{throw Error('actual provider failure')})
 const out=await r.planner.tick({force:true})
 assert.equal(out.ok,false)
 assert.equal(r.planner.status().runs,1)
 assert.equal(r.planner.status().modelFailureStreak,1)
 assert.ok(r.planner.status().modelRetryAt>NOW)
}))
