import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,symlinkSync,existsSync,utimesSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {withPlannerLedgerLock,createPlannerRunLease,recoverPlannerLockOffline} from '../lib/life-planner-atomic.mjs'

const A='a'.repeat(16)
const T=Date.parse('2026-11-06T12:00:00Z')
const config={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:7,
  autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
const withHome=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-atomic-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
function setup(dir,model,clock){
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>clock.value})
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock.value,getLifeAccountTag:()=>A,getConfig:()=>config,
    getTodos:()=>[],getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:x=>events.recordDecision(x),
    getLifeCapabilities:()=>[{id:'mocksite.video-explore',risk:'read'}],
    invokeModel:model,executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
  return {events,planner}
}

test('invalid model output is not voluntary silence; same source resumes only when bounded retry is due',()=>withHome(async dir=>{
  const clock={value:T};let calls=0,answer='not json'
  const x=setup(dir,async()=>{calls++;return answer},clock)
  const source='uid-92748614/private-message-secret'
  x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:source})
  const first=await x.planner.tick({force:true})
  assert.equal(first.ok,false);assert.equal(first.result,'invalid-decision')
  assert.equal(first.diagnosticCode,'model-json-invalid')
  const row=x.events.status().recent.find(e=>e.kind==='dm-received')
  assert.equal(row.state,'retryable');assert.equal(row.failures,1)
  assert.equal(row.retryAt,T+5*60_000)
  assert.equal(x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:source}).created,false)
  assert.equal(x.events.peek().some(e=>e.kind==='dm-received'),false,'not due cannot be returned to planner')
  assert.equal(readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8').includes(source),false)
  clock.value+=5*60_000
  assert.equal(x.events.peek().some(e=>e.kind==='dm-received'),true)
  // A later valid choice is a real decision; it may settle this old wake.
  answer='{"action":"skip","reason":"想休息"}'
  const second=await x.planner.tick({force:true})
  assert.equal(second.result,'voluntary-rest')
  assert.equal(x.events.status().recent.find(e=>e.kind==='dm-received').state,'considered')
  assert.equal(calls,2)
}))

test('three model validation faults exhaust the same event; no endless silent requeue',()=>withHome(async dir=>{
  const clock={value:T};const x=setup(dir,async()=>'{broken}',clock)
  const offered=x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'repeat-me'})
  for(const delay of [0,5*60_000,10*60_000]){
    clock.value+=delay
    const result=await x.planner.tick({force:true})
    assert.equal(result.ok,false)
  }
  const e=x.events.status().recent.find(e=>e.kind==='dm-received')
  assert.equal(e.state,'failed');assert.equal(e.failures,3)
  assert.equal(x.events.peek().some(e=>e.id===offered.id),false)
  assert.equal(x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'repeat-me'}).created,false)
  assert.equal(x.events.status().failed>=1,true)
  assert.equal(x.planner.status().runs,3)
}))

test('legacy v1 invalid settled event returns as one bounded retry without erasing other entries',()=>withHome(dir=>{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>T+10*60_000})
  const folder=join(dir,'life-agent-events');mkdirSync(folder)
  const id='1'.repeat(24)
  const v1={version:1,events:[{id,kind:'dm-received',platform:'bilibili',at:T,state:'considered',result:'invalid'},
    {id:'2'.repeat(24),kind:'manual-wake',platform:'life',at:T,state:'considered',result:'considered'}],videoStarts:[]}
  writeFileSync(join(folder,A+'.json'),JSON.stringify(v1))
  assert.equal(events.peek()[0].id,id)
  assert.equal(events.status().retryable,1)
  assert.equal(events.status().considered,1)
}))

test('metadata mutation lock is atomic and fails closed on collision, without replacing the original JSON format',()=>withHome(dir=>{
  const first=withPlannerLedgerLock(dir,()=>{
    const nested=withPlannerLedgerLock(dir,()=>({ok:true}))
    assert.equal(nested.ok,false);assert.equal(nested.reason,'planner-ledger-busy')
    return {ok:true}
  })
  assert.equal(first.ok,true)
  assert.equal(withPlannerLedgerLock(dir,()=>({ok:true})).ok,true)
  assert.equal(existsSync(join(dir,'autonomous-planner-ledger.lock')),false)
}))

