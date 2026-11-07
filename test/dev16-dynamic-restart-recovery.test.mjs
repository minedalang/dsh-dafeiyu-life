import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDailyDynamic} from '../lib/daily-dynamic.mjs'
const TAG='a'.repeat(16),BODY='鱼鱼正在回想刚才的公开探索，一点新奇的念头。',ID='1234567890123456789'
function setup(t,rows,now=Date.now()){
 const dir=mkdtempSync(join(tmpdir(),'dev16-restart-'))
 t.after(()=>rmSync(dir,{recursive:true,force:true}))
 mkdirSync(join(dir,'daily-dynamic'))
 const path=join(dir,'daily-dynamic','drafts.json')
 writeFileSync(path,JSON.stringify({drafts:rows}))
 let reads=0,publishes=0,cues=0
 const config=()=>({masterEnabled:true,dailyDynamicEnabled:true,accountTag:TAG,dailyDynamicDailyLimit:10})
 const create=()=>createDailyDynamic({dataDir:dir,getConfig:config,getPublicVideos:()=>[],invokeModel:async()=>'',
  now:()=>now,publish:async()=>{publishes++;return {status:'api_accepted_unverified',dynamic_id:ID}},
  verifyPublished:async()=>{reads++;return {verified:true,source:'platform-read-after-write'}},
  onVerifiedPublished:()=>{cues++;return true}})
 const status=()=>JSON.parse(readFileSync(path,'utf8')).drafts
 return {create,status,counts:()=>({reads,publishes,cues})}
}
test('dev16 interrupted publishing without ID stays unknown across restart, never re-posted',async t=>{
 const now=Date.now(),x=setup(t,[{id:'p1',status:'publishing',accountTag:TAG,text:BODY,
  attemptedAt:new Date(now-12*60_000).toISOString()}],now)
 await x.create().verifyPending()
 assert.equal(x.status()[0].status,'uncertain')
 assert.equal(x.status()[0].result,'interrupted-before-platform-confirmation')
 await x.create().verifyPending()
 assert.deepEqual(x.counts(),{reads:0,publishes:0,cues:0})
})
test('dev16 recent in-flight publishing row stays unchanged',async t=>{
 const now=Date.now(),x=setup(t,[{id:'p1',status:'publishing',accountTag:TAG,text:BODY,
  attemptedAt:new Date(now-60_000).toISOString()}],now)
 await x.create().verifyPending()
 assert.equal(x.status()[0].status,'publishing')
})
test('dev16 accepted dynamic with stable ID resumes read-only verification after restart',async t=>{
 const x=setup(t,[{id:'p1',status:'published',accountTag:TAG,text:BODY,dynamicId:ID}])
 assert.equal((await x.create().verifyPending()).confirmed,1)
 assert.equal(x.status()[0].status,'confirmed')
 assert.equal(x.status()[0].lifeCueRecorded,true)
 await x.create().verifyPending()
 assert.deepEqual(x.counts(),{reads:1,publishes:0,cues:1})
})
