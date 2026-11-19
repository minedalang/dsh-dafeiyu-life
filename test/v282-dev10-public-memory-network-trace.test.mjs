import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeMemoryCoordinator} from '../lib/life-memory-coordinator.mjs'
import {lifeTracePresentation,lifeTraceExplanation} from '../lib/life-decision-trace.mjs'
import {classifyPollFailure} from '../lib/network-poll-backoff.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'

const A='a'.repeat(16),B='b'.repeat(16),BV='BV1234567890',NOW=Date.parse('2026-11-19T06:00:00Z')
const inHome=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dev10-gates-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const watch=(key,accountTag,source='bili-life')=>({kind:'watch',key,bvid:BV,title:'公开测试影片',at:NOW,accountTag,experience:{source,metadata:true}})
const social=(key,accountTag)=>({kind:'social',key,bvid:BV,actorUid:'10001',text:'这部电影值得慢慢聊一聊',at:NOW,accountTag})
const comment=(key,accountTag)=>({kind:'comment',key,bvid:BV,text:'这部电影让我想起了小时候的夏天',at:NOW,accountTag})

test('public dynamic and Bilibili explore never see private, accountless or foreign-account memories',()=>inHome(async dir=>{
 let account=A
 const g=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>account,now:()=>NOW})
 try{
  g.recordEvents([watch('public-watch-A',A),watch('private-session-watch',A,'main-session'),{...watch('public-watch-B',B),title:'不同账号的其他影片'},watch('legacy-without-account',''),
    social('public-social-A',A),social('public-social-B',B),comment('public-comment-A',A),comment('public-comment-B',B),comment('legacy-comment','')])
  assert.equal(g.publicVideoEvidence().length,1)
  assert.equal(g.publicSocialEvidence().length,1) // only confirmed authored comment; social is incoming only
  assert.deepEqual(g.recall({domain:'bili-explore',kinds:['watch'],query:'测试影片'}).map(x=>x.id).length,1)
  assert.equal(g.semanticCandidates({domain:'bili-explore',kinds:['watch'],query:'测试影片'}).length,1)
  assert.equal(g.reflectionEvidence(['private-session-watch','public-watch-B','public-watch-A']).length,1)
  const before=JSON.stringify(g.publicVideoEvidence())
  account=B
  assert.equal(g.publicVideoEvidence().length,1)
  assert.notEqual(JSON.stringify(g.publicVideoEvidence()),before)
  assert.equal(g.recall({domain:'bili-explore',kinds:['watch'],query:'不同账号'}).length,1)
  account=''
  assert.deepEqual(g.publicVideoEvidence(),[])
  assert.deepEqual(g.publicSocialEvidence(),[])
  assert.deepEqual(g.recall({domain:'bili-explore',kinds:['watch'],query:'测试影片'}),[])
  account=A
  assert.ok(g.recall({domain:'main-session',kinds:['watch'],query:'测试影片'}).length>=2,
    'Owner-only recall retains historical unscoped memories; they do not enter the public scene')
 }finally{g.close()}
}))

test('confirmed own public social reply remains account-scoped and public conversations never become owner DMs',()=>inHome(async dir=>{
 let account=A
 const g=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>account,now:()=>NOW})
 try{
  g.recordEvents([{...social(`social:10001:${BV}:101`,A),text:'我喜欢认真聊天'},
    {...social(`social:10001:${BV}:102`,B),text:'我喜欢认真聊天'}])
  assert.equal(g.recordSocialReply({actorUid:'10001',bvid:BV,incomingRpid:'101',text:'我们下次可以继续谈这部影片',at:NOW}).ok,true)
  assert.equal(g.recordSocialReply({actorUid:'10001',bvid:BV,incomingRpid:'102',text:'尝试越界修改的回复',at:NOW}).ok,false)
  account=B
  assert.equal(g.recordSocialReply({actorUid:'10001',bvid:BV,incomingRpid:'102',text:'要保持耐心慢慢观看这部影片',at:NOW}).ok,true)
  account=A
  assert.equal(g.publicSocialEvidence().length,1)
  assert.equal(g.publicSocialEvidence()[0].ownText,'我们下次可以继续谈这部影片')
  account=B
  assert.equal(g.publicSocialEvidence().length,1)
  assert.equal(g.publicSocialEvidence()[0].ownText,'要保持耐心慢慢观看这部影片')
 }finally{g.close()}
}))

test('outbox crash-replay uses captured account, never switches provenance to the current login',()=>inHome(async dir=>{
 let account=A
 const g=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>account,now:()=>NOW})
 try{
  mkdirSync(join(dir,'life-memory'),{recursive:true})
  writeFileSync(join(dir,'life-memory','event-outbox.json'),JSON.stringify({schema:1,pending:[
   {id:'queued-B-before-switch',events:[watch('queued-watch-B','')],accountTag:B,reflect:false,episode:false,candidate:false,interest:false}
  ],complete:[],lastError:'',updatedAt:NOW}))
  const coord=createLifeMemoryCoordinator({dataDir:dir,memoryGateway:g,lifeReflection:{addEvents:()=>({ok:true})},getAccountTag:()=>account,now:()=>NOW})
  assert.equal((await coord.flush()).ok,true)
  const rows=JSON.parse(readFileSync(g.file,'utf8')).episodes
  assert.equal(rows.find(x=>x.key==='queued-watch-B').accountTag,B)
  assert.deepEqual(g.publicVideoEvidence(),[])
  account=B
  assert.equal(g.publicVideoEvidence().length,1)
 }finally{g.close()}
}))

