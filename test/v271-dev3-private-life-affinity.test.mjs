import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createPrivateLifeAffinity} from '../lib/private-life-affinity.mjs'
import {prepareFriendInterestObservation,recordPreparedFriendInterest,friendInterestSummary,clearFriendLearning} from '../lib/friend-learning.mjs'
import {createSocialInteractionCoordinator} from '../lib/social-interaction-coordinator.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

const DAY=86_400_000
const AT=Date.parse('2026-11-04T12:00:00Z')
const A='0123456789abcdef',B='fedcba9876543210'
const ROSTER=JSON.stringify([{uid:'11111',name:'小林',dm:true,recommend:'off'}])
const REL={stage:'familiar',activeDays:4,incoming:4,outgoing:3,lastAt:AT-600_000}
const CUE={id:'a'.repeat(24),source:'interest-milestone',topic:'游戏音乐'}
const withHome=async fn=>{const dir=mkdtempSync(join(tmpdir(),'fish-private-affinity-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
function setup(dir){
 let account=A,relation={...REL},roster=ROSTER
 const bridge=createPrivateLifeAffinity({now:()=>AT,getAccountTag:()=>account,getFriendDirectory:()=>roster,
   getRelationship:uid=>uid==='11111'?relation:null,
   getFriendInterests:(uid,tag)=>friendInterestSummary(dir,uid,roster,{maxItems:40,now:AT,accountTag:tag})})
 const observe=(text,at,eventId,tag=account,source='dm')=>{
   const p=prepareFriendInterestObservation({uid:'11111',text,source,eventId,friendDirectory:roster,now:at,accountTag:tag})
   assert.ok(p,'real first-person preference must create a source observation')
   return recordPreparedFriendInterest(dir,p,{friendDirectory:roster})
 }
 return {bridge,observe,account:s=>account=s,relation:s=>relation=s,roster:s=>roster=s}
}

test('fresh account-tagged, cross-day DM self-reports + true two-way familiarity match a fish-owned public cue',()=>withHome(dir=>{
 const x=setup(dir)
 x.observe('我喜欢游戏音乐',AT-2*DAY,'dm-event-1')
 x.observe('我最近喜欢游戏音乐',AT-DAY,'dm-event-2')
 const rows=x.bridge.forCues([CUE])
 assert.deepEqual(rows,[{cueId:CUE.id,relationshipStage:'familiar-or-friend'}])
 assert.equal(JSON.stringify(rows).includes('11111'),false)
 assert.equal(JSON.stringify(rows).includes('小林'),false)
 assert.equal(JSON.stringify(rows).includes('游戏音乐'),false) // public topic remains only on fish's original cue
 const raw=readFileSync(join(dir,'friend-interest-observations.json'),'utf8')
 assert.match(raw,/"accountTag": "?0123456789abcdef"?/)
 x.account(B);assert.deepEqual(x.bridge.forCues([CUE]),[])
 x.account(A);assert.equal(clearFriendLearning(dir,'11111',ROSTER).removed,2)
 assert.deepEqual(x.bridge.forCues([CUE]),[])
}))

test('whitelist alone, public comments alone, one day, vague or corrected interests never create an affinity signal',()=>withHome(dir=>{
 const x=setup(dir)
 assert.deepEqual(x.bridge.forCues([CUE]),[])
 x.observe('我喜欢游戏音乐',AT-2*DAY,'public-1',A,'comment')
 x.observe('我喜欢游戏音乐',AT-DAY,'public-2',A,'comment')
 assert.deepEqual(x.bridge.forCues([CUE]),[])
 x.observe('我喜欢游戏音乐',AT-600_000,'private-1')
 assert.deepEqual(x.bridge.forCues([CUE]),[])
 x.observe('我现在不喜欢游戏音乐',AT-300_000,'private-2')
 assert.deepEqual(x.bridge.forCues([CUE]),[])
 x.relation({...REL,stage:'new'});assert.deepEqual(x.bridge.forCues([CUE]),[])
 x.relation({...REL});x.roster('[]');assert.deepEqual(x.bridge.forCues([CUE]),[])
}))

test('legacy untagged friend records do not become current-account relationship evidence',()=>withHome(dir=>{
 const x=setup(dir)
 x.observe('我喜欢游戏音乐',AT-2*DAY,'old-1','')
 x.observe('我喜欢游戏音乐',AT-DAY,'old-2','')
 assert.ok(friendInterestSummary(dir,'11111',ROSTER,{now:AT}).length)
 assert.deepEqual(friendInterestSummary(dir,'11111',ROSTER,{now:AT,accountTag:A}),[])
 assert.deepEqual(x.bridge.forCues([CUE]),[])
}))

test('serialized social coordinator preserves capture-time account provenance across delayed interest writes',async()=>withHome(async dir=>{
 let recorded=null
 const c=createSocialInteractionCoordinator({dataDir:dir,recordInterest:entry=>{recorded=entry;return {ok:true}},recordRelationship:()=>({ok:true})})
 const interest=prepareFriendInterestObservation({uid:'11111',text:'我喜欢游戏音乐',source:'dm',eventId:'real-incoming',friendDirectory:ROSTER,now:AT,accountTag:A})
 const result=await c.record({type:'incoming',source:'dm',role:'friend',actorUid:'11111',eventKey:'real-incoming',at:AT,interest})
 assert.ok(result?.ok!==false)
 assert.equal(recorded?.accountTag,A)
}))

test('same life-planner model call can choose real PUBLIC search using anonymous private affinity; never exposes DM or UID',async()=>withHome(async dir=>{
 const x=setup(dir)
 x.observe('我喜欢游戏音乐',AT-2*DAY,'private-1')
 x.observe('我很喜欢游戏音乐',AT-DAY,'private-2')
 let calls=0,query='',prompt=''
 const p=createAutonomousPlanner({dataDir:dir,now:()=>AT,
   getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:8,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
   getTodos:()=>[],getLifeIntentionCues:()=>[CUE],getPrivateLifeAffinity:cues=>x.bridge.forCues(cues),
   getLifeAccountTag:()=>A,getLifeIntentions:()=>[],getLifeOpportunities:()=>[],
   beginLifeExploration:(id,goal,found)=>({ok:id===CUE.id&&found.topic==='游戏音乐',receipt:'verified-search-results'}),
   executeLifeSearch:async topic=>{query=topic;return {ok:true,topic,videos:[{bvid:'BV1abcde1234',title:'真实搜索结果'}]}},
   invokeModel:async text=>{calls++;prompt=text;return JSON.stringify({action:'begin_exploration',id:CUE.id,goal:'想自主探索不同的游戏音乐作品'})},
   executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
 const result=await p.tick({force:true,opportunitiesOnly:true})
 assert.deepEqual([result.action,result.result],['begin_exploration','verified-search-results'])
 assert.equal(calls,1);assert.equal(query,'游戏音乐')
 assert.equal(p.status().recent.at(-1).affinityMatched,true)
 const parsed=JSON.parse(prompt.slice(prompt.indexOf('{"lifeState"')))
 assert.deepEqual(parsed.sharedInterestAffinity,[{cueId:CUE.id,relationshipStage:'familiar-or-friend',evidence:'same-public-interest-confirmed-by-current-account-private-self-reports'}])
 assert.doesNotMatch(prompt,/11111|小林|dm-event|private-1|private-2|我喜欢游戏音乐/)
}))

test('failed friend evidence is shown as unavailable, never interpreted as no preference or a send request',()=>withHome(dir=>{
 const x=createPrivateLifeAffinity({getAccountTag:()=>A,getFriendDirectory:()=>ROSTER,
   getRelationship:()=>REL,getFriendInterests:()=>{throw Error('private secret: must not leak')}})
 const status=x.inspect([CUE])
 assert.deepEqual(status.signals,[])
 assert.equal(status.unavailable,1)
 assert.equal(status.reason,'partial-unavailable')
 assert.doesNotMatch(JSON.stringify(status),/private secret|11111|小林/)
}))

test('legacy invalid date does not crash existing friend interest summaries or become private life evidence',()=>withHome(dir=>{
 const x=setup(dir)
 x.observe('我喜欢游戏音乐',AT-2*DAY,'valid-1')
 const file=join(dir,'friend-interest-observations.json')
 const record=JSON.parse(readFileSync(file,'utf8'))
 record.records[0].at='corrupt-legacy-date'
 writeFileSync(file,JSON.stringify(record))
 assert.doesNotThrow(()=>friendInterestSummary(dir,'11111',ROSTER,{now:AT,accountTag:A}))
 assert.deepEqual(x.bridge.forCues([CUE]),[])
}))
