import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {readActionIdentity,reconcileAutonomousActions,isActionCoveredByAcceptedTodo,isOpportunityCoveredByIntention} from '../lib/autonomous-action-contract.mjs'

const BV='BV1abcde1234',BV2='BV1abcde1235'
const at=Date.parse('2026-11-04T13:00:00Z')
const cfg={masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerMinutes:5,autonomousPlannerDailyLimit:8,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
const home=fn=>{const dir=mkdtempSync(join(tmpdir(),'fish-action-coordination-'));return Promise.resolve().then(()=>fn(dir)).finally(()=>rmSync(dir,{force:true,recursive:true}))}
const lifeCue={id:'public-interest',source:'interest-milestone',topic:'Game Music',stage:'growing'}
const discussionCue={id:'comment-a',source:'discussion-read',bvid:BV,reaction:'curious'}
const todo=(id,type,more={})=>({id,type,status:'open',...more})
const makePlanner=(dir,{getTodos=()=>[],getAcceptedActionReservations=getTodos,getLifeIntentionCues=()=>[],getLifeIntentions=()=>[],getActiveLifeIntentionReservations=getLifeIntentions,getLifeOpportunities=()=>[],invokeModel=async()=>'{"action":"skip"}',executeLifeSearch=async()=>({ok:false}),executeOpportunityRead=async()=>({ok:false}),beginLifeExploration=()=>({ok:false}),recordOpportunityDecision=()=>({ok:false})}={})=>createAutonomousPlanner({dataDir:dir,now:()=>at,getConfig:()=>cfg,getTodos,getAcceptedActionReservations,
  getLifeIntentionCues,getLifeIntentions,getActiveLifeIntentionReservations,getLifeOpportunities,invokeModel,executeLifeSearch,executeOpportunityRead,beginLifeExploration,recordOpportunityDecision,
  executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false}),reflectionStatus:()=>({pending:0})})

test('action identity respects execution strength and cannot authorize a write action',()=>{
  assert.equal(readActionIdentity(todo('x','search_videos',{topic:'  GAME   Music  '}),'todo'),readActionIdentity(lifeCue,'cue'))
  assert.notEqual(readActionIdentity(todo('x','watch_video',{bvid:BV}),'todo'),readActionIdentity(discussionCue,'cue'),'video metadata is not watched video')
  assert.equal(readActionIdentity(todo('x','follow_creator',{bvid:BV}),'todo'),'')
  assert.equal(readActionIdentity(todo('x','dm_friend',{uid:'123',text:'hello'}),'todo'),'')
  assert.equal(readActionIdentity({source:'public-person-observation',personKey:'private-key'},'opportunity'),'')
})

test('one cross-ledger view keeps accepted promises and suppresses only overlapping voluntary reads',()=>{
  const a=todo('accepted','search_videos',{topic:'game music'})
  const intent={id:'existing-life-intent',status:'ready',videos:[{bvid:BV}]}
  const options=reconcileAutonomousActions({todos:[a],cues:[lifeCue,discussionCue],intentions:[intent],opportunities:[
    {id:'comment-experience',source:'discussion-read',bvid:BV},{id:'another-source',source:'interest-milestone',bvid:BV},
    {id:'new-video',source:'discussion-read',bvid:BV2},{id:'person',source:'public-person-observation'}]})
  assert.deepEqual(options.todos,[a])
  assert.deepEqual(options.cues,[discussionCue])
  assert.deepEqual(options.opportunities.map(x=>x.id),['new-video','person'])
  assert.deepEqual(options.diagnostic,{heldCues:1,heldOpportunities:2,reasons:['accepted-read','ongoing-or-duplicate-read']})
  assert.equal(JSON.stringify(options.diagnostic).includes('music'),false,'diagnostic never exposes target or friend data')
})

