import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {resolveTodoFollowupContext,anchorTodoFollowupText} from '../lib/todo-followup-context.mjs'
import {createOwnerTodoFollowup} from '../lib/owner-todo-followup.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
const at=Date.parse('2026-11-03T16:00:00Z'),uid='210228238',BV='BV1abc234567'
const origin={kind:'owner-dm',uid,messageId:'trusted-m1'}
const config=()=>({masterEnabled:true,ownerTodoCompletionFollowupEnabled:true,dmOwnerUid:uid,ownerTodoFollowupQuietEnabled:false,
  ownerTodoFollowupCooldownMinutes:0,ownerTodoFollowupMinIntervalMinutes:0})
const temp=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-topic-anchor-'));try{await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
test('已汇总3条视频不是原请求名称；从关联父待办获取真实主题并补足自然回访背景',()=>temp(async dir=>{
 const todos=createOwnerTodoEngine({dataDir:dir,now:()=>at})
 const parent=todos.add({type:'search_videos',title:'听大肥鱼翻唱的歌',topic:'大肥鱼翻唱',origin},{source:'owner'}).item
 const child=todos.add({type:'watch_video',bvid:BV,title:'鱼鱼看看视频',topic:'大肥鱼翻唱',parentTodoId:parent.id,sourceKey:`owner-ai-watch:${parent.id}:${BV}`,origin},{source:'owner'}).item
 todos.update(child.id,'done')
 const sent=[];let context
 const follow=createOwnerTodoFollowup({dataDir:dir,getTodos:()=>todos.list({includeClosed:true,limit:500}),getConfig:config,
   now:()=>at,hourOf:()=>13,chooseReply:req=>{context=req.requestContext;return {decision:'reply',text:'刚刚查了那几个公开视频的资料，有点想跟你聊聊。'}},
   send:async row=>{sent.push(row);return {ok:true}}})
 follow.queue(child,{ok:true,data:{info:{title:'大肥鱼翻唱视频资料'}}})
 const r=await follow.tick()
 assert.equal(r.status,'sent')
 assert.equal(sent.length,1)
 assert.equal(context.subject,'听大肥鱼翻唱的歌')
 assert.match(sent[0].text,/听大肥鱼翻唱的歌/)
 assert.match(sent[0].text,/刚刚查了/)
 assert.doesNotMatch(sent[0].text,/已汇总\s*\d+项/)
 assert.equal(sent[0].uid,uid)
}))
test('已点明原请求的自然回访不重复套固定话术',()=>{
 const c={ok:true,subject:'听大肥鱼翻唱的歌',videos:[]}
 const out=anchorTodoFollowupText('关于听大肥鱼翻唱的歌，我找到些公开视频资料。',c)
 assert.equal(out.anchored,false)
 assert.equal(out.text,'关于听大肥鱼翻唱的歌，我找到些公开视频资料。')
})
test('不同收件人的原始请求不能借用，缺少可信主题不发送，不能把别的BV串进来',()=>{
 const row={uid,originalMessageId:'m1',groupRoot:'root',taskId:'child',title:'已汇总 3 项相关视频资料'}
 assert.equal(resolveTodoFollowupContext(row,[{id:'root',title:'其他人的私人请求',origin:{uid:'485221842',messageId:'m2'}}]).ok,false)
 assert.equal(resolveTodoFollowupContext(row,[]).ok,false)
 const c={ok:true,subject:'听大肥鱼翻唱的歌',videos:[BV]}
 assert.equal(anchorTodoFollowupText('我看了 BV1xyz234567，真有趣。',c).ok,false)
})
