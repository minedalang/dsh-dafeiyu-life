import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

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
