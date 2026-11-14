import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {continuationMenu,parseContinuationDecision} from '../lib/life-continuation.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
const START=Date.parse('2026-11-08T11:00:00Z')
const CRED={dedeuserid:'1045678',sessdata:'episode-dev35-scope'}, SCOPE=discussionAccountTag(CRED)
const BV='BV1abcde1234',OTHER='BV1abcde1235',THIRD='BV1abcde1236',ROUND='b'.repeat(24)
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-episode-guard-'));try{await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const picks=[{bvid:BV,title:'核实入选视频 A',picked:true},{bvid:OTHER,title:'核实入选视频 B',picked:true}]
const make=(dir,clock)=>createLifeOpportunities({stateDir:dir,getCredential:()=>CRED,now:clock})
const seed=life=>{const r=life.beginHomeExploration(ROUND,picks,SCOPE);assert.equal(r.ok,true)
  const metadata=life.completeExploration(r.id,BV,{ok:true,bvid:BV,title:'已核实的 A'},SCOPE);assert.equal(metadata.ok,true);return r.id}
const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:30,
 autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,autoVideoLike:true,
 autoVideoLikeDailyLimit:4,autoComment:true,commentDailyLimit:3,commentPerRound:1}
const writes=['like_video','collect_video','follow_creator','comment_video']

test('verified like is an Episode step, not automatic completion or inferred comment intent',()=>home(async dir=>{
 let t=START;const life=make(dir,()=>t),id=seed(life)
 const ok=life.recordExplorationWrite(id,'like_video',BV,'verified',SCOPE)
 assert.equal(ok.ok,true);assert.equal(ok.receipt,'verified-platform-write')
 const current=life.continuations().find(x=>x.id===id)
 assert.equal(current.status,'inspected');assert.equal(current.episodeStatus,'active')
 assert.equal(current.episodeSteps,3);assert.equal(current.writeAftercare,'read-or-rest')
 assert.deepEqual(current.episodeHistory.map(x=>x.action),['browse-home','inspect-video','life-write-verified'])
 const menu=continuationMenu(current,{at:t,writeActions:writes})
 assert.equal(menu.some(x=>writes.includes(x.action)),false,'all writes closed until read or rest')
 assert.equal(menu.some(x=>x.action==='inspect_video_discussion'),true)
 assert.equal(menu.some(x=>x.action==='inspect_exploration'),true)
 assert.equal(parseContinuationDecision(JSON.stringify({action:'comment_video',id,bvid:BV,reason:'未经核实的下一句',text:'你好'}),menu).action,'stop')
 const raw=readFileSync(join(dir,'life-opportunities',SCOPE+'.json'),'utf8')
 assert.doesNotMatch(raw,/评论正文|recipientUid|cookie|私信原文/)
}))

test('independent confirmed discussion read can re-enable a NEW future writing choice, but 30s cooling remains',()=>home(async dir=>{
 let t=START;const life=make(dir,()=>t),id=seed(life)
 assert.equal(life.recordExplorationWrite(id,'like_video',BV,'verified',SCOPE).ok,true)
 assert.equal(life.inspectVideoDiscussion(id,{ok:true,verified:false,bvid:BV,count:2},SCOPE).ok,false)
 assert.equal(life.inspectVideoDiscussion(id,{ok:true,verified:true,bvid:OTHER,count:2},SCOPE).ok,false)
 assert.equal(life.inspectVideoDiscussion(id,{ok:true,verified:true,bvid:BV,count:11},SCOPE).ok,false)
 assert.equal(life.inspectVideoDiscussion(id,{ok:true,verified:true,bvid:BV,count:2,rawText:'danger'},SCOPE).ok,true)
 const row=life.continuations().find(x=>x.id===id)
 assert.equal(row.episodeSteps,4);assert.equal(row.writeAftercare,'read-verified')
 assert.equal(continuationMenu(row,{at:t,writeActions:writes}).some(x=>writes.includes(x.action)),false)
 t+=30_001
 const resumed=life.continuations().find(x=>x.id===id)
 const menu=continuationMenu(resumed,{at:t,writeActions:writes})
 assert.equal(menu.some(x=>x.action==='like_video'),false,'already verified like cannot be repeated')
 assert.equal(menu.some(x=>x.action==='comment_video'),true,'a different valid action is only a candidate, not an order')
 assert.equal(life.recordExplorationWrite(id,'like_video',BV,'verified',SCOPE).ok,false)
 assert.equal(life.recordExplorationWrite(id,'comment_video',BV,'verified',SCOPE).ok,true)
 const completed=life.status().intentions.find(x=>x.id===id)
 assert.equal(completed.episodeSteps,5);assert.equal(completed.status,'completed')
 assert.equal(completed.receipt,'episode-step-limit')
 assert.equal(life.continuations().some(x=>x.id===id),false)
}))

