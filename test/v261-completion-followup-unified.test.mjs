import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {createOwnerTodoFollowup} from '../lib/owner-todo-followup.mjs'
import {intakePublicReadProposal} from '../lib/social-todo-intake.mjs'
import {receiveRecommendations} from '../lib/video-recommendations.mjs'
const BV='BV1abc234567',UID='123456789',UID2='222333444',T=Date.parse('2026-11-02T12:00:00Z')
const conf=()=>({masterEnabled:true,dmWatch:true,dmMode:'both',ownerTodoCompletionFollowupEnabled:true,socialTodoCompletionFollowupEnabled:true,dmOwnerUid:'999888777'})
const space=async fn=>{const dir=mkdtempSync(join(tmpdir(),'df-unified-followup-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const task=(id,channel,uid=UID)=>({id,type:'watch_video',bvid:BV,title:'已核实的视频',sourceKey:'recommendation:'+BV,
  origin:{kind:channel==='comment'?'bilibili-comment':'bilibili-dm',uid,messageId:uid+':req-'+id,
    commentBvid:channel==='comment'?BV:'',commentRpid:channel==='comment'?123456:0,commentRoot:0}})
test('普通私信提出并被接受的视频任务：原私信回访，不能改到公开评论',()=>space(async dir=>{
  const sent=[],f=createOwnerTodoFollowup({dataDir:dir,getConfig:conf,now:()=>T,hourOf:()=>12,
    chooseReply:()=>({decision:'reply',channel:'comment',familiar:true}),send:async r=>{sent.push(r);return {ok:true}}})
  assert.equal(f.queue(task('A','dm'),{ok:true}).queued,true)
  assert.equal((await f.tick()).status,'sent');assert.equal(sent.length,1);assert.equal(sent[0].channel,'dm')
  assert.equal((await f.tick()).skipped,'empty')
}))
test('评论请求在原楼层回复之前必须再次核实原作者UID',()=>space(async dir=>{
  let calls=0
  const f=createOwnerTodoFollowup({dataDir:dir,getConfig:conf,now:()=>T,hourOf:()=>12,
    verifyComment:async()=>false,send:async()=>{calls++;return {ok:true}}})
  f.queue(task('A','comment'),{ok:true})
  assert.equal((await f.tick()).skipped,'原评论核验失败');assert.equal(calls,0)
  assert.equal(f.status().recent[0].status,'blocked')
}))
test('评论区请求保持原地回访；熟人仅获独立许可后才能转私信',()=>space(async dir=>{
  const send=[];let verified=0
  const f=createOwnerTodoFollowup({dataDir:dir,getConfig:conf,now:()=>T,hourOf:()=>12,
    chooseReply:()=>({decision:'reply',channel:'dm',familiar:true}),
    canContact:r=>r.crossChannel?{blocked:true,reason:'没有私信许可'}:{blocked:false},
    verifyComment:async()=>{verified++;return true},send:async r=>{send.push(r);return {ok:true}}})
  f.queue(task('A','comment'),{ok:true})
  assert.equal((await f.tick()).status,'sent');assert.equal(send[0].channel,'comment')
  assert.equal(send[0].commentBvid,BV);assert.equal(send[0].commentRpid,123456);assert.equal(verified,1)
}))
test('评论区熟人已有独立私信授权，鱼鱼可自主选择私信',()=>space(async dir=>{
  const sent=[],f=createOwnerTodoFollowup({dataDir:dir,getConfig:conf,now:()=>T,hourOf:()=>12,
    chooseReply:()=>({decision:'reply',channel:'dm',familiar:true}),
    canContact:()=>({blocked:false}),verifyComment:()=>{throw Error('私信无须读评论发送，但不能失去原消息凭证')},
    send:async r=>{sent.push(r);return {ok:true}}})
  f.queue(task('A','comment'),{ok:true})
  assert.equal((await f.tick()).status,'sent');assert.equal(sent[0].channel,'dm')
}))
test('同一个公开视频由两位不同 UID 推荐：两个来源都保留，分日可分别回访',()=>space(async dir=>{
  const e=createOwnerTodoEngine({dataDir:dir,now:()=>T}),sent=[]
  e.syncRecommendations([{bvid:BV,uid:UID,messageId:'one',at:T,source:'B站私信分享',accepted:true},
    {bvid:BV,uid:UID2,messageId:'two',at:T,source:'B站私信分享',accepted:true}],{requireAccepted:true})
  const item=e.list()[0]
  assert.equal(item.recommendationSources.length,2)
  let t=T
  const f=createOwnerTodoFollowup({dataDir:dir,getConfig:conf,now:()=>t,hourOf:()=>12,send:async r=>{sent.push(r.uid);return {ok:true}}})
  assert.equal(f.queue(item,{ok:true}).added,2)
  await f.tick();t+=DAY;await f.tick()
  assert.deepEqual(new Set(sent),new Set([UID,UID2]))
}))
test('公开视频搜索待办只有通过统一意愿接受才创建，并保存评论原定位',()=>space(async dir=>{
  const e=createOwnerTodoEngine({dataDir:dir,now:()=>T})
  const row={incoming:true,senderUid:UID,messageId:'123:c101',timestampMs:T,text:'鱼鱼，搜一下无人机的视频',bvid:BV,rpid:998877,root:0}
  assert.equal(intakePublicReadProposal({row,channel:'comment',decide:()=>({decision:'refuse'}),todos:e,now:T}).accepted,false)
  assert.equal(e.list().length,0)
  assert.equal(intakePublicReadProposal({row,channel:'comment',decide:()=>({decision:'allow'}),todos:e,now:T}).accepted,true)
  assert.equal(e.list()[0].origin.commentRpid,998877)
  assert.equal(e.list()[0].origin.commentBvid,BV)
}))
test('评论缺少原评论ID时不得创建任意公开回访',()=>space(async dir=>{
  const f=createOwnerTodoFollowup({dataDir:dir,getConfig:conf,now:()=>T,hourOf:()=>12,send:()=>{throw Error('not sent')}})
  const original=task('A','comment');delete original.origin.commentRpid
  assert.equal(f.queue(original,{ok:true}).queued,false)
  assert.equal(f.status().pending,0)
}))
test('平台回执不确定必须冻结，不得自动重发',()=>space(async dir=>{
  let attempts=0
  const f=createOwnerTodoFollowup({dataDir:dir,getConfig:conf,now:()=>T,hourOf:()=>12,send:()=>{attempts++;return {ok:false}}})
  f.queue(task('A','dm'),{ok:true})
  assert.equal((await f.tick()).status,'uncertain')
  assert.equal((await f.tick()).skipped,'empty');assert.equal(attempts,1)
}))
test('旧版本 pending 回访记录保持原始 UID，不猜测评论来源',()=>space(async dir=>{
  writeFileSync(join(dir,'owner-todo-followups.json'),JSON.stringify({version:1,items:[{taskId:'old',uid:'999888777',bvid:BV,title:'旧视频',topic:'',at:T,status:'pending',reason:''}],lastSentAt:0}))
  let actual=[];const f=createOwnerTodoFollowup({dataDir:dir,getConfig:conf,now:()=>T,hourOf:()=>12,send:async r=>{actual.push(r);return {ok:true}}})
  assert.equal((await f.tick()).status,'sent');assert.equal(actual[0].channel,'dm')
  assert.equal(f.status().recent[0].status,'sent')
}))
test('鱼鱼有权延期或拒绝回访，任务成功不代表必须发送',()=>space(async dir=>{
  let attempts=0,t=T
  const f=createOwnerTodoFollowup({dataDir:dir,getConfig:conf,now:()=>t,hourOf:()=>12,
    chooseReply:()=>({decision:'defer'}),send:()=>{attempts++;return {ok:true}}})
  f.queue(task('A','dm'),{ok:true})
  assert.equal((await f.tick()).skipped,'鱼鱼选择延期')
  assert.equal(f.status().pending,1)
  assert.equal((await f.tick()).skipped,'鱼鱼选择延期，等待下次考虑')
  t+=6*3600_000;assert.equal((await f.tick()).skipped,'鱼鱼选择延期')
  assert.equal(attempts,0)
}))
const DAY=86400000
