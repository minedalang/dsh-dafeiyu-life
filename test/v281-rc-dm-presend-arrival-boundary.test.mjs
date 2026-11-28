import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
import {createDmLifeInbox} from '../lib/dm-life-inbox.mjs'

const OWNER='221', ME='999', T=1800000000000
const msg=(n,at)=>({senderUid:OWNER,messageId:`${OWNER}:m${n}`,
  timestampMs:at,text:`Synthetic DM ${n}`,incoming:true})
const dirFor=t=>{const d=mkdtempSync(join(tmpdir(),'dsh-presend-arrival-'));t.after(()=>rmSync(d,{recursive:true,force:true}));return d}
const state=d=>JSON.parse(readFileSync(join(d,'dm-autoreply-state.json'),'utf8'))
const inbox=d=>JSON.parse(readFileSync(join(d,'dm-life-inbox.json'),'utf8'))
const conf=()=>({enabled:true,whitelist:[OWNER],ownerUid:OWNER,whitelistCooldownSeconds:0,
  p6Enabled:true,p6MaxBubbles:3,historyLimit:15})

// The 18:22 incident: multiple older, *unseen* messages are still in the Life
// ledger. The model replied to due messages, but the old read-back messages
// incorrectly looked "new" when the check used `!person.seen`.
test('six old messages: three review-required and three due technical-deferred do NOT cancel two confirmed reply bubbles',async t=>{
 const d=dirFor(t),old=Array.from({length:6},(_,i)=>msg(i+1,T-3*3600000+i*60000));
 let now=T,normal=[],sent=[];
 const createEngine=()=>createDmAutoReply({dataDir:d,selfUid:ME,now:()=>now,getConfig:conf,
  fetchIncoming:async options=>options?.probeOnly?old:normal,
  generateReply:async()=>({action:'reply',messages:['reply 1','reply 2'],topicState:'open'}),
  send:async ({text})=>{sent.push(text);return {ok:true,receiptId:`receipt-${sent.length}`}},
  logger:{warn(){},error(){}}});
 let e=createEngine();
 await e.poll(); // baseline existing empty inbox; never auto-reply to installed history
 const ledger=createDmLifeInbox({dataDir:d,now:()=>now});
 ledger.observe(old.map(m=>({uid:OWNER,id:m.messageId,time:m.timestampMs})));
 old.slice(0,3).forEach(m=>ledger.review(OWNER,m.messageId));
 old.slice(3).forEach(m=>ledger.defer(OWNER,m.messageId,{delay:90000}));
 now+=91000;
 e=createEngine(); // simulate restart so the true persisted Life ledger is reloaded
 normal=old.slice(3); // three due, older three still visible on remote preflight
 const result=await e.poll();
 assert.equal(result.sent,2);assert.equal(result.failed,0);
 assert.deepEqual(sent,['reply 1','reply 2']);
 assert.equal(state(d).people[OWNER].lastInboundOutcome.status,'delivered');
 assert.equal(state(d).p6LastTurn.status,'confirmed');
 assert.equal(inbox(d).rows.filter(x=>x.status==='review-required').length,3,
  'human-review messages must NOT be silently released or marked sent');
 assert.equal(inbox(d).rows.filter(x=>x.status==='technical-deferred').length,0);
});

test('an actual new message arriving during model generation blocks BEFORE the first platform send',async t=>{
 const d=dirFor(t);let now=T,normal=[],probe=[],sends=0;
 const old=msg(1,T-2*3600000);
 const e=createDmAutoReply({dataDir:d,selfUid:ME,now:()=>now,getConfig:conf,
  fetchIncoming:async options=>options?.probeOnly?probe:normal,
  generateReply:async()=>{probe=[old,msg(2,T+1000)];now+=1200;
   return {action:'reply',messages:['stale reply'],topicState:'open'}},
  send:async()=>{sends++;return {ok:true,receiptId:'should-not-send'}},logger:{warn(){},error(){}}});
 await e.poll();normal=[old];
 const result=await e.poll();
 assert.equal(result.sent,0);assert.equal(result.deferred,1);assert.equal(sends,0);
 assert.equal(state(d).people[OWNER].lastInboundOutcome.status,'pre-send-superseded');
 assert.equal(state(d).people[OWNER].lastInboundOutcome.reason,'new-message-arrived');
 assert.equal(state(d).p6LastTurn.status,'superseded');
 assert.equal(state(d).p6LastTurn.confirmed,0);
 assert.equal(inbox(d).rows[0].status,'technical-deferred');
 assert.deepEqual(state(d).people[OWNER].seen,[]);
});

test('same-second newly arrived message without a known ID is conservatively treated as new',async t=>{
 const d=dirFor(t);let now=T+400,normal=[],sends=0;
 const old=msg(1,T-3600000);
 const e=createDmAutoReply({dataDir:d,selfUid:ME,now:()=>now,getConfig:conf,
  fetchIncoming:async options=>options?.probeOnly?[old,msg(2,T)]:normal,
  generateReply:async()=>({action:'reply',messages:['stale'],topicState:'open'}),
  send:async()=>{sends++;return {ok:true}},logger:{warn(){},error(){}}});
 await e.poll();normal=[old];const result=await e.poll();
 assert.equal(sends,0);assert.equal(result.deferred,1);
});

