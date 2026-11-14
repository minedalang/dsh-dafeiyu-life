import test from 'node:test'
import assert from 'node:assert/strict'
import {createLifeVideoActionBridge} from '../lib/life-video-action-bridge.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const UID='12345',TAG='a'.repeat(16),BV='BV1abcde1234'
function make(t,read){
 let uid=UID,scope=TAG
 const results=[]
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>uid,getAccountTag:()=>scope,
  choose:async({candidates})=>({ok:true,proof:{kind:candidates[0].kind}}),
  verify:()=>({ok:true}),receipt:(proof,result)=>results.push([proof.kind,result.status]),
  verifyPlatformState:read})
 t.after(()=>bridge.stop())
 const post=async(route,body)=>{
  const env=bridge.env()
  const r=await fetch(env.BILI_LIFE_ACTION_URL+route,{method:'POST',
   headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},
   body:JSON.stringify(body)})
  return {code:r.status,...await r.json()}
 }
 return {bridge,post,results,setScope:x=>scope=x,setUid:x=>uid=x,
  registerComment:(text)=>bridge.registerTrustedIntent({proof:{id:'test-'+Math.random(),kind:'video_comment',expiresAt:Date.now()+60_000},
   kind:'video_comment',target:BV,commentText:text,uid:uid,scope:scope})}
}
test('dev16 exact comment receipt + approved text + independent platform read confirm one Life action',async t=>{
 const seen=[];const x=make(t,async row=>{seen.push(row);return true})
 await x.bridge.start()
 const commentText='喜欢这个镜头，看得我又有点好奇了。'
 const ticket=x.registerComment(commentText)
 assert.equal(ticket.ok,true)
 const grant=await x.post('/life-action',{tool:'bili_reply',target:BV,uid:UID,
   commentText,topLevel:true,intentTicket:ticket.ticket})
 assert.equal(grant.ok,true)
 const r=await x.post('/life-action-result',{grant:grant.grant,uid:UID,ok:true,receiptId:'123456789012'})
 assert.equal(r.status,'verified')
 assert.deepEqual(x.results,[['video_comment','verified']])
 assert.deepEqual(seen,[{kind:'video_comment',target:BV,uid:UID,scope:TAG,
  receiptId:'123456789012',commentText:'喜欢这个镜头，看得我又有点好奇了。'}])
 assert.equal((await x.post('/life-action-result',{grant:grant.grant,uid:UID,ok:true,receiptId:'123456789012'})).code,409)
})
test('dev16 missing or malformed platform rpid does not query and remains unverified',async t=>{
 let called=0
 const x=make(t,async()=>{called++;return true});await x.bridge.start()
 for(const receiptId of ['', '0','1e10','-5','wrong']){
  const ticket=x.registerComment('原评论')
  assert.equal(ticket.ok,true)
  const g=await x.post('/life-action',{tool:'bili_reply',target:BV,uid:UID,commentText:'原评论',topLevel:true,intentTicket:ticket.ticket})
  const r=await x.post('/life-action-result',{grant:g.grant,uid:UID,ok:true,receiptId})
  assert.equal(r.status,'accepted-unverified')
 }
 assert.equal(called,0)
})
test('dev16 only top-level video comments with exact short-lived text are eligible',async t=>{
 const x=make(t,async()=>true);await x.bridge.start()
 for(const change of [{topLevel:false},{commentText:''},{commentText:'x'.repeat(2001)},{commentText:123}]){
  const r=await x.post('/life-action',{tool:'bili_reply',target:BV,uid:UID,commentText:'hello',topLevel:true,...change})
  assert.equal(r.code,400)
 }
})
test('dev16 stale account or unknown read result never promote comment',async t=>{
 let release
 const wait=new Promise(ok=>release=ok)
 const x=make(t,async()=>{await wait;return true});await x.bridge.start()
 const g=await x.post('/life-action',{tool:'bili_reply',target:BV,uid:UID,commentText:'文字',topLevel:true})
 const result=x.post('/life-action-result',{grant:g.grant,uid:UID,ok:true,receiptId:'12345678'})
 await new Promise(ok=>setTimeout(ok,12));x.setScope('b'.repeat(16));release()
 assert.notEqual((await result).status,'verified')
 assert.ok(x.results.every(x=>x[1]!=='verified'))
})
test('dev16 evidence stays in ledger while owner diary uses ordinary action wording',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev16-action-evidence-'))
 try{
  let n=1700000000000
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>TAG,now:()=>n})
  assert.equal(events.recordVerifiedCompletion({kind:'video_comment',sourceRef:'1'.repeat(16)}).created,true)
  n+=1000
  assert.equal(events.recordVerifiedCompletion({kind:'dm_reply',sourceRef:'2'.repeat(16)}).created,true)
  assert.equal(events.recordVerifiedCompletion({kind:'video_comment',sourceRef:'1'.repeat(16)}).created,false)
  const timeline=events.status().timeline
  assert.equal(timeline[1].verifiedEvidence,'platform-read-after-write')
  assert.equal(timeline[0].verifiedEvidence,'platform-transaction-receipt')
  const rows=buildLifeTimeline({lifeDecisions:timeline,now:n+100,days:2})
  assert.ok(rows.some(x=>x.type==='life-write'&&x.title==='在视频下留了言'))
  assert.ok(rows.some(x=>x.type==='life-write'&&x.title==='回复了一条私信'))
  assert.ok(rows.every(x=>!/(平台|回执|已核验|事务|只读回查)/.test(x.title+' '+x.detail)))
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('comment writer without a Life intent ticket is denied before any platform call',async t=>{
 const x=make(t,async()=>true);await x.bridge.start()
 const response=await x.post('/life-action',{tool:'bili_reply',target:BV,uid:UID,commentText:'未获批准的草稿',topLevel:true})
 assert.equal(response.code,409)
 assert.equal(response.reason,'comment-review-not-current')
 assert.deepEqual(x.results,[])
})
