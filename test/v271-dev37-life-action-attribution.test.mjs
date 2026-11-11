import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createUniversalLifeEpisodes} from '../lib/life-universal-episodes.mjs'
import {createLifeActionAttribution} from '../lib/life-action-attribution.mjs'
import {createLifeWillingness} from '../lib/life-willingness.mjs'

const T=Date.parse('2026-11-08T13:00:00Z'),A='a'.repeat(16),B='b'.repeat(16)
const tmp=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dev37-action-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('不同入口的已核实操作共享同一个 Episode，重复平台回执不重复计步',()=>tmp(async dir=>{
 let scope=A,clock=T
 const episodes=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>scope,now:()=>clock})
 const a=createLifeActionAttribution({episodes,getAccountTag:()=>scope})
 const id='todo-done:owner-todo-1:1234567890'
 const first=a.verified({accountTag:A,channel:'owner-todo',owner:'owner',sourceRef:'todo:owner-todo-1',receiptId:id,action:'execute_read',kind:'todo'})
 assert.equal(first.ok,true);assert.equal(first.episode.steps,1)
 const repeated=a.verified({accountTag:A,channel:'planner',owner:'life',sourceRef:'todo:owner-todo-1',receiptId:id,action:'execute_read',kind:'todo'})
 assert.equal(repeated.duplicate,true)
 clock+=2000
 const next=a.verified({accountTag:A,channel:'todo-followup',owner:'life',sourceRef:'todo:owner-todo-1',receiptId:'bili-followup-dm:abcedef',action:'followup',kind:'social'})
 assert.equal(next.episode.id,first.episode.id)
 assert.equal(next.episode.steps,2)
 assert.deepEqual(next.episode.history.map(x=>x.action),['execute_read','followup'])
 assert.deepEqual(next.episode.history.map(x=>[x.owner,x.channel]),[['owner','owner-todo'],['life','todo-followup']])
 const raw=readFileSync(join(dir,'life-episodes',A+'.json'),'utf8')
 assert.doesNotMatch(raw,/owner-todo-1|abcedef|1234567890|bili-followup|life-approved/)
 assert.equal(a.status().verified,2)
 assert.equal(a.status().duplicate,1)
 scope=B;assert.deepEqual(episodes.list(),[])
 assert.equal(a.verified({accountTag:A,channel:'dm',owner:'life',sourceRef:'social:abc',receiptId:'bili-dm:42',action:'dm_reply',kind:'social'}).reason,'account-changed')
}))

test('技术阻断、模型选择沉默、结果未知不产生伪成功，也不能重发平台动作',()=>tmp(async dir=>{
 const episodes=createUniversalLifeEpisodes({stateDir:dir,getAccountTag:()=>A,now:()=>T})
 const a=createLifeActionAttribution({episodes,getAccountTag:()=>A})
 const common={accountTag:A,channel:'comment',owner:'life',sourceRef:'social:original-thread',receiptId:'comment-operation-1',action:'comment_reply',kind:'social'}
 assert.equal(a.notSent({accountTag:A,channel:'comment',code:'not-verified'}).recorded,false)
 assert.equal(a.unknown(common).recorded,false)
 assert.equal(episodes.list().length,0,'cannot manufacture an Episode from unknown platform response')
 assert.equal(a.verified({...common,receiptId:''}).reason,'missing-platform-receipt')
 assert.equal(a.verified({...common,owner:'model'}).reason,'invalid-action')
 assert.equal(a.verified({...common,accountTag:B}).reason,'account-changed')
 assert.equal(episodes.list().length,0)
 const read=a.verified({accountTag:A,channel:'comment',owner:'reactive',sourceRef:'social:original-thread',receiptId:'verified-context-read',action:'inspect_comment',kind:'exploration'})
 assert.equal(read.ok,true)
 const unknown=a.unknown(common)
 assert.equal(unknown.recorded,true)
 assert.equal(episodes.list({includeClosed:true})[0].status,'review')
 assert.equal(episodes.list({includeClosed:true})[0].steps,1)
 assert.equal(a.verified({...common,receiptId:'verified-later'}).ok,true,'explicit independent verification may record, but does not send')
 assert.equal(episodes.list({includeClosed:true}).some(e=>e.steps>=1),true)
 assert.equal(a.status().unknown,2)
}))