test('new message arrives after first confirmed bubble: second bubble is stopped, first receipt stays confirmed',async t=>{
 const d=dirFor(t);let now=T,normal=[],sends=[];
 const old=msg(1,T-3600000),newMsg=msg(2,T+2000);
 const e=createDmAutoReply({dataDir:d,selfUid:ME,now:()=>now,getConfig:conf,
  fetchIncoming:async options=>options?.probeOnly?(sends.length?[old,newMsg]:[old]):normal,
  generateReply:async()=>({action:'reply',messages:['first','second'],topicState:'open'}),
  send:async({text})=>{sends.push(text);return {ok:true,receiptId:`receipt-${sends.length}`}},
  logger:{warn(){},error(){}}});
 await e.poll();normal=[old];const result=await e.poll();
 assert.equal(sends.length,1,'no second stale bubble');assert.equal(result.sent,1);
 assert.equal(state(d).people[OWNER].lastInboundOutcome.status,'delivered');
 assert.equal(state(d).p6LastTurn.confirmed,1);
});

test('incomplete pre-send snapshot is a technical read failure, not permission to send',async t=>{
 const d=dirFor(t);let now=T,normal=[],sends=0;
 const old=msg(1,T-3600000);
 const e=createDmAutoReply({dataDir:d,selfUid:ME,now:()=>now,getConfig:conf,
  fetchIncoming:async options=>options?.probeOnly?undefined:normal,
  generateReply:async()=>({action:'reply',messages:['not sent'],topicState:'open'}),
  send:async()=>{sends++;return {ok:true}},logger:{warn(){},error(){}}});
 await e.poll();normal=[old];const result=await e.poll();
 assert.equal(sends,0);assert.equal(result.failed,1);
 assert.equal(state(d).people[OWNER].lastInboundOutcome.status,'pre-send-read-blocked');
 assert.equal(state(d).p6LastTurn.status,'technical-deferred');
 assert.equal(inbox(d).rows[0].status,'technical-deferred');
});

test('dev40 observation DM uses one verified bubble and never stores the internal marker in history',async t=>{
 const d=dirFor(t);let normal=[],sends=0;const incoming=msg(1,T-1000),digest='a'.repeat(64),marker=`[observation-image:${digest}]`,descriptor={id:'b'.repeat(32),file:'storyboard-01.jpg',digest};let live=true,confirmed=[]
 const e=createDmAutoReply({dataDir:d,selfUid:ME,now:()=>T,getConfig:conf,fetchIncoming:async()=>normal,
  generateReply:async()=>({action:'reply',messages:[marker],topicState:'settled',observationShare:descriptor,validateRevisit:()=>live}),
  send:async({text,observationShare})=>{sends++;assert.equal(text,marker);assert.deepEqual(observationShare,descriptor);return {ok:true,receiptId:'12345'}},onConfirmedMessage:async row=>confirmed.push(row.text),logger:{warn(){},error(){}}})
 await e.poll();normal=[incoming];const r=await e.poll();assert.equal(r.sent,1);assert.equal(sends,1);assert.deepEqual(confirmed,['[已核验投递一张视频观察图片]']);assert.doesNotMatch(JSON.stringify(state(d).people[OWNER].history),/observation-image:/)
})

test('dev40 ordinary reply cannot impersonate an observation attachment',async t=>{
 const d=dirFor(t);let normal=[],sends=0;const e=createDmAutoReply({dataDir:d,selfUid:ME,now:()=>T,getConfig:conf,fetchIncoming:async()=>normal,
  generateReply:async()=>({action:'reply',messages:[`[observation-image:${'a'.repeat(64)}]`]}),send:async()=>{sends++;return {ok:true}},logger:{warn(){},error(){}}})
 await e.poll();normal=[msg(1,T-1000)];await e.poll();assert.equal(sends,0)
})


test('ordinary recalled evidence reaches the transport adapter; forget after first verified bubble stops second',async t=>{
 const d=dirFor(t);let normal=[],live=true;const sent=[];const old=msg(1,T-3600000)
 const e=createDmAutoReply({dataDir:d,selfUid:ME,now:()=>T,getConfig:conf,
  fetchIncoming:async options=>options?.probeOnly?[old]:normal,
  generateReply:async()=>({action:'reply',messages:['first','second'],topicState:'open',validateRevisit:()=>live}),
  send:async({text,validateRevisit})=>{assert.equal(typeof validateRevisit,'function');assert.equal(validateRevisit(),true);sent.push(text);live=false;assert.equal(validateRevisit(),false);return {ok:true,receiptId:'receipt-first'}},logger:{warn(){},error(){}}})
 await e.poll();normal=[old];const result=await e.poll();assert.deepEqual(sent,['first']);assert.equal(result.sent,1);assert.equal(state(d).p6LastTurn.confirmed,1)
})


test('trusted host recall refusal before reservation releases unread work without inventing a remote attempt',async t=>{
 const d=dirFor(t);let normal=[],sends=0;const old=msg(1,T-3600000)
 const e=createDmAutoReply({dataDir:d,selfUid:ME,now:()=>T,getConfig:conf,
  fetchIncoming:async options=>options?.probeOnly?[old]:normal,
  generateReply:async()=>({action:'reply',messages:['draft'],validateRevisit:()=>true}),
  send:async()=>{sends++;return {ok:false,notAttempted:true,reason:'video-recall-evidence-changed'}},logger:{warn(){},error(){}}})
 await e.poll();normal=[old];const result=await e.poll();assert.equal(sends,1);assert.equal(result.sent,0);assert.equal(state(d).people[OWNER].lastInboundOutcome.status,'send-blocked');assert.deepEqual(state(d).people[OWNER].seen,[])
})
