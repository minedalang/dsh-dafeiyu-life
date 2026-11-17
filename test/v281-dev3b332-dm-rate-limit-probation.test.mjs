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

test('scheduler honors persistent DM probation and does not dispatch fast or normal fetch every two minutes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dm-sched-'))
  let at=1_800_000_000_000,calls=0,fastCalls=0,platformReads=0
  const cfg={masterEnabled:true,dmWatch:true,dmWatchMinutes:2,dmActivePollEnabled:true,
    commentWatchReplies:false,commentAtEnabled:false}
  const backoff=createNetworkPollBackoff({dataDir:dir,getAccountTag:()=>scope,now:()=>at})
  backoff.settle('dm','HTTP 200 code=-509')
  at+=15*minute
  const scheduler=createInteractionScheduler({dataDir:dir,getAccountTag:()=>scope,now:()=>at,getConfig:()=>cfg,
    readBudget:{status:()=>({blocked:false,byKind:[{kind:'dm-list',hour:platformReads}]})},
    dm:{poll:async({fastUid}={})=>{if(fastUid)fastCalls++;else {calls++;platformReads++}return {sent:0}},nextFastUid:()=> '123',
      status:()=>({fast:{nextIntervalSeconds:10}})},comments:{poll:async()=>({})}})
  try{
    scheduler.start()
    await new Promise(r=>setTimeout(r,15))
    assert.equal(calls,1)
    assert.equal(backoff.check('dm').recoverySuccesses,1)
    at+=2*minute
    await scheduler.tick()
    assert.equal(calls,1)
    assert.equal(fastCalls,0)
    assert.equal(scheduler.status().fastLane.reason,'network-backoff')
    at+=8*minute
    await scheduler.tick()
    assert.equal(calls,2)
  }finally{scheduler.stop();rmSync(dir,{recursive:true,force:true})}
})
