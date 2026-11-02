import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createOwnerTodoFollowup} from '../lib/owner-todo-followup.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
const TIME=Date.parse('2026-11-02T12:00:00Z'),UID='210228238',BVS=['BV1abc234567','BV1abc234568','BV1abc234569']
const cfg=()=>({masterEnabled:true,dmWatch:false,dmMode:'off',ownerTodoCompletionFollowupEnabled:true,socialTodoCompletionFollowupEnabled:false,dmOwnerUid:UID,ownerTodoFollowupQuietEnabled:false})
const scoped=async cb=>{const dir=mkdtempSync(join(tmpdir(),'rc2-followup-hotfix-'));try{return await cb(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const task=(id,mid='m01')=>({id,type:'watch_video',bvid:BVS[0],sourceKey:'manual:'+id,origin:{kind:'owner-dm',uid:UID,messageId:mid},status:'done'})

test('完成回访独立授权：后台私信监听与视频报告都关闭也可处理同一主人真实请求',()=>scoped(async dir=>{
  let sent=0
  const followup=createOwnerTodoFollowup({dataDir:dir,getConfig:cfg,now:()=>TIME,hourOf:()=>12,send:async()=>{sent++;return {ok:true}}})
  assert.equal(followup.queue(task('a'),{ok:true}).queued,true)
  assert.equal((await followup.tick()).status,'sent');assert.equal(sent,1)
}))
test('没有完成回访独立授权或联系许可时仍不能私信',()=>scoped(async dir=>{
  let sent=0,granted=false
  const settings={...cfg(),ownerTodoCompletionFollowupEnabled:true}
  const f=createOwnerTodoFollowup({dataDir:dir,getConfig:()=>settings,now:()=>TIME,hourOf:()=>12,
    canContact:()=>({blocked:!granted,reason:'明确退订'}),send:async()=>{sent++;return {ok:true}}})
  f.queue(task('a'),{ok:true})
  assert.equal((await f.tick()).skipped,'opted-out');assert.equal(sent,0)
  settings.ownerTodoCompletionFollowupEnabled=false
  assert.equal(f.queue(task('b','m02'),{ok:true}).queued,false)
  granted=true
  assert.equal((await f.tick()).skipped,'disabled');assert.equal(sent,0)
}))
test('旧版因私信开关误拦截且从未发送：人工核验来源后才能重新考虑',()=>scoped(async dir=>{
  let sent=0
  const todo=createOwnerTodoEngine({dataDir:dir,now:()=>TIME})
  const t=todo.add({...task('a'),sourceKey:'manual:a'},{source:'owner'}).item
  todo.update(t.id,'done')
  const f=createOwnerTodoFollowup({dataDir:dir,getConfig:cfg,getTodos:()=>todo.list({includeClosed:true,limit:500}),now:()=>TIME,hourOf:()=>12,send:async()=>{sent++;return {ok:true}}})
  f.queue(t,{ok:true})
  const file=join(dir,'owner-todo-followups.json');const d=JSON.parse(readFileSync(file,'utf8'))
  d.items[0].status='blocked';d.items[0].reason='私信功能关闭';writeFileSync(file,JSON.stringify(d))
  const key=d.items[0].key
  assert.equal((await f.retryBlocked('not-the-key')).ok,false)
  assert.equal((await f.retryBlocked(key)).requeued,true)
  assert.equal(f.status().pending,1);assert.equal(sent,0)
  assert.equal((await f.tick()).status,'sent');assert.equal(sent,1)
  assert.equal((await f.retryBlocked(key)).ok,false)
  assert.equal((await f.tick()).skipped,'empty');assert.equal(sent,1)
}))
test('不同来源原消息混入同一父任务：旧 blocked 记录禁止重试',()=>scoped(async dir=>{
  const todo=createOwnerTodoEngine({dataDir:dir,now:()=>TIME}),parent=randomUUID()
  const children=BVS.map((bv,i)=>todo.add({type:'watch_video',bvid:bv,sourceKey:`owner-ai-watch:${parent}:${bv}`,
    origin:{kind:'owner-dm',uid:UID,messageId:i===2?'other':'first'}},{source:'owner'}).item)
  children.forEach(t=>todo.update(t.id,'done'))
  let sent=0
  const f=createOwnerTodoFollowup({dataDir:dir,getConfig:cfg,getTodos:()=>todo.list({includeClosed:true,limit:500}),now:()=>TIME,hourOf:()=>12,send:async()=>{sent++;return {ok:true}}})
  const file=join(dir,'owner-todo-followups.json')
  writeFileSync(file,JSON.stringify({version:1,items:[{key:'root',taskId:children[0].id,uid:UID,channel:'dm',social:false,originalMessageId:'first',status:'blocked',reason:'私信功能关闭',groupRoot:parent,at:TIME,attempts:0}],sentHistory:[]}))
  const result=await f.retryBlocked('root');assert.equal(result.ok,false)
  assert.match(result.error,/来源不一致/);assert.equal(sent,0)
}))
test('发送中断或不确定的旧账本绝不通过显式重试复活',()=>scoped(async dir=>{
  const todo=createOwnerTodoEngine({dataDir:dir,now:()=>TIME})
  const t=todo.add({...task('a')},{source:'owner'}).item;todo.update(t.id,'done')
  const f=createOwnerTodoFollowup({dataDir:dir,getConfig:cfg,getTodos:()=>todo.list({includeClosed:true,limit:500}),now:()=>TIME,hourOf:()=>12,send:async()=>({ok:true})})
  f.queue(t,{ok:true});const file=join(dir,'owner-todo-followups.json');const d=JSON.parse(readFileSync(file,'utf8'))
  d.items[0].status='blocked';d.items[0].reason='私信功能关闭';d.items[0].startedAt=TIME
  writeFileSync(file,JSON.stringify(d));assert.equal((await f.retryBlocked(d.items[0].key)).ok,false)
  d.items[0].status='uncertain';delete d.items[0].startedAt;writeFileSync(file,JSON.stringify(d));assert.equal((await f.retryBlocked(d.items[0].key)).ok,false)
}))
test('管理页回访轮询参数、独立回访授权和显式复核入口完整接线',()=>{
  const js=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const ui=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const front=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(js,/ownerTodoFollowupPollMinutes: z\.natural\(\)\.default\(2\)/)
  assert.match(js,/scheduleOwnerFollowup\(5000\)/)
  assert.match(js,/ownerTodoFollowup\.retryBlocked/)
  assert.doesNotMatch(js,/cfg\.dmWatch!==true\|\|cfg\.dmMode==='off'\)return \{blocked:true,reason:'私信功能关闭'/)
  assert.match(ui,/owner-todo-followup-poll/)
  assert.match(front,/ownerTodoFollowupPollMinutes:boundedInt/)
  assert.match(front,/复核后重新考虑/)
})
