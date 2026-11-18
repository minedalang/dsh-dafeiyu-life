import test from 'node:test'
import assert from 'node:assert/strict'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

test('fast-DM status reports why no targeted dispatch happened without leaking identifiers',async()=>{
  let clock=Date.parse('2026-11-13T08:00:00Z'),active='',calls=[]
  const cfg={masterEnabled:true,dmWatch:true,dmWatchMinutes:2,dmActivePollEnabled:true,dmActivePollSeconds:10,commentWatchReplies:false,commentAtEnabled:false}
  const dir=mkdtempSync(join(tmpdir(),'fast-lane-status-'))
  const dm={poll:async arg=>{calls.push(arg||{});return {ok:true,sent:0}},nextFastUid:()=>active,status:()=>({fast:{activeCount:active?1:0}})}
  const scheduler=createInteractionScheduler({dataDir:dir,getAccountTag:()=> 'aaaaaaaaaaaaaaaa',dm,comments:{poll:async()=>({})},
    readPrivateUnread:async()=>({followUnread:0,unfollowUnread:0,dustbinUnread:0,unfollowPushUnread:0,dustbinPushUnread:0,bizFollowUnread:0,bizUnfollowUnread:0,customUnread:0}),getConfig:()=>cfg,now:()=>clock})
  try{
    scheduler.start();await new Promise(resolve=>setTimeout(resolve,15))
    assert.equal(scheduler.status().fastLane.reason,'regular-dm-processed')
    clock+=10_000;await scheduler.tick()
    assert.equal(scheduler.status().fastLane.reason,'no-eligible-active-session')
    assert.equal(scheduler.status().checks.dmFast.lastStartedAt,0)
    active='987654';clock+=10_000;await scheduler.tick()
    assert.equal(scheduler.status().fastLane.reason,'fast-polled')
    assert.equal(scheduler.status().checks.dmFast.lastResult,'completed')
    assert.equal(JSON.stringify(scheduler.status()).includes(active),false)
    cfg.dmActivePollEnabled=false;clock+=10_000;await scheduler.tick()
    assert.equal(scheduler.status().fastLane.reason,'disabled')
    assert.equal(calls.length,2)
  }finally{scheduler.stop();rmSync(dir,{recursive:true,force:true})}
})
