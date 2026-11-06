import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,symlinkSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {withLifeOpportunityLedgerLock,recoverPlannerLockOffline} from '../lib/life-planner-atomic.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'

const T=Date.parse('2026-11-06T14:00:00Z')
const credential={dedeuserid:'13910842',sessdata:'secret-should-not-leak'}
const ACCOUNT=discussionAccountTag(credential)
const BV='BV1abcde1234'
const makeHome=async work=>{const dir=mkdtempSync(join(tmpdir(),'life-receipt-'));try{return await work(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const evidence=()=>[{source:'interest-milestone',topic:'电子音乐',stage:'growing',bvid:BV,at:new Date(T-60_000).toISOString(),evidenceCount:4,evidenceDays:3}]
const opportunities=(dir,clock,creds=()=>credential)=>createLifeOpportunities({stateDir:dir,getCredential:creds,getInterestEvidence:evidence,now:()=>clock.value})
const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:8,
  autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
function life(dir,clock,{model=async()=>'{"action":"skip"}',skills=()=>[{id:'mocksite.video-explore',risk:'read'}],launch=()=>({started:false}),account=()=>ACCOUNT}={}){
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:account,now:()=>clock.value})
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock.value,getConfig:()=>cfg,getLifeAccountTag:account,
    getTodos:()=>[],getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:x=>events.recordDecision(x),
    getLifeCapabilities:skills,runLifeCapability:launch,recordVideoStart:()=>events.recordVideoStart(),
    invokeModel:model,executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
  return {events,planner}
}

test('life-opportunities ledger is atomic; collision never pretends a user defer or verified read',()=>makeHome(dir=>{
  const clock={value:T},store=opportunities(dir,clock),id=store.list()[0].id
  const lock=withLifeOpportunityLedgerLock(dir,()=>{
    const result=store.decide(id,'inspect',{result:'verified-metadata',title:'真实标题'})
    assert.deepEqual(result,{ok:false,error:'life-opportunities-ledger-busy'})
    assert.equal(existsSync(join(dir,'life-opportunities',ACCOUNT+'.json')),false)
    return {ok:true}
  })
  assert.equal(lock.ok,true)
  assert.equal(store.decide(id,'inspect',{result:'verified-metadata',title:'真实标题'}).ok,true)
  assert.equal(store.recentReads()[0].title,'真实标题')
  assert.equal(existsSync(join(dir,'life-opportunities-ledger.lock')),false)
  assert.equal(readFileSync(join(dir,'life-opportunities',ACCOUNT+'.json'),'utf8').includes(credential.sessdata),false)
}))

test('two account sources remain isolated with original v1 schemas and independent decisions',()=>makeHome(dir=>{
  const clock={value:T},alt={dedeuserid:'9281505',sessdata:'other-session-secret'}
  const a=opportunities(dir,clock),b=opportunities(dir,clock,()=>alt)
  const id=a.list()[0].id
  assert.equal(a.decide(id,'dismiss').ok,true)
  assert.equal(a.list().length,0)
  assert.equal(b.list().length,1)
  assert.equal(b.decide(id,'inspect',{result:'verified-metadata',title:'公开标题'}).ok,true)
  assert.equal(a.recentReads().length,0)
  assert.equal(b.recentReads().length,1)
  assert.equal(JSON.parse(readFileSync(join(dir,'life-opportunities',ACCOUNT+'.json'),'utf8')).version,1)
}))

test('unsafe opportunity directory symlink is rejected without reading or overwriting another location',()=>makeHome(dir=>{
  const clock={value:T},target=join(dir,'other'),folder=join(dir,'life-opportunities')
  const id=opportunities(dir,clock).list()[0].id
  mkdirSync(target)
  const sentinel=join(target,ACCOUNT+'.json')
  writeFileSync(sentinel,JSON.stringify({version:1,decisions:[{secret:'outside'}],intentions:[]}))
  try{symlinkSync(target,folder,'dir')}catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e}
  const store=opportunities(dir,clock)
  assert.throws(()=>store.list(),/生活契机目录不安全/)
  assert.throws(()=>store.decide(id,'skip'),/生活契机目录不安全/)
  assert.match(readFileSync(sentinel,'utf8'),/outside/)
}))

