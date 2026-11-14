import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'

const ACCOUNT='a'.repeat(16)
const T=Date.parse('2026-11-09T12:00:00Z')
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-fix04-'));try{await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
function makePlanner(dir,{model,now=()=>T,episodeDue=()=>false,nextExperience=0,trace}={}){
  const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
    autonomousPlannerDailyLimit:20,autonomousPlannerMinutes:60,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,homeRecommendationsEnabled:true}
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>ACCOUNT,now})
  const planner=createAutonomousPlanner({dataDir:dir,now,getConfig:()=>cfg,getTodos:()=>[],getLifeAccountTag:()=>ACCOUNT,
    getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>({...events.status(),nextExperienceFollowupAt:nextExperience}),
    offerLifeWake:e=>events.offer(e),settleLifeEvents:(ids,reason)=>events.settle(ids,reason),
    recordLifeDecision:e=>events.recordDecision(e),getLifeCapabilities:()=>[{id:'bilibili.video-explore',risk:'delegated-existing-permissions'}],getLifeCapabilityReadiness:()=>({blocked:[]}),
    isLifeEpisodeDue:episodeDue,beginDecisionTrace:args=>trace?.begin(args),
    invokeModel:model|| (async()=>{throw Error('synthetic provider timeout')}),
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
  return {planner,events,cfg}
}

test('model failure is traced as failed settlement, never normal or voluntary rest',()=>withDir(async dir=>{
  let now=T
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>ACCOUNT,now:()=>now})
  const x=makePlanner(dir,{now:()=>now,trace})
  x.events.offer({kind:'quiet-window',platform:'life',sourceKey:'fix04-model-failure'})
  const result=await x.planner.tick({force:true})
  assert.equal(result.result,'model-or-execution-error')
  const row=trace.list().runs[0]
  const wake=row.steps.find(s=>s.type==='next-wake')
  assert.equal(wake.reason,'manual')
  const settlement=row.steps.find(s=>s.type==='event-settlement')
  assert.equal(settlement.code,'model')
  assert.notEqual(settlement.code,'normal')
  assert.equal(x.events.status().retryable,1)
  assert.equal(x.events.status().timeline[0].action,'unavailable')
  assert.equal(x.events.status().timeline[0].failed,true)
  assert.notEqual(x.events.status().timeline[0].result,'voluntary-rest')
}))

test('planner status forecast does not promise earlier experience follow-up than execution permits',()=>withDir(async dir=>{
  const now=()=>T
  const x=makePlanner(dir,{now,nextExperience:T+5*60_000})
  writeFileSync(join(dir,'autonomous-planner.json'),JSON.stringify({version:1,day:new Date(T).toLocaleDateString('en-CA'),runs:1,lifeRuns:1,socialRuns:0,willingnessRuns:0,lastAt:T,lastResult:'browse_home / capability-launched',lastAccountTag:ACCOUNT,recent:[]}))
  const status=x.planner.status()
  assert.equal(status.nextDecisionReason,'base-interval')
  assert.equal(status.nextDecisionAt,T+60*60_000)
  assert.match(status.nextDecisionNote,/不保证执行/)
}))

test('model retry backoff is reported as the dominant next wake reason',()=>withDir(async dir=>{
  const now=()=>T
  const retryAt=T+90*60_000
  const x=makePlanner(dir,{now})
  writeFileSync(join(dir,'autonomous-planner.json'),JSON.stringify({version:1,day:new Date(T).toLocaleDateString('en-CA'),runs:1,lifeRuns:1,socialRuns:0,willingnessRuns:0,lastAt:T,lastResult:'unavailable / model-or-execution-error',lastAccountTag:ACCOUNT,modelRetryAt:retryAt,modelFailureCode:'timeout',modelFailureStreak:1,recent:[]}))
  const status=x.planner.status()
  assert.equal(status.nextDecisionReason,'model-retry')
  assert.equal(status.nextDecisionAt,retryAt)
}))

test('due Episode cannot bypass the saved minimum Life polling interval',()=>withDir(async dir=>{
  const now=()=>T
  const x=makePlanner(dir,{now,episodeDue:()=>true})
  writeFileSync(join(dir,'autonomous-planner.json'),JSON.stringify({version:1,day:new Date(T).toLocaleDateString('en-CA'),runs:1,lifeRuns:1,socialRuns:0,willingnessRuns:0,lastAt:T,lastResult:'browse_home / capability-launched',lastAccountTag:ACCOUNT,recent:[]}))
  const status=x.planner.status()
  assert.equal(status.nextDecisionReason,'base-interval')
  assert.equal(status.nextDecisionAt,T+60*60_000)
}))

test('manual real video diagnostic button is explicit, one-round, active-mode only and uses original capability',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(html,/life-video-agent-test-run/)
  assert.match(ui,/START_ONE_REAL_VIDEO_AGENT_ROUND/)
  assert.match(html,/不强制选片或发表评论/)
  assert.match(source,/path==='\/api\/bili-duty\/life-agent\/video-agent-test-run'/)
  assert.match(source,/cfg\.lifeAgentMode!=='active'/)
  assert.match(source,/cfg\.homeRecommendationsEnabled!==true/)
  assert.match(source,/lifeCapabilities\.run\('bilibili\.video-explore',\{entryMode:'home',manualTrigger:true\}\)/)
  assert.match(source,/if\(manualTrigger===true\)return \{\.\.\.await runDuty\('manual-video-agent'/)
  assert.match(source,/const launched=runDuty\('life-agent'/)
  assert.match(source,/lifeVideoGate\(cfg,budget,Date\.now\(\)\)\.eligible/)
})
