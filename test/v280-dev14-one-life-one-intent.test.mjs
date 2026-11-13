import {symlinkOrSkip} from './test-platform-fixtures.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,symlinkSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeActionRecords} from '../lib/life-action-records.mjs'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {dmContactFollowCandidates,dmFollowAudienceAllowed} from '../lib/life-subagent-continuity.mjs'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {verifyLifeOutbound,lifeFactFromReceipt} from '../lib/verified-life-facts.mjs'
const A='a'.repeat(16),B='b'.repeat(16),T=1_790_000_000_000
const temp=ctx=>{const d=mkdtempSync(join(tmpdir(),'one-life-'));ctx.after(()=>rmSync(d,{recursive:true,force:true}));return d}
test('single Life action record is redacted, account-scoped, terminal and never grants a send',ctx=>{
 const dir=temp(ctx);let account=A,clock=T
 const records=createLifeActionRecords({dataDir:dir,getAccountTag:()=>account,now:()=>clock})
 assert.equal(records.update({decisionId:'decision01',kind:'dm_follow',state:'selected',source:'dm:12345:secret'}).ok,true)
 assert.equal(records.update({decisionId:'decision01',kind:'dm_follow',state:'executing'}).ok,true)
 assert.equal(records.update({decisionId:'decision01',kind:'dm_follow',state:'verified',receiptId:'platform-follow:12345'}).ok,true)
 assert.equal(records.update({decisionId:'decision01',kind:'dm_follow',state:'selected'}).ok,false)
 assert.equal(records.list().rows[0].state,'verified')
 assert.equal(records.list().rows[0].hasVerifiedReceipt,true)
 const disk=readFileSync(join(dir,'life-action-records.json'),'utf8')
 assert.doesNotMatch(disk,/12345|secret|platform-follow|decision01|aaaaaaaa/)
 account=B;assert.equal(records.list().rows.length,0)
 assert.equal(records.update({decisionId:'other-dec',kind:'dm_reply',state:'uncertain'}).ok,true)
 assert.equal(records.list().rows.length,1)
 account=A;assert.equal(records.list().rows.length,1)
})
test('action records fail closed on symlink and do not overwrite target',ctx=>{
 const dir=temp(ctx),target=join(dir,'dont-touch.txt');writeFileSync(target,'unchanged')
 if (!symlinkOrSkip(ctx,target,join(dir,'life-action-records.json'))) return
 const r=createLifeActionRecords({dataDir:dir,getAccountTag:()=>A,now:()=>T})
 assert.equal(r.update({decisionId:'decision01',kind:'dm_reply',state:'selected'}).ok,false)
 assert.equal(readFileSync(target,'utf8'),'unchanged')
})
test('willingness proof is the only permission source; journal is an audit projection',async ctx=>{
 const dir=temp(ctx);let modelCalls=0
 const records=createLifeActionRecords({dataDir:dir,getAccountTag:()=>A,now:()=>T})
 const will=createLifeWillingness({dataDir:dir,getAccountTag:()=>A,now:()=>T,
   getContext:()=>({voice:'同一个鱼鱼'}),invokeModel:async()=>{modelCalls++;throw Error('second vote')},
   onActionState:record=>records.update(record)})
 const selection=await will.adoptSocialDecisionQueued({kind:'dm_follow',uid:'12345',sourceKey:'dm:12345:event',messages:[]})
 assert.equal(selection.ok,true)
 assert.equal(records.list().rows[0].state,'selected')
 assert.equal(will.verify(selection.proof,'dm_follow',{uid:'999'}).ok,false)
 assert.equal(records.list().rows[0].state,'selected')
 assert.equal(will.verify(selection.proof,'dm_follow',{uid:'12345'}).ok,true)
 assert.equal(records.list().rows[0].state,'executing')
 assert.equal(will.receipt(selection.proof,{status:'uncertain'}).ok,true)
 assert.equal(records.list().rows[0].state,'uncertain')
 assert.equal(modelCalls,0)
 // Status is informational, not a repeatable tool permission.
 assert.equal(will.verify(selection.proof,'dm_follow',{uid:'12345'}).ok,false)
})
test('stranger incoming DM offers follow consideration without friend-count formula',()=>{
 const data={enabled:true,uid:'12345',role:'stranger',history:[],incomingText:'互关！',verifiedIncoming:true,now:T}
 assert.equal(dmContactFollowCandidates(data).length,1)
 assert.deepEqual(dmContactFollowCandidates({...data,verifiedIncoming:false}),[])
 assert.deepEqual(dmContactFollowCandidates({...data,optedOut:true}),[])
 assert.deepEqual(dmContactFollowCandidates({...data,enabled:false}),[])
 assert.deepEqual(dmContactFollowCandidates({...data,uid:'999999999999999999999'}),[])
})
test('silence can coexist with a separately selected, delayed follow; it never auto-sends',async ctx=>{
 const dir=temp(ctx),inbox=[],sent=[],follows=[];let clock=T
 const make=()=>createDmAutoReply({dataDir:dir,now:()=>clock,selfUid:'90000',
  getConfig:()=>({enabled:true,whitelist:['12345'],whitelistCooldownSeconds:0,p6Enabled:false}),
  fetchIncoming:async()=>inbox,generateReply:async()=>({action:'skip',messages:[],nextAction:{action:'follow_dm_contact',reason:'我想基于这次真实交流关注对方'}}),
  send:async x=>{sent.push(x);return {ok:true,receiptId:'send-id'}},
  onVerifiedReply:async row=>{follows.push(row);return {ok:true}},logger:{warn(){},error(){}}})
 await make().poll() // trusted baseline
 inbox.push({incoming:true,senderUid:'12345',messageId:'real-msg',timestampMs:T,text:'互关？'})
 await make().poll()
 assert.equal(sent.length,0,'voluntary silence must not generate a DM reply')
 let state=JSON.parse(readFileSync(join(dir,'dm-autoreply-state.json'),'utf8'))
 assert.equal(state.people['12345'].pendingLifeAction.status,'pending')
 clock+=76_000;await make().poll()
 assert.equal(follows.length,1)
 assert.equal(follows[0].singleIntentVerified,true)
 assert.equal(sent.length,0)
 clock+=120_000;await make().poll();assert.equal(follows.length,1)
})
test('a completed mutual-follow claim requires real target-bound evidence, not a model proposal',()=>{
 const args={channel:'dm',uid:'12345',at:T,events:[]}
 const phrase='耶，互关快乐！'
 assert.equal(verifyLifeOutbound(phrase,args).code,'unverified-social-follow')
 assert.equal(verifyLifeOutbound('可以考虑关注呀',args).ok,true)
 assert.equal(verifyLifeOutbound('我们还没互关呢',args).ok,true)
 const fact=lifeFactFromReceipt({type:'creator_follow_verified',operation:'platform-creator-follow-receipt',
  ok:true,uid:'12345',scope:'recipient-private',channel:'dm',at:T,sourceId:'confirmed-123',targetUid:'12345'})
 assert.equal(verifyLifeOutbound(phrase,{...args,events:[fact]}).ok,true)
 assert.equal(verifyLifeOutbound(phrase,{...args,uid:'99999',events:[fact]}).ok,false)
})
test('DM selected follow is visible as one queued action, not silently lost when fish chooses silence',async ctx=>{
 const dir=temp(ctx),inbox=[],rows=[];let clock=T
 const journal=createLifeActionRecords({dataDir:dir,getAccountTag:()=>A,now:()=>clock})
 const make=()=>createDmAutoReply({dataDir:dir,now:()=>clock,selfUid:'90000',
  getConfig:()=>({enabled:true,whitelist:['12345'],whitelistCooldownSeconds:0,p6Enabled:false}),
  fetchIncoming:async()=>inbox,generateReply:async()=>({action:'skip',messages:[],nextAction:{action:'follow_dm_contact',reason:'此次真实交流让我想关注对方'}}),
  send:async()=>{throw Error('silent fish must not send')},
  onPendingAction:event=>journal.update(event),
  onVerifiedReply:async()=>({ok:true}),logger:{warn(){},error(){}}})
 await make().poll()
 inbox.push({incoming:true,senderUid:'12345',messageId:'one-event',timestampMs:T,text:'互关吗'})
 await make().poll()
 assert.equal(journal.list().rows.length,1)
 assert.equal(journal.list().rows[0].state,'queued')
 assert.equal(journal.list().rows[0].reviewRequired,true)
 assert.doesNotMatch(readFileSync(join(dir,'life-action-records.json'),'utf8'),/12345|one-event/)
 clock+=76_000;await make().poll()
 assert.equal(journal.list().rows.length,1,'one source creates one action record')
 assert.equal(journal.list().rows[0].state,'verified')
})