test('Life 统一意愿的一次批准可有多条独立平台回执；每条最多通知一次',()=>tmp(async dir=>{
 let clock=T
 const notices=[]
 const w=createLifeWillingness({dataDir:dir,getAccountTag:()=>A,now:()=>clock,
   getContext:async()=>({voice:'鱼鱼自己的生活语境',world:{}}),
   invokeModel:async()=>JSON.stringify({action:'act',candidateId:'reply',reason:'觉得值得回应'}),
   onVerifiedAction:x=>notices.push(x),enabled:()=>true,opportunityWindowMs:0,crossChannelCooldownMs:0})
 const result=w.adoptSocialDecision({kind:'dm_reply',uid:'123456789',sourceKey:'dm:confirmed-inbox-1',
   messages:['第一条完整回复','第二条完整回复']})
 assert.equal(result.ok,true)
 assert.equal(w.verify(result.proof,'dm_reply',{uid:'123456789',targetKey:'',text:'第一条完整回复'}).ok,true)
 assert.equal(w.verify(result.proof,'dm_reply',{uid:'123456789',targetKey:'',text:'第一条完整回复'}).ok,false)
 assert.equal(w.receipt(result.proof,{status:'verified',receiptId:'bili-dm:991'}).ok,true)
 assert.equal(w.receipt(result.proof,{status:'verified',receiptId:'bili-dm:991'}).ok,true)
 assert.equal(w.verify(result.proof,'dm_reply',{uid:'123456789',targetKey:'',text:'第二条完整回复'}).ok,true)
 assert.equal(w.receipt(result.proof,{status:'verified',receiptId:'bili-dm:992'}).ok,true)
 assert.equal(notices.length,2)
 assert.deepEqual(notices.map(x=>x.receiptId),['bili-dm:991','bili-dm:992'])
 assert.ok(notices.every(x=>x.scope===A&&x.evidence==='platform-receipt'))
}))

test('未核验发送和单纯委派不激活 verified completion',()=>tmp(async dir=>{
 const callbacks=[]
 const w=createLifeWillingness({dataDir:dir,getAccountTag:()=>A,now:()=>T,
  getContext:async()=>({voice:'生活状态正常',world:{}}),
  invokeModel:async()=>JSON.stringify({action:'act',candidateId:'reply',reason:'有意愿'}),
  enabled:()=>true,onVerifiedAction:x=>callbacks.push(x),opportunityWindowMs:0,crossChannelCooldownMs:0})
 const r=await w.decide({sourceKey:'social:confirmed-message-2',candidates:[{id:'reply',kind:'dm_reply',label:'可选回复'}]})
 assert.equal(r.ok,true)
 assert.equal(w.receipt(r.proof,{status:'delegated'}).ok,true)
 assert.equal(callbacks.length,0)
}))

test('生产接线要求每条社交回执携带真实平台 ID，待办与反思沿用原引擎回执',()=>{
 const idx=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const todo=readFileSync(new URL('../lib/owner-todo-followup.mjs',import.meta.url),'utf8')
 const planner=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
 const reflection=readFileSync(new URL('../lib/life-reflection.mjs',import.meta.url),'utf8')
 assert.match(idx,/createLifeActionAttribution/)
 assert.match(idx,/receiptId:guarded\?\.ok===true&&guarded\?\.receiptId/)
 assert.match(idx,/bili-comment:/)
 assert.match(idx,/sourceRef:'todo:'\+original\.id/)
 assert.match(idx,/result\.item\.completedAt/)
 assert.match(idx,/runOwnerTodoWithFollowup\(id,\{initiator:'life'\}\)/)
 assert.match(idx,/lifeReflection\.reflect\(\{force:false,origin:'life'\}\)/)
 assert.match(reflection,/origin:origin==='life'\?'life'/)
 assert.match(reflection,/accountTag:originalEpisodeAccount/)
 assert.match(idx,/accountTag:originalEpisodeAccount/)
 assert.match(idx,/accountTag:event\.accountTag/)
 assert.match(todo,/sentReceiptId:receipt\?\.receiptId/)
 assert.match(todo,/taskId:r\.taskId/)
 assert.match(planner,/outcome\.canonicalReceiptId/)
 assert.match(reflection,/result\.receiptId=receiptId/)
 assert.match(idx,/lifeActionAttribution:lifeActionAttribution\.status\(\)/)
})
