import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {verifiedLifeActionEvent} from '../lib/life-action-memory.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeMemoryCoordinator} from '../lib/life-memory-coordinator.mjs'
import {confirmedRecentVideoShare,verifiedShareMemoryEvents} from '../lib/confirmed-video-share.mjs'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'
import {normalizeRecallRequest} from '../lib/recall-request.mjs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'
const TAG='0123456789abcdef',OTHER='fedcba9876543210',UID='22334455',BV='BV1abc234567',NOW=Date.now()-86400_000
const tmp=()=>mkdtempSync(join(tmpdir(),'dsh-dev30-'))
const action=(more={})=>verifiedLifeActionEvent({action:'share_video',accountTag:TAG,sourceId:'social-intent:life-share-1',bvid:BV,
 title:'Deepseek V4 Flash正式版实测，前端小游戏测试',recipientUid:UID,at:NOW,verified:true,...more})
test('未核验、身份缺失、BV不合规、未发送的行为不能生成 Life 行动记忆',()=>{
 assert.equal(action({verified:false}),null)
 assert.equal(action({accountTag:OTHER,recipientUid:''}),null)
 assert.equal(action({bvid:'not-a-bv'}),null)
 assert.equal(verifiedLifeActionEvent({action:'video_like',accountTag:TAG,sourceId:'verify1234',verified:true}),null)
 assert.equal(verifiedLifeActionEvent({action:'no-such-action',accountTag:TAG,sourceId:'verify1234',verified:true}),null)
})
test('已经核验的主动推荐进入同一可衰减记忆并能以 BV、标题和自然语句召回',()=>{
 const dir=tmp();let tag=TAG,clock=Date.now()
 try{
  const life=createLifeMemoryGateway({dataDir:dir,now:()=>clock,getAccountTag:()=>tag})
  const event=action(),out=life.recordEvents([event]);assert.equal(out.added,1)
  assert.equal(life.recordEvents([event]).added,0,'相同平台发送只记一次')
  const matches=life.recall({query:'Deepseek V4 Flash',domain:'main-session',maxItems:8})
  assert.equal(matches.length,1);assert.equal(matches[0].bvid,BV);assert.match(matches[0].summary,/推荐公开视频/)
  assert.match(matches[0].summary,/Deepseek/)
  assert.match(matches[0].summary,/https:\/\/www\.bilibili\.com\/video\/BV1abc234567/)
  assert.equal(life.semanticCandidates({domain:'main-session'}).some(e=>e.kind==='action'&&e.bvid===BV),true)
  assert.deepEqual(life.semanticCandidates({domain:'bili-life',role:'friend',actorUid:UID}),[],'好友/公屏不获得私有分享记忆')
  assert.equal(life.semanticCandidates({domain:'main-session',role:'friend'}).length,0)
  assert.deepEqual(life.reflectionEvidence([event.key],{visibility:'public-event'}),[],'私有行动不可通过公共反思证据绕出')
  tag=OTHER;assert.equal(life.recall({query:'Deepseek',domain:'main-session'}).length,0,'账号切换不能串记忆')
  tag=TAG;clock+=400*86400_000
  const faded=life.semanticCandidates({domain:'main-session'})
  assert.equal(faded.some(e=>e.bvid===BV),false,'遗忘后不能拿到精确 BV')
  assert.equal(life.recordEvents([event]).added,0,'已遗忘的事件不从档案复活')
  life.close()
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('所有已核验的各类 Life 操作能够被独立记为事件，摘要不会伪造操作细节',()=>{
 const dir=tmp();try{
  const life=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>TAG})
  const kinds=['video_like','video_collect','video_follow','video_comment','video_unfollow','video_folder_delete',
   'dm_reply','comment_reply','followup','owner_care','friend_outreach','dynamic_post']
  for(const kind of kinds){const e=verifiedLifeActionEvent({action:kind,accountTag:TAG,sourceId:'verified:'+kind,
   bvid:BV,title:'实际核验标题',verified:true});assert.ok(e,kind);assert.equal(life.recordEvents([e]).added,1,kind)}
  const all=life.semanticCandidates({domain:'main-session'})
  assert.equal(all.filter(x=>x.kind==='action').length,kinds.length)
  assert.ok(all.some(x=>x.summary.includes('点赞')))
  assert.ok(all.some(x=>x.summary.includes('原创主评论')))
  assert.ok(all.some(x=>x.summary.includes('联系已授权好友')))
  assert.ok(!JSON.stringify(all).includes('22334455'))
  life.close()
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('已发送的历史推荐可以从原主账本限量补录，未知或跨账号记录必须跳过',()=>{
 const dir=tmp();try{
  const good={id:'life-share:'+UID+':'+BV,uid:UID,bvid:BV,accountTag:TAG,
   title:'Deepseek V4 Flash正式版实测',type:'interest-share',status:'sent',sentAt:NOW}
  const bad={...good,id:'bad-share',status:'uncertain'}
  writeFileSync(join(dir,'social-intentions.json'),JSON.stringify({version:1,items:[good,bad,{...good,id:'other-scope',accountTag:OTHER}],
   sent:[{id:good.id,uid:UID,at:NOW,accountTag:TAG},{id:'other-scope',uid:UID,at:NOW,accountTag:OTHER}]}))
  const rows=verifiedShareMemoryEvents(dir,{accountTag:TAG});assert.equal(rows.length,1);assert.equal(rows[0].bvid,BV)
  assert.equal(verifiedShareMemoryEvents(dir,{accountTag:'unknown'}).length,0)
  const history=confirmedRecentVideoShare(dir,{uid:UID,accountTag:TAG,text:'上次你给我推荐的那个 Deepseek 视频',now:NOW+20*86400_000})
  assert.equal(history?.bvid,BV)
  assert.equal(confirmedRecentVideoShare(dir,{uid:UID,accountTag:TAG,text:'上次推荐的奶蛙视频',now:NOW+20*86400_000}),null)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('真实主动分享回执之后通过原 Life Memory Coordinator 入记忆，发送失败不记忆',async()=>{
 const dir=tmp();try{
  const life=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>TAG})
  const coord=createLifeMemoryCoordinator({dataDir:dir,memoryGateway:life,lifeReflection:{addEvents:()=>({ok:true})},getAccountTag:()=>TAG})
  const cfg={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,socialAutoSend:true,
   socialVideoRecommendationsAuthorizedV2:true,dmOwnerUid:UID,friendDirectory:JSON.stringify([{uid:UID,dm:true,recommend:'both'}])}
  const item={id:'life-share:'+UID+':'+BV,uid:UID,bvid:BV,accountTag:TAG,title:'Deepseek V4 Flash实测',type:'interest-share',status:'draft',text:'想分享一条视频'}
  writeFileSync(join(dir,'social-intentions.json'),JSON.stringify({version:1,items:[item],sent:[]}))
  let callbackCount=0
  const onConfirmedSend=async proof=>{callbackCount++;assert.equal(proof.verified,true);await coord.recordEvents([verifiedLifeActionEvent(proof)],{reflect:false})}
  const eng=createSocialIntentEngine({dataDir:dir,getConfig:()=>cfg,getAccountScope:()=>TAG,
   getSelectedVideos:()=>[{picked:true,bvid:BV,day:new Date(NOW).toISOString().slice(0,10)}],now:()=>NOW,
   invokeModel:async()=>'',sendMessage:async()=>({ok:true}),authorizeDraft:async()=>({ok:true,proof:{id:'test'}}),
   videoRecommendationsOnly:true,onConfirmedSend})
  assert.equal((await eng.send(item.id,{automatic:true})).ok,true)
  assert.equal(callbackCount,1)
  assert.equal(life.semanticCandidates({domain:'main-session'}).filter(x=>x.kind==='action').length,1)
  assert.equal((await eng.send(item.id,{automatic:true})).ok,false)
  assert.equal(callbackCount,1)
  life.close()
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('结构化昨天回忆可把已核验行动视为真实发生的经历',()=>{
 const q=normalizeRecallRequest({queries:['昨天发过什么推荐'],intent:'activity_recall',time:{relative:'yesterday'},kinds:['action']})
 assert.equal(q.kinds.includes('action'),true);assert.ok(q.time.start<q.time.end)
})
test('本地模型已就绪时按钮只检查状态、不会再弹下载确认；进度完成后隐藏',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(js,/const inspectOrEnableEmbedding=async/)
 assert.match(js,/if\(status\.server\?\.ready===true\)\{await renderEmbeddingStatus\(\)/)
 assert.match(js,/\$\('embedding-progress'\)\.parentElement\.hidden=!busy/)
 assert.match(js,/\$\('quick-embedding-progress'\)\.hidden=!busy/)
 assert.match(js,/\$\('embedding-install'\)\.addEventListener\('click',\(\)=>run\(inspectOrEnableEmbedding\)\)/)
})

test('Life 连续探索中的可信只读行动真正进入统一可衰减记忆（且不向公屏泄露）',()=>{
 const dir=tmp();try{
  const life=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>TAG})
  const actions=['read_public_search','read_video_metadata','inspect_creator_space','inspect_public_person','review_public','todo_read']
  for(const kind of actions){const e=verifiedLifeActionEvent({action:kind,accountTag:TAG,sourceId:'verified-read-'+kind,
   bvid:BV,title:'实测小游戏视频',verified:true});assert.ok(e,kind);assert.equal(life.recordEvents([e]).added,1,kind)}
  const rows=life.semanticCandidates({domain:'main-session'})
  assert.equal(rows.filter(e=>e.kind==='action').length,actions.length)
  assert.ok(rows.some(e=>e.summary.includes('公开视频的元数据')&&e.bvid===BV))
  assert.deepEqual(life.semanticCandidates({domain:'bili-life',role:'friend',actorUid:UID}).filter(e=>e.kind==='action'),[])
  life.close()
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('跨会话主人回忆经过原 MemoryRetriever：上次推荐的 Deepseek 视频可按名称查得 BV',async()=>{
 const dir=tmp();try{
  const life=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>TAG})
  assert.equal(life.recordEvents([action()]).added,1)
  const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:()=>({mainSessionMemoryEnabled:true}),
   getEpisodes:(query,options)=>life.recall({query,...options}),
   getEpisodeCandidates:options=>life.semanticCandidates(options)})
  const response=await retriever.ownerSearchAsync('上次你给我推荐的那个 Deepseek 视频',{limit:6})
  assert.equal(response.ok,true);assert.ok(response.items.some(x=>x.summary.includes('Deepseek')&&x.summary.includes(BV)))
  assert.ok(retriever.embeddingCorpus().some(x=>x.text.includes('Deepseek')),'语义候选中应有行动记忆')
  life.close()
 }finally{rmSync(dir,{recursive:true,force:true})}
})