test('one DM model call can select silence and an independent real-source follow action',async()=>{
 let calls=0
 const batcher=createInteractionBatcher({delayMs:0,getPersona:()=> '同一条鱼的 Life Voice',invoke:async()=>{
  calls++;return JSON.stringify({items:[{id:'0',action:'skip',reply:'',nextAction:{action:'follow_dm_contact',reason:'真实交流后我想主动认识对方'},mood:'curious',intensity:1}]})
 }})
 try{
  const menu=dmContactFollowCandidates({enabled:true,uid:'12345',role:'stranger',verifiedIncoming:true,incomingText:'互关！'})
  const result=await batcher.generate({kind:'dm',uid:'12345',role:'stranger',socialAutonomy:true,trigger:'incoming',messageId:'inbound-id-1',text:'互关！',availableLifeActions:menu})
  assert.equal(result.action,'skip')
  assert.equal(result.nextAction?.action,'follow_dm_contact')
  assert.equal(calls,1,'no additional Life model vote for a selected follow action')
 }finally{batcher.stop()}
})

test('historical follow permissions remain friend-only until owner explicitly broadens target scope',()=>{
 assert.equal(dmFollowAudienceAllowed('friend','trusted'),true)
 assert.equal(dmFollowAudienceAllowed('stranger','trusted'),false)
 assert.equal(dmFollowAudienceAllowed('stranger','verified-incoming'),true)
 assert.equal(dmFollowAudienceAllowed('owner','verified-incoming'),false)
 assert.equal(dmFollowAudienceAllowed('blocked','verified-incoming'),false)
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(html,/id="bili-dm-follow-audience"/)
 assert.match(host,/dmFollowAudienceAllowed\(socialPolicyGate\.actor\(uid\)\.role,cfg\.dmFollowAudience\)/)
 assert.match(host,/dmFollowAudience: z\.string\(\)\.default\('trusted'\)/)
})
