/**
 * Explicit synthetic acceptance. Executes the SAME planner with fake events,
 * fake model and fake video adapter in a disposable temp directory. No real
 * platform, credentials, model service or user data is passed to this module.
 */
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner} from './autonomous-planner.mjs'
const SCOPE='a'.repeat(16),NOW=Date.parse('2026-11-05T12:00:00Z')
const skill={id:'video.start',name:'合成视频探索'}
const event={id:'1'.repeat(24),kind:'manual-wake',platform:'life',at:NOW-5_000}
async function syntheticCase({name,mode,action='use_capability',capability=true}={}){
  const folder=mkdtempSync(join(tmpdir(),'dsh-life-demo-'))
  let fakeModelCalls=0,fakeVideoStarts=0,fakeReadCalls=0,decisions=[]
  const cfg={masterEnabled:true,lifeAgentMode:mode,autonomousPlannerEnabled:true,
    autonomousPlannerDailyLimit:20,autonomousPlannerMinutes:30,
    autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
  try{
    const planner=createAutonomousPlanner({dataDir:folder,now:()=>NOW,getConfig:()=>cfg,
      getLifeAccountTag:()=>SCOPE,getLifeEvents:()=>[event],
      getLifeEventStatus:()=>({ok:true,pending:1,pendingSocial:0,videoStartsToday:fakeVideoStarts,lastVideoAt:0}),
      getLifeCapabilities:()=>capability?[skill]:[],
      getTodos:()=>[],invokeModel:async()=>{fakeModelCalls++;return JSON.stringify({action,capability:skill.id,reason:'仅为模拟'})},
      executeRead:async()=>{fakeReadCalls++;throw Error('Offline demo must not read Bilibili')},
      updateTodo:async()=>{throw Error('Offline demo must not mutate tasks')},
      reflect:async()=>{throw Error('Offline demo must not reflect to production')},
      runLifeCapability:()=>({started:(fakeVideoStarts++,true)}),
      recordVideoStart:()=>({ok:true}),recordLifeDecision:row=>{decisions.push(row);return {ok:true}},
      settleLifeEvents:()=>({ok:true,updated:1})})
    const result=await planner.tick({force:true})
    return {name,mode,action:result.action||'',result:result.result||result.skipped||'',
      fakeModelCalls,fakeVideoStarts,fakeReadCalls,recordedChoices:decisions.length,
      productionActions:0,networkCalls:0,realModelCalls:0,outboundMessages:0}
  }finally{rmSync(folder,{force:true,recursive:true})}
}
export async function runLifeExperienceOfflineDemo(){
  const cases=[
    await syntheticCase({name:'影子模式想探索但不启动',mode:'shadow'}),
    await syntheticCase({name:'自主模式委派假视频 Agent',mode:'active'}),
    await syntheticCase({name:'自主模式明确选择休息',mode:'active',action:'skip'}),
    await syntheticCase({name:'无可用视频能力',mode:'active',capability:false})
  ]
  const expected=['shadow-would-explore','capability-launched','voluntary-rest','no-actionable-options']
  const ok=cases.every((x,i)=>x.result===expected[i]&&x.fakeReadCalls===0&&
    x.fakeVideoStarts===(i===1?1:0)&&x.fakeModelCalls===(i===3?0:1))
  return {ok,synthetic:true,cases,networkCalls:0,realModelCalls:0,outboundMessages:0,
    note:'仅验证原 Life Agent 在合成条件下的选择与委派逻辑；不代表真实 B站视频已经启动、观看或产生长期成长。'}
}
