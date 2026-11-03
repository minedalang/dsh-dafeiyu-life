import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {createOwnerTodoFollowup,followupLimits} from '../lib/owner-todo-followup.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
const T=Date.parse('2026-11-02T12:00:00Z'),BV=['BV1abc234567','BV1abc234568','BV1abc234569']
const uid='123456789',owner='987654321'
const conf=()=>({masterEnabled:true,ownerTodoCompletionFollowupEnabled:true,dmWatch:true,dmOwnerUid:uid})
const inSpace=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-followup-next-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const request=(id,mid='m01')=>({id,type:'watch_video',bvid:BV[0],title:'可核实视频',origin:{kind:'owner-dm',uid,messageId:mid},sourceKey:'owner-ai-watch:parent:'+BV[0]})
test('回访宽范围配置：默认1小时/12条/5分钟，明确允许0冷却和0间隔',()=>{
 assert.deepEqual(followupLimits({}),{cooldownMinutes:60,dailyLimit:12,minIntervalMinutes:5,quietEnabled:true,quietStart:22,quietEnd:9})
 assert.deepEqual(followupLimits({ownerTodoFollowupCooldownMinutes:0,ownerTodoFollowupDailyLimit:1000,ownerTodoFollowupMinIntervalMinutes:0,ownerTodoFollowupQuietStartHour:0,ownerTodoFollowupQuietEndHour:0}),{cooldownMinutes:0,dailyLimit:1000,minIntervalMinutes:0,quietEnabled:true,quietStart:0,quietEnd:0})
})
test('同一人冷却与全局间隔均为0时可连续发送不同真实原请求，但仍去重',()=>inSpace(async dir=>{
 let sent=0
 const f=createOwnerTodoFollowup({chooseReply:()=>({decision:'reply',text:'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。'}),dataDir:dir,getConfig:()=>({...conf(),ownerTodoFollowupCooldownMinutes:0,ownerTodoFollowupMinIntervalMinutes:0,ownerTodoFollowupQuietStartHour:0,ownerTodoFollowupQuietEndHour:0}),now:()=>T,hourOf:()=>12,send:async()=>{sent++;return {ok:true}}})
 assert.equal(f.queue({...request('one'),sourceKey:'manual:one'},{ok:true}).queued,true)
 assert.equal(f.queue({...request('two','m02'),sourceKey:'manual:two'},{ok:true}).queued,true)
 assert.equal((await f.tick()).status,'sent');assert.equal((await f.tick()).status,'sent')
 assert.equal(sent,2);assert.equal((await f.tick()).skipped,'empty')
}) )
test('待办冷却会给每条pending展示最近检查原因和下次可尝试时间',()=>inSpace(async dir=>{
 let at=T
 const f=createOwnerTodoFollowup({chooseReply:()=>({decision:'reply',text:'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。'}),dataDir:dir,getConfig:conf,now:()=>at,hourOf:()=>12,send:async()=>({ok:true})})
 f.queue({...request('one'),sourceKey:'manual:one'},{ok:true});await f.tick()
 f.queue({...request('two','m02'),sourceKey:'manual:two'},{ok:true})
 assert.equal((await f.tick()).skipped,'两次回访最小间隔未结束')
 const row=f.status().recent.find(x=>x.status==='pending');assert.equal(row.lastCheckAt,T)
 assert.match(row.lastCheckReason,/最小间隔/);assert.ok(row.nextEligibleAt>T)
 at+=3600000;assert.equal((await f.tick()).status,'sent')
}))
test('同一原始私信三个子待办先完成两项不发送，最后一项结束汇总只回访一次',()=>inSpace(async dir=>{
 const todo=createOwnerTodoEngine({dataDir:dir,now:()=>T})
 const parent=todo.add({type:'search_videos',topic:'孙燕姿 歌曲',sourceKey:'owner-ai:'+owner+':m01',origin:{kind:'owner-dm',uid,messageId:'m01'}},{source:'owner'}).item
 const children=BV.map((bv,i)=>todo.add({type:'watch_video',bvid:bv,topic:'孙燕姿 歌曲',title:'孙燕姿歌 '+i,sourceKey:`owner-ai-watch:${parent.id}:${bv}`,origin:{kind:'owner-dm',uid,messageId:'m01'}},{source:'owner'}).item)
 let sent=[]
 const f=createOwnerTodoFollowup({chooseReply:()=>({decision:'reply',text:'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。'}),dataDir:dir,getConfig:conf,getTodos:()=>todo.list({includeClosed:true,limit:500}),now:()=>T,hourOf:()=>12,send:async x=>{sent.push(x);return {ok:true}}})
 for(const [i,child] of children.slice(0,2).entries()){
   todo.update(child.id,'done');assert.equal(f.queue({...child},{ok:true,data:{info:{title:'孙燕姿现场歌曲'}}}).queued,i===0)
 }
 assert.equal(f.status().pending,1)
 assert.match((await f.tick()).skipped,/等待同一原请求的其他子待办/)
 todo.update(children[2].id,'done')
 const queued=f.queue(children[2],{ok:true,data:{info:{title:'孙燕姿现场歌曲'}}})
 assert.equal(queued.queued,false);assert.equal(f.status().pending,1)
 assert.equal((await f.tick()).status,'sent');assert.equal(sent.length,1)
 assert.equal(sent[0].text,'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。');assert.equal(f.status().recent.find(x=>x.status==='sent').groupTotal,3)
 assert.equal(f.queue(children[2],{ok:true}).queued,false)
}))
test('旧三个pending安全合并；已有uncertain或sent则不自动再汇总',()=>inSpace(async dir=>{
 const parent=randomUUID()
 const todos=BV.map((bvid,i)=>({id:'c'+i,type:'watch_video',bvid,sourceKey:`owner-ai-watch:${parent}:${bvid}`,origin:{kind:'owner-dm',uid,messageId:'m01'},status:'done',topic:'孙燕姿'}))
 const legacy=todos.map((t,i)=>({...request(t.id),key:'old'+i,taskId:t.id,uid,channel:'dm',status:'pending',at:T,reason:'',topic:'孙燕姿'}))
 writeFileSync(join(dir,'owner-todo-followups.json'),JSON.stringify({version:1,items:legacy,sentHistory:[]}))
 let sends=0
 const f=createOwnerTodoFollowup({chooseReply:()=>({decision:'reply',text:'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。'}),dataDir:dir,getConfig:conf,getTodos:()=>todos,now:()=>T,hourOf:()=>12,send:async()=>{sends++;return {ok:true}}})
 assert.equal((await f.tick()).status,'sent');assert.equal(sends,1)
 assert.equal(f.status().recent.filter(x=>x.status==='merged').length,2)
 // If a prior attempt became uncertain, never replace it with a new aggregate send.
 const d=JSON.parse(readFileSync(join(dir,'owner-todo-followups.json'),'utf8'))
 d.items=d.items.map(x=>({...x,status:x.status==='sent'?'uncertain':'pending'}))
 writeFileSync(join(dir,'owner-todo-followups.json'),JSON.stringify(d))
 assert.equal((await f.tick()).skipped,'empty')
 assert.equal(sends,1)
}))
test('父任务后立即自主考虑最多3个子任务，独立计费且可决定停止',()=>inSpace(async dir=>{
 const todo=createOwnerTodoEngine({dataDir:dir,now:()=>T})
 const parent=todo.add({type:'search_videos',topic:'孙燕姿',sourceKey:'owner-ai:123:m01'},{source:'owner'}).item
 const children=BV.map(bvid=>todo.add({type:'watch_video',bvid,sourceKey:`owner-ai-watch:${parent.id}:${bvid}`},{source:'owner'}).item)
 let calls=0,seen=[]
 const planner=createAutonomousPlanner({dataDir:dir,getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:4}),getTodos:()=>todo.list({includeClosed:true,limit:500}),now:()=>T,
   invokeModel:async(_prompt)=>{calls++;return calls===1?JSON.stringify({action:'execute_read',id:children[0].id}):JSON.stringify({action:'skip'})},
   recheckWillingness:()=>({decision:'allow'}),executeRead:async id=>{seen.push(id);todo.update(id,'done');return {ok:true}},updateTodo:(id,action,opts)=>todo.update(id,action,opts),reflect:async()=>({ok:true}),reflectionStatus:()=>({pending:0})})
 const r=await planner.considerChildren(parent.id)
 assert.equal(r.considered,2);assert.equal(r.executed,1);assert.equal(seen.length,1)
 assert.equal(planner.status().runs,2)
}))

