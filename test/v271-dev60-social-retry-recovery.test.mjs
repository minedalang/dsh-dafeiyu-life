import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommentInteract} from '../lib/comment-interact.mjs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';
import {createSocialContinuityLedger} from '../lib/social-continuity-ledger.mjs';
const DAY=86_400_000,T=Date.parse('2026-11-11T00:00:00Z'),quiet={warn(){},error(){}};
async function workspace(fn){const dir=await mkdtemp(join(tmpdir(),'dsh-dev60-social-retry-'));try{return await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}}
const notice=(id,t=T)=>({user:{mid:123,uname:'viewer'},item:{business:'评论',business_id:1,subject_id:987654321,source_id:String(id),root_id:777,target_id:777,source_content:'鱼还在吗',target_reply_content:'我先前的留言',timestamp:Math.floor(t/1000)}});
const localState=(dir,fn)=>readFile(join(dir,fn),'utf8').then(JSON.parse);
const makeComment=(dir,opts={})=>createCommentInteract({dataDir:dir,logger:quiet,now:opts.now,selfUid:()=> '900',getConfig:()=>({watchReplies:true,watchTop:false,watchAt:false,replyPerPoll:5,replyPerDay:50,globalDailyLimit:100,diagReplyInboxEnabled:true}),
 getOwnComments:async()=>({top:new Set(['777']),nested:new Set()}),getNotifications:async()=>({data:{items:opts.items}}),getVideos:async()=>[],getVideoContext:async()=>({usable:true,text:'核实的视频描述'}),getComments:async()=>({comments:[]}),
 socialTier:()=> 'stranger',generateReply:opts.generateReply,send:async()=>{throw Error('不得在未授权测试中发送')}});
test('陌生人24h预算满只延期，不写 seen；到期恢复后只调用一次 Life 模型',()=>workspace(async dir=>{
 let t=T,items=[],calls=0;
 const x=makeComment(dir,{items,now:()=>t,generateReply:async()=>{calls++;return 'SKIP'}});
 await x.poll();
 const state=await localState(dir,'comment-interact-state.json');state.strangerAttempts={'123':[T-DAY+60*60000,T-DAY+61*60000]};await writeFile(join(dir,'comment-interact-state.json'),JSON.stringify(state));
 items.push(notice(200001));await x.poll();let next=await localState(dir,'comment-interact-state.json');
 assert.equal(calls,0);assert.equal(next.seen['comment:200001'],undefined);assert.ok(next.preflightDefers['comment:200001']>T);
 assert.equal(x.status().deferredStrangerBudgetCount,1);assert.equal(x.status().replyDiagnostics[0].reason,'stranger_budget_deferred');
 t+=30*60000;await x.poll();assert.equal(calls,0);
 t+=31*60000;await x.poll();assert.equal(calls,1);
 next=await localState(dir,'comment-interact-state.json');assert.equal(next.seen['comment:200001'],'skipped');
}));
test('模型429只延期而不扣陌生人尝试额度，下一次有效模型决策才计数',()=>workspace(async dir=>{
 let t=T,items=[],calls=0;const x=makeComment(dir,{items,now:()=>t,generateReply:async()=>{calls++;if(calls===1)throw Error('429 All providers are saturated');return 'SKIP'}});
 await x.poll();items.push(notice(200002));await x.poll();let state=await localState(dir,'comment-interact-state.json');
 assert.equal(calls,1);assert.equal(state.strangerAttempts?.['123']?.length||0,0);
 assert.equal(state.seen['comment:200002'],undefined);assert.ok(state.preflightDefers['comment:200002']>=T+15*60_000);
 await x.poll();assert.equal(calls,1);
 t+=15*60_000+1000;await x.poll();assert.equal(calls,2);
 state=await localState(dir,'comment-interact-state.json');assert.equal(state.strangerAttempts['123'].length,1);assert.equal(state.seen['comment:200002'],'skipped');
}));
test('升级不自动清除历史 stranger-budget seen，确保不突然对旧通知外发',()=>workspace(async dir=>{
 let items=[],calls=0;const x=makeComment(dir,{items,now:()=>T,generateReply:async()=>{calls++;return 'SKIP'}});
 await x.poll();const db=await localState(dir,'comment-interact-state.json');db.seen['comment:200003']='stranger-budget';await writeFile(join(dir,'comment-interact-state.json'),JSON.stringify(db));
 items.push(notice(200003));await x.poll();assert.equal(calls,0);assert.equal(x.status().legacyStrangerBudgetCount,1);
}));
const dmMessage=(t)=>({senderUid:'200',messageId:'source-message-one',timestampMs:t,text:'有什么新鲜事吗？',incoming:true});
test('私信延期遇模型429不等于 Life 沉默，保留同一个续行任务有界重试',()=>workspace(async dir=>{
 let t=T,items=[],calls=0,sends=0;
 const x=createDmAutoReply({dataDir:dir,now:()=>t,selfUid:'900',logger:quiet,getConfig:()=>({enabled:true,whitelist:['200'],p6Enabled:true,delayMinMinutes:5,delayMaxMinutes:360,historyLimit:30}),
  fetchIncoming:async()=>items,generateReply:async()=>{calls++;if(calls===1)return {action:'defer',notBefore:t+5*60000};if(calls===2)throw Error('HTTP 429 All providers are saturated');return {action:'skip',messages:[]}},
  send:async()=>{sends++;return {ok:true,receiptId:'should-not-send'}}});
 await x.poll();items.push(dmMessage(T));await x.poll();assert.equal(calls,1);
 let state=await localState(dir,'dm-autoreply-state.json');assert.equal(state.people['200'].seen.length,1);assert.equal(state.people['200'].lastRepliedAt,0);
 t+=5*60000+1000;await x.poll();assert.equal(calls,2);assert.equal(sends,0);
 const ledger=createSocialContinuityLedger({dataDir:dir,accountUid:'900',now:()=>t});
 assert.equal(ledger.status().counts.scheduled,1);assert.equal(ledger.status().counts.skipped,0);assert.equal(ledger.status().nextAt,t+15*60000);
 const saved=await localState(dir,'social-continuity/intentions.json');assert.equal(saved.entries[0].lastPreflightFailure,'model-unavailable');
 t+=5*60000;await x.poll();assert.equal(calls,2);
 t+=10*60000;await x.poll();assert.equal(calls,3);assert.equal(ledger.status().counts.skipped,1);assert.equal(sends,0);
}));
test('私信延期模型持续故障：最多两次安全延期，最后明确 failed 而非 skipped 或重复发送',()=>workspace(async dir=>{
 let t=T,items=[],calls=0,sends=0;
 const x=createDmAutoReply({dataDir:dir,now:()=>t,selfUid:'900',logger:quiet,getConfig:()=>({enabled:true,whitelist:['200'],p6Enabled:true,delayMinMinutes:5,delayMaxMinutes:360}),
  fetchIncoming:async()=>items,generateReply:async()=>{calls++;if(calls===1)return {action:'defer',notBefore:t+5*60000};throw Error('429 providers saturated')},
  send:async()=>{sends++;return {ok:true,receiptId:'never'}}});
 await x.poll();items.push(dmMessage(T));await x.poll();t+=5*60000;await x.poll();t+=15*60000;await x.poll();t+=15*60000;await x.poll();
 const ledger=createSocialContinuityLedger({dataDir:dir,accountUid:'900',now:()=>t});
 assert.equal(ledger.status().counts.failed,1);assert.equal(ledger.status().counts.skipped,0);assert.equal(calls,4);assert.equal(sends,0);
 await x.poll();assert.equal(calls,4);
}));
