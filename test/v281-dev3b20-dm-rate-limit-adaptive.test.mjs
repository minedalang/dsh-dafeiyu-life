import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {collectDmInbox} from '../lib/dm-inbox.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'
import {classifyPollFailure} from '../lib/network-poll-backoff.mjs'

const now=Date.parse('2026-11-15T12:00:00Z')

test('共享读取预算已暂停时，私信收件箱立即停止当前会话扫描',async()=>{
 const calls=[]
 const deferred=Object.assign(new Error('B站后台读取已暂停（minute-budget）'),{name:'BiliReadDeferredError'})
 await assert.rejects(collectDmInbox({
  sessions:[{uid:'111',unread:1,lastTs:now},{uid:'222',unread:1,lastTs:now}],ownUid:'999',now:()=>now,
  readConversation:async uid=>{calls.push(uid);throw deferred},logger:{warn(){}}
 }),/B站后台读取已暂停/)
 assert.deepEqual(calls,['111'])
})

test('B站业务限流码归入平台退避，而非普通网络错误',()=>{
 assert.equal(classifyPollFailure('HTTP 200 code=-509 msg=请求过于频繁'),'rate-limit')
 assert.equal(classifyPollFailure('HTTP 412 risk control'),'rate-limit')
 assert.equal(classifyPollFailure('ECONNRESET'),'network')
})

test('预算阻断不是新的网络成功回执，不会清除已到期的 DM 限流类别',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dm-deferred-'))
 const tag='a'.repeat(16)
 const backoffFile=join(dir,'interaction-network-backoff.json')
 mkdirSync(dir,{recursive:true})
 writeFileSync(backoffFile,JSON.stringify({version:2,scope:tag,lanes:{dm:{category:'rate-limit',streak:2,nextAt:now}}}))
 const cfg={masterEnabled:true,dmWatch:true,dmWatchMinutes:1,dmActivePollEnabled:false,
  commentWatchReplies:false,commentAtEnabled:false}
 let calls=0,sentinelAttempts=0
 const scheduler=createInteractionScheduler({dataDir:dir,getAccountTag:()=>tag,now:()=>now,getConfig:()=>cfg,
  readBudget:{status:()=>({blocked:false,byKind:[]})},
  readPrivateUnread:async()=>{sentinelAttempts++;throw Object.assign(new Error('B站后台读取已暂停（minute-budget）'),{name:'BiliReadDeferredError'})},
  dm:{poll:async()=>{calls++;return {error:'should not reach full inbox'}},nextFastUid:()=>'',status:()=>({fast:{activeCount:0,nextIntervalSeconds:10}})},
  comments:{poll:async()=>({})},logger:{error(){}}})
 try{
  scheduler.start()
  await new Promise(resolve=>setTimeout(resolve,20))
  scheduler.stop()
  assert.equal(sentinelAttempts,1)
  assert.equal(calls,0)
  const state=JSON.parse(readFileSync(backoffFile,'utf8'))
  assert.equal(state.lanes.dm.category,'rate-limit')
  assert.equal(state.lanes.dm.streak,2)
  assert.equal(state.lanes.dm.nextAt,now)
 }finally{scheduler.stop();rmSync(dir,{recursive:true,force:true})}
})
