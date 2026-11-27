import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {lifeSettingsV2,planLifeSettingsV2} from '../lib/life-settings-control.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'

const seed=()=>({masterEnabled:true,lifeAgentMode:'off',peakValley:true,autonomousPlannerEnabled:false,
  autonomousPlannerMinutes:90,autonomousPlannerDailyLimit:6,autonomousPlannerStartHour:9,autonomousPlannerEndHour:23,
  dmStrangerAutonomyEnabled:false,socialAutoSend:false,lifeAgentSocialContextOptIn:false,perDay:9})
const request=(c,mode='shadow',pace='natural',extra={})=>({schemaVersion:2,revision:lifeSettingsV2(c).revision,mode,pace,...extra})

test('Phase 6 V2 projects old config without mutating or silently migrating it',()=>{
 const old=seed(),before=structuredClone(old)
 const result=lifeSettingsV2(old)
 assert.equal(result.schemaVersion,2);assert.equal(result.mode,'off');assert.equal(result.pace,'custom')
 assert.equal(result.socialReplyOwner,'life-agent');assert.deepEqual(old,before)
 assert.equal(result.budget.startHour,9);assert.equal(result.legacyVideoTimerEnabled,false)
})
test('preview and save use the same changes, no second authority or social permission',()=>{
 const old=seed(),before=structuredClone(old)
 const preview=planLifeSettingsV2(old,request(old,'active','natural',{previewOnly:true}))
 assert.equal(preview.preview,true);assert.deepEqual(old,before)
 const applied=planLifeSettingsV2(old,request(old,'active','natural',{confirm:'APPLY_LIFE_SETTINGS_V2'}))
 assert.deepEqual(applied.patch,preview.patch)
 assert.deepEqual(applied.patch,{lifeAgentMode:'active',peakValley:false,autonomousPlannerEnabled:true,
  autonomousPlannerMinutes:20,autonomousPlannerDailyLimit:150,videoAgentMinIntervalMinutes:30,
  videoAgentReadTargetPerRound:5,videoAgentPickTargetPerRound:5})
 for(const k of ['masterEnabled','perDay','autonomousPlannerStartHour','autonomousPlannerEndHour','dmStrangerAutonomyEnabled','socialAutoSend','lifeAgentSocialContextOptIn'])
   assert.equal(Object.hasOwn(applied.patch,k),false,k)
 const merged={...old,...applied.patch};assert.equal(lifeSettingsV2(merged).mode,'active')
 assert.equal(lifeSettingsV2(merged).legacyVideoTimerEnabled,false)
})
test('shadow also disables legacy video scheduling without granting outbound',()=>{
 const cfg=seed(),patch=planLifeSettingsV2(cfg,request(cfg,'shadow','quiet',{confirm:'APPLY_LIFE_SETTINGS_V2'})).patch
 assert.equal(patch.lifeAgentMode,'shadow');assert.equal(patch.peakValley,false)
 assert.equal(patch.autonomousPlannerDailyLimit,80)
 assert.equal(patch.videoAgentMinIntervalMinutes,60)
})
test('rejects malformed version, absent confirmation, stale config and unsupported presets',()=>{
 const old=seed(),req=request(old)
 assert.throws(()=>planLifeSettingsV2(old,req),/确认/)
 assert.throws(()=>planLifeSettingsV2(old,{...req,schemaVersion:999,confirm:'APPLY_LIFE_SETTINGS_V2'}),/版本/)
 assert.throws(()=>planLifeSettingsV2(old,{...req,pace:'infinite',confirm:'APPLY_LIFE_SETTINGS_V2'}),/活跃度/)
 assert.throws(()=>planLifeSettingsV2({...old,peakValley:false},{...req,confirm:'APPLY_LIFE_SETTINGS_V2'}),/变化/)
})
test('a paused master cannot be implicitly enabled, legacy rollback never reenables a timer',()=>{
 const old={...seed(),masterEnabled:false}
 assert.throws(()=>planLifeSettingsV2(old,request(old,'active','quiet',{confirm:'APPLY_LIFE_SETTINGS_V2'})),/总开关/)
 const active={...seed(),lifeAgentMode:'active',peakValley:false}
 const patch=planLifeSettingsV2(active,request(active,'legacy','custom',{confirm:'APPLY_LIFE_SETTINGS_V2'})).patch
 assert.deepEqual(patch,{lifeAgentMode:'off'});assert.equal(Object.hasOwn(patch,'peakValley'),false)
})
test('Phase 7a records bounded growth evidence candidates without sender UID or invented growth',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'life-growth-evidence-'));const tag='a'.repeat(16)
 const now=Date.parse('2026-11-05T12:00:00Z');let modelCalls=0
 try{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:()=>now})
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>now,
    getConfig:()=>({...seed(),autonomousPlannerEnabled:true,lifeAgentMode:'shadow',autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
    getTodos:()=>[{id:'test-task',type:'check_notifications',source:'friend',status:'open',origin:{uid:'345678901'},createdAt:now-86400000}],
    getRelationshipHint:()=>({score:80,stage:'friend'}),getLifeAccountTag:()=>tag,
    getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),recordLifeDecision:x=>events.recordDecision(x),
    invokeModel:async()=>{modelCalls++;return '{"action":"skip","reason":"不想处理"}'},
    executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
  const result=await planner.tick({force:true})
  assert.equal(result.result,'voluntary-rest');assert.equal(modelCalls,1)
  const recent=events.status().timeline[0]
  assert.equal(recent.options.relationship,1);assert.equal(recent.options.affinity,0)
  assert.equal(recent.action,'skip');assert.equal(recent.result,'voluntary-rest')
  assert.equal(readFileSync(join(dir,'life-agent-events',tag+'.json'),'utf8').includes('345678901'),false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('Phase 7a action result marker requires a verified read completion, not model intent alone',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'life-growth-action-')),tag='e'.repeat(16),now=Date.parse('2026-11-05T12:00:00Z')
 try{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:()=>now})
  let succeeds=false
  const make=()=>createAutonomousPlanner({dataDir:dir,now:()=>now,
    getConfig:()=>({...seed(),autonomousPlannerEnabled:true,lifeAgentMode:'shadow',autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
    getTodos:()=>[{id:'task-with-relationship',type:'check_notifications',status:'open',origin:{uid:'345678901'},createdAt:now-1000}],
    getRelationshipHint:()=>({score:80,stage:'friend'}),getLifeAccountTag:()=>tag,
    getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),recordLifeDecision:r=>events.recordDecision(r),
    invokeModel:async()=>'{"action":"execute_read","id":"task-with-relationship","reason":"看看新通知"}',
    executeRead:async()=>({ok:succeeds}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
  let out=await make().tick({force:true})
  assert.notEqual(out.result,'done')
  assert.equal(events.status().timeline[0].relationshipTaskDone,false)
  succeeds=true
  out=await make().tick({force:true})
  assert.equal(out.result,'done')
  assert.equal(events.status().timeline[0].relationshipTaskDone,true)
  assert.equal(events.status().timeline[0].sharedInterestRead,false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

import {runtimeControls,planRuntimeControl,isReplyDispatch} from '../lib/runtime-controls.mjs'
import {createSocialPolicyGate} from '../lib/social-policy-gate.mjs'
test('independent owner controls preserve schedule and grants; stale scope cannot write',()=>{
 const cfg={...seed(),dmWatch:true,dmOwnerUid:'123',commentWatchReplies:true};const scope='1:scope'
 const s=runtimeControls(cfg,scope,true);assert.equal(s.repliesEnabled,true);assert.equal(s.lifeEnabled,false)
 const life=planRuntimeControl(cfg,{control:'life',enabled:true,revision:s.revision},scope,true)
 assert.deepEqual(life,{lifeAgentMode:'active',autonomousPlannerEnabled:true,peakValley:false})
 const next={...cfg,...life};assert.equal(next.autonomousPlannerMinutes,90);assert.equal(next.dmStrangerAutonomyEnabled,false)
 const state=runtimeControls(next,scope,true),body={control:'replies',enabled:false,revision:state.revision}
 assert.throws(()=>planRuntimeControl(next,body,'2:scope',true),/状态已变化/)
 const paused={...next,...planRuntimeControl(next,body,scope,true)};assert.equal(runtimeControls(paused,scope,true).lifeEnabled,true)
 const gate=createSocialPolicyGate({getConfig:()=>paused});assert.equal(gate.canSendDm({uid:'123',trusted:true}).allowed,false);assert.equal(gate.canSendDm({uid:'456',strangerEnabled:true}).allowed,false)
 assert.equal(isReplyDispatch('bili_dynamic_comment_manual',{target_rpid:'123'}),true);assert.equal(isReplyDispatch('bili_dynamic_comment_manual',{}),false);assert.equal(isReplyDispatch('bili_reply',{rpid:123}),true);assert.equal(isReplyDispatch('bili_send_message_manual',{}),true);assert.equal(isReplyDispatch('bili_reply',{rpid:0,root:0}),false)
 assert.throws(()=>planRuntimeControl(cfg,{control:'life',enabled:true,revision:runtimeControls(cfg,scope,false).revision},scope,false),/先完成/)
})
