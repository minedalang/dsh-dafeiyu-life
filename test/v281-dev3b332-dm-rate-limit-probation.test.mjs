import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createNetworkPollBackoff} from '../lib/network-poll-backoff.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'

const scope='c'.repeat(16)
const fixture=fn=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dm-recovery-'))
  try{return fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}
}
const minute=60_000

test('first successful DM recovery read keeps slow probation across restart; third spaced success clears',()=>fixture(dir=>{
  let at=1_800_000_000_000
  const make=()=>createNetworkPollBackoff({dataDir:dir,getAccountTag:()=>scope,now:()=>at})
  make().settle('dm',new Error('HTTP 200 code=-509'))
  at+=15*minute
  assert.equal(make().check('dm').allowed,true)
  assert.equal(make().settle('dm',null).recoverySuccesses,1)
  assert.equal(make().check('dm').remainingMs,10*minute)
  at+=2*minute
  assert.equal(make().check('dm').allowed,false)
  at+=8*minute
  assert.equal(make().settle('dm',null).recoverySuccesses,2)
  assert.equal(make().check('dm').remainingMs,10*minute)
  at+=10*minute
  make().settle('dm',null)
  assert.equal(make().check('dm').allowed,true)
  assert.equal(make().check('dm').category,'')
}))

test('repeated -509 during recovery increases backoff, DNS does not clear it, unrelated lanes remain independent',()=>fixture(dir=>{
  let at=1_800_000_000_000
  const make=()=>createNetworkPollBackoff({dataDir:dir,getAccountTag:()=>scope,now:()=>at})
  make().settle('dm','code=-509')
  at+=15*minute
  make().settle('dm','')
  assert.equal(make().check('dm').recoverySuccesses,1)
  at+=10*minute
  make().settle('dm','ENOTFOUND api.vc.bilibili.com')
  assert.equal(make().check('dm').category,'rate-limit')
  assert.equal(make().check('dm').recoverySuccesses,0)
  assert.equal(make().check('dm').remainingMs,10*minute)
  at+=10*minute
  assert.equal(make().settle('dm','code=-509').streak,2)
  assert.equal(make().check('dm').remainingMs,30*minute)
  assert.equal(make().check('mentions').allowed,true)
  assert.equal(make().clearNetwork({dm:make().check('dm').nextAt}).ok,false)
}))

test('scheduler uses private unread counter as the spaced DM recovery probe before any full inbox scan',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dm-sched-'))
  let at=1_800_000_000_000,lists=0,fastCalls=0,sentinelReads=0
  const counts=new Map(),lastReadAtByKind={}
  const readBudget={status:()=>({blocked:false,retryAt:0,byKind:[...counts].map(([kind,hour])=>({kind,hour,minute:hour})),
    lastReadAtByKind:{...lastReadAtByKind},dmListIntervalMinutes:5,dmListNextAt:0,dmUnreadNextAt:0,socialUnreadNextAt:0})}
  const cfg={masterEnabled:true,dmWatch:true,dmActivePollEnabled:true,commentWatchReplies:false,commentAtEnabled:false}
  const backoff=createNetworkPollBackoff({dataDir:dir,getAccountTag:()=>scope,now:()=>at})
  backoff.settle('dm','HTTP 200 code=-509')
  at+=15*minute
  const scheduler=createInteractionScheduler({dataDir:dir,getAccountTag:()=>scope,now:()=>at,getConfig:()=>cfg,readBudget,
    readPrivateUnread:async()=>{sentinelReads++;counts.set('dm-unread',(counts.get('dm-unread')||0)+1);lastReadAtByKind['dm-unread']=at;
      return {followUnread:0,unfollowUnread:0,dustbinUnread:0,unfollowPushUnread:0,dustbinPushUnread:0,bizFollowUnread:0,bizUnfollowUnread:0,customUnread:0}},
    dm:{poll:async({fastUid}={})=>{if(fastUid){fastCalls++;counts.set('dm-messages',(counts.get('dm-messages')||0)+1)}else{lists++;counts.set('dm-list',(counts.get('dm-list')||0)+1)}return {sent:0}},
      nextFastUid:()=> '123',status:()=>({fast:{nextIntervalSeconds:10}})},comments:{poll:async()=>({})}})
  try{
    scheduler.start();await new Promise(r=>setTimeout(r,15))
    assert.equal(lists,0,'one counter recovery probe does not authorize a full session-list scan')
    assert.equal(sentinelReads,1)
    assert.equal(backoff.check('dm').recoverySuccesses,1)
    at+=2*minute;await scheduler.tick()
    assert.equal(lists,0);assert.equal(fastCalls,0)
    assert.equal(scheduler.status().fastLane.reason,'network-backoff')
    at+=8*minute;await scheduler.tick()
    assert.equal(lists,0);assert.equal(fastCalls,0)
    assert.equal(sentinelReads,2)
    assert.equal(backoff.check('dm').recoverySuccesses,2)
  }finally{scheduler.stop();rmSync(dir,{recursive:true,force:true})}
})
