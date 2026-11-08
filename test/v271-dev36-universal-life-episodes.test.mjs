import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createUniversalLifeEpisodes} from '../lib/life-universal-episodes.mjs'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createAutonomousPlanner,plannerActionMenu,validateOfferedLifeAction} from '../lib/autonomous-planner.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
const T=Date.parse('2026-11-08T12:00:00Z'),CRED={dedeuserid:'12345678',sessdata:'episode-demo'}
const A=discussionAccountTag(CRED),B='b'.repeat(16),ROUND='c'.repeat(24),BV='BV1abcde1234',BV2='BV1abcde1235',BV3='BV1abcde1236'
const config={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:24,
 autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,homeRecommendationsEnabled:true}
const tmp=async fn=>{const folder=mkdtempSync(join(tmpdir(),'dev36-episode-'));try{await fn(folder)}finally{rmSync(folder,{recursive:true,force:true})}}

 test('universal episodes retain only opaque, account-isolated causal receipts; never store BV, UID, model text',()=>tmp(async dir=>{
  let account=A,time=T
  const x=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>account,now:()=>time})
  const root=x.record({accountTag:A,sourceRef:'intention:BV1abcde1234',receiptId:'real-round:'+ROUND,action:'browse_home',kind:'video',outcome:'verified'})
  assert.equal(root.ok,true);assert.equal(root.episode.steps,1);assert.equal(root.episode.status,'active')
  assert.equal(x.record({accountTag:A,sourceRef:'intention:BV1abcde1234',receiptId:'real-round:'+ROUND,action:'browse_home',kind:'video',outcome:'verified'}).duplicate,true)
  assert.equal(x.list().length,1)
  assert.deepEqual(x.health({eligibleSources:['intention:BV1abcde1234']}),
    {active:1,firstStepOnly:1,staleFirstStep:0,firstStepWithoutEligibleSource:0,
      eligibleToResume:0,paused:0,needsReview:0})
  assert.equal(x.due({eligibleSources:['intention:BV1abcde1234']}),false)
  time+=121_000
  assert.equal(x.due({eligibleSources:['intention:BV1abcde1234']}),true)
  assert.equal(x.record({accountTag:A,sourceRef:'intention:BV1abcde1234',receiptId:'step-2',action:'inspect_exploration',kind:'video',outcome:'verified'}).episode.steps,2)
  time+=1000
  assert.equal(x.record({accountTag:A,sourceRef:'intention:BV1abcde1234',receiptId:'pending',action:'consider_social',kind:'social',outcome:'delegated'}).episode.steps,2,'no fake verified step')
  for(const [i,action] of ['inspect_creator_space','inspect_video_discussion','browse_home_more'].entries()){
    time+=121_000
    const got=x.record({accountTag:A,sourceRef:'intention:BV1abcde1234',receiptId:'step-'+(i+3),action,kind:'exploration',outcome:'verified'})
    assert.equal(got.ok,true)
  }
  const end=x.list({includeClosed:true})[0]
  assert.equal(end.steps,5);assert.equal(end.status,'completed');assert.equal(x.due({eligibleSources:['intention:BV1abcde1234']}),false)
  time+=121_000
  const next=x.record({accountTag:A,sourceRef:'intention:BV1abcde1234',receiptId:'step-6',action:'inspect_exploration',kind:'video',outcome:'verified'})
  assert.equal(next.episode.segment,2);assert.equal(next.episode.seriesId,root.episode.seriesId)
  assert.equal(next.episode.steps,1)
  const raw=readFileSync(join(dir,'life-episodes',A+'.json'),'utf8')
  assert.doesNotMatch(raw,/BV1abcde1234|12345678|episode-demo|原评论|模型想说/)
  account=B;assert.deepEqual(x.list(),[])
  assert.equal(x.health().firstStepOnly,0,'no cross-account continuity health exposure')
  assert.equal(x.record({accountTag:A,sourceRef:'intention:BV1abcde1234',receiptId:'cross',action:'read',outcome:'verified'}).ok,false)
  account=A;assert.equal(x.list({includeClosed:true}).length,2)
 }))

 test('uncertain writes freeze only their causal Episode; skipping pauses rather than completing or forcing comment',()=>tmp(async dir=>{
  let now=T;const e=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>A,now:()=>now})
  const row=e.record({sourceRef:'intention:aaa',receiptId:'r1',action:'inspect_exploration',kind:'video',outcome:'verified'}).episode
  assert.equal(e.record({sourceRef:'intention:aaa',receiptId:'r2',action:'comment_video',kind:'video',outcome:'unknown'}).episode.status,'review')
  assert.equal(e.due(),false)
  assert.equal(e.record({sourceRef:'intention:bbb',receiptId:'r3',action:'execute_read',kind:'todo',outcome:'verified'}).episode.status,'active')
  assert.equal(e.pauseLatest({delayMs:60*60_000}).ok,true)
  assert.equal(e.list().some(x=>x.status==='paused'),true)
  assert.equal(e.list({includeClosed:true}).find(x=>x.id===row.id).status,'review')
  assert.equal(e.record({sourceRef:'intention:bbb',receiptId:'forged',action:'comment_video',kind:'todo',outcome:'made-up'}).ok,false)
 }))

