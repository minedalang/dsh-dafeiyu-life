import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createBiliReadBudget,BiliReadDeferredError} from '../lib/bili-read-budget.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'
import {collectDmInbox} from '../lib/dm-inbox.mjs'

const M=60_000,H=60*M
const work=()=>mkdtempSync(join(tmpdir(),'bili-social-safe-'))
const silent={warn(){},error(){},info(){}}
const account='a'.repeat(16)
const deferred=(fn,reason)=>assert.throws(fn,e=>e instanceof BiliReadDeferredError&&e.reason===reason)
const settle=()=>new Promise(r=>setTimeout(r,20))

test('account -509 pauses comment/@ inbox separately, then allows only 10m interval probes for 6h across restarts',()=>{
 const dir=work();let now=1_800_000_000_000
 try{
  const budget=()=>createBiliReadBudget({dataDir:dir,now:()=>now,logger:silent})
  budget().acquire('dm-list');budget().noteError(Error('HTTP 200 code=-509'),'dm-list')
  const pause=budget().status()
  assert.equal(pause.socialProtectionUntil,now+15*M)
  assert.equal(pause.socialSafeUntil,now+6*H)
  now+=5*M
  deferred(()=>budget().acquire('mcp:bili_received_replies'),'social-rate-protection')
  deferred(()=>budget().acquire('mcp:bili_received_at_and_likes'),'social-rate-protection')
  // A necessary targeted pre-send/safety snapshot is not throttled by the
  // notification-only slow mode once the global platform pause has expired.
  assert.equal(budget().acquire('dm-messages'),true)
  assert.equal(budget().status().lastDmMessagesAttemptAt,now)
  now+=10*M
  budget().acquire('mcp:bili_received_replies')
  budget().acquire('mcp:bili_received_at_and_likes')
  assert.equal(budget().status().socialEndpoints['mcp:bili_received_replies'],now+10*M)
  now+=9*M
  deferred(()=>budget().acquire('mcp:bili_received_replies'),'social-rate-protection')
  now+=M
  budget().acquire('mcp:bili_received_replies')
  assert.equal(budget().status().socialEndpoints['mcp:bili_received_at_and_likes'],0,'notification endpoints recover independently')
  now+=6*H
  assert.equal(budget().status().socialSafeUntil,0)
  budget().acquire('mcp:bili_received_replies')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('read budget stores only bounded endpoint/time metadata and does not consume protected tokens',()=>{
 const dir=work();let now=1_800_000_000_000
 try{
  const make=()=>createBiliReadBudget({dataDir:dir,now:()=>now,logger:silent})
  make().acquire('dm-list');make().noteError(Error('请求过于频繁 code=-509'),'dm-list')
  now+=5*M
  const before=make().status().hourUsed
  deferred(()=>make().acquire('mcp:bili_received_replies'),'social-rate-protection')
  assert.equal(make().status().hourUsed,before)
  const raw=readFileSync(join(dir,'bili-read-budget.json'),'utf8')
  assert.ok(!raw.includes('uid')&&!raw.includes('sessdata')&&!raw.includes('messageId'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('scheduler keeps both notification sentinels behind account-level -509 protection',async()=>{
 const dir=work();let now=1_800_000_000_000,dm=0,comments=0,dmSentinels=0,socialSentinels=0
 try{
  const budget=createBiliReadBudget({dataDir:dir,now:()=>now,logger:silent})
  budget.acquire('dm-list');budget.noteError(Error('HTTP 200 code=-509'),'dm-list')
  const scheduler=createInteractionScheduler({dataDir:dir,now:()=>now,logger:silent,
   getAccountTag:()=>account,readBudget:budget,
   readPrivateUnread:async()=>{budget.acquire('dm-unread');budget.noteSuccess('dm-unread');dmSentinels++;return {followUnread:0,unfollowUnread:0,dustbinUnread:0,unfollowPushUnread:0,dustbinPushUnread:0,bizFollowUnread:0,bizUnfollowUnread:0,customUnread:0}},
   readSocialUnread:async()=>{budget.acquire('social-unread');budget.noteSuccess('social-unread');socialSentinels++;return {mode:'split',replyCount:0,atCount:0,replyAtTotal:0,likeCount:0}},
   getConfig:()=>({masterEnabled:true,dmWatch:true,dmActivePollEnabled:false,commentWatchReplies:true,commentAtEnabled:true}),
   dm:{poll:async()=>{budget.acquire('dm-list');budget.noteSuccess('dm-list');dm++;return {ok:true}}},
   comments:{poll:async()=>{comments++;budget.acquire('mcp:bili_received_replies');budget.acquire('mcp:bili_received_at_and_likes');return {ok:true}}}})
  scheduler.start();await settle()
  assert.equal(dmSentinels,0);assert.equal(socialSentinels,0);assert.equal(comments,0)
  now+=5*M;await scheduler.tick()
  assert.equal(dmSentinels,1,'after the global pause only the DM counter may probe; list detail remains pending')
  assert.equal(dm,0);assert.equal(comments,0);assert.equal(socialSentinels,0)
  now+=10*M;await scheduler.tick()
  assert.equal(dmSentinels,2);assert.equal(dm,1,'DM list detail follows only after its adaptive floor and recovery gate')
  assert.equal(socialSentinels,0,'the second counter probe remains staggered after the DM probe')
  now+=15_001;await scheduler.tick()
  assert.equal(socialSentinels,1);assert.equal(comments,1,'social detail is read only after its sentinel becomes eligible')
  now+=2*M;await scheduler.tick();assert.equal(comments,1,'social safe interval is stronger than any legacy per-category interval')
  const status=scheduler.status()
  assert.equal(status.checks.replies.nextAt,now+8*M)
  assert.equal(status.checks.mentions.nextAt,now+8*M)
  scheduler.stop()
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('a deferred DM detail request retains its typed protection reason while stopping the sweep',async()=>{
 const original=new BiliReadDeferredError('platform-cooldown',180000)
 await assert.rejects(()=>collectDmInbox({sessions:[{uid:123,unread:1,lastTs:180000}],ownUid:456,
  readConversation:async()=>{throw original},failClosed:false,logger:silent}),e=>e===original)
})

test('diagnostic/UI production paths label protection separately from a new platform failure',()=>{
 const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const dm=readFileSync(new URL('../lib/dm-autoreply.mjs',import.meta.url),'utf8')
 const comments=readFileSync(new URL('../lib/comment-interact.mjs',import.meta.url),'utf8')
 assert.match(src,/if\(readState\.blocked\|\|readState\.dmListNextAt>Date\.now\(\)\)/)
 assert.match(ui,/B站限流保护中，本次没有发起请求/)
 assert.match(ui,/B站限流后互动通知低频保护至/)
 assert.match(dm,/skipped:'platform-read-protected'/)
 assert.match(comments,/skipped:'platform-read-protected'/)
})

test('transient DM list transport error makes no futile 450ms retry inside the durable five-minute floor',async()=>{
 const {listSessions}=await import('../lib/dm.mjs')
 const dir=work(),oldFetch=globalThis.fetch;let now=1_800_000_000_000,calls=0
 globalThis.fetch=async()=>{calls++;throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}})}
 try{
  const make=()=>createBiliReadBudget({dataDir:dir,now:()=>now,logger:silent})
  await assert.rejects(()=>listSessions({sessdata:'dummy'}, {readBudget:make()}),/网络请求失败/)
  assert.equal(calls,1)
  deferred(()=>make().acquire('dm-list'),'dm-list-interval')
 }finally{globalThis.fetch=oldFetch;rmSync(dir,{recursive:true,force:true})}
})

test('real DM HTTP adapter maps HTTP 200 / business -509 into persisted account-wide notification protection',async()=>{
 const {listSessions}=await import('../lib/dm.mjs')
 const dir=work(),oldFetch=globalThis.fetch;let now=1_800_000_000_000,calls=0
 globalThis.fetch=async()=>{calls++;return {status:200,json:async()=>({code:-509,message:'请求过于频繁，请稍后再试'})}}
 try{
  const make=()=>createBiliReadBudget({dataDir:dir,now:()=>now,logger:silent})
  await assert.rejects(()=>listSessions({sessdata:'dummy'}, {readBudget:make()}),/code=-509/)
  assert.equal(calls,1)
  assert.equal(make().status().lastRateLimitKind,'dm-list')
  assert.equal(make().status().socialProtectionUntil,now+15*M)
  assert.equal(make().status().dmListIntervalMinutes,10)
 }finally{globalThis.fetch=oldFetch;rmSync(dir,{recursive:true,force:true})}
})

test('local system health shows social-safe throttling as protection not a fabricated comment failure',async()=>{
 const {systemHealthSnapshot}=await import('../lib/system-health-projection.mjs')
 const now=1_800_000_000_000
 const state=systemHealthSnapshot({now,scheduler:{running:true,
  readBudget:{socialSafeUntil:now+6*H,socialProtectionUntil:now+15*M,
   socialEndpoints:{'mcp:bili_received_replies':now+15*M,'mcp:bili_received_at_and_likes':now+15*M}},
  checks:{replies:{enabled:true,lastResult:'error',lastFinishedAt:now-2*M},mentions:{enabled:true,lastResult:'error',lastFinishedAt:now-2*M}}}})
 assert.equal(state.channels.find(x=>x.id==='replies').state,'backoff')
 assert.equal(state.channels.find(x=>x.id==='mentions').state,'backoff')
 assert.match(state.channels.find(x=>x.id==='replies').detail,/限流保护中/)
 assert.equal(state.issues.find(x=>x.id==='read').code,'social-rate-protection')
})
