import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {createLifeWillingnessAdmission,recoverLifeWillingnessOffline} from '../lib/life-willingness-admission.mjs'
const ACCOUNT='a'.repeat(16),OTHER='b'.repeat(16)
const offer=(id='observation')=>({sourceKey:'verified-public-data:1',scene:'main',candidates:[{id,kind:'reflect',label:'反思已记录的经历'}]})
const build=(dir,{scope=ACCOUNT,clock=Date.now,invoke=async()=>JSON.stringify({action:'act',candidateId:'observation',reason:'想要反思'})}={})=>createLifeWillingness({
  dataDir:dir,getAccountTag:()=>scope,now:clock,enabled:()=>true,beginTrace:()=>({step(){},finish(){}}),
  getContext:()=>({voice:'身份语境',world:{}}),invokeModel:invoke,opportunityWindowMs:0
})
const temp=t=>{const dir=mkdtempSync(join(tmpdir(),'dsh-life-dev9-'));t.after(()=>rmSync(dir,{force:true,recursive:true}));return dir}

test('两个独立 Life 实例共享同一持久准入，只有一个调用模型',async t=>{
  const dir=temp(t),first=build(dir),second=build(dir)
  const chosen=await first.decide(offer())
  assert.equal(chosen.ok,true)
  const deferred=await second.decide(offer('different'))
  assert.equal(deferred.action,'defer');assert.equal(deferred.reason,'life-choice-in-progress')
  assert.equal(first.verify(chosen.proof,'reflect').ok,true)
  assert.equal(first.receipt(chosen.proof,{status:'verified'}).ok,true)
  const next=await second.decide(offer())
  assert.equal(next.ok,true)
  assert.equal(second.receipt(next.proof,{status:'not-sent'}).ok,true)
})

test('正在缓慢调用模型时第二个实例不能获得批准',async t=>{
  const dir=temp(t);let release,secondCalls=0
  const first=build(dir,{invoke:()=>new Promise(resolve=>{release=()=>resolve(JSON.stringify({action:'act',candidateId:'observation',reason:'看到了真实资料'}))})})
  const second=build(dir,{invoke:async()=>{secondCalls++;return '{}'}})
  const pending=first.decide(offer())
  await new Promise(resolve=>setTimeout(resolve,15))
  const blocked=await second.decide(offer());assert.equal(blocked.reason,'life-choice-in-progress');assert.equal(secondCalls,0)
  release();const granted=await pending;assert.equal(granted.ok,true)
  assert.equal(first.receipt(granted.proof,{status:'uncertain'}).ok,true)
})

test('账户隔离和跨进程冷却同时有效，不写消息内容或账号原始值',t=>{
  const dir=temp(t),now=Date.now(),a=createLifeWillingnessAdmission({dataDir:dir,now:()=>now,cooldownMs:30000})
  const first=a.acquire(ACCOUNT);assert.equal(first.ok,true)
  assert.equal(a.acquire(OTHER).ok,true)
  assert.equal(a.approve(ACCOUNT,first.token).ok,true)
  assert.equal(a.settle(ACCOUNT,first.token,{verified:true}).ok,true)
  const rested=a.acquire(ACCOUNT);assert.equal(rested.reason,'life-cross-channel-rest')
  const serialized=readFileSync(join(dir,'life-willingness-admission.json'),'utf8')
  assert.equal(serialized.includes(ACCOUNT),false)
  assert.equal(serialized.includes('verified-public-data'),false)
  assert.equal(serialized.includes('身份语境'),false)
})

test('异常进程的批准不能自动重用，恢复需明确停机和平台事务核查',async t=>{
  const dir=temp(t)
  const source=`import {createLifeWillingness} from ${JSON.stringify(new URL('../lib/life-willingness.mjs',import.meta.url).href)};\n`+
    `const actor=createLifeWillingness({dataDir:${JSON.stringify(dir)},getAccountTag:()=>${JSON.stringify(ACCOUNT)},enabled:()=>true,`+
    `getContext:()=>({voice:'原设',world:{}}),invokeModel:async()=>'{"action":"act","candidateId":"observation","reason":"OK"}',`+
    `beginTrace:()=>({step(){},finish(){}})});const result=await actor.decide(${JSON.stringify(offer())});if(!result.ok)process.exit(4);`
  execFileSync(process.execPath,['--input-type=module','-e',source],{timeout:8000})
  const actor=build(dir)
  assert.equal((await actor.decide(offer())).reason,'life-choice-in-progress')
  assert.equal(recoverLifeWillingnessOffline({dataDir:dir,scope:ACCOUNT}).ok,false)
  assert.equal(recoverLifeWillingnessOffline({dataDir:dir,scope:ACCOUNT,confirmedAllStopped:true}).ok,false)
  const recovered=recoverLifeWillingnessOffline({dataDir:dir,scope:ACCOUNT,confirmedAllStopped:true,platformTransactionReviewed:true})
  assert.equal(recovered.ok,true);assert.equal(recovered.removed,true)
  const after=await actor.decide(offer());assert.equal(after.ok,true)
  assert.equal(actor.receipt(after.proof,{status:'not-sent'}).ok,true)
})

test('存储账本格式损坏时拒绝 Life 行动，不向模型发送任何请求',async t=>{
  const dir=temp(t);const a=createLifeWillingnessAdmission({dataDir:dir})
  // create a valid account record first, then tamper with it
  assert.equal(a.acquire(ACCOUNT).ok,true)
  const {writeFileSync}=await import('node:fs');writeFileSync(join(dir,'life-willingness-admission.json'),'INVALID')
  let calls=0
  const actor=build(dir,{invoke:async()=>{calls++;return '{}'}})
  const result=await actor.decide(offer())
  assert.equal(result.ok,false);assert.equal(result.reason,'life-admission-storage-unavailable');assert.equal(calls,0)
})

test('进程死亡后仅过期的考虑阶段可安全自动回收；已批准阶段永不自动释放',async t=>{
  const dir=temp(t)
  const source=`import {createLifeWillingnessAdmission} from ${JSON.stringify(new URL('../lib/life-willingness-admission.mjs',import.meta.url).href)};`+
    `const row=createLifeWillingnessAdmission({dataDir:${JSON.stringify(dir)}});if(!row.acquire(${JSON.stringify(ACCOUNT)}).ok)process.exit(2);`
  execFileSync(process.execPath,['--input-type=module','-e',source],{timeout:8000})
  const clock=Date.now()+11*60_000
  const ledger=createLifeWillingnessAdmission({dataDir:dir,now:()=>clock})
  const acquired=ledger.acquire(ACCOUNT)
  assert.equal(acquired.ok,true);assert.equal(acquired.recoveredConsideration,true)
  assert.equal(ledger.approve(ACCOUNT,acquired.token).ok,true)
  const later=createLifeWillingnessAdmission({dataDir:dir,now:()=>clock+11*60_000})
  assert.equal(later.acquire(ACCOUNT).reason,'life-choice-review-required')
})
