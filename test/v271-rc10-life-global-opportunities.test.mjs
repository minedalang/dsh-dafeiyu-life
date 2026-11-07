import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
const S='a'.repeat(16)
function setup(t,{choose='q1_reply_comment',clock=1_800_000_000_000,cooldown=0}={}){
  const dir=mkdtempSync(join(tmpdir(),'life-rc10-opportunities-'))
  t.after(()=>rmSync(dir,{force:true,recursive:true}))
  let tag=S,now=clock,calls=0,prompts=[]
  const will=createLifeWillingness({dataDir:dir,getAccountTag:()=>tag,now:()=>now,enabled:()=>true,
    beginTrace:()=>({step(){},finish(){}}),getContext:()=>({voice:'同一条鱼的生活',world:{mood:'平和'}}),
    invokeModel:async prompt=>{prompts.push(prompt);calls++;return JSON.stringify({action:'act',candidateId:choose,reason:'这轮更想回答评论'})},
    opportunityWindowMs:15,crossChannelCooldownMs:cooldown})
  return {will,advance:n=>now+=n,tag:x=>tag=x,calls:()=>calls,prompts}
}
const offer=(id,kind,sourceKey)=>({trigger:kind,sourceKey,candidates:[{id,kind,label:kind==='comment_reply'?'回应一条公开评论':'回应一条私信'}]})
test('simultaneous DM and comment compete for ONE Life model choice; other source defers',async t=>{
  const x=setup(t)
  const [dm,comment]=await Promise.all([
    x.will.decide(offer('reply_dm','dm_reply','verified-dm:123')),
    x.will.decide(offer('reply_comment','comment_reply','verified-comment:456')),
  ])
  assert.equal(x.calls(),1)
  assert.equal(dm.action,'defer');assert.equal(dm.reason,'another-life-opportunity-chosen')
  assert.equal(comment.ok,true);assert.equal(comment.candidateId,'reply_comment')
  assert.equal(x.will.verify(comment.proof,'comment_reply').ok,true)
  assert.equal(x.will.verify(comment.proof,'dm_reply').ok,false)
  assert.equal(x.prompts.length,1)
  assert.match(x.prompts[0],/这轮候选：.*q0_reply_dm.*q1_reply_comment/)
  assert.ok(!x.prompts[0].includes('verified-dm:123'))
})
test('concurrent chosen action uses cross-channel rest only after receipt',async t=>{
  const x=setup(t,{choose:'reply_dm',cooldown:30000})
  const first=await x.will.decide(offer('reply_dm','dm_reply','verified-dm:100'))
  assert.equal(first.ok,true)
  x.will.receipt(first.proof,{status:'verified'})
  const rest=await x.will.decide(offer('reply_comment','comment_reply','verified-comment:200'))
  assert.equal(rest.action,'defer');assert.equal(rest.reason,'life-cross-channel-rest')
  assert.equal(x.calls(),1)
  x.advance(30_001)
  const next=await x.will.decide(offer('reply_dm','dm_reply','verified-dm:101'))
  assert.equal(next.ok,true);assert.equal(x.calls(),2)
})
test('unverified completion does not record success or free a retry',async t=>{
  const x=setup(t,{choose:'reply_dm',cooldown:30000})
  const first=await x.will.decide(offer('reply_dm','dm_reply','verified-dm:100'))
  x.will.receipt(first.proof,{status:'accepted-unverified'})
  assert.equal(x.will.verify(first.proof,'dm_reply').ok,false)
  const next=await x.will.decide(offer('reply_dm','dm_reply','verified-dm:101'))
  assert.equal(next.ok,true)
})
test('changing account between batched offers never grants any proof',async t=>{
  const x=setup(t)
  const promise=x.will.decide(offer('reply_dm','dm_reply','verified-dm:100'))
  x.tag('b'.repeat(16))
  const result=await promise
  assert.equal(result.ok,false)
  assert.equal(x.calls(),0)
})
