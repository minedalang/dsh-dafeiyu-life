import test from 'node:test'
import assert from 'node:assert/strict'
import {exactDynamicAction} from '../lib/life-action-protocol.mjs'

test('dynamic action ticket binds exact dynamic id and exact safe comment bytes',()=>{
 assert.deepEqual(exactDynamicAction({kind:'dynamic_like',target:'1234567890123456'}),
  {kind:'dynamic_like',target:'1234567890123456',commentText:''})
 assert.deepEqual(exactDynamicAction({kind:'dynamic_comment',target:'1234567890123456',commentText:'这盘菜看起来很香！'}),
  {kind:'dynamic_comment',target:'1234567890123456',commentText:'这盘菜看起来很香！'})
 assert.equal(exactDynamicAction({kind:'dynamic_comment',target:'1234567890123456',commentText:'@uid 你好'}),null)
 assert.equal(exactDynamicAction({kind:'dynamic_comment',target:'1234567890123456',commentText:'https://evil.example'}),null)
 assert.equal(exactDynamicAction({kind:'dynamic_like',target:'123'}),null)
})

test('host-sealed dynamic decision is bound to one exact target/text and cannot replay',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path')
 const {createLifeWillingness}=await import('../lib/life-willingness.mjs')
 const dir=mkdtempSync(join(tmpdir(),'fish-life-dynamic-proof-'))
 try{
  const scope='0123456789abcdef'
  const w=createLifeWillingness({dataDir:dir,getAccountTag:()=>scope,getContext:async()=>({}),invokeModel:async()=>'',enabled:()=>true})
  const text='这盘菜看起来很香，颜色搭配也好舒服！'
  const choice=await w.adoptDynamicDecisionQueued({sourceKey:'friend-shared-dynamic:0123456789abcdef01234567',kind:'dynamic_comment',target:'1234567890123456',commentText:text})
  assert.equal(choice.ok,true)
  assert.equal(w.verify(choice.proof,'dynamic_comment',{target:'1234567890123456',commentText:text},{requireSealed:true}).ok,true)
  assert.equal(w.verify(choice.proof,'dynamic_comment',{target:'1234567890123457',commentText:text},{requireSealed:true}).ok,false)
  assert.equal(w.verify(choice.proof,'dynamic_comment',{target:'1234567890123456',commentText:text},{requireSealed:true}).ok,false)
  w.receipt(choice.proof,{status:'verified',kind:'dynamic_comment',receiptId:'bili-dynamic-comment:998877'})
 }finally{rmSync(dir,{recursive:true,force:true})}
})
