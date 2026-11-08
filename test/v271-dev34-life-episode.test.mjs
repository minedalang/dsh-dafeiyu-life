import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {continuationMenu} from '../lib/life-continuation.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
import {createLifeVideoActionBridge} from '../lib/life-video-action-bridge.mjs'
import {classifyVideoCommentRound} from '../lib/video-comment-readiness.mjs'

const T=Date.parse('2026-11-08T10:00:00Z')
const cred={dedeuserid:'1020304',sessdata:'dev34-life-episode'}
const scope=discussionAccountTag(cred)
const BV='BV1abcde1234',OTHER='BV1abcde1235',THIRD='BV1abcde1236',FOURTH='BV1abcde1237'
const ROUND='c'.repeat(24)
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-life-episode-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const active={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:30,
  autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
const picked=[{bvid:BV,title:'首页入选视频 A',picked:true},{bvid:OTHER,title:'首页入选视频 B',picked:true},
  {bvid:THIRD,title:'未入选视频不得进入',picked:false},{bvid:'invalid',title:'无效 BV',picked:true}]

function makeLife(dir,now=()=>T){
 return createLifeOpportunities({stateDir:dir,now,getCredential:()=>cred,getInterestEvidence:()=>[
  {source:'interest-milestone',topic:'电影配乐',stage:'growing',bvid:BV,at:new Date(T-60_000).toISOString(),evidenceCount:4,evidenceDays:3}
 ]})
}
function makePlanner(dir,life,answers,{now=()=>T}={}){
 let calls=0,reads=0,creators=0;const wakes=[]
 const planner=createAutonomousPlanner({dataDir:dir,now,getConfig:()=>active,getLifeAccountTag:()=>scope,
  getTodos:()=>[],getAcceptedActionReservations:()=>[],getLifeOpportunities:()=>life.list(),
  getLifeIntentionCues:()=>life.explorationCues(),getLifeIntentions:()=>life.continuations(),
  getActiveLifeIntentionReservations:()=>life.intentions({includeClosed:true,limit:20}),
  beginLifeExploration:(...a)=>life.beginExploration(...a),completeLifeExploration:(...a)=>life.completeExploration(...a),
  failLifeExploration:(...a)=>life.failExplorationRead(...a),inspectLifeCreatorSpace:(...a)=>life.inspectCreatorSpace(...a),
  failLifeCreatorRead:(...a)=>life.failCreatorRead(...a),pauseLifeExploration:(...a)=>life.pauseExploration(...a),
  abandonLifeExploration:(...a)=>life.abandonExploration(...a),
  executeLifeSearch:async topic=>({ok:true,topic,videos:[{bvid:BV,title:'真实搜索视频 A'},{bvid:OTHER,title:'真实搜索视频 B'}]}),
  executeOpportunityRead:async bvid=>{reads++;return {ok:true,bvid,title:'已核验公开标题 '+bvid}},
  executeCreatorSpace:async bvid=>{creators++;return {ok:true,bvid,accountUid:cred.dedeuserid,creatorUid:String(4000+creators),videos:[{bvid:THIRD,title:'作者公开投稿'}]}},
  invokeModel:async()=>{const answer=answers[calls++];return JSON.stringify(typeof answer==='function'?answer(life):answer||{action:'stop'})},
  executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false}),
  getLifeEvents:()=>[],offerLifeWake:event=>{wakes.push(event);return {ok:true}},settleLifeEvents:()=>({ok:true}),
  getLifeEventStatus:()=>({pending:0,videoStartsToday:0,lastVideoAt:0}),getLifeWriteEvidence:async()=>({ok:false}),
  executeLifeWrite:async()=>({ok:false,status:'blocked'}),recordLifeExplorationWrite:(...a)=>life.recordExplorationWrite(...a)})
 return {planner,life,get calls(){return calls},get reads(){return reads},get creators(){return creators},wakes}
}

test('home-browse creates one account-bound Episode from only newly picked BV candidates',()=>home(async dir=>{
 const life=makeLife(dir)
 const wrong=life.beginHomeExploration(ROUND,picked,discussionAccountTag({dedeuserid:'999',sessdata:'other'}))
 assert.equal(wrong.ok,false)
 const created=life.beginHomeExploration(ROUND,picked,scope)
 assert.equal(created.ok,true);assert.equal(created.created,true);assert.equal(created.episodeSteps,1);assert.equal(created.episodeMaxSteps,5)
 const [row]=life.continuations()
 assert.equal(row.source,'home-browse');assert.equal(row.receipt,'verified-home-picks')
 assert.deepEqual(row.videos.map(x=>x.bvid),[BV,OTHER])
 assert.deepEqual(row.visitedBvids,[])
 const duplicate=life.beginHomeExploration(ROUND,picked,scope)
 assert.equal(duplicate.created,false);assert.equal(duplicate.id,created.id)
 assert.deepEqual(continuationMenu(row,{at:T}).map(x=>x.action),['inspect_exploration','abandon_exploration'])
}))

