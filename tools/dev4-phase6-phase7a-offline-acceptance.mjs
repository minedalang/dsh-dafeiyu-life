#!/usr/bin/env node
/** No network, Bilibili credentials, real DSH data or real models. */
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {lifeSettingsV2,planLifeSettingsV2} from '../lib/life-settings-control.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
let scenarios=0,fakeModelCalls=0,networkCalls=0,externalMessagesSent=0
const check=(yes,message)=>{if(!yes)throw Error(message);scenarios++}
const old={masterEnabled:true,lifeAgentMode:'off',peakValley:true,autonomousPlannerEnabled:false,
 autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:24,autonomousPlannerStartHour:9,autonomousPlannerEndHour:23,
 socialAutoSend:false,dmStrangerAutonomyEnabled:false,lifeAgentSocialContextOptIn:false}
const initial=JSON.stringify(old)
try{
 const revision=lifeSettingsV2(old).revision
 const req={schemaVersion:2,revision,mode:'active',pace:'natural',previewOnly:true}
 const planned=planLifeSettingsV2(old,req)
 check(planned.patch.peakValley===false&&planned.patch.autonomousPlannerEnabled===true,'未撤销双视频驱动')
 check(JSON.stringify(old)===initial,'只读预览修改了旧配置')
 const applied=planLifeSettingsV2(old,{...req,previewOnly:false,confirm:'APPLY_LIFE_SETTINGS_V2'})
 check(!('socialAutoSend' in applied.patch)&&!('dmStrangerAutonomyEnabled' in applied.patch)&&!('lifeAgentSocialContextOptIn' in applied.patch),'权限被扩大')
 let rejected=false
 try{planLifeSettingsV2({...old,peakValley:false},{...req,previewOnly:false,confirm:'APPLY_LIFE_SETTINGS_V2'})}catch{rejected=true}
 check(rejected,'旧配置并发变更未拒绝')
 const dir=mkdtempSync(join(tmpdir(),'life-phase67-'));const account='b'.repeat(16),now=Date.parse('2026-11-05T17:00:00Z')
 try{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>account,now:()=>now})
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>now,getConfig:()=>({...old,...applied.patch,lifeAgentMode:'shadow',autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
   getTodos:()=>[{id:'synthetic-todo',type:'check_notifications',status:'open',source:'friend',origin:{uid:'1234567'}}],
   getRelationshipHint:()=>({score:70,stage:'friend'}),getLifeAccountTag:()=>account,
   getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),recordLifeDecision:x=>events.recordDecision(x),
   invokeModel:async()=>{fakeModelCalls++;return '{"action":"skip","reason":"想先休息"}'},
   executeRead:async()=>({ok:false}),updateTodo:async()=>{},reflect:async()=>({ok:false})})
  const decided=await planner.tick({force:true}),e=events.status().timeline[0]
  check(decided.result==='voluntary-rest'&&fakeModelCalls===1,'影子模型未正确作出休息选择')
  check(e?.options?.relationship===1&&e?.mode==='shadow','未显示可信关系候选')
  check(networkCalls===0&&externalMessagesSent===0,'离线模拟发生网络或社交外发')
 }finally{rmSync(dir,{recursive:true,force:true})}
 console.log(JSON.stringify({ok:true,scenarios,fakeModelCalls,realModelCalls:0,networkCalls,externalMessagesSent,
  version:'2.7.1-dev.4',scope:'Phase 6 settings + Phase 7a evidence observability',realBilibiliAccountRequired:false},null,2))
}catch(e){console.error(JSON.stringify({ok:false,error:String(e?.message||e),scenarios}));process.exitCode=1}
