import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';
import {composeSocialDecisionContext,validateSocialActionProposal} from '../lib/social-autonomy-contract.mjs';
import {createSocialContinuityLedger} from '../lib/social-continuity-ledger.mjs';
const T=1_900_000_000_000;
const message=(uid,id,text)=>({senderUid:uid,messageId:id,text,timestampMs:T,incoming:true});
const context=(channel='dm',trigger='incoming')=>composeSocialDecisionContext({channel,actorUid:'200',threadKey:'dm:200',trigger,lifeVoiceContext:'Life Voice authoritative'});
const proposal={action:'reply',messages:['我觉得这个话题还挺有意思'],idleReconsiderMinutes:5,idleReconsiderReason:'open-conversation'};

test('idle reconsideration is DM-only, incoming-turn-only, bounded and cannot also schedule a supplement',()=>{
 assert.equal(validateSocialActionProposal(proposal,context()).idleReconsiderMinutes,5);
 assert.equal(validateSocialActionProposal(proposal,context('comment')).reason,'invalid-idle-reconsideration');
 assert.equal(validateSocialActionProposal(proposal,context('at')).reason,'invalid-idle-reconsideration');
 assert.equal(validateSocialActionProposal(proposal,context('dm','scheduled')).reason,'invalid-idle-reconsideration');
 assert.equal(validateSocialActionProposal({...proposal,idleReconsiderReason:'none'},context()).reason,'invalid-idle-reconsideration');
 assert.equal(validateSocialActionProposal({...proposal,idleReconsiderMinutes:4},context()).reason,'invalid-idle-reconsideration');
 assert.equal(validateSocialActionProposal({...proposal,followUpMinutes:5},context()).reason,'invalid-idle-reconsideration');
});

test('model output passes through actual InteractionBatcher with one Life Voice source and explicit idle intent',async()=>{
 let captured='';const batcher=createInteractionBatcher({invoke:async p=>{captured=p;return JSON.stringify({items:[{id:'0',...proposal,reply:'',mood:'neutral',intensity:0}]})},
 getPersona:()=> 'UniqueLifeVoiceEmotion',delayMs:0,now:()=>T});
 try{
  const r=await batcher.generate({kind:'dm',uid:'200',text:'以后再聊聊这个话题',socialAutonomy:true,threadKey:'dm:200',trigger:'incoming',p6MaxBubbles:3});
  assert.equal(r.action,'reply');assert.equal(r.idleReconsiderMinutes,5);
  assert.equal(captured.split('UniqueLifeVoiceEmotion').length-1,1);
  assert.match(captured,/idleReconsiderMinutes/);
 }finally{batcher.stop()}
});

async function fixture({legacy=false,allow=true}={}){
 const dir=await mkdtemp(join(tmpdir(),'dsh-idle-dm-'));let clock=T,turn=0;
 const inbox=[],sent=[],warns=[];
 const config={enabled:true,whitelist:['200'],p6Enabled:true,whitelistCooldownSeconds:0,
   ...(legacy?{whitelist:[],strangerEnabled:true,legacyStrangerOnce:true}:{} )};
 const agent=createDmAutoReply({dataDir:dir,selfUid:'999',now:()=>clock,getConfig:()=>config,
  canContinue:()=>allow,canSendDm:()=>({allowed:true}),fetchIncoming:async()=>inbox,
  send:async msg=>{sent.push(msg);return {ok:true,receiptId:'key-'+sent.length}},
  generateReply:async req=>{turn++;
   if(req.trigger==='incoming')return {...proposal};
   assert.equal(req.scheduledPurpose,'silence-reconsideration');
   return {action:'reply',messages:['想起我们上次聊的那个话题，还有一点想说。']};
  },logger:{warn:x=>warns.push(x),error:x=>warns.push(x)}});
 return {dir,agent,inbox,sent,config,warns,forward:ms=>{clock+=ms},turns:()=>turn,clock:()=>clock,cleanup:()=>rm(dir,{recursive:true,force:true})};
}

test('a model-chosen open DM can reconsider exactly once after the other party stays silent, with real receipt',async()=>{
 const f=await fixture();try{
  await f.agent.poll();f.inbox.push(message('200','1','这段有趣的话题我们接着聊'));
  assert.equal((await f.agent.poll()).sent,1);
  assert.equal(f.agent.status().p6.counts.scheduled,1);
  assert.equal(f.agent.status().p6.nextAt,T+5*60000);
  assert.deepEqual(Object.keys(f.agent.status().p6).sort(),['accountUid','counts','nextAt','ok','recent']);
  assert.equal((await f.agent.poll()).sent,0,'not due yet');
  f.forward(300001);assert.equal((await f.agent.poll()).sent,1);
  assert.equal(f.sent.length,2);
  assert.equal(f.agent.status().p6.counts.scheduled,0,'no recursive re-scheduling');
  assert.equal(f.agent.status().p6.counts.sent,1);
  assert.equal((await f.agent.poll()).sent,0);
  assert.equal(f.turns(),2);
  const raw=await readFile(join(f.dir,'social-continuity','intentions.json'),'utf8');
  assert.doesNotMatch(raw,/话题|聊天|想起|\.\.\./);
 }finally{await f.cleanup()}
});

