import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {createDmTodoProgressContext,correctDmTodoProgressReply} from '../lib/dm-todo-progress.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
const BV='BV1EYxt6yE7P',OTHER='BV19SJi6VEj1'
const withDir=async run=>{const dir=mkdtempSync(join(tmpdir(),'v262-dm-progress-'));try{await run(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const social=(todos,{uid='210228238',bvid=BV}={})=>todos.add({type:'watch_video',bvid,
 title:'鱼鱼有空看看：'+bvid,sourceKey:'social-ai-read:'+uid+':'+bvid,
 origin:{kind:'bilibili-dm',uid,messageId:'platform-msg-01',at:Date.now()}}, {source:'recommendation'}).item
const complete=(todos,task)=>todos.run(task.id,async()=>({ok:true,summary:'已读取视频详情、可用字幕与评论材料'}))

test('同一人已完成只读待办，未回访也能在普通私信获得真实进度',()=>withDir(async dir=>{
 const todos=createOwnerTodoEngine({dataDir:dir,getAccountUid:()=> '12345'})
 const task=social(todos);await complete(todos,task)
 const context=createDmTodoProgressContext({todos,taskAllowed:t=>t.accountUid==='12345'}).forReply({uid:'210228238',text:BV+' 这个视频最离谱哪一段'})
 assert.match(context,/待办已完成且具有成功执行回执/)
 assert.match(context,/已读取公开视频详情及可获取的字幕\/评论资料/)
 assert.match(context,/不等于亲眼观看画面、听到音乐/)
 assert.match(context,/无需等待主动回访/)
 assert.doesNotMatch(context,/尚未查阅/)
}))

test('两个陌生人提及同一个 BV，不泄露其他 UID 的私信待办',()=>withDir(async dir=>{
 const todos=createOwnerTodoEngine({dataDir:dir,getAccountUid:()=> '12345'}),task=social(todos)
 await complete(todos,task)
 const make=createDmTodoProgressContext({todos})
 // Same BV dedup can collect a second sender but must not disclose first sender's task.
 const row=todos.list({includeClosed:true})[0];row.recommendationSources=[{uid:'99999',channel:'dm'}]
 assert.equal(createDmTodoProgressContext({todos:{list:()=>[row]}}).forReply({uid:'99999',text:BV}),'')
 assert.equal(make.forReply({uid:'99999',text:BV+' 看了没'}),'')
 assert.equal(make.forReply({uid:'210228238',text:OTHER+' 看了没'}),'')
 assert.equal(make.forReply({uid:'abc',text:BV+' 看了没'}),'')
 assert.equal(make.forReply({uid:'210228238',text:'聊天气'}),'')
 assert.match(make.forReply({uid:'210228238',text:'🍚🍚🍚',history:[{role:'user',text:'之前推荐 '+BV,at:Date.now()-15*60_000}]}),/待办已完成且具有成功执行回执/)
 assert.equal(make.forReply({uid:'210228238',text:'🍚🍚🍚',history:[{role:'user',text:'之前推荐 '+BV,at:Date.now()-2*3600_000}]}),'')
}))

test('当前账号绑定不匹配禁止复用旧账号的待办记录',()=>withDir(async dir=>{
 const todos=createOwnerTodoEngine({dataDir:dir,getAccountUid:()=> '12345'}),task=social(todos)
 await complete(todos,task)
 const make=createDmTodoProgressContext({todos,taskAllowed:t=>t.accountUid==='99999'})
 assert.equal(make.forReply({uid:'210228238',text:BV+' 进度？'}),'')
}))

test('仅被手动标记完成的待办不能冒充成功执行回执',()=>withDir(async dir=>{
 const todos=createOwnerTodoEngine({dataDir:dir}),task=social(todos)
 todos.update(task.id,'done')
 const ctx=createDmTodoProgressContext({todos}).forReply({uid:'210228238',text:BV})
 assert.match(ctx,/缺少可核验的成功执行回执/)
 assert.doesNotMatch(ctx,/待办已完成且具有成功执行回执/)
 // A reopened task manually completed after an older success is not re-verified.
 const fresh=social(todos,{bvid:OTHER});await complete(todos,fresh)
 todos.update(fresh.id,'reopen');todos.update(fresh.id,'done')
 const again=createDmTodoProgressContext({todos}).forReply({uid:'210228238',text:OTHER})
 assert.match(again,/缺少可核验的成功执行回执/)
}))

test('延期和候选不等于完成；同一会话用户历史可安全回指 BV',()=>withDir(async dir=>{
 const todos=createOwnerTodoEngine({dataDir:dir}),task=social(todos)
 todos.update(task.id,'defer',{dueAt:Date.now()+3600_000})
 const make=createDmTodoProgressContext({todos})
 assert.match(make.forReply({uid:'210228238',text:BV}),/鱼鱼选择延期/)
 assert.match(make.forReply({uid:'210228238',text:'那个视频怎么样啦',history:[{role:'user',text:'之前推荐 '+BV}]}),/鱼鱼选择延期/)
 assert.equal(make.forReply({uid:'210228238',text:'那个视频怎么样啦',history:[{role:'assistant',text:'之前推荐 '+BV}]}),'')
}))

test('模型误称“还没看”时，已核验进度触发保守纠正但不冒称看过',()=>withDir(async dir=>{
 const todos=createOwnerTodoEngine({dataDir:dir}),task=social(todos);await complete(todos,task)
 const todoProgressContext=createDmTodoProgressContext({todos}).forReply({uid:'210228238',text:BV+' 看了吗'})
 const bad='那个魔鱼视频我还没看呢，以后再看看吧'
 assert.equal(correctDmTodoProgressReply(bad,''),bad)
 assert.match(correctDmTodoProgressReply(bad,todoProgressContext),/已经查过/)
 assert.match(correctDmTodoProgressReply(bad,todoProgressContext),/不等于我亲眼看过画面/)
 assert.equal(correctDmTodoProgressReply('资料已经查过啦，我还不能说自己看过完整画面',todoProgressContext),'资料已经查过啦，我还不能说自己看过完整画面')
 let prompt=''
 const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async p=>{
  prompt=p;return JSON.stringify({items:[{id:'0',action:'reply',reply:bad,mood:'neutral',intensity:0}]})
 }})
 try{
  const reply=await batcher.generate({kind:'dm',uid:'210228238',text:BV+' 看了吗',todoProgressContext})
  assert.match(prompt,/"todoProgressContext":/)
  assert.match(prompt,/待办已完成且具有成功执行回执/)
  assert.match(reply,/已经查过/)
  assert.doesNotMatch(reply,/以后再看看吧/)
 }finally{batcher.stop()}
}))

test('宿主真正把同一人待办进度传入普通私信，而非只用于主动回访',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(index,/const dmTodoProgressContext=createDmTodoProgressContext/)
 assert.match(index,/const todoProgressContext=dmTodoProgressContext\.forReply\(req\)/)
 assert.match(index,/recommendationContext,todoProgressContext,identityContext/)
})
