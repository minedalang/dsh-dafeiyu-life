import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {LIFE_ACTION_NAMES,LIFE_VERIFIED_WRITE_ACTIONS,LIFE_PRIVATE_ACTIONS,verifiedLifeActionEvent} from '../lib/life-action-memory.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeMemoryCoordinator} from '../lib/life-memory-coordinator.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createLifeVideoActionBridge} from '../lib/life-video-action-bridge.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
const A='1'.repeat(16),B='2'.repeat(16),UID='1234567',BV='BV1abcde1234'
const NOW=Date.now()-1000,DAY=86400000
const withHome=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-closure-verified-'));try{await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const proof=(action,i,verified=true)=>verifiedLifeActionEvent({action,accountTag:A,sourceId:'verified-receipt:'+i,
    bvid:BV,title:'已核验公开视频',recipientUid:UID,at:NOW,verified})

test('ALL registered Life action types have one verified event → episode → authorized recall route',()=>withHome(async dir=>{
  let scope=A
  const memory=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>scope,now:()=>NOW})
  const expected=Object.keys(LIFE_ACTION_NAMES)
  assert.equal(expected.length,20)
  assert.equal(new Set(expected).size,expected.length)
  assert.equal(new Set(LIFE_VERIFIED_WRITE_ACTIONS).size,LIFE_VERIFIED_WRITE_ACTIONS.length)
  assert.equal(LIFE_VERIFIED_WRITE_ACTIONS.every(x=>expected.includes(x)),true)
  assert.equal(LIFE_PRIVATE_ACTIONS.every(x=>LIFE_VERIFIED_WRITE_ACTIONS.includes(x)),true)
  for(const [i,kind] of expected.entries()){
    const event=proof(kind,i)
    assert.ok(event,kind)
    assert.equal(memory.recordEvents([event]).added,1,kind)
    assert.equal(memory.recordEvents([event]).added,0,'replayed verified receipt must deduplicate')
    assert.equal(proof(kind,i,false),null,'uncertain/failed attempts must not make action memory')
  }
  const episodes=memory.semanticCandidates({domain:'main-session',role:'owner'})
  assert.equal(episodes.filter(x=>x.kind==='action').length,expected.length)
  assert.ok(memory.recall({query:'已核验公开视频',domain:'main-session'}).length>0)
  assert.equal(memory.semanticCandidates({domain:'bili-life',role:'stranger',actorUid:UID}).filter(x=>x.kind==='action').length,0)
  assert.equal(memory.semanticCandidates({domain:'bili-dm',role:'friend',actorUid:UID}).filter(x=>x.kind==='action').length,0)
  scope=B
  assert.equal(memory.semanticCandidates({domain:'main-session'}).filter(x=>x.kind==='action').length,0,'new login may not read the old account')
  scope=A
  memory.close()
}))

test('the existing coordinator replays after a failed memory sink without repeating an external write',()=>withHome(async dir=>{
  let rejects=true,recorded=0
  const normal=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>A})
  const coordinator=createLifeMemoryCoordinator({dataDir:dir,getAccountTag:()=>A,
    memoryGateway:{recordEvents(events){if(rejects)throw Error('offline-episode-store');recorded++;return normal.recordEvents(events)}},
    lifeReflection:{addEvents:()=>({ok:true})},logger:{warn(){}},now:()=>Date.now()})
  const event=proof('video_like','reconciliation')
  const failed=await coordinator.recordEvents([event],{reflect:false})
  assert.equal(failed.ok,false)
  assert.equal(coordinator.status().pending,1)
  rejects=false
  const flushed=await coordinator.flush()
  assert.equal(flushed.ok,true)
  assert.equal(coordinator.status().pending,0)
  assert.equal(recorded,1)
  assert.equal(normal.semanticCandidates({domain:'main-session'}).filter(e=>e.kind==='action').length,1)
  assert.equal((await coordinator.recordEvents([event],{reflect:false})).duplicate,true)
  normal.close()
}))

