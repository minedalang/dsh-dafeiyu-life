import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommentInteract} from '../lib/comment-interact.mjs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';
const DAY=86_400_000,T=Date.parse('2026-11-11T00:00:00Z'),quiet={warn(){},error(){}};
async function workspace(fn){const dir=await mkdtemp(join(tmpdir(),'dsh-dev60-social-retry-'));try{return await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}}
const notice=(id,t=T)=>({user:{mid:123,uname:'viewer'},item:{business:'评论',business_id:1,subject_id:987654321,source_id:String(id),root_id:777,target_id:777,source_content:'鱼还在吗',target_reply_content:'我先前的留言',timestamp:Math.floor(t/1000)}});
const localState=(dir,fn)=>readFile(join(dir,fn),'utf8').then(JSON.parse);
const makeComment=(dir,opts={})=>createCommentInteract({dataDir:dir,logger:quiet,now:opts.now,selfUid:()=> '900',getConfig:()=>({watchReplies:true,watchTop:false,watchAt:false,replyPerPoll:5,replyPerDay:50,globalDailyLimit:100,diagReplyInboxEnabled:true}),
 getOwnComments:async()=>({top:new Set(['777']),nested:new Set()}),getNotifications:async()=>({data:{items:opts.items}}),getVideos:async()=>[],getVideoContext:async()=>({usable:true,text:'核实的视频描述'}),getComments:async()=>({comments:[]}),
 socialTier:()=> 'stranger',generateReply:opts.generateReply,send:async()=>{throw Error('不得在未授权测试中发送')}});
test('旧陌生人24h计数不再阻止新评论进入 Life 自主判断',()=>workspace(async dir=>{
 let t=T,items=[],calls=0;
 const x=makeComment(dir,{items,now:()=>t,generateReply:async()=>{calls++;return 'SKIP'}});
 await x.poll();
 const state=await localState(dir,'comment-interact-state.json');state.strangerAttempts={'123':[T-DAY+60*60000,T-DAY+61*60000]};await writeFile(join(dir,'comment-interact-state.json'),JSON.stringify(state));
 items.push(notice(200001));await x.poll();let next=await localState(dir,'comment-interact-state.json');
 assert.equal(calls,1);assert.equal(next.seen['comment:200001'],'skipped');assert.equal(next.preflightDefers['comment:200001'],undefined);
 assert.equal(x.status().deferredStrangerBudgetCount,undefined);
}));
test('模型429只按技术退避处理，不再累计隐藏陌生人考虑额度',()=>workspace(async dir=>{
 let t=T,items=[],calls=0;const x=makeComment(dir,{items,now:()=>t,generateReply:async()=>{calls++;if(calls===1)throw Error('429 All providers are saturated');return 'SKIP'}});
 await x.poll();items.push(notice(200002));await x.poll();let state=await localState(dir,'comment-interact-state.json');
 assert.equal(calls,1);assert.equal(state.strangerAttempts?.['123']?.length||0,0);
 assert.equal(state.seen['comment:200002'],undefined);assert.ok(state.preflightDefers['comment:200002']>=T+15*60_000);
 await x.poll();assert.equal(calls,1);
 t+=15*60_000+1000;await x.poll();assert.equal(calls,2);
 state=await localState(dir,'comment-interact-state.json');assert.equal(state.strangerAttempts?.['123']?.length||0,0);assert.equal(state.seen['comment:200002'],'skipped');
}));
test('只解除时间戳明确属于旧陌生人限额的未发送延期，保留其他延期',()=>workspace(async dir=>{
 let items=[],calls=0;const x=makeComment(dir,{items,now:()=>T,generateReply:async()=>{calls++;return 'SKIP'}});
 await x.poll();const db=await localState(dir,'comment-interact-state.json');
 db.strangerAttempts={'123':[T-DAY+60*60000,T-DAY+61*60000]};
 db.preflightDefers={'comment:200004':T+60*60000+1000,'comment:200005':T+10*60000};
 await writeFile(join(dir,'comment-interact-state.json'),JSON.stringify(db));
 items.push(notice(200004),notice(200005));await x.poll();const next=await localState(dir,'comment-interact-state.json');
 assert.equal(calls,1);assert.equal(next.seen['comment:200004'],'skipped');
 assert.equal(next.preflightDefers['comment:200004'],undefined);
 assert.equal(next.preflightDefers['comment:200005'],T+10*60000);
 assert.equal(next.seen['comment:200005'],undefined);
}));
test('重复收到同一通知不抹掉技术失败或延期的真实诊断',()=>workspace(async dir=>{
 const items=[notice(200006)],x=makeComment(dir,{items,now:()=>T,generateReply:async()=>{throw Error('HTTP 429 provider unavailable')}});
 await x.poll();const db=await localState(dir,'comment-interact-state.json');
 assert.equal(db.replyDiagnostics.at(-1).reason,'ai_generation_error');
 await x.poll();const next=await localState(dir,'comment-interact-state.json');
 assert.equal(next.replyDiagnostics.at(-1).reason,'ai_generation_error');
 assert.ok(x.status().replyDiagnostics[0].preflightRetryAt>T);
}));
test('升级不自动清除历史 stranger-budget seen，确保不突然对旧通知外发',()=>workspace(async dir=>{
 let items=[],calls=0;const x=makeComment(dir,{items,now:()=>T,generateReply:async()=>{calls++;return 'SKIP'}});
 await x.poll();const db=await localState(dir,'comment-interact-state.json');db.seen['comment:200003']='stranger-budget';await writeFile(join(dir,'comment-interact-state.json'),JSON.stringify(db));
 items.push(notice(200003));await x.poll();assert.equal(calls,0);assert.equal(x.status().legacyStrangerBudgetCount,1);
}));

test('Life 授权复核/表达校验错误与模型生成失败分开诊断',()=>workspace(async dir=>{
 let items=[],calls=0
 const x=makeComment(dir,{items,now:()=>T,generateReply:async()=>{
   calls++
   if(calls===1)throw Error('Life 评论表达授权不可用：life-choice-review-required')
   throw Error('Life 评论表达授权不可用：life-social-expression-invalid')
 }})
 await x.poll()
 items.push(notice(200007),notice(200008));await x.poll()
 const rows=x.status().replyDiagnostics
 const review=rows.find(r=>r.id==='comment:200007')
 const expression=rows.find(r=>r.id==='comment:200008')
 assert.equal(review.reason,'life_authorization_review_required')
 assert.equal(expression.reason,'life_expression_validation_failed')
 assert.match(review.errorDetail,/life-choice-review-required/)
 assert.ok(review.preflightRetryAt>=T+15*60_000)
 assert.equal(review.generatedReply,'')
 assert.equal(expression.generatedReply,'')
 assert.equal(calls,2)
}));
const dmMessage=(t)=>({senderUid:'200',messageId:'source-message-one',timestampMs:t,text:'有什么新鲜事吗？',incoming:true});
