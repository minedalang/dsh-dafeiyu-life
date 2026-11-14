import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'

const NOW=1_790_000_000_000
const newHarness=({reply,send}={})=>{
 const dir=mkdtempSync(join(tmpdir(),'fish-upload-batch-wiring-'))
 const inbox=[];const confirmed=[];const settled=[];let calls=0
 const engine=createDmAutoReply({dataDir:dir,selfUid:'999',now:()=>NOW,
  getConfig:()=>({enabled:true,whitelist:['200'],p6Enabled:true,p6MaxBubbles:3,whitelistCooldownSeconds:0}),
  fetchIncoming:async()=>inbox,send:send|| (async()=>({ok:true,receiptId:'ack-'+(++calls)})),
  generateReply:reply|| (async()=>({action:'reply',messages:['这是第一条','这是第二条'],topicState:'settled'})),
  onConfirmedMessage:async x=>confirmed.push(x),onConversationSettled:async x=>settled.push(x),
  logger:{warn(){},error(){}}
 })
 return {dir,inbox,confirmed,settled,engine,close:()=>rmSync(dir,{force:true,recursive:true})}
}
const incoming=id=>({senderUid:'200',messageId:id,text:'一起聊聊',timestampMs:NOW,incoming:true})
test('当前上传版 DM 双气泡：只在平台确认后记录每条消息，已收尾立即标记可提炼',async()=>{
 const h=newHarness()
 try{
  await h.engine.poll()
  h.inbox.push(incoming('1'))
  assert.equal((await h.engine.poll()).sent,2)
  assert.deepEqual(h.confirmed.map(x=>x.text),['这是第一条','这是第二条'])
  assert.ok(h.confirmed.every(x=>x.uid==='200'&&x.eventId&&x.time===NOW))
  assert.deepEqual(h.settled,[{uid:'200'}])
  assert.equal(h.engine.status().p6LastTurn.confirmed,2)
 }finally{h.close()}
})
test('模型主动 close 不发送，但仍能触发已到此为止的经历整理',async()=>{
 const h=newHarness({reply:async()=>({action:'close',messages:[]})})
 try{
  await h.engine.poll();h.inbox.push(incoming('1'))
  assert.equal((await h.engine.poll()).sent,0)
  assert.equal(h.confirmed.length,0)
  assert.deepEqual(h.settled,[{uid:'200'}])
 }finally{h.close()}
})
test('未知平台送达不伪装成已确认消息，也不提前结束片段',async()=>{
 const h=newHarness({send:async()=>{throw new Error('connection lost')}})
 try{
  await h.engine.poll();h.inbox.push(incoming('1'))
  assert.ok((await h.engine.poll()).failed>0)
  assert.equal(h.confirmed.length,0)
  assert.equal(h.settled.length,0)
 }finally{h.close()}
})
