import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {continuationMenu,parseContinuationDecision} from '../lib/life-continuation.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {videoCommentGateCode} from '../lib/video-comment-readiness.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'

const BV='BV1abcde1234',OTHER='BV1abcde1235',THIRD='BV1abcde1236'
const T=Date.parse('2026-11-07T20:00:00Z')
const cred={dedeuserid:'1020304',sessdata:'dev26-test'}
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-dev26-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const active={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:30,
  autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
const interest={source:'interest-milestone',topic:'电影配乐',stage:'growing',bvid:BV,
  at:new Date(T-60_000).toISOString(),evidenceCount:4,evidenceDays:3}

function harness(dir,{answers=[],account=()=>cred,read=async bvid=>({ok:true,bvid,title:'真实公开标题'}),creator=async bvid=>({ok:true,bvid,accountUid:cred.dedeuserid,creatorUid:'4567',videos:[{bvid:THIRD,title:'作者公开投稿'}]})}={}){
 let calls=0,reads=0,creators=0
 const life=createLifeOpportunities({stateDir:dir,now:()=>T,getCredential:account,getInterestEvidence:()=>[interest]})
 const scope=()=>discussionAccountTag(account())
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>active,getLifeAccountTag:scope,
   getTodos:()=>[],getAcceptedActionReservations:()=>[],getLifeOpportunities:()=>life.list(),
   getLifeIntentionCues:()=>life.explorationCues(),getLifeIntentions:()=>life.continuations(),
   beginLifeExploration:(...a)=>life.beginExploration(...a),completeLifeExploration:(...a)=>life.completeExploration(...a),
   failLifeExploration:(...a)=>life.failExplorationRead(...a),inspectLifeCreatorSpace:(...a)=>life.inspectCreatorSpace(...a),
   failLifeCreatorRead:(...a)=>life.failCreatorRead(...a),pauseLifeExploration:(...a)=>life.pauseExploration(...a),abandonLifeExploration:(...a)=>life.abandonExploration(...a),
   executeLifeSearch:async topic=>({ok:true,topic,videos:[{bvid:BV,title:'一段真实音乐'},{bvid:OTHER,title:'其他公开作品'}]}),
   executeOpportunityRead:async bvid=>{reads++;return read(bvid)},executeCreatorSpace:async bvid=>{creators++;return creator(bvid)},
   invokeModel:async()=>{const answer=answers[calls++];return JSON.stringify(typeof answer==='function'?answer(life):answer||{action:'skip'})},
   executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
 return {planner,life,get calls(){return calls},get reads(){return reads},get creators(){return creators}}
}

test('continuation menu is bound to canonical valid BV and current account-scoped intention, never includes writes',()=>{
 const row={id:'a'.repeat(24),status:'ready',expiresAt:T+10000,nextAt:T,videos:[{bvid:BV,title:'公开标题'},{bvid:'bad',title:'未知'},
   {bvid:BV,title:'重复'}]}
 const menu=continuationMenu(row,{at:T})
 assert.deepEqual(menu.map(x=>x.action),['inspect_exploration','abandon_exploration'])
 assert.deepEqual(menu[0].videos.map(x=>x.bvid),[BV])
 assert.equal(parseContinuationDecision(JSON.stringify({action:'inspect_exploration',id:row.id,bvid:OTHER}),menu).reason,'target-not-offered')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'follow_creator',id:row.id}),menu).action,'stop')
 assert.equal(continuationMenu({...row,nextAt:T+1},{at:T}).length,0)
 assert.equal(continuationMenu({...row,expiresAt:T},{at:T}).length,0)
})

test('a verified search can lead to a verified video and creator read in one Life turn; no outbound writes',()=>home(async dir=>{
 const x=harness(dir,{answers:[
   life=>({action:'begin_exploration',id:life.explorationCues()[0].id,goal:'我想了解更多真实的配乐作品'}),
   life=>({action:'inspect_exploration',id:life.continuations()[0].id,bvid:BV,reason:'这条值得核实'}),
   life=>({action:'inspect_creator_space',id:life.continuations()[0].id,reason:'也想看看作者公开作品'})
 ]})
 const result=await x.planner.tick()
 assert.equal(result.action,'begin_exploration')
 assert.equal(result.result,'verified-search-results')
 assert.deepEqual(result.continuation,{considered:3,executed:2,reason:'fish-chose-rest'})
 assert.equal(x.calls,4);assert.equal(x.reads,1);assert.equal(x.creators,1)
 assert.equal(x.life.status().intentions.find(row=>row.source==='interest-milestone').receipt,'fish-chose-rest')
 const state=x.planner.status()
 assert.equal(state.lifeRuns,4)
 assert.match(state.lastResult,/连续考虑 3 次，核实 2 项/)
 assert.equal(state.recent.at(-1).continuationChoices,3)
}))

