import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createBiliReadBudget,BiliReadDeferredError} from '../lib/bili-read-budget.mjs'
const M=60_000,H=60*M
const silent={warn(){}}

test('限流事件保存前 15/60 分钟实际门禁派发快照；1 小时后仍可查，不会改变退避',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev17-509-'));let now=1_800_000_000_000
 try{
  const make=()=>createBiliReadBudget({dataDir:dir,now:()=>now,logger:silent})
  make().acquire('dm-messages');now+=6*M;make().acquire('social-unread')
  now+=10*M;make().acquire('dm-messages')
  make().noteError(Error('HTTP 200 code=-509'),'dm-messages')
  let st=make().status();assert.equal(st.rateLimitEvents.length,1)
  assert.equal(st.rateLimitEvents[0].signal,'bili-509')
  assert.deepEqual(st.rateLimitEvents[0].last15Minutes.byKind,{'social-unread':1,'dm-messages':1})
  assert.deepEqual(st.rateLimitEvents[0].last60Minutes.byKind,{'dm-messages':2,'social-unread':1})
  assert.equal(st.blocked,true)
  assert.throws(()=>make().acquire('dm-messages'),BiliReadDeferredError)
  now+=2*H
  st=make().status();assert.equal(st.hourUsed,0)
  assert.equal(st.rateLimitEvents[0].last60Minutes.total,3)
  assert.equal(st.history24h.total,3)
  const body=readFileSync(join(dir,'bili-read-budget.json'),'utf8')
  assert.ok(!body.includes('PRIVATE MESSAGE'))
  assert.ok(!body.includes('code=-509'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('事件只含静态端点与计数；另一个账户不能读本账户现场',()=>{
 const a=mkdtempSync(join(tmpdir(),'dev17-a-')),b=mkdtempSync(join(tmpdir(),'dev17-b-'))
 let now=1_800_000_000_000
 try{
  const make=dir=>createBiliReadBudget({dataDir:dir,now:()=>now,logger:silent})
  make(a).acquire('dm-unread');make(a).noteError(Error('code=-509'),'dm-unread')
  assert.equal(make(b).status().rateLimitEvents.length,0)
  assert.equal(make(b).status().history24h.total,0)
  assert.equal(make(a).status().rateLimitEvents.length,1)
 }finally{rmSync(a,{recursive:true,force:true});rmSync(b,{recursive:true,force:true})}
})

test('48 小时历史桶按时间裁剪，限流快照保持有界；旧账本向前兼容',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev17-prune-'));let now=1_800_000_000_000
 try{
  const make=()=>createBiliReadBudget({dataDir:dir,now:()=>now,logger:silent})
  make().acquire('read')
  now+=49*H
  make().acquire('read')
  const stat=make().status();assert.equal(stat.history24h.total,1)
  const state=JSON.parse(readFileSync(join(dir,'bili-read-budget.json'),'utf8'))
  assert.equal(state.historyBins.length,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
