import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createBiliReadBudget,BiliReadDeferredError} from '../lib/bili-read-budget.mjs'
const M=60_000,H=60*M,dir=()=>mkdtempSync(join(tmpdir(),'bili-sentinel-budget-'))
const silent={warn(){}}
const deferred=(fn,reason)=>assert.throws(fn,e=>e instanceof BiliReadDeferredError&&e.reason===reason)

test('私信未读哨兵共享 DM 自适应间隔并跨预算实例/重启持久化',()=>{
  const home=dir();let now=1_800_000_000_000
  try{
    const make=()=>createBiliReadBudget({dataDir:home,now:()=>now,logger:silent})
    make().acquire('dm-unread');make().noteError(Error('HTTP 200 code=-509'),'dm-unread')
    assert.equal(make().status().dmListRateLevel,1)
    now+=5*M
    deferred(()=>make().acquire('dm-unread'),'dm-unread-interval')
    const restarted=make();assert.equal(restarted.status().dmUnreadNextAt,now+5*M)
    now+=5*M;restarted.acquire('dm-unread')
    assert.equal(make().status().lastReadAtByKind['dm-unread'],now)
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('互动通知哨兵与详情读取共用账号级 -509 保护，保护期按端点持久化',()=>{
  const home=dir();let now=1_800_000_000_000
  try{
    const make=()=>createBiliReadBudget({dataDir:home,now:()=>now,logger:silent})
    make().acquire('social-unread');make().noteError(Error('HTTP 200 code=-509'),'social-unread')
    now+=5*M
    deferred(()=>make().acquire('social-unread'),'social-unread-interval')
    deferred(()=>make().acquire('mcp:bili_received_replies'),'social-rate-protection')
    now+=10*M
    make().acquire('social-unread')
    assert.equal(make().status().lastReadAtByKind['social-unread'],now)
    now+=9*M
    deferred(()=>make().acquire('social-unread'),'social-unread-interval')
    now+=M;make().acquire('social-unread')
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('DM -509 也会暂时降低互动哨兵频率，避免其他社交读取立即恢复高频',()=>{
  const home=dir();let now=1_800_000_000_000
  try{
    const make=()=>createBiliReadBudget({dataDir:home,now:()=>now,logger:silent})
    make().acquire('dm-unread');make().noteError(Error('HTTP 200 code=-509'),'dm-unread')
    now+=5*M
    deferred(()=>make().acquire('social-unread'),'social-unread-interval')
    now+=10*M
    make().acquire('social-unread')
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('DM -509 来自计数哨兵时，也会为完整会话列表建立持久自适应下限',()=>{
  const home=dir();let now=1_800_000_000_000
  try{
    const make=()=>createBiliReadBudget({dataDir:home,now:()=>now,logger:silent})
    make().acquire('dm-unread');make().noteError(Error('HTTP 200 code=-509'),'dm-unread')
    now+=5*M
    assert.equal(make().status().dmListNextAt,now+5*M)
    deferred(()=>make().acquire('dm-list'),'dm-list-interval')
    now+=5*M
    make().acquire('dm-list')
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('其他模块的无端点成功回执不能清除指定接口的 -509 账号保护',()=>{
  const home=dir();let now=1_800_000_000_000
  try{
    const make=()=>createBiliReadBudget({dataDir:home,now:()=>now,logger:silent})
    make().acquire('dm-unread');make().noteError(Error('HTTP 200 code=-509'),'dm-unread')
    now+=6*M
    make().noteSuccess() // unrelated legacy success without an endpoint identity
    deferred(()=>make().acquire('social-unread'),'social-unread-interval')
    now+=9*M
    make().acquire('social-unread')
  }finally{rmSync(home,{recursive:true,force:true})}
})
