import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {validateOwnerAiTodo} from '../lib/owner-ai-todo.mjs'
import {createOwnerDmAgent,selectSearchVideos} from '../lib/owner-dm-agent.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {createDualContextAgency} from '../lib/dual-context-agency.mjs'
import {createOwnerTodoFollowup} from '../lib/owner-todo-followup.mjs'
const uid='210228238',now=Date.parse('2026-11-01T12:00:00Z')
const msg='我也挺开心 给你更新了好几个版本 推荐你有时候听听孙燕姿的歌 好听的要死'
const candidate={type:'search_videos',topic:'孙燕姿 歌曲',title:'有空听听孙燕姿的歌（主人推荐）',evidence:'推荐你有时候听听孙燕姿的歌'}
const withDir=async cb=>{const dir=mkdtempSync(join(tmpdir(),'df-ai-todo-'));try{return await cb(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('AI 仅能从主人本次消息的真实推荐摘录生成只读待办',()=>{
  assert.deepEqual(validateOwnerAiTodo(candidate,msg),candidate)
  assert.equal(validateOwnerAiTodo({...candidate,evidence:'主人让我去听孙燕姿'},msg),null)
  assert.equal(validateOwnerAiTodo({...candidate,topic:'周杰伦 歌曲'},msg),null)
  assert.equal(validateOwnerAiTodo({...candidate,type:'dm_friend'},msg),null)
  assert.equal(validateOwnerAiTodo(candidate,'我不推荐你有时候听听孙燕姿的歌'),null)
  assert.equal(validateOwnerAiTodo(candidate,'转发：推荐你有时候听听孙燕姿的歌'),null)
  assert.equal(validateOwnerAiTodo({...candidate,type:'watch_video',bvid:'BV1abc234567'},msg),null)
})

test('主人同一条私信的现有模型调用返回待办，不增加提取调用或重播消息',()=>withDir(async dir=>{
  const todos=createOwnerTodoEngine({dataDir:dir,now:()=>now})
  let models=0,sends=0
  const cfg={masterEnabled:true,dmWatch:true,ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:true,dmOwnerUid:uid}
  const willing=createDualContextAgency({dataDir:dir,now:()=>now,getEmotion:()=>({energy:65,sociality:65,curiosity:75})})
  const agent=createOwnerDmAgent({dataDir:dir,getConfig:()=>cfg,now:()=>now,
    invokeModel:async()=>{models++;return JSON.stringify({action:'reply',text:'🐟 这个推荐我先记到待办里，以后有空找找。',suggestedTodo:candidate})},
    executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),send:async()=>{sends++;return {ok:true}},
    decideAgency:({uid:actor,messageId,text,intent,target})=>willing.decide({source:'bili-dm',uid:actor,messageId,text,intent,target}),
    onTodoSuggested:async({uid:actor,messageId,at,task})=>todos.add({...task,sourceKey:`owner-ai:${actor}:${messageId}`,
      note:'主人建议的只读探索',origin:{kind:'owner-dm',uid:actor,messageId,quotedText:'',at}},{source:'owner'})})
  agent.primeInbox([])
  const row={incoming:true,senderUid:uid,messageId:uid+':m01',timestampMs:now-1000,text:msg}
  assert.equal((await agent.processMessage(row)).ok,true)
  assert.equal(models,1);assert.equal(sends,1)
  assert.equal(todos.list().length,1)
  assert.equal(todos.list()[0].topic,'孙燕姿 歌曲')
  assert.equal(todos.list()[0].status,'open')
  assert.equal(todos.list()[0].ownerAuthorized,false)
  assert.equal(todos.list()[0].origin.quotedText,'')
  assert.equal((await agent.processMessage(row)).skipped,'duplicate')
  assert.equal(models,1);assert.equal(sends,1)
  assert.ok(!readFileSync(join(dir,'owner-todos.json'),'utf8').includes('更新了好几个版本'))
}))

test('B站搜索仅能提取真实 BV 候选，不能把搜索冒充听过',()=>{
  const rows=selectSearchVideos({data:{list:[{bvid:'BV1abc234567',title:'孙燕姿的歌'},{bvid:'BV1abc234567',title:'重复'},{bvid:'not-a-bvid',title:'假'}]}})
  assert.equal(rows.length,1);assert.equal(rows[0].bvid,'BV1abc234567')
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(source,/owner-ai-watch:/)
  assert.match(source,/已搜索「\$\{topic\}」，搜索结果尚不等于已实际听看/)
  assert.match(source,/runOwnerTodoWithFollowup/)
})

test('回访只接受已验证的关联观看任务，搜索、他人、重复都不能触发',()=>withDir(async dir=>{
  const f=createOwnerTodoFollowup({chooseReply:()=>({decision:'reply',text:'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。'}),dataDir:dir,getConfig:()=>({ownerTodoCompletionFollowupEnabled:true}),send:async()=>({ok:true}),now:()=>now,hourOf:()=>12})
  const task={id:'one',type:'watch_video',sourceKey:'owner-ai-watch:parent:BV1abc234567',bvid:'BV1abc234567',origin:{kind:'owner-dm',uid,messageId:'m01'},topic:'孙燕姿 歌曲'}
  assert.equal(f.queue({...task,type:'search_videos'},{ok:true}).queued,false)
  assert.equal(f.queue(task,{ok:false}).queued,false)
  assert.equal(f.queue({...task,origin:{uid:'',messageId:'m01'}},{ok:true}).queued,false)
  assert.equal(f.queue(task,{ok:true,data:{info:{title:'孙燕姿的音乐'}}}).queued,true)
  assert.equal(f.queue(task,{ok:true}).queued,false)
  assert.equal(f.status().pending,1)
}))

test('完成回访需独立授权、安静时间及主人身份，默认1小时每人冷却',()=>withDir(async dir=>{
  let t=now,sends=[]
  const cfg={masterEnabled:true,dmWatch:true,ownerTodoCompletionFollowupEnabled:false,dmOwnerUid:uid}
  const f=createOwnerTodoFollowup({chooseReply:()=>({decision:'reply',text:'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。'}),dataDir:dir,getConfig:()=>cfg,send:async(v)=>{sends.push(v);return {ok:true}},now:()=>t,hourOf:()=>12})
  const task=(id,bv)=>({id,type:'watch_video',sourceKey:'owner-ai-watch:p:'+bv,bvid:bv,origin:{kind:'owner-dm',uid,messageId:'one'},topic:'孙燕姿 歌曲'})
  assert.equal(f.queue(task('A','BV1abc234567'),{ok:true,data:{info:{title:'孙燕姿歌曲'}}}).reason,'not-opted-in')
  cfg.ownerTodoCompletionFollowupEnabled=true
  f.queue(task('A','BV1abc234567'),{ok:true,data:{info:{title:'孙燕姿歌曲'}}})
  cfg.ownerTodoCompletionFollowupEnabled=false
  assert.equal((await f.tick()).skipped,'disabled');assert.equal(sends.length,0)
  cfg.ownerTodoCompletionFollowupEnabled=true
  assert.equal((await f.tick()).status,'sent');assert.equal(sends.length,1)
  assert.equal(sends[0].text,'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。')
  f.queue(task('B','BV1abc234568'),{ok:true,data:{info:{title:'孙燕姿歌曲第二集'}}})
  assert.equal((await f.tick()).skipped,'两次回访最小间隔未结束')
  t+=3600000
  assert.equal((await f.tick()).status,'sent');assert.equal(sends.length,2)
}))

test('拒绝联系、结果不确定、身份切换不发消息，也不自动重试',()=>withDir(async dir=>{
  let calls=0
  const cfg={masterEnabled:true,dmWatch:true,ownerTodoCompletionFollowupEnabled:true,dmOwnerUid:uid}
  const task={id:'one',type:'watch_video',sourceKey:'owner-ai-watch:p:BV1abc234567',bvid:'BV1abc234567',origin:{kind:'owner-dm',uid,messageId:'m1'}}
  const f=createOwnerTodoFollowup({chooseReply:()=>({decision:'reply',text:'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。'}),dataDir:dir,getConfig:()=>cfg,send:async()=>{calls++;return {ok:false}},now:()=>now,hourOf:()=>12})
  f.queue(task,{ok:true});cfg.dmOwnerUid='999900001'
  assert.equal((await f.tick()).skipped,'empty');assert.equal(calls,0)
  cfg.dmOwnerUid=uid
  assert.equal((await f.tick()).status,'uncertain');assert.equal(calls,1)
  assert.equal((await f.tick()).skipped,'empty');assert.equal(calls,1)
}))

test('退订和夜间都阻止任务完成回访',()=>withDir(async dir=>{
  let sends=0,block=true,hour=23
  const cfg={masterEnabled:true,dmWatch:true,ownerTodoCompletionFollowupEnabled:true,dmOwnerUid:uid}
  const f=createOwnerTodoFollowup({chooseReply:()=>({decision:'reply',text:'我发现了一些相关公开视频资料，还有几处细节想慢慢弄清楚。'}),dataDir:dir,getConfig:()=>cfg,send:async()=>{sends++;return {ok:true}},canContact:()=>({blocked:block}),now:()=>now,hourOf:()=>hour})
  f.queue({id:'one',type:'watch_video',sourceKey:'owner-ai-watch:p:BV1abc234567',bvid:'BV1abc234567',origin:{uid,messageId:'m1'}},{ok:true})
  assert.equal((await f.tick()).skipped,'quiet-hours')
  hour=12;assert.equal((await f.tick()).skipped,'opted-out')
  block=false;assert.equal((await f.tick()).skipped,'empty');assert.equal(sends,0)
}))
