import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLifeWillingness,prepareLifeCommentReply} from '../lib/life-willingness.mjs';
import {createBiliReadBudget,BiliReadDeferredError} from '../lib/bili-read-budget.mjs';
import {classifyVideoCommentRound} from '../lib/video-comment-readiness.mjs';

async function workspace(fn){
 const dir=await mkdtemp(join(tmpdir(),'dsh-dev69-'));
 try{return await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}
}
const createWill=dir=>createLifeWillingness({dataDir:dir,getAccountTag:()=> '0'.repeat(16),
 getContext:async()=>({}),invokeModel:async()=>'',enabled:()=>true});

test('非 P6 字符串回复先归一化为可发送正文，再绑定 Life 精确文本授权',()=>workspace(async dir=>{
 const generated='肥鱼最近在整理小窝、到处看看有趣的新东西！刚看到你的留言 🐟';
 const normalized=prepareLifeCommentReply(generated,{p6Enabled:false});
 assert.deepEqual(normalized,{action:'reply',messages:[generated]});
 const life=createWill(dir);
 const sourceKey='comment:dynamic:1267086296612864004:reply:382440088';
 const targetKey='dynamic:1267086296612864004:root:382440088';
 const answer=life.adoptSocialDecision({kind:'comment_reply',uid:'382440088',sourceKey,targetKey,messages:normalized.messages});
 assert.equal(answer.ok,true,answer.reason);
 assert.equal(life.verify(answer.proof,'comment_reply',{uid:'382440088',targetKey,text:generated}).ok,true);
 assert.equal(life.verify(answer.proof,'comment_reply',{uid:'382440088',targetKey,text:generated}).ok,false,'不能重复发送同一条');
 life.receipt(answer.proof,{status:'not-sent'});
}));

test('超过 130 字的草稿在授权前规整，公开评论无论旧 P6 配置均只允许一条',()=>{
 const long='鱼'.repeat(180);
 assert.equal(prepareLifeCommentReply(long,{p6Enabled:false}).messages[0].length,130);
 assert.deepEqual(prepareLifeCommentReply({action:'reply',messages:['第一条','第二条']},{p6Enabled:true,maxBubbles:2}).messages,['第一条']);
 assert.deepEqual(prepareLifeCommentReply({action:'reply',messages:['第一条','第二条']},{p6Enabled:false}).messages,['第一条']);
 assert.equal(prepareLifeCommentReply({action:'defer',notBefore:20}).action,'defer');
 assert.equal(prepareLifeCommentReply('SKIP'),'SKIP');
});

test('Life 表达失败分别报告空正文、超长和未经授权 @，避免笼统 invalid',()=>workspace(async dir=>{
 const life=createWill(dir),base={kind:'comment_reply',uid:'382440088',sourceKey:'comment:verified:382440088',targetKey:'dynamic:verified:382440088'};
 assert.equal(life.adoptSocialDecision({...base,messages:[]}).reason,'life-social-expression-empty');
 assert.equal(life.adoptSocialDecision({...base,messages:['a'.repeat(131)]}).reason,'life-social-expression-too-long');
 assert.equal(life.adoptSocialDecision({...base,messages:['@路人 你好']}).reason,'life-social-expression-unapproved-mention');
}));

test('后台 B站读取本地节流可通过设置动态调整，平台风控保护仍然有效',()=>workspace(async dir=>{
 let minuteLimit=5,hourLimit=5,at=Date.parse('2026-11-11T00:00:00Z');
 const budget=createBiliReadBudget({dataDir:dir,now:()=>at,getLimits:()=>({minuteLimit,hourLimit})});
 for(let i=0;i<5;i++)budget.acquire('video');
 assert.throws(()=>budget.acquire('video'),BiliReadDeferredError);
 minuteLimit=10;hourLimit=10;
 assert.equal(budget.status().minuteLimit,10);
 assert.equal(budget.acquire('video'),true);
 budget.noteError(new Error('HTTP 412 risk control'));
 assert.equal(budget.status().reason,'platform-cooldown');
 at+=61_000;
 assert.equal(budget.status().blocked,false);
}));

test('主评论审阅：区分尚未考虑、自主延期与技术失败',()=>{
 const common={gate:'configured',pickedCount:2,exitCode:0};
 assert.equal(classifyVideoCommentRound({...common,review:{}}).code,'model-review-not-observed');
 assert.equal(classifyVideoCommentRound({...common,review:{reviewAttempted:1}}).code,'comment-review-no-final-decision');
 assert.equal(classifyVideoCommentRound({...common,review:{reviewAttempted:1,reviewDeferred:1}}).code,'life-deferred');
 assert.equal(classifyVideoCommentRound({...common,review:{reviewAttempted:1,reviewBlocked:1}}).code,'comment-review-technical-failure');
});
