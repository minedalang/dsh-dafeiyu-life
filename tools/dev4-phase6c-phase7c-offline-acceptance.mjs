/** Pure synthetic Phase 6c/7c acceptance. No DSH home, network or model. */
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {assertLegacyLifeSettingsPatchCompatible,lifeSettingsV2,planLifeSettingsV2} from '../lib/life-settings-control.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
const TAG='a'.repeat(16),OTHER='b'.repeat(16),T=Date.parse('2026-11-05T12:00:00Z')
const cfg={masterEnabled:true,lifeAgentMode:'shadow',peakValley:false,autonomousPlannerEnabled:true,
  autonomousPlannerMinutes:60,autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,
  socialAutoSend:false,dmStrangerAutonomyEnabled:false}
let scenarios=0,fakeModelCalls=0,realModelCalls=0,networkCalls=0,externalMessagesSent=0
function scene(fn){fn();scenarios++}
const folder=mkdtempSync(join(tmpdir(),'dsh-phase67c-'))
try{
  scene(()=>assert.throws(()=>assertLegacyLifeSettingsPatchCompatible(cfg,{lifeAgentMode:'active'})))
  scene(()=>assert.throws(()=>assertLegacyLifeSettingsPatchCompatible(cfg,{autonomousPlannerDailyLimit:288})))
  scene(()=>assert.equal(assertLegacyLifeSettingsPatchCompatible(cfg,{autonomousPlannerDailyLimit:12,ownerTodoReviewMinutes:45}),true))
  scene(()=>{
    const r=planLifeSettingsV2(cfg,{schemaVersion:2,revision:lifeSettingsV2(cfg).revision,mode:'active',pace:'quiet',previewOnly:true})
    assert.equal(r.patch.autonomousPlannerDailyLimit,4)
    assert.equal(Object.hasOwn(r.patch,'socialAutoSend'),false)
  })
  let time=T,scope=TAG
  const journal=createLifeAgentEvents({stateDir:folder,getAccountTag:()=>scope,now:()=>time})
  const tasks=[{id:'alpha',type:'check_notifications',status:'open',createdAt:T-200_000},
    {id:'beta',type:'check_notifications',status:'open',createdAt:T-100_000}]
  const seen=[]
  const planner=createAutonomousPlanner({dataDir:folder,now:()=>time,getConfig:()=>cfg,getTodos:()=>tasks.filter(t=>t.status==='open'),
    getAcceptedActionReservations:()=>[],getLifeAccountTag:()=>scope,getLifeEvents:()=>journal.peek(),
    getLifeEventStatus:()=>journal.status(),recordLifeDecision:x=>journal.recordDecision(x),
    offerLifeWake:x=>journal.offer(x),settleLifeEvents:(...x)=>journal.settle(...x),
    invokeModel:async p=>{fakeModelCalls++;const data=JSON.parse(p.split('\n').at(-1));seen.push(data.recentVerifiedReadEvidence);return fakeModelCalls===1?'{"action":"execute_read","id":"alpha"}':'{"action":"skip"}'},
    executeRead:async id=>{assert.equal(id,'alpha');tasks[0].status='done';return {ok:true}},
    updateTodo:async()=>{},reflect:async()=>({ok:false})})
  journal.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'first'})
  const first=await planner.tick({force:true})
  scene(()=>{assert.equal(first.result,'done');assert.deepEqual(seen[0],[]);assert.equal(journal.status().recentVerifiedReads[0].kind,'todo-read')})
  time+=3600_000;journal.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'second'})
  const second=await planner.tick({force:true})
  scene(()=>{assert.equal(second.result,'voluntary-rest');assert.deepEqual(seen[1],[{kind:'todo-read',hoursAgo:1}]);assert.equal(journal.status().timeline[0].priorVerifiedReadReferenced,true)})
  scope=OTHER
  scene(()=>assert.deepEqual(journal.status().recentVerifiedReads,[]))
  time+=49*3600_000;scope=TAG
  scene(()=>assert.deepEqual(journal.status().recentVerifiedReads,[]))
  process.stdout.write(JSON.stringify({ok:true,scenarios,fakeModelCalls,realModelCalls,networkCalls,externalMessagesSent,
    legacyManagedControlsProtected:true,priorVerifiedReadReferenced:true,accountIsolation:true,expiredEvidenceExcluded:true,
    personalityGrowthClaimed:false},null,2)+'\n')
}finally{rmSync(folder,{recursive:true,force:true})}
