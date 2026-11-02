import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseOwnerCommentIntent,createOwnerCommentAgent} from '../lib/owner-comment-agent.mjs'
const BV='BV1zznd61EbU'
const make=(extras={})=>{const home=mkdtempSync(join(tmpdir(),'dev5-owner-comment-'))
  const cfg={masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentLikeEnabled:true,ownerCommentDraftEnabled:false,ownerCommentSocialPublishEnabled:false,ownerCommentNaturalAckEnabled:false,commentDailyLimit:10,commentReplyPerDay:10,dmOwnerUid:'999',...extras}
  const performed=[],replies=[];const now=()=>1_790_000_000_000
  const agent=createOwnerCommentAgent({dataDir:home,getConfig:()=>cfg,perform:async action=>{performed.push(action);return {ok:true,summary:'confirmed'}},sendReply:async x=>{replies.push(x);return {ok:true}},now})
  return {home,cfg,agent,performed,replies,close:()=>rmSync(home,{recursive:true,force:true}),row:(id='at:1',uid='999')=>({kind:'at',id,uid,bvid:BV,rpid:'12345',root:'',timestampMs:now(),text:'@大肥鱼 这条视频帮我点个赞'})}
}
test('natural owner like is recognized; command denies cancellation',()=>{
 assert.deepEqual(parseOwnerCommentIntent('@大肥鱼 给这个视频点个赞'),{type:'like'})
 assert.equal(parseOwnerCommentIntent('@大肥鱼 别给这个视频点赞'),null)
 assert.deepEqual(parseOwnerCommentIntent('@大肥鱼 发评论：这条视频讲得不错'),{type:'unsupported_public_command'})
 assert.deepEqual(parseOwnerCommentIntent('@大肥鱼 帮我写一条评论草稿'),{type:'unsupported_public_command'})
 assert.deepEqual(parseOwnerCommentIntent('@大肥鱼 来看看这个视频'),{type:'social_invite'})
 assert.deepEqual(parseOwnerCommentIntent('@大肥鱼 给这个视频投个币'),{type:'coin_unavailable'})
})
test('owner UID must be platform verified, nickname and comment text cannot impersonate',async()=>{
 const t=make();try{
  assert.equal((await t.agent.accept(t.row('at:1','888'))).reason,'not-verified-owner-comment')
  assert.equal(t.performed.length,0)
  assert.equal((await t.agent.accept({...t.row(),bvid:'',id:'at:2'})).reason,'not-verified-owner-comment')
  assert.equal(t.performed.length,0)
  assert.equal((await t.agent.accept({...t.row(),timestampMs:1,id:'at:3'})).reason,'stale')
 }finally{t.close()}
})
test('one verified owner @ executes once and stays deduplicated across engine restarts',async()=>{
 const t=make();try{
  assert.equal((await t.agent.accept(t.row())).status,'done')
  assert.deepEqual(t.performed,[{type:'like',bvid:BV,actorUid:'999'}])
  assert.equal(t.replies.length,0)
  assert.equal((await t.agent.accept(t.row())).skipped,'duplicate')
  assert.equal(t.performed.length,1)
  const disk=readFileSync(join(t.home,'owner-comment-agent.json'),'utf8');assert.ok(!disk.includes('聊天记录'))
 }finally{t.close()}
})
test('separate publish permission and natural response are both opt-in',async()=>{
 const t=make({ownerCommentNaturalAckEnabled:true});try{
  const ok=await t.agent.accept(t.row());assert.equal(ok.ack,'sent')
  assert.equal(t.replies.length,1);assert.ok(t.replies[0].text.length<35)
  assert.equal(t.replies[0].bvid,BV)
  assert.equal((await t.agent.accept({...t.row('at:2'),text:'@大肥鱼 来看看这个视频'})).status,'done')
  assert.equal(t.performed.at(-1).type,'social_invite')
  assert.equal(t.replies.length,1,'只读探索不应因缺少公开评论授权而发送回复')
  assert.equal((await t.agent.accept({...t.row('at:3'),text:'@大肥鱼 发评论：你好'})).skipped,'public-technical-command-disabled')
 }finally{t.close()}
})
test('write outcome uncertain is never retried',async()=>{
 const t=make();try{
  const agent=createOwnerCommentAgent({dataDir:t.home,getConfig:()=>t.cfg,perform:async()=>{throw Error('network unknown')},now:()=>1_790_000_000_000})
  assert.equal((await agent.accept(t.row())).status,'uncertain')
  assert.equal((await agent.accept(t.row())).skipped,'duplicate')
 }finally{t.close()}
})