test('terminal UI presentation and explanation agree even with mixed receipts, unresolved sends and block after success',()=>{
 const choice={type:'model-choice',action:'act',code:'valid'}
 const verified={type:'execution-result',result:'verified',delivery:'platform-confirmed'}
 const unknown={type:'execution-result',result:'uncertain',delivery:'outcome-unknown'}
 const cases=[
  {steps:[choice,verified,unknown],category:'result-uncertain'},
  {steps:[choice,unknown,verified],category:'result-uncertain'},
  {steps:[choice,verified,{type:'blocked',code:'read-budget-exhausted'}],category:'mixed-outcomes'},
  {steps:[choice,verified,{type:'execution-result',result:'failed'}],category:'mixed-outcomes'},
  {steps:[choice,verified],category:'platform-verified'}
 ]
 for(const {steps,category} of cases){
  const row={state:'finished',at:NOW,updatedAt:NOW,steps}
  assert.equal(lifeTraceExplanation(row,NOW).category,category)
  assert.equal(lifeTracePresentation(row,NOW),category==='mixed-outcomes'?'result-uncertain':category)
 }
})

test('real English timeouts classify as transport issues, not platform rate-limit',()=>{
 for(const error of ['The operation was aborted due to timeout','Request timed out','getaddrinfo ENOTFOUND api.vc.bilibili.com','指定的网络名不再可用。'])
  assert.equal(classifyPollFailure(error),'network',error)
 assert.equal(classifyPollFailure('HTTP 200 code=-509 msg=请求过于频繁'),'rate-limit')
})

test('failed pre-budget DM polling triggers persistent backoff rather than immediate repeated HTTP requests',()=>inHome(async dir=>{
 let attempts=0
 const scheduler=createInteractionScheduler({dataDir:dir,getAccountTag:()=>A,now:()=>NOW,
  getConfig:()=>({masterEnabled:true,dmWatch:true,commentWatchReplies:false,commentAtEnabled:false,dmActivePollEnabled:false}),
  dm:{poll:async()=>({ok:true}),status:()=>({})},comments:{poll:async()=>({ok:true})},
  readPrivateUnread:async()=>{attempts++;throw Error('The operation was aborted due to timeout')},
  readSocialUnread:async()=>({}),readBudget:{status:()=>({byKind:[],blocked:false})},
  logger:{error:()=>{},warn:()=>{}}})
 scheduler.start()
 try{
  for(let i=0;i<100&&scheduler.status().networkBackoff.dm.category!=='network';i++)await new Promise(r=>setTimeout(r,5))
  assert.equal(attempts,1)
  const row=scheduler.status().networkBackoff.dm
  assert.equal(row.category,'network')
  assert.equal(row.nextAt,NOW+2*60_000)
  await scheduler.tick()
  assert.equal(attempts,1,'Backoff stops redundant retries even though budget counter did not increment')
 }finally{scheduler.stop()}
}))

test('public draft is cancelled if the account switches while model is working; prior draft cannot publish across account',()=>inHome(async dir=>{
 const {createDailyDynamic}=await import('../lib/daily-dynamic.mjs')
 let account=A,sends=0,switchInModel=true
 const config=()=>({accountTag:account,masterEnabled:true,dailyDynamicEnabled:true,dailyDynamicDraftOnly:false,dailyDynamicDailyLimit:2,mainSessionMemoryHalfLifeDays:30})
 const model=async()=>{
  if(switchInModel)account=B
  return JSON.stringify({should_post:true,text:'今天看到有人分享自己的创作过程，才发现一个小小的点子，也可以让人琢磨很久。',
   source_bvids:[BV],source_memory_ids:[],evidence_claims:[{type:'selected_video',bvid:BV}]})
 }
 const engine=createDailyDynamic({dataDir:dir,getConfig:config,getPublicVideos:()=>[{bvid:BV,title:'真实公开观察'}],
  getPublicSocial:()=>[],invokeModel:model,publish:async()=>{sends++;return {status:'api_accepted_unverified'}}})
 assert.equal((await engine.createDraft()).skipped,'account-changed')
 assert.equal(engine.list().length,0)
 account=A;switchInModel=false
 const fresh=await engine.createDraft()
 assert.equal(fresh.ok,true)
 assert.ok(fresh.draft?.id)
 account=B
 assert.equal(engine.list().length,0,'Other account cannot browse previous account drafts')
 assert.equal((await engine.sendDraft(fresh.draft.id,{manual:true})).skipped,'account-changed')
 assert.equal(sends,0)
}))
