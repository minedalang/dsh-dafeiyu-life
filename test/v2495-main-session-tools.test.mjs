import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLongTermMemory} from '../lib/long-term-memory.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'

const BV='BV19SJi6VEj1'

test('选定主 Session 即使关闭身份长期记忆，也能回忆真实经历并使用自主待办工具',async()=>{
 const home=mkdtempSync(join(tmpdir(),'dafeiyu-v2495-session-tools-'))
 const tools=[],listeners=new Map(),sections=[],contexts=[]
 const session={snapshotEvents:()=>[{type:'user/message',data:{message:{content:'以后有空看看这个视频'}}}]}
 const agent={id:'main-test',sessionId:'main-test',session,followup:async()=>{},ctx:{
  on(name,fn){listeners.set(name,fn);return ()=>listeners.delete(name)},
  systemPrompt:{section(x){sections.push(x);return ()=>{}},context(x){contexts.push(x);return ()=>{}}},
  tools:{register(spec){tools.push(spec);return ()=>{}}}
 }}
 const agents={get(id){return ['main-test','session-main-test'].includes(id)?agent:null},list(){return [agent]}}
 const todos=createOwnerTodoEngine({dataDir:home})
 const memory=createLongTermMemory({dataDir:home,dshHome:home,agents,getConfig:()=>({mainSessionId:'main-test',mainSessionMemoryEnabled:false}),defineTool:x=>x,
  getVideoDetailRecall:({bvid,memoryId})=>({ok:true,bvid,memoryId,fragments:[{content:"真实保存的片段"}]}),
  getExperienceRecall:(query,limit)=>[{kind:'watch',day:'2026-10-27',bvid:BV,summary:'之前看过猫咪视频'}],getTodoEngine:()=>todos,
  runTodo:id=>todos.run(id,async()=>({ok:true,summary:'已读取'})),logger:{warn(){},info(){}}})
 try{
  memory.start()
  const byName=Object.fromEntries(tools.map(x=>[x.name,x]))
  for(const name of ['dafeiyu_life_recall','dafeiyu_todo_list','dafeiyu_todo_add','dafeiyu_todo_update','dafeiyu_todo_execute'])assert.ok(byName[name],`缺少主 Session 工具 ${name}`)
  const recall=await byName.dafeiyu_life_recall.execute({query:'猫咪'})
  assert.equal(recall.ok,true);assert.equal(recall.experiences[0].bvid,BV);assert.match(recall.experiences[0].summary,/猫咪/)
  const deep=await byName.dafeiyu_life_recall.execute({query:'具体画面',detail_bvid:BV,detail_memory_id:'e-'+'a'.repeat(18)})
  assert.equal(deep.ok,true);assert.equal(deep.fragments[0].content,'真实保存的片段')
  assert.equal(recall.fragments,undefined,'普通浅层召回不应附带深层数据')
  assert.equal((await byName.dafeiyu_life_recall.execute({query:'画面',detail_bvid:'invalid'})).ok,false)
  const add=await byName.dafeiyu_todo_add.execute({type:'watch_video',bvid:BV,title:'以后看看'})
  assert.equal(add.ok,true);assert.equal(add.created,true)
  const list=await byName.dafeiyu_todo_list.execute({})
  assert.equal(list.items.length,1);assert.equal(list.items[0].bvid,BV)
  const executed=await byName.dafeiyu_todo_execute.execute({id:add.item.id})
  assert.equal(executed.ok,true);assert.equal(executed.item.status,'done')
  // A write task cannot be pre-authorized merely by the model choosing a flag; it must match the owner's current request.
  listeners.get('agent/inbox/inserted')?.({message:{content:'以后有空给这个视频点个赞'}})
  const like=await byName.dafeiyu_todo_add.execute({type:'like_video',bvid:BV,title:'之后点赞'})
  assert.equal(like.ok,true);assert.equal(like.item.ownerAuthorized,true)
  listeners.get('agent/inbox/inserted')?.({message:{content:'以后有空在这个视频评论：真有意思'}})
  const comment=await byName.dafeiyu_todo_add.execute({type:'comment_video',bvid:BV,text:'真有意思',title:'以后评论'})
  assert.equal(comment.ok,true);assert.equal(comment.item.ownerAuthorized,true);assert.equal(comment.item.text,'真有意思')
  listeners.get('agent/inbox/inserted')?.({message:{content:'以后有空给测试好友发私信：你好呀'}})
  const dm=await byName.dafeiyu_todo_add.execute({type:'dm_friend',uid:'11111',text:'你好呀',title:'以后发私信'})
  assert.equal(dm.ok,true);assert.equal(dm.item.ownerAuthorized,true);assert.equal(dm.item.text,'你好呀')
  listeners.get('agent/inbox/inserted')?.({message:{content:'帮我记住这个视频'}})
  const badLike=await byName.dafeiyu_todo_add.execute({type:'like_video',bvid:BV,title:'不应预授权'})
  assert.equal(badLike.ok,false)
  assert.ok(contexts.some(x=>x.name==='dafeiyu-owner-todos'))
  assert.ok(sections.some(x=>x.name==='dafeiyu-life-recall-hint'))
 }finally{memory.stop();rmSync(home,{recursive:true,force:true})}
})
