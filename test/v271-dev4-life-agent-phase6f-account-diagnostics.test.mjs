import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createAccountBinding} from '../lib/account-binding.mjs'
import {currentLifeAccountScope} from '../lib/account-life-scope.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'

const A='a'.repeat(16), B='b'.repeat(16)
const T=Date.parse('2026-11-05T12:00:00Z')
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-scope-status-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const config={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'shadow',
  autonomousPlannerDailyLimit:4,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
const make=(dir,scope,answer)=>createAutonomousPlanner({dataDir:dir,getLifeAccountTag:scope,getConfig:()=>config,
  now:()=>T,getTodos:()=>[],reflectionStatus:()=>({pending:10}),invokeModel:async()=>JSON.stringify({action:'skip',reason:answer()}),
  executeRead:async()=>{throw Error('never read')},updateTodo:async()=>{throw Error('never mutate')},reflect:async()=>{throw Error('never reflect')}})

test('6f: switching accounts does not expose another account’s recent model reason; daily quota stays global',()=>home(async dir=>{
  let account=A
  const planner=make(dir,()=>account,()=>account===A?'A_PRIVATE_MODEL_REASON':'B_PRIVATE_MODEL_REASON')
  const a=await planner.tick({force:true})
  assert.equal(a.action,'skip')
  assert.equal(planner.status().recent.length,1)
  assert.equal(planner.status().recent[0].reason,'A_PRIVATE_MODEL_REASON')
  assert.equal(planner.status().runs,1)
  account=B
  const before=planner.status()
  assert.equal(before.runs,1,'account change must not reset the shared model budget')
  assert.equal(before.lastResult,'')
  assert.equal(before.lastError,'')
  assert.deepEqual(before.recent,[])
  assert.equal(before.experienceReadiness.remainingDecisions,3)
  await planner.tick({force:true})
  assert.deepEqual(planner.status().recent.map(r=>r.reason),['B_PRIVATE_MODEL_REASON'])
  assert.equal(planner.status().runs,2)
  assert.doesNotMatch(JSON.stringify(planner.status()),/A_PRIVATE_MODEL_REASON/)
  assert.doesNotMatch(JSON.stringify(planner.status()),/a{16}/)
  account=A
  assert.deepEqual(planner.status().recent.map(r=>r.reason),['A_PRIVATE_MODEL_REASON'])
  assert.doesNotMatch(JSON.stringify(planner.status()),/B_PRIVATE_MODEL_REASON/)
  assert.equal(planner.status().runs,2,'never double allowance by switching back')
  const saved=JSON.parse(readFileSync(join(dir,'autonomous-planner.json'),'utf8'))
  assert.equal(saved.version,1,'preserve old schema and original file location')
  assert.equal(saved.recent.length,2,'do not delete other account’s historical data')
  assert.equal(saved.recent[0].accountTag,A)
  assert.equal(saved.recent[1].accountTag,B)
}))

test('6f: legacy unscoped reasons remain on disk for backups but are not attributed to any current account',()=>home(dir=>{
  const old={version:1,day:new Date(T).toLocaleDateString('en-CA'),runs:2,lastAt:T-600_000,
    lastResult:'LEGACY_PRIVATE_RESULT',lastError:'LEGACY_PRIVATE_ERROR',modelInputChars:50,modelOutputChars:20,
    recent:[{at:T-600_000,id:'LEGACY_PRIVATE_TASK_ID',action:'skip',reason:'LEGACY_PRIVATE_REASON'}]}
  const file=join(dir,'autonomous-planner.json');writeFileSync(file,JSON.stringify(old))
  let account=A
  const planner=make(dir,()=>account,()=> 'new')
  for(const tag of [A,B]){
    account=tag
    const status=planner.status()
    assert.equal(status.runs,2)
    assert.equal(status.modelInputChars,50)
    assert.equal(status.lastResult,'')
    assert.equal(status.lastError,'')
    assert.deepEqual(status.recent,[])
    assert.doesNotMatch(JSON.stringify(status),/LEGACY_PRIVATE/)
  }
  assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),old,'read-only status must not migrate or erase data')
}))

test('6f: invalid verified account fails closed for life-mode diagnostic projection',()=>home(dir=>{
  const file=join(dir,'autonomous-planner.json')
  writeFileSync(file,JSON.stringify({version:1,day:new Date(T).toLocaleDateString('en-CA'),runs:1,lastAt:T,
    lastResult:'SECRET',lastError:'SECRET_ERROR',recent:[{at:T,accountTag:A,reason:'SECRET_REASON'}]}))
  const p=make(dir,()=>'',()=> 'not-used')
  assert.equal(p.status().runs,1)
  assert.deepEqual(p.status().recent,[])
  assert.equal(p.status().lastResult,'')
  assert.doesNotMatch(JSON.stringify(p.status()),/SECRET/)
}))