test('verified write projects into the original Life wake ledger; read-only actions do not fake platform completion',()=>withHome(async dir=>{
  const ev=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>NOW})
  for(const [i,kind] of LIFE_VERIFIED_WRITE_ACTIONS.entries()){
    const sourceRef=(i+1).toString(16).repeat(16).slice(0,16)
    assert.equal(ev.recordVerifiedCompletion({kind,sourceRef}).ok,true,kind)
    assert.equal(ev.recordVerifiedCompletion({kind,sourceRef}).followupQueued,false)
  }
  assert.equal(ev.recordVerifiedCompletion({kind:'read_video_metadata',sourceRef:'f'.repeat(16)}).ok,false)
  assert.equal(ev.recordVerifiedCompletion({kind:'unknown',sourceRef:'f'.repeat(16)}).ok,false)
  assert.equal(ev.status().timeline.filter(x=>x.verifiedActionKind).length,LIFE_VERIFIED_WRITE_ACTIONS.length)
}))

test('video bridge waits for life-memory admission; platform status and unknown are independent',async t=>{
  let onMemoryCalls=0,requestCount=0
  const bridge=createLifeVideoActionBridge({getAccountUid:()=>UID,getAccountTag:()=>A,enabled:()=>true,
    choose:async()=>({ok:true,proof:{id:'verified-id'}}),verify:()=>({ok:true}),receipt:()=>{},
    verifyPlatformState:async()=>true,
    onVerifiedAction:async()=>{onMemoryCalls++;await new Promise(resolve=>setTimeout(resolve,5));return {ok:false,reason:'memory-read-only'}}})
  t.after(()=>bridge.stop())
  await bridge.start()
  async function post(route,body){requestCount++;const env=bridge.env()
    const response=await fetch(env.BILI_LIFE_ACTION_URL+route,{method:'POST',
      headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)})
    return {code:response.status,...await response.json()}
  }
  const grant=await post('/life-action',{tool:'bili_video_like',target:BV,uid:UID})
  const done=await post('/life-action-result',{grant:grant.grant,uid:UID,ok:true})
  assert.equal(done.status,'verified','already verified platform action stays verified despite memory degradation')
  assert.equal(done.memoryQueued,false,'memory failure is observable, not claimed as successfully queued')
  assert.equal(onMemoryCalls,1)
  assert.equal((await post('/life-action-result',{grant:grant.grant,uid:UID,ok:true})).code,409,'no retry after result')
  const another=await post('/life-action',{tool:'bili_video_like',target:BV,uid:UID})
  const unknown=await post('/life-action-result',{grant:another.grant,uid:UID,ok:false})
  assert.equal(unknown.status,'uncertain')
  assert.equal(Object.hasOwn(unknown,'memoryQueued'),false)
  assert.equal(onMemoryCalls,1)
  assert.equal(requestCount,5)
})

test('accepted TODO read cannot be projected as a new account after an async credential switch',()=>withHome(async dir=>{
  let current=A,projected=0
  const todo={id:'todo-life-123',type:'search_videos',title:'DeepSeek 视频',topic:'DeepSeek',
    searchGoal:'DeepSeek',status:'open',dueAt:0}
  const config={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
    autonomousPlannerDailyLimit:12,autonomousPlannerMinutes:5,
    autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>NOW,getConfig:()=>config,
    getLifeAccountTag:()=>current,getTodos:()=>[todo],getLifeEvents:()=>[],
    getLifeEventStatus:()=>({pending:0}),getLifeCapabilities:()=>[],
    invokeModel:async()=>JSON.stringify({action:'execute_read',id:todo.id,reason:'核实此前接受的待办'}),
    executeRead:async()=>{current=B;return {ok:true}},updateTodo:async()=>({ok:true}),
    reflect:async()=>({ok:true}),onVerifiedRead:async()=>{projected++;return {ok:true}}})
  const outcome=await planner.tick({force:true})
  assert.equal(outcome.result,'done')
  assert.equal(projected,0,'account A action must never be remembered under B after await')
}))