test('one home Life Episode can naturally continue through five verified steps, with fresh choice each time',()=>home(async dir=>{
 const life=makeLife(dir),seed=life.beginHomeExploration(ROUND,picked,scope);assert.equal(seed.ok,true)
 const x=makePlanner(dir,life,[
  l=>({action:'inspect_exploration',id:l.continuations()[0].id,bvid:BV,reason:'想先核实这条视频'}),
  l=>({action:'inspect_creator_space',id:l.continuations()[0].id,reason:'想看看作者的其他公开作品'}),
  l=>({action:'inspect_exploration',id:l.continuations()[0].id,bvid:OTHER,reason:'另一条入选视频也值得了解'}),
  l=>({action:'inspect_creator_space',id:l.continuations()[0].id,reason:'想看看这条视频作者的其他作品'})
 ])
 const result=await x.planner.tick()
 assert.equal(result.action,'inspect_exploration')
 assert.deepEqual(result.continuation,{considered:3,executed:3,reason:'episode-step-limit'})
 assert.equal(x.calls,4);assert.equal(x.reads,2);assert.equal(x.creators,2)
 const closed=life.status().intentions.find(x=>x.id===seed.id)
 assert.equal(closed.status,'completed');assert.equal(closed.episodeStatus,'completed');assert.equal(closed.episodeSteps,5)
 assert.deepEqual(closed.visitedBvids,[BV,OTHER])
 assert.equal(life.continuations().some(x=>x.id===seed.id),false)
}))

test('search and public-person entry points also initialize the same five-step episode contract',()=>home(async dir=>{
 const life=makeLife(dir)
 const cue=life.explorationCues()[0]
 const search=life.beginExploration(cue.id,'想进一步了解电影配乐',
  {ok:true,topic:'电影配乐',videos:[{bvid:BV,title:'真实视频 A'}]},scope)
 assert.equal(search.ok,true)
 let row=life.continuations().find(x=>x.id===search.id)
 assert.equal(row.episodeSteps,1);assert.equal(row.episodeMaxSteps,5)
 const read=life.completeExploration(search.id,BV,{ok:true,bvid:BV,title:'真实视频 A'},scope)
 assert.equal(read.ok,true)
 row=life.continuations().find(x=>x.id===search.id)
 assert.equal(row.episodeSteps,2);assert.deepEqual(row.visitedBvids,[BV])
 assert.equal(continuationMenu(row,{at:T}).some(x=>x.action==='inspect_exploration'),false)
}))

test('a voluntary stop pauses only this episode; unknown writes freeze it; verified writes close it',()=>home(async dir=>{
 const life=makeLife(dir),seed=life.beginHomeExploration(ROUND,picked,scope)
 assert.equal(life.pauseExploration(seed.id,60*60_000,scope).ok,true)
 assert.equal(life.continuations().some(x=>x.id===seed.id),false)
 const paused=life.status().intentions.find(x=>x.id===seed.id);assert.equal(paused.status,'ready');assert.equal(paused.receipt,'fish-chose-rest')
 const ready=life.beginHomeExploration('d'.repeat(24),picked,scope)
 assert.equal(life.completeExploration(ready.id,BV,{ok:true,bvid:BV,title:'真实标题'},scope).ok,true)
 assert.equal(life.recordExplorationWrite(ready.id,'comment_video',BV,'uncertain',scope).ok,true)
 const frozen=life.status().intentions.find(x=>x.id===ready.id);assert.equal(frozen.status,'review');assert.equal(frozen.episodeStatus,'review')
 assert.equal(life.continuations().some(x=>x.id===ready.id),false)
 const third=life.beginHomeExploration('e'.repeat(24),picked,scope)
 assert.equal(life.completeExploration(third.id,BV,{ok:true,bvid:BV,title:'真实标题'},scope).ok,true)
 assert.equal(life.recordExplorationWrite(third.id,'like_video',BV,'verified',scope).ok,true)
 const done=life.status().intentions.find(x=>x.id===third.id);assert.equal(done.status,'completed');assert.equal(done.receipt,'verified-platform-write')
}))

