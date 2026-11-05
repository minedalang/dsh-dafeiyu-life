import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {legacyVideoTimerAllowed,assertLegacyVideoPatchCompatible,lifeSettingsV2,planLifeSettingsV2} from '../lib/life-settings-control.mjs'
import {projectLifeSettings} from '../lib/life-settings-projection.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'

const now=Date.parse('2026-11-05T12:00:00Z'),tag='f'.repeat(16)
const base={masterEnabled:true,peakValley:true,lifeAgentMode:'off',autonomousPlannerEnabled:true,
 autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:24,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,
 socialAutoSend:false,dmStrangerAutonomyEnabled:false,lifeAgentSocialContextOptIn:false}

test('Phase 6b: old video timer is strictly limited to legacy mode, even for stale shadow config',()=>{
 for(const mode of ['shadow','active']){
  const cfg={...base,lifeAgentMode:mode}
  assert.equal(legacyVideoTimerAllowed(cfg),false)
  assert.equal(lifeSettingsV2(cfg).legacyVideoTimerEnabled,false)
  assert.equal(lifeSettingsV2(cfg).legacyVideoTimerSuppressed,true)
  assert.equal(projectLifeSettings(cfg).life.legacyVideoScheduleActive,false)
  assert.equal(projectLifeSettings(cfg).life.legacyTimerSuppressed,true)
 }
 assert.equal(legacyVideoTimerAllowed(base),true)
 assert.equal(legacyVideoTimerAllowed({...base,masterEnabled:false}),false)
 assert.equal(legacyVideoTimerAllowed({...base,peakValley:false}),false)
})
test('Phase 6b: legacy config writers cannot reenable the timer under shadow/active',()=>{
 for(const mode of ['shadow','active']){
  assert.throws(()=>assertLegacyVideoPatchCompatible({...base,lifeAgentMode:mode},{peakValley:true}),/不能重新开启/)
  assert.throws(()=>assertLegacyVideoPatchCompatible(base,{lifeAgentMode:mode,peakValley:true}),/不能重新开启/)
  assert.equal(assertLegacyVideoPatchCompatible({...base,lifeAgentMode:mode},{autonomousPlannerMinutes:30}),true)
 }
 assert.equal(assertLegacyVideoPatchCompatible(base,{peakValley:true}),true)
})
test('Phase 6b: mode change remains explicitly confirmed and permissions unchanged',()=>{
 const before=structuredClone(base),req={schemaVersion:2,revision:lifeSettingsV2(base).revision,mode:'shadow',pace:'quiet',previewOnly:true}
 const preview=planLifeSettingsV2(base,req)
 assert.equal(preview.patch.peakValley,false)
 assert.deepEqual(base,before)
 assert.deepEqual(preview.patch,planLifeSettingsV2(base,{...req,previewOnly:false,confirm:'APPLY_LIFE_SETTINGS_V2'}).patch)
 for(const field of ['socialAutoSend','dmStrangerAutonomyEnabled','lifeAgentSocialContextOptIn','masterEnabled']){
  assert.equal(Object.hasOwn(preview.patch,field),false)
 }
})
test('Phase 6b: production timer and generic save use the same helper',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(source,/if \(!legacyVideoTimerAllowed\(cfg\)\) return/)
 assert.match(source,/assertLegacyVideoPatchCompatible\(cfg,clean\)/)
})

async function simulateRelationshipRank({relationshipHint,friendId='friend-task'}={}){
 const dir=mkdtempSync(join(tmpdir(),'life-rank-diagnostic-'))
 try{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:()=>now})
  events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'fake-wake'})
  const ids=[{id:'other-task',type:'check_notifications',status:'open',createdAt:now-3600_000,origin:{uid:'1111111'}},
   {id:friendId,type:'check_notifications',status:'open',createdAt:now,origin:{uid:'2222222'}}]
  let modelCalls=0,prompt=''
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>now,getConfig:()=>({...base,peakValley:false,lifeAgentMode:'shadow'}),
   getTodos:()=>ids,getRelationshipHint:relationshipHint||(()=>null),getLifeAccountTag:()=>tag,
   getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),recordLifeDecision:r=>events.recordDecision(r),
   invokeModel:async p=>{prompt=p;modelCalls++;return '{"action":"skip","reason":"今天想休息"}'},
   executeRead:async()=>{throw Error('not expected')},updateTodo:async()=>{},reflect:async()=>({ok:true})})
  const outcome=await planner.tick({force:true})
  const entry=events.status().timeline[0]
  const file=readFileSync(join(dir,'life-agent-events',tag+'.json'),'utf8')
  return {outcome,entry,modelCalls,prompt,file}
 }finally{rmSync(dir,{recursive:true,force:true})}
}

test('Phase 7b: relationship evidence can change ranking but does not fabricate action or growth',async()=>{
 const demo=await simulateRelationshipRank({relationshipHint:uid=>uid==='2222222'?{score:100,stage:'friend'}:null})
 assert.equal(demo.outcome.result,'voluntary-rest')
 assert.equal(demo.entry.relationshipRankShift,true)
 assert.equal(demo.entry.relationshipTaskDone,false)
 assert.equal(demo.entry.sharedInterestRead,false)
 assert.equal(demo.modelCalls,1)
 assert.equal(JSON.parse(demo.prompt.split('\n').at(-1)).readOnlyTodos[0].id,'friend-task')
 assert.doesNotMatch(demo.file,/1111111|2222222|friend-task|other-task/)
})
test('Phase 7b: no relationship proof produces no counterfactual influence marker',async()=>{
 const demo=await simulateRelationshipRank({relationshipHint:()=>null})
 assert.equal(demo.entry.relationshipRankShift,false)
 assert.equal(JSON.parse(demo.prompt.split('\n').at(-1)).readOnlyTodos[0].id,'other-task')
})
test('Phase 7b: old journal entries without the marker remain readable',()=>{
 const dir=mkdtempSync(join(tmpdir(),'life-rank-legacy-'))
 try{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:()=>now})
  events.recordDecision({action:'skip',mode:'shadow',result:'voluntary-rest'})
  assert.equal(events.status().timeline[0].relationshipRankShift,false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
