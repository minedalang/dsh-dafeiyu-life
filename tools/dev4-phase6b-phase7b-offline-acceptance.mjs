#!/usr/bin/env node
/** No credentials, network, platform write or real model access. Synthetic inputs only. */
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {legacyVideoTimerAllowed,assertLegacyVideoPatchCompatible,lifeSettingsV2,planLifeSettingsV2} from '../lib/life-settings-control.mjs'
import {projectLifeSettings} from '../lib/life-settings-projection.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
const now=Date.parse('2026-11-05T12:00:00Z'),tag='b'.repeat(16)
let fakeModelCalls=0,realModelCalls=0,networkCalls=0,externalMessagesSent=0,scenarios=0
const old={masterEnabled:true,lifeAgentMode:'off',peakValley:true,autonomousPlannerEnabled:true,
 autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:24,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,
 socialAutoSend:false,dmStrangerAutonomyEnabled:false}
const check=(name,fn)=>{fn();scenarios++}
check('old mode still honors explicit legacy schedule',()=>assert.equal(legacyVideoTimerAllowed(old),true))
check('shadow from an old saved config cannot execute the legacy timer',()=>{
 const c={...old,lifeAgentMode:'shadow'}
 assert.equal(legacyVideoTimerAllowed(c),false)
 assert.equal(projectLifeSettings(c).life.legacyTimerSuppressed,true)
 assert.equal(lifeSettingsV2(c).legacyVideoTimerEnabled,false)
})
check('old config editor cannot reenable competing timer',()=>{
 assert.throws(()=>assertLegacyVideoPatchCompatible({...old,lifeAgentMode:'shadow'},{peakValley:true}),/不能重新开启/)
})
check('unified settings previews without mutating or granting social authorization',()=>{
 const input={schemaVersion:2,revision:lifeSettingsV2(old).revision,mode:'active',pace:'natural',previewOnly:true}
 const result=planLifeSettingsV2(old,input)
 assert.equal(result.patch.peakValley,false)
 assert.equal(old.peakValley,true)
 assert.equal(Object.hasOwn(result.patch,'socialAutoSend'),false)
})
async function rankDemo({relationship=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'dsh-life-demo-'))
 try{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:()=>now})
  events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'synthetic'})
  const todos=[{id:'a',type:'check_notifications',status:'open',createdAt:now-3600000,origin:{uid:'100001'}},
   {id:'b',type:'check_notifications',status:'open',createdAt:now,origin:{uid:'100002'}}]
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>now,getLifeAccountTag:()=>tag,
   getConfig:()=>({...old,peakValley:false,lifeAgentMode:'shadow'}),getTodos:()=>todos,
   getRelationshipHint:uid=>relationship&&uid==='100002'?{score:95,stage:'friend'}:null,
   getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),recordLifeDecision:r=>events.recordDecision(r),
   invokeModel:async()=>{fakeModelCalls++;return '{"action":"skip","reason":"本轮先休息"}'},
   executeRead:async()=>{throw Error('unexpected external read')},updateTodo:async()=>{},reflect:async()=>({ok:true})})
  assert.equal((await planner.tick({force:true})).result,'voluntary-rest')
  const timeline=events.status().timeline[0],serialized=readFileSync(join(dir,'life-agent-events',tag+'.json'),'utf8')
  assert.doesNotMatch(serialized,/100001|100002/)
  return timeline
 }finally{rmSync(dir,{recursive:true,force:true})}
}
const noProof=await rankDemo({relationship:false})
assert.equal(noProof.relationshipRankShift,false);scenarios++
const withProof=await rankDemo({relationship:true})
assert.equal(withProof.relationshipRankShift,true);scenarios++
assert.equal(withProof.relationshipTaskDone,false)
assert.equal(withProof.sharedInterestRead,false)
console.log(JSON.stringify({ok:true,scenarios,fakeModelCalls,realModelCalls,networkCalls,externalMessagesSent,
 legacyShadowTimerSuppressed:true,relationshipOrderChangedWithEvidence:withProof.relationshipRankShift,
 personalityGrowthClaimed:false},null,2))
