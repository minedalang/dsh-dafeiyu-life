import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {notificationCommentLocation,normalizeReplyNotifications,normalizeAtNotifications} from '../lib/comment-inbox.mjs';
import {createCommentVideoContext} from '../lib/comment-video-context.mjs';

const BV='BV1bWHT6xEJg', AID='117500977089472';
const notice=(item)=>({user:{mid:123,uname:'次元小哆啦'},item:{business:'评论',subject_id:AID,source_id:'1112759450',source_content:'大肥鱼上钩了',timestamp:1793000000,uri:'https://www.bilibili.com/video/'+BV,...item}});

test('优先使用 B站通知链接中的真正 root，而非直接父评论 target_id',()=>{
 const item={root_id:'',target_id:'90000222',uri:'https://www.bilibili.com/video/'+BV+'/?comment_on=1&comment_root_id=70000111&comment_secondary_id=1112759450'};
 assert.deepEqual(notificationCommentLocation(item,'1112759450'),{locationRoot:'70000111',locationSource:'bili-uri'});
 const rows=normalizeReplyNotifications({code:0,data:{items:[notice(item)]}},'900');
 assert.equal(rows.length,1);
 assert.equal(rows[0].root,'70000111','只能使用 B站 URI 验证的根 ID，不能用直接父评论 ID');
 assert.equal(rows[0].targetId,'90000222','保留直接父评论坐标');
 assert.equal(rows[0].locationRoot,'70000111');
 assert.equal(rows[0].locationSource,'bili-uri');
});

test('原始 root_id 比 parent ID 更可靠，顶层 0 可通过 source_id 定位，恶意链接不采信',()=>{
 assert.deepEqual(notificationCommentLocation({root_id:'80000111',target_id:'90000222'},'1112759450'),{locationRoot:'80000111',locationSource:'root-id'});
 assert.deepEqual(notificationCommentLocation({root_id:0,target_id:0},'1112759450'),{locationRoot:'1112759450',locationSource:'top'});
 assert.deepEqual(notificationCommentLocation({root_id:'',target_id:'90000222',uri:'https://evil.test/?comment_root_id=123'},'1112759450'),{locationRoot:'',locationSource:'unknown'});
 assert.deepEqual(notificationCommentLocation({root_id:'',target_id:'90000222',uri:'javascript:alert(1)?comment_root_id=123'},'1112759450'),{locationRoot:'',locationSource:'unknown'});
});

test('@通知也保留原始评论根坐标用于每日诊断',()=>{
 const item={business:'视频',business_id:1,subject_id:AID,source_id:'1112759450',root_id:'99911122',target_id:'11120000',source_content:'@大肥鱼 来看！',uri:'https://www.bilibili.com/video/'+BV,at_details:[{mid:'900'}]};
 const at=normalizeAtNotifications({at:{data:{items:[{id:'9001',user:{mid:123,uname:'网友'},item}]}}},'900');
 assert.equal(at.length,1);
 assert.equal(at[0].locationRoot,'99911122');
});

test('已经正常读取的主评论和附近楼中楼可免费附在诊断结果中',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2466-preview-'));const calls=[];
 try {
  const c=createCommentVideoContext({stateDir:dir,
   getInfo:async()=>{calls.push('info');return {title:'钓鱼视频'}},
   getHot:async()=>{calls.push('hot');return {comments:[]}},
   getThread:async()=>{calls.push('thread');return {root_comment:{rpid:'70000111',name:'评论作者',content:'大肥鱼有那么多'},replies:[{rpid:'90000222',name:'大肥鱼',content:'钓上来的要是我'},{rpid:'1112759450',name:'次元小哆啦',content:'大肥鱼上钩了'}],target_found:true}}});
  const result=await c.forReply(BV,{kind:'notice',rpid:'1112759450',root:'70000111',targetId:'90000222',text:'大肥鱼上钩了',context:'钓上来的要是我'});
  assert.match(result.rootPreview,/评论作者：大肥鱼有那么多/);
  assert.match(result.threadPreview,/大肥鱼：钓上来的要是我/);
  assert.match(result.threadPreview,/次元小哆啦：大肥鱼上钩了/);
  assert.deepEqual(calls,['info','thread','hot']);
 } finally { await rm(dir,{recursive:true,force:true}); }
});

test('管理中心只显示本地已有原文、上下文、草稿和位置坐标，无查看时追加的 B站/AI 请求',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
 assert.match(js,/locationRoot/);
 assert.match(js,/楼层主评论（已缓存）/);
 assert.match(js,/展开本轮已读取的附近楼中楼评论/);
 assert.match(js,/对方这条：/);
 assert.match(js,/AI 已生成（仅本地草稿/);
 assert.match(js,/复制评论定位信息/);
 assert.match(js,/评论定位信息（跳转不准时查看）/);
});
