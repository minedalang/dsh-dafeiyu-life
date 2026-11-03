import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';
import {createCommentInteract} from '../lib/comment-interact.mjs';
import {normalizeReplyNotifications, normalizeTopComments} from '../lib/comment-inbox.mjs';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';
const tmp=()=>mkdtemp(join(tmpdir(),'dsh-plus22-'));
const msg=(uid,id,text)=>({senderUid:uid,messageId:id,text,timestampMs:1790000000000,incoming:true});
const silent={warn(){},error(){}};

test('严格暗号审核模式下陌生人也使用同一次 AI 回复调用；最多2次，第三次静默且重启持久',async()=>{
  const dir=await tmp();const inbox=[],sent=[],generate=[];let time=1790000000000;
  const config={enabled:true,strangerEnabled:true,approvalEnabled:true,strangerMaxReplies:2,strangerFirstFixed:true,strangerText:'欢迎鲸鱼',whitelist:[],whitelistCooldownSeconds:0};
  const make=()=>createDmAutoReply({dataDir:dir,selfUid:'900',getConfig:()=>config,now:()=>time,
    fetchIncoming:async()=>inbox,send:async r=>(sent.push(r),{ok:true}),
    generateReply:async r=>(generate.push(r),'第二次是AI'),logger:silent});
  await make().poll();inbox.push(msg('123','m1','你好'));
  assert.equal((await make().poll()).sent,1);assert.match(sent[0].text,/第二次是AI/);assert.equal(generate.length,1);
  assert.deepEqual(generate[0].messages,['你好']);assert.deepEqual(generate[0].messageIds,['m1']);assert.equal(generate[0].timestampMs,time);
  time+=16000;inbox.push(msg('123','m2','还在吗'));
  assert.equal((await make().poll()).sent,1);assert.match(sent[1].text,/第二次是AI/);assert.equal(generate.length,2);
  time+=16000;inbox.push(msg('123','m3','第三次'));
  assert.equal((await make().poll()).sent,0);assert.equal(sent.length,2);
  const state=JSON.parse(await readFile(join(dir,'dm-autoreply-state.json'),'utf8'));
  assert.equal(state.people['123'].stranger.count,2);
});

test('旧固定欢迎语开关不再绕过首条私信 AI 意图理解',async()=>{
  const dir=await tmp();const inbox=[],sent=[];
  const make=()=>createDmAutoReply({dataDir:dir,selfUid:'900',now:()=>1790000000000,
    getConfig:()=>({enabled:true,strangerEnabled:true,strangerMaxReplies:1,strangerFirstFixed:false,whitelist:[]}),
    fetchIncoming:async()=>inbox,send:async r=>(sent.push(r),true),generateReply:async()=> 'AI首条',logger:silent});
  await make().poll();inbox.push(msg('120','x1','你好'));
  assert.equal((await make().poll()).sent,1);assert.equal(sent[0].text,'AI首条');
});

test('升级旧2.1状态已经发过1次时，最多2次仍只剩1次',async()=>{
  const dir=await tmp();const inbox=[],sent=[];
  const cfg={enabled:true,strangerEnabled:true,strangerMaxReplies:1,strangerFirstFixed:true,whitelist:[],whitelistCooldownSeconds:0};
  const make=()=>createDmAutoReply({dataDir:dir,selfUid:'900',getConfig:()=>cfg,now:()=>1790000000000,
    fetchIncoming:async()=>inbox,send:async r=>(sent.push(r),true),generateReply:async()=> 'AI',logger:silent});
  await make().poll();inbox.push(msg('123','1','a'));await make().poll();
  const st=JSON.parse(await readFile(join(dir,'dm-autoreply-state.json'),'utf8'));
  delete st.people['123'].stranger.count;
  const {writeFile}=await import('node:fs/promises');
  await writeFile(join(dir,'dm-autoreply-state.json'),JSON.stringify(st));
  cfg.strangerMaxReplies=2;inbox.push(msg('123','2','b'));
  assert.equal((await make().poll()).sent,1);assert.equal((await make().poll()).sent,0);
  assert.deepEqual(sent.map(x=>x.text),['AI','AI']);
});

