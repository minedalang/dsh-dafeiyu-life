import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {lifeDriverOwnership,lifeSettingsV2} from '../lib/life-settings-control.mjs'
import {projectLifeSettings} from '../lib/life-settings-projection.mjs'
import {normalizeRecentReadEvidence,evidenceContrastPrompt,parseEvidenceContrastDecision} from '../lib/life-evidence-contrast.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
const A='a'.repeat(16),B='b'.repeat(16),T=Date.parse('2026-11-05T12:00:00Z')
const defaults={masterEnabled:true,lifeAgentMode:'shadow',peakValley:true,autonomousPlannerEnabled:true,
  autonomousPlannerMinutes:60,autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
const temp=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-contrast-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const setup=(dir,{cfg=()=>defaults,evidence=()=>[{kind:'todo-read',at:T-3_600_000}],scope=()=>A,invokeModel=async()=>'{"action":"pause"}',onRead=()=>{throw Error('Read must never execute')}}={})=>
 createAutonomousPlanner({dataDir:dir,getConfig:cfg,getLifeAccountTag:scope,getLifeEventStatus:()=>({recentVerifiedReads:evidence()}),
  getTodos:()=>[],invokeModel,executeRead:onRead,updateTodo:async()=>{throw Error('No write')},reflect:async()=>{throw Error('No reflection')}})
test('6d: actual video driver ownership is single and old flags do not grant extra owners',()=>{
 for(const mode of ['shadow','active']){
  const x=lifeDriverOwnership({...defaults,lifeAgentMode:mode})
  assert.equal(x.videoWakeOwner,'life-agent');assert.equal(x.legacyTimerMayRun,false)
  assert.equal(x.socialReplyOwner,'legacy')
  assert.equal(lifeSettingsV2({...defaults,lifeAgentMode:mode}).driverOwnership.videoWakeOwner,'life-agent')
  assert.equal(projectLifeSettings({...defaults,lifeAgentMode:mode}).driverOwnership.legacyTimerMayRun,false)
 }
 assert.equal(lifeDriverOwnership({...defaults,lifeAgentMode:'off'}).videoWakeOwner,'legacy-timer')
 assert.equal(lifeDriverOwnership({...defaults,autonomousPlannerEnabled:false}).videoWakeOwner,'none')
 assert.equal(lifeDriverOwnership({...defaults,masterEnabled:false}).videoWakeOwner,'none')
})
test('6d: old UI saves unrelated settings without competing managed fields in life mode',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const api=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(js,/delete oldSettingsPatch\[key\]/)
 assert.match(js,/await request\('\/config',oldSettingsPatch\)/)
 assert.match(api,/assertLegacyLifeSettingsPatchCompatible\(cfg,validatedPatch\)/)
})
test('7d: evidence filter is bounded, enum only, recent, and prompt contains no identity',()=>{
 const rows=[{kind:'video-metadata',at:T-3600_000},{kind:'unknown',at:T},
 {kind:'todo-read',at:T-49*3600_000},{kind:'public-evidence',at:T+2_000},
 {kind:'todo-read',at:T-2*3600_000}]
 const filtered=normalizeRecentReadEvidence(rows,T)
 assert.deepEqual(filtered,[{kind:'video-metadata',hoursAgo:1},{kind:'todo-read',hoursAgo:2}])
 const prompt=evidenceContrastPrompt(filtered)
 assert.match(prompt,/recentVerifiedReadEvidence/);assert.doesNotMatch(prompt,/uid|bvid|secret-123/i)
 assert.equal(parseEvidenceContrastDecision('{"action":"pause"}'),'pause')
 assert.equal(parseEvidenceContrastDecision('{"action":"send_private_message"}'),'invalid')
 assert.equal(parseEvidenceContrastDecision('hello'),'invalid')
})
test('7d: no receipt or quota does not invoke the model',async()=>temp(async dir=>{
 let calls=0;const invokeModel=async()=>{calls++;return '{"action":"pause"}'}
 const noReceipt=setup(dir,{invokeModel,evidence:()=>[]})
 assert.equal((await noReceipt.auditRecentEvidence()).skipped,'no-recent-verified-read')
 const noQuota=setup(dir,{invokeModel,cfg:()=>({...defaults,autonomousPlannerDailyLimit:1})})
 assert.equal((await noQuota.auditRecentEvidence()).skipped,'quota-two-calls')
 assert.equal(calls,0);assert.equal(noQuota.status().runs,0)
}))
test('7d: deliberate two-call contrast never executes any action or sends',async()=>temp(async dir=>{
 const prompts=[];const p=setup(dir,{invokeModel:async prompt=>{prompts.push(prompt);return prompts.length===1?'{"action":"pause"}':'{"action":"continue_read"}'}})
 const outcome=await p.auditRecentEvidence()
 assert.equal(outcome.ok,true);assert.equal(outcome.changed,true)
 assert.equal(outcome.chargedCalls,2);assert.equal(outcome.outboundMessages,0);assert.equal(outcome.executedActions,0)
 assert.equal(p.status().runs,2);assert.equal(prompts.length,2)
 assert.match(prompts[1],/todo-read/);assert.doesNotMatch(prompts[0],/todo-read/)
 const saved=readFileSync(join(dir,'autonomous-planner.json'),'utf8')
 assert.doesNotMatch(saved,/todo-read|secret|continue_read|pause/)
}))
test('7d: invalid model output is not misreported as growth or change',async()=>temp(async dir=>{
 const p=setup(dir,{invokeModel:async()=>'{"action":"send"}'})
 const r=await p.auditRecentEvidence()
 assert.equal(r.ok,true);assert.equal(r.validOutputs,false);assert.equal(r.diagnostic,'invalid-output');assert.equal(r.changed,false)
 assert.equal(p.status().runs,2)
}))
test('7d: account change during first async call aborts before second and still charges budget',async()=>temp(async dir=>{
 let scope=A,calls=0
 const p=setup(dir,{scope:()=>scope,invokeModel:async()=>{calls++;scope=B;return '{"action":"pause"}'}})
 const r=await p.auditRecentEvidence()
 assert.equal(r.skipped,'authorization-changed');assert.equal(r.chargedCalls,2)
 assert.equal(calls,1);assert.equal(p.status().runs,2)
 assert.equal(p.status().recent.some(x=>x.action==='evidence_contrast'),false)
}))
test('7d: changed authorization or model exception fails closed without tools',async()=>temp(async dir=>{
 let cfg={...defaults};let calls=0
 const p=setup(dir,{cfg:()=>cfg,invokeModel:async()=>{calls++;cfg={...cfg,lifeAgentMode:'off'};return '{"action":"pause"}'}})
 assert.equal((await p.auditRecentEvidence()).skipped,'authorization-changed')
 assert.equal(calls,1)
 const p2=setup(dir,{invokeModel:async()=>{throw Error('test exception')}})
 assert.equal((await p2.auditRecentEvidence()).skipped,'model-error')
}))
