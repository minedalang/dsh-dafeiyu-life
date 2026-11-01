import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bvToAv } from '../lib/bv-to-av.mjs';
import { getCommentMemePreview, listCommentMemes } from '../lib/comment-meme-library.mjs';
import { recentComments } from '../lib/recent-comments.mjs';
import { normalizeReplyNotifications, normalizeTopComments } from '../lib/comment-inbox.mjs';

const fixture = () => {const dir=mkdtempSync(join(tmpdir(),'dsh-v2448-'));return {dir,clean:()=>rmSync(dir,{recursive:true,force:true})}};

test('BV 号正确转换 AV 号，无效字符不伪造', () => {
 assert.equal(bvToAv('BV17x411w7KC'),'170001');
 assert.equal(bvToAv('BV1L9Uoa9EUx'),'111298867365120');
 assert.equal(bvToAv('BV1234567890'),'');
 assert.equal(bvToAv('../../etc/passwd'),'');
});

test('预览文件接口可以直接找到第 130 张，不受给 Agent 的前100张清单限制', () => {
 const {dir,clean}=fixture();try{
   mkdirSync(join(dir,'大肥鱼和其他大模型'));
   for(let i=1;i<=130;i++)writeFileSync(join(dir,'大肥鱼和其他大模型',`表情包${String(i).padStart(3,'0')}.png`),Buffer.from('safe-test-file'));
   const name='大肥鱼和其他大模型/表情包130';
   assert.equal(listCommentMemes(dir,{limit:300}).names.length,100);
   const preview=getCommentMemePreview(dir,name);
   assert.ok(preview);
   assert.ok(preview.location.endsWith('表情包130.png'));
   assert.equal(getCommentMemePreview(dir,'../../etc/passwd'),null);
   assert.equal(getCommentMemePreview(dir,'大肥鱼和其他大模型/不存在'),null);
 }finally{clean()}
});

test('评论记录优先显示 av 号，带昵称的后台回复按出站 rpid 映射，旧记录不编造对方姓名',()=>{
 const {dir,clean}=fixture();try{
   const bv='BV17x411w7KC';
   writeFileSync(join(dir,'seen.md'),`## 评论记录\n| ${bv} | 321906225296 | 0 | 2026-10-25 21:00:00 | 原创评论 |\n| ${bv} | 321906225297 | 321900000000 | 2026-10-25 21:30:00 | 有昵称回复 |\n| ${bv} | 321906225298 | 321900000000 | 2026-10-25 21:32:00 | 旧回复 |\n`);
   writeFileSync(join(dir,'comment-interact-state.json'),JSON.stringify({replyRecords:[
      {bvid:bv,outboundRpid:'321906225297',recipientName:'看大肥鱼的观众',aid:'170001',at:12345}
   ]}));
   const rows=recentComments(dir).rows;
   assert.equal(rows.length,3);
   assert.equal(rows.find(r=>r.kind==='top').aid,'170001');
   assert.equal(rows.find(r=>r.rpid==='321906225297').recipientName,'看大肥鱼的观众');
   assert.equal(rows.find(r=>r.rpid==='321906225298').recipientName,'');
   assert.match(rows.find(r=>r.rpid==='321906225297').url,/comment_secondary_id=321906225297/);
 }finally{clean()}
});

test('B 站通知和热门评论可抽取可信昵称，不向外推断不存在的昵称',()=>{
 const notices=normalizeReplyNotifications({data:{items:[{user:{mid:'12345',uname:'观众甲'},item:{business_id:1,subject_id:170001,source_id:321906225296,uri:'https://www.bilibili.com/video/BV17x411w7KC',source_content:'在吗？'}}]}},'9000');
 assert.equal(notices[0].name,'观众甲');
 const rows=normalizeTopComments({comments:[{mid:12345,rpid:321906225298,content:'给大肥鱼吃饭',member:{uname:'观众乙'}}]},'BV17x411w7KC','9000');
 assert.equal(rows[0].name,'观众乙');
});

test('管理中心有文件夹筛选和分页，评论标题不暴露重复 rpid',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
 assert.match(js,/STICKERS_PER_PAGE=24/);
 assert.match(js,/sticker-folder-filter/);
 assert.match(js,/sticker-page-next/);
 assert.match(html,/id="sticker-page-prev"/);
 assert.match(html,/id="sticker-folder-filter"/);
 assert.match(js,/昵称及 UID 未记录/);
 assert.match(js,/const a=node\('a',videoLabel\)/); // 可见标题恢复 BV，rpid 仍保留在 tooltip 和 href
});

test('插件真实 HTTP 预览路由对第 130 张图片返回 200，而不是 404',async()=>{
 const {dir,clean}=fixture();let handler;
 try{
   const images=join(dir,'bili-duty','comment-memes','大肥鱼和其他大模型');
   mkdirSync(images,{recursive:true});
   for(let i=1;i<=130;i++)writeFileSync(join(images,`截图${String(i).padStart(3,'0')}.png`),Buffer.from('imagebytes'));
   const {apply}=await import('./helpers/ready-host.mjs');
   const ctx={get:key=>key==='dshHomePath'?(...paths)=>join(dir,...paths):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(o){handler=o.handler;return {dispose(){}}}},
    effect:fn=>fn(),settings:{describe(){return []}}};
   apply(ctx,{});
   let code=0,bytes=null;
   const name='大肥鱼和其他大模型/截图130';
   const req={url:'/api/bili-duty/stickers/file?name='+encodeURIComponent(name),method:'GET',headers:{host:'127.0.0.1:11409'}};
   const res={writeHead(c){code=c},end(data){bytes=data}};
   await handler(req,res);
   assert.equal(code,200);
   assert.equal(Buffer.from(bytes).toString(),'imagebytes');
 }finally{clean()}
});
