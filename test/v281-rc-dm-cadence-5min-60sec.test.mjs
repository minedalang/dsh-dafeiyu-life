import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createBiliReadBudget,BiliReadDeferredError} from '../lib/bili-read-budget.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
import {listSessions} from '../lib/dm.mjs'
import {POLLING_PRESETS,dmQuietIntervals} from '../lib/polling-choice.mjs'
const work=()=>mkdtempSync(join(tmpdir(),'bili-dm-cadence-'))
const minute=60_000
const logger={warn(){},error(){}}
const cred={sessdata:'dummy',bili_jct:'dummy',buvid3:'dummy'}
const settle=()=>new Promise(resolve=>setTimeout(resolve,15))

test('natural plan sets regular 5m/5m and new active base 60s without changing comment cadence',()=>{
  assert.deepEqual(POLLING_PRESETS.balanced,{dmWatchMinutes:5,dmQuietMaxMinutes:5,commentReplyWatchMinutes:2,commentAtWatchMinutes:2})
  assert.deepEqual(dmQuietIntervals(POLLING_PRESETS.balanced),[5,5,5,5])
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(src,/dmActivePollSeconds: z\.natural\(\)\.default\(60\)/)
  assert.match(src,/dmWatchMinutes: z\.natural\(\)\.default\(5\)/)
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(html,/活跃基础 60 秒/)
  assert.match(ui,/\$\('dm-active-seconds'\)\.value='60'/)
})

test('DM list cannot be re-polled before 5m across process object restarts; detail snapshots remain possible',()=>{
  const dir=work();let now=1_800_000_000_000
  try{
    const budget=()=>createBiliReadBudget({dataDir:dir,now:()=>now,logger})
    assert.equal(budget().acquire('dm-list'),true)
    now+=4*minute
    assert.throws(()=>budget().acquire('dm-list'),e=>e instanceof BiliReadDeferredError&&e.reason==='dm-list-interval')
    assert.equal(budget().acquire('dm-messages'),true,'send-precheck and other DM details do not inherit list-only hard interval')
    now+=minute
    assert.equal(budget().acquire('dm-list'),true)
    assert.equal(budget().status().byKind.find(r=>r.kind==='dm-list').hour,2)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('an actual HTTP adapter list read respects durable gap, manual or auto caller cannot bypass it',async()=>{
  const dir=work(),oldFetch=globalThis.fetch;let now=1_800_000_000_000,calls=0
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({code:0,data:{session_list:[]}}))}
  try{
    const budget=()=>createBiliReadBudget({dataDir:dir,now:()=>now,logger})
    await listSessions(cred,{readBudget:budget()})
    await assert.rejects(()=>listSessions(cred,{readBudget:budget()}),e=>e instanceof BiliReadDeferredError&&e.reason==='dm-list-interval')
    assert.equal(calls,1)
    now+=5*minute
    await listSessions(cred,{readBudget:budget()})
    assert.equal(calls,2)
  }finally{globalThis.fetch=oldFetch;rmSync(dir,{recursive:true,force:true})}
})

test('one platform -509 raises account-wide pause, persists 10m list floor, and decays no faster than 6h per step',()=>{
  const dir=work();let now=1_800_000_000_000
  try{
    const make=()=>createBiliReadBudget({dataDir:dir,now:()=>now,logger})
    make().acquire('dm-list')
    make().noteError(Error('HTTP 200 code=-509'),'dm-list')
    assert.equal(make().status().dmListIntervalMinutes,10)
    assert.equal(make().status().retryAt,now+5*minute)
    now+=5*minute
    assert.throws(()=>make().acquire('dm-list'),e=>e instanceof BiliReadDeferredError&&e.reason==='dm-list-interval')
    now+=5*minute
    make().acquire('dm-list')
    make().noteSuccess('dm-list')
    assert.equal(make().status().dmListIntervalMinutes,10,'one success cannot erase the adaptive floor')
    now+=6*60*minute
    make().noteSuccess('comment-replies')
    assert.equal(make().status().dmListIntervalMinutes,10,'unrelated endpoint success cannot lower floor')
    make().noteSuccess('dm-list')
    assert.equal(make().status().dmListIntervalMinutes,5)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('competing read budget instances see each other’s writes and cannot bypass minute quota',()=>{
  const dir=work();let now=1_800_000_000_000
  try{
    const make=()=>createBiliReadBudget({dataDir:dir,minuteLimit:5,hourLimit:15,now:()=>now,logger})
    const a=make(),b=make()
    a.acquire('dm-messages');b.acquire('comment-replies');a.acquire('dm-messages');b.acquire('comment-replies')
    a.acquire('dm-messages')
    assert.throws(()=>b.acquire('cover-image'),e=>e.reason==='minute-budget')
    assert.equal(make().status().minuteUsed,5)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('scheduler restart waits for persisted dm-list cadence while comments keep their own cadence',async()=>{
  const dir=work();let now=1_800_000_000_000,lists=0,comments=0
  try{
    const budget=createBiliReadBudget({dataDir:dir,now:()=>now,logger})
    budget.acquire('dm-list')
    const make=()=>createInteractionScheduler({dataDir:dir,now:()=>now,logger,
      getAccountTag:()=> 'a'.repeat(16),readBudget:createBiliReadBudget({dataDir:dir,now:()=>now,logger}),
      getConfig:()=>({masterEnabled:true,dmWatch:true,dmWatchMinutes:5,dmQuietMaxMinutes:5,
        dmActivePollEnabled:false,commentWatchReplies:true,commentReplyWatchMinutes:2,commentAtEnabled:false}),
      dm:{poll:async()=>{lists++;return {}}},comments:{poll:async()=>{comments++;return {}}}})
    const sched=make();sched.start();await settle()
    assert.equal(lists,0);assert.equal(comments,1)
    assert.equal(sched.status().checks.dm.nextAt,now+5*minute)
    now+=4*minute;await sched.tick();assert.equal(lists,0)
    now+=minute;await sched.tick();assert.equal(lists,1)
    sched.stop()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('only recently verified active contacts are eligible at 60 seconds; no global fast scan',()=>{
  const dir=work();let now=1_800_000_000_000
  try{
    const agent=createDmAutoReply({dataDir:dir,now:()=>now,selfUid:'900',getConfig:()=>({enabled:true,dmActivePollEnabled:true,
      dmActivePollSeconds:60,dmActiveWindowSeconds:180}),fetchIncoming:async()=>[],send:async()=>({ok:true}),logger})
    assert.equal(agent.nextFastUid(),'')
    agent.noteActive('100')
    now+=59_000;assert.equal(agent.nextFastUid(),'')
    now+=1_000;assert.equal(agent.nextFastUid(),'100')
    now+=121_000;assert.equal(agent.nextFastUid(),'','verified active window expires, no blanket scanning')
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('manual DM network-check passes the shared budget and persistent rate-limit recovery gate',()=>{
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const begin=src.indexOf("path === '/api/bili-duty/dm-network-check'")
  assert.ok(begin>0)
  const fragment=src.slice(begin,begin+1250)
  assert.match(fragment,/interactionScheduler\.recoveryReadGate\(\)/)
  assert.match(fragment,/dmList\(cred,\{readBudget:biliReadBudget\}\)/)
})
