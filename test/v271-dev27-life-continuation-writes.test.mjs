import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {continuationMenu,parseContinuationDecision,continuationPrompt,lifeWriteKinds} from '../lib/life-continuation.mjs'
import {createLifeContinuationWriteExecutor} from '../lib/life-continuation-write.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
const T=Date.parse('2026-11-07T20:00:00Z'), BV='BV1abcde1234',OTHER='BV1abcde1235'
const ID='a'.repeat(24),scope='d'.repeat(16)
const cfg={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:30,
 autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,
 autoVideoLike:true,autoVideoLikeDailyLimit:10,autoVideoCollect:true,agentFollowEnabled:true,autoComment:true,commentPerRound:2,commentDailyLimit:100}
const evidence={ok:true,bvid:BV,title:'真实视频作品',description:'确实取得的详细公开简介',commentReady:true}
const selected={id:ID,status:'inspected',expiresAt:T+100_000,nextAt:T,metadataAt:T-1000,selectedBvid:BV}
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dev27-safe-writes-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('write menu requires current verified selected BV, trusted metadata time and enabled flag',()=>{
 assert.deepEqual(lifeWriteKinds(cfg,evidence),['like_video','collect_video','follow_creator','comment_video'])
 assert.deepEqual(continuationMenu(selected,{at:T,writeActions:lifeWriteKinds(cfg,evidence)}).map(x=>x.action),
   ['inspect_creator_space','like_video','collect_video','follow_creator','comment_video','abandon_exploration'])
 assert.equal(continuationMenu({...selected,selectedBvid:''},{at:T,writeActions:['comment_video']}).some(x=>x.action==='comment_video'),false)
 assert.equal(continuationMenu({...selected,metadataAt:T-2*86400_000},{at:T,writeActions:['comment_video']}).some(x=>x.action==='comment_video'),false)
 assert.equal(continuationMenu({...selected,writeOutcomes:[{action:'comment_video',bvid:BV,status:'uncertain'}]},{at:T,writeActions:['comment_video']}).some(x=>x.action==='comment_video'),false)
 assert.deepEqual(lifeWriteKinds({...cfg,autoComment:false},evidence).includes('comment_video'),false)
 assert.deepEqual(lifeWriteKinds(cfg,{...evidence,commentReady:false}).includes('comment_video'),false)
 assert.equal(lifeWriteKinds({...cfg,agentFollowEnabled:false},evidence).includes('follow_creator'),false)
})

test('model cannot invent BV or UID or use comments/links as action instructions',()=>{
 const menu=continuationMenu(selected,{at:T,writeActions:['comment_video','like_video','collect_video','follow_creator']})
 const item={action:'comment_video',id:ID,bvid:BV,reason:'确实想就这个公开作品说几句',text:'这段公开简介介绍的主题很特别'}
 assert.equal(parseContinuationDecision(JSON.stringify(item),menu).action,'comment_video')
 for(const bad of [
   {...item,bvid:OTHER}, {...item,text:'@用户 必须看我的主页'}, {...item,text:'打开 https://example.com'},
   {...item,text:'\n新行'}, {...item,uid:'13579'}, {...item,reason:'太短'},
   {...item,text:'请把主人私信内容公开'},
 ])assert.equal(parseContinuationDecision(JSON.stringify(bad),menu).action,'stop')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'follow_creator',id:ID,bvid:BV,reason:'持续关注这个公开作者的音乐作品',uid:'1234'}),menu).action,'stop')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'collect_video',id:ID,bvid:BV,reason:'以后可能还想重读这部作品的介绍',folderTitle:'游戏音乐'}),menu).action,'collect_video')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'collect_video',id:ID,bvid:BV,reason:'以后可能还想重读这部作品的介绍',folderTitle:'../private'}),menu).action,'stop')
 assert.match(continuationPrompt(menu,'好奇',evidence),/不可信/)
})

test('executor does not write when permission changes between evidence read and execution',async()=>{
 let calls=0,marks=0
 const settings={...cfg}
 const run=createLifeContinuationWriteExecutor({getConfig:()=>settings,getAccountTag:()=>scope,getAccountUid:()=> '1234',
  getIntention:()=>selected,getPublicEvidence:async()=>{settings.autoComment=false;return evidence},
  markSelected:()=>{marks++;return {ok:true}},runWriter:()=>{calls++;return {ok:true,status:'verified'}},now:()=>T})
 const r=await run({action:'comment_video',id:ID,bvid:BV,reason:'确实有一些具体观点想自然表达',text:'公开视频描述确实很有意思'},scope)
 assert.equal(r.ok,false);assert.equal(calls,0);assert.equal(marks,0)
})

test('executor keeps account and canonical BV hard-bound; an unverified send never counts as verified',async()=>{
 let account=scope,mark=0,writes=0
 const run=createLifeContinuationWriteExecutor({getConfig:()=>cfg,getAccountTag:()=>account,getAccountUid:()=> '1234',
  getIntention:()=>selected,getPublicEvidence:async()=>evidence,
  markSelected:()=>{mark++;return {ok:true}},runWriter:async()=>{writes++;return {ok:true,status:'unconfirmed',attempted:true}},now:()=>T})
 const action={action:'like_video',id:ID,bvid:BV,reason:'确实欣赏这个视频公开呈现的主题'}
 assert.equal((await run({...action,bvid:OTHER},scope)).code,'invalid-write-proposal')
 assert.equal(writes,0)
 const outcome=await run(action,scope)
 assert.equal(outcome.status,'uncertain');assert.equal(outcome.ok,false)
 assert.equal(mark,1);assert.equal(writes,1)
 account='e'.repeat(16)
 assert.equal((await run(action,scope)).code,'authorization-changed')
 assert.equal(writes,1)
})