test('the video round seeds an Episode only after a verified Life-owned homepage completion',()=>{
 const idx=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(idx,/code===0&&verifiedVideoRoundCompletion&&homeFirst&&why==='life-agent'/)
 assert.match(idx,/lifeOpportunities\.beginHomeExploration\(videoRoundReceiptId/)
 assert.match(idx,/exactHomePickedRows\.slice\(0,5\)/)
 assert.match(idx,/completed\?\.homePickedBvids/)
 assert.match(idx,/newlyPickedRows=parseSeenTable\(\)\.filter\(x=>x\.picked&&!watchedBeforeRun\.has\(x\.bvid\)\)/)
})

test('technical comment blocks are not misclassified as voluntary refusal',()=>{
 assert.equal(classifyVideoCommentRound({gate:'configured',pickedCount:1,exitCode:0,review:{proposed:1,blocked:1}}).code,'comment-technically-blocked')
})

test('cross-channel comment cooldown gets one bounded Life re-consideration, never an automatic platform retry',async t=>{
 let now=T,calls=0,platformVerifications=0
 const events=[]
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>cred.dedeuserid,getAccountTag:()=>scope,
  now:()=>now,sleep:async ms=>{now+=ms},
  choose:async()=>++calls===1?{ok:false,reason:'life-cross-channel-rest',notBefore:T+30_000}:{ok:true,proof:{id:'proof',valid:true}},
  verify:()=>({ok:true}),receipt:()=>{},verifyPlatformState:async()=>{platformVerifications++;return true},
  onCommentDiagnostic:x=>events.push(x)})
 t.after(()=>bridge.stop());await bridge.start()
 const env=bridge.env()
 const proposed=await fetch(env.BILI_LIFE_ACTION_URL+'/life-action',{method:'POST',headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},
  body:JSON.stringify({tool:'bili_reply',target:BV,uid:cred.dedeuserid,topLevel:true,commentText:'有真实证据支持的原创评论'})})
 const grant=await proposed.json()
 assert.equal(proposed.status,200);assert.equal(grant.ok,true);assert.equal(calls,2)
 assert.deepEqual(events,[{stage:'proposed',code:''},{stage:'approved',code:''}])
 // Life approval is not a platform write. Only a separate writer result can
 // trigger the independent read-after-write verification path.
 assert.equal(platformVerifications,0)
})


test('account switch during comment cooldown prevents the delayed Life re-consideration',async t=>{
 let now=T,calls=0,tag=scope
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>cred.dedeuserid,getAccountTag:()=>tag,
  now:()=>now,sleep:async ms=>{now+=ms;tag='b'.repeat(16)},
  choose:async()=>{calls++;return {ok:false,reason:'life-cross-channel-rest',notBefore:T+30_000}},
  verify:()=>({ok:true}),receipt:()=>{}})
 t.after(()=>bridge.stop());await bridge.start()
 const env=bridge.env()
 const resp=await fetch(env.BILI_LIFE_ACTION_URL+'/life-action',{method:'POST',headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},
  body:JSON.stringify({tool:'bili_reply',target:BV,uid:cred.dedeuserid,topLevel:true,commentText:'有真实证据支持的原创评论'})})
 assert.equal(resp.status,409);assert.equal(calls,1,'account switch cancels the only deferred re-consideration')
})


test('video-round completion returns exact homepage BV matches transiently but persists only counts and hashes',()=>home(async dir=>{
 const {createLifeAgentEvents}=await import('../lib/life-agent-events.mjs')
 const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>scope,now:()=>T})
 const round=events.recordVideoRoundStart({source:'life-agent',entryMode:'home'})
 events.recordHomeFeedRead(round.id,{status:'candidates',candidateBvids:[BV,OTHER]})
 const finish=events.recordVideoRoundFinish(round.id,{exitCode:0,pickedCount:2,pickedBvids:[BV,THIRD]})
 assert.deepEqual(finish.homePickedBvids,[BV])
 const status=JSON.stringify(events.status().recentVideoRounds)
 assert.match(status,/"homePickedCount":1/)
 assert.doesNotMatch(status,/BV1abcde1234|BV1abcde1235|BV1abcde1236/)
 const life=makeLife(dir)
 const episode=life.beginHomeExploration(round.id,picked.filter(x=>finish.homePickedBvids.includes(x.bvid)),scope)
 assert.equal(episode.ok,true)
 assert.deepEqual(life.continuations().find(x=>x.id===episode.id).videos.map(x=>x.bvid),[BV])
}))
