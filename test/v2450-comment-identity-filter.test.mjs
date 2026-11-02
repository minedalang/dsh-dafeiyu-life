import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {recentComments} from '../lib/recent-comments.mjs';
import {apply} from './helpers/ready-host.mjs';
import {createCommentInteract} from '../lib/comment-interact.mjs';

function fixture(){const dir=mkdtempSync(join(tmpdir(),'v2450-'));mkdirSync(dir,{recursive:true});return {dir,close:()=>rmSync(dir,{recursive:true,force:true})}}
function writeSeen(dir){
  writeFileSync(join(dir,'seen.md'),[
    '## 评论记录',
    '| BV17x411w7KC | 321906225296 | 0 | 2026-10-25 21:00:00 | 原创主评 |',
    '| BV17x411w7KC | 321906225297 | 321900000000 | 2026-10-25 21:30:00 | 对某人回复 |',
    '| BV17x411w7KC | 321906225298 | 321900000000 | 2026-10-24 15:30:00 | 旧回复 |',
  ].join('\n'),'utf8');
}
test('主评论和回复的筛选、日期、分页在本地查询正确',()=>{
 const {dir,close}=fixture();try{
  writeSeen(dir);
  const all=recentComments(dir);assert.equal(all.total,3);assert.equal(all.counts.top,1);assert.equal(all.counts.reply,2);
  const tops=recentComments(dir,{kind:'top'});assert.equal(tops.total,1);assert.equal(tops.rows[0].bvid,'BV17x411w7KC');
  const replies=recentComments(dir,{kind:'reply',limit:1,offset:1});assert.equal(replies.total,2);assert.equal(replies.rows.length,1);
  const day=recentComments(dir,{kind:'reply',day:'2026-10-25'});assert.equal(day.total,1);assert.equal(day.counts.top,1);assert.equal(day.counts.reply,1);
  assert.equal(recentComments(dir,{kind:'invalid'}).total,3);
 }finally{close()}
});
test('回复标签同时提供昵称和 UID，旧回复没有资料不假造',()=>{
 const {dir,close}=fixture();try{
  writeSeen(dir);
  writeFileSync(join(dir,'comment-interact-state.json'),JSON.stringify({replyRecords:[],replyLabels:{
   'BV17x411w7KC:321906225297':{recipientName:'大肥鱼粉丝',recipientUid:'485221842'}
  }}));
  const [recent,old]=recentComments(dir,{kind:'reply'}).rows;
  assert.equal(recent.recipientName,'大肥鱼粉丝');assert.equal(recent.recipientUid,'485221842');
  assert.equal(old.recipientName,'');assert.equal(old.recipientUid,'');
  assert.match(recent.url,/comment_secondary_id=321906225297/);
 }finally{close()}
});
test('真实后台成功回复的 UID 和昵称写入持久化标签，不依赖24小时计数窗口',async()=>{
 const {dir,close}=fixture();try{
  let now=Date.parse('2026-10-25T09:00:00Z');
  const root='321900000000',target='321900000001',out='321906225297';
  const engine=createCommentInteract({dataDir:dir,now:()=>now,
   getConfig:()=>({watchReplies:false,watchTop:true,allowGeneralTop:true,topVideoCount:1,topCount:5,
    replyPerPoll:3,replyPerDay:1000,globalDailyLimit:999}),
   selfUid:async()=> '9000',getNotifications:async()=>({data:{items:[]}}),
   getVideos:async()=>['BV17x411w7KC'],
   getComments:async()=>({comments:[{mid:485221842,rpid:target,content:'你好',member:{uname:'某位观众'}}]}),
   generateReply:async()=> '你好！',
   send:async()=>({ok:true,rpid:out}),logger:{warn(){},error(){}}
  });
  const result=await engine.poll();assert.equal(result.sent,1);
  const persisted=JSON.parse(readFileSync(join(dir,'comment-interact-state.json'),'utf8'));
  assert.equal(persisted.replyRecords[0].recipientUid,'485221842');
  assert.equal(persisted.replyLabels['BV17x411w7KC:'+out].recipientName,'某位观众');
  // 模拟 24 小时互动额度窗口记录被清除，身份标签保持。
  persisted.replyRecords=[];
  writeFileSync(join(dir,'comment-interact-state.json'),JSON.stringify(persisted));
  writeSeen(dir);
  const reply=recentComments(dir,{kind:'reply'}).rows.find(x=>x.rpid===out);
  assert.equal(reply.recipientName,'某位观众');assert.equal(reply.recipientUid,'485221842');
 }finally{close()}
});
test('HTTP 接口支持评论类别并组合日期过滤',async()=>{
 const {dir,close}=fixture();let handler;
 try{
  writeSeen(join(dir,'bili-duty'));
 }catch{mkdirSync(join(dir,'bili-duty'),{recursive:true});writeSeen(join(dir,'bili-duty'))}
 try{
  const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(dir,...xs):undefined,
   logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}};
  apply(ctx,{});
  const req=Readable.from([]);req.method='GET';req.url='/api/bili-duty/recent-comments?kind=reply&day=2026-10-25&limit=20';req.headers={host:'127.0.0.1:11409'};
  let code=0,body;const res={writeHead(c){code=c},end(v){body=String(v??'')}};
  await handler(req,res);assert.equal(code,200);
  const data=JSON.parse(body);assert.equal(data.total,1);assert.equal(data.rows[0].kind,'reply');
 }finally{close()}
});
test('管理中心使用 BV 标签，昵称及 UID 由安全纯文本与数字主页链接渲染',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
 assert.match(html,/id="comments-kind"/);assert.match(html,/回复别人评论/);
 assert.match(js,/const videoLabel=bv\|\|'视频 ID 未记录'/);
 assert.match(js,/space\.bilibili\.com/);
 assert.match(js,/node\('a'\)/);
 assert.match(js,/idLink\.textContent='UID '/);
 assert.ok(!js.includes('innerHTML ='));
});
