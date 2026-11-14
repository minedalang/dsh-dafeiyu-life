import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDailyDynamic} from '../lib/daily-dynamic.mjs'
const tag='a'.repeat(16),id='1234567890123456789',body='这是一次已经发出的真实生活动态，等待B站回查确认。'
function fixture(t,{verifyPublished=async()=>({verified:false}),onVerifiedPublished=()=>true,old=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'dev15-dynamic-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 const filename=join(dir,'daily-dynamic','drafts.json');mkdirSync(join(dir,'daily-dynamic'))
 const row={id:'draft-one',day:'2026-11-07',text:body,status:'published',dynamicId:id,
   ...(old?{}:{accountTag:tag})}
 writeFileSync(filename,JSON.stringify({drafts:[row]}))
 const inst=createDailyDynamic({dataDir:dir,getConfig:()=>({masterEnabled:true,dailyDynamicEnabled:true,
   accountTag:tag,dailyDynamicDailyLimit:10}),getPublicVideos:()=>[],invokeModel:async()=>'',
   publish:async()=>({status:'api_accepted_unverified',dynamic_id:id}),verifyPublished,onVerifiedPublished})
 return {inst,row:()=>JSON.parse(readFileSync(filename,'utf8')).drafts[0]}
}
test('dev15 accepted API code alone never becomes confirmed or Life experience',async t=>{
 let called=0;const x=fixture(t,{verifyPublished:async()=>{called++;return {verified:false}}})
 assert.deepEqual((await x.inst.verifyPending()).confirmed,0)
 assert.equal(x.row().status,'published');assert.equal(called,1)
})
test('dev15 fresh independent full match promotes once and records Life cue once',async t=>{
 let verified=0,cues=0
 const x=fixture(t,{verifyPublished:async input=>{
  verified++;assert.deepEqual(input,{dynamicId:id,text:body,accountTag:tag})
  return {verified:true,source:'platform-read-after-write'}},onVerifiedPublished:()=>{cues++;return true}})
 assert.equal((await x.inst.verifyPending()).confirmed,1)
 assert.equal(x.row().status,'confirmed');assert.equal(x.row().lifeCueRecorded,true)
 await x.inst.verifyPending()
 assert.equal(verified,1);assert.equal(cues,1)
})
test('dev15 confirmed durable row can reattempt only the failed Life cue, without new write',async t=>{
 let cues=0;const x=fixture(t,{verifyPublished:async()=>({verified:true,source:'platform-read-after-write'}),
   onVerifiedPublished:()=>++cues>1})
 await x.inst.verifyPending();assert.equal(x.row().status,'confirmed');assert.equal(x.row().lifeCueRecorded,undefined)
 await x.inst.verifyPending();assert.equal(x.row().lifeCueRecorded,true)
 assert.equal(cues,2)
})
test('dev15 verification rejects unbound legacy row and forged proof source',async t=>{
 let calls=0;const x=fixture(t,{old:true,verifyPublished:async()=>{calls++;return {verified:true,source:'platform-read-after-write'}}})
 await x.inst.verifyPending();assert.equal(calls,0);assert.equal(x.row().status,'published')
 const y=fixture(t,{verifyPublished:async()=>({verified:true,source:'writer-self-report'})})
 assert.equal((await y.inst.verifyPending()).confirmed,0);assert.equal(y.row().status,'published')
})