test('unknown opportunity writer residue is not released automatically and requires explicit offline recovery',()=>makeHome(dir=>{
  const folder=join(dir,'life-opportunities-ledger.lock');mkdirSync(folder)
  writeFileSync(join(folder,'owner.json'),JSON.stringify({version:1,kind:'life-opportunities-ledger.lock',
    token:'123e4567-e89b-12d3-a456-426614174000',pid:2147483640,at:T}))
  const store=opportunities(dir,{value:T})
  assert.equal(store.decide(store.list()[0].id,'defer').error,'life-opportunities-ledger-busy')
  assert.equal(recoverPlannerLockOffline(dir,'life-opportunities-ledger.lock').ok,false)
  assert.equal(recoverPlannerLockOffline(dir,'life-opportunities-ledger.lock',{confirmedAllStopped:true}).removed,true)
  assert.equal(store.decide(store.list()[0].id,'defer').ok,true)
}))

test('model returned a valid decision but preflight failed: event retries, no tool side effect',()=>makeHome(async dir=>{
  const clock={value:T};let checks=0,launched=0
  const x=life(dir,clock,{model:async()=>JSON.stringify({action:'use_capability',capability:'mocksite.video-explore'}),
    skills:()=>{checks++;if(checks>=2)throw Error('capability registry failed');return [{id:'mocksite.video-explore'}]},
    launch:()=>{launched++;return {started:true}}})
  x.events.offer({kind:'manual-wake',platform:'life',sourceKey:'ask-one'})
  const r=await x.planner.tick({force:true})
  assert.equal(r.ok,false);assert.equal(r.diagnosticCode,'action-preflight-error')
  assert.equal(launched,0)
  const row=x.events.status().recent.find(e=>e.kind==='manual-wake')
  assert.equal(row.state,'retryable');assert.equal(row.result,'preflight-check-failed');assert.equal(row.retryAt,T+5*60_000)
  assert.equal(x.events.peek().length,0)
  assert.equal(x.events.status().needsReview,0)
}))

test('unknown outcome after a capability adapter was entered freezes source; no implicit re-execution',()=>makeHome(async dir=>{
  const clock={value:T};let launched=0
  const x=life(dir,clock,{model:async()=>JSON.stringify({action:'use_capability',capability:'mocksite.video-explore'}),
    launch:()=>{launched++;throw Error('outcome cannot be established')}})
  const offered=x.events.offer({kind:'manual-wake',platform:'life',sourceKey:'unknown-outcome'})
  const r=await x.planner.tick({force:true})
  assert.equal(r.ok,false);assert.equal(r.diagnosticCode,'action-outcome-unknown')
  assert.equal(launched,1)
  const status=x.events.status()
  assert.equal(status.needsReview,1)
  assert.equal(status.recent.find(e=>e.kind==='manual-wake').state,'review')
  assert.equal(status.recent.find(e=>e.kind==='manual-wake').result,'action-outcome-unknown')
  assert.equal(x.events.peek().length,0)
  assert.equal(x.events.offer({kind:'manual-wake',platform:'life',sourceKey:'unknown-outcome'}).created,false)
  assert.equal(readFileSync(join(dir,'life-agent-events',ACCOUNT+'.json'),'utf8').includes('outcome cannot be established'),false)
  assert.equal(readFileSync(join(dir,'life-agent-events',ACCOUNT+'.json'),'utf8').includes('unknown-outcome'),false)
  assert.equal(offered.ok,true)
}))

test('a verified voluntary rest still closes the event and never becomes technical review',()=>makeHome(async dir=>{
  const clock={value:T},x=life(dir,clock)
  x.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'private-uid-123'})
  const result=await x.planner.tick({force:true})
  assert.equal(result.result,'voluntary-rest')
  assert.equal(x.events.status().considered,1)
  assert.equal(x.events.status().needsReview,0)
}))

test('account switch during an asynchronous model turn keeps original account event open',()=>makeHome(async dir=>{
  const clock={value:T};let active=ACCOUNT
  const x=life(dir,clock,{account:()=>active,model:async()=>{active='b'.repeat(16);return '{"action":"skip"}'}})
  x.events.offer({kind:'manual-wake',platform:'life',sourceKey:'first-account-only'})
  const result=await x.planner.tick({force:true})
  assert.equal(result.ok,false)
  active=ACCOUNT
  assert.equal(x.events.status().pending,1)
  assert.equal(x.events.status().needsReview,0)
}))

