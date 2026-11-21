import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {projectReadAvailability} from '../lib/read-availability-projection.mjs'
import {createBiliReadBudget} from '../lib/bili-read-budget.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'

const T=1_800_000_000_000,M=60_000
const active={dm:true,replies:true,mentions:true}
const base=()=>({blocked:false,minuteLimit:30,minuteUsed:1,hourLimit:450,hourUsed:1})
const view=(options={})=>projectReadAvailability({budget:base(),running:true,accountReady:true,enabled:active,now:T,...options})

test('预算允许但网络退避中的私信绝不能显示为可读取；其他通道独立',()=>{
  const x=view({networkBackoff:{dm:{allowed:false,category:'network',nextAt:T+5*M,streak:2}}})
  assert.equal(x.global.state,'ready')
  assert.deepEqual({state:x.lanes.dmUnread.state,reason:x.lanes.dmUnread.reason,retryAt:x.lanes.dmUnread.retryAt},
    {state:'deferred',reason:'network-retry',retryAt:T+5*M})
  assert.equal(x.lanes.dmList.reason,'network-retry')
  assert.equal(x.lanes.dmMessages.reason,'network-retry')
  assert.equal(x.lanes.replies.state,'ready')
  assert.doesNotMatch(JSON.stringify(x),/uid|credential|cookie/i)
})

test('同时存在平台风控、专用间隔和网络低频时完整保留原因，最晚时刻为已知解除边界',()=>{
  const x=view({budget:{...base(),blocked:true,reason:'platform-cooldown',retryAt:T+5*M,
    dmUnreadNextAt:T+10*M},networkBackoff:{dm:{allowed:false,category:'rate-limit',nextAt:T+30*M}}})
  const dm=x.lanes.dmUnread
  assert.equal(dm.state,'deferred');assert.equal(dm.reason,'platform-recovery');assert.equal(dm.retryAt,T+30*M)
  assert.deepEqual(dm.blockers.map(b=>b.code),['platform-cooldown','dm-unread-interval','platform-recovery'])
  assert.equal(x.global.reason,'platform-cooldown');assert.equal(x.lanes.replies.reason,'platform-cooldown')
})

test('共享额度满与私信/社交独立间隔分别清楚区分；到期后投影自然释放',()=>{
  const b={...base(),blocked:true,reason:'minute-budget',retryAt:T+M,
    dmListNextAt:T+2*M,socialUnreadNextAt:T+4*M,
    socialEndpoints:{'mcp:bili_received_replies':T+3*M}}
  const x=view({budget:b})
  assert.equal(x.lanes.dmList.reason,'dm-list-interval')
  assert.equal(x.lanes.socialUnread.reason,'social-unread-interval')
  assert.equal(x.lanes.replies.reason,'social-rate-protection')
  assert.equal(x.lanes.mentions.reason,'minute-budget')
  const later=view({budget:{...b,blocked:false},now:T+5*M})
  assert.equal(later.lanes.dmList.state,'ready')
  assert.equal(later.lanes.socialUnread.state,'ready')
})

test('账号不可信、调度关闭、权限未开启、账本缺失时安全显示非可用，不返回敏感内容',()=>{
  const noAccount=view({accountReady:false})
  assert.equal(noAccount.lanes.dmUnread.reason,'account-unavailable')
  assert.equal(noAccount.lanes.dmUnread.retryAt,0)
  assert.equal(view({running:false}).lanes.replies.reason,'scheduler-stopped')
  assert.equal(view({enabled:{dm:false,replies:true,mentions:false}}).lanes.dmList.reason,'not-enabled')
  assert.equal(view({enabled:{dm:false,replies:true,mentions:false}}).lanes.mentions.reason,'not-enabled')
  assert.equal(view({budget:{}}).lanes.dmUnread.state,'unknown')
  const x=view({networkBackoff:{dm:{category:'network',nextAt:T+M,message:'SESSION=secret'}}})
  assert.doesNotMatch(JSON.stringify(x),/SESSION|secret|message/)
})

test('账号认证故障不可误归因为平台 -509',()=>{
  const x=view({budget:{...base(),blocked:true,reason:'platform-cooldown',retryAt:T+15*M,
    lastReason:'B站登录态需要检查'}})
  assert.equal(x.lanes.dmList.reason,'account-auth')
  assert.equal(x.global.reason,'account-auth')
})

test('真实调度只投影原预算和账户网络退避；不消费额度，不清退避或发送',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bili-read-availability-'))
  let t=T
  try{
    const budget=createBiliReadBudget({dataDir:dir,now:()=>t,logger:{warn(){}}})
    const s=createInteractionScheduler({dataDir:dir,getAccountTag:()=> 'a'.repeat(16),now:()=>t,
      getConfig:()=>({masterEnabled:true,dmWatch:true,commentWatchReplies:true,commentAtEnabled:true}),
      readBudget:budget,dm:{},comments:{},logger:{error(){}}})
    const before=s.status()
    assert.equal(before.readAvailability.lanes.dmUnread.reason,'scheduler-stopped')
    assert.equal(before.readBudget.hourUsed,0)
    budget.acquire('dm-list');budget.noteError(Error('code=-509'),'dm-list')
    const snapshot=s.status()
    assert.equal(snapshot.readAvailability.global.reason,'platform-cooldown')
    assert.equal(snapshot.readAvailability.global.retryAt,t+5*M)
    assert.equal(s.status().readBudget.hourUsed,1,'status reads must not charge read tokens')
    assert.equal(budget.status().backoffCount,1,'status must not clear -509 cooldown')
    assert.equal(typeof s.status().readAvailability.lanes.socialUnread,'object')
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('界面只读投影不得误写为当前可读取或解除保护操作',async()=>{
  const {readFileSync}=await import('node:fs')
  const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(ui,/scheduler\.readAvailability\?\.lanes/)
  assert.match(ui,/各通道仍可能退避/)
  assert.doesNotMatch(ui,/✓ 当前可读取/)
})


test('实际账本同时发生分钟限制与平台冷却时，投影列出两者并保持执行拒绝',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bili-overlap-budget-'))
  let time=T
  try{
    const budget=createBiliReadBudget({dataDir:dir,minuteLimit:5,hourLimit:50,
      now:()=>time,logger:{warn(){}}})
    for(let i=0;i<5;i++)budget.acquire('dm-messages')
    budget.noteError(Error('code=-509'),'dm-messages')
    const before=budget.status()
    assert.deepEqual(before.activeBlocks.map(b=>b.code),['platform-cooldown','minute-budget'])
    const projection=view({budget:before})
    assert.deepEqual(projection.global.blockers.map(b=>b.code),['platform-cooldown','minute-budget'])
    assert.equal(projection.global.reason,'platform-cooldown')
    assert.throws(()=>budget.acquire('cover-image'),/B站后台读取已暂停/)
    assert.equal(budget.status().hourUsed,5)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
