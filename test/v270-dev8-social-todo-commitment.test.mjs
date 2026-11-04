import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {normalizeReplyNotifications} from '../lib/comment-inbox.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {createDualContextAgency} from '../lib/dual-context-agency.mjs'
import {intakeAiReadProposals} from '../lib/social-todo-intake.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {assessTodoReply} from '../lib/social-todo-reply-contract.mjs'
import {createCommentInteract} from '../lib/comment-interact.mjs'

const T=Date.parse('2026-11-04T00:20:00Z'),BV='BV1mzso6uEZh',UID='4851875';
const message='可爱大肥鱼，推荐给你一些音乐🎵【郎朗/曲谱同步/神演】巴拉基耶夫——伊斯拉美 Op.18；郎朗-2002.7.24韦尔比耶音乐节独奏会-演奏海顿、拉赫玛尼诺夫、勃拉姆斯、巴拉基耶夫';
const ideas=[
 {type:'search_videos',topic:'郎朗 巴拉基耶夫 伊斯拉美 音乐',searchGoal:'music',evidence:'推荐给你一些音乐'},
 {type:'search_videos',topic:'郎朗 韦尔比耶音乐节 独奏会',searchGoal:'music',evidence:'2002.7.24韦尔比耶音乐节独奏会'},
];
const notice=()=>{
 const found=normalizeReplyNotifications({data:{items:[{user:{mid:UID,uname:'推荐人'},item:{
  source_id:'123456',subject_id:'882347',business:'视频',business_id:1,source_content:message,
  uri:`https://www.bilibili.com/video/${BV}`,reply_time:T/1000}}]}},'987654');
 assert.equal(found.length,1);
 assert.equal(found[0].uid,UID);
 assert.equal(found[0].text,message);
 return found[0];
};
const record=(agency,channel)=>({uid,messageId,text,intent,target,thread})=>agency.recordAI({
 source:channel==='dm'?'bili-dm':'bili-comment',uid,messageId,text,intent,action:'read_todo',target,thread,decision:'allow'});
const intake=(dir,n,patch={})=>{
 const todos=createOwnerTodoEngine({dataDir:dir,now:()=>T,getAccountUid:()=>patch.account||'987654'});
 const agency=createDualContextAgency({dataDir:dir,now:()=>T});
 return {todos,process:payload=>intakeAiReadProposals({row:{incoming:true,senderUid:n.uid,messageId:n.id,timestampMs:n.timestampMs,
  text:n.text,senderName:n.name,bvid:n.bvid,rpid:n.rpid,root:n.root,thread:`${n.bvid}:${n.root}`},
  channel:'comment',currentMessages:[n.text],decide:record(agency,'comment'),todos,now:()=>T,...payload})};
};

