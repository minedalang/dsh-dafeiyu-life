import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {verifiedCompletedVideoTodo} from '../lib/life-video-episode-evidence.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'
const T=Date.parse('2026-11-12T10:00:00Z'),BV='BV1abcde1234',OTHER='BV1abcde1235'
const credentials={dedeuserid:'1234567',sessdata:'local-test'}
const scope=discussionAccountTag(credentials)
const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
 autonomousPlannerDailyLimit:24,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,
 autonomousPlannerEndHour:24,autoComment:true,commentDailyLimit:10,commentPerRound:1,
 autoVideoLike:true,autoVideoLikeDailyLimit:10}
const interest={source:'interest-milestone',topic:'电影配乐',stage:'growing',bvid:BV,
 at:new Date(T-60_000).toISOString(),evidenceCount:4,evidenceDays:3}
const facts={ok:true,bvid:BV,title:'真实公开作品',description:'官方公开资料',commentReady:true}
const house=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dev8-video-entry-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const todo={id:'23ce9163-055e-4e37-ab35-496b157db23e',type:'watch_video',bvid:BV,status:'open'}
const completed=(item=todo,overrides={})=>({ok:true,item:{...item,status:'done',completedAt:T},result:{ok:true,data:{ok:true,bvid:item.bvid,info:{bvid:item.bvid,title:'真实公开作品'}},...overrides}})
function fixture(dir,{answers=[],withOpportunity=true,task=null,read=null,config=cfg,readReceipt=null}={}){
 let calls=0,writes=[],activeScope=scope,readCalls=0
 const store=createLifeOpportunities({stateDir:dir,getCredential:()=>credentials,
   getInterestEvidence:()=>withOpportunity?[interest]:[],now:()=>T})
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>config,
   getLifeAccountTag:()=>activeScope,
   getTodos:()=>task&&task.status==='open'?[task]:[],
   getAcceptedActionReservations:()=>task&&task.status==='open'?[task]:[],
   getLifeOpportunities:()=>store.list(),recordOpportunityDecision:(...a)=>store.decide(...a),
   getLifeIntentionCues:()=>[],getLifeIntentions:()=>store.continuations(),
   getActiveLifeIntentionReservations:()=>store.intentions({includeClosed:true,limit:20}),
   beginInspectedOpportunity:(...a)=>store.beginInspectedOpportunity(...a),
   beginCompletedVideoTodo:(...a)=>store.beginCompletedVideoTodo(...a),
   recordLifeExplorationWrite:(...a)=>store.recordExplorationWrite(...a),
   getLifeWriteEvidence:async()=>facts,
   executeLifeWrite:async choice=>{writes.push(choice);return {ok:true,status:'verified'}},
   executeOpportunityRead:async bvid=>{readCalls++;return read?read(bvid):{ok:true,bvid,title:'真实公开作品'}},
   executeRead:async()=>{readCalls++;if(!task)throw Error('unexpected read');if(readReceipt)return readReceipt(task);task.status='done';return completed(task)},
   invokeModel:async()=>JSON.stringify(answers[calls++]?.(store)||{action:'stop'}),
   updateTodo:()=>({ok:true}),reflect:()=>({ok:false}),
   recheckWillingness:()=>({decision:'allow'}),
 })
 return {planner,store,writes,get calls(){return calls},get readCalls(){return readCalls},switchAccount(){activeScope='d'.repeat(16)}}
}

test('inspected opportunity can autonomously choose an original top-level comment without video Agent',()=>house(async dir=>{
 const x=fixture(dir,{answers:[
   s=>({action:'inspect_opportunity',id:s.list()[0].id,reason:'想核实这条视频'}),
   s=>({action:'comment_video',id:s.continuations()[0].id,bvid:BV,reason:'想交流这部公开视频的创作构思',text:'这段作品的创作主题值得认真交流'}),
   ()=>({action:'stop'})]})
 const result=await x.planner.tick()
 assert.equal(result.action,'inspect_opportunity');assert.equal(result.result,'verified-metadata')
 assert.equal(x.readCalls,1);assert.equal(x.writes.length,1)
 assert.equal(x.writes[0].action,'comment_video')
 assert.equal(x.store.intentions({includeClosed:true})[0].source,'inspected-opportunity')
 assert.equal(x.store.status().intentions[0].writeOutcomes[0].status,'verified')
 assert.ok(!JSON.stringify(x.store.status()).includes('这段作品的创作主题值得认真交流'))
}))

test('completed LIFE read-only video TODO may choose like without launching video Agent',()=>house(async dir=>{
 const task={...todo}
 const x=fixture(dir,{withOpportunity:false,task,answers:[
   ()=>({action:'execute_read',id:task.id,reason:'我想看看公开的视频内容'}),
   s=>({action:'like_video',id:s.continuations()[0].id,bvid:BV,reason:'我确实很喜欢视频展示的公开主题'}),
   ()=>({action:'stop'})]})
 const result=await x.planner.tick()
 assert.equal(result.action,'execute_read');assert.equal(result.result,'done')
 assert.equal(x.readCalls,1);assert.equal(x.writes.length,1);assert.equal(x.writes[0].action,'like_video')
 assert.equal(x.store.intentions({includeClosed:true})[0].source,'completed-video-todo')
}))