test('active obligations from the real owner task ledger block duplicate exploration without changing obligation',async()=>home(async dir=>{
  const owner=createOwnerTodoEngine({dataDir:dir,now:()=>at,getAccountUid:()=> '123'})
  const accepted=owner.add({type:'search_videos',topic:'Game Music',dueAt:at+24*3600_000}).item
  let calls=0,searches=0
  const p=makePlanner(dir,{getTodos:()=>[],getAcceptedActionReservations:()=>owner.list({includeClosed:false,limit:500}),getLifeIntentionCues:()=>[lifeCue],
    invokeModel:async()=>{calls++;return '{}'},executeLifeSearch:async()=>{searches++;return {ok:true}}})
  const result=await p.tick({force:true})
  assert.equal(result.skipped,'nothing-to-do')
  assert.equal(result.coordination.heldCues,1)
  assert.equal(calls,0);assert.equal(searches,0)
  assert.equal(owner.list().find(x=>x.id===accepted.id).status,'open','accepted promises are not dismissed or auto-completed')
}))

test('an unseen ninth accepted read still suppresses an overlapping voluntary search',()=>{
  const items=Array.from({length:12},(_,i)=>todo(String(i),'search_videos',{topic:i===11?'game music':`another topic ${i}`}))
  assert.equal(reconcileAutonomousActions({todos:items,cues:[lifeCue]}).diagnostic.heldCues,1)
})

test('the model cannot bypass a newly accepted task while it is generating a voluntary search',async()=>home(async dir=>{
  let reserves=0,reads=0,begins=0
  const p=makePlanner(dir,{getLifeIntentionCues:()=>[lifeCue],getAcceptedActionReservations:()=>{reserves++;return reserves===1?[]:[todo('late','search_videos',{topic:'game music'})]},
    invokeModel:async()=>JSON.stringify({action:'begin_exploration',id:lifeCue.id,goal:'寻找更多游戏音乐'}),
    executeLifeSearch:async()=>{reads++;return {ok:true,topic:'Game Music',videos:[{bvid:BV,title:'example'}]}},
    beginLifeExploration:()=>{begins++;return {ok:true}}})
  const outcome=await p.tick({force:true})
  assert.equal(outcome.result,'held-by-accepted-todo')
  assert.equal(outcome.ok,true)
  assert.equal(reads,0);assert.equal(begins,0)
  assert.equal(p.status().recent.at(-1).result,'held-by-accepted-todo')
}))

test('a live continuation wins over a one-shot metadata read, but never becomes a fake success receipt',async()=>home(async dir=>{
  const opportunity={id:'o',source:'discussion-read',bvid:BV,eligible:true}
  let model=0,reads=0,records=0,loads=0
  const p=makePlanner(dir,{getLifeOpportunities:()=>[opportunity],getLifeIntentions:()=>{loads++;return loads===1?[]:[{id:'intent',status:'ready',videos:[{bvid:BV}]}]},
    invokeModel:async()=>{model++;return JSON.stringify({action:'inspect_opportunity',id:'o'})},
    executeOpportunityRead:async()=>{reads++;return {ok:true,bvid:BV,title:'verified'}},
    recordOpportunityDecision:()=>{records++;return {ok:true}}})
  const result=await p.tick({force:true})
  assert.equal(model,1)
  assert.equal(result.result,'held-by-ongoing-intention')
  assert.equal(reads,0);assert.equal(records,0)
}))

test('same BV does not erase distinct video-content obligations, and closed intents cannot block new reads',()=>{
  const watch=todo('watch','watch_video',{bvid:BV})
  const chance={id:'observe',source:'discussion-read',bvid:BV}
  assert.equal(isActionCoveredByAcceptedTodo(discussionCue,[watch]),false)
  assert.equal(isOpportunityCoveredByIntention(chance,[{status:'abandoned',videos:[{bvid:BV}]}]),false)
  assert.equal(reconcileAutonomousActions({todos:[watch],opportunities:[chance]}).opportunities.length,1)
})

test('competing pending metadata opportunities are deduplicated without erasing either source ledger',()=>{
  const x={id:'one',source:'interest-milestone',bvid:BV},y={id:'two',source:'discussion-read',bvid:BV}
  const output=reconcileAutonomousActions({opportunities:[x,y]})
  assert.deepEqual(output.opportunities,[x])
  assert.equal(output.diagnostic.heldOpportunities,1)
  assert.equal(x.status,undefined)
  assert.equal(y.status,undefined)
})

