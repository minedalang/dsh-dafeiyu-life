import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createSocialSendTransaction} from '../lib/social-send-transaction.mjs'

const ACCOUNT_A='a'.repeat(16),ACCOUNT_B='b'.repeat(16)
const key='video-recommendation:123:social-intent:life-share:123:BV1abcde1234'

function withGate(fn){
 const dataDir=mkdtempSync(join(tmpdir(),'rc-life-share-'))
 let scope=ACCOUNT_A
 const gate=createSocialSendTransaction({dataDir,getAccountTag:()=>scope})
 return Promise.resolve().then(()=>fn({gate,dataDir,setAccount:v=>scope=v})).finally(()=>rmSync(dataDir,{recursive:true,force:true}))
}

test('confirmed voluntary video DM cannot be resent even across separate processes',async()=>withGate(async({gate,dataDir})=>{
 let calls=0
 const result=await gate.execute({channel:'dm',eventKey:key,expectedScope:ACCOUNT_A},async()=>{
  calls++;return {ok:true,receiptId:'remote-confirmed-123'}
 })
 assert.equal(result.ok,true)
 const duplicate=await gate.execute({channel:'dm',eventKey:key,expectedScope:ACCOUNT_A},async()=>{calls++;return {ok:true,receiptId:'another-id'}})
 assert.equal(duplicate.ok,false)
 assert.equal(duplicate.no_retry,true)
 assert.equal(calls,1)
 assert.equal(gate.inspect().channels.dm.confirmed,1)
 // A new Node process must see the same opaque reservation, not merely a
 // cached flag inside the current engine instance.
 const source=new URL('../lib/social-send-transaction.mjs',import.meta.url).href
 const childCode=`import {createSocialSendTransaction} from ${JSON.stringify(source)};
 const gate=createSocialSendTransaction({dataDir:process.argv[1],getAccountTag:()=>${JSON.stringify(ACCOUNT_A)}});
 const result=await gate.execute({channel:'dm',eventKey:${JSON.stringify(key)},expectedScope:${JSON.stringify(ACCOUNT_A)}},async()=>({ok:true,receiptId:'must-not-send'}));
 if(result.ok||result.reason!=='social-send-already-reserved')process.exitCode=2;`
 const child=spawnSync(process.execPath,['--input-type=module','-e',childCode,dataDir],{encoding:'utf8',timeout:5000})
 assert.equal(child.status,0,child.stderr||child.stdout)
}))

test('missing platform DM receipt freezes the exact source; do not retry',async()=>withGate(async({gate})=>{
 let calls=0
 const first=await gate.execute({channel:'dm',eventKey:key,expectedScope:ACCOUNT_A},async()=>{calls++;return {ok:true}})
 assert.equal(first.ok,false)
 assert.equal(first.no_retry,true)
 assert.equal(first.reason,'social-send-result-uncertain')
 const retry=await gate.execute({channel:'dm',eventKey:key,expectedScope:ACCOUNT_A},async()=>{calls++;return {ok:true,receiptId:'later'}})
 assert.equal(retry.ok,false)
 assert.equal(retry.reason,'social-send-already-reserved')
 assert.equal(calls,1)
 assert.equal(gate.inspect().channels.dm.uncertain,1)
}))

test('account switch blocks old-source write before adapter entry',async()=>withGate(async({gate,setAccount})=>{
 let calls=0
 setAccount(ACCOUNT_B)
 const denied=await gate.execute({channel:'dm',eventKey:key,expectedScope:ACCOUNT_A},async()=>{calls++;return {ok:true,receiptId:'fake'}})
 assert.equal(denied.ok,false)
 assert.equal(denied.reason,'account-changed')
 assert.equal(calls,0)
}))