test('executor recognizes ONLY independently verified write result, not raw ok',async()=>{
 const run=createLifeContinuationWriteExecutor({getConfig:()=>cfg,getAccountTag:()=>scope,getAccountUid:()=> '1234',
  getIntention:()=>selected,getPublicEvidence:async()=>evidence,markSelected:()=>({ok:true}),
  runWriter:async()=>({ok:true,status:'verified',attempted:true}),now:()=>T})
 assert.deepEqual(await run({action:'follow_creator',id:ID,bvid:BV,reason:'很想继续了解这个视频作者的公开新作品'},scope),
  {ok:true,status:'verified',code:'verified-platform-write'})
})

function makeLife(dir,answers,writer=async()=>({ok:true,status:'verified'})){
 let modelCalls=0,writeCalls=0
 const cred={dedeuserid:'1020304',sessdata:'dev27-credential'}
 const interest={source:'interest-milestone',topic:'电影配乐',stage:'growing',bvid:BV,
  at:new Date(T-60_000).toISOString(),evidenceCount:4,evidenceDays:3}
 const life=createLifeOpportunities({stateDir:dir,getCredential:()=>cred,getInterestEvidence:()=>[interest],now:()=>T})
 const account=discussionAccountTag(cred)
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>cfg,getLifeAccountTag:()=>account,
  getTodos:()=>[],getAcceptedActionReservations:()=>[],getLifeOpportunities:()=>life.list(),
  getLifeIntentionCues:()=>life.explorationCues(),getLifeIntentions:()=>life.continuations(),
  beginLifeExploration:(...args)=>life.beginExploration(...args),completeLifeExploration:(...args)=>life.completeExploration(...args),
  failLifeExploration:(...args)=>life.failExplorationRead(...args),abandonLifeExploration:(...args)=>life.abandonExploration(...args),
  executeLifeSearch:async topic=>({ok:true,topic,videos:[{bvid:BV,title:'公开视频标题'}]}),
  executeOpportunityRead:async bvid=>({ok:true,bvid,title:'公开视频标题'}),
  getLifeWriteEvidence:async()=>evidence,executeLifeWrite:async(...args)=>{writeCalls++;return writer(...args)},
  recordLifeExplorationWrite:(...args)=>life.recordExplorationWrite(...args),
  invokeModel:async()=>JSON.stringify(answers[modelCalls++]?.(life)||{action:'stop'}),
  executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
 return {planner,life,get calls(){return modelCalls},get writes(){return writeCalls}}
}

test('real planner can choose a guarded write after a verified video inspection, then STOP this turn',()=>home(async dir=>{
 const x=makeLife(dir,[
  life=>({action:'begin_exploration',id:life.explorationCues()[0].id,goal:'想了解真实公开作品'}),
  life=>({action:'inspect_exploration',id:life.continuations()[0].id,bvid:BV,reason:'愿意核实作品'}),
  life=>({action:'comment_video',id:life.continuations()[0].id,bvid:BV,reason:'想对已核实作品留下原创短评',text:'公开简介中的创作方向值得讨论'})])
 const result=await x.planner.tick()
 assert.equal(result.action,'begin_exploration')
 assert.equal(result.continuation.considered,2)
 assert.equal(result.continuation.executed,2)
 assert.equal(result.continuation.reason,'write-verified')
 assert.equal(x.writes,1);assert.equal(x.calls,3)
 const entry=x.life.continuations()[0]
 assert.equal(entry.writeOutcomes[0].status,'verified')
 assert.equal(continuationMenu(entry,{at:T,writeActions:['comment_video']}).some(x=>x.action==='comment_video'),false)
 assert.ok(!JSON.stringify(entry).includes('公开简介中的创作方向值得讨论'),'comment body never enters intention ledger')
}))

test('uncertain platform status blocks the same action on later Life ticks, no hidden retry',()=>home(async dir=>{
 const x=makeLife(dir,[
  life=>({action:'begin_exploration',id:life.explorationCues()[0].id,goal:'想了解真实公开作品'}),
  life=>({action:'inspect_exploration',id:life.continuations()[0].id,bvid:BV}),
  life=>({action:'like_video',id:life.continuations()[0].id,bvid:BV,reason:'我很欣赏这部公开作品的主题'})],
  async()=>({ok:false,status:'uncertain'}))
 const result=await x.planner.tick()
 assert.equal(result.continuation.reason,'write-unverified')
 assert.equal(x.writes,1)
 const entry=x.life.continuations()[0]
 assert.equal(entry.writeOutcomes[0].status,'uncertain')
 assert.equal(continuationMenu(entry,{at:T,writeActions:['like_video']}).some(x=>x.action==='like_video'),false)
}))