test('通知解析：仅视频评论且跳过自己，aid可以替代bvid',()=>{
  const raw={code:0,data:{items:[{user:{mid:123},item:{business_id:1,subject_id:456,source_id:789,root_id:345,source_content:'大肥鱼来吃饭啦'}},
  {user:{mid:900},item:{business_id:1,subject_id:12,source_id:13,source_content:'自己'}},
  {user:{mid:124},item:{business_id:17,subject_id:12,source_id:14,source_content:'动态'}}]}};
  const arr=normalizeReplyNotifications(raw,'900');
  assert.equal(arr.length,1);assert.equal(arr[0].aid,'456');assert.equal(arr[0].rpid,'789');assert.equal(arr[0].root,'345');
});

test('热门评论解析包含作者UID且排除自己',()=>{
  const rows=normalizeTopComments({comments:[{rpid:2,mid:900,content:'我'},{rpid:3,mid:123,content:'大肥鱼来吃饭'}]},'BV1abcdEFG12','900');
  assert.equal(rows.length,1);assert.equal(rows[0].uid,'123');
});

test('后台热评：优先回复投喂留言、跨重启去重，忽略不相关留言',async()=>{
  const dir=await tmp();const sent=[],calls=[];
  const c={watchReplies:false,watchTop:true,topCount:5,topVideoCount:1,replyPerPoll:1,replyPerDay:3,allowGeneralTop:false};
  const make=()=>createCommentInteract({dataDir:dir,selfUid:()=> '900',getConfig:()=>c,now:()=>1790000000000,
    getNotifications:async()=>({data:{items:[]}}),getVideos:async()=>['BV1abcdEFG12'],
    getComments:async()=>({comments:[{rpid:1,mid:100,content:'没关系'}, {rpid:2,mid:101,content:'大肥鱼来吃饭啦'}]}),
    generateReply:async r=>(calls.push(r),'来了来了（探头'),send:async r=>(sent.push(r),{ok:true}),logger:silent});
  assert.equal((await make().poll()).sent,1);assert.equal(sent[0].rpid,'2');
  assert.equal((await make().poll()).sent,0);assert.equal(calls.length,1);
});

test('评论通知：首次基线不追发旧消息，之后新消息才回复',async()=>{
  const dir=await tmp();const items=[],sent=[];
  const obj=(rpid)=>({user:{mid:123},item:{business_id:1,subject_id:987,source_id:rpid,root_id:777,source_content:'大肥鱼来吃饭啦'}});
  items.push(obj(1));
  const make=()=>createCommentInteract({dataDir:dir,selfUid:()=> '900',getConfig:()=>({watchReplies:true,watchTop:false,replyPerPoll:1,replyPerDay:5}),
    getNotifications:async()=>({data:{items}}),getVideos:async()=>[],getComments:async()=>({comments:[]}),
    generateReply:async()=> '哈哈来了',send:async r=>(sent.push(r),{ok:true}),logger:silent});
  assert.equal((await make().poll()).baselined,1);
  items.push(obj(2));assert.equal((await make().poll()).sent,1);
  assert.equal(sent[0].aid,'987');assert.equal(sent[0].rpid,'2');
  assert.equal((await make().poll()).sent,0);
});

test('同一AI队列隔离私信与其他用户的公开评论，防止单次模型请求串线',async()=>{
  const requests=[];
  const model=createInteractionBatcher({getPersona:()=> '轻松自然',delayMs:15,
    invoke:async prompt=>{requests.push(prompt);const inp=JSON.parse(prompt.split('消息：').at(-1));return JSON.stringify({items:inp.map((x,i)=>({id:String(i),reply:x.kind==='dm'?'你好':'投喂成功'}))});}});
  const [a,b]=await Promise.all([model.generate({kind:'dm',uid:'100',text:'嗨'}),model.generate({kind:'comment',uid:'200',text:'大肥鱼来吃饭'})]);
  assert.equal(a,'你好');assert.equal(b,'投喂成功');assert.equal(requests.length,2);model.stop();
});

test('热门评论保留平台原始时间，过期评论不会被误当成新提议',()=>{
  const rows=normalizeTopComments({comments:[{rpid:9,mid:123,ctime:1790000000,content:'有空了解一下天文学'}]},'BV1abcdEFG12','900')
  assert.equal(rows.length,1);assert.equal(rows[0].timestampMs,1790000000000)
})