test('unverified production account waits without trace, lease, model or candidate reads; resumes after verification',()=>home(async dir=>{
  let scope='', traces=0, models=0, candidates=0, warnings=[],clock=T
  const planner=createAutonomousPlanner({dataDir:dir,getLifeAccountTag:()=>scope,getConfig:()=>config,now:()=>clock,
    getTodos:()=>{candidates++;return []},reflectionStatus:()=>({pending:10}),
    invokeModel:async()=>{models++;return JSON.stringify({action:'skip',reason:'rest'})},
    executeRead:async()=>{throw Error('never read')},updateTodo:async()=>{throw Error('never mutate')},reflect:async()=>{throw Error('never reflect')},
    beginDecisionTrace:()=>{traces++;if(!scope)throw Error('当前 Life 账号尚未核验');return {step(){},finish(){},discard(){}}},logger:{warn:m=>warnings.push(m)}})
  for(let i=0;i<133;i++){
    clock+=60_000
    const result=await planner.tick(i===0?{force:true}:undefined)
    assert.deepEqual(result,{ok:true,skipped:'account-not-ready',modelCalled:false})
  }
  assert.equal(traces,0);assert.equal(models,0);assert.equal(candidates,0);assert.deepEqual(warnings,[])
  assert.equal(planner.status().schedulerPulse.checks,133)
  assert.equal(planner.status().schedulerPulse.lastSkipReason,'account-not-ready')
  scope=A
  const result=await planner.tick({force:true})
  assert.equal(result.action,'skip');assert.equal(traces,1);assert.equal(models,1)
  scope='';clock+=60_000
  assert.equal((await planner.tick({acceptedTodoWakeId:'old'})).skipped,'account-not-ready')
  assert.equal(traces,1);assert.equal(models,1)
}))


test('empty account lifecycle with the real trace and scope: 133 blocked polls then confirmed account resumes',()=>home(async dir=>{
  let clock=T, models=0, traceStarts=0, warnings=[]
  const opts={dataDir:dir,verifier:async c=>({uid:c.dedeuserid})}
  let binding=createAccountBinding(opts)
  const scope=()=>currentLifeAccountScope({dataDir:dir,accountBinding:binding,credential:existsSync(join(dir,'bili_credential.json'))?JSON.parse(readFileSync(join(dir,'bili_credential.json'),'utf8')):null})
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:scope,now:()=>clock})
  const planner=createAutonomousPlanner({dataDir:dir,getLifeAccountTag:scope,getConfig:()=>config,now:()=>clock,
    getTodos:()=>[],reflectionStatus:()=>({pending:10}),invokeModel:async()=>{models++;return JSON.stringify({action:'skip',reason:'rest'})},
    executeRead:async()=>{throw Error('never read')},updateTodo:async()=>{throw Error('never mutate')},reflect:async()=>{throw Error('never reflect')},
    beginDecisionTrace:params=>{traceStarts++;return trace.begin(params)},logger:{warn:m=>warnings.push(m)}})
  const wait=async n=>{for(let i=0;i<n;i++){clock+=60_000;assert.equal((await planner.tick()).skipped,'account-not-ready')}}
  await wait(30)
  binding.stage({dedeuserid:'10001',sessdata:'fixture',bili_jct:'fixture',buvid3:'fixture'})
  await wait(50)
  await binding.activate({expectedUid:'10001'});await wait(30)
  binding=createAccountBinding(opts);binding.acknowledgeRestart();await wait(23)
  assert.equal(traceStarts,0);assert.equal(models,0);assert.deepEqual(warnings,[])
  assert.equal(existsSync(join(dir,'life-decision-traces')),false)
  binding.resume({expectedUid:'10001'})
  const result=await planner.tick({force:true});assert.equal(result.action,'skip');assert.ok(result.traceId)
  assert.equal(traceStarts,1);assert.equal(models,1);assert.equal(trace.list().runs.length,1)
  binding.stage({dedeuserid:'20002',sessdata:'fixture2',bili_jct:'fixture',buvid3:'fixture'})
  await wait(1);assert.equal(traceStarts,1);assert.equal(models,1)
}))
