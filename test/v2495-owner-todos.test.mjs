import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'

const BV='BV19SJi6VEj1'
const mk=()=>mkdtempSync(join(tmpdir(),'dafeiyu-v2495-todos-'))

test('收到视频推荐自动变成只读观看待办，并且重复轮询不会重复创建',()=>{
 const home=mk();let now=Date.parse('2026-10-27T10:00:00Z')
 try{
  const todos=createOwnerTodoEngine({dataDir:home,now:()=>now})
  const first=todos.syncRecommendations([{bvid:BV,uid:'12345',at:now,source:'B站私信分享'}])
  assert.equal(first.added,1)
  const rows=todos.list();assert.equal(rows.length,1);assert.equal(rows[0].type,'watch_video');assert.equal(rows[0].source,'recommendation');assert.equal(rows[0].ownerAuthorized,false)
  assert.equal(todos.syncRecommendations([{bvid:BV,uid:'12345',at:now,source:'B站私信分享'}]).added,0)
  assert.match(readFileSync(join(home,'owner-todos.json'),'utf8'),/watch_video/)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('待办校验拒绝无效 BV/UID；自己的空间与通知任务无需目标',()=>{
 const home=mk();try{
  const todos=createOwnerTodoEngine({dataDir:home})
  assert.equal(todos.add({type:'watch_video',bvid:'BVbad'}).ok,false)
  assert.equal(todos.add({type:'inspect_creator_videos',uid:'0'}).ok,false)
  assert.equal(todos.add({type:'inspect_my_space'}).ok,true)
  assert.equal(todos.add({type:'check_notifications'}).ok,true)
  assert.equal(todos.add({type:'comment_video',bvid:BV,text:''}).ok,false)
  assert.equal(todos.add({type:'comment_video',bvid:BV,text:'这条视频挺有意思',ownerAuthorized:true}).ok,true)
  assert.equal(todos.add({type:'dm_friend',uid:'12345',text:'你好',ownerAuthorized:true}).ok,true)
  assert.equal(todos.add({type:'dm_friend',uid:'12345',text:'x'.repeat(451),ownerAuthorized:true}).ok,false)
  assert.doesNotMatch(JSON.stringify(todos.status()),/你好/,'管理中心状态接口不应返回待办正文')
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('只读待办可执行并记录完成；写入结果不确定时禁止自动重试',async()=>{
 const home=mk();try{
  const todos=createOwnerTodoEngine({dataDir:home})
  const read=todos.add({type:'watch_video',bvid:BV}).item
  const ok=await todos.run(read.id,async()=>({ok:true,summary:'已读取视频'}))
  assert.equal(ok.ok,true);assert.equal(ok.item.status,'done');assert.equal(ok.result.summary,'已读取视频')
  const write=todos.add({type:'like_video',bvid:BV,ownerAuthorized:true}).item
  const failed=await todos.run(write.id,async()=>({ok:false,uncertain:true,error:'平台回执不确定'}))
  assert.equal(failed.item.status,'uncertain')
  let retried=false;const retry=await todos.run(write.id,async()=>{retried=true;return {ok:true}})
  assert.equal(retry.ok,false);assert.equal(retried,false)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('延期任务在计划时间前不会进入择机上下文，到期后重新出现',()=>{
 const home=mk();let now=Date.parse('2026-10-27T10:00:00Z')
 try{
  const todos=createOwnerTodoEngine({dataDir:home,now:()=>now})
  const task=todos.add({type:'inspect_my_space'}).item
  assert.equal(todos.update(task.id,'defer',{dueAt:now+3600000}).ok,true)
  assert.equal(todos.context().length,0)
  now+=3600001;assert.equal(todos.context().length,1)
 }finally{rmSync(home,{recursive:true,force:true})}
})

import {listChosenOwnerTodos,updateChosenOwnerTodo} from '../lib/owner-todos.mjs'
test('dev40 chosen todo controls reject another account, stale receipt and fake completion',()=>{
 const home=mk();try{let t=Date.now();const engine=createOwnerTodoEngine({dataDir:home,now:()=>t});const one=engine.add({type:'watch_video',bvid:BV});const two=engine.add({type:'inspect_my_space'});assert.ok(one.ok&&two.ok);const allowed=row=>row.id===one.item.id;const [row]=listChosenOwnerTodos(engine,allowed);assert.equal(row.id,one.item.id);assert.equal(listChosenOwnerTodos(engine,allowed).length,1);assert.equal(updateChosenOwnerTodo(engine,allowed,{id:two.item.id,action:'dismiss'}).ok,false);assert.equal(updateChosenOwnerTodo(engine,allowed,{id:row.id,action:'done'}).ok,false);assert.equal(updateChosenOwnerTodo(engine,allowed,{id:row.id,action:'defer',updatedAt:row.updatedAt-1}).ok,false);t++;assert.equal(updateChosenOwnerTodo(engine,allowed,{id:row.id,action:'defer',updatedAt:row.updatedAt},t).ok,true)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('已授权写待办只承认原 running 尝试和原精确参数，撤销后不能派发',()=>{
 const home=mk();try{
  const e=createOwnerTodoEngine({dataDir:home})
  const task=e.add({type:'comment_video',bvid:BV,text:'原正文',ownerAuthorized:true}).item
  const attempt=e.begin(task.id).item
  assert.equal(e.isCurrentAttempt(attempt),true)
  assert.equal(e.isCurrentAttempt({...attempt,text:'替换正文'}),false)
  assert.equal(e.isCurrentAttempt({...attempt,bvid:'BV1abc234567'}),false)
  assert.equal(e.isCurrentAttempt({...attempt,attemptId:'stale'}),false)
  assert.equal(e.isCurrentAttempt({...attempt,ownerAuthorized:false}),false)
  assert.equal(e.update(task.id,'dismiss').ok,true)
  assert.equal(e.isCurrentAttempt(attempt),false)
 }finally{rmSync(home,{recursive:true,force:true})}
})
