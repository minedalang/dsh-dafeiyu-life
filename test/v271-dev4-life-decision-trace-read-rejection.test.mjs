import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import {classifyReadFailure} from '../lib/read-action-diagnostics.mjs'
import {createReadActionExecutionGate,readToolAction} from '../lib/read-action-execution-gate.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'

const A='1'.repeat(16),B='2'.repeat(16),BV='BV1abcde1234',T=Date.parse('2026-11-06T19:00:00Z')
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-life-trace-'));try{return await fn(dir)}finally{rmSync(dir,{force:true,recursive:true})}}
const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:30,
  autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}

test('records a complete bounded trace without original model text, UID or targets',()=>home(async dir=>{
  let account=A
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>account,now:()=>T})
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>account,now:()=>T})
  events.offer({kind:'manual-wake',platform:'life',sourceKey:'secret-uid-55993'})
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>cfg,getLifeAccountTag:()=>account,
    getTodos:()=>[],getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),getLifeCapabilities:()=>[],
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:row=>events.recordDecision(row),
    invokeModel:async()=>'{"action":"skip","reason":"private message from uid 55993"}',
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false}),
    beginDecisionTrace:options=>trace.begin(options)})
  const outcome=await planner.tick({force:true})
  assert.equal(outcome.result,'no-actionable-options')
  assert.match(outcome.traceId,/^[0-9a-f-]{36}$/)
  const run=trace.get(outcome.traceId).run
  assert.ok(run.steps.some(x=>x.type==='start'))
  assert.ok(run.steps.some(x=>x.type==='candidate-scan'))
  assert.ok(run.steps.some(x=>x.type==='finish'))
  const json=JSON.stringify(run)
  assert.doesNotMatch(json,/secret-uid|private message|55993|BV1abcde1234/)
  assert.equal(run.state,'finished')
  account=B
  assert.deepEqual(trace.list().runs,[])
  assert.equal(trace.get(outcome.traceId).ok,false)
  account=A
  assert.equal(trace.list().runs.length,1)
}))

test('model invocation and choice appear in actual trace without recording its prose',()=>home(async dir=>{
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>A,now:()=>T})
  const todoId='123e4567-e89b-12d3-a456-426614174000'
  const todo={id:todoId,type:'inspect_my_space',title:'private-uid-12345',status:'open'}
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>cfg,getLifeAccountTag:()=>A,
    getTodos:()=>[todo],invokeModel:async()=>JSON.stringify({action:'execute_read',id:todoId,reason:'some private story'}),
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:true}),reflect:async()=>({ok:false}),
    beginDecisionTrace:args=>trace.begin(args)})
  const result=await planner.tick({force:true})
  assert.equal(result.diagnosticCode,'todo-read-failed')
  const run=trace.get(result.traceId).run
  for(const kind of ['candidate-scan','quota-reserved','model-call','model-choice','preflight','action-start','action-result','finish'])
    assert.ok(run.steps.some(x=>x.type===kind),kind)
  assert.equal(run.steps.find(x=>x.type==='model-choice').action,'execute_read')
  assert.doesNotMatch(JSON.stringify(run),/some private story|private-uid|123e4567/)
}))

test('model error traces retain its safe error class rather than raw response',()=>home(async dir=>{
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>A,now:()=>T})
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>cfg,getLifeAccountTag:()=>A,
    getTodos:()=>[{id:'123e4567-e89b-12d3-a456-426614174000',type:'inspect_my_space',title:'foo'}],
    invokeModel:async()=>'{unparsed private text}',executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:true}),
    reflect:async()=>({ok:false}),beginDecisionTrace:args=>trace.begin(args)})
  const result=await planner.tick({force:true})
  assert.equal(result.result,'invalid-decision')
  const run=trace.get(result.traceId).run
  assert.ok(run.steps.some(x=>x.type==='model-choice'&&x.code==='model-json-invalid'))
  assert.doesNotMatch(JSON.stringify(run),/unparsed private text/)
}))

test('account swap while a trace is open cannot write to another account',()=>home(async dir=>{
  let account=A
  const t=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>account,now:()=>T})
  const first=t.begin({mode:'active',trigger:'manual'})
  account=B
  assert.throws(()=>first.step('model-call',{state:'requested'}),/账号已切换/)
  assert.deepEqual(t.list().runs,[])
  account=A
  assert.equal(t.get(first.id).run.state,'running')
}))

