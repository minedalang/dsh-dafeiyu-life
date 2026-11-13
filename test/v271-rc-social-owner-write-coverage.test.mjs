import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'
import {createOwnerTodoFollowup} from '../lib/owner-todo-followup.mjs'
import {createSocialSendTransaction} from '../lib/social-send-transaction.mjs'

const A='a'.repeat(16),B='b'.repeat(16)
const temp=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-social-cutover-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('owner agent passes one verified incoming source to its outbound adapter',()=>temp(async dir=>{
  const sent=[]
  const agent=createOwnerDmAgent({dataDir:dir,getConfig:()=>({masterEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerDmAgentEnabled:true}),
    invokeModel:async()=>JSON.stringify({action:'reply',text:'先聊到这里吧'}),
    executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:false}),
    send:async req=>{sent.push(req);return {ok:true}}})
  agent.primeInbox([])
  const row={incoming:true,senderUid:'123',messageId:'123:m1',timestampMs:Date.now(),text:'你好鱼鱼'}
  assert.equal((await agent.processMessage(row)).ok,true)
  assert.deepEqual(sent.map(x=>x.eventId),['owner-agent:123:m1:bubble:1']) // per-bubble idempotent key
  assert.equal((await agent.processMessage(row)).skipped,'duplicate')
  assert.equal(sent.length,1)
}))

test('queued verified TODO follow-up carries the same durable source on its actual send',()=>temp(async dir=>{
  const date=Date.parse('2026-11-01T12:00:00Z'),sent=[]
  const uid='210228238',taskId='todo-verified-123'
  const cfg={masterEnabled:true,dmWatch:true,dmOwnerUid:uid,ownerTodoCompletionFollowupEnabled:true}
  const f=createOwnerTodoFollowup({dataDir:dir,getConfig:()=>cfg,
    now:()=>date,hourOf:()=>12,chooseReply:()=>({decision:'reply',text:'我查到了公开资料，关于这件事还有些细节。'}),
    send:async row=>{sent.push(row);return {ok:true}}})
  const task={id:taskId,type:'watch_video',sourceKey:'owner-ai-watch:p:BV1abc234567',bvid:'BV1abc234567',
    origin:{kind:'owner-dm',uid,messageId:'owner:recent-01'},topic:'音乐'}
  assert.equal(f.queue(task,{ok:true,data:{info:{title:'音乐作品'}}}).queued,true)
  const outcome=await f.tick()
  assert.equal(outcome.status,'sent')
  assert.equal(sent.length,1)
  assert.equal(sent[0].eventId,`${taskId}:dm:${uid}:owner:recent-01`)
  assert.equal((await f.tick()).skipped,'empty')
}))

test('shared transaction prevents second platform call for same verified owner event across process lifetimes',()=>temp(async dir=>{
  let account=A,calls=0
  const create=()=>createSocialSendTransaction({dataDir:dir,getAccountTag:()=>account,now:()=>Date.now()})
  const key='legacy:123:owner-agent:123:m1'
  const first=await create().execute({channel:'dm',eventKey:key,expectedScope:A},async()=>{
    calls++;return {ok:true,receiptId:'receipt-confirmed-01'}
  })
  assert.equal(first.ok,true)
  const repeated=await create().execute({channel:'dm',eventKey:key,expectedScope:A},async()=>{
    calls++;return {ok:true,receiptId:'should-not-be-sent'}
  })
  assert.equal(repeated.ok,false)
  assert.equal(repeated.no_retry,true)
  assert.equal(calls,1)
  account=B
  assert.equal((await create().execute({channel:'dm',eventKey:key,expectedScope:A},async()=>{calls++;return {ok:true,receiptId:'bad'}})).reason,'account-changed')
  assert.equal(calls,1)
}))

test('uncertain receipt permanently freezes that source, even after a new sender instance',()=>temp(async dir=>{
  let calls=0
  const tx=()=>createSocialSendTransaction({dataDir:dir,getAccountTag:()=>A})
  const src={channel:'comment',eventKey:'todo-followup:123:stable-source',expectedScope:A}
  const initial=await tx().execute(src,async()=>{calls++;return {ok:false}})
  assert.equal(initial.no_retry,true)
  const repeated=await tx().execute(src,async()=>{calls++;return {ok:true,rpid:'1234'}})
  assert.equal(repeated.no_retry,true)
  assert.equal(calls,1)
  assert.equal(tx().inspect().channels.comment.uncertain,1)
}))

test('production owner DM and TODO branches share decision fence; manual user tools remain separate',()=>{
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const agent=readFileSync(new URL('../lib/owner-dm-agent.mjs',import.meta.url),'utf8')
  const followup=readFileSync(new URL('../lib/owner-todo-followup.mjs',import.meta.url),'utf8')
  const sendGate=src.slice(src.indexOf('const lifeDmWithReceipt=async('),src.indexOf('const lifeSocialShadow=createLifeSocialShadow('))
  assert.match(sendGate,/lifeSocialWrite\('dm',\(\)=>socialSendTransaction\.execute/)
  assert.match(sendGate,/extractBiliDmReceiptId\(result\)/)
  assert.match(agent,/eventId:`owner-agent:\$\{id\}:bubble:\$\{index\+1\}`/) // unique per DM bubble
  assert.match(followup,/send\(\{uid:r\.uid,channel,text:replyText,eventId:r\.key\|\|r\.taskId/)
  const ownerAction=src.slice(src.indexOf('async function runOwnerDmAction('),src.indexOf('const ownerDmAgent=createOwnerDmAgent('))
  assert.match(ownerAction,/case 'message': \{[\s\S]*?lifeSocialWrite\('dm',\(\)=>call\('bili_send_message_manual'/)
  assert.match(ownerAction,/runOwnerDmPublishComment\([\s\S]*?lifeSocialWrite\('comment'/)
  const ownerTodos=src.slice(src.indexOf('const executeOwnerTodo = async'),src.indexOf("name:'bili_growth_recall'"))
  assert.match(ownerTodos,/lifeSocialWrite\('comment',\(\)=>call\('bili_reply_manual'/)
  assert.match(ownerTodos,/lifeSocialWrite\('dm',\(\)=>call\('bili_send_message_manual'/)
  assert.match(src,/eventKey:`agency-decline:\$\{row.messageId\}`/)
  assert.match(src,/eventKey:`owner-todo-immediate:\$\{task.id\}`/)
  assert.match(src,/eventKey:`owner-action-ack:\$\{row.messageId\}`/)
})
