import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {readVerifiedCreatorPortfolio} from '../lib/life-public-capabilities.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
const BV='BV1abcde1234', OTHER='BV1abcde1235', CRED={dedeuserid:'23456',sessdata:'secret-a'}, NEXT={dedeuserid:'45678',sessdata:'secret-b'}
const TIME=Date.parse('2026-11-04T08:00:00.000Z'), date=new Date(TIME).toISOString().slice(0,10)
const temp=async fn=>{const dir=mkdtempSync(join(tmpdir(),'fish-cross-scene-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const discussion=(dir,cred=CRED)=>{
 const account=discussionAccountTag(cred),at=new Date(TIME-3600_000).toISOString(),later=new Date(TIME-3599_000).toISOString()
 mkdirSync(join(dir,'video-discussion-reads'),{recursive:true})
 writeFileSync(join(dir,'video-discussion-reads',date+'.jsonl'),[
  {v:1,account,bvid:BV,at,kind:'comment_list_read',status:'read',count:12},
  {v:1,account,bvid:BV,at:later,kind:'provisional_fish_reaction',reaction:'curious',question:'这个作者还有哪些相关的作品？'}
 ].map(x=>JSON.stringify(x)).join('\n')+'\n')
}
const interest={source:'interest-milestone',topic:'游戏音乐',stage:'growing',at:new Date(TIME-60000).toISOString(),bvid:BV,evidenceCount:3,evidenceDays:2}
const create=(dir,{interests=true,withComment=true}={})=>{
 let cred=CRED,t=TIME
 if(withComment)discussion(dir)
 const life=createLifeOpportunities({stateDir:dir,getCredential:()=>cred,now:()=>t,
  getInterestEvidence:()=>interests?[interest]:[]})
 const change=(next)=>{cred=next},advance=ms=>{t+=ms}
 const planner=(decide,{read=async bvid=>({ok:true,bvid,title:'核实的原标题'}),creator=async bvid=>({ok:true,bvid,
   accountUid:CRED.dedeuserid,creatorUid:'999888',videos:[{bvid:OTHER,title:'作者其他公开作品'}]}),search=async topic=>({ok:true,topic,videos:[{bvid:BV,title:'搜索结果'}]})}={})=>{
  let prompt='',readCalls=0,creatorCalls=0,searchCalls=0
  const p=createAutonomousPlanner({dataDir:dir,now:()=>t,
   getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:24,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
   getTodos:()=>[],getLifeIntentionCues:()=>life.explorationCues(),getLifeIntentions:()=>life.continuations(),
   getLifeAccountTag:()=>discussionAccountTag(cred),getLifeOpportunities:()=>[],
   beginLifeExploration:(...args)=>life.beginExploration(...args),beginLifeVideoExploration:(...args)=>life.beginVideoExploration(...args),
   completeLifeExploration:(...args)=>life.completeExploration(...args),failLifeExploration:(...args)=>life.failExplorationRead(...args),
   inspectLifeCreatorSpace:(...args)=>life.inspectCreatorSpace(...args),failLifeCreatorRead:(...args)=>life.failCreatorRead(...args),
   abandonLifeExploration:(...args)=>life.abandonExploration(...args),
   invokeModel:async body=>{prompt=body;return JSON.stringify(decide())},executeLifeSearch:async topic=>{searchCalls++;return search(topic)},
   executeOpportunityRead:async bv=>{readCalls++;return read(bv)},executeCreatorSpace:async bv=>{creatorCalls++;return creator(bv)},
   executeRead:async()=>{throw Error('not allowed')},updateTodo:async()=>{throw Error('not allowed')},reflect:async()=>({}),reflectionStatus:()=>({pending:0})})
  return {p,get prompt(){return prompt},get readCalls(){return readCalls},get creatorCalls(){return creatorCalls},get searchCalls(){return searchCalls}}
 }
 return {life,planner,change,advance}
}

test('real subjective comment can start a model-elected exploration without public search or a TODO',async()=>temp(async dir=>{
 const {life,planner}=create(dir,{interests:false})
 const cue=life.explorationCues()[0]
 assert.equal(cue.source,'discussion-read')
 const p=planner(()=>({action:'begin_exploration',id:cue.id,goal:'我想了解这个视频作者的更多公开作品'}))
 const r=await p.p.tick({force:true,opportunitiesOnly:true})
 assert.equal(r.result,'verified-metadata');assert.equal(p.readCalls,1);assert.equal(p.searchCalls,0)
 assert.equal(life.continuations()[0].selectedBvid,BV)
 assert.ok(!p.prompt.includes('23456'))
 assert.equal(life.status().intentions[0].source,'discussion-read')
}))

test('an exploration can compose search -> verified BV -> public creator works -> another verified BV',async()=>temp(async dir=>{
 const {life,planner,advance}=create(dir,{withComment:false})
 const cue=life.explorationCues()[0]
 assert.equal((await planner(()=>({action:'begin_exploration',id:cue.id,goal:'我想听听别的游戏配乐'})).p.tick({force:true,opportunitiesOnly:true})).result,'verified-search-results')
 const id=life.continuations()[0].id
 advance(600000)
 assert.equal((await planner(()=>({action:'inspect_exploration',id,bvid:BV})).p.tick({force:true,opportunitiesOnly:true})).result,'verified-metadata')
 assert.equal(life.continuations()[0].status,'inspected')
 advance(600000)
 const c=planner(()=>({action:'inspect_creator_space',id}))
 assert.equal((await c.p.tick({force:true,opportunitiesOnly:true})).result,'verified-creator-videos')
 assert.equal(c.creatorCalls,1)
 assert.equal(life.continuations()[0].creatorVideos[0].bvid,OTHER)
 assert.ok(!c.prompt.includes('999888'))
 advance(600000)
 const follow=planner(()=>({action:'inspect_exploration',id,bvid:OTHER}))
 assert.equal((await follow.p.tick({force:true,opportunitiesOnly:true})).result,'verified-metadata')
 assert.equal(follow.readCalls,1)
 assert.equal(life.continuations().length,0)
 assert.equal(life.status().intentions[0].selectedBvid,OTHER)
}))

test('public creator capability verifies same BV, current account, author UID and returned list',async()=>{
 const calls=[],uid='998877'
 const good=()=>readVerifiedCreatorPortfolio({bvid:BV,accountUid:CRED.dedeuserid,getAccountUid:()=>CRED.dedeuserid,
  readRelation:async bvid=>{calls.push('relation:'+bvid);return {ok:true,bvid,accountUid:CRED.dedeuserid,creatorUid:uid}},
  readVideos:async u=>{calls.push('videos:'+u);return {uid:u,videos:[{bvid:OTHER,title:'公开作品'}]}}})
 assert.equal((await good()).ok,true)
 assert.deepEqual(calls,['relation:'+BV,'videos:'+uid])
 for(const wrong of [
  {bvid:OTHER,accountUid:CRED.dedeuserid,creatorUid:uid},
  {bvid:BV,accountUid:NEXT.dedeuserid,creatorUid:uid},
  {bvid:BV,accountUid:CRED.dedeuserid,creatorUid:'0'}]){
  let called=false
  const result=await readVerifiedCreatorPortfolio({bvid:BV,accountUid:CRED.dedeuserid,getAccountUid:()=>CRED.dedeuserid,
   readRelation:async()=>({ok:true,...wrong}),readVideos:async()=>{called=true;return {uid, videos:[]}}})
  assert.equal(result.ok,false);assert.equal(called,false)
 }
})

test('login switch during an external read cannot attach old identity or public works to the other account',async()=>temp(async dir=>{
 const {life,planner,change}=create(dir,{interests:false})
 const cue=life.explorationCues()[0]
 const x=planner(()=>({action:'begin_exploration',id:cue.id,goal:'我想看看这个视频的出处'}),
  {read:async bvid=>{change(NEXT);return {ok:true,bvid,title:'旧账号读取的标题'}}})
 assert.equal((await x.p.tick({force:true,opportunitiesOnly:true})).ok,false)
 assert.deepEqual(life.status().intentions,[])
 change(CRED)
 assert.deepEqual(life.status().intentions,[])
}))

test('a mismatched creator response is never saved, and failures retain cooling receipts',async()=>temp(async dir=>{
 const {life,planner,advance}=create(dir,{interests:false})
 const cue=life.explorationCues()[0]
 await planner(()=>({action:'begin_exploration',id:cue.id,goal:'我想看看这个视频作者的公开作品'})).p.tick({force:true,opportunitiesOnly:true})
 const id=life.continuations()[0].id
 advance(600000)
 const bad=planner(()=>({action:'inspect_creator_space',id}),{creator:async bvid=>({ok:true,bvid,
  accountUid:NEXT.dedeuserid,creatorUid:'999888',videos:[{bvid:OTHER,title:'fake'}]})})
 assert.equal((await bad.p.tick({force:true,opportunitiesOnly:true})).ok,false)
 assert.notEqual(life.status().intentions[0].receipt,'verified-creator-videos')
 advance(600000)
 const fail=planner(()=>({action:'inspect_creator_space',id}),{creator:async()=>({ok:false,error:'network'})})
 assert.equal((await fail.p.tick({force:true,opportunitiesOnly:true})).result,'creator-read-failed')
 assert.ok(life.status().intentions[0].nextAt>TIME)
 assert.equal(life.continuations().length,0)
}))

test('model cannot invent a BV, UID or unauthorized outgoing action',async()=>temp(async dir=>{
 const {life,planner,advance}=create(dir,{interests:false})
 const cue=life.explorationCues()[0]
 await planner(()=>({action:'begin_exploration',id:cue.id,goal:'我想看看这部作品的公开资料'})).p.tick({force:true,opportunitiesOnly:true})
 const id=life.continuations()[0].id
 advance(600000)
 const fake=planner(()=>({action:'inspect_exploration',id,bvid:OTHER,uid:'887766'}))
 assert.equal((await fake.p.tick({force:true,opportunitiesOnly:true})).action,'skip')
 assert.equal(fake.readCalls,0)
 advance(600000)
 const contact=planner(()=>({action:'send_private_message',id,uid:'887766'}))
 assert.equal((await contact.p.tick({force:true,opportunitiesOnly:true})).action,'skip')
 assert.equal(contact.creatorCalls,0)
}))

test('comment-started verified video remains a weak metadata cue even before space exploration',async()=>temp(async dir=>{
 const {life,planner,advance}=create(dir,{interests:false})
 const cue=life.explorationCues()[0]
 await planner(()=>({action:'begin_exploration',id:cue.id,goal:'我想继续了解这部作品'})).p.tick({force:true,opportunitiesOnly:true})
 assert.deepEqual(life.recentReads()[0].bvid,BV)
 const id=life.continuations()[0].id
 advance(600000)
 await planner(()=>({action:'inspect_creator_space',id})).p.tick({force:true,opportunitiesOnly:true})
 assert.equal(life.recentReads()[0].bvid,BV)
 assert.equal(life.recentReads()[0].scope,'video-metadata-only')
}))

test('same numeric UID but changed credentials scope during creator lookup is rejected',async()=>{
 const accountUid=CRED.dedeuserid
 let accountTag='aaaaaaaaaaaaaaaa',called=false
 const result=await readVerifiedCreatorPortfolio({bvid:BV,accountUid,accountTag,
  getAccountUid:()=>accountUid,getAccountTag:()=>accountTag,
  readRelation:async()=>{accountTag='bbbbbbbbbbbbbbbb';return {ok:true,bvid:BV,accountUid,creatorUid:'999888'}},
  readVideos:async()=>{called=true;return {uid:'999888',videos:[{bvid:OTHER,title:'绝不可归到新会话'}]}}})
 assert.equal(result.ok,false)
 assert.equal(called,false)
})