test('symbolic linked trace scope folder is rejected; no traversal into arbitrary files',()=>home(async dir=>{
  const base=join(dir,'life-decision-traces'),other=join(dir,'other')
  mkdirSync(base);mkdirSync(other)
  const hashed=(await import('node:crypto')).createHash('sha256').update(A).digest('hex').slice(0,24)
  try{symlinkSync(other,join(base,hashed),'dir')}catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e}
  const t=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>A})
  assert.throws(()=>t.list(),/目录不安全/)
}))

test('read tool returned denial differs from held reservation, and groups repeated failures',()=>home(async dir=>{
  const gate=createReadActionExecutionGate({dataDir:dir,getAccountScope:()=> 'safe-account-scope-123'})
  const action=readToolAction('bili_received_replies',{})
  for(let i=0;i<3;i++)await gate.run(action,async()=>({ok:false,code:-412,message:'rate limit private UID 123'}))
  const data=gate.status()
  assert.equal(data.active,0)
  assert.equal(data.recent.length,3)
  assert.ok(data.recent.every(x=>x.state==='tool-rejected'&&x.code==='platform-rate-limit'))
  assert.equal(data.recentGroups[0].count,3)
  assert.equal(data.recentGroups[0].code,'platform-rate-limit')
  assert.doesNotMatch(JSON.stringify(data),/private UID|123'/)
}))

test('read diagnostics recognize explicit Python adapter errors and avoid raw messages',()=>{
  const cases=[
    [{error:'credential expired user 123'},'account-auth'],
    [{success:false,error:'HTTP 429 rate limit'},'platform-rate-limit'],
    [{isError:true,content:[{type:'text',text:'HTTP 403 forbidden'}]},'platform-permission'],
    [{ok:false,error:'timeout from third-party private user'},'platform-timeout'],
    [{code:0,data:{title:'正常'}},''],
  ]
  for(const [raw,reason] of cases){const classified=classifyReadFailure(raw);assert.equal(classified.code,reason);assert.doesNotMatch(JSON.stringify(classified),/123|private user/)}
})

test('read-only metadata journal failure is retryable, not automatically frozen as unknown external side effect',()=>home(async dir=>{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>T})
  const item=events.offer({kind:'manual-wake',platform:'life',sourceKey:'manual-1'})
  const opportunity={id:'known-opportunity',bvid:BV,source:'discussion-read',eligible:true}
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>cfg,getLifeAccountTag:()=>A,
    getTodos:()=>[],getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),
    getLifeOpportunities:()=>[opportunity],getAcceptedActionReservations:()=>[],getActiveLifeIntentionReservations:()=>[],
    invokeModel:async()=>JSON.stringify({action:'inspect_opportunity',id:opportunity.id}),
    executeOpportunityRead:async()=>({ok:true,bvid:BV,title:'已成功读取'}),
    recordOpportunityDecision:()=>{throw Error('local journal temporary failure')},
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:r=>events.recordDecision(r),
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:true}),reflect:async()=>({ok:false})})
  const result=await planner.tick({force:true})
  assert.equal(result.diagnosticCode,'action-preflight-error')
  assert.equal(events.status().needsReview,0)
  assert.equal(events.status().recent.find(x=>x.kind==='manual-wake').state,'retryable')
}))

test('production console shows one debugger entry and removes retired Dev3 button/endpoint',async()=>{
  const {readFileSync}=await import('node:fs')
  const root=new URL('../',import.meta.url)
  const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
  const ui=readFileSync(new URL('lib/management-console.js',root),'utf8')
  const index=readFileSync(new URL('index.js',root),'utf8')
  assert.match(html,/id="life-decision-traces-section"/)
  assert.match(ui,/request\('\/life-agent\/decision-traces'\)/)
  assert.match(index,/path==='\/api\/bili-duty\/life-agent\/decision-traces'/)
  assert.doesNotMatch(html,/dev3-offline-test/)
  assert.doesNotMatch(index,/path==='\/api\/bili-duty\/dev3\/acceptance\/local'/)
})
