import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeAtNotifications} from '../lib/comment-inbox.mjs';
import {createCommentInteract} from '../lib/comment-interact.mjs';
import {createCommentVideoContext} from '../lib/comment-video-context.mjs';
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs';
const bv='BV1ignA6REjB', self='123',uid='456', ts=Date.now();
const notice=(id,author=uid,text='大肥鱼快来看这个好玩的！',timestamp=ts)=>({id,at_time:Math.floor(timestamp/1000),user:{mid:author,nickname:'测试观众'},item:{business_id:1,subject_id:'777',source_id:String(id+100),root_id:'888',target_id:'888',source_content:text,uri:`https://www.bilibili.com/video/${bv}`,at_details:[{mid:self}],target_reply_content:'原评论里在聊视频'}});
const raw=items=>({at:{code:0,data:{items}}});
test('@ 通知必须可定位、不是自己、提到当前账号且来自视频评论；点赞不算',()=>{
 const all=normalizeAtNotifications({...raw([notice(1),notice(2,self),{...notice(3),item:{...notice(3).item,at_details:[{mid:'999'}]}}, {...notice(4),item:{...notice(4).item,business_id:11}}]),likes:{items:[notice(8)]}},self);
 assert.equal(all.length,1);assert.equal(all[0].uid,uid);assert.equal(all[0].kind,'at');assert.equal(all[0].root,'888');
});
test('旧白名单设置不再限制新@；首次开启仍基线化历史通知',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2451-at-'));let notifications=[notice(1)],sent=[],prompts=[];
 try {
 const cfg={watchReplies:false,watchTop:false,watchAt:true,atMode:'whitelist',atWhitelist:uid,replyPerPoll:3,replyPerDay:50,globalDailyLimit:1000};
 const runner=createCommentInteract({dataDir:dir,getConfig:()=>cfg,selfUid:async()=>self,getAtNotifications:async()=>raw(notifications),getOwnComments:async()=>({top:[],nested:[]}),getVideos:async()=>[],getComments:async()=>({comments:[]}),getVideoContext:async()=>({usable:true,text:'实际视频标题、热门评论和当前楼层'}),generateReply:async(x)=>{prompts.push(x);return '好耶，来看看！';},send:async x=>{sent.push(x);return {ok:true,rpid:'9999'}}});
 await runner.poll({mentions:true});assert.equal(sent.length,0);
 notifications=[notice(1),notice(2,'999'),notice(3)];
 await runner.poll({mentions:true});assert.equal(sent.length,2);assert.equal(prompts[0].mode,'at');assert.match(prompts[0].context,/实际视频标题/);
 assert.deepEqual(sent.map(x=>x.uid).sort(),['456','999']);
 await runner.poll({mentions:true});assert.equal(sent.length,2);
 } finally {await rm(dir,{recursive:true,force:true})}
});
test('没有取得可信的视频和新评论时@不发送；AI沉默时也不发送',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2451-at-'));let list=[notice(1)], sent=0, contextAvailable=false;
 try{
 const runner=createCommentInteract({dataDir:dir,getConfig:()=>({watchAt:true,atMode:'all',replyPerPoll:2,replyPerDay:50,globalDailyLimit:1000}),selfUid:async()=>self,getAtNotifications:async()=>raw(list),getOwnComments:async()=>({top:[],nested:[]}),getVideoContext:async()=>({usable:contextAvailable,text:'视频已有资料'}),generateReply:async()=> 'SKIP',send:async()=>{sent++;return {ok:true}}});
 await runner.poll();list=[notice(1),notice(2)];const noContext=await runner.poll();assert.equal(noContext.ignored,1);assert.equal(sent,0);
 contextAvailable=true;list=[notice(1),notice(2),notice(3)];const skipped=await runner.poll();assert.equal(skipped.ignored,1);assert.equal(sent,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('复用之前的真实字幕和视频资料，同时获取当前热门和相关楼层',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2451-cache-'));let infoCalled=0,hotCalled=0,threadCalled=0;
 try{await mkdir(join(dir,'comment-video-context'));
 await writeFile(join(dir,'comment-video-context',bv+'.json'),JSON.stringify({version:1,info:{title:'旧视频标题',description:'作者当时的简介'},subtitle:{text:'实际上取得的字幕片段'},comments:{items:[{content:'旧热评'}]}}));
 const ctx=createCommentVideoContext({stateDir:dir,getInfo:async()=>{infoCalled++;return {}},getHot:async()=>{hotCalled++;return {comments:[{rpid:'888',content:'当前根评论'},{rpid:'700',content:'新的热门评论'}]}},getThread:async()=>{threadCalled++;return {replies:[{content:'最新楼中楼内容'}]}}});
 const data=await ctx.forReply(bv,{root:'888',rpid:'222'});assert.equal(data.usable,true);assert.match(data.text,/实际上取得的字幕/);assert.match(data.text,/新的热门评论/);assert.match(data.text,/最新楼中楼/);assert.equal(infoCalled,0);
 await ctx.forReply(bv,{root:'888'});assert.equal(hotCalled,1);assert.equal(threadCalled,1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('调度器启用 @ 后独立轮询，原评论开关都关闭时仍运行',async()=>{
 let called=0;const scheduler=createInteractionScheduler({dm:{poll:async()=>{}},comments:{poll:async req=>{assert.equal(req.mentions,true);called++}},getConfig:()=>({masterEnabled:true,commentAtEnabled:true,commentWatchTop:false,commentWatchReplies:false,dmWatch:false})});
 scheduler.start();await new Promise(r=>setTimeout(r,15));scheduler.stop();assert.equal(called,1);
});
test('同一条既有回复通知又有被@通知时，只生成和发送一次',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2451-dedupe-'));let mentions=[notice(1)], replies=[],sent=0;
 try{
 const engine=createCommentInteract({dataDir:dir,getConfig:()=>({watchReplies:true,watchAt:true,atMode:'all',watchTop:false,replyPerDay:30,replyPerPoll:3,globalDailyLimit:100}),selfUid:async()=>self,
 getNotifications:async()=>({data:{items:replies}}),getAtNotifications:async()=>raw(mentions),getOwnComments:async()=>({top:[],nested:[]}),getVideoContext:async()=>({usable:true,text:'真实视频评论上下文'}),
 generateReply:async()=> '有人叫我？',send:async()=>{sent++;return {ok:true,rpid:'60000'}},logger:{warn(){},error(){}}});
 await engine.poll();
 const n=notice(2);mentions=[notice(1),n];replies=[n];
 const result=await engine.poll();assert.equal(result.sent,1);assert.equal(sent,1);
 assert.equal((await engine.poll()).sent,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('没有历史快照的全新 @ 视频：读取真实字幕、热评和目标评论串；缓存避免反复拉字幕',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2451-new-bv-'));let subs=0,infos=0;
 try{
 const reader=createCommentVideoContext({stateDir:dir,
   getInfo:async()=>{infos++;return {title:'真实标题',description:'实际简介'}},
   getSubtitle:async()=>{subs++;return {text:'实际从 B站字幕接口取回的文字'}},
   getHot:async()=>({comments:[{rpid:'444',content:'热门评论真的这么说'}]}),
   getThread:async()=>({replies:[{content:'当前楼层的观众评论'}]})});
 const a=await reader.forReply(bv,{kind:'at',root:'888'});
 assert.equal(a.usable,true);assert.match(a.text,/实际从 B站字幕接口/);
 assert.match(a.text,/热门评论真的这么说/);assert.match(a.text,/当前楼层的观众评论/);
 await reader.forReply(bv,{kind:'at',root:'888'});assert.equal(subs,1);assert.equal(infos,1);
 }finally{await rm(dir,{recursive:true,force:true})}
});
