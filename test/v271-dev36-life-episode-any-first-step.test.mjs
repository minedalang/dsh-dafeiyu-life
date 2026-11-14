import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {eligibleLifeEpisodeSources} from '../lib/life-episode-entrypoints.mjs'
import {createUniversalLifeEpisodes} from '../lib/life-universal-episodes.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

const A='a'.repeat(16),B='b'.repeat(16),T=Date.parse('2026-11-08T12:00:00Z')
const temp=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-life-any-start-'));try{await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:20,
  autonomousPlannerMinutes:15,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
const todo={id:'accepted-task-001',type:'search_videos',status:'open',title:'搜索已经接受的视频任务',dueAt:0}
const person={id:'9'.repeat(24),source:'public-person-observation',eligible:true}
const other={id:'8'.repeat(24),source:'discussion-read',eligible:true}

test('any independently verified Life action can be Episode step 1; browse_home is NOT required',()=>temp(async dir=>{
 let now=T,account=A
 const episodes=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>account,now:()=>now})
 for(const [kind,sourceRef,action] of [
  ['todo','todo:'+todo.id,'execute_read'],
  ['reflection','reflection:turn-01','reflect'],
  ['exploration','exploration:'+person.id,'review_public'],
  ['social','social:friend-opportunity-01','review_friend'],
  ['social','social-receipt:real-transaction-01','friend_outreach'],
  ['video','intention:nonhome-search-01','begin_exploration'],
 ]){
  const result=episodes.record({accountTag:A,sourceRef,receiptId:'canonical:'+action,action,kind,outcome:'verified'})
  assert.equal(result.ok,true,action)
  assert.equal(result.episode.steps,1,action)
  assert.equal(result.episode.lastAction,action)
  now+=1000
 }
 assert.equal(episodes.list().length,5,'bounded presentation view')
 assert.equal(episodes.list({limit:20}).length,6)
 account=B;assert.deepEqual(episodes.list(),[])
 const raw=readFileSync(join(dir,'life-episodes',A+'.json'),'utf8')
 assert.doesNotMatch(raw,/accepted-task-001|friend-opportunity-01|nonhome-search-01|real-transaction-01/)
}))

test('due sources include real non-home TODO and public opportunity, but never completed, expired, cooled or unverified ones',()=>temp(async dir=>{
 let now=T
 const episodes=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>A,now:()=>now})
 episodes.record({sourceRef:'todo:'+todo.id,receiptId:'todo-success',action:'execute_read',kind:'todo'})
 episodes.record({sourceRef:'exploration:'+person.id,receiptId:'verified-public-read',action:'review_public',kind:'exploration'})
 episodes.record({sourceRef:'social:friend',receiptId:'friend-thought',action:'review_friend',kind:'social',outcome:'considered'})
 now+=121000
 const available=eligibleLifeEpisodeSources({todos:[todo],opportunities:[person,other],now})
 assert.ok(available.includes('todo:'+todo.id))
 assert.ok(available.includes('exploration:'+person.id))
 assert.equal(episodes.due({eligibleSources:available}),true)
 assert.equal(episodes.health({eligibleSources:available}).firstStepWithoutEligibleSource,1,'friend consideration is recorded but does not grant another contact')
 assert.equal(available.some(x=>x.startsWith('social:')),false,'no synthetic friend-send authorization')
 const allInvalid=eligibleLifeEpisodeSources({
  intentions:[{id:'expired',status:'ready',expiresAt:now-1,episodeSteps:1}],
  todos:[{...todo,status:'completed'},{...todo,id:'not-due',dueAt:now+1000},{...todo,id:'bad-type',type:'post_comment'}],
  opportunities:[{...person,eligible:false},{...other,eligible:false}],now})
 assert.deepEqual(allInvalid,[])
 assert.equal(episodes.due({eligibleSources:allInvalid}),false)
 assert.equal(episodes.health({eligibleSources:allInvalid}).firstStepWithoutEligibleSource,3,'verified but no longer eligible non-video sources are reported, not forced')
}))

test('non-home source can trigger a renewed model choice and second verified step; not auto-execute a script',()=>temp(async dir=>{
 let now=T,chosen=0,reads=0
 const episodes=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>A,now:()=>now})
 const first=episodes.record({sourceRef:'todo:'+todo.id,receiptId:'previous-real-todo-step',action:'execute_read',kind:'todo'})
 assert.equal(first.episode.steps,1)
 now+=121000
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>now,getConfig:()=>cfg,
  getLifeAccountTag:()=>A,getTodos:()=>[todo],getAcceptedActionReservations:()=>[todo],
  getLifeEpisodeContext:()=>episodes.list(),isLifeEpisodeDue:()=>episodes.due({eligibleSources:eligibleLifeEpisodeSources({todos:[todo],now})}),
  onEpisodeAction:x=>episodes.record(x),
  getLifeEvents:()=>[],getLifeEventStatus:()=>({pending:0,lastVideoAt:0,videoStartsToday:0}),
  invokeModel:async prompt=>{chosen++;assert.match(prompt,/recentLifeEpisodes/);return JSON.stringify({action:'execute_read',id:todo.id})},
  executeRead:async()=>{reads++;return {ok:true}},updateTodo:async()=>({ok:true}),reflect:async()=>({ok:false}),
  onVerifiedRead:async()=>({ok:true})})
 assert.equal(episodes.due({eligibleSources:eligibleLifeEpisodeSources({todos:[todo],now})}),true)
 const output=await planner.tick()
 assert.equal(output.action,'execute_read')
 assert.equal(output.result,'done')
 assert.equal(chosen,1);assert.equal(reads,1)
 assert.equal(episodes.list()[0].steps,2,'same genuine TODO source has two receipts in the same Episode')
}))
