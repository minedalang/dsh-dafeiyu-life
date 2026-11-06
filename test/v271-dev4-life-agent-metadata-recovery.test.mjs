import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {verifyLifePublicMetadata,classifyLifeMetadataFailure} from '../lib/life-public-metadata.mjs'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'

const BV='BV1abcde1234',BAD='BV1abcde1235',T=Date.parse('2026-11-06T08:00:00Z')
const credential={dedeuserid:'1234567',sessdata:'very-secret-login'}
const tag=discussionAccountTag(credential)
const home=async callback=>{const dir=mkdtempSync(join(tmpdir(),'life-meta-'));try{return await callback(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const evidence=()=>[{source:'interest-milestone',topic:'游戏音乐',stage:'growing',bvid:BV,at:new Date(T-60_000).toISOString(),evidenceCount:4,evidenceDays:3}]
function create(dir,clock){
  const store=createLifeOpportunities({stateDir:dir,getCredential:()=>credential,now:()=>clock.value,getInterestEvidence:evidence})
  let modelCalls=0,readCalls=0
  const planner=(reader,decision)=>createAutonomousPlanner({dataDir:dir,now:()=>clock.value,
    getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:24,
      autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
    getTodos:()=>[],getLifeOpportunities:()=>store.list(),recordOpportunityDecision:(...args)=>store.decide(...args),
    getLifeAccountTag:()=>tag,
    executeOpportunityRead:async bvid=>{readCalls++;return reader(bvid)},
    invokeModel:async()=>{modelCalls++;return JSON.stringify(decision())},
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
  return {store,planner,get modelCalls(){return modelCalls},get readCalls(){return readCalls}}
}

test('strict same BV and title boundary accepts bundled MCP metadata and one known wrapper',()=>{
  assert.deepEqual(verifyLifePublicMetadata(BV,{bvid:BV,title:' 原标题 ',stat:{view:1}}),{ok:true,bvid:BV,title:'原标题'})
  assert.deepEqual(verifyLifePublicMetadata(BV,JSON.stringify({data:{bvid:BV,title:'回执'}})),{ok:true,bvid:BV,title:'回执'})
  assert.equal(verifyLifePublicMetadata(BV,{bvid:BAD,title:'别人的视频'}).code,'metadata-bvid-mismatch')
  assert.equal(verifyLifePublicMetadata(BV,{bvid:BV,title:' '}).code,'metadata-title-missing')
  assert.equal(verifyLifePublicMetadata(BV,{data:{title:'无 BV'}}).code,'metadata-bvid-mismatch')
  assert.equal(verifyLifePublicMetadata(BV,'<html>not a receipt</html>').code,'metadata-response-invalid')
  assert.equal(verifyLifePublicMetadata(BV,{ok:false,error:'429 rate limited'}).code,'metadata-rate-limited')
  assert.equal(verifyLifePublicMetadata('fake',{bvid:BV,title:'title'}).ok,false)
  assert.equal(classifyLifeMetadataFailure(new Error('ReadActionHeldError reservation-held')),'metadata-read-busy')
  assert.equal(classifyLifeMetadataFailure(new Error('MCP tools/call 超时')),'metadata-timeout')
  assert.equal(classifyLifeMetadataFailure(new Error('登录账号未就绪')),'metadata-account-unavailable')
})

test('failed metadata is a diagnosed technical failure, not a fish defer or claimed view; retry with bounded cooldown',()=>home(async dir=>{
  const clock={value:T},system=create(dir,clock)
  const id=system.store.list()[0].id
  const p=system.planner(async()=>({ok:false,code:'metadata-timeout'}),()=>({action:'inspect_opportunity',id,reason:'我想核实这个视频'}))
  const first=await p.tick({force:true,opportunitiesOnly:true})
  assert.equal(first.ok,false);assert.equal(first.action,'inspect_opportunity')
  assert.equal(first.result,'metadata-read-failed');assert.equal(first.diagnosticCode,'metadata-timeout')
  const logged=system.store.status().opportunities[0]
  assert.equal(logged.status,'error');assert.equal(logged.result,'metadata-read-failed')
  assert.equal(logged.failureCode,'metadata-timeout');assert.equal(logged.failures,1)
  assert.equal(logged.nextAt,T+15*60_000)
  assert.equal(system.store.list().length,0)
  assert.equal(system.store.recentReads().length,0)
  assert.equal(system.modelCalls,1);assert.equal(system.readCalls,1)
  assert.equal(JSON.stringify(system.store.status()).includes(credential.sessdata),false)
  clock.value+=15*60_000
  const other=system.planner(async bvid=>({ok:true,bvid,title:'平台核实标题'}),()=>({action:'inspect_opportunity',id}))
  assert.equal((await other.tick({force:true,opportunitiesOnly:true})).result,'verified-metadata')
  assert.equal(system.store.status().opportunities[0].status,'inspect')
  assert.equal(system.store.recentReads()[0].title,'平台核实标题')
}))

test('three consecutive failed opportunity reads pause it, without repeated model calls or false memory',()=>home(async dir=>{
  const clock={value:T},system=create(dir,clock)
  const id=system.store.list()[0].id
  const p=system.planner(async()=>({ok:false,code:'metadata-rate-limited'}),()=>({action:'inspect_opportunity',id}))
  for(const [i,delta] of [0,15*60_000,60*60_000].entries()){
    clock.value+=delta
    const result=await p.tick({force:true,opportunitiesOnly:true})
    assert.equal(result.result,'metadata-read-failed')
    assert.equal(system.store.status().opportunities[0].failures,i+1)
  }
  const row=system.store.status().opportunities[0]
  assert.equal(row.failures,3)
  assert.equal(row.eligible,false)
  assert.equal(system.store.list().length,0)
  assert.equal(system.store.recentReads().length,0)
  clock.value+=24*60*60_000
  const calls=system.modelCalls
  assert.equal((await p.tick({force:true,opportunitiesOnly:true})).skipped,'nothing-to-do')
  assert.equal(system.modelCalls,calls)
}))

test('old metadata-read-failed erroneously marked fish defer becomes a bounded retry without taking ownership of other data',()=>home(dir=>{
  const clock={value:T+16*60_000},system=create(dir,clock),id=system.store.list()[0].id
  const folder=join(dir,'life-opportunities');mkdirSync(folder)
  writeFileSync(join(folder,tag+'.json'),JSON.stringify({version:1,decisions:[{
    id,source:'interest-milestone',bvid:BV,topic:'游戏音乐',at:T,action:'defer',result:'metadata-read-failed',nextAt:T+2*24*60*60_000
  }],intentions:[]}))
  const row=system.store.status().opportunities[0]
  assert.equal(row.status,'error');assert.equal(row.failures,1)
  assert.equal(row.nextAt,T+15*60_000)
  assert.equal(system.store.list()[0].id,id)
  assert.equal(JSON.parse(readFileSync(join(folder,tag+'.json'),'utf8')).decisions[0].action,'defer','read is backward-compatible without silent rewrite')
}))

test('comment-triggered metadata failure cools down the cue, not the whole fish',()=>home(async dir=>{
  const clock={value:T},date=new Date(T).toISOString().slice(0,10)
  const folder=join(dir,'video-discussion-reads');mkdirSync(folder)
  writeFileSync(join(folder,date+'.jsonl'),[
    {v:1,account:tag,bvid:BV,at:new Date(T-3600_000).toISOString(),kind:'comment_list_read',status:'read',verified:true,count:4},
    {v:1,account:tag,bvid:BV,at:new Date(T-3500_000).toISOString(),kind:'provisional_fish_reaction',reaction:'curious',subjective:true,question:'这首歌曲有其他版本吗？'}
  ].map(JSON.stringify).join('\n')+'\n')
  const life=createLifeOpportunities({stateDir:dir,getCredential:()=>credential,now:()=>clock.value,getInterestEvidence:()=>[]})
  const cue=life.explorationCues()[0]
  assert.equal(cue.source,'discussion-read')
  const p=createAutonomousPlanner({dataDir:dir,now:()=>clock.value,
    getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:12,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
    getTodos:()=>[],getLifeIntentionCues:()=>life.explorationCues(),getLifeOpportunities:()=>life.list(),
    recordOpportunityDecision:(...args)=>life.decide(...args),invokeModel:async()=>JSON.stringify({action:'begin_exploration',id:cue.id,goal:'我想理解这首音乐的相关作品'}),
    executeOpportunityRead:async()=>({ok:false,code:'metadata-read-busy'}),
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
  const result=await p.tick({force:true,opportunitiesOnly:true})
  assert.equal(result.result,'metadata-read-failed')
  assert.equal(result.diagnosticCode,'metadata-read-busy')
  assert.equal(life.explorationCues().length,0)
  assert.equal(life.status().opportunities[0].status,'error')
  clock.value+=15*60_000
  assert.ok(life.explorationCues().length>0)
}))

// The management API returns these domain failures with HTTP 409, so the UI
// must preserve structured diagnostics rather than showing only 请求失败.
test('management panel preserves 409 Life diagnostic and distinguishes a paused failed read from a voluntary defer',()=>{
  const source=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(source,/res\.status===409&&data\?\.ok===false/)
  assert.match(source,/\['metadata-read-failed','invalid-decision','model-or-execution-error'\]/)
  assert.match(source,/平台资料读取失败（并非主动延期）/)
  assert.match(source,/x\.status==='paused'\?'连续读取失败，已暂停等待排查'/)
  assert.match(source,/metadataFailures\[x\.metadataFailureCode\]/)
})
