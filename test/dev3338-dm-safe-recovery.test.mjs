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
