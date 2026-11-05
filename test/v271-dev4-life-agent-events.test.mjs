import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeCapabilities} from '../lib/life-capabilities.mjs'

const A='a'.repeat(16),B='b'.repeat(16)
const start=()=>{const d=new Date('2026-11-05T12:00:00');return d.getTime()}
const withHome=async work=>{const dir=mkdtempSync(join(tmpdir(),'dev4-life-agent-'));try{return await work(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

function rig(dir,{mode='active',model=async()=>JSON.stringify({action:'use_capability',capability:'bilibili.video-explore',reason:'想探索新作品'}),onExplore=()=>({started:true}),dayLimit=8}={}){
  let time=start(),account=A,calls=0,launches=0
  const clock=()=>time
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>account,now:clock})
  const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:mode,autonomousPlannerMinutes:5,
    autonomousPlannerDailyLimit:dayLimit,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
  const skills=createLifeCapabilities([{id:'bilibili.video-explore',risk:'delegated-existing-permissions',available:()=>({ok:true}),execute:()=>{launches++;return onExplore()},description:'探索公开视频'}])
  const planner=createAutonomousPlanner({dataDir:dir,now:clock,getConfig:()=>cfg,getTodos:()=>[],
    getLifeAccountTag:()=>account,getLifeEvents:()=>events.peek(),offerLifeWake:x=>events.offer(x),
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),getLifeEventStatus:()=>events.status(),
    recordVideoStart:()=>events.recordVideoStart(),getLifeCapabilities:()=>skills.list(),
    runLifeCapability:id=>skills.run(id),
    invokeModel:async prompt=>{calls++;return await model(prompt)},executeRead:async()=>({ok:true}),updateTodo:()=>{},reflect:async()=>({ok:true})})
  return {planner,events,cfg,get calls(){return calls},get launches(){return launches},advance:ms=>{time+=ms},switchAccount:x=>{account=x}}
}

test('anonymous event inbox deduplicates; never stores raw source keys and partitions accounts',()=>withHome(dir=>{
  let tag=A,t=start()
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:()=>t})
  const source='private-uid-99887766-and-private-message-DO-NOT-STORE'
  const first=events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:source})
  assert.equal(first.created,true)
  assert.equal(events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:source}).created,false)
  assert.equal(events.peek().length,1)
  const file=join(dir,'life-agent-events',A+'.json')
  assert.doesNotMatch(readFileSync(file,'utf8'),/99887766|DO-NOT-STORE|private-uid/)
  tag=B
  assert.equal(events.peek().length,0)
  events.offer({kind:'quiet-window',platform:'douyin',sourceKey:'window-23'})
  assert.equal(events.status().pending,1)
  tag=A
  assert.equal(events.status().pending,1)
  assert.equal(events.settle([first.id]).updated,1)
  assert.equal(events.status().pending,0)
  tag=B
  assert.equal(events.status().pending,1)
  t+=8*86_400_000
  assert.equal(events.peek().length,0,'old wakes expire instead of becoming permanent memories')
}))

test('unknown event kinds, unsafe account and broken ledger fail closed',()=>withHome(dir=>{
  let tag=''
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:start})
  assert.throws(()=>events.offer({kind:'manual-wake',sourceKey:'a'}),/verified account/)
  tag=A
  assert.throws(()=>events.offer({kind:'send-private-message',sourceKey:'x'}),/Untrusted/)
  assert.throws(()=>events.offer({kind:'manual-wake',platform:'../private',sourceKey:'x'}),/Untrusted/)
  events.offer({kind:'quiet-window',sourceKey:'x'})
  writeFileSync(join(dir,'life-agent-events',A+'.json'),'malformed')
  assert.throws(()=>events.peek())
}))

test('real active mode can launch video after one model choice, without timer-commanded launching',()=>withHome(async dir=>{
  const r=rig(dir)
  assert.equal(r.launches,0)
  const result=await r.planner.tick({force:true})
  assert.equal(result.action,'use_capability')
  assert.equal(result.result,'capability-launched')
  assert.equal(r.launches,1)
  assert.equal(r.events.status().videoStartsToday,1)
  assert.equal(r.events.status().pending,0)
  assert.equal(r.planner.status().modelInputChars>0,true)
  assert.equal(r.planner.status().modelOutputChars>0,true)
  const second=await r.planner.tick({force:true})
  assert.equal(second.skipped,'nothing-to-do','no duplicate wake or second agent after launch')
  assert.equal(r.launches,1)
  assert.equal(r.calls,1)
}))

test('shadow mode records autonomous intent but never launches video',()=>withHome(async dir=>{
  const r=rig(dir,{mode:'shadow'})
  const out=await r.planner.tick({force:true})
  assert.equal(out.result,'shadow-would-explore')
  assert.equal(r.launches,0)
  assert.equal(r.events.status().videoStartsToday,0)
  assert.equal(r.events.status().pending,0)
}))