test('explicit rest, not silent timeout, enables fresh writing decision after elapsed >=15min',()=>home(async dir=>{
 let t=START;const life=make(dir,()=>t),id=seed(life)
 assert.equal(life.recordExplorationWrite(id,'like_video',BV,'verified',SCOPE).ok,true)
 const paused=life.pauseExploration(id,5_000,SCOPE)
 assert.equal(paused.ok,true);assert.ok(paused.nextAt-t>=15*60_000)
 assert.equal(life.continuations().some(x=>x.id===id),false)
 t=paused.nextAt-1
 assert.equal(life.continuations().some(x=>x.id===id),false)
 t=paused.nextAt+1
 const row=life.continuations().find(x=>x.id===id)
 assert.equal(row.writeAftercare,'resting')
 assert.equal(continuationMenu(row,{at:t,writeActions:writes}).some(x=>x.action==='comment_video'),true)
 assert.equal(life.recordExplorationWrite(id,'comment_video',BV,'verified',SCOPE).ok,true)
 assert.equal(life.status().intentions.find(x=>x.id===id).episodeSteps,4)
}))

test('uncertain platform write freezes episode; no read/rest escapes the freeze',()=>home(async dir=>{
 let t=START;const life=make(dir,()=>t),id=seed(life)
 assert.equal(life.recordExplorationWrite(id,'comment_video',BV,'uncertain',SCOPE).ok,true)
 assert.equal(life.inspectVideoDiscussion(id,{ok:true,verified:true,bvid:BV,count:1},SCOPE).ok,false)
 assert.equal(life.pauseExploration(id,60*60_000,SCOPE).ok,false)
 assert.equal(life.continuations().some(x=>x.id===id),false)
}))

test('without an explicit compatible bundle, a Life tick does not chain unrelated writes',()=>home(async dir=>{
 let t=START;const life=make(dir,()=>t),id=seed(life),actions=[],menus=[]
 let calls=0,first=true
 const replies=[
   l=>({action:'inspect_exploration',id,bvid:OTHER,reason:'还想核实第二条作品'}),
   l=>({action:'like_video',id,bvid:OTHER,reason:'确实认可这条作品有意思'}),
   l=>({action:'inspect_video_discussion',id,bvid:OTHER,reason:'想看看评论区大家怎么理解这个作品'}),
   l=>({action:'comment_video',id,bvid:OTHER,reason:'点赞之后顺便也评论一下',text:'也想跟大家交流'})
 ]
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>t,getConfig:()=>cfg,getLifeAccountTag:()=>SCOPE,
  getTodos:()=>[],getLifeOpportunities:()=>[],getLifeIntentionCues:()=>[],getLifeIntentions:()=>life.continuations(),
  getActiveLifeIntentionReservations:()=>life.intentions({includeClosed:true,limit:20}),
  completeLifeExploration:(...a)=>life.completeExploration(...a),failLifeExploration:()=>({ok:false}),
  inspectLifeCreatorSpace:()=>({ok:false}),inspectLifeVideoDiscussion:(...a)=>life.inspectVideoDiscussion(...a),
  recordLifeExplorationWrite:(...a)=>life.recordExplorationWrite(...a),
  executeOpportunityRead:async bvid=>({ok:true,bvid,title:'可信作品 '+bvid}),
  executeVideoDiscussion:async bvid=>({ok:true,verified:true,bvid,count:2}),
  getLifeWriteEvidence:async bvid=>({ok:true,bvid,commentReady:true,description:'真实公开资料'}),
  executeLifeWrite:async proposal=>{actions.push(proposal.action);return {ok:true,status:'verified'}},
  invokeModel:async prompt=>{menus.push(prompt);const r=replies[calls++]||(()=>({action:'stop'}));return JSON.stringify(r(life))},
  executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false}),
  getLifeEvents:()=>[],getLifeEventStatus:()=>({pending:0,videoStartsToday:0,lastVideoAt:0}),
  offerLifeWake:()=>({ok:true}),settleLifeEvents:()=>({ok:true}),recordVideoStart:()=>({ok:true})})
 const outcome=await planner.tick()
 assert.equal(outcome.action,'inspect_exploration')
 assert.deepEqual(actions,['like_video'],'only one external platform write in one automatic turn')
 assert.equal(life.status().intentions.find(x=>x.id===id).episodeSteps,5)
 assert.equal(menus.some(x=>x.includes('已经核验的点赞、收藏、关注或原创评论不代表你还想做另一种写入')),true)
}))

