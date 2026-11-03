import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {createAutonomousPlanner,rankAcceptedTodos} from '../lib/autonomous-planner.mjs'
import {todoParentId,childOf,sameRequest,consistentChildGroup} from '../lib/todo-lineage.mjs'
import {createOwnerTodoFollowup} from '../lib/owner-todo-followup.mjs'

const HERE=new URL('../',import.meta.url)
const source=(file)=>readFileSync(new URL(file,HERE),'utf8')
const at=Date.parse('2026-11-02T13:00:00Z'),BV=['BV1abc234567','BV1abc234568','BV1abc234569']
const origin={kind:'bilibili-dm',uid:'10023',messageId:'real-msg-001',at}
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'fish-explore-'));try{await fn(dir)}finally{rmSync(dir,{force:true,recursive:true})}}

test('普通用户搜索可关联视频子待办，旧 owner-ai-watch 不丢失',()=>withDir(async dir=>{
 const todos=createOwnerTodoEngine({dataDir:dir,now:()=>at})
 const parent=todos.add({type:'search_videos',topic:'方大同',origin,sourceKey:'social-ai-read:verified'},{source:'recommendation'}).item
 const children=BV.map(bvid=>todos.add({type:'watch_video',bvid,topic:'方大同',origin,parentTodoId:parent.id,sourceKey:`explore-watch:${parent.id}:${bvid}`},{source:'recommendation'}).item)
 assert.equal(children[0].source,'recommendation')
 assert.equal(children[0].parentTodoId,parent.id)
 assert.ok(children.every(x=>childOf(x,parent.id)))
 assert.equal(todoParentId({...children[0],parentTodoId:''}),parent.id)
 assert.equal(childOf({type:'watch_video',sourceKey:`owner-ai-watch:${parent.id}:${BV[0]}`},parent.id),true)
 assert.equal(sameRequest(children[0],children[1]),true)
 assert.equal(sameRequest(children[0],{...children[1],origin:{...origin,uid:'999'}}),false)
 let calls=0,executed=0
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>at,getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:4}),getTodos:()=>todos.list({includeClosed:true,limit:500}),invokeModel:async()=>{calls++;return calls===1?JSON.stringify({action:'execute_read',id:children[0].id}):JSON.stringify({action:'skip'})},executeRead:async id=>{executed++;todos.update(id,'done');return {ok:true}},updateTodo:(id,action,options)=>todos.update(id,action,options),recheckWillingness:()=>({decision:'allow'}),reflect:async()=>({ok:true})})
 const outcome=await planner.considerChildren(parent.id)
 assert.equal(outcome.considered,2);assert.equal(executed,1);assert.equal(planner.status().runs,2)
}))

test('同一父ID混入不同 UID 或消息的子任务拒绝连续自主执行',()=>withDir(async dir=>{
 const todos=createOwnerTodoEngine({dataDir:dir,now:()=>at})
 const parent=todos.add({type:'search_videos',topic:'方大同',origin,sourceKey:'social-ai-read:verified'},{source:'recommendation'}).item
 const rows=BV.slice(0,2).map((bvid,i)=>todos.add({type:'watch_video',bvid,parentTodoId:parent.id,sourceKey:`explore-watch:${parent.id}:${bvid}`,origin:i===0?origin:{...origin,uid:'77777'}},{source:'recommendation'}).item)
 assert.equal(consistentChildGroup(rows),false)
 let modelCalls=0,actions=0
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>at,getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:4}),getTodos:()=>todos.list({includeClosed:true,limit:500}),invokeModel:async()=>{modelCalls++;return JSON.stringify({action:'execute_read',id:rows[0].id})},executeRead:async()=>{actions++;return {ok:true}},updateTodo:(id,action,opts)=>todos.update(id,action,opts),reflect:async()=>({ok:true})})
 const result=await planner.considerChildren(parent.id)
 assert.equal(result.reason,'mixed-provenance');assert.equal(modelCalls,0);assert.equal(actions,0)
}))

test('亲密度只是自主考虑加权，不授予任务执行或发送权限',()=>{
 const rows=[{id:'owner',source:'owner',createdAt:at,origin:{uid:'987'}},{id:'friend',source:'recommendation',createdAt:at,origin:{uid:'123'}},{id:'stranger',source:'recommendation',createdAt:at,origin:{uid:'456'}}]
 const ranked=rankAcceptedTodos(rows,{now:at,relationshipHint:uid=>({score:uid==='123'?88:uid==='456'?11:100,stage:'familiar'})})
 const friend=ranked.find(x=>x.id==='friend'),stranger=ranked.find(x=>x.id==='stranger')
 assert.equal(friend.relationshipScore,88);assert.ok(friend.relationshipContribution>stranger.relationshipContribution)
 assert.equal(friend.relationshipContribution,Math.round(88*.42))
 assert.ok(ranked.every(x=>x.ownerAuthorized!==true));assert.equal(ranked.find(x=>x.id==='owner').identityContribution,12)
})

test('普通人同源子待办只汇总回访一次，不混入其他人的内容',()=>withDir(async dir=>{
 const todos=createOwnerTodoEngine({dataDir:dir,now:()=>at})
 const parent=todos.add({type:'search_videos',topic:'方大同',origin,sourceKey:'social-ai-read:verified'},{source:'recommendation'}).item
 const children=BV.map(bvid=>todos.add({type:'watch_video',bvid,topic:'方大同',origin,parentTodoId:parent.id,sourceKey:`explore-watch:${parent.id}:${bvid}`},{source:'recommendation'}).item)
 let sent=0
 const follow=createOwnerTodoFollowup({dataDir:dir,now:()=>at,hourOf:()=>12,getTodos:()=>todos.list({includeClosed:true,limit:500}),getConfig:()=>({masterEnabled:true,socialTodoCompletionFollowupEnabled:true,ownerTodoFollowupQuietEnabled:false,ownerTodoFollowupCooldownMinutes:0,ownerTodoFollowupMinIntervalMinutes:0}),chooseReply:()=>({decision:'reply',text:'我找到了几首作品，已经了解其中部分公开资料。'}),send:async()=>{sent++;return {ok:true}}})
 todos.update(children[0].id,'done');follow.queue(children[0],{ok:true,data:{info:{title:'方大同音乐专辑'}}})
 assert.equal(sent,0);assert.match((await follow.tick()).skipped,/等待同一原请求/)
 todos.update(children[1].id,'dismiss');todos.update(children[2].id,'dismiss')
 assert.equal((await follow.tick()).status,'sent');assert.equal(sent,1)
}))

test('管理中心双列折叠、关系权重和不可见按钮已设置可读颜色',()=>{
 const html=source('lib/management-console.html'),js=source('lib/management-console.js'),host=source('index.js')
 assert.match(html,/#panel-relationships #friend-relationships-list\{display:grid;grid-template-columns:repeat\(2/)
 assert.match(js,/relation-details/);assert.match(js,/relation-dimensions/)
 assert.match(js,/relationshipContribution/);assert.match(js,/waitingContribution/)
 assert.match(host,/relationshipContribution:ranked.relationshipContribution/)
 assert.match(html,/#owner-todo-followup-check\{background:/)
 assert.match(html,/#owner-todo-prev,#panel-life #owner-todo-next\{background:/)
 assert.match(html,/max-width:730px/)
})