// A final voluntary dismissal must not strand the already queued group.
test('末尾子待办自主放弃仍结束整组等待；只汇报真实完成的部分',()=>inSpace(async dir=>{
 const todo=createOwnerTodoEngine({dataDir:dir,now:()=>T}),parent=randomUUID()
 const origin={kind:'owner-dm',uid,messageId:'same-real-request'},rows=BV.map(bvid=>todo.add({type:'watch_video',bvid,sourceKey:`owner-ai-watch:${parent}:${bvid}`,origin,topic:'孙燕姿'},{}).item)
 let sent=[];const f=createOwnerTodoFollowup({chooseReply:()=>({decision:'reply',text:'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。'}),dataDir:dir,getConfig:conf,getTodos:()=>todo.list({includeClosed:true,limit:500}),now:()=>T,hourOf:()=>12,send:async x=>{sent.push(x);return {ok:true}}})
 todo.update(rows[0].id,'done');assert.equal(f.queue(rows[0],{ok:true,data:{info:{title:'孙燕姿现场'}}}).queued,true)
 todo.update(rows[1].id,'dismiss');todo.update(rows[2].id,'dismiss')
 assert.equal((await f.tick()).status,'sent');assert.equal(sent.length,1);assert.equal(sent[0].text,'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。');assert.equal(f.status().recent.find(x=>x.status==='sent').groupTotal,3)
}))
test('同父任务混入其他原消息来源绝不能合并，避免越权泄露',()=>inSpace(async dir=>{
 const todo=createOwnerTodoEngine({dataDir:dir,now:()=>T}),parent=randomUUID()
 const rows=BV.map((bvid,i)=>todo.add({type:'watch_video',bvid,sourceKey:`owner-ai-watch:${parent}:${bvid}`,origin:{kind:'owner-dm',uid,messageId:i===2?'other':'first'},topic:'孙燕姿'},{}).item)
 rows.forEach(x=>todo.update(x.id,'done'));let sends=0
 const f=createOwnerTodoFollowup({chooseReply:()=>({decision:'reply',text:'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。'}),dataDir:dir,getConfig:conf,getTodos:()=>todo.list({includeClosed:true,limit:500}),now:()=>T,hourOf:()=>12,send:async()=>{sends++;return {ok:true}}})
 assert.equal(f.queue(rows[0],{ok:true,data:{info:{title:'孙燕姿现场'}}}).queued,false)
 assert.equal((await f.tick()).skipped,'empty');assert.equal(sends,0)
}))
test('可独立关闭夜间静默，不需要将小时配置成相同值',()=>inSpace(async dir=>{
 let count=0
 const f=createOwnerTodoFollowup({chooseReply:()=>({decision:'reply',text:'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。'}),dataDir:dir,getConfig:()=>({...conf(),ownerTodoFollowupQuietEnabled:false}),hourOf:()=>23,now:()=>T,send:async()=>{count++;return {ok:true}}})
 assert.equal(f.queue({...request('quiet'),sourceKey:'manual:quiet'},{ok:true}).queued,true)
 assert.equal((await f.tick()).status,'sent');assert.equal(count,1)
}))
