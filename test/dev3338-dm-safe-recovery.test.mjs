import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
const create=async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dev3338-dm-'));let t=1_800_000_000_000,input=[],remote=[],available=false,modelCalls=0,sends=0,reads=0
 const cfg=()=>({enabled:true,whitelist:['221'],whitelistCooldownSeconds:0})
 const make=()=>createDmAutoReply({dataDir:dir,selfUid:'999',now:()=>t,getConfig:cfg,
  fetchIncoming:async()=>input,fetchContactSnapshot:async()=>{reads++;return remote},getRecoveryReadGate:()=>({allowed:available,retryAt:t+600_000}),
  send:async()=>{sends++;return {ok:true}},generateReply:async()=>{modelCalls++;if(!available){const e=Error('busy');e.code='life-admission-preflight-deferred';e.retryAt=t+600_000;throw e}return '收到消息'},
  logger:{warn(){},error(){}}})
 return {make,dir,setInput:rows=>input=rows,setRemote:rows=>remote=rows,allow:()=>available=true,deny:()=>available=false,
  advance:n=>t+=n,get:()=>({modelCalls,sends,reads}),status:async()=>JSON.parse(await readFile(join(dir,'dm-life-inbox.json'),'utf8'))}
}
const msg=id=>({senderUid:'221',messageId:'221:'+id,timestampMs:1_800_000_000_000,text:'测试消息',incoming:true})
const server=id=>({fromMe:false,key:id,ts:1_800_000_000,text:'测试消息',kind:1})

test('pre-model Life admission busy is technical deferred without consuming attempts',async()=>{
 const m=await create();await m.make().poll();m.setInput([msg('one')])
 const result=await m.make().poll();assert.equal(result.deferred,1)
 assert.deepEqual(m.get(),{modelCalls:1,sends:0,reads:0})
 let row=(await m.status()).rows[0]
 assert.equal(row.status,'technical-deferred');assert.equal(row.attempts,0)
 // At most one deferral on the same arrival; a fast re-poll cannot burst.
 await m.make().poll();assert.equal(m.get().modelCalls,1)
 m.setInput([]);m.setRemote([server('one')]);m.advance(10*60_000+4000);m.allow()
 const recovered=await m.make().poll();assert.equal(recovered.sent,1)
 assert.deepEqual(m.get(),{modelCalls:2,sends:1,reads:1})
})

test('shared read pause prevents due continuation reads without clearing deferred tasks',async()=>{
 const m=await create();await m.make().poll();m.setInput([msg('one')]);await m.make().poll()
 m.setInput([]);m.setRemote([server('one')]);m.advance(10*60_000+1)
 await m.make().poll();assert.equal(m.get().reads,0);assert.equal(m.get().sends,0)
 assert.equal((await m.status()).rows[0].status,'technical-deferred')
 m.advance(10*60_000+4000);m.allow()
 const result=await m.make().poll();assert.equal(result.sent,1)
 assert.equal(m.get().reads,1);assert.equal(m.get().sends,1)
})


test('old automatic DM model output is deferred on mode generation change without sending or consuming an attempt',async()=>{
 const {createAutomaticSessionScope}=await import('../lib/session-integration-policy.mjs')
 const {rm}=await import('node:fs/promises')
 const dir=await mkdtemp(join(tmpdir(),'dev24-dm-pause-'));let t=1_800_000_000_000,input=[],policy={mode:'autonomous-life',revision:0},finish,entered,sends=0,models=0
 const scope=createAutomaticSessionScope(()=>policy),started=new Promise(r=>entered=r)
 const dm=createDmAutoReply({dataDir:dir,selfUid:'999',now:()=>t,getConfig:()=>({enabled:true,whitelist:['221'],whitelistCooldownSeconds:0}),
  canProcess:scope.current,fetchIncoming:async()=>input,generateReply:async()=>{models++;if(models===1){entered();return new Promise(r=>finish=r)}return '收到消息'},
  send:async()=>{sends++;return {ok:true}},logger:{warn(){},error(){}}})
 try{
  await scope.run(scope.capture(),()=>dm.poll());input=[msg('one')]
  const pending=scope.run(scope.capture(),()=>dm.poll());await started
  policy={mode:'memory-foundation',revision:1};policy={mode:'autonomous-life',revision:2};finish('旧模式的回复')
  const old=await pending;assert.equal(old.deferred,1);assert.equal(sends,0)
  const db=JSON.parse(await readFile(join(dir,'dm-life-inbox.json'),'utf8'))
  assert.equal(db.rows[0].status,'technical-deferred');assert.equal(db.rows[0].attempts,0)
  t+=100_000;await scope.run(scope.capture(),()=>dm.poll());assert.equal(sends,1);assert.equal(models,2)
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('mode pause after inbox read does not establish stale baseline, explicit unscoped inspection retains original contract',async()=>{
 const {createAutomaticSessionScope}=await import('../lib/session-integration-policy.mjs')
 const {rm}=await import('node:fs/promises')
 const dir=await mkdtemp(join(tmpdir(),'dev24-dm-baseline-'));let policy={mode:'autonomous-life',revision:0},finish,entered,reads=0,settles=0
 const scope=createAutomaticSessionScope(()=>policy),started=new Promise(r=>entered=r)
 const dm=createDmAutoReply({dataDir:dir,selfUid:'999',getConfig:()=>({enabled:true,whitelist:['221']}),canProcess:scope.current,
  fetchIncoming:async()=>{reads++;if(reads===1){entered();return new Promise(r=>finish=r)}return []},onScanSettled:()=>settles++,
  generateReply:async()=>{throw Error('must not generate')},send:async()=>{throw Error('must not send')},logger:{warn(){},error(){}}})
 try{
  const pending=scope.run(scope.capture(),()=>dm.poll());await started;policy={mode:'memory-foundation',revision:1};finish([msg('one')]);
  assert.equal((await pending).skipped,'session-integration-paused');assert.equal(settles,0);assert.equal(await dm.needsBootstrap(),true)
  assert.equal((await dm.poll()).initialized,true);assert.equal(settles,1)
 }finally{await rm(dir,{recursive:true,force:true})}
})
