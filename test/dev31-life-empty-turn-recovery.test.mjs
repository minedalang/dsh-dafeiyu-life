import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner,plannerActionMenu} from '../lib/autonomous-planner.mjs'
import {createLifeReflection} from '../lib/life-reflection.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createLifeCapabilities} from '../lib/life-capabilities.mjs'

const SCOPE='a'.repeat(16)
const T=Date.parse('2026-11-08T10:00:00Z')
const temp=async run=>{const dir=mkdtempSync(join(tmpdir(),'life-dev31-'));try{await run(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const config=()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:30,
  autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,homeRecommendationsEnabled:true})
const reflectionCfg=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,
  mainSessionReflectionMinCandidates:2,mainSessionReflectionBatchSize:4,mainSessionReflectionIntervalHours:2,mainSessionReflectionDailyBatches:4})
const eventsFor=(t,n)=>Array.from({length:n},(_,i)=>({kind:'watch',key:`watch:dev31:${i}`,bvid:'BV'+String(i).padStart(10,'0'),title:`视频${i}`,day:'2026-11-08'}))
const evidence={reflectionEvidence:keys=>keys.map(key=>({key,text:'这是真实仍有效的公开经历信息',importance:.5,stage:'clear',at:T}))}

function planner(dir,{clock,model,reflectionStatus=()=>({pending:0}),onExplore=()=>({started:true}),homeEnabled=true}={}){
 const cfg=config();cfg.homeRecommendationsEnabled=homeEnabled
 const agentEvents=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>SCOPE,now:clock})
 const skills=createLifeCapabilities([{id:'bilibili.video-explore',risk:'delegated-existing-permissions',
   description:'公开探索',available:()=>({ok:true}),execute:opts=>onExplore(opts)}])
 const svc=createAutonomousPlanner({dataDir:dir,now:clock,getConfig:()=>cfg,getTodos:()=>[],getLifeAccountTag:()=>SCOPE,
   getLifeEvents:()=>agentEvents.peek(),offerLifeWake:o=>agentEvents.offer(o),settleLifeEvents:(ids,reason)=>agentEvents.settle(ids,reason),
   getLifeEventStatus:()=>agentEvents.status(),getLifeCapabilities:()=>skills.list(),getLifeCapabilityReadiness:()=>skills.inspect(),
   runLifeCapability:(id,opts)=>skills.run(id,opts),recordVideoStart:()=>agentEvents.recordVideoStart(),
   invokeModel:model,reflect:async()=>({ok:false,skipped:'interval'}),reflectionStatus,
   executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false})})
 return {svc,cfg,agentEvents}
}

test('反思状态与执行器共用条件，冷却中 pending 再多也不提供 reflect',()=>temp(async dir=>{
 let now=T,calls=0
 const reflection=createLifeReflection({dataDir:dir,getConfig:reflectionCfg,now:()=>now,memoryGateway:evidence,
   invokeModel:async()=>'{"memories":[],"note":"已经处理但没有新的长期认识"}',commitMemories:()=>({added:0,rows:[]})})
 reflection.addEvents(eventsFor(T,2))
 assert.equal(reflection.status().canAutoReflect,true)
 assert.equal((await reflection.reflect()).ok,true)
 reflection.addEvents([{kind:'watch',key:'watch:dev31:new1',bvid:'BV1000000001',day:'2026-11-08'},
   {kind:'watch',key:'watch:dev31:new2',bvid:'BV1000000002',day:'2026-11-08'}])
 assert.equal(reflection.status().pending,2)
 assert.equal(reflection.status().canAutoReflect,false)
 assert.equal(reflection.status().autoReflectBlockedReason,'interval')
 const seen=[]
 const x=planner(dir,{clock:()=>now,reflectionStatus:()=>reflection.status(),model:async prompt=>{
   calls++;seen.push(prompt);return JSON.stringify({action:'browse_home',reason:'我想随便逛首页'})},
   onExplore:opts=>({started:true})})
 const run=await x.svc.tick({force:true})
 assert.equal(run.action,'browse_home')
 assert.equal(run.result,'capability-launched')
 assert.equal(calls,1)
 assert.equal(seen[0].includes('"action":"reflect"'),false)
 now+=2*3600_000
 assert.equal(reflection.status().canAutoReflect,true)
}))

test('首页闲逛显式独立候选，不新建视频 Agent，原能力执行接收 home 模式',()=>temp(async dir=>{
 let now=T,received=[]
 const x=planner(dir,{clock:()=>now,model:async()=>JSON.stringify({action:'browse_home',reason:'闲着去首页看看'}),onExplore:opts=>{
   received.push(opts);return {started:true}}})
 const run=await x.svc.tick({force:true})
 assert.equal(run.action,'browse_home');assert.equal(run.result,'capability-launched')
 assert.deepEqual(received,[{entryMode:'home'}])
 assert.equal(x.agentEvents.status().videoStartsToday,1)
 const forbidden=plannerActionMenu({videoEligible:true,lifeEvents:[{id:'e'}],lifeSkills:[{id:'bilibili.video-explore'}],homeEnabled:false})
 assert.equal(forbidden.some(x=>x.action==='browse_home'),false)
 const allowed=plannerActionMenu({videoEligible:true,lifeEvents:[{id:'e'}],lifeSkills:[{id:'bilibili.video-explore'}],homeEnabled:true})
 assert.equal(allowed.some(x=>x.action==='browse_home'),true)
}))

test('模型失败退避能跨实例保留，未到期不再扣额度，成功后清零',()=>temp(async dir=>{
 let now=T,calls=0,fail=true
 const model=async()=>{calls++;if(fail)throw Error('429 rate limit');return JSON.stringify({action:'skip',reason:'休息'})}
 const first=planner(dir,{clock:()=>now,model})
 assert.equal((await first.svc.tick({force:true})).ok,false)
 let st=first.svc.status()
 assert.equal(st.modelFailureStreak,1)
 assert.equal(st.modelFailureCode,'rate-limited')
 assert.equal(st.modelRetryAt,now+5*60_000)
 now+=60_000
 const restarted=planner(dir,{clock:()=>now,model})
 const blocked=await restarted.svc.tick()
 assert.equal(blocked.skipped,'model-backoff')
 assert.equal(blocked.modelCalled,false)
 assert.equal(calls,1)
 assert.equal(restarted.svc.status().lifeRuns,1)
 now+=5*60_000;fail=false
 const result=await restarted.svc.tick()
 assert.equal(result.action,'skip')
 assert.equal(calls,2)
 st=restarted.svc.status()
 assert.equal(st.modelFailureStreak,0)
 assert.equal(st.modelRetryAt,0)
 const raw=readFileSync(join(dir,'autonomous-planner.json'),'utf8')
 assert.doesNotMatch(raw,/429 rate limit/)
}))

test('无可信首页来源或没有账号候选时，模型不能借 browse_home 启动外部进程',()=>temp(async dir=>{
 let called=0
 const x=planner(dir,{clock:()=>T,homeEnabled:false,model:async()=>{
   called++;return JSON.stringify({action:'browse_home'})},onExplore:()=>{throw Error('must not run')}})
 const run=await x.svc.tick({force:true})
 assert.equal(run.action,'skip')
 assert.equal(run.result,'invalid-decision')
 assert.equal(called,1)
}))
