import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {recordInterestEvents,scopedInterestOpportunityEvidence} from '../lib/life-interests.mjs'
import {createLifeMemoryCoordinator} from '../lib/life-memory-coordinator.mjs'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createSocialPortraitGateway} from '../lib/social-portrait-gateway.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'

const day=86400000, now=Date.parse('2026-11-04T08:00:00Z')
const credA={dedeuserid:'1234567',sessdata:'credential-A'},credB={dedeuserid:'7654321',sessdata:'credential-B'}
const A=discussionAccountTag(credA),B=discussionAccountTag(credB)
const dirs=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-multi-source-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const video=(bvid,at)=>({kind:'watch',tier:'selected',autonomousSelected:true,bvid,title:'游戏解说视频',time:new Date(at).toISOString()})
const builds=(dir,credential,getPublicPersonEvidence=()=>[])=>createLifeOpportunities({stateDir:dir,getCredential:()=>credential,now:()=>now,
  getInterestEvidence:tag=>scopedInterestOpportunityEvidence(dir,tag,now),getPublicPersonEvidence})
const planner=(dir,store,response,read=async bvid=>({ok:true,bvid,title:'真实公开资料'}))=>createAutonomousPlanner({dataDir:dir,now:()=>now,
  getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:6,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
  getTodos:()=>[],getLifeOpportunities:()=>store.list(),recordOpportunityDecision:(id,action,opts)=>store.decide(id,action,opts),
  executeOpportunityRead:read,invokeModel:async()=>JSON.stringify(response()),reflectionStatus:()=>({pending:0}),reflect:async()=>({ok:true}),
  executeRead:async()=>{throw Error('unexpected TODO execution')},updateTodo:async()=>{throw Error('unexpected update')},
})

test('only account-tagged multi-day autonomous picks create an interest milestone',async()=>dirs(async dir=>{
  for(const [i,at] of [now-3*day,now-2*day,now-day].entries())
    recordInterestEvents(dir,[video(['BV1abcde1234','BV1abcde1235','BV1abcde1236'][i],at)],at,{accountTag:A})
  const out=scopedInterestOpportunityEvidence(dir,A,now)
  assert.equal(out.length,1)
  assert.equal(out[0].topic,'游戏')
  assert.equal(out[0].stage,'emerging')
  assert.equal(out[0].evidenceDays,3)
  assert.equal(scopedInterestOpportunityEvidence(dir,B,now).length,0)
  const storeA=builds(dir,credA),storeB=builds(dir,credB)
  assert.equal(storeA.list()[0].source,'interest-milestone')
  assert.equal(storeB.list().length,0)
  const bvid=storeA.list()[0].bvid
  const agent=planner(dir,storeA,()=>({action:'inspect_opportunity',id:storeA.list()[0]?.id,reason:'只是想确认视频来源'}))
  assert.equal((await agent.tick({force:true,opportunitiesOnly:true})).result,'verified-metadata')
  assert.equal(storeA.recentReads()[0].bvid,bvid)
  assert.equal(storeA.recentReads()[0].topic,'游戏')
  assert.equal(storeB.recentReads().length,0)
}))

test('legacy untagged picks never become account-bound life opportunities',()=>dirs(dir=>{
  recordInterestEvents(dir,[video('BV1abcde1234',now-3*day),video('BV1abcde1235',now-2*day),video('BV1abcde1236',now-day)],now)
  assert.equal(scopedInterestOpportunityEvidence(dir,A,now).length,0)
  assert.equal(builds(dir,credA).list().length,0)
}))

test('public portrait requires distinct real public events over multiple days',()=>dirs(dir=>{
  const portrait=createSocialPortraitGateway({dataDir:dir,now:()=>now,getRelationship:()=>({stage:'known'}),getFriendDirectory:()=>''})
  assert.equal(portrait.observe({uid:'424242',source:'dm',eventId:'private',text:'请你回复简短一点',at:now-3*day}).added,1)
  assert.equal(portrait.publicOpportunitySignals({at:now}).length,0)
  portrait.observe({uid:'424242',source:'comment',eventId:'public-one',text:'请你以后回复简短一点',at:now-2*day})
  assert.equal(portrait.publicOpportunitySignals({at:now}).length,0)
  portrait.observe({uid:'424242',source:'comment',eventId:'public-two',text:'请你回复短一点',at:now-day})
  const signals=portrait.publicOpportunitySignals({at:now})
  assert.equal(signals.length,1)
  assert.equal(signals[0].evidenceDays,2)
  const serialized=JSON.stringify(signals)
  assert.ok(!serialized.includes('424242'))
  assert.ok(!serialized.includes('private'))
  assert.ok(!serialized.includes('简短一点'))
  const store=builds(dir,credA,()=>signals)
  assert.equal(store.list()[0].source,'public-person-observation')
  assert.equal(store.list()[0].bvid,'')
  assert.equal(store.status().opportunities.length,1)
}))

