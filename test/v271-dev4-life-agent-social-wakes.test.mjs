import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

const A='a'.repeat(16), B='b'.repeat(16)
const CLOCK=Date.parse('2026-11-05T12:00:00.000Z')
const withDir=async fn=>{const d=mkdtempSync(join(tmpdir(),'fish-life-social-'));try{await fn(d)}finally{rmSync(d,{recursive:true,force:true})}}
function make(dir,{mode='active',model=(prompt)=>{
  const options=JSON.parse(prompt.split('\n').at(-1)).lifeCapabilityOpportunities
  return JSON.stringify({action:'consider_social',id:options.events.find(x=>x.kind==='dm-received'||x.kind==='comment-received')?.id,reason:'本轮注意到了一个交流事件'})
},noVideo=true}={}){
  let tag=A, calls=0, time=CLOCK, writes=0
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:()=>time})
  const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:mode,autonomousPlannerMinutes:5,
    autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
  const planner=createAutonomousPlanner({dataDir:dir,getConfig:()=>cfg,getTodos:()=>[],now:()=>time,
    getLifeAccountTag:()=>tag,getLifeEvents:()=>events.peek(4),offerLifeWake:x=>events.offer(x),
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),getLifeEventStatus:()=>({
      ...events.status(),videoStartsToday:noVideo?2:0,lastVideoAt:noVideo?time:0}),
    getLifeCapabilities:()=>[],runLifeCapability:()=>{writes++;return {started:true}},recordVideoStart:()=>{writes++},
    invokeModel:async prompt=>{calls++;return await model(prompt)},executeRead:()=>{writes++;return {ok:true}},
    updateTodo:()=>{writes++},reflect:()=>{writes++;return {ok:true}}})
  return {events,planner,cfg,get calls(){return calls},get writes(){return writes},setTag:x=>{tag=x},advance:ms=>{time+=ms}}
}

test('two social channels share the same anonymous life inbox; dedup, no raw UID or text',()=>withDir(async dir=>{
  const r=make(dir)
  const dm=r.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'99887766:secret-private-message-id'})
  assert.equal(dm.created,true)
  assert.equal(r.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'99887766:secret-private-message-id'}).created,false)
  r.events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'778899:BV1ABcdE123:551'})
  assert.deepEqual(r.events.status().recentSocialKinds,['dm-received','comment-received'])
  assert.equal(r.events.status().pendingSocial,2)
  const disk=readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8')
  assert.doesNotMatch(disk,/99887766|secret-private-message-id|778899|BV1ABcdE123|551/)
  const picked=await r.planner.tick({force:true})
  assert.equal(picked.action,'consider_social')
  assert.equal(picked.result,'social-signal-considered')
  assert.equal(r.events.status().pendingSocial,0)
  const statuses=r.events.status().recent.filter(e=>['dm-received','comment-received'].includes(e.kind))
  assert.equal(statuses.some(e=>e.result==='social-attended'),true)
  assert.equal(statuses.some(e=>e.result==='social-passed-over'),true)
  assert.equal(r.writes,0,'thinking about a social wake never sends a message')
  assert.equal(r.calls,1)
}))

test('social cues remain actionable despite exhausted video quota and zero platform capabilities',()=>withDir(async dir=>{
  const r=make(dir)
  r.events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'author:comment-1'})
  assert.equal((await r.planner.tick({force:true})).result,'social-signal-considered')
  assert.equal(r.writes,0)
  assert.equal(r.events.status().videoStartsToday,0)
}))

test('social signal cannot be used to forge a video capability or outbound social action',()=>withDir(async dir=>{
  const r=make(dir,{model:()=>JSON.stringify({action:'use_capability',capability:'bilibili.video-explore',reason:'发送私信'})})
  r.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'a'})
  const result=await r.planner.tick({force:true})
  assert.equal(result.action,'skip')
  assert.equal(result.result,'')
  assert.equal(r.writes,0)
}))

test('fake social event ID is rejected and does not create a social receipt',()=>withDir(async dir=>{
  const r=make(dir,{model:()=>JSON.stringify({action:'consider_social',id:'fake-id',reason:'虚构关注'})})
  r.events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'msg-1'})
  const result=await r.planner.tick({force:true})
  assert.equal(result.action,'skip')
  assert.equal(r.events.status().pending,0)
  assert.equal(r.writes,0)
}))

test('shadow mode only records the desire; original sender ownership is unchanged',()=>withDir(async dir=>{
  const r=make(dir,{mode:'shadow'})
  r.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'msg-2'})
  assert.equal((await r.planner.tick({force:true})).result,'social-signal-considered')
  assert.equal(r.writes,0)
}))

test('social event is isolated by Bilibili account and a model-time switch cannot settle it',()=>withDir(async dir=>{
  let r
  r=make(dir,{model:()=>{r.setTag(B);return JSON.stringify({action:'consider_social',id:r.events.peek()[0]?.id||'unknown'})}})
  r.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'private-thread-X'})
  const out=await r.planner.tick({force:true})
  assert.equal(out.ok,false)
  assert.match(out.error,/账号已变化/)
  assert.equal(r.events.status().pendingSocial,0)
  r.setTag(A)
  assert.equal(r.events.status().pendingSocial,1)
  assert.equal(r.writes,0)
}))

test('model failure keeps the social wake pending and consumes only one existing planner budget',()=>withDir(async dir=>{
  const r=make(dir,{model:()=>{throw Error('model down')}})
  r.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'msg-3'})
  assert.equal((await r.planner.tick({force:true})).ok,false)
  assert.equal(r.events.status().pendingSocial,1)
  assert.equal(r.planner.status().runs,1)
}))

test('off mode ignores social events; owner-only and opportunities-only triggers do not consume them',()=>withDir(async dir=>{
  const r=make(dir,{mode:'off'})
  r.events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'msg-4'})
  assert.equal((await r.planner.tick({force:true})).skipped,'nothing-to-do')
  r.cfg.lifeAgentMode='active'
  assert.equal((await r.planner.tick({force:true,todosOnly:true})).skipped,'nothing-to-do')
  assert.equal((await r.planner.tick({force:true,opportunitiesOnly:true})).skipped,'nothing-to-do')
  assert.equal(r.events.status().pendingSocial,1)
}))

test('production paths only offer social wake after a verified incoming social record',()=>{
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(src,/if\(recorded\?\.ok===true\)offerSocialLifeWake\(\{kind:'dm-received',uid,eventId:messageId,verified:true\}\)/)
  assert.match(src,/if\(sync\?\.ok===true\)offerSocialLifeWake\(\{kind:'comment-received',uid:req.uid,eventId,/)
  assert.match(src,/verified:req\.contentType==='dynamic'\?req\.dynamicVerified===true:/)
  assert.match(src,/const offerSocialLifeWake = \(\{kind,uid,eventId,verified=false\}\)/)
})
