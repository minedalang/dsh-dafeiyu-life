import test from 'node:test'
import assert from 'node:assert/strict'
import {publicCommentFamiliarity} from '../lib/public-comment-familiarity.mjs'
import {createSocialContextAssembler} from '../lib/social-context-assembler.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'

const record=(incoming,outgoing,activeDays,dm={incoming:0,outgoing:0,activeDays:0})=>({
  comment:{incoming,outgoing,activeDays},dm,
})
const publicRole={actor:()=>({role:'stranger'}),canViewIdentity:()=>false,
  canViewRelationship:({kind})=>kind==='comment',memoryScope:()=> 'public-social'}

test('compact public familiarity recognizes only previously verified public encounters',()=>{
 const first=publicCommentFamiliarity({role:'stranger',scoped:true,channels:record(1,0,1)})
 assert.equal(first,'')
 const seen=publicCommentFamiliarity({role:'stranger',scoped:true,channels:record(2,0,2)})
 assert.match(seen,/过去的公开评论接触证据/)
 const known=publicCommentFamiliarity({role:'stranger',scoped:true,channels:record(3,2,3)})
 assert.match(known,/存在双向互动/)
 assert.match(known,/请求 public-social 记忆/)
 assert.doesNotMatch(known,/UID \d|聊过私信|私信正文/)
 assert.equal(publicCommentFamiliarity({role:'stranger',scoped:false,channels:record(8,8,8)}),'')
})
test('a private-only friend is recognizable as a configured contact, but not as a public old friend',()=>{
 const dmOnly=record(1,0,1,{incoming:20,outgoing:15,activeDays:20})
 const stranger=publicCommentFamiliarity({role:'stranger',scoped:true,channels:dmOnly})
 assert.equal(stranger,'')
 const friend=publicCommentFamiliarity({role:'friend',scoped:true,channels:dmOnly})
 assert.match(friend,/已配置联系人/)
 assert.match(friend,/尚无足够可信的既往公开评论往来证据/)
 assert.doesNotMatch(friend,/此前曾多次在评论区相遇/)
})
test('social context reads public-safe relationship cue eagerly even in compact mode; private guard clears it',async()=>{
 let calls=[]
 const getRelationship=(uid,kind)=>{calls.push([uid,kind]);return kind==='comment'?
  publicCommentFamiliarity({scoped:true,role:'stranger',channels:record(3,2,2)}):'某次私信的私密内容'}
 const assembler=createSocialContextAssembler({policy:publicRole,getRelationship,getIdentity:()=> '不应获取',memoryRetriever:null})
 const compact=await assembler.message({kind:'comment',uid:'202573574',text:'嘿，又见面啦'}, {mode:'compact'})
 assert.match(compact.relationshipContext,/双向互动/)
 assert.equal(compact.memoryContext,'')
 assert.deepEqual(calls,[['202573574','comment']])
 const privateGuard=await assembler.message({kind:'comment',uid:'202573574',text:'敏感提问',privacyGuard:true},{mode:'compact'})
 assert.equal(privateGuard.relationshipContext,'')
 assert.equal(privateGuard.identityContext,'')
 assert.equal(calls.length,1)
})
test('compact comment model sees public familiarity without a second memory retrieval or fabricated past topic',async()=>{
 let captured='',calls=0
 const assembler=createSocialContextAssembler({policy:publicRole,
  getRelationship:(uid,kind)=>publicCommentFamiliarity({scoped:true,role:'stranger',channels:record(4,2,2)})})
 const batcher=createInteractionBatcher({getContextMode:()=> 'compact',getPersona:()=>'',
  prepareContexts:batch=>assembler.batch(batch,{mode:'compact'}),
  invoke:async prompt=>{captured=prompt;calls++;return JSON.stringify({items:[{id:'0',action:'reply',messages:['咦，你也在这里呀！']} ]})},
  delayMs:0})
 try{
  const result=await batcher.generate({kind:'comment',uid:'202573574',text:'抓到鱼鱼了',context:'同一视频下的真实评论',
    lifeCommentMessages:true,canSkip:true,canReply:true})
  assert.equal(calls,1)
  assert.deepEqual(result,{action:'reply',messages:['咦，你也在这里呀！']})
  assert.match(captured,/公开熟悉度/)
  assert.match(captured,/按需.*memory|请求 memory/)
  assert.doesNotMatch(captured,/某次私信的私密内容/)
 }finally{batcher.stop()}
})
