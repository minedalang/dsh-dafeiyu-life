import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommentInteract} from '../lib/comment-interact.mjs';

const CLOCK=Date.parse('2026-11-14T13:40:00+08:00');
const message=(id,text)=>({user:{mid:123},item:{business_id:1,subject_id:123456789,
  source_id:String(id),target_id:55555,root_id:55555,
  source_time:Math.floor(CLOCK/1000),source_content:text}});
const config=()=>({watchReplies:true,watchTop:false,replyPerDay:20,replyPerPoll:5,
  globalDailyLimit:100,diagReplyInboxEnabled:true});

async function scenario(firstDecision,expectedOrigin,expectedDeliberate){
 const dir=await mkdtemp(join(tmpdir(),'life-comment-silence-'));
 let inbox=[],drafts=[],deliberate=[],sent=[];
 const engine=createCommentInteract({dataDir:dir,now:()=>CLOCK,selfUid:()=> '900',
   getConfig:config,getOwnComments:()=>({top:new Set(['55555']),nested:new Set()}),
   getNotifications:async()=>({data:{items:inbox}}),getVideos:async()=>[],getComments:async()=>[],
   generateReply:async req=>{drafts.push(req);return drafts.length===1?firstDecision:{action:'reply',messages:['新话题我有话想说']}},
   onDeliberateSilence:async item=>{deliberate.push(item)},
   send:async req=>{sent.push(req);return {ok:true,rpid:'56789'}},
   logger:{warn(){},error(){}}});
 try{
  await engine.poll(); // initial notification bootstrap
  inbox=[message(900001,'那就先聊到这里啦')];
  const first=await engine.poll();
  assert.equal(first.sent,0);assert.equal(first.ignored,1);
  assert.equal(sent.length,0);assert.equal(deliberate.length,expectedDeliberate);
  let state=JSON.parse(await readFile(join(dir,'comment-interact-state.json'),'utf8'));
  assert.equal(state.seen['comment:900001'],'skipped');
  assert.equal(engine.status().replyDiagnostics.at(-1)?.silenceOrigin,expectedOrigin);
  inbox.push(message(900002,'新话题来了，可以一起讨论吗？'));
  const second=await engine.poll();
  assert.equal(second.sent,1);
  assert.equal(sent.length,1);
  if(expectedDeliberate)assert.match(drafts[1].context,/那就先聊到这里啦/);
  return engine.status();
 }finally{await rm(dir,{recursive:true,force:true})}
}

test('结构化 Life skip 确实登记自主沉默并保留后续同评论串上下文',async()=>{
 await scenario({action:'skip',messages:[]},'model-skip',1);
});
test('结构化 Life close 是自愿结束而非技术失败，也会保存收尾语境',async()=>{
 await scenario({action:'close',messages:[]},'model-close',1);
});
test('契约/安全抑制不冒充模型自主沉默，也不伪造自主沉默经历',async()=>{
 await scenario({action:'skip',reason:'reply-bubble-limit',messages:[]},'suppressed',0);
});
test('空回复不冒充有意沉默',async()=>{
 await scenario({action:'reply',messages:[]},'empty-reply',0);
});
