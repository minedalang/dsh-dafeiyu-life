import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'

const ME='999',OWNER='221',T=1_800_000_000_000
const message=(n,t=T-200000)=>({senderUid:OWNER,messageId:`m${n}`,timestampMs:t,text:'test',incoming:true})
const config=()=>({enabled:true,ownerUid:OWNER,whitelist:[OWNER],whitelistCooldownSeconds:0,p6Enabled:true,p6MaxBubbles:3})
const work=t=>{const dir=mkdtempSync(join(tmpdir(),'dm-approved-unsettled-'));t.after(()=>rmSync(dir,{force:true,recursive:true}));return dir}
const state=d=>JSON.parse(readFileSync(join(d,'dm-autoreply-state.json'),'utf8'))

async function simulate(t,{probe,reply=['choice'],beforeSend,readFailure=false}={}){
 const d=work(t),old=message(1),proof={id:'trusted-life-proof'},settlements=[],sends=[];
 let arrived=[];
 const engine=createDmAutoReply({dataDir:d,now:()=>T,selfUid:ME,getConfig:config,
  fetchIncoming:async o=>o?.probeOnly?(readFailure?Promise.reject(Error('platform-probe-unavailable')):probe||[old]):arrived,
  generateReply:async()=>({action:'reply',messages:reply,topicState:'open',lifeWillingnessProof:proof}),
  onUnsentLifeDecision:async p=>{assert.equal(p,proof);settlements.push('not-sent');return {ok:true}},
  send:async ({text})=>{sends.push(text);return {ok:true,receiptId:'1234'}},logger:{warn(){},error(){}}});
 await engine.poll();arrived=[old];
 if(beforeSend)await beforeSend();
 const result=await engine.poll();
 return {result,settlements,sends,db:state(d)}
}

test('real fresh DM supersedes an approved choice: no send and proof settled once',async t=>{
 const r=await simulate(t,{probe:[message(1),message(2,T+1000)]});
 assert.deepEqual(r.settlements,['not-sent']);assert.deepEqual(r.sends,[])
 assert.equal(r.db.p6LastTurn.status,'superseded')
})

test('read failure before any platform write releases only unused approved Life claim',async t=>{
 const r=await simulate(t,{readFailure:true});
 assert.deepEqual(r.settlements,['not-sent']);assert.deepEqual(r.sends,[])
 assert.equal(r.db.p6LastTurn.status,'technical-deferred')
})

test('no new messages: a confirmed reply does NOT release the proof through the abandonment path',async t=>{
 const r=await simulate(t,{probe:[message(1)]});
 assert.deepEqual(r.settlements,[]);assert.deepEqual(r.sends,['choice']);assert.equal(r.result.sent,1)
})

test('unsafe outgoing draft fails locally without leaking sealed Life approval',async t=>{
 const r=await simulate(t,{reply:['@an-unverified-mention hello']});
 assert.deepEqual(r.settlements,['not-sent']);assert.deepEqual(r.sends,[])
})

test('technical backlog is not fresh activity: ordinary DM adaptive idle interval can grow',async()=>{
 let clock=T,n=0,fresh=0;
 const scheduler=createInteractionScheduler({dataDir:'',getConfig:()=>({masterEnabled:true,dmWatch:true,dmWatchMinutes:2,dmQuietMaxMinutes:15,
   commentWatchReplies:false,commentAtEnabled:false,dmActivePollEnabled:false}),
  now:()=>clock,dm:{poll:async()=>{n++;return {ok:true,conversations:1,deferred:3,freshIncomingContacts:fresh}},status:()=>({fast:{}})},
  comments:{poll:async()=>({ok:true})},readBudget:{status:()=>({byKind:[],blocked:false})}});
 scheduler.start();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(n,1);assert.equal(scheduler.status().dmAdaptive.intervalMinutes,2)
 clock+=16*60_000;
 assert.equal(scheduler.status().dmAdaptive.intervalMinutes,5)
 await scheduler.tick();assert.equal(n,2)
 fresh=1;clock+=6*60_000;await scheduler.tick()
 assert.equal(n,3);assert.equal(scheduler.status().dmAdaptive.intervalMinutes,2)
 scheduler.stop()
})

test('real cross-channel Life approval is released by the DM pre-send no-write exit',async t=>{
 const {createLifeWillingness}=await import('../lib/life-willingness.mjs')
 const d=work(t),account='a'.repeat(16),old=message(1),newMsg=message(2,T+1000)
 const life=createLifeWillingness({dataDir:d,getAccountTag:()=>account,
  getContext:()=>({voice:'test',world:{}}),invokeModel:async()=> '{}',now:()=>T})
 let inbound=[];const sends=[]
 const engine=createDmAutoReply({dataDir:d,now:()=>T,selfUid:ME,getConfig:config,
  fetchIncoming:async o=>o?.probeOnly?[old,newMsg]:inbound,
  generateReply:async()=>{
   const approved=life.adoptSocialDecision({kind:'dm_reply',uid:OWNER,sourceKey:'dm:owner:m1',messages:['choice']})
   assert.equal(approved.ok,true,approved.reason)
   assert.equal(life.status().admission.held,true)
   return {action:'reply',messages:['choice'],topicState:'open',lifeWillingnessProof:approved.proof}
  },
  onUnsentLifeDecision:p=>life.receipt(p,{status:'not-sent'}),
  send:async ({text})=>{sends.push(text);return {ok:true,receiptId:'x'}},
  logger:{warn(){},error(){}}})
 await engine.poll();inbound=[old];await engine.poll()
 assert.deepEqual(sends,[])
 assert.equal(life.status().admission.held,false)
 const next=life.adoptSocialDecision({kind:'dm_reply',uid:OWNER,sourceKey:'dm:owner:m2',messages:['another']})
 assert.equal(next.ok,true,next.reason)
 assert.equal(life.receipt(next.proof,{status:'not-sent'}).ok,true)
})