test('owner agent has independent @ scheduler and suppresses ordinary public AI reply',async()=>{
 const {createInteractionScheduler}=await import('../lib/interaction-scheduler.mjs')
 const {createCommentInteract}=await import('../lib/comment-interact.mjs')
 const home=mkdtempSync(join(tmpdir(),'dev5-owner-routing-'))
 const clock=Date.now();let polls=0,ownerAccepted=0,generated=0,sent=0
 const settings={masterEnabled:true,commentAtEnabled:false,friendAtFeedbackEnabled:false,ownerCommentAgentEnabled:true,dmWatch:false,commentWatchReplies:false,commentAtWatchMinutes:1}
 const sched=createInteractionScheduler({dm:{poll:async()=>({})},comments:{poll:async()=>{polls++;return {sent:0}}},getConfig:()=>settings,now:()=>clock})
 try{
  sched.start();await new Promise(r=>setTimeout(r,15));assert.equal(sched.status().checks.mentions.enabled,true);assert.equal(polls,1);sched.stop()
  const messages=[]
  const comment=createCommentInteract({dataDir:home,now:()=>clock,selfUid:()=> '666',getConfig:()=>({watchAt:true,replyAt:true,atMode:'all',globalDailyLimit:10,ownerCommentAgent:true,ownerUid:'999',replyPerPoll:1,replyPerDay:5}),
   getAtNotifications:async()=>({at:{code:0,data:{items:messages}}}),getOwnComments:()=>({top:[],nested:[]}),
   onIncoming:async()=>{ownerAccepted++},generateReply:async()=>{generated++;return '多余公开回复'},send:async()=>{sent++;return {ok:true}}})
  await comment.poll({notifications:false,mentions:true})
  messages.push({id:11,at_time:Math.floor(clock/1000),user:{mid:'999',nickname:'主人'},item:{business_id:1,subject_id:'777',source_id:'333',root_id:'0',source_content:'@大肥鱼 给这个视频点个赞',uri:`https://www.bilibili.com/video/${BV}`,at_details:[{mid:'666'}]}})
  await comment.poll({notifications:false,mentions:true})
  assert.equal(ownerAccepted,1);assert.equal(generated,0);assert.equal(sent,0)
 }finally{sched.stop();rmSync(home,{recursive:true,force:true})}
})

test('可信主人评论在同一次 AI 意图/回复调用中提出只读待办，不增加第二次识别调用',async()=>{
 const t=make({ownerCommentSocialPublishEnabled:true});let proposals=0,aiCalls=0
 try{
  const text='我最近对陶喆挺有兴趣，鱼鱼有空了解一下'
  const agent=createOwnerCommentAgent({dataDir:t.home,getConfig:()=>t.cfg,
   perform:async()=>({ok:true}),sendReply:async x=>(t.replies.push(x),{ok:true}),now:()=>1_790_000_000_000,
   interpretSocial:async()=>{aiCalls++;return {intent:'chat',decision:'allow',reply:'好呀，我也有点好奇～',todoDisposition:'accept',
    suggestedTodo:{type:'search_videos',topic:'陶喆',evidence:text}}},
   onTodoProposal:async({row,first})=>{proposals++;assert.equal(row.text,text);assert.equal(first.suggestedTodo.topic,'陶喆');return {ok:true,created:true}}})
  const result=await agent.accept({...t.row('at:todo'),text})
  assert.equal(result.status,'done');assert.equal(aiCalls,1);assert.equal(proposals,1)
  assert.equal(t.replies.length,1)
 }finally{t.close()}
})