test('two DSH processes cannot make concurrent model calls or spend the global daily allowance twice',()=>withHome(async dir=>{
  const logFile=join(dir,'calls.log'),worker=fileURLToPath(new URL('./fixtures/life-planner-multiprocess-worker.mjs',import.meta.url))
  writeFileSync(logFile,'')
  const start=who=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[worker,dir,logFile,who],{stdio:['ignore','pipe','pipe']})
    let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d)
    child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(stdout.trim())):reject(Error(stderr||stdout)))
  })
  const [a,b]=await Promise.all([start('a'),start('b')])
  const executed=readFileSync(logFile,'utf8').trim().split('\n').filter(Boolean)
  const ledger=JSON.parse(readFileSync(join(dir,'autonomous-planner.json'),'utf8'))
  assert.equal(executed.length,1,'two model invocations would violate a daily quota of one')
  assert.equal(ledger.runs,1)
  assert.equal(ledger.version,1)
  assert.equal([a.result,b.result].filter(x=>x.action==='skip').length,1)
  assert.equal([a.result,b.result].filter(x=>['planner-already-running','quota'].includes(x.skipped)).length,1,JSON.stringify([a.result,b.result]))
  assert.equal(existsSync(join(dir,'autonomous-planner-run.lock')),false)
}))

test('a competing process seeing a newly created run lock is busy, not orphaned',()=>withHome(dir=>{
  // Simulate the mkdir -> owner.json publication window on NTFS.
  const lock=join(dir,'autonomous-planner-run.lock');mkdirSync(lock)
  const lease=createPlannerRunLease({dataDir:dir})
  assert.equal(lease.acquire().reason,'planner-already-running')
  assert.equal(lease.inspect().needsReview,true,'inspection still warns of an incomplete owner')
  assert.equal(existsSync(lock),true,'other processes must not remove the lock')
  writeFileSync(join(lock,'owner.json'),'')
  assert.equal(lease.acquire().reason,'planner-already-running',
    'owner.json may exist before its contents have been written')
  writeFileSync(join(lock,'owner.json'),'{\"version\":1')
  assert.equal(lease.acquire().reason,'planner-already-running',
    'a partially written owner record does not authorize a second planner')
  // A stale incomplete claim still fails closed without automatic recovery.
  const old=new Date(Date.now()-10000);utimesSync(lock,old,old)
  assert.equal(lease.acquire().reason,'planner-lock-review-required')
  assert.equal(existsSync(lock),true)
  rmSync(lock,{recursive:true,force:true})
  mkdirSync(lock);writeFileSync(join(lock,'owner.json'),'not-json')
  assert.equal(lease.acquire().reason,'planner-lock-review-required',
    'a recent malformed owner is not considered ordinary contention')
}))

test('dead run lease is automatically reclaimed without a manual tool; live owner remains protected',()=>withHome(dir=>{
  const lease=createPlannerRunLease({dataDir:dir,now:()=>T})
  const live=lease.acquire()
  assert.equal(live.ok,true)
  assert.equal(lease.acquire().ok,false)
  assert.equal(recoverPlannerLockOffline(dir,'autonomous-planner-run.lock',{confirmedAllStopped:true}).ok,false,'live owner may not be removed')
  assert.equal(lease.release(live).ok,true)
  const folder=join(dir,'autonomous-planner-run.lock');mkdirSync(folder)
  writeFileSync(join(folder,'owner.json'),JSON.stringify({version:1,kind:'autonomous-planner-run.lock',token:'123e4567-e89b-12d3-a456-426614174000',pid:2147483640,at:T}))
  assert.equal(lease.inspect().needsReview,true)
  const auto=lease.acquire()
  assert.equal(auto.ok,true,'crashed run owner should recover automatically on next attempt')
  assert.equal(lease.inspect().autoRecovery.count,1)
  assert.equal(lease.release(auto).ok,true)
  assert.equal(recoverPlannerLockOffline(dir,'autonomous-planner-run.lock').ok,false)
  assert.equal(recoverPlannerLockOffline(dir,'autonomous-planner-run.lock',{confirmedAllStopped:true}).removed,false)
  assert.equal(lease.acquire().ok,true)
}))

