import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

const ACCOUNT='a'.repeat(16)
const START=Date.parse('2026-11-07T07:40:00Z')
const isolated=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-dev17-log-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

function scenario(dir,{social=false}={}){
  let clock=START,modelCalls=0,reflections=0
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>ACCOUNT,now:()=>clock})
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>ACCOUNT,now:()=>clock})
  events.recordVideoStart()
  const round=events.recordVideoRoundStart({source:'life-agent'})
  clock+=12_000
  events.recordVideoRoundFinish(round.id,{exitCode:0,pickedCount:2})
  clock+=20*60_000
  let socialEvent
  if(social)socialEvent=events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'trusted-dm-test'})
  const responses=social
    ?[JSON.stringify({action:'consider_social',id:socialEvent.id,reason:'有空想看看'}),'{"action":"reply"}']
    :['{"action":"reflect","reason":"记录一下"}']
  const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
    autonomousPlannerDailyLimit:100,autonomousPlannerMinutes:10,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,
    mainSessionReflectionMinCandidates:6}
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock,getConfig:()=>cfg,getTodos:()=>[],getLifeAccountTag:()=>ACCOUNT,
    getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),offerLifeWake:x=>events.offer(x),
    settleLifeEvents:(ids,r)=>events.settle(ids,r),recordLifeDecision:x=>events.recordDecision(x),
    getLifeCapabilities:()=>[],getLifeCapabilityReadiness:()=>({blocked:[]}),
    getLifeVoice:()=>'',getLifeSocialPreview:()=>({ok:true,excerpt:'最近好忙呀'}),noteLifeSocialShadow:()=>({ok:true}),
    beginDecisionTrace:args=>trace.begin(args),
    reflectionStatus:()=>({pending:social?0:8}),
    invokeModel:async()=>{modelCalls++;return responses.shift()||'{"action":"skip"}'},
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),
    reflect:async()=>{reflections++;return {ok:true}}})
  return {events,trace,planner,modelCalls:()=>modelCalls,reflections:()=>reflections}
}

test('video feedback persists as verified diagnostic stage, not anonymous technical error',()=>isolated(async dir=>{
  const x=scenario(dir)
  const result=await x.planner.tick({force:true})
  assert.equal(result.action,'reflect')
  assert.equal(result.result,'completed')
  assert.equal(x.reflections(),1)
  const row=x.trace.list().runs[0]
  assert.equal(row.state,'finished')
  assert.equal(row.steps.some(s=>s.type==='error'),false,JSON.stringify(row.steps))
  const feedback=row.steps.find(s=>s.type==='video-round-feedback')
  assert.ok(feedback)
  assert.equal(feedback.provided,1)
  assert.equal(feedback.latestOutcome,'process-exited-zero')
  assert.equal(feedback.latestPickedKnown,true)
  const i=row.steps.findIndex(s=>s.type==='video-round-feedback')
  assert.equal(row.steps[i-1].type,'quota-reserved')
  assert.equal(row.steps[i+1].type,'model-call')
}))

test('social shadow cycle must not log unused video feedback or pretend to send',()=>isolated(async dir=>{
  const x=scenario(dir,{social:true})
  const result=await x.planner.tick({socialWake:true})
  assert.equal(result.action,'consider_social')
  assert.equal(result.result,'social-shadow-reply')
  assert.equal(x.modelCalls(),2)
  const row=x.trace.list().runs[0]
  assert.equal(row.state,'finished')
  assert.equal(row.trigger,'social')
  assert.ok(row.steps.some(s=>s.type==='action-result'&&s.result==='social-shadow-reply'))
  assert.equal(row.steps.some(s=>s.type==='video-round-feedback'),false)
  assert.equal(row.steps.some(s=>s.type==='error'),false)
}))

test('unexpected stage cannot masquerade as a technical execution error; explicit errors retain codes',()=>isolated(dir=>{
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>ACCOUNT,now:()=>START})
  const turn=trace.begin({mode:'active'})
  turn.step('new-future-stage',{secret:'DO-NOT-LOG',code:'random-secret'})
  turn.step('error',{code:'model-call-failed'})
  turn.finish({state:'failed'})
  const row=trace.get(turn.id).run
  assert.equal(row.steps[0].type,'unknown-stage')
  assert.equal(row.steps[0].code,'unsupported-trace-stage')
  assert.equal(row.steps[1].type,'error')
  assert.equal(row.steps[1].code,'model-call-failed')
  assert.equal(JSON.stringify(row).includes('DO-NOT-LOG'),false)
}))

test('feedback fields are bounded and never accept private IDs or arbitrary output',()=>isolated(dir=>{
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>ACCOUNT,now:()=>START})
  const turn=trace.begin({mode:'active'})
  turn.step('video-round-feedback',{provided:50000,latestOutcome:'process-exited-zero',latestPickedKnown:false,
    bvid:'BV1SECRETVID',uid:'12345678',message:'private',accountTag:ACCOUNT})
  turn.finish({state:'finished'})
  const row=trace.get(turn.id).run
  assert.equal(row.steps[0].provided,10000)
  assert.equal(row.steps[0].latestPickedKnown,false)
  assert.equal(row.steps[0].latestOutcome,'process-exited-zero')
  assert.doesNotMatch(JSON.stringify(row),/SECRETVID|12345678|private|accountTag/)
}))

test('UI distinguishes historical malformed traces, video feedback and shadow no-send',()=>{
  const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(ui,/视频轮次回执（非观看证明）/)
  assert.match(ui,/仅影子判断（未发送）/)
  assert.match(ui,/旧版未识别诊断步骤（不能作为技术错误证据）/)
  assert.match(ui,/只读影子倾向回复，实际没有发送/)
  assert.match(ui,/item\.state==='failed'\?'本轮失败'/)
})
