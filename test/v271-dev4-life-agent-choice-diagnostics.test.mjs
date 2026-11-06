import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {projectLifeSettings} from '../lib/life-settings-projection.mjs'
const ACCOUNT='c'.repeat(16)
const NOW=Date.parse('2026-11-05T16:00:00Z')
const inTemp=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-choice-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
function rig(dir,{response='{"action":"skip","reason":"我今天想安静一会"}',capabilities=true}={}){
 let calls=0,launches=0
 const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'shadow',
   autonomousPlannerMinutes:20,autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
 const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>ACCOUNT,now:()=>NOW})
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>NOW,getConfig:()=>cfg,getTodos:()=>[],
   getLifeAccountTag:()=>ACCOUNT,getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),
   offerLifeWake:x=>events.offer(x),settleLifeEvents:(ids,why)=>events.settle(ids,why),
   recordLifeDecision:x=>events.recordDecision(x),
   getLifeCapabilities:()=>capabilities?[{id:'mocksite.video-explore',risk:'read'}]:[],
   runLifeCapability:()=>{launches++;return {started:true}},recordVideoStart:()=>events.recordVideoStart(),
   invokeModel:async()=>{calls++;if(response instanceof Error)throw response;return response},
   executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
 const wake=()=>events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:String(events.status().recent.length)+':'+String(calls)})
 return {events,planner,cfg,wake,get calls(){return calls},get launches(){return launches}}
}
test('manual wake with video cooldown and no other choices reports no candidates, no model charge',()=>inTemp(async dir=>{
 const x=rig(dir)
 x.events.recordVideoStart();x.wake()
 const before=x.planner.status().runs
 const out=await x.planner.tick({force:true})
 assert.equal(out.result,'no-actionable-options')
 assert.equal(out.diagnosticCode,'video-launch-cooldown')
 assert.equal(out.modelCalled,false)
 assert.equal(x.calls,0);assert.equal(x.launches,0)
 assert.equal(x.planner.status().runs,before)
 assert.equal(x.events.status().timeline[0].result,'no-actionable-options')
 assert.equal(x.events.status().timeline[0].options.video,0)
 assert.equal(x.events.status().timeline[0].blocker,'video-launch-cooldown')
}))
test('no installed capability is explicit no-candidate, not fish resting',()=>inTemp(async dir=>{
 const x=rig(dir,{capabilities:false});x.wake()
 assert.equal((await x.planner.tick({force:true})).diagnosticCode,'video-capability-unavailable')
 assert.equal(x.calls,0)
}))
test('valid explicit skip with available choice is voluntary rest',()=>inTemp(async dir=>{
 const x=rig(dir);x.wake()
 const out=await x.planner.tick({force:true})
 assert.equal(out.result,'voluntary-rest');assert.equal(x.calls,1)
 assert.equal(x.events.status().timeline[0].result,'voluntary-rest')
 assert.equal(x.events.status().timeline[0].options.video,1)
 assert.equal(x.planner.status().runs,1);assert.equal(x.launches,0)
}))
test('unparseable and unauthorized output cannot masquerade as voluntary rest',()=>inTemp(async dir=>{
 const x=rig(dir,{response:'```json invalid ```'});x.wake()
 const first=await x.planner.tick({force:true})
 assert.equal(first.result,'invalid-decision');assert.equal(x.events.status().timeline[0].result,'invalid-decision')
 assert.equal(x.launches,0);assert.equal(x.events.status().pending,0)
}))
test('a JSON object without an action is invalid, never autonomous rest',()=>inTemp(async dir=>{
 const x=rig(dir,{response:'{}'});x.wake()
 assert.equal((await x.planner.tick({force:true})).result,'invalid-decision')
}))
test('model fault remains a failure and preserves pending event for later review',()=>inTemp(async dir=>{
 const x=rig(dir,{response:new Error('offline model failed')});x.wake()
 const out=await x.planner.tick({force:true})
 assert.equal(out.ok,false)
 assert.equal(out.result,'model-or-execution-error')
 assert.ok(x.events.status().recent.some(e=>e.kind==='manual-wake'&&e.state==='pending'))
 assert.equal(x.events.status().timeline[0].failed,true)
 assert.equal(x.launches,0)
}))
test('Phase 6 settings preview is read-only, no silent social permission escalation or legacy deletion',()=>{
 const original={masterEnabled:false,lifeAgentMode:'active',lifeAgentSocialContextOptIn:true,
   peakValley:true,autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:4}
 const frozen=structuredClone(original)
 const view=projectLifeSettings(original)
 assert.deepEqual(original,frozen)
 assert.equal(view.readOnly,true);assert.equal(view.migrationApplied,false)
 assert.equal(view.life.enabled,false)
 assert.equal(view.privacy.socialExcerptPreviewEnabled,false)
 assert.equal(view.privacy.socialReplyOwner,'legacy')
 assert.equal(view.privacy.outboundPermissionsUnchanged,true)
 assert.equal(view.budget.decisionsPerDay,4)
 assert.equal(projectLifeSettings({...original,masterEnabled:true,lifeAgentMode:'shadow'}).life.videoOwner,'life-agent')
})