test('resume_episode is offered only for actual current, open public intentions and cannot be guessed',()=>{
 const menu=plannerActionMenu({intents:[{id:'real-episode',status:'ready',episodeSteps:2,episodeMaxSteps:5,videos:[{bvid:BV}]}]})
 assert.equal(validateOfferedLifeAction({action:'resume_episode',id:'real-episode'},menu),true)
 assert.equal(validateOfferedLifeAction({action:'resume_episode',id:'invented'},menu),false)
 assert.equal(plannerActionMenu({intents:[]}).some(x=>x.action==='resume_episode'),false)
})

test('video child verified step + a fresh Life resume choice carries 3–5 linked steps, not just a first-action shell',()=>tmp(async dir=>{
 let time=T,choices=0,reads=0,creators=0,scope=A
 const life=createLifeOpportunities({stateDir:dir,getCredential:()=>CRED,now:()=>time})
 const context=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>scope,now:()=>time})
 const first=life.beginHomeExploration(ROUND,[{bvid:BV,title:'首页视频 1',picked:true},{bvid:BV2,title:'首页视频 2',picked:true}],scope)
 assert.equal(first.ok,true)
 assert.equal(context.record({accountTag:A,sourceRef:'intention:'+first.id,receiptId:'video-round:'+ROUND,
  action:'browse_home',kind:'video',outcome:'verified'}).episode.steps,1)
 // After a true video-process completion, two minutes later the original
 // scheduler is allowed to reconsider without violating 5-minute idle pace.
 time+=121_000
 const prompts=[]
 const replies=[{action:'resume_episode',id:first.id},
  {action:'inspect_exploration',id:first.id,bvid:BV},
  {action:'inspect_creator_space',id:first.id},
  {action:'inspect_exploration',id:first.id,bvid:BV2},
  {action:'stop'}]
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>time,getConfig:()=>config,getTodos:()=>[],
  getLifeAccountTag:()=>scope,getLifeEpisodeContext:()=>context.list(),isLifeEpisodeDue:()=>context.due({eligibleSources:life.continuations().map(x=>'intention:'+x.id)}),
  getLifeEpisodeSourceState:ref=>context.sourceState(ref),
  onEpisodeAction:x=>context.record(x),pauseLifeEpisode:x=>context.pauseLatest(x),
  getLifeOpportunities:()=>[],getLifeIntentionCues:()=>[],getLifeIntents:()=>[],
  getLifeIntentions:()=>life.continuations(),getActiveLifeIntentionReservations:()=>life.intentions({includeClosed:true,limit:20}),
  completeLifeExploration:(...args)=>life.completeExploration(...args),inspectLifeCreatorSpace:(...args)=>life.inspectCreatorSpace(...args),
  failLifeCreatorRead:(...args)=>life.failCreatorRead(...args),failLifeExploration:(...args)=>life.failExplorationRead(...args),
  pauseLifeExploration:(...args)=>life.pauseExploration(...args),abandonLifeExploration:(...args)=>life.abandonExploration(...args),
  getLifeEvents:()=>[],getLifeEventStatus:()=>({pending:0,lastVideoAt:0,videoStartsToday:0}),
  offerLifeWake:()=>({ok:true}),settleLifeEvents:()=>({ok:true}),
  executeOpportunityRead:async bv=>{reads++;return {ok:true,bvid:bv,title:'实测元数据'}},
  executeCreatorSpace:async bv=>{creators++;return {ok:true,bvid:bv,accountUid:CRED.dedeuserid,creatorUid:'987654',videos:[{bvid:BV3,title:'作者作品'}]}},
  executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false}),
  getLifeWriteEvidence:async()=>({ok:false}),
  invokeModel:async prompt=>{prompts.push(prompt);return JSON.stringify(replies[choices++]||{action:'stop'})}
 })
 const result=await planner.tick()
 assert.equal(result.action,'resume_episode')
 assert.equal(result.result,'episode-continued')
 assert.equal(result.continuation.executed,3,'3 verified follow-up steps after independently completed home browse')
 assert.equal(reads,2);assert.equal(creators,1)
 assert.equal(prompts.length,5,'model independently decides each next action, including when to stop')
 assert.match(prompts[0],/recentLifeEpisodes/)
 const e=context.list()[0]
 assert.equal(e.steps,4);assert.equal(e.status,'paused')
 assert.deepEqual(e.history.filter(x=>x.outcome==='verified').map(x=>x.action),[
  'browse_home','inspect_exploration','inspect_creator_space','inspect_exploration'])
 assert.equal(result.continuation.reason,'fish-chose-rest')
 assert.equal(context.list().find(x=>x.id===e.id)?.status,'paused')
 assert.equal(context.due(),false,'no forced immediately repeated model call')
}))

