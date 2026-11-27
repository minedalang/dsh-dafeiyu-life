import test from 'node:test'
import assert from 'node:assert/strict'
import {createLifeResourceScheduler} from '../lib/life-resource-scheduler.mjs'
import {createLifePublicReadCoalescer} from '../lib/life-public-read-coalescer.mjs'

const S='a'.repeat(16),B='b'.repeat(16)
const tick=()=>new Promise(resolve=>setImmediate(resolve))

test('queued social model use overtakes exploration without preempting active work',async()=>{
  const s=createLifeResourceScheduler({getAccountTag:()=>S})
  const hold=await s.acquire({lane:'background',resources:{model:1}}),order=[]
  const slow=s.run({lane:'exploration',resources:{model:1}},async()=>{order.push('explore')})
  const fast=s.run({lane:'social',resources:{model:1}},async()=>{order.push('social')})
  hold();await Promise.all([slow,fast]);assert.deepEqual(order,['social','explore'])
  assert.equal(s.status().active.model,0);s.close()
})

test('non-social work gets an admission after at most two consecutive social requests',async()=>{
  const s=createLifeResourceScheduler({getAccountTag:()=>S})
  const hold=await s.acquire({resources:{model:1}}),order=[]
  const social=Array.from({length:4},(_,i)=>s.run({lane:'social',resources:{model:1}},async()=>{order.push('social-'+i)}))
  const other=s.run({lane:'continuation',resources:{model:1}},async()=>{order.push('continuation')})
  hold();await Promise.all([...social,other]);assert.ok(order.indexOf('continuation')<=2,JSON.stringify(order))
  s.close()
})

test('read and model resources do not block each other',async()=>{
  const s=createLifeResourceScheduler({getAccountTag:()=>S})
  const release=await s.acquire({resources:{model:1}})
  let done=false
  await s.run({resources:{biliRead:1}},async()=>{done=true})
  assert.equal(done,true);assert.equal(s.status().active.model,1)
  release();s.close()
})

test('account switch rejects pending requests without executing the task',async()=>{
  let tag=S,executed=false
  const s=createLifeResourceScheduler({getAccountTag:()=>tag})
  const release=await s.acquire({resources:{model:1}})
  const queued=s.run({lane:'social',resources:{model:1}},async()=>{executed=true})
  tag=B;release()
  await assert.rejects(queued,/account-changed/)
  assert.equal(executed,false);assert.equal(s.status().accountRejected,1);s.close()
})

test('wait timeout is a technical delay, not a completed or sent Life action',async()=>{
  const s=createLifeResourceScheduler({getAccountTag:()=>S})
  const release=await s.acquire({resources:{model:1}})
  let executed=false
  await assert.rejects(s.run({lane:'social',resources:{model:1},waitMs:100},async()=>{executed=true}),/wait-timeout/)
  assert.equal(executed,false);assert.equal(s.status().deferred,1);release();s.close()
})

test('only one video process may be admitted; unknown result does not auto-retry',()=>{
  const s=createLifeResourceScheduler({getAccountTag:()=>S})
  const release=s.tryAcquire({resources:{video:1}})
  assert.equal(typeof release,'function')
  assert.equal(s.tryAcquire({resources:{video:1}}),null)
  release();release()
  assert.equal(s.status().active.video,0)
  s.close()
})

test('public video metadata coalescing is scoped, bounded, and avoids duplicate reads',async()=>{
  let calls=0,clock=1_000
  const c=createLifePublicReadCoalescer({now:()=>clock,ttlMs:10_000})
  const args={scope:S,bvid:'BV1abCdEfGhI'}
  const work=async()=>{calls++;await tick();return {code:0,title:'verified'}}
  const [a,b]=await Promise.all([c.run(args,work),c.run(args,work)])
  assert.equal(a.title,'verified');assert.equal(b.title,'verified');assert.equal(calls,1)
  await c.run(args,work);assert.equal(calls,1)
  await c.run({...args,scope:B},work);assert.equal(calls,2)
  clock+=11_000;await c.run(args,work);assert.equal(calls,3)
})

test('platform cooldown and unsuccessful metadata reads never reuse cached public evidence',async()=>{
  const c=createLifePublicReadCoalescer(),key={scope:S,bvid:'BV1abCdEfGhI'}
  let calls=0,allowed=true
  const work=async()=>{calls++;return {code:0}}
  await c.run({...key,readAllowed:()=>allowed},work)
  allowed=false;await c.run({...key,readAllowed:()=>allowed},work)
  assert.equal(calls,2)
  const err=await c.run({...key,bvid:'BV1234567890'},async()=>({code:-509,error:'rate-limit'}))
  assert.equal(err.code,-509)
  const d=await c.run({...key,bvid:'BV1234567890'},async()=>({code:0}))
  assert.equal(d.code,0)
})

