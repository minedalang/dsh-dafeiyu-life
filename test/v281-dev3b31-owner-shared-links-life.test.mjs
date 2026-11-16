import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeSharedBiliLinks} from '../lib/life-shared-bili-links.mjs'
import {__test as planner} from '../lib/autonomous-planner.mjs'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'

const scope='0123456789abcdef', uid='123456789'
function fresh(){const dir=mkdtempSync(join(tmpdir(),'fish-life-owner-link-'));
 const store=createLifeSharedBiliLinks({stateDir:dir,getAccountTag:()=>scope});
 return {dir,store,close:()=>rmSync(dir,{recursive:true,force:true})}}
const menu=rows=>planner.plannerActionMenu({opportunities:rows,candidates:[],cues:[],intents:[],lifeEvents:[],lifeSkills:[],sharedDynamicLikeEnabled:true,sharedDynamicCommentEnabled:true})

test('verified owner dynamic share becomes a Life-only candidate; no automatic read or dynamic write',()=>{
 const x=fresh();try{
  const offer=x.store.offerFromMessage({uid,role:'owner',messageId:'owner:live:1',text:'网页链接 看看我动态 https://t.bilibili.com/1234567890123456'})
  assert.equal(offer.created,1)
  const op=x.store.list()[0]
  assert.equal(op.source,'owner-shared-bili-link')
  assert.equal(op.kind,'dynamic')
  assert.equal(op.status,'pending')
  assert.equal('text' in op,false)
  assert.equal('senderUid' in op,false)
  assert.equal('ref' in op,false)
  assert.ok(menu([op]).some(x=>x.action==='inspect_shared_link'&&x.ids.includes(op.id)))
  assert.ok(!menu([op]).some(x=>x.action==='like_shared_dynamic'))
  assert.equal(x.store.offerFromMessage({uid,role:'owner',messageId:'owner:live:1',text:'网页链接 看看我动态 https://t.bilibili.com/1234567890123456'}).created,0)
  assert.equal(x.store.get(op.id,scope)?.status,'pending')
  assert.equal(x.store.get(op.id,'0000000000000000'),null)
  assert.equal(x.store.recordRead(op.id,{ok:true,kind:'dynamic',dynamicId:'1234567890123456',title:'今天的动态',summary:'真实公开资料',authorUid:uid,commentable:true},scope).ok,true)
  const inspected=x.store.list()[0]
  assert.equal(inspected.status,'inspected')
  assert.equal(menu([inspected]).some(x=>['like_shared_dynamic','comment_shared_dynamic'].includes(x.action)),false)
  assert.equal(x.store.recordInteraction(op.id,'like_shared_dynamic','verified',scope).ok,false)
 }finally{x.close()}
})

test('untrusted offsite links are rejected; authorized stranger may form only read-only Life candidate',()=>{
 const x=fresh();try{
  assert.equal(x.store.offerFromMessage({uid,role:'stranger',messageId:'q1',text:'https://t.bilibili.com/1234567890123456'}).created,1)
  assert.equal(x.store.offerFromMessage({uid,role:'owner',messageId:'q2',text:'https://evil.example/path?redirect=https://t.bilibili.com/1234567890123456'}).created,0)
  assert.equal(x.store.offerFromMessage({uid,role:'owner',messageId:'q3',text:'https://www.bilibili.com.evil.example/opus/1234567890123456'}).created,0)
 }finally{x.close()}
})

test('owner-DM false search choice is corrected into natural reply without any model-directed platform search',async()=>{
 const x=fresh();try{
  const calls=[], sent=[], read=[]
  const agent=createOwnerDmAgent({dataDir:x.dir,getConfig:()=>({masterEnabled:true,dmWatch:true,ownerDmAgentEnabled:true,dmOwnerUid:uid,ownerDmReadCommandsEnabled:true,dmP6Enabled:false}),
   invokeModel:async prompt=>{calls.push(prompt);return JSON.stringify(calls.length===1?{action:'search',query:''}:{action:'reply',text:'哇，你分享动态了！我还没点进去看呢。'})},
   executeRead:async step=>{read.push(step);return {ok:true}},executeWrite:async()=>{throw Error('forbidden')},
   send:async msg=>{sent.push(msg.text);return {ok:true,receiptId:'stub-receipt'}}})
  agent.primeInbox([])
  const row={incoming:true,senderUid:uid,messageId:'new-share:1',timestampMs:Date.now(),text:'网页链接 看看我动态 https://t.bilibili.com/1234567890123456'}
  const result=await agent.processMessage(row)
  assert.equal(result.ok,true)
  assert.equal(read.length,0)
  assert.equal(calls.length,2)
  assert.match(calls[0],/B站分享/)
  assert.match(sent[0],/我还没点进去看/)
  assert.doesNotMatch(sent[0],/想搜索的视频主题/)
 }finally{x.close()}
})

test('owner share intake is performed before owner model reply and Life planner is the only inspector',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const plannerSource=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
 const offset=host.indexOf('onPrivateExperience:async')
 const section=host.slice(offset,host.indexOf('\n    },',offset)+7)
 assert.match(section,/offerPrivateBiliLinkToLife/)
 assert.doesNotMatch(section,/executeSharedBiliLinkRead|resolveBiliShareLink|bili_dynamic_info/)
 assert.match(plannerSource,/owner-shared-bili-link/)
 assert.match(plannerSource,/executeSharedBiliLinkRead/)
})

test('failed model recheck does not lose the owner link message or start a fallback platform search',async()=>{
 const x=fresh();try{
  let calls=0, reads=0;const sent=[]
  const agent=createOwnerDmAgent({dataDir:x.dir,getConfig:()=>({masterEnabled:true,dmWatch:true,ownerDmAgentEnabled:true,dmOwnerUid:uid,ownerDmReadCommandsEnabled:true,dmP6Enabled:false}),
   invokeModel:async()=>{calls++;if(calls===1)return JSON.stringify({action:'search',query:''});throw Error('provider temporary failure')},
   executeRead:async()=>{reads++;return {ok:true}},executeWrite:async()=>{throw Error('forbidden')},
   send:async m=>{sent.push(m.text);return {ok:true,receiptId:'stub-receipt'}}})
  agent.primeInbox([])
  const result=await agent.processMessage({incoming:true,senderUid:uid,messageId:'new-share:retry',timestampMs:Date.now(),text:'看看我动态 https://t.bilibili.com/1234567890123456'})
  assert.equal(result.ok,true)
  assert.equal(reads,0)
  assert.equal(calls,2)
  assert.match(sent[0],/收到你分享的链接/)
 }finally{x.close()}
})
