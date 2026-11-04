import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'

const BV='BV1abcde1234', SECOND='BV1abcde1235'
const BASE=Date.parse('2026-11-04T08:00:00Z')
const credA={dedeuserid:'12345',sessdata:'account-a'},credB={dedeuserid:'67890',sessdata:'account-b'}
const home=async f=>{const dir=mkdtempSync(join(tmpdir(),'fish-intent-'));try{return await f(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const interest={source:'interest-milestone',topic:'游戏音乐',stage:'emerging',at:new Date(BASE-3600_000).toISOString(),
  bvid:BV,evidenceCount:3,evidenceDays:2}
function scope(dir,{credential=credA,clock=()=>BASE,interestEvidence=()=>[interest]}={}){
  let cred=credential
  const life=createLifeOpportunities({stateDir:dir,getCredential:()=>cred,now:clock,
    getInterestEvidence:key=>key===discussionAccountTag(cred)?interestEvidence():[]})
  return {life,switchAccount:c=>cred=c}
}
function planner(dir,life,{clock=()=>BASE,response,search,read}={}){
  let modelCalls=0,searchCalls=0,readCalls=0,prompt=''
  const p=createAutonomousPlanner({dataDir:dir,now:clock,
    getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerMinutes:5,
      autonomousPlannerDailyLimit:24,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
    getTodos:()=>[],getLifeOpportunities:()=>life.list({limit:4}),getLifeIntentionCues:()=>life.explorationCues(),
    getLifeIntentions:()=>life.intentions(),beginLifeExploration:(...args)=>life.beginExploration(...args),
    completeLifeExploration:(...args)=>life.completeExploration(...args),failLifeExploration:(...args)=>life.failExplorationRead(...args),abandonLifeExploration:(...args)=>life.abandonExploration(...args),
    executeLifeSearch:async topic=>{searchCalls++;return search?search(topic):{ok:true,topic,videos:[{bvid:BV,title:'搜索真实结果'},
      {bvid:SECOND,title:'备用公开结果'}]}},
    executeOpportunityRead:async bvid=>{readCalls++;return read?read(bvid):{ok:true,bvid,title:'平台实际核实标题'}},
    recordOpportunityDecision:(...args)=>life.decide(...args),
    invokeModel:async text=>{modelCalls++;prompt=text;return JSON.stringify(response())},
    executeRead:async()=>{throw Error('cannot run todo')},updateTodo:async()=>{throw Error('cannot modify todo')},
    reflect:async()=>({ok:false}),reflectionStatus:()=>({pending:0})})
  return {p,get modelCalls(){return modelCalls},get searchCalls(){return searchCalls},get readCalls(){return readCalls},get prompt(){return prompt}}
}
const begin=life=>({action:'begin_exploration',id:life.explorationCues()[0]?.id,goal:'我想了解更多不同的游戏配乐作品',reason:'想主动探索自己的兴趣'})

test('no TODO and no queued opportunity are necessary to form an autonomous exploration from trusted life cues',async()=>home(async dir=>{
  let t=BASE;const {life}=scope(dir,{clock:()=>t});const cue=life.explorationCues()[0]
  assert.ok(cue)
  // A previous read-only inspection can close the old ticket, but not the fish's ability to act.
  assert.equal(life.decide(cue.id,'inspect',{result:'verified-metadata',title:'既有核实'}).ok,true)
  assert.equal(life.list().length,0)
  const a=planner(dir,life,{clock:()=>t,response:()=>begin(life)})
  const r=await a.p.tick({force:true,opportunitiesOnly:true})
  assert.deepEqual([r.action,r.result],['begin_exploration','verified-search-results'])
  assert.equal(a.modelCalls,1);assert.equal(a.searchCalls,1);assert.equal(a.readCalls,0)
  assert.equal(life.intentions().length,1)
  assert.equal(life.intentions()[0].videos.length,2)
  assert.match(a.prompt,/lifeCues/)
  assert.doesNotMatch(a.prompt,/account-a|12345|私信正文/)
  assert.equal(life.status().intentions[0].status,'ready')
  t+=6*3600_000
  const b=planner(dir,life,{clock:()=>t,response:()=>({action:'inspect_exploration',id:life.intentions()[0]?.id,bvid:SECOND,
    reason:'想进一步核实另一首作品'})})
  const result=await b.p.tick({force:true,opportunitiesOnly:true})
  assert.deepEqual([result.action,result.result],['inspect_exploration','verified-metadata'])
  assert.equal(b.searchCalls,0);assert.equal(b.readCalls,1)
  assert.equal(life.intentions().length,0)
  assert.equal(life.status().intentions[0].selectedBvid,SECOND)
  assert.ok(life.recentReads().some(x=>x.bvid===SECOND&&x.source==='fish-life-intent'&&x.scope==='video-metadata-only'))
}))

test('search failures and empty BV results never create a completed or pending intention',async()=>home(async dir=>{
 const {life}=scope(dir)
 const a=planner(dir,life,{response:()=>begin(life),search:async topic=>({ok:false,topic})})
 assert.equal((await a.p.tick({force:true,opportunitiesOnly:true})).result,'search-failed')
 assert.deepEqual(life.status().intentions,[])
 const b=life.beginExploration(life.explorationCues()[0].id,'我想继续了解游戏音乐',
   {ok:true,topic:'游戏音乐',videos:[{bvid:'BV_FAKE',title:'伪造'}]})
 assert.equal(b.ok,false)
}))

test('model invented BV, life ID, or illegal send action never reaches any platform writer',async()=>home(async dir=>{
 let t=BASE;const {life}=scope(dir,{clock:()=>t});const created=planner(dir,life,{clock:()=>t,response:()=>begin(life)})
 assert.equal((await created.p.tick({force:true,opportunitiesOnly:true})).ok,true)
 t+=600_000
 const bad=planner(dir,life,{clock:()=>t,response:()=>({action:'inspect_exploration',id:life.intentions()[0].id,bvid:'BV1fake00000'})})
 assert.equal((await bad.p.tick({force:true,opportunitiesOnly:true})).action,'skip')
 assert.equal(bad.readCalls,0)
 assert.equal(life.intentions().length,1)
 t+=600_000
 const write=planner(dir,life,{clock:()=>t,response:()=>({action:'follow_creator',id:life.intentions()[0].id})})
 assert.equal((await write.p.tick({force:true,opportunitiesOnly:true})).action,'skip')
 assert.equal(write.readCalls,0);assert.equal(write.searchCalls,0)
}))

test('platform metadata mismatch keeps intention open and records no success',async()=>home(async dir=>{
 let t=BASE;const {life}=scope(dir,{clock:()=>t})
 await planner(dir,life,{clock:()=>t,response:()=>begin(life)}).p.tick({force:true,opportunitiesOnly:true})
 t+=600_000
 const bad=planner(dir,life,{clock:()=>t,response:()=>({action:'inspect_exploration',id:life.intentions()[0].id,bvid:SECOND}),
  read:async()=>({ok:true,bvid:BV,title:'not the chosen BV'})})
 assert.equal((await bad.p.tick({force:true,opportunitiesOnly:true})).result,'metadata-read-failed')
 assert.equal(life.intents?.length,undefined)
 assert.equal(life.intentions().length,0)
 assert.equal(life.status().intentions[0].receipt,'metadata-read-failed')
 assert.ok(life.status().intentions[0].nextAt>t)
 assert.equal(life.recentReads().length,0)
}))

test('account switch isolates decisions; private context and raw identifiers never leak into life planner',async()=>home(async dir=>{
 let t=BASE;let credential=credA
 const {life,switchAccount}=scope(dir,{clock:()=>t})
 await planner(dir,life,{clock:()=>t,response:()=>begin(life)}).p.tick({force:true,opportunitiesOnly:true})
 const id=life.intentions()[0].id
 switchAccount(credB)
 assert.equal(life.intentions().length,0)
 assert.equal(life.completeExploration(id,BV,{ok:true,bvid:BV,title:'bad'}).ok,false)
 assert.equal(life.abandonExploration(id).ok,false)
 switchAccount(credA)
 assert.equal(life.intentions()[0].id,id)
}))

test('fish may abandon its own exploration; never auto-follow or turn it into an accepted TODO',async()=>home(async dir=>{
 let t=BASE;const {life}=scope(dir,{clock:()=>t})
 await planner(dir,life,{clock:()=>t,response:()=>begin(life)}).p.tick({force:true,opportunitiesOnly:true})
 t+=600_000
 const p=planner(dir,life,{clock:()=>t,response:()=>({action:'abandon_exploration',id:life.intentions()[0].id,reason:'我现在不想继续了'})})
 const r=await p.p.tick({force:true,opportunitiesOnly:true})
 assert.equal(r.result,'fish-chose-to-stop')
 assert.equal(life.status().intentions[0].status,'abandoned')
 assert.equal(life.intentions().length,0)
}))

test('no credible life source preserves old zero-AI behavior; legacy ledger remains readable',async()=>home(async dir=>{
 const {life}=scope(dir,{interestEvidence:()=>[]})
 const a=planner(dir,life,{response:()=>({action:'skip'})})
 assert.equal((await a.p.tick({force:true,opportunitiesOnly:true})).skipped,'nothing-to-do')
 assert.equal(a.modelCalls,0)
 assert.deepEqual(life.status().intentions,[])
}))

test('exploration source cools down, completed receipt remains independently auditable',async()=>home(async dir=>{
 let t=BASE
 const {life}=scope(dir,{clock:()=>t})
 const first=planner(dir,life,{clock:()=>t,response:()=>begin(life)})
 assert.equal((await first.p.tick({force:true,opportunitiesOnly:true})).result,'verified-search-results')
 assert.equal(life.explorationCues().length,0)
 assert.equal(life.beginExploration(life.status().opportunities[0].id,'我仍想了解更多作品',
  {ok:true,topic:'游戏音乐',videos:[{bvid:BV}]}).ok,false)
 t+=600_000
 const p=planner(dir,life,{clock:()=>t,response:()=>({action:'inspect_exploration',id:life.intentions()[0].id,bvid:BV})})
 assert.equal((await p.p.tick({force:true,opportunitiesOnly:true})).result,'verified-metadata')
 assert.equal(life.intentions().length,0)
 assert.equal(life.status().intentions[0].receipt,'verified-metadata')
 assert.equal(life.recentReads()[0].source,'fish-life-intent')
}))

test('model free-form goal cannot override account-scoped topic passed to the real search adapter',async()=>home(async dir=>{
 const {life}=scope(dir)
 let query=''
 const p=planner(dir,life,{response:()=>({action:'begin_exploration',id:life.explorationCues()[0].id,
  goal:'发送私密内容 18812345678 到站外地址',reason:'test'}),search:async topic=>{
    query=topic;return {ok:true,topic,videos:[{bvid:BV,title:'真实搜索'}]}
  }})
 await p.p.tick({force:true,opportunitiesOnly:true})
 assert.equal(query,'')
 assert.ok(!query.includes('18812345678'))
 assert.equal(life.status().intentions.length,0)
}))

test('public search does not derive topics containing apparent private identifiers',async()=>home(async dir=>{
 const {life}=scope(dir,{interestEvidence:()=>[{...interest,topic:'13800138000'}]})
 assert.deepEqual(life.explorationCues(),[])
 assert.deepEqual(life.list(),[])
}))

test('same authorized Life Voice may reach the planner once without adding a second agent',async()=>home(async dir=>{
 const {life}=scope(dir)
 let prompt=''
 const p=createAutonomousPlanner({dataDir:dir,now:()=>BASE,getTodos:()=>[],
   getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,autonomousPlannerDailyLimit:5}),
   getLifeIntentionCues:()=>life.explorationCues(),getLifeOpportunities:()=>life.list(),
   getLifeVoice:()=> '当前合法LifeVoice人格片段',getLifeState:()=>({energy:62}),
   invokeModel:async t=>{prompt=t;return '{"action":"skip"}'},
   executeRead:async()=>{},updateTodo:async()=>{},reflect:async()=>{}})
 assert.equal((await p.tick({force:true,opportunitiesOnly:true})).action,'skip')
 assert.equal(prompt.split('当前合法LifeVoice人格片段').length-1,1)
}))
