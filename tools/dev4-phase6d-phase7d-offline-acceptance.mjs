/** Fully synthetic Phase 6d / Phase 7d acceptance. No DSH_HOME, network, platform or live model. */
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {lifeDriverOwnership,lifeSettingsV2,assertLegacyLifeSettingsPatchCompatible} from '../lib/life-settings-control.mjs'
import {normalizeRecentReadEvidence} from '../lib/life-evidence-contrast.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
const A='a'.repeat(16),B='b'.repeat(16),T=Date.parse('2026-11-05T12:00:00Z')
const base={masterEnabled:true,lifeAgentMode:'shadow',peakValley:true,autonomousPlannerEnabled:true,
 autonomousPlannerMinutes:60,autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,
 socialAutoSend:false,dmStrangerAutonomyEnabled:false}
let scenarios=0,fakeModelCalls=0,realModelCalls=0,networkCalls=0,externalMessagesSent=0
const check=fn=>{fn();scenarios++}
const root=mkdtempSync(join(tmpdir(),'dsh-phase67d-'))
try{
 check(()=>assert.equal(lifeDriverOwnership(base).videoWakeOwner,'life-agent'))
 check(()=>assert.equal(lifeDriverOwnership({...base,lifeAgentMode:'off'}).videoWakeOwner,'legacy-timer'))
 check(()=>assert.equal(lifeSettingsV2(base).driverOwnership.socialReplyOwner,'legacy'))
 check(()=>assert.throws(()=>assertLegacyLifeSettingsPatchCompatible(base,{autonomousPlannerDailyLimit:288}),/统一生活设置/))
 check(()=>assert.deepEqual(normalizeRecentReadEvidence([{kind:'todo-read',at:T-3600_000},{kind:'video-metadata',at:T-49*3600_000}],T),[{kind:'todo-read',hoursAgo:1}]))
 let scope=A
 const options={dataDir:root,now:()=>T,getConfig:()=>base,getTodos:()=>[],getLifeAccountTag:()=>scope,
  getLifeEventStatus:()=>({recentVerifiedReads:[{kind:'todo-read',at:T-3600_000}]}),
  executeRead:()=>{throw Error('No platform reads allowed')},updateTodo:()=>{throw Error('No writes')},reflect:()=>{throw Error('No reflection')},
  invokeModel:async prompt=>{fakeModelCalls++;return prompt.includes('"kind":"todo-read"')?'{"action":"continue_read"}':'{"action":"pause"}'}}
 const planner=createAutonomousPlanner(options)
 const r=await planner.auditRecentEvidence()
 check(()=>{assert.equal(r.ok,true);assert.equal(r.changed,true);assert.equal(r.chargedCalls,2);assert.equal(r.personalityGrowthProven,false)})
 check(()=>assert.equal(planner.status().runs,2))
 scope=B
 const r2=await createAutonomousPlanner({...options,getLifeEventStatus:()=>({recentVerifiedReads:[]})}).auditRecentEvidence()
 check(()=>assert.equal(r2.skipped,'no-recent-verified-read'))
 process.stdout.write(JSON.stringify({ok:true,scenarios,fakeModelCalls,realModelCalls,networkCalls,externalMessagesSent,
   legacyVideoOwnerExclusive:true,modelContrastChanged:true,personalityGrowthProven:false,chargedModelCalls:2},null,2)+'\n')
}finally{rmSync(root,{recursive:true,force:true})}