test('universal ledger receives real non-video Life reflections and accepted TODO reads, not merely homepage picks',()=>tmp(async dir=>{
 let time=T,account=A,calls=0
 const episodes=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>account,now:()=>time})
 const base={dataDir:dir,now:()=>time,getConfig:()=>config,getLifeAccountTag:()=>account,
   onEpisodeAction:x=>episodes.record(x),getLifeEpisodeContext:()=>episodes.list(),
   getLifeEvents:()=>[],getLifeEventStatus:()=>({pending:0,lastVideoAt:0,videoStartsToday:0}),
   getLifeCapabilities:()=>[],executeRead:async()=>({ok:true}),updateTodo:async()=>({ok:true}),
   getLifeIntents:()=>[],getLifeIntentions:()=>[],reflect:async()=>({ok:true})}
 const reflection=createAutonomousPlanner({...base,getTodos:()=>[],
   reflectionStatus:()=>({pending:7,canAutoReflect:true}),
   invokeModel:async()=>{calls++;return JSON.stringify({action:'reflect'})}})
 const first=await reflection.tick({force:true})
 assert.equal(first.result,'completed')
 assert.equal(episodes.list()[0].lastAction,'reflect')
 assert.equal(episodes.list()[0].steps,1)
 time+=60_000
 const todo={id:'accepted-todo-01',type:'search_videos',title:'看看公开视频',status:'open',createdAt:time-1000}
 const read=createAutonomousPlanner({...base,getTodos:()=>[todo],reflectionStatus:()=>({pending:0,canAutoReflect:false}),
   invokeModel:async()=>{calls++;return JSON.stringify({action:'execute_read',id:todo.id})}})
 const second=await read.tick({force:true})
 assert.equal(second.result,'done')
 assert.equal(episodes.list().find(x=>x.lastAction==='execute_read')?.steps,1)
 assert.equal(calls,2)
 account=B
 assert.deepEqual(episodes.list(),[],'B must not see A\'s reflection or TODO histories')
}))

test('stalled first-step Episode is observable without forcing a model call or granting a send',()=>tmp(async dir=>{
 let time=T
 const life=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>A,now:()=>time})
 life.record({sourceRef:'intention:real',receiptId:'real-home-result',action:'browse_home',kind:'video',outcome:'verified'})
 time+=61*60_000
 const missing=life.health({eligibleSources:[]})
 assert.equal(missing.firstStepOnly,1)
 assert.equal(missing.staleFirstStep,1)
 assert.equal(missing.firstStepWithoutEligibleSource,1)
 assert.equal(life.due({eligibleSources:[]}),false,'cannot force a Life model with no original executable intention')
 assert.equal(life.health({eligibleSources:['intention:real']}).eligibleToResume,1)
 life.pauseLatest({delayMs:60*60_000})
 assert.equal(life.health().staleFirstStep,0,'voluntary rest must not look like a blocked first step')
 assert.equal(life.health().paused,1)
}))