test('new verified incoming DM cancels pending idle intent; never posts the old followup',async()=>{
 const f=await fixture();try{
  await f.agent.poll();f.inbox.push(message('200','1','刚才没说完'));await f.agent.poll();
  f.forward(300001);f.inbox.push(message('200','2','我换个话题'));
  assert.equal((await f.agent.poll()).sent,1);
  assert.equal(f.agent.status().p6.counts.cancelled,1);
  assert.equal(f.sent.length,2);
 }finally{await f.cleanup()}
});

test('legacy one-shot stranger mode cannot reserve idle intent or wakeup; boundary veto also prevents schedule',async()=>{
 for(const opts of [{legacy:true},{allow:false}]){
  const f=await fixture(opts);try{
   await f.agent.poll();f.inbox.push(message('200','1','继续聊'));await f.agent.poll();
   assert.equal(f.sent.length,1);
   assert.equal(f.agent.status().p6.counts.scheduled,0);
   f.forward(300001);await f.agent.poll();assert.equal(f.sent.length,1);
  }finally{await f.cleanup()}
 }
});

test('P6 disabled does not reserve idle intent even when the adapter returns it',async()=>{
 const f=await fixture();try{
  f.config.p6Enabled=false;await f.agent.poll();f.inbox.push(message('200','1','继续聊'));await f.agent.poll();
  assert.equal(f.agent.status().p6.counts.scheduled,0);f.forward(300001);await f.agent.poll();assert.equal(f.sent.length,1);
 }finally{await f.cleanup()}
});

test('P6 ledger summary filters DM from comment/at and hides recipient and message contents',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dsh-idle-status-'));
 try{
  const ledger=createSocialContinuityLedger({dataDir:dir,accountUid:'999',now:()=>T});
  ledger.schedule({uid:'200',channel:'comment',threadKey:'x',sourceEventId:'evt1',purpose:'delayed-supplement',notBefore:T+60000,expiresAt:T+86400000});
  const s=ledger.status({channels:['dm']});assert.equal(s.counts.scheduled,0);assert.equal(s.nextAt,null);
  assert.doesNotMatch(JSON.stringify(s),/200|evt1|threadKey|text/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('transient inbox read failure at due time safely retries before any remote send, with a finite limit',async()=>{
 const f=await fixture();let fail=true;let probes=0;
 const a=createDmAutoReply({...{
  dataDir:f.dir,selfUid:'999',getConfig:()=>f.config,
  now:f.clock,canContinue:()=>true,canSendDm:()=>({allowed:true}),
  fetchIncoming:async opts=>{if(opts?.probeOnly){probes++;if(fail)throw Error('temporary read rate limit')}return f.inbox},
  generateReply:async req=>req.trigger==='incoming'?{...proposal}:{action:'reply',messages:['有新的事实再补充']},
  send:async msg=>{f.sent.push(msg);return {ok:true,receiptId:'good-'+f.sent.length}},
  logger:{warn:x=>f.warns.push(x),error:x=>f.warns.push(x)}
 }});
 try{
  await a.poll();f.inbox.push(message('200','1','下次再聊')); // Normal immediate reply also probes the inbox.
  // Initial send requires a successful probe, then introduce the fault only for scheduled reads.
  fail=false;assert.equal((await a.poll()).sent,1);fail=true;
  f.forward(300001);assert.equal((await a.poll()).sent,0);assert.equal(a.status().p6.counts.scheduled,1);
  assert.equal(f.sent.length,1);
  f.forward(300001);assert.equal((await a.poll()).sent,0);assert.equal(a.status().p6.counts.scheduled,1);
  f.forward(300001);assert.equal((await a.poll()).sent,0);assert.equal(a.status().p6.counts.cancelled,1);
  assert.equal(a.status().p6.counts.scheduled,0);assert.equal(probes,4,'initial + three preflight reads');
  f.forward(300001);fail=false;assert.equal((await a.poll()).sent,0,'terminal cancelled intent is never re-sent');
 }finally{await f.cleanup()}
});