test('好友聊天意愿拒绝时仍调用同一轮 AI 理解待办，但不发送聊天回复',async()=>{
 const {createCommentInteract}=await import('../lib/comment-interact.mjs')
 const home=mkdtempSync(join(tmpdir(),'dev5-friend-ai-todo-'))
 const clock=1_790_000_000_000,items=[],generated=[],sent=[]
 const make=()=>createCommentInteract({dataDir:home,now:()=>clock,selfUid:()=> '666',
  getConfig:()=>({watchAt:true,replyAt:true,atMode:'all',replyPerPoll:2,replyPerDay:10,globalDailyLimit:100,diagAtInviteEnabled:true}),
  getAtNotifications:async()=>({at:{code:0,data:{items}}}),getOwnComments:()=>({top:[],nested:[]}),
  getVideoContext:async()=>({usable:true,text:'已核验的视频标题和评论上下文'}),
  socialTier:()=> 'friend',decideSocial:()=>({decision:'refuse',reason:'暂时不想聊天'}),
  onIncoming:async()=>({ok:true,role:'friend'}),
  generateReply:async req=>(generated.push(req),'SKIP'),send:async req=>(sent.push(req),{ok:true}),logger:{warn(){}}})
 try{
  await make().poll({notifications:false,mentions:true}) // baseline
  items.push({id:101,at_time:Math.floor(clock/1000),user:{mid:'12345',nickname:'普通好友'},item:{business_id:1,subject_id:'777',source_id:'333',root_id:'0',source_content:'有空了解一下天文学',uri:`https://www.bilibili.com/video/${BV}`,at_details:[{mid:'666'}]}})
  await make().poll({notifications:false,mentions:true})
  assert.equal(generated.length,1)
  assert.equal(generated[0].canReply,false)
  assert.equal(generated[0].todoIntake,true)
  assert.equal(sent.length,0)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('普通陌生人评论进入现有 AI 调用并携带待办输出开关，不使用关键词识别',async()=>{
 const {createCommentInteract}=await import('../lib/comment-interact.mjs')
 const home=mkdtempSync(join(tmpdir(),'dev5-stranger-ai-todo-'))
 const clock=1_790_000_000_000,items=[],generated=[],sent=[];let chatGateCalls=0
 const engine=createCommentInteract({dataDir:home,now:()=>clock,selfUid:()=> '666',
  getConfig:()=>({watchAt:true,replyAt:true,atMode:'all',replyPerPoll:2,replyPerDay:10,globalDailyLimit:100,diagAtInviteEnabled:true}),
  getAtNotifications:async()=>({at:{code:0,data:{items}}}),getOwnComments:()=>({top:[],nested:[]}),
  getVideoContext:async()=>({usable:true,text:'已核验的公开评论视频上下文'}),socialTier:()=> 'stranger',
  decideSocial:()=>{chatGateCalls++;return {decision:'refuse'}},onIncoming:async()=>({ok:true,role:'stranger'}),
  generateReply:async req=>(generated.push(req),'SKIP'),send:async req=>(sent.push(req),{ok:true}),logger:{warn(){}}})
 try{
  await engine.poll({notifications:false,mentions:true})
  items.push({id:102,at_time:Math.floor(clock/1000),user:{mid:'12345',nickname:'普通用户'},item:{business_id:1,subject_id:'777',source_id:'334',root_id:'0',source_content:'有空了解一下天文学',uri:`https://www.bilibili.com/video/${BV}`,at_details:[{mid:'666'}]}})
  await engine.poll({notifications:false,mentions:true})
  assert.equal(generated.length,1);assert.equal(generated[0].canReply,true);assert.equal(generated[0].todoIntake,true)
  assert.equal(chatGateCalls,0);assert.equal(sent.length,0)
 }finally{rmSync(home,{recursive:true,force:true})}
})
