import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'

const A='a'.repeat(16),B='b'.repeat(16),TIME=Date.parse('2026-11-06T17:30:00Z')
const home=async run=>{const dir=mkdtempSync(join(tmpdir(),'dsh-video-round-'));try{return await run(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('video round ledger records true process lifecycle; a launch never masquerades as a watched video',()=>home(dir=>{
  let clock=TIME
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>clock})
  const started=events.recordVideoRoundStart({source:'life-agent'})
  assert.match(started.id,/^[a-f0-9]{24}$/)
  assert.equal(events.status().videoStartsToday,0,'round lifecycle does not overwrite planner launch quota')
  assert.equal(events.status().recentVideoRounds[0].state,'started')
  assert.equal(events.status().recentVideoRounds[0].pickedCount,null)
  clock+=14_000
  assert.deepEqual(events.recordVideoRoundFinish(started.id,{exitCode:0,pickedCount:2}),{ok:true,updated:true,state:'completed'})
  assert.equal(events.status().recentVideoRounds[0].state,'completed')
  assert.equal(events.status().recentVideoRounds[0].pickedCount,2)
  assert.equal(events.status().timeline.length,0,'video subprocess lifecycle is not a planner model decision')
  assert.equal(events.recordVideoRoundFinish(started.id,{exitCode:1,pickedCount:7}).updated,false,
    'a successful exit receipt cannot be overwritten by a later callback')
  const file=readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8')
  assert.doesNotMatch(file,/BV[0-9A-Za-z]{10}|cookie|private|uid|messageBody/i)
}))

test('failure, unknown result, stale process and missing picked ledger stay distinct',()=>home(dir=>{
  let clock=TIME
  const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>clock})
  const failed=e.recordVideoRoundStart({source:'manual'}).id
  assert.equal(e.recordVideoRoundFinish(failed,{exitCode:19,pickedCount:3}).state,'failed')
  assert.equal(e.status().recentVideoRounds[0].pickedCount,null)
  assert.equal(e.status().recentVideoRounds[0].exitCode,19)
  const unknown=e.recordVideoRoundStart({source:'life-agent'}).id
  assert.equal(e.recordVideoRoundFinish(unknown,{exitCode:null,pickedCount:2}).state,'interrupted')
  assert.equal(e.status().recentVideoRounds[0].pickedCount,null)
  const started=e.recordVideoRoundStart().id
  clock+=9*3600_000
  assert.equal(e.status().recentVideoRounds[0].state,'unverified-interruption',
    'old started receipt is only projected as possibly interrupted, never as success')
  assert.equal(e.recordVideoRoundFinish(started,{exitCode:0,pickedCount:null}).state,'completed')
  assert.equal(e.status().recentVideoRounds[0].pickedCount,null)
}))

test('old v1 account journal remains readable, and round lifecycle is strictly scoped by actual login',()=>home(dir=>{
  let tag=A
  const e=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now:()=>TIME})
  e.offer({kind:'quiet-window',sourceKey:'test'})
  const filename=join(dir,'life-agent-events',A+'.json')
  const legacy=JSON.parse(readFileSync(filename,'utf8'))
  delete legacy.videoRounds
  writeFileSync(filename,JSON.stringify(legacy))
  assert.deepEqual(e.status().recentVideoRounds,[])
  const id=e.recordVideoRoundStart().id
  tag=B
  assert.deepEqual(e.status().recentVideoRounds,[])
  assert.throws(()=>e.recordVideoRoundFinish(id,{exitCode:0}),/round-not-found/,'no cross-account finish')
  tag=A
  assert.equal(e.status().recentVideoRounds.length,1)
  assert.equal(e.recordVideoRoundFinish(id,{exitCode:0,pickedCount:0}).ok,true)
  assert.throws(()=>e.recordVideoRoundStart({source:'dm'}),/Invalid video round source/)
  assert.throws(()=>e.recordVideoRoundFinish('BV1private000',{exitCode:0}),/Invalid video round id/)
}))

test('real life timeline uses only completed/failed video round receipts; no fabricated per-video viewing',()=>{
  const time=TIME+15_000
  const rounds=[
    {ref:'a'.repeat(12),source:'life-agent',state:'completed',endedAt:time,pickedCount:0},
    {ref:'b'.repeat(12),source:'manual',state:'completed',endedAt:time-1000,pickedCount:2},
    {ref:'c'.repeat(12),source:'life-agent',state:'failed',endedAt:time-2000,pickedCount:null},
    {ref:'d'.repeat(12),source:'life-agent',state:'interrupted',endedAt:time-3000,pickedCount:null},
    {ref:'e'.repeat(12),source:'life-agent',state:'started',endedAt:0,pickedCount:null},
    {ref:'f'.repeat(12),source:'life-agent',state:'unverified-interruption',endedAt:0,pickedCount:null},
  ]
  const rows=buildLifeTimeline({videoRounds:rounds,now:time+1000})
  assert.equal(rows.length,4)
  assert.ok(rows.every(x=>x.type==='video-round'&&!x.bvid&&!x.url))
  assert.ok(rows[0].title.includes('未入选'))
  assert.ok(rows.some(x=>x.title.includes('入选 2 条')))
  assert.ok(rows.every(x=>/不能证明看完或听过视频/.test(x.detail)))
  assert.equal(buildLifeTimeline({videoRounds:[rounds[4]],now:time+1000}).length,0)
  assert.equal(buildLifeTimeline({videoRounds:[{...rounds[0],ref:'BV1secret9999'}],now:time+1000}).length,0)
  assert.equal(buildLifeTimeline({videoRounds:[{...rounds[0],endedAt:time-40*86400_000}],now:time+1000}).length,0)
})

test('production video subprocess wires start, success/failed exit and account-bound timeline',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(index,/lifeAgentEvents\?\.recordVideoRoundStart\(/)
  assert.match(index,/lifeAgentEvents\.recordVideoRoundFinish\(videoRoundReceiptId/)
  assert.match(index,/if\(code===0&&videoRoundReceiptId&&lifeAgentEvents/,'nonzero exit must not produce a normal video-ended wake')
  assert.match(index,/trustedLifeAccountTag\(\)===videoRoundLifeAccountTag/)
  assert.match(index,/videoRounds=lifeAgentEvents\?\.status\(\)\?\.recentVideoRounds/)
  assert.match(ui,/const rounds=\(data\.rows\|\|\[\]\)\.filter\(row=>row\.type==='video-round'\)/)
})