test('suppressed-only cycle records an anonymous check without spending model budget or creating a TODO transition',async()=>home(async dir=>{
  const task=todo('original','search_videos',{topic:'game music',origin:{uid:'123456',quotedText:'PRIVATE MESSAGE'}})
  let modelCalls=0
  const p=makePlanner(dir,{getTodos:()=>[],getAcceptedActionReservations:()=>[task],getLifeIntentionCues:()=>[lifeCue],invokeModel:async()=>{modelCalls++;return '{}'}})
  await p.tick({force:true})
  await p.tick({force:true})
  const s=p.status()
  assert.equal(modelCalls,0);assert.equal(s.runs,0)
  assert.equal(s.recent.length,1,'one anonymous suppressed-only event, no log spam')
  assert.equal(s.recent[0].action,'reconciled')
  assert.equal(s.recent[0].coordination.heldCues,1)
  assert.doesNotMatch(JSON.stringify(s.recent),/PRIVATE MESSAGE|123456|game music/)
  assert.equal(task.status,'open')
}))

test('same account only: another login’s accepted TODO is not a reservation for this account',async()=>home(async dir=>{
  let active='111',searches=0
  const owner=createOwnerTodoEngine({dataDir:dir,now:()=>at,getAccountUid:()=>active})
  owner.add({type:'search_videos',topic:'game music'})
  active='222'
  const result={ok:true,topic:'Game Music',videos:[{bvid:BV,title:'real public search result'}]}
  const p=makePlanner(dir,{getTodos:()=>[],getAcceptedActionReservations:()=>owner.list({includeClosed:false,limit:500}).filter(x=>x.accountUid===active),
    getLifeIntentionCues:()=>[lifeCue],invokeModel:async()=>JSON.stringify({action:'begin_exploration',id:lifeCue.id,goal:'我想看看更多游戏音乐'}),
    executeLifeSearch:async()=>{searches++;return result},beginLifeExploration:()=>({ok:true,receipt:'verified-search-results'})})
  assert.equal((await p.tick({force:true})).result,'verified-search-results')
  assert.equal(searches,1)
}))

test('cooling-down intention still reserves its BV while omitted from model continuation list',async()=>home(async dir=>{
  let model=0,reads=0
  const p=makePlanner(dir,{getLifeOpportunities:()=>[{id:'pending-op',source:'discussion-read',bvid:BV,eligible:true}],
    getLifeIntentions:()=>[],getActiveLifeIntentionReservations:()=>[{id:'cooling',status:'ready',nextAt:at+86400000,expiresAt:at+7*86400000,videos:[{bvid:BV}]}],
    invokeModel:async()=>{model++;return JSON.stringify({action:'inspect_opportunity',id:'pending-op'})},executeOpportunityRead:async()=>{reads++;return {ok:true,bvid:BV}}})
  const result=await p.tick({force:true})
  assert.equal(result.coordination.heldOpportunities,1)
  assert.equal(model,0)
  assert.equal(reads,0)
}))

test('unavailable ongoing-life ledger fails closed for new voluntary reads, not as an invitation to duplicate',async()=>home(async dir=>{
  let model=0,searches=0
  const p=makePlanner(dir,{getLifeIntentionCues:()=>[lifeCue],getActiveLifeIntentionReservations:()=>{throw Error('private data cannot be read')},
    invokeModel:async()=>{model++;return '{}'},executeLifeSearch:async()=>{searches++;return {ok:true}}})
  const result=await p.tick({force:true})
  assert.equal(result.skipped,'nothing-to-do')
  assert.equal(model,0);assert.equal(searches,0)
  assert.ok(result.coordination.reasons.includes('intention-state-unavailable'))
  assert.doesNotMatch(JSON.stringify(p.status().recent),/private data cannot be read/)
}))
