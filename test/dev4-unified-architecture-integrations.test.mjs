import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialInteractionCoordinator} from '../lib/social-interaction-coordinator.mjs'
import {createSocialContextAssembler} from '../lib/social-context-assembler.mjs'
import {createSocialPolicyGate} from '../lib/social-policy-gate.mjs'
import {resolveCommentCoordinates} from '../lib/comment-root-resolver.mjs'
import {createMemoryConsolidator} from '../lib/memory-consolidation.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'

const BV='BV1bWHT6xEJg'
const friends=JSON.stringify([{uid:'200',dm:true,atInvite:true,recommend:'both'}])
const cfg={dmOwnerUid:'100',friendDirectory:friends,commentAtEnabled:true,commentWatchReplies:true,ownerCommentAgentEnabled:true}
const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-dev4-integration-'))
const finish=dir=>rmSync(dir,{recursive:true,force:true})

function prepared(){return {
  cognition:{key:'a'.repeat(32),kind:'friend-invitation',source:'dm',at:1000,expiresAt:1000+86400000,uid:'200',bvid:BV,rawBody:'PRIVATE MUST NEVER PERSIST'},
  interest:{uid:'200',key:'dm:123',source:'dm',at:1000,statements:[{topic:'独立游戏',stance:'like',confidence:'explicit-self-report'}],video:'',videoRejection:false,blockedChannels:[],consent:'',rawBody:'PRIVATE MUST NEVER PERSIST'},
}}

test('A-05 社交 outbox：先持久化，失败后逐 sink 恢复，并对已成功 sink 幂等',async()=>{
 const dir=temp(),calls={cognition:0,interest:0,relationship:0}
 let fail=true
 try{
  const options={dataDir:dir,logger:{warn(){}},
    recordCognition:()=>{calls.cognition++;return {ok:true}},
    recordInterest:()=>{calls.interest++;return fail?{ok:false,reason:'simulated-io-failure'}:{ok:true}},
    recordRelationship:()=>{calls.relationship++;return {added:1}}}
  const first=createSocialInteractionCoordinator(options)
  const result=await first.record({type:'incoming',source:'dm',role:'friend',actorUid:'200',eventKey:'dm-message-123',at:1000,...prepared()})
  assert.equal(result.ok,false)
  assert.equal(result.pending,1)
  assert.deepEqual(calls,{cognition:1,interest:1,relationship:0})
  const journal=readFileSync(first.file,'utf8')
  assert.doesNotMatch(journal,/PRIVATE MUST NEVER PERSIST|rawBody/,'private DM body must not be persisted')
  assert.match(journal,/独立游戏/,'derived safe preference is allowed')
  fail=false
  const second=createSocialInteractionCoordinator(options)
  const recovered=await second.flush()
  assert.equal(recovered.pending,0)
  assert.deepEqual(calls,{cognition:1,interest:2,relationship:1})
  const repeated=await second.record({type:'incoming',source:'dm',role:'friend',actorUid:'200',eventKey:'dm-message-123',at:1000,...prepared()})
  assert.equal(repeated.duplicate,true)
  assert.deepEqual(calls,{cognition:1,interest:2,relationship:1})
 }finally{finish(dir)}
})

