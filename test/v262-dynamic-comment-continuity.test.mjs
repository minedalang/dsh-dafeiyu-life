import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {commentEngagementContext} from '../lib/comment-engagement-context.mjs';
import {ownPublishedDynamicText} from '../lib/own-published-dynamics.mjs';
import {createCommentInteract} from '../lib/comment-interact.mjs';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';
import {composeLifeVoiceContext} from '../lib/life-voice-context.mjs';

const clock=Date.parse('2026-11-03T15:40:00+08:00'),dynamicId='1265224900757422087',uid='502001',self='900';
const raw=(id,who=uid,text='蓝色的')=>({user:{mid:who,uname:'朋友'},item:{business:'动态',business_id:17,
  subject_id:'1000099',source_id:String(id),root_id:'0',target_id:'0',
  uri:'https://t.bilibili.com/'+dynamicId,source_content:text,timestamp:Math.floor(clock/1000)}});
const notices=items=>({code:0,data:{items}});
const cfg={watchReplies:true,watchAt:false,replyPerPoll:6,replyPerDay:20,globalDailyLimit:100,diagReplyInboxEnabled:true};

test('已发布的真实动态才提供公开正文；草稿和不匹配的动态一律不可作为正文证据',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dynamic-comment-receipt-'));
 try{
  await mkdir(join(dir,'daily-dynamic'));
  await writeFile(join(dir,'daily-dynamic','drafts.json'),JSON.stringify({drafts:[
   {status:'draft',dynamicId:'1265224900757422099',text:'我的私人草稿'},
   {status:'published',dynamicId,text:'有身体要花多少钱呀，还没想好要什么颜色的身体。'}
  ]}));
  assert.match(ownPublishedDynamicText(dir,dynamicId),/什么颜色/);
  assert.equal(ownPublishedDynamicText(dir,'1265224900757422099'),'');
  assert.equal(ownPublishedDynamicText(dir,'1265224900757422222'),'');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('短答的上下文和连续聊天依据来自同人已确认回执；当前情绪不被当成回复概率',()=>{
 const replies=[{uid,dynamicId,at:clock-4*60_000},{uid:'other',dynamicId,at:clock-30_000},
   {uid,dynamicId:'1265224900757422011',at:clock-30_000},{uid,dynamicId,at:clock-150*60_000}];
 const mood={enabled:true,label:'疲惫',intensity:63,energy:24,sociality:28};
 const x=commentEngagementContext({uid,dynamicId,replyRecords:replies,emotion:mood,nowMs:clock});
 assert.equal(x.recent30m,1);
 assert.equal(x.recent2h,1);
 assert.match(x.text,/简短不代表无意义/);
 assert.match(x.text,/【同一角色核心】/);
 assert.doesNotMatch(x.text,/当前模拟心情：疲惫/);
 assert.doesNotMatch(x.text,/其他用户/);
 const noMood=commentEngagementContext({uid,dynamicId,emotion:{enabled:false,label:'开心',sociality:99},nowMs:clock});
 assert.equal(noMood.moodEnabled,false);
 assert.doesNotMatch(noMood.text,/当前模拟心情：开心/);
});

test('真实动态评论：首次回答颜色问题时可回复；同一人再说收尾话时仍可按心情停聊',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dynamic-comment-continuity-'));
 let entries=[];const calls=[],sent=[];let mood={enabled:true,label:'开心',intensity:72,energy:75,sociality:78};
 const engine=createCommentInteract({dataDir:dir,now:()=>clock,selfUid:()=>self,getConfig:()=>cfg,
  getNotifications:()=>notices(entries),getOwnComments:()=>({top:[],nested:[]}),
  socialTier:()=> 'friend',decideSocial:()=>({decision:'allow'}),getEmotion:()=>mood,
  getDynamicContext:async x=>({usable:true,targetUid:x.uid,dynamicId,authorUid:self,ownedLocal:true,
    root:x.rpid,verifiedCommentText:x.text,ownDynamicText:'有身体要花多少钱呀，还没想好要什么颜色的身体。'}),
  generateReply:async req=>{calls.push(req);return calls.length===1?'蓝色挺酷的！我好像有点心动啦～':'SKIP'},
  send:async x=>{sent.push(x);return {ok:true,rpid:'3999001'}}
 });
 try{
  await engine.poll({notifications:true,top:false,mentions:false}); // historical baseline
  entries=[raw('319068475249')];
  assert.equal((await engine.poll({notifications:true,top:false,mentions:false})).sent,1);
  assert.equal(calls[0].mode,'self-dynamic');
  assert.match(calls[0].context,/还没想好要什么颜色的身体/);
  assert.match(calls[0].engagementContext,/【同一角色核心】/);
  assert.doesNotMatch(calls[0].engagementContext,/当前模拟心情：开心/);
  assert.match(calls[0].engagementContext,/近30分钟已确认回复 0 次/);
  assert.equal(sent.length,1);
  mood={enabled:true,label:'疲惫',intensity:61,energy:29,sociality:33};
  entries.push(raw('319068475250',uid,'好耶，那就这样啦'));
  assert.equal((await engine.poll({notifications:true,top:false,mentions:false})).sent,0);
  assert.equal(calls.length,2);
  assert.match(calls[1].engagementContext,/近30分钟已确认回复 1 次/);
  assert.doesNotMatch(calls[1].engagementContext,/当前模拟心情：疲惫/);
  const diag=engine.status().replyDiagnostics.find(x=>x.rpid==='319068475250');
  assert.equal(diag.reason,'ai_skipped');
  assert.equal(diag.replyDecision.recent30m,1);
  assert.equal(diag.replyDecision.mood,'疲惫');
  assert.equal(diag.chatWillingness,'allow');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('模拟模型能同时看到原动态、连续互动、当前情绪；不把短评自动变成强制回复',async()=>{
 let modelPrompt='';const batcher=createInteractionBatcher({delayMs:0,
   getPersona:()=> composeLifeVoiceContext({scene:'comment',persona:'【人格】同一条鱼',
     emotion:'当前模拟情绪疲惫（真实当前状态），不代表必须回复',maxChars:2700}),invoke:async p=>{
     modelPrompt=p;return JSON.stringify({items:[{id:'0',action:'skip',reply:'',mood:'tired',intensity:1}]})
   }});
 try{
  const result=await batcher.generate({kind:'comment',mode:'self-dynamic',uid,text:'蓝色的',
    context:'真实动态：鱼鱼正在问身体选什么颜色',engagementContext:'已确认最近回复1次；是否结束话题由模型判断',
    canSkip:true});
  assert.equal(result,'SKIP');
  assert.match(modelPrompt,/真实动态：鱼鱼正在问身体选什么颜色/);
  assert.match(modelPrompt,/【当前连续情绪】[\s\S]*当前模拟情绪疲惫/);
  assert.equal((modelPrompt.match(/当前模拟情绪疲惫/g)||[]).length,1);
  assert.doesNotMatch(modelPrompt,/engagementContext[^\n]*当前模拟情绪疲惫/);
  assert.match(modelPrompt,/同一条鱼/);
  assert.match(modelPrompt,/不要只因为评论很短就 SKIP/);
 }finally{batcher.stop()}
});