// Entire one-turn path: a verified Bilibili reply -> the existing social AI ->
// evidence/UID checks -> durable owner-todos.json -> public reply.
test('陌生人一条公开评论推荐两首音乐：同一轮接受、分别入账、成功才可说记下',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev8-public-'));
 try{
  const n=notice(),{todos,process}=intake(dir,n);
  let calls=0,receipts=[];
  const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async prompt=>{
   calls++;assert.match(prompt,/suggestedTodos/);
   return JSON.stringify({items:[{id:'0',action:'reply',reply:'推荐的先记下啦，还没点开看，等我有空慢慢刷',
    todoDisposition:'accept',suggestedTodos:ideas,mood:'curious',intensity:1}]});
  }});
  const output=await batcher.generate({kind:'comment',uid:n.uid,text:n.text,messageId:n.id,allowTodoIntake:true,
   onTodoProposal:async p=>{const r=process(p);receipts.push(r);return r;}});
  assert.match(output,/记下啦/);
  assert.equal(calls,1);assert.equal(receipts[0].complete,true);
  assert.equal(receipts[0].createdCount,2);
  assert.equal(todos.list().length,2);
  assert.deepEqual(todos.list().map(t=>t.topic).sort(),ideas.map(x=>x.topic).sort());
  assert.ok(todos.list().every(t=>t.origin.uid===UID&&t.origin.kind==='bilibili-comment'&&t.ownerAuthorized===false));
  assert.ok(todos.list().every(t=>t.searchGoal==='music'));
  assert.ok(!readFileSync(join(dir,'owner-todos.json'),'utf8').includes('可爱大肥鱼'));
  const repeated=process({todoDisposition:'accept',suggestedTodos:ideas.slice().reverse()});
  assert.equal(repeated.complete,true);assert.equal(repeated.duplicateCount,2);
  assert.equal(todos.list().length,2);
  batcher.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('模型原话说记下但未接受：将真实回执反馈给同一模型；修订措辞仍由它决定',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev8-noaccept-'));
 try{
  const n=notice(),{todos,process}=intake(dir,n);
  const prompts=[];let calls=0;
  const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async prompt=>{
   prompts.push(prompt);calls++;
   return JSON.stringify({items:[calls===1
    ?{id:'0',action:'reply',reply:'推荐的先记下啦，等我慢慢看',todoDisposition:'none',mood:'curious',intensity:1}
    :{id:'0',action:'reply',reply:'这几首名字真有气势！我还没听过，想先查查是谁弹的。',todoDisposition:'none',mood:'curious',intensity:1}]});
  }});
  const out=await batcher.generate({kind:'comment',uid:n.uid,text:n.text,allowTodoIntake:true,onTodoProposal:process});
  assert.equal(out,'这几首名字真有气势！我还没听过，想先查查是谁弹的。');
  assert.equal(calls,2);assert.match(prompts[1],/没有修改、也不会替你写任何回复/);
  assert.equal(todos.list().length,0);
  batcher.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('模型首次漏写结构化接受，第二次自主补齐有证据的建议后真实入账，保留自己原句',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev8-correct-accept-'));
 try{
  const n=notice(),{todos,process}=intake(dir,n);let calls=0;
  const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async()=>{
   calls++;
   return JSON.stringify({items:[{id:'0',action:'reply',reply:'推荐的先记下啦，等我慢慢看',
     todoDisposition:calls===1?'none':'accept',suggestedTodos:calls===1?null:ideas,mood:'curious',intensity:1}]});
  }});
  const out=await batcher.generate({kind:'comment',uid:n.uid,text:n.text,allowTodoIntake:true,onTodoProposal:process});
  assert.match(out,/记下啦/);assert.equal(calls,2);assert.equal(todos.list().length,2);batcher.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('无法核实的证据不得入库：模型第二次改成自己的话，不用程序模板',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev8-invalid-'));
 try{
  const n=notice(),{todos,process}=intake(dir,n);let calls=0;
  const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async()=>{
   calls++;
   return JSON.stringify({items:[calls===1
    ?{id:'0',action:'reply',reply:'全都记下啦',todoDisposition:'accept',suggestedTodo:{type:'search_videos',topic:'不存在的艺人',evidence:message},mood:'neutral',intensity:0}
    :{id:'0',action:'reply',reply:'这几首都是你喜欢的演奏版本吗？',todoDisposition:'none',mood:'curious',intensity:1}]});
  }});
  const out=await batcher.generate({kind:'comment',uid:n.uid,text:n.text,allowTodoIntake:true,onTodoProposal:process});
  assert.equal(out,'这几首都是你喜欢的演奏版本吗？');assert.equal(todos.list().length,0);batcher.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('持久化失败、部分成功、模型重复口头承诺：禁止代写，第二次仍不可信就拒发',async()=>{
 const n=notice(),dir=mkdtempSync(join(tmpdir(),'dev8-fail-'));
 try{
  const {todos,process}=intake(dir,n);
  const partial=process({todoDisposition:'accept',suggestedTodos:[ideas[0],{type:'like_video',evidence:message,bvid:BV}]});
  assert.equal(partial.createdCount,1);assert.equal(partial.complete,false);
  assert.equal(assessTodoReply({texts:['两首都记下了！'],todoDisposition:'accept',intakeResult:partial}).ok,false);
  assert.equal(todos.list().length,1);
  const failed=intakeAiReadProposals({row:{incoming:true,senderUid:UID,messageId:'write-error',timestampMs:T,text:message},
   channel:'comment',todoDisposition:'accept',suggestedTodo:ideas[0],currentMessages:[message],decide:()=>({decision:'allow'}),
   todos:{add(){throw Error('disk unavailable')}},now:()=>T});
  assert.equal(failed.complete,false);
  assert.equal(assessTodoReply({texts:'先记下啦',todoDisposition:'accept',intakeResult:failed}).ok,false);
  assert.equal(assessTodoReply({texts:'还没记下',todoDisposition:'none'}).ok,true);
  let calls=0;const diagnostics=[];
  const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async()=>{
   calls++;return JSON.stringify({items:[{id:'0',action:'reply',reply:'推荐我已经记下了。',todoDisposition:'accept',suggestedTodos:ideas,mood:'neutral',intensity:0}]});
  }});
  const output=await batcher.generate({kind:'comment',uid:n.uid,text:n.text,allowTodoIntake:true,
   onTodoProposal:()=>({ok:false,error:'todo-ledger-unavailable'}),onTodoConsistency:d=>diagnostics.push(d)});
  assert.equal(output,'SKIP');assert.equal(calls,2);assert.equal(diagnostics[0].status,'suppressed-unverified');batcher.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('自然无承诺或已有可靠入账时不会触发第二次模型调用',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev8-noextra-'));
 try{
  const n=notice(),{todos,process}=intake(dir,n);let calls=0;
  const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async()=>{
   calls++;return JSON.stringify({items:[{id:'0',action:'reply',reply:'好啊，你推荐的版本听起来挺有意思。',todoDisposition:'none',mood:'neutral',intensity:0}]});
  }});
  const output=await batcher.generate({kind:'comment',uid:n.uid,text:n.text,allowTodoIntake:true,onTodoProposal:process});
  assert.match(output,/挺有意思/);assert.equal(calls,1);assert.equal(todos.list().length,0);batcher.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('其他平台相同数字、其他人原话、历史超时、强行写操作不生成只读待办',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev8-isolation-'));
 try{
  const n=notice(),{todos,process}=intake(dir,n);
  const invalid=[
   {row:{senderUid:'',messageId:n.id,timestampMs:T,incoming:true,text:message}},
   {row:{senderUid:UID,messageId:n.id,timestampMs:T-2*86400_000,incoming:true,text:message}},
  ];
  for(const {row} of invalid)assert.equal(intakeAiReadProposals({row,channel:'comment',todoDisposition:'accept',suggestedTodo:ideas[0],
   currentMessages:[message],decide:()=>({decision:'allow'}),todos,now:()=>T}).complete,false);
  assert.equal(process({todoDisposition:'accept',suggestedTodos:[{type:'follow_creator',uid:UID,evidence:message}]}).complete,false);
  assert.equal(process({todoDisposition:'accept',suggestedTodos:[{...ideas[0],topic:'周杰伦音乐'}]}).complete,false);
  assert.equal(todos.list().length,0);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('私信 AI 接受真实只读建议只记录一次意愿；本地第二个心情分数不再否决',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev8-dm-'));
 try{
  const todos=createOwnerTodoEngine({dataDir:dir,now:()=>T});
  const agency=createDualContextAgency({dataDir:dir,now:()=>T,getEmotion:()=>({energy:0,sociality:0,curiosity:0,valence:-100})});
  const r=intakeAiReadProposals({row:{incoming:true,senderUid:UID,messageId:'dm-evt',timestampMs:T,text:'有空听一下王菲的歌'},
   channel:'dm',todoDisposition:'accept',suggestedTodo:{type:'search_videos',topic:'王菲的歌',searchGoal:'music',evidence:'有空听一下王菲的歌'},
   currentMessages:['有空听一下王菲的歌'],decide:record(agency,'dm'),todos,now:()=>T});
  assert.equal(r.complete,true);assert.equal(todos.list()[0].topic,'王菲的歌');
  assert.equal(todos.list()[0].ownerAuthorized,false);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('真实评论轮询接线：已核验陌生人推荐进入同轮 TODO，并在成功入账后才发布回复',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev8-comment-poll-'));
 try{
  const todos=createOwnerTodoEngine({dataDir:dir,now:()=>T}),agency=createDualContextAgency({dataDir:dir,now:()=>T});
  let items=[],sendCalls=[],intakeCalls=0;
  const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async()=>JSON.stringify({items:[{
   id:'0',action:'reply',reply:'推荐的先记下啦，暂时还没听过',todoDisposition:'accept',suggestedTodos:ideas,mood:'neutral',intensity:0}]})});
  const engine=createCommentInteract({dataDir:dir,now:()=>T,selfUid:async()=> '987654',
   getConfig:()=>({watchReplies:true,watchTop:false,replyPerPoll:2,replyPerDay:10,globalDailyLimit:100}),
   getNotifications:async()=>({code:0,data:{items}}),getOwnComments:async()=>({top:new Set(),nested:new Set()}),
   getVideoContext:async()=>({usable:true,text:'公开视频已查到标题'}),
   generateReply:req=>batcher.generate({...req,allowTodoIntake:req.todoIntake!==false,
    onTodoProposal:p=>{intakeCalls++;return intakeAiReadProposals({
     row:{incoming:true,senderUid:req.uid,messageId:req.messageId,timestampMs:req.timestampMs,text:req.text,
      senderName:req.senderName,bvid:req.bvid,rpid:req.rpid,root:req.root,thread:req.thread},
     channel:'comment',...p,currentMessages:[req.text],decide:record(agency,'comment'),todos,now:()=>T})}}),
   send:async out=>{sendCalls.push(out);assert.equal(todos.list().length,2,'commit before outbound send');return {ok:true,rpid:'3333333'}},
   logger:{warn(){},error(){}}});
  await engine.poll({notifications:true,mentions:false,top:false});
  items=[{user:{mid:UID,uname:'推荐人'},item:{business_id:1,business:'视频',subject_id:'882347',source_id:'123456',
   root_id:'333333',target_id:'333333',source_content:message,reply_time:T/1000,uri:`https://www.bilibili.com/video/${BV}`}}];
  const first=await engine.poll({notifications:true,mentions:false,top:false});
  assert.equal(first.sent,1);assert.equal(intakeCalls,1);assert.equal(sendCalls.length,1);
  assert.match(sendCalls[0].text,/记下/);assert.equal(todos.list().length,2);
  const again=await engine.poll({notifications:true,mentions:false,top:false});
  assert.equal(again.sent,0);assert.equal(sendCalls.length,1);assert.equal(todos.list().length,2);
  batcher.stop();
 }finally{rmSync(dir,{recursive:true,force:true})}
});


test('私信事实冲突时仅可由模型修订；两次仍矛盾则跳过，没有程序固定话术',async()=>{
 const wrong='我这里就只有BV号，你把视频内容讲讲吧';let calls=0;
 const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async()=>{
  calls++;return JSON.stringify({items:[{id:'0',action:'reply',reply:wrong}]});
 }});
 try{
  const result=await batcher.generate({kind:'dm',uid:UID,text:'看看BV1sMpv6PEJm',recommendationContext:'已经收下 BV1sMpv6PEJm，列入待选'});
  assert.equal(result,'SKIP');assert.equal(calls,2);
 }finally{batcher.stop();}
});