test('public signal is local read-only review and cannot execute a video or contact action',async()=>dirs(async dir=>{
  const signal={source:'public-person-observation',personKey:'123456789012abcdefabcdef',at:now-1*day,evidenceCount:2,evidenceDays:2}
  const store=builds(dir,credA,()=>[signal])
  let reads=0
  const bad=planner(dir,store,()=>({action:'inspect_opportunity',id:store.list()[0].id}),async()=>{reads++;throw Error('must not read')})
  assert.equal((await bad.tick({force:true,opportunitiesOnly:true})).result,'invalid-decision')
  assert.equal(reads,0)
  assert.equal(store.list()[0].status,'pending')
  const good=planner(join(dir,'separate-model-state'),store,()=>({action:'review_public',id:store.list()[0].id,reason:'愿意核对公开交流证据'}),async()=>{reads++;throw Error('must not read')})
  assert.equal((await good.tick({force:true,opportunitiesOnly:true})).result,'public-evidence-reviewed')
  assert.equal(reads,0)
  assert.equal(store.status().opportunities[0].status,'review')
  assert.equal(store.list().length,0)
}))

test('model cannot invent a person signal ID',async()=>dirs(async dir=>{
  const store=builds(dir,credA,()=>[{source:'public-person-observation',personKey:'abcdef0123456789abcdef01',at:now-day,evidenceCount:2,evidenceDays:2}])
  const bad=planner(dir,store,()=>({action:'review_public',id:'fake'}))
  assert.equal((await bad.tick({force:true,opportunitiesOnly:true})).result,'invalid-decision')
  assert.equal(store.status().opportunities[0].status,'pending')
}))

test('retroactive imported or timestamp-less picks cannot be relabeled as current-account experience',()=>dirs(dir=>{
  const items=[video('BV1abcde1234',now-6*day),video('BV1abcde1235',now-5*day),video('BV1abcde1236',now-4*day)]
  recordInterestEvents(dir,items,now,{accountTag:A})
  assert.equal(scopedInterestOpportunityEvidence(dir,A,now).length,0)
  const noTimestamp=video('BV1abcde1237',now)
  delete noTimestamp.time
  recordInterestEvents(dir,[noTimestamp],now,{accountTag:A})
  assert.equal(scopedInterestOpportunityEvidence(dir,A,now).length,0)
}))

test('revoking a public evidence row removes an insufficient person opportunity',()=>dirs(dir=>{
  const gateway=createSocialPortraitGateway({dataDir:dir,getRelationship:()=>({stage:'known'}),now:()=>now})
  gateway.observe({uid:'424242',source:'comment',eventId:'one',text:'请你以后回复简短一点',at:now-2*day})
  gateway.observe({uid:'424242',source:'comment',eventId:'two',text:'请你回复短一点',at:now-day})
  assert.equal(gateway.publicOpportunitySignals().length,1)
  const first=gateway.list('424242')[0]
  gateway.retract('424242',first.id)
  assert.equal(gateway.publicOpportunitySignals().length,0)
}))

test('one damaged source does not manufacture rejection or obscure healthy other-source evidence',()=>dirs(dir=>{
  const store=createLifeOpportunities({stateDir:dir,getCredential:()=>credA,now:()=>now,
    getInterestEvidence:()=>{throw Error('private source database content')},
    getPublicPersonEvidence:()=>[{source:'public-person-observation',personKey:'abcdef0123456789abcdef01',at:now-day,evidenceCount:2,evidenceDays:2}]})
  const status=store.status()
  assert.equal(status.opportunities.length,1)
  assert.deepEqual(status.sourceWarnings,['兴趣 资料不可用'])
  assert.ok(!JSON.stringify(status).includes('private source database content'))
}))


test('replayed event outbox keeps its ORIGINAL login tag after account switch',async()=>dirs(async dir=>{
  // Two earlier real picks belong to A. The third pick is queued under A, but
  // its episodic sink fails once; before recovery the active login becomes B.
  const earlier=[now-2*day,now-day]
  for(const [i,at] of earlier.entries())recordInterestEvents(dir,[video(['BV1abcde1234','BV1abcde1235'][i],at)],at,{accountTag:A})
  let currentTag=A,attempts=0
  const gateway={recordEvents:()=>{attempts++;if(attempts===1)throw Error('retry later');return {ok:true}}}
  const reflection={addEvents:(rows,{accountTag})=>{
    recordInterestEvents(dir,rows,now,{accountTag});return {added:1}
  }}
  const coordinator=createLifeMemoryCoordinator({dataDir:dir,memoryGateway:gateway,lifeReflection:reflection,
    getAccountTag:()=>currentTag,now:()=>now,logger:{warn:()=>{}}})
  const eventNow={...video('BV1abcde1236',now),key:'watch:BV1abcde1236'}
  assert.equal((await coordinator.recordEvents([eventNow])).pending,1)
  currentTag=B
  assert.equal((await coordinator.flush()).completed,1)
  assert.equal(scopedInterestOpportunityEvidence(dir,A,now).length,1)
  assert.equal(scopedInterestOpportunityEvidence(dir,B,now).length,0)
}))