test('offline event review can close exactly one uncertain event but never requeue or claim a send',()=>makeHome(dir=>{
  const clock={value:T}
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>ACCOUNT,now:()=>clock.value})
  const a=events.offer({kind:'manual-wake',platform:'life',sourceKey:'possible-in-flight'})
  const b=events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'different-private-event'})
  events.settle([a.id],'execution-uncertain')
  assert.deepEqual(events.inspectReviewOffline().map(x=>x.id),[a.id])
  assert.equal(events.closeReviewOffline(a.id).reason,'explicit-shutdown-confirmation-required')
  assert.equal(events.closeReviewOffline(b.id,{confirmedAllStopped:true}).reason,'event-not-under-review')
  assert.equal(events.closeReviewOffline(a.id,{confirmedAllStopped:true}).closed,true)
  assert.equal(events.status().needsReview,0)
  assert.equal(events.status().pending,1)
  assert.equal(events.offer({kind:'manual-wake',platform:'life',sourceKey:'possible-in-flight'}).created,false)
  assert.equal(events.status().recent.find(e=>e.kind==='manual-wake').result,'review-closed-no-replay')
}))

test('offline review CLI is scoped, requires explicit shutdown to close and never makes platform requests',()=>makeHome(async dir=>{
  const {spawnSync}=await import('node:child_process')
  const {fileURLToPath}=await import('node:url')
  const tool=fileURLToPath(new URL('../tools/dev4-life-events-offline-review.mjs',import.meta.url))
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>ACCOUNT,now:()=>T})
  const row=events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'private-msg-do-not-output'})
  events.settle([row.id],'execution-uncertain')
  const run=(...args)=>spawnSync(process.execPath,[tool,'--data-dir',dir,'--account-tag',ACCOUNT,...args],{encoding:'utf8'})
  const inspected=run('--inspect')
  assert.equal(inspected.status,0)
  assert.deepEqual(JSON.parse(inspected.stdout).review.map(x=>x.id),[row.id])
  assert.equal(inspected.stdout.includes('private-msg-do-not-output'),false)
  assert.notEqual(run('--close',row.id).status,0)
  assert.equal(events.status().needsReview,1)
  assert.equal(JSON.parse(run('--close',row.id,'--confirm-all-stopped').stdout).ok,true)
  assert.equal(events.status().needsReview,0)
}))

test('symlinked life-events folder cannot be read as an authoritative source',()=>makeHome(dir=>{
  const target=join(dir,'target-events'),folder=join(dir,'life-agent-events')
  mkdirSync(target)
  writeFileSync(join(target,ACCOUNT+'.json'),JSON.stringify({version:1,events:[],videoStarts:[]}))
  try{symlinkSync(target,folder,'dir')}catch(e){if(['EPERM','EACCES'].includes(e.code))return;throw e}
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>ACCOUNT,now:()=>T})
  assert.throws(()=>events.status(),/Life Agent event folder unsafe/)
  assert.throws(()=>events.inspectReviewOffline(),/Life Agent event folder unsafe/)
}))

test('an accepted read-only task with no success receipt is reported as failure, not a completed action',()=>makeHome(async dir=>{
  const id='123e4567-e89b-12d3-a456-426614174000',clock={value:T}
  let calls=0,defers=0
  const todo={id,type:'inspect_my_space',status:'open',title:'了解自己公开主页',source:'owner'}
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock.value,getConfig:()=>cfg,getLifeAccountTag:()=>ACCOUNT,
    getTodos:()=>[todo],invokeModel:async()=>JSON.stringify({action:'execute_read',id}),
    executeRead:async()=>{calls++;return {ok:false,reason:'metadata-timeout'}},
    updateTodo:async()=>{defers++;return {ok:true}},reflect:async()=>({ok:false})})
  const result=await planner.tick({force:true,todosOnly:true})
  assert.equal(result.ok,false)
  assert.equal(result.result,'failed')
  assert.equal(result.diagnosticCode,'todo-read-failed')
  assert.equal(calls,1);assert.equal(defers,1)
  assert.equal(planner.status().runs,1)
  assert.equal(planner.status().lastResult,'execute_read / failed')
}))