test('Life model and read queues do not expose message payloads in status',async()=>{
  const s=createLifeResourceScheduler({getAccountTag:()=>S})
  const release=await s.acquire({resources:{model:1}})
  const pending=s.run({lane:'social',resources:{model:1}},async()=>true)
  const obj=s.status()
  assert.equal(obj.pending.social,1)
  assert.doesNotMatch(JSON.stringify(obj),/prompt|uid|messageId|send|receipt|password/)
  release();await pending;s.close()
})

test('Bili read slot precedes original persistent budget and preserves -509 cooldown',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const {createBiliReadBudget,BiliReadDeferredError}=await import('../lib/bili-read-budget.mjs')
  const dir=mkdtempSync(join(tmpdir(),'life339-read-budget-'))
  let requests=0
  const s=createLifeResourceScheduler({getAccountTag:()=>S})
  try{
    const budget=createBiliReadBudget({dataDir:dir,schedule:(kind,work)=>s.run({lane:'social',resources:{biliRead:1}},work),logger:{warn(){}}})
    const hold=await s.acquire({resources:{biliRead:1}})
    const queued=budget.guard('dm-messages',async()=>{requests++;return {code:-509}})
    assert.equal(s.status().pending.social,1)
    assert.equal(budget.status().minuteUsed,0,'waiting must not consume an API token')
    hold()
    assert.equal((await queued).code,-509)
    assert.equal(requests,1)
    assert.equal(budget.status().blocked,true)
    await assert.rejects(budget.guard('dm-messages',async()=>{requests++;return {code:0}}),BiliReadDeferredError)
    assert.equal(requests,1,'scheduler priority cannot bypass persisted -509 cooldown')
  }finally{s.close();rmSync(dir,{recursive:true,force:true})}
})


test('standalone owner memory shares model slot without admitting platform resources; stale local scope never starts',async()=>{
  let platform='',local='owner-memory:1:0',ran=false
  const s=createLifeResourceScheduler({getAccountTag:()=>platform,getOwnerMemoryScope:()=>local})
  await assert.rejects(s.acquire({resources:{biliRead:1}}),/account-not-ready/)
  await assert.rejects(s.run({resources:{model:1}},async()=>true),/account-not-ready/)
  let release;const hold=new Promise(r=>release=r)
  const first=s.runOwnerMemory(async()=>{await hold;return 1})
  await tick();assert.equal(s.status().active.model,1)
  const second=s.runOwnerMemory(async()=>{ran=true})
  const rejected=assert.rejects(second,/account-changed/)
  platform=S
  const ordinary=s.run({lane:'social',resources:{model:1}},async()=>{assert.equal(s.status().active.model,1);return 2})
  assert.equal(s.status().pending.social,1)
  local='owner-memory:2:0';release()
  assert.equal(await first,1);assert.equal(await ordinary,2);await rejected;assert.equal(ran,false)
  assert.equal(s.status().active.model,0);s.close()
})


test('dev50 queued old generation rejected even after returning to the same persistent Life account',async()=>{
 let generation=1,ran=0
 const s=createLifeResourceScheduler({getAccountTag:()=>S,getAccountGeneration:()=>generation})
 const hold=await s.acquire({resources:{model:1}})
 const queued=s.run({lane:'continuation',resources:{model:1}},async()=>{ran++})
 generation=3;hold()
 await assert.rejects(queued,e=>e.code==='life-resource-account-changed'&&e.workNotStarted===true)
 assert.equal(ran,0);assert.equal(await s.run({resources:{model:1}},async()=>++ran),1)
 assert.equal(s.status().active.model,0);s.close()
})
for(const mode of ['generation','close','standalone'])test('dev50 admission-to-callback race '+mode,async()=>{
 let generation=1,ownerScope='owner-memory:1:1',ran=false
 const s=createLifeResourceScheduler({getAccountTag:()=>S,getAccountGeneration:()=>generation,getOwnerMemoryScope:()=>ownerScope})
 const work=async()=>{ran=true}
 const task=mode==='standalone'?s.runOwnerMemory(work):s.run({resources:{model:1}},work)
 if(mode==='generation')generation++
 if(mode==='close')s.close()
 if(mode==='standalone')ownerScope='owner-memory:1:2'
 await assert.rejects(task,e=>e.workNotStarted===true&&e.code===(mode==='close'?'life-resource-closed':'life-resource-account-changed'))
 assert.equal(ran,false);assert.equal(s.status().active.model,0);s.close()
})