test('one optional homepage refresh is a bounded read-only Episode step; repeat/duplicate/invalid result cannot inflate steps',()=>home(async dir=>{
 let t=START;const life=make(dir,()=>t),id=seed(life)
 const before=life.continuations()[0]
 assert.equal(continuationMenu(before,{at:t,homeBrowseAvailable:false}).some(x=>x.action==='browse_home_more'),false)
 const menu=continuationMenu(before,{at:t,homeBrowseAvailable:true})
 assert.equal(menu.some(x=>x.action==='browse_home_more'),true)
 const selected=parseContinuationDecision(JSON.stringify({action:'browse_home_more',id,reason:'想换个方向随便看看'}),menu)
 assert.equal(selected.action,'browse_home_more')
 assert.equal(life.browseHomeMore(id,{ok:true,verified:true,videos:[{bvid:THIRD,title:'第二批真实首页候选'}]},SCOPE).ok,true)
 const after=life.continuations()[0]
 assert.equal(after.homeRefreshCount,1);assert.equal(after.episodeSteps,3)
 assert.deepEqual(after.videos.map(x=>x.bvid),[BV,OTHER,THIRD])
 assert.equal(continuationMenu(after,{at:t,homeBrowseAvailable:true}).some(x=>x.action==='browse_home_more'),false)
 assert.equal(life.browseHomeMore(id,{ok:true,verified:true,videos:[{bvid:'BV1newnewnew',title:'不能重复添加'}]},SCOPE).ok,false)
 const raw=readFileSync(join(dir,'life-opportunities',SCOPE+'.json'),'utf8')
 assert.doesNotMatch(raw,/cookie|凭证|弹幕正文/)
}))

test('empty or unverified homepage refresh is consumed without forging a verified step and cannot auto retry',()=>home(async dir=>{
 let t=START;const life=make(dir,()=>t),id=seed(life)
 const empty=life.browseHomeMore(id,{ok:false,videos:[{bvid:OTHER,title:'不可信'}]},SCOPE)
 assert.equal(empty.ok,true);assert.equal(empty.added,0)
 assert.equal(life.status().intentions.find(x=>x.id===id).episodeSteps,2)
 assert.equal(life.status().intentions.find(x=>x.id===id).homeRefreshCount,1)
 assert.equal(life.browseHomeMore(id,{ok:true,verified:true,videos:[{bvid:OTHER,title:'重复试图补录'}]},SCOPE).ok,false)
}))

test('the voluntary Episode model sees only source-backed prior action history, never a mandatory comment suggestion',()=>home(async dir=>{
 let t=START;const life=make(dir,()=>t),id=seed(life)
 life.recordExplorationWrite(id,'like_video',BV,'verified',SCOPE)
 const row=life.status().intentions.find(x=>x.id===id)
 const {continuationPrompt}=await import('../lib/life-continuation.mjs')
 const menu=continuationMenu(row,{at:t,writeActions:writes})
 const prompt=continuationPrompt(menu,'今天想放松一下',{ok:true,bvid:BV,episodeHistory:row.episodeHistory})
 assert.match(prompt,/life-write-verified/)
 assert.match(prompt,/like_video/)
 assert.match(prompt,/不代表你还想做另一种写入/)
 assert.doesNotMatch(prompt,/评论原文|私信原文|cookie/)
 assert.equal(menu.some(x=>x.action==='comment_video'),false)
}))
