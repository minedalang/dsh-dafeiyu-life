#!/usr/bin/env node
/** Zero-network, zero-real-model Phase 5/6 diagnostics acceptance. */
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {projectLifeSettings} from '../lib/life-settings-projection.mjs'
const NOW=Date.parse('2026-11-05T17:00:00Z'),TAG='f'.repeat(16)
let fakeModelCalls=0,networkCalls=0,externalMessagesSent=0,scenarios=0
function check(test,message){if(!test)throw Error('模拟失败：'+message)}
async function simulation({result='{"action":"skip","reason":"今天需要休息"}',videos=true,launches=0}={}){
 const dir=mkdtempSync(join(tmpdir(),'dev4-choice-accept-'))
 try{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>TAG,now:()=>NOW})
  for(let i=0;i<launches;i++)events.recordVideoStart()
  const getConfig=()=>({masterEnabled:true,lifeAgentMode:'shadow',autonomousPlannerEnabled:true,
    autonomousPlannerMinutes:20,autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24})
  const planner=createAutonomousPlanner({dataDir:dir,getConfig,now:()=>NOW,getTodos:()=>[],
    getLifeAccountTag:()=>TAG,getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),
    settleLifeEvents:(ids,why)=>events.settle(ids,why),offerLifeWake:e=>events.offer(e),
    recordLifeDecision:d=>events.recordDecision(d),getLifeCapabilities:()=>videos?[{id:'mocksite.video-explore'}]:[],
    invokeModel:async()=>{fakeModelCalls++;if(result==='THROW')throw Error('simulated model unavailable');return result},
    runLifeCapability:()=>{externalMessagesSent++;throw Error('shadow must never run capability')},
    executeRead:async()=>({ok:false}),updateTodo:()=>{},reflect:async()=>({ok:false})})
  events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'fixture-'+String(launches)})
  const action=await planner.tick({force:true})
  return {action,timeline:events.status().timeline,modelRuns:planner.status().runs,pending:events.status().pending}
 }finally{rmSync(dir,{force:true,recursive:true})}
}
try{
 let x=await simulation({launches:1})
 check(x.action.result==='no-actionable-options'&&x.action.modelCalled===false&&x.modelRuns===0,'视频冷却时未免调用');scenarios++
 x=await simulation()
 check(x.action.result==='voluntary-rest'&&x.timeline[0].options.video===1,'合法休息未与无候选区分');scenarios++
 x=await simulation({result:'{"action":"send_dm","id":"fake"}'})
 check(x.action.result==='invalid-decision'&&x.modelRuns===1,'无效动作未被拒绝');scenarios++
 x=await simulation({result:'THROW'})
 check(x.action.ok===false&&x.pending>=1&&x.timeline[0].failed===true,'失败模型事件未保护');scenarios++
 const original={masterEnabled:false,lifeAgentMode:'active',peakValley:true,lifeAgentSocialContextOptIn:true,autonomousPlannerDailyLimit:4}
 const frozen=JSON.stringify(original),view=projectLifeSettings(original)
 check(JSON.stringify(original)===frozen&&view.readOnly===true&&view.migrationApplied===false&&
   view.privacy.socialExcerptPreviewEnabled===false&&view.privacy.socialReplyOwner==='legacy','只读配置意外扩大权限');scenarios++
 console.log(JSON.stringify({ok:true,scenarios,fakeModelCalls,realModelCalls:0,networkCalls,externalMessagesSent,realBilibiliAccountRequired:false},null,2))
}catch(e){console.error(JSON.stringify({ok:false,error:String(e.message||e),scenarios,networkCalls,externalMessagesSent}));process.exitCode=1}
