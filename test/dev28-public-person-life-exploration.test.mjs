import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialPortraitGateway} from '../lib/social-portrait-gateway.mjs'
import {readVerifiedPublicPersonPortfolio} from '../lib/life-public-capabilities.mjs'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createAutonomousPlanner,plannerActionMenu} from '../lib/autonomous-planner.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'

const DAY=86400000, NOW=Date.parse('2026-11-04T08:00:00Z')
const USER='424242', ACCOUNT='1234567', B='BV1abcde1234'
const a={dedeuserid:ACCOUNT,sessdata:'private-a'}
const b={dedeuserid:'7654321',sessdata:'private-b'}
const fixture=async fn=>{const dir=mkdtempSync(join(tmpdir(),'fish-dev28-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
function publicFixture(dir,{now=()=>NOW}={}){
 const portrait=createSocialPortraitGateway({dataDir:dir,now,
   getRelationship:()=>({stage:'known'}),getFriendDirectory:()=>''})
 portrait.observe({uid:USER,source:'comment',eventId:'verified-one',text:'请你回复短一点',at:now()-2*DAY})
 portrait.observe({uid:USER,source:'comment',eventId:'verified-two',text:'请你以后回复短一点',at:now()-DAY})
 return portrait
}

// Host resolution is the ONLY place where the UID exists. The model and the
// Life intention journal see an opaque ID and verified public BV titles.
test('revocable public person evidence resolves only to host; model signal stays anonymous',()=>fixture(dir=>{
 const portrait=publicFixture(dir),signal=portrait.publicOpportunitySignals()[0]
 assert.ok(signal?.personKey)
 assert.equal(JSON.stringify(signal).includes(USER),false)
 assert.deepEqual(portrait.resolvePublicOpportunity(signal.personKey),{personKey:signal.personKey,uid:USER})
 assert.equal(portrait.resolvePublicOpportunity('model-invented-uid'),null)
 assert.equal(portrait.forget(USER).removed>0,true)
 assert.equal(portrait.resolvePublicOpportunity(signal.personKey),null)
}))

test('portfolio capability checks account, fresh permission, exact returned UID and work BV',async()=>{
 const key='a'.repeat(24),scope='1'.repeat(16)
 let uid=USER,account=ACCOUNT,current=scope,listingCalls=0
 const run=(override={})=>readVerifiedPublicPersonPortfolio({personKey:key,accountUid:ACCOUNT,
   getAccountUid:()=>account,accountTag:scope,getAccountTag:()=>current,
   resolvePerson:()=>({uid,personKey:key}),
   readVideos:async user=>{listingCalls++;return {uid:user,videos:[{bvid:B,title:'核实的视频标题'},{bvid:'wrong',title:'垃圾'}]}},...override})
 const result=await run()
 assert.deepEqual(result,{ok:true,personKey:key,videos:[{bvid:B,title:'核实的视频标题'}]})
 assert.equal(JSON.stringify(result).includes(USER),false)
 assert.equal(listingCalls,1)
 assert.equal((await run({resolvePerson:()=>({uid:USER,personKey:'b'.repeat(24)})})).ok,false)
 assert.equal(listingCalls,1)
 assert.equal((await run({readVideos:async()=>({uid:'888888',videos:[{bvid:B,title:'不同人投稿'}]})})).ok,false)
 account=b.dedeuserid
 assert.equal((await run()).ok,false)
 assert.equal(listingCalls,1)
 account=ACCOUNT
 current='2'.repeat(16)
 assert.equal((await run()).ok,false)
 current=scope
 assert.equal((await run({readVideos:async()=>{uid='888888';return {uid:USER,videos:[{bvid:B,title:'转移后投稿'}]}}})).ok,false)
 assert.equal((await run({resolvePerson:()=>null})).ok,false)
})

test('real public person evidence creates the existing Life intention without persisting UID',async()=>fixture(async dir=>{
 const portrait=publicFixture(dir),signal=portrait.publicOpportunitySignals()[0]
 const store=createLifeOpportunities({stateDir:dir,now:()=>NOW,getCredential:()=>a,
   getPublicPersonEvidence:()=>portrait.publicOpportunitySignals()})
 const item=store.list()[0],scope=discussionAccountTag(a)
 assert.equal(item.personKey,signal.personKey)
 const proof={ok:true,personKey:signal.personKey,videos:[{bvid:B,title:'公开作品'}]}
 const created=store.beginPublicPersonExploration(item.id,proof,scope,'我想看看对方公开发布的内容')
 assert.equal(created.ok,true)
 assert.equal(store.continuations()[0].videos[0].bvid,B)
 assert.equal(store.list().length,0)
 assert.equal(store.beginPublicPersonExploration(item.id,proof,scope).ok,false)
 assert.equal(JSON.stringify(store.status()).includes(USER),false)
 assert.equal(readFileSync(join(dir,'life-opportunities',scope+'.json'),'utf8').includes(USER),false)
 assert.equal(store.beginPublicPersonExploration(item.id,proof,discussionAccountTag(b)).ok,false)
}))

test('revoking a public relationship disables a previously created exploration before the next read',()=>fixture(dir=>{
 const portrait=publicFixture(dir),store=createLifeOpportunities({stateDir:dir,now:()=>NOW,getCredential:()=>a,
   getPublicPersonEvidence:()=>portrait.publicOpportunitySignals()})
 const item=store.list()[0],scope=discussionAccountTag(a)
 const opened=store.beginPublicPersonExploration(item.id,{ok:true,personKey:item.personKey,
   videos:[{bvid:B,title:'曾经的公开作品'}]},scope)
 assert.equal(opened.ok,true)
 assert.equal(store.continuations().length,1)
 portrait.forget(USER)
 assert.equal(store.continuations().length,0)
 assert.equal(store.completeExploration(opened.id,B,{ok:true,bvid:B,title:'已撤销人的作品'},scope).ok,false)
 assert.equal(store.status().intentions[0].selectedBvid,'')
}))

test('no fabricated identity or failed read becomes a Life intention',()=>fixture(dir=>{
 const portrait=publicFixture(dir),store=createLifeOpportunities({stateDir:dir,now:()=>NOW,getCredential:()=>a,
   getPublicPersonEvidence:()=>portrait.publicOpportunitySignals()})
 const item=store.list()[0],scope=discussionAccountTag(a)
 assert.equal(store.beginPublicPersonExploration(item.id,{ok:true,personKey:'c'.repeat(24),videos:[{bvid:B,title:'标题'}]},scope).ok,false)
 assert.equal(store.beginPublicPersonExploration(item.id,{ok:true,personKey:item.personKey,videos:[{bvid:'invalid',title:'标题'}]},scope).ok,false)
 assert.equal(store.continuations().length,0)
}))

test('Life planner can choose public contact works, then decide to inspect a verified BV later',async()=>fixture(async dir=>{
 const portrait=publicFixture(dir),store=createLifeOpportunities({stateDir:dir,now:()=>NOW,getCredential:()=>a,
   getPublicPersonEvidence:()=>portrait.publicOpportunitySignals()})
 const opportunity=store.list()[0]
 const menu=plannerActionMenu({opportunities:store.list()})
 assert.equal(menu.some(x=>x.action==='inspect_public_person'&&x.ids.includes(opportunity.id)),true)
 let choice={action:'inspect_public_person',id:opportunity.id,reason:'想看看我们交流过的这个人公开发表了什么作品'}
 let calls=0,prompt='',readCalls=0
 const options={dataDir:dir,now:()=>NOW,
   getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
     autonomousPlannerDailyLimit:20,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
   getLifeAccountTag:()=>discussionAccountTag(a),getTodos:()=>[],getLifeOpportunities:()=>store.list(),
   getLifeIntentions:()=>store.continuations(),beginPublicPersonExploration:(...args)=>store.beginPublicPersonExploration(...args),
   completeLifeExploration:(...args)=>store.completeExploration(...args),
   invokeModel:async body=>{prompt=body;return JSON.stringify(choice)},
   executePublicPersonPortfolio:async key=>{calls++;return readVerifiedPublicPersonPortfolio({
     personKey:key,accountUid:ACCOUNT,getAccountUid:()=>ACCOUNT,accountTag:discussionAccountTag(a),
     getAccountTag:()=>discussionAccountTag(a),resolvePerson:k=>portrait.resolvePublicOpportunity(k),
     readVideos:async uid=>({uid,videos:[{bvid:B,title:'翻唱作品'}]})})},
   executeOpportunityRead:async bv=>{readCalls++;return {ok:true,bvid:bv,title:'读取公开作品'}} ,
   executeRead:async()=>({ok:false}),updateTodo:async()=>{},reflect:async()=>({ok:false}),reflectionStatus:()=>({pending:0})}
 let planner=createAutonomousPlanner(options)
 const first=await planner.tick({force:true,opportunitiesOnly:true})
 assert.equal(first.result,'verified-public-portfolio')
 assert.equal(calls,1)
 assert.ok(!prompt.includes(USER))
 assert.equal(store.continuations()[0].videos[0].bvid,B)
 assert.equal(readCalls,0)
 const id=store.continuations()[0].id
 choice={action:'inspect_exploration',id,bvid:B,reason:'想仔细看看这部公开作品'}
 planner=createAutonomousPlanner({...options,dataDir:join(dir,'fresh-planner')})
 const next=await planner.tick({force:true,opportunitiesOnly:true})
 assert.equal(next.result,'verified-metadata')
 assert.equal(readCalls,1)
 assert.equal(store.status().intentions[0].selectedBvid,B)
 assert.equal(store.status().intentions[0].source,'public-person-observation')
}))

test('if public portfolio evidence disappears during read, Life records a cooling failure and cannot recontact',async()=>fixture(async dir=>{
 const portrait=publicFixture(dir),store=createLifeOpportunities({stateDir:dir,now:()=>NOW,getCredential:()=>a,
   getPublicPersonEvidence:()=>portrait.publicOpportunitySignals()})
 const id=store.list()[0].id
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>NOW,
   getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
     autonomousPlannerDailyLimit:12,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
   getLifeAccountTag:()=>discussionAccountTag(a),getTodos:()=>[],getLifeOpportunities:()=>store.list(),
   recordOpportunityDecision:(...args)=>store.decide(...args),
   invokeModel:async()=>JSON.stringify({action:'inspect_public_person',id,reason:'看看对方公开投稿'}),
   executePublicPersonPortfolio:async()=>({ok:false}),
   executeRead:async()=>({ok:false}),updateTodo:async()=>{},reflect:async()=>({ok:false}),reflectionStatus:()=>({pending:0})})
 const r=await planner.tick({force:true,opportunitiesOnly:true})
 assert.equal(r.result,'public-portfolio-read-failed')
 assert.equal(store.continuations().length,0)
 assert.equal(store.list().length,0)
 assert.equal(store.status().opportunities[0].status,'error')
}))
