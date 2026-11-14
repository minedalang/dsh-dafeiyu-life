import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createSocialSendTransaction} from '../lib/social-send-transaction.mjs'
import {createUnsafeDirectoryLinkOrSkip} from './helpers/unsafe-directory-link.mjs'
const A='a'.repeat(16),B='b'.repeat(16)
const key='dm:12345:msg-id:1'
function setup(t){
  const dir=mkdtempSync(join(tmpdir(),'dsh-sendtx-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  let s=A
  const make=()=>createSocialSendTransaction({dataDir:dir,getAccountTag:()=>s,now:()=>1000000})
  return {dir,make,account:v=>{s=v}}
}
test('durable confirmed DM receipt blocks duplicate even in a new instance',async t=>{
  const x=setup(t);let calls=0
  const send=async()=>{calls++;return {ok:true,receiptId:'remote-msg-secret-123'}}
  assert.equal((await x.make().execute({channel:'dm',eventKey:key},send)).ok,true)
  assert.equal((await x.make().execute({channel:'dm',eventKey:key},send)).reason,'social-send-already-reserved')
  assert.equal(calls,1)
  assert.equal(x.make().inspect().channels.dm.confirmed,1)
  const files=[]
  const traverse=(dir)=>{for(const name of readdirSync(dir,{withFileTypes:true})){
    if(name.isDirectory())traverse(join(dir,name.name))
    else files.push(readFileSync(join(dir,name.name),'utf8'))
  }}
  traverse(join(x.dir,'social-send-transactions'))
  for(const secret of [A,'12345','msg-id','remote-msg-secret','user private message'])assert.doesNotMatch(files.join(' '),new RegExp(secret))
})
test('ambiguous success, absent receipt, thrown transport and false result never retry',async t=>{
  const x=setup(t);let calls=0
  for(const [i,fn] of [
    async()=>({ok:true,receiptId:''}),async()=>{throw Error('transport down')},async()=>({ok:false}),
    async()=>({ok:true,rpid:'0'})
  ].entries()){
    const channel=i===3?'comment':'dm',eventKey='source:'+i
    const run=async()=>{calls++;return fn()}
    const res=await x.make().execute({channel,eventKey},run)
    assert.equal(res.ok,false);assert.equal(res.no_retry,true)
    assert.equal((await x.make().execute({channel,eventKey},run)).reason,'social-send-already-reserved')
  }
  assert.equal(calls,4)
  assert.equal(x.make().inspect().channels.dm.uncertain,3)
  assert.equal(x.make().inspect().channels.comment.uncertain,1)
})
test('a valid comment reply receipt is required and different bubbles have distinct keys',async t=>{
  const x=setup(t),run=async()=>({ok:true,rpid:'9988'})
  assert.equal((await x.make().execute({channel:'comment',eventKey:'source:rpid:0'},run)).ok,true)
  assert.equal((await x.make().execute({channel:'comment',eventKey:'source:rpid:1'},run)).ok,true)
  assert.equal(x.make().inspect().channels.comment.confirmed,2)
})
test('account isolation and scope revocation do not unlock another account',async t=>{
  const x=setup(t),tx=x.make();let resolve
  const pending=tx.execute({channel:'dm',eventKey:key},()=>new Promise(r=>resolve=r))
  await new Promise(r=>setImmediate(r))
  x.account(B)
  assert.equal((await x.make().execute({channel:'dm',eventKey:key},async()=>({ok:true,receiptId:'other-account'}))).ok,true)
  resolve({ok:true,receiptId:'original-account'})
  assert.equal((await pending).reason,'account-changed-after-send')
  assert.equal(tx.inspect().channels.dm.confirmed,1)
  x.account(A)
  assert.equal(tx.inspect().channels.dm.confirmed,1)
  assert.equal((await tx.execute({channel:'dm',eventKey:key},async()=>{throw Error('must not send')})).no_retry,true)
})
test('missing account, missing stable source and invalid channel never call network',async t=>{
  const x=setup(t),tx=x.make();let calls=0,send=()=>{calls++;return Promise.resolve({ok:true,receiptId:'1'})}
  for(const params of [{channel:'dm',eventKey:''},{channel:'follow',eventKey:key},{channel:'dm',eventKey:key,expectedScope:B}]){
    assert.equal((await tx.execute(params,send)).ok,false)
  }
  x.account('')
  assert.equal((await tx.execute({channel:'dm',eventKey:key},send)).reason,'account-scope-unavailable')
  assert.equal(calls,0)
})
test('claim created by a child which crashes before confirmation cannot be re-sent',async t=>{
  const x=setup(t),url=new URL('../lib/social-send-transaction.mjs',import.meta.url).href
  const script=`import {createSocialSendTransaction} from ${JSON.stringify(url)};const t=createSocialSendTransaction({dataDir:process.argv[1],getAccountTag:()=>${JSON.stringify(A)}});await t.execute({channel:'dm',eventKey:${JSON.stringify(key)}},()=>{process.exit(23)})`
  const child=spawnSync(process.execPath,['--input-type=module','-e',script,x.dir],{encoding:'utf8'})
  assert.equal(child.status,23,child.stderr)
  let calls=0
  assert.equal((await x.make().execute({channel:'dm',eventKey:key},async()=>{calls++;return {ok:true,receiptId:'x'}})).no_retry,true)
  assert.equal(calls,0)
  assert.equal(x.make().inspect().channels.dm.attempted,1)
})
test('incomplete transaction and unsafe symlinks fail closed',async t=>{
  const x=setup(t)
  const dir=join(x.dir,'social-send-transactions')
  const outside=mkdtempSync(join(tmpdir(),'dsh-sendtx-out-'))
  t.after(()=>rmSync(outside,{recursive:true,force:true}))
  if(!createUnsafeDirectoryLinkOrSkip(t,outside,dir))return
  assert.equal((await x.make().execute({channel:'dm',eventKey:key},async()=>({ok:true,receiptId:'x'}))).reason,'social-transaction-storage-unsafe')
  assert.deepEqual(readdirSync(outside),[])
})
test('non-directory transaction storage fails closed without any link privileges',async t=>{
  const x=setup(t)
  writeFileSync(join(x.dir,'social-send-transactions'),'not a directory')
  let sends=0
  const result=await x.make().execute({channel:'dm',eventKey:key},async()=>{
    sends++
    return {ok:true,receiptId:'unexpected'}
  })
  assert.equal(result.reason,'social-transaction-storage-unsafe')
  assert.equal(sends,0)
})
test('production endpoints are gated with stable source and separate bubble identity',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const comment=readFileSync(new URL('../lib/comment-interact.mjs',import.meta.url),'utf8')
  assert.match(index,/socialSendTransaction\.execute\(\{channel:'dm'/)
  assert.equal((index.match(/socialSendTransaction\.execute\(\{channel:'comment'/g)||[]).length,3,
    'dynamic, video and trusted comment agent share one cross-process send barrier')
  assert.match(index,/socialSendTransaction:socialSendTransaction\.inspect\(\)/)
  assert.doesNotMatch(comment,/replyIndex:i\+1/,'公开评论不得续发第二条')
  assert.match(comment,/replyIndex:0/,'公开评论只有首条平台发送')
  assert.match(comment,/socialOwnerProof,lifeWillingnessProof/) // first comment is still proof-bound
})

test('offline review may clear only prepared, never attempted or confirmed transactions',async t=>{
  const x=setup(t),tx=x.make()
  assert.equal(tx.reviewNoAttempt({channel:'dm',eventKey:key,confirmation:'wrong'}).reason,'explicit-no-attempt-confirmation-required')
  let callback
  const active=tx.execute({channel:'dm',eventKey:key},()=>new Promise(resolve=>callback=resolve))
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(tx.reviewNoAttempt({channel:'dm',eventKey:key,confirmation:'我已停机核实此消息从未开始平台发送'}).reason,'platform-attempt-cannot-be-cleared')
  callback({ok:true,receiptId:'ack'})
  await active
  assert.equal(tx.reviewNoAttempt({channel:'dm',eventKey:key,confirmation:'我已停机核实此消息从未开始平台发送'}).reason,'platform-attempt-cannot-be-cleared')
})