test('fish may stop freely; no second read occurs after skip',()=>home(async dir=>{
 const x=harness(dir,{answers:[life=>({action:'begin_exploration',id:life.explorationCues()[0].id,goal:'想看看作品'}),{action:'stop'}]})
 const result=await x.planner.tick()
 assert.equal(result.continuation.reason,'fish-chose-rest')
 assert.equal(result.continuation.executed,0)
 assert.equal(x.life.continuations().length,0,'voluntary rest defers this episode rather than immediately re-offering it')
 assert.equal(x.reads,0)
 assert.equal(x.calls,2)
}))

test('failure cannot create a verified continuation or move the model to further targets',()=>home(async dir=>{
 const x=harness(dir,{answers:[life=>({action:'begin_exploration',id:life.explorationCues()[0].id,goal:'想看看作品'}),
   life=>({action:'inspect_exploration',id:life.continuations()[0].id,bvid:BV}),
   life=>({action:'inspect_creator_space',id:life.continuations()[0].id})],
  read:async()=>({ok:true,bvid:OTHER,title:'不匹配视频'})})
 const result=await x.planner.tick()
 assert.equal(result.continuation.reason,'metadata-read-failed')
 assert.equal(result.continuation.executed,0)
 assert.equal(x.calls,2);assert.equal(x.creators,0)
 assert.equal(x.life.status().intentions[0].receipt,'metadata-read-failed')
}))

test('video comment diagnostics preserve no text/BV/UID and never claim zero proposals were model refusal',()=>home(async dir=>{
 const scope=discussionAccountTag(cred)
 const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>scope,now:()=>T})
 const r=events.recordVideoRoundStart({commentGate:'configured'})
 assert.equal(r.ok,true)
 events.recordVideoRoundFinish(r.id,{exitCode:0,pickedCount:3,commentDiagnostics:{proposed:0,approved:0,declined:0,verified:0,unverified:0,lastReason:'private text'}})
 const row=events.status().recentVideoRounds[0]
 assert.equal(row.commentGate,'configured')
 assert.equal(row.commentDiagnostics.proposed,0)
 assert.equal(row.commentDiagnostics.lastReason,'')
 assert.ok(!JSON.stringify(row).includes(BV))
 assert.equal(videoCommentGateCode({...active,autoComment:false,commentPerRound:5,commentDailyLimit:10}),'auto-comment-disabled')
 assert.equal(videoCommentGateCode({...active,autoComment:true,dmMode:'only',commentPerRound:5,commentDailyLimit:10}),'configured','retired report flag cannot affect comment gate')
}))

// The real localhost approval bridge must emit diagnostic phases, never text or target.
// These counters are only observable gateway phases, not proof that an unused
// bili_reply tool was available to the model or that a comment is still visible.
test('comment approval bridge reports proposal, approval and independently verified receipt without target or text',async t=>{
 const {createLifeVideoActionBridge}=await import('../lib/life-video-action-bridge.mjs')
 const events=[]
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>cred.dedeuserid,getAccountTag:()=>discussionAccountTag(cred),
  choose:async()=>({ok:true,proof:{valid:true}}),verify:()=>({ok:true}),receipt:()=>{},
  verifyPlatformState:async()=>true,onCommentDiagnostic:x=>events.push(x)})
 t.after(()=>bridge.stop())
 await bridge.start()
 const env=bridge.env(),post=async(path,payload)=>{
   const resp=await fetch(env.BILI_LIFE_ACTION_URL+path,{method:'POST',headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},body:JSON.stringify(payload)})
   return resp.json()
 }
 const proposal=await post('/life-action',{tool:'bili_reply',target:BV,uid:cred.dedeuserid,topLevel:true,commentText:'临时测试评论'})
 assert.equal(proposal.ok,true)
 const outcome=await post('/life-action-result',{grant:proposal.grant,uid:cred.dedeuserid,ok:true,receiptId:'123456789012'})
 assert.equal(outcome.status,'verified')
 assert.deepEqual(events,[{stage:'proposed',code:''},{stage:'approved',code:''},{stage:'verified',code:'verified'}])
 assert.ok(!JSON.stringify(events).includes(BV));assert.ok(!JSON.stringify(events).includes('临时测试评论'))
})

test('comment gateway classifies a cross-channel cooldown as a technical block, not a voluntary decline',async t=>{
 const {createLifeVideoActionBridge}=await import('../lib/life-video-action-bridge.mjs')
 const events=[]
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>cred.dedeuserid,getAccountTag:()=>discussionAccountTag(cred),
  choose:async()=>({ok:false,reason:'life-cross-channel-rest'}),verify:()=>({ok:false}),receipt:()=>{},
  onCommentDiagnostic:x=>events.push(x)})
 t.after(()=>bridge.stop());await bridge.start()
 const env=bridge.env();const resp=await fetch(env.BILI_LIFE_ACTION_URL+'/life-action',{method:'POST',
  headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},
  body:JSON.stringify({tool:'bili_reply',target:BV,uid:cred.dedeuserid,topLevel:true,commentText:'临时测试评论'})})
 assert.equal(resp.status,409)
 assert.deepEqual(events,[{stage:'proposed',code:''},{stage:'blocked',code:'life-cross-channel-rest'}])
})