test('symlink lock and incomplete lock cannot be automatically reclaimed',()=>withHome(dir=>{
  const target=join(dir,'target');mkdirSync(target)
  const link=join(dir,'autonomous-planner-run.lock')
  try{symlinkSync(target,link,'dir')}catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e}
  const before=readFileSync?true:false
  assert.equal(createPlannerRunLease({dataDir:dir}).inspect().needsReview,true)
  assert.equal(recoverPlannerLockOffline(dir,'autonomous-planner-run.lock',{confirmedAllStopped:true}).ok,false)
  assert.equal(existsSync(target),true)
  assert.equal(before,true)
}))


test('startup recovery reclaims a real exited Node owner, without replaying its previous model turn',()=>withHome(async dir=>{
  const moduleUrl=new URL('../lib/life-planner-atomic.mjs',import.meta.url).href
  const code=`import {createPlannerRunLease} from ${JSON.stringify(moduleUrl)};
    const lease=createPlannerRunLease({dataDir:process.env.DSH_TEST_ROOT});
    if(!lease.acquire().ok)process.exit(2);
    process.exit(0);`
  const {spawnSync}=await import('node:child_process')
  const child=spawnSync(process.execPath,['--input-type=module','-e',code],
    {env:{...process.env,DSH_TEST_ROOT:dir},encoding:'utf8'})
  assert.equal(child.status,0,child.stderr)
  assert.equal(existsSync(join(dir,'autonomous-planner-run.lock')),true)
  const clock={value:T};let modelCalls=0
  const x=setup(dir,async()=>{modelCalls++;return '{"action":"skip","reason":"自主休息"}'},clock)
  const start=x.planner.start()
  assert.equal(start.running,true)
  const status=x.planner.status()
  assert.equal(status.runLease.held,false)
  assert.equal(status.runLease.autoRecovery.count,1)
  assert.equal(modelCalls,0,'recovering a scheduling lease must not replay an interrupted model/tool call')
  x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'verified-incoming'})
  const result=await x.planner.tick({force:true})
  assert.equal(result.result,'voluntary-rest')
  assert.equal(modelCalls,1)
  assert.equal(x.planner.status().runLease.held,false)
  x.planner.stop()
}))

test('invalid abandoned owner, unknown PID, extra files and a recovery guard fail closed',()=>withHome(dir=>{
  const lease=createPlannerRunLease({dataDir:dir,now:()=>T})
  const lock=join(dir,'autonomous-planner-run.lock');mkdirSync(lock)
  writeFileSync(join(lock,'owner.json'),'not-json')
  assert.equal(lease.recoverAbandoned().recovered,false)
  assert.equal(lease.acquire().reason,'planner-lock-review-required')
  rmSync(lock,{recursive:true,force:true})
  mkdirSync(lock)
  writeFileSync(join(lock,'owner.json'),JSON.stringify({version:1,kind:'autonomous-planner-run.lock',token:'123e4567-e89b-12d3-a456-426614174000',pid:2147483640,at:T}))
  writeFileSync(join(lock,'unexpected'),'do-not-delete')
  assert.equal(lease.recoverAbandoned().recovered,false)
  assert.equal(existsSync(join(lock,'unexpected')),true)
  rmSync(lock,{recursive:true,force:true})
  mkdirSync(lock)
  writeFileSync(join(lock,'owner.json'),JSON.stringify({version:1,kind:'autonomous-planner-run.lock',token:'123e4567-e89b-12d3-a456-426614174000',pid:2147483640,at:T}))
  const guard=join(dir,'autonomous-planner-run-recovery.lock');mkdirSync(guard)
  writeFileSync(join(guard,'owner.json'),JSON.stringify({version:1,kind:'autonomous-planner-run-recovery.lock',token:'123e4567-e89b-12d3-a456-426614174000',pid:process.pid,at:T}))
  assert.equal(lease.acquire().reason,'planner-recovery-in-progress')
  assert.equal(existsSync(lock),true)
}))