test('voluntary silence is real: skip consumes the wake without touching video agent',()=>withHome(async dir=>{
  const r=rig(dir,{model:async()=>JSON.stringify({action:'skip',reason:'今天想休息'})})
  const out=await r.planner.tick({force:true})
  assert.equal(out.action,'skip')
  assert.equal(r.launches,0)
  assert.equal(r.events.status().pending,0)
  assert.equal((await r.planner.tick({force:true})).skipped,'nothing-to-do')
  r.advance(3*3600_000)
  assert.equal((await r.planner.tick({force:true})).action,'skip','new life window is an opportunity, not a watch order')
  assert.equal(r.calls,2)
}))

test('disabled mode, owner-only reminder, and explicit opportunities-only path cannot launch video',()=>withHome(async dir=>{
  const r=rig(dir,{mode:'off'})
  assert.equal((await r.planner.tick({force:true})).skipped,'nothing-to-do')
  assert.equal(r.launches,0)
  r.cfg.lifeAgentMode='active'
  assert.equal((await r.planner.tick({force:true,todosOnly:true})).skipped,'nothing-to-do')
  assert.equal((await r.planner.tick({force:true,opportunitiesOnly:true})).skipped,'nothing-to-do')
  assert.equal(r.calls,0)
}))

test('model failure preserves unprocessed event for bounded retry; malformed output cannot launch',()=>withHome(async dir=>{
  let fail=true
  const r=rig(dir,{model:async()=>{if(fail)throw Error('model offline');return '{nonsense}'}})
  const first=await r.planner.tick({force:true})
  assert.equal(first.ok,false)
  assert.equal(r.events.status().pending,1)
  fail=false
  const second=await r.planner.tick({force:true})
  assert.equal(second.action,'skip')
  assert.equal(r.launches,0)
  assert.equal(r.events.status().pending,0)
  assert.equal(r.planner.status().runs,2)
}))

test('changing accounts during model deliberation blocks execution and does not settle old-account wake',()=>withHome(async dir=>{
  let r
  r=rig(dir,{model:async()=>{r.switchAccount(B);return JSON.stringify({action:'use_capability',capability:'bilibili.video-explore',reason:'继续'})}})
  const out=await r.planner.tick({force:true})
  assert.equal(out.ok,false)
  assert.match(out.error,/账号已变化/)
  assert.equal(r.launches,0)
  assert.equal(r.events.status().pending,0,'new account has no leaked wake')
  r.switchAccount(A)
  assert.equal(r.events.status().pending,1,'old-account wake remains pending')
}))

test('active mode has two autonomous video launches/day, with a cross-wake cooldown',()=>withHome(async dir=>{
  const r=rig(dir)
  await r.planner.tick({force:true})
  r.advance(3*3600_000)
  await r.planner.tick({force:true})
  assert.equal(r.launches,2)
  r.advance(3*3600_000)
  assert.equal((await r.planner.tick({force:true})).skipped,'nothing-to-do')
  assert.equal(r.launches,2)
}))

test('video launch failure is not claimed as a verified video event',()=>withHome(async dir=>{
  const r=rig(dir,{onExplore:()=>({started:false,error:'headless not ready'})})
  const out=await r.planner.tick({force:true})
  assert.equal(out.result,'capability-not-started')
  assert.equal(r.events.status().videoStartsToday,0)
}))


test('platform-neutral skill registry allows a second fake platform without another planner',()=>withHome(async dir=>{
  let invoked=0
  const T=start(),tag=A
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:()=>T})
  const skills=createLifeCapabilities([{
    id:'mocksite.video-explore',risk:'read',description:'fake second platform, read only',
    available:()=>({ok:true}),execute:()=>{invoked++;return {started:true}}
  }])
  const p=createAutonomousPlanner({dataDir:dir,now:()=>T,
    getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:8,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
    getTodos:()=>[],invokeModel:async prompt=>{assert.match(prompt,/mocksite.video-explore/);return JSON.stringify({action:'use_capability',capability:'mocksite.video-explore'})},
    getLifeAccountTag:()=>tag,getLifeEvents:()=>events.peek(),offerLifeWake:x=>events.offer(x),
    settleLifeEvents:ids=>events.settle(ids),getLifeEventStatus:()=>events.status(),
    getLifeCapabilities:()=>skills.list(),runLifeCapability:id=>skills.run(id),recordVideoStart:()=>events.recordVideoStart(),
    executeRead:()=>({ok:true}),updateTodo:()=>{},reflect:()=>({ok:true})})
  assert.equal((await p.tick({force:true})).result,'capability-launched')
  assert.equal(invoked,1)
  assert.equal(skills.run('invented.follow-private-user').started,false)
}))

test('capability availability is rechecked at execution and cannot be invented by model',()=>withHome(()=>{
  let permitted=true,calls=0
  const skills=createLifeCapabilities([{id:'mocksite.public-read',risk:'read',description:'mock',available:()=>({ok:permitted}),execute:()=>{calls++;return {started:true}}}])
  assert.equal(skills.list().length,1)
  permitted=false
  assert.deepEqual(skills.list(),[])
  assert.equal(skills.run('mocksite.public-read').started,false)
  assert.equal(skills.run('mocksite.unknown').reason,'unknown-capability')
  assert.equal(calls,0)
  assert.throws(()=>createLifeCapabilities([{id:'evil',risk:'read',available:()=>({ok:true}),execute:()=>{}}]))
}))
