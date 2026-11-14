import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCommentInteract} from '../lib/comment-interact.mjs';
import {ownCommentTargets} from '../lib/recent-comments.mjs';
const silent={warn(){},error(){}};
const at=(uid,id,target,root,text='哈哈')=>({user:{mid:uid},item:{business_id:1,subject_id:123456789,source_id:id,target_id:target,root_id:root,
  source_content:text,target_reply_content:'大肥鱼前面说过要吃饭'}});
async function rig(overrides={}){
 const dataDir=await mkdtemp(join(tmpdir(),'v2437-replies-'));
 const events=[],sent=[],prompts=[];
 let time=1800000000000;
 const cfg={watchReplies:true,watchTop:false,replyPerPoll:5,replyPerDay:1000,ownTopPerUser:2,ownNestedPerUser:1,...overrides};
 const handler=createCommentInteract({dataDir,logger:silent,now:()=>time,selfUid:()=> '900',getConfig:()=>cfg,
   getOwnComments:()=>ownCommentTargets(dataDir),getNotifications:async()=>({data:{items:events}}),getVideos:async()=>[],getComments:async()=>({comments:[]}),
   generateReply:async req=>{prompts.push(req);return '嘿嘿，来了！'},
   send:async req=>{sent.push(req);return {ok:true,rpid:String(456789100000+sent.length)};}});
 const add=(uid,id,target,root,text)=>events.push(at(uid,id,target,root,text));
 return {dataDir,events,sent,prompts,cfg,handler,add,advance:ms=>time+=ms,saveLedger:async top=>writeFile(join(dataDir,'seen.md'),`# 评论记录\n| BV | rpid | root | 时间 | 正文 |\n| BV1234567890 | ${top} | 0 | 2026-10-25 14:32:00 | 我的顶层评论 |\n| BV1234567890 | 789012345678 | 333333333333 | 2026-10-25 14:40:00 | 我的楼中楼 A |\n`)};
}

test('主评论下优先回复、上下文保留、24小时按 UID 限额且统计准确',async()=>{
 const x=await rig();await x.saveLedger('123456789012');assert.equal((await x.handler.poll()).baselined,0);
 x.add(101,300001,123456789012,123456789012,'今天有饭吗');
 assert.equal((await x.handler.poll()).sent,1);
 assert.equal(x.prompts[0].mode,'self-top');assert.equal(x.prompts[0].mustReply,true);
 assert.match(x.prompts[0].context,/大肥鱼前面说过要吃饭/);
 x.add(101,300002,123456789012,123456789012,'明天呢');
 assert.equal((await x.handler.poll()).sent,1);
 assert.match(x.prompts[1].context,/今天有饭吗/);
 x.add(101,300003,123456789012,123456789012,'第三次');
 assert.equal((await x.handler.poll()).sent,0);
 assert.equal(x.handler.status().sentLast24Hours,2);
 assert.equal(x.handler.status().sentOnOwnTop24h,2);
 x.add(102,300004,123456789012,123456789012,'另一个观众');
 assert.equal((await x.handler.poll()).sent,1); // 不影响另一个 UID
 assert.equal(x.handler.status().sentLast24Hours,3);
 const state=JSON.parse(await readFile(join(x.dataDir,'comment-interact-state.json'),'utf8'));
 assert.equal(state.seen['comment:300003'],undefined,'单人发送额度届满不应永久吞掉来信');
 assert.ok(state.preflightDefers['comment:300003']>1800000000000);
});

test('回复我在别人楼中楼里的 A 时使用独立限额，且记住该评论串',async()=>{
 const x=await rig();await x.saveLedger('123456789012');await x.handler.poll();
 x.add(101,310001,789012345678,333333333333,'我回复你 A');
 assert.equal((await x.handler.poll()).sent,1);
 assert.equal(x.prompts[0].mode,'self-nested');
 x.add(101,310002,789012345678,333333333333,'再回复一次 A');
 assert.equal((await x.handler.poll()).sent,0);
 // 同 UID 回复本鱼顶层，使用另一份额度
 x.add(101,310003,123456789012,123456789012,'你顶层也来了');
 assert.equal((await x.handler.poll()).sent,1);
 assert.equal(x.handler.status().sentOnOwnNested24h,1);
 const own=JSON.parse(await readFile(join(x.dataDir,'comment-interact-state.json'),'utf8')).ownReplies;
 assert.ok(own[String(456789100002)]); // 后台回复有新 rpid 时可追踪嵌套的再次回复
});

test('来源不明的通知不能被冒充为我的主评论；24小时额度放开到1000',async()=>{
 const x=await rig({replyPerDay:1000});await x.saveLedger('123456789012');await x.handler.poll();
 x.add(200,320001,444444444444,555555555555,'普通通知');
 assert.equal((await x.handler.poll()).sent,1);
 assert.equal(x.prompts[0].mode,'notice');assert.equal(x.prompts[0].mustReply,false);
 assert.equal(x.handler.status().replyPerDay,1000);
 x.advance(86400_001);assert.equal(x.handler.status().sentLast24Hours,0);
});

test('自己的顶层/楼中楼 IDs 只来自判重表，不接受无 ID 历史记录',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'own-comments-'));
 await writeFile(join(dataDir,'seen.md'),'# 评论记录\n| BV | rpid | root | 时间 | 正文 |\n| BV1234567890 | 123456789012 | 0 | 2026-10-25 | 顶层 |\n| BV1234567890 | 234567890123 | 222222222222 | 2026-10-25 | 楼中楼 |\n| BV1234567890 | ? | ? | 2026-10-25 | 成功回执·无评论ID |\n');
 const o=ownCommentTargets(dataDir);
 assert.ok(o.top.has('123456789012'));assert.ok(o.nested.has('234567890123'));
 assert.equal(o.top.size,1);assert.equal(o.nested.size,1);
});

test('首次启动处理明确是近24小时的本人评论新通知，历史/无时间通知只作为基线',async()=>{
 const x=await rig();await x.saveLedger('123456789012');
 const nowMs=1800000000000;
 x.add(101,330001,123456789012,123456789012,'更新期间新来的留言');
 x.events[0].item.source_time=Math.floor((nowMs-5*60_000)/1000);
 x.add(102,330002,123456789012,123456789012,'一周前的旧留言');
 x.events[1].item.source_time=Math.floor((nowMs-8*86400_000)/1000);
 x.add(103,330003,123456789012,123456789012,'缺失时间的留言');
 assert.equal((await x.handler.poll()).sent,1);
 assert.equal(x.prompts[0].mode,'self-top');
 const db=JSON.parse(await readFile(join(x.dataDir,'comment-interact-state.json'),'utf8'));
 assert.equal(db.seen['comment:330002'],'baseline');
 assert.equal(db.seen['comment:330003'],'baseline');
});