test('stale global planner lock never clears an unrelated outbound/ledger lock',()=>withHome(dir=>{
  for(const name of ['autonomous-planner-run.lock','life-opportunities-ledger.lock']){
    const lock=join(dir,name);mkdirSync(lock)
    writeFileSync(join(lock,'owner.json'),JSON.stringify({version:1,kind:name,token:'123e4567-e89b-12d3-a456-426614174000',pid:2147483640,at:T}))
  }
  const lease=createPlannerRunLease({dataDir:dir,now:()=>T})
  assert.equal(lease.recoverAbandoned().recovered,true)
  assert.equal(existsSync(join(dir,'life-opportunities-ledger.lock')),true)
  assert.equal(lease.acquire().ok,true)
}))


test('two independent DSH instances racing an abandoned run lock cannot double-spend quota',()=>withHome(async dir=>{
  const stale=join(dir,'autonomous-planner-run.lock');mkdirSync(stale)
  writeFileSync(join(stale,'owner.json'),JSON.stringify({version:1,kind:'autonomous-planner-run.lock',token:'123e4567-e89b-12d3-a456-426614174000',pid:2147483640,at:T}))
  const logFile=join(dir,'calls.log'),worker=fileURLToPath(new URL('./fixtures/life-planner-multiprocess-worker.mjs',import.meta.url))
  writeFileSync(logFile,'')
  const launch=who=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[worker,dir,logFile,who],{stdio:['ignore','pipe','pipe']})
    let stdout='',stderr=''
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk)
    child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(stdout.trim())):reject(Error(stderr||stdout)))
  })
  const [a,b]=await Promise.all([launch('a'),launch('b')])
  assert.equal(readFileSync(logFile,'utf8').trim().split('\n').filter(Boolean).length,1)
  assert.equal(JSON.parse(readFileSync(join(dir,'autonomous-planner.json'),'utf8')).runs,1)
  assert.equal(existsSync(join(dir,'autonomous-planner-run.lock')),false)
  assert.equal(existsSync(join(dir,'autonomous-planner-run-recovery.lock')),false)
  assert.equal([a,b].filter(x=>x.result?.action==='skip').length,1)
}))

test('crash recovery never refunds a prior reserved model decision',()=>withHome(dir=>{
  const stale=join(dir,'autonomous-planner-run.lock');mkdirSync(stale)
  writeFileSync(join(stale,'owner.json'),JSON.stringify({version:1,kind:'autonomous-planner-run.lock',token:'123e4567-e89b-12d3-a456-426614174000',pid:2147483640,at:T}))
  const before={version:1,day:new Date(T).toLocaleDateString('en-CA'),runs:4,lifeRuns:4,socialRuns:0,willingnessRuns:0,
    lastAt:T,recent:[],willingnessBillingVersion:2}
  const file=join(dir,'autonomous-planner.json')
  writeFileSync(file,JSON.stringify(before))
  const lease=createPlannerRunLease({dataDir:dir,now:()=>T})
  assert.equal(lease.recoverAbandoned().recovered,true)
  const after=JSON.parse(readFileSync(file,'utf8'))
  assert.deepEqual(after,before)
  assert.equal(lease.inspect().autoRecovery.count,1)
}))


test('crashed recovery guardian is not misreported as normal cooldown or silently deleted',()=>withHome(dir=>{
  const lock=join(dir,'autonomous-planner-run.lock');mkdirSync(lock)
  writeFileSync(join(lock,'owner.json'),JSON.stringify({version:1,kind:'autonomous-planner-run.lock',token:'123e4567-e89b-12d3-a456-426614174000',pid:2147483640,at:T}))
  const guard=join(dir,'autonomous-planner-run-recovery.lock');mkdirSync(guard)
  writeFileSync(join(guard,'owner.json'),JSON.stringify({version:1,kind:'autonomous-planner-run-recovery.lock',token:'123e4567-e89b-12d3-a456-426614174000',pid:2147483640,at:T}))
  const lease=createPlannerRunLease({dataDir:dir,now:()=>T})
  assert.equal(lease.recoverAbandoned().reason,'planner-recovery-guard-orphaned')
  assert.equal(lease.acquire().reason,'planner-recovery-guard-orphaned')
  assert.equal(lease.inspect().autoRecovery.lastError,'planner-recovery-guard-orphaned')
  assert.equal(existsSync(lock),true)
}))