test('A-05 非好友私信：持久化不保存陌生人的原始 UID 与正文',async()=>{
 const dir=temp()
 try{
  const c=createSocialInteractionCoordinator({dataDir:dir,recordCognition:()=>({ok:false,reason:'simulated'}),logger:{warn(){}}})
  const input={type:'incoming',source:'dm',role:'stranger',actorUid:'987654321',eventKey:'DM message #19',at:1000,
   cognition:{key:'b'.repeat(32),kind:'stranger-inspiration',source:'dm',at:1000,expiresAt:1000+86400000,from:'c'.repeat(32),topics:['天文'],rawBody:'SENSITIVE RAW MESSAGE'}}
  await c.record(input)
  const journal=readFileSync(c.file,'utf8')
  assert.doesNotMatch(journal,/987654321|DM message #19|SENSITIVE RAW MESSAGE|rawBody/)
  assert.match(journal,/天文/)
 }finally{finish(dir)}
})

test('A-03/A-06 统一记忆调用：公开评论不能使用主人私密记忆，主人私信可以',async()=>{
 const policy=createSocialPolicyGate({getConfig:()=>cfg}),calls=[]
 const memoryRetriever={
   localContext:()=>{calls.push('owner-private');return 'OWNER ONLY'},
   socialContext:(_q,opt)=>{calls.push(`public:${opt.actorUid}`);return `PUBLIC FOR ${opt.actorUid}`},
 }
 const assembler=createSocialContextAssembler({policy,memoryRetriever,getMeme:async()=> 'PUBLIC MEME',getPersona:()=> 'ROLE',
   getIdentity:()=> 'PRIVATE FRIEND DETAIL',getRelationship:()=> 'NONPRIVATE RELATIONSHIP STAGE',
   videoContext:{forReply:async()=>({usable:true,text:'公开视频简介 主评论 楼中楼 热门评论',counts:{hotProvided:12,thread:4}})}})
 const publicOwner=await assembler.message({uid:'100',kind:'comment',text:'主人公开评论'})
 assert.equal(publicOwner.memoryContext,'PUBLIC FOR 100')
 assert.equal(publicOwner.identityContext,'')
 const privateOwner=await assembler.ownerDm({uid:'100',text:'最近在研究什么？'})
 assert.equal(privateOwner.memoryContext,'OWNER ONLY')
 const rejected=await assembler.ownerDm({uid:'200',text:'冒充主人'})
 assert.equal(rejected.ok,false)
 const friendPublic=await assembler.comment({uid:'200',kind:'at',bvid:BV,text:'@肥鱼来看看',rpid:'123',contextRoot:'456'})
 assert.equal(friendPublic.video.counts.hotProvided,12)
 assert.match(friendPublic.context,/主评论.*热门评论/)
 assert.equal(friendPublic.identityContext,'')
 assert.equal(friendPublic.memoryContext,'PUBLIC FOR 200')
 assert.equal(friendPublic.memeContext,'PUBLIC MEME')
 assert.deepEqual(calls,['public:100','owner-private','public:200'])
})

test('A-01 生产可用的 comment/dm 场景与统一批处理，不再使用无效 social 场景',async()=>{
 let prompt='',personas=[]
 const batch=createInteractionBatcher({delayMs:0,logger:{warn(){}},prepareContexts:async rows=>rows.map(x=>({memoryContext:`MEM:${x.uid}`,memeContext:'KNOWLEDGE'})),
  getPersona:rows=>{const kind=rows.some(x=>x.kind==='comment')?'comment':'dm';personas.push(kind);return 'PERSONA '+kind},
  invoke:async p=>{prompt=p;return JSON.stringify({items:[{id:'0',action:'reply',reply:'收到'}]})}})
 try{const result=await batch.generate({kind:'comment',uid:'200',text:'这是热门评论吗',context:'热门评论：确实很好笑'})
  assert.equal(result,'收到');assert.deepEqual(personas,['comment'])
  assert.match(prompt,/MEM:200/);assert.match(prompt,/KNOWLEDGE/)
 }finally{batch.stop?.()}
})

test('A-04 评论读取根与发送根分离，不把父评论当楼层根',()=>{
 const top=resolveCommentCoordinates({root_id:'0',target_id:'0'},'123',{kind:'at'})
 assert.equal(top.contextRoot,'123');assert.equal(top.sendRoot,'');assert.equal(top.topLevel,true)
 const nested=resolveCommentCoordinates({root_id:'456',target_id:'789'},'123',{kind:'notice'})
 assert.equal(nested.contextRoot,'456');assert.equal(nested.sendRoot,'456');assert.equal(nested.targetId,'789')
 const unknown=resolveCommentCoordinates({root_id:'',target_id:'789'},'123',{kind:'notice'})
 assert.equal(unknown.contextRoot,'');assert.equal(unknown.sendRoot,'');assert.equal(unknown.unresolvedNested,true)
 const uri=resolveCommentCoordinates({root_id:'0',target_id:'789',uri:`https://www.bilibili.com/video/${BV}?comment_root_id=456`},'123',{kind:'at'})
 assert.equal(uri.sendRoot,'456');assert.equal(uri.contextRoot,'456')
})

test('Memory Consolidation：默认不自动整理；来源不可靠时不能改变原记录',async()=>{
 const rows=[
  {id:'x1',source:'main-session-ai',category:'event',importance:.5,text:'主人很喜欢科技视频和 AI 科普',createdAt:'2026-10-01'},
  {id:'x2',source:'main-session-ai',category:'event',importance:.5,text:'主人很喜欢科技视频和 AI 科普，也喜欢知识分享',createdAt:'2026-10-02'},
  {id:'x3',source:'main-session-ai',category:'event',importance:.5,text:'主人很喜欢科技视频和 AI 科普相关内容',createdAt:'2026-10-03'},
 ]
 let commits=0
 const consolidate=createMemoryConsolidator({getMemories:()=>rows,commit:()=>{commits++;return {ok:true}},getConfig:()=>({mainSessionMemoryConsolidationEnabled:false}),
  invokeModel:async()=>JSON.stringify({text:'主人热爱旅游、美食和健身',skip:false})})
 assert.equal((await consolidate.run()).reason,'disabled')
 const result=await consolidate.run({force:true})
 assert.equal(result.added,0)
 assert.equal(commits,0)
 assert.deepEqual(rows.map(x=>x.id),['x1','x2','x3'])
})

test('A-05 高并发入站事件必须全部持久化，不因日志读写交错丢失或重复处理',async()=>{
 const dir=temp(),seen=[]
 try{
  const sync=createSocialInteractionCoordinator({dataDir:dir,logger:{warn(){}},recordRelationship:async row=>{await Promise.resolve();seen.push(row.eventId);return {ok:true}}})
  const results=await Promise.all(Array.from({length:24},(_,i)=>sync.record({type:'incoming',source:'dm',role:'friend',actorUid:'200',eventKey:'dm-concurrent-'+i,at:2000+i})))
  assert.ok(results.every(r=>r.ok),JSON.stringify(results.filter(r=>!r.ok)))
  assert.equal(sync.status().pending,0)
  assert.equal(seen.length,24)
  assert.equal(new Set(seen).size,24)
  const duplicate=await sync.record({type:'incoming',source:'dm',role:'friend',actorUid:'200',eventKey:'dm-concurrent-0',at:2000})
  assert.equal(duplicate.duplicate,true)
  assert.equal(seen.length,24)
 }finally{finish(dir)}
})

test('记忆整理自动运行时间在重启后持久化，不会随插件重启绕过每日间隔',async()=>{
 const dir=temp(),startTime=Date.parse('2026-10-31T08:00:00Z')
 const rows=Array.from({length:100},(_,i)=>({id:'mem-'+i,source:'main-session-ai',category:'event',importance:.5,
   text:`主人长期喜欢科技视频和人工智能技术相关的讨论 第${i}条记录`,createdAt:'2026-10-01T00:00:00Z'}))
 let calls=0
 const make=()=>createMemoryConsolidator({dataDir:dir,getMemories:()=>rows,commit:()=>({ok:false}),
   getConfig:()=>({mainSessionMemoryConsolidationEnabled:true}),invokeModel:async()=>{calls++;return JSON.stringify({skip:true})},now:()=>startTime,logger:{warn(){}}})
 try{
  const first=make(),r=await first.run()
  assert.equal(r.ok,true)
  assert.equal(r.lastRun,startTime)
  assert.ok(calls>0)
  const fresh=make()
  assert.equal(fresh.status().lastRun,startTime)
  const skipped=await fresh.run()
  assert.equal(skipped.skipped,'no-work')
  assert.equal(calls,1,'重启不能多消耗一次自动压缩 AI 调用')
 }finally{finish(dir)}
})