test('no video continuation from stale, mismatched or unverified TODO receipts',()=>house(async dir=>{
 const x=fixture(dir,{withOpportunity:false})
 for(const invalid of [
   completed(todo,{data:{ok:true,bvid:OTHER,info:{bvid:OTHER,title:'真实公开作品'}}}),
   completed(todo,{data:{ok:true,bvid:BV,info:{bvid:OTHER,title:'真实公开作品'}}}),
   completed(todo,{data:{ok:true,bvid:BV,info:{bvid:BV,title:''}}}),
   {...completed(todo),item:{...todo,status:'running',completedAt:T}},
   {...completed(todo),item:{...todo,status:'done',completedAt:T,id:'other'}},
   {...completed(todo),item:{...todo,type:'search_videos',status:'done',completedAt:T}},
   {...completed(todo),item:{...todo,bvid:OTHER,status:'done',completedAt:T}},
   {...completed(todo),result:{ok:false}},
 ]) assert.equal(verifiedCompletedVideoTodo(todo,invalid),null)
 assert.equal(x.store.beginCompletedVideoTodo(todo,{ok:true,bvid:OTHER,title:'错误',completedAt:T},scope).ok,false)
 assert.equal(x.store.beginCompletedVideoTodo(todo,{ok:true,bvid:BV,title:'实际读取',completedAt:T-1000},'e'.repeat(16)).ok,false)
 assert.equal(x.store.continuations().length,0)
}))

test('an inspected opportunity must match the canonical original read decision and never duplicate episode',()=>house(async dir=>{
 const x=fixture(dir)
 const opp=x.store.list()[0]
 assert.equal(x.store.beginInspectedOpportunity(opp.id,{ok:true,bvid:BV,title:'真实公开作品'},scope).ok,false)
 assert.equal(x.store.decide(opp.id,'inspect',{result:'verified-metadata',title:'真实公开作品'}).ok,true)
 assert.equal(x.store.beginInspectedOpportunity(opp.id,{ok:true,bvid:OTHER,title:'真实公开作品'},scope).ok,false)
 assert.equal(x.store.beginInspectedOpportunity(opp.id,{ok:true,bvid:BV,title:'假标题'},scope).ok,false)
 assert.equal(x.store.beginInspectedOpportunity(opp.id,{ok:true,bvid:BV,title:'真实公开作品'},'e'.repeat(16)).ok,false)
 const first=x.store.beginInspectedOpportunity(opp.id,{ok:true,bvid:BV,title:'真实公开作品'},scope)
 assert.equal(first.ok,true);assert.equal(first.created,true)
 const second=x.store.beginInspectedOpportunity(opp.id,{ok:true,bvid:BV,title:'真实公开作品'},scope)
 assert.equal(second.id,first.id);assert.equal(second.created,false)
 assert.equal(x.store.continuations().length,1)
}))


test('disabled original top-level comment authorization cannot be granted by a video episode',()=>house(async dir=>{
 const localCfg={...cfg,autoComment:false}
 const x=fixture(dir,{config:localCfg,answers:[
   s=>({action:'inspect_opportunity',id:s.list()[0].id,reason:'只阅读核实'}),
   s=>({action:'comment_video',id:s.continuations()[0].id,bvid:BV,
     reason:'试图越权评论',text:'这里不应发出任何评论'}),
   ()=>({action:'stop'})]})
 const result=await x.planner.tick()
 assert.equal(result.result,'verified-metadata')
 assert.equal(x.writes.length,0)
 assert.equal(x.store.continuations().length,1)
}))

test('fish can voluntarily end after reading instead of being forced to engage',()=>house(async dir=>{
 const x=fixture(dir,{answers:[
   s=>({action:'inspect_opportunity',id:s.list()[0].id,reason:'只是了解'}),
   ()=>({action:'stop'})]})
 const result=await x.planner.tick()
 assert.equal(result.result,'verified-metadata')
 assert.equal(x.writes.length,0)
 assert.equal(x.store.continuations().length,1)
}))

test('a failed read-only TODO has no trusted completed video episode or write opportunity',()=>house(async dir=>{
 const task={...todo},x=fixture(dir,{withOpportunity:false,task,
   readReceipt:()=>({ok:false,error:'metadata-unavailable'}),
   answers:[()=>({action:'execute_read',id:task.id,reason:'尝试了解'}),()=>({action:'stop'})]})
 const result=await x.planner.tick()
 assert.notEqual(result.result,'done')
 assert.equal(x.store.continuations().length,0)
 assert.equal(x.writes.length,0)
}))
