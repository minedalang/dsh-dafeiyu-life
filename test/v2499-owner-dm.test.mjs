import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {intakeAiReadProposal} from '../lib/social-todo-intake.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
const T=Date.parse('2026-11-01T10:00:00Z'), BV='BV19SJi6VEj1'
test('历史主人命令措辞不产生自动待办；真实社交模型拒绝时不入账',async()=>{
 let calls=0,proposals=0,gateCalls=0
 const home=mkdtempSync(join(tmpdir(),'v2499-refuse-'))
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 const batch=createInteractionBatcher({delayMs:0,getPersona:()=>'鱼鱼',invoke:async()=>{calls++;return JSON.stringify({items:[{id:'0',action:'skip',todoDisposition:'refuse'}]})}})
 try{
  for(const text of ['大肥鱼 看 '+BV,'他说：“大肥鱼 看 '+BV+'”','大肥鱼 点赞 '+BV,'有空想不想看看这个 '+BV]){
   const result=await batch.generate({kind:'dm',uid:'12345',role:'owner',trigger:'incoming',text,messages:[text],socialAutonomy:true,allowTodoIntake:true,canSkip:true,onTodoProposal:async proposal=>{
    proposals++
    return intakeAiReadProposal({row:{incoming:true,senderUid:'12345',messageId:'refuse-'+proposals,timestampMs:T,text},channel:'dm',todoDisposition:proposal.todoDisposition,suggestedTodo:proposal.suggestedTodo,currentMessages:[text],decide:()=>{gateCalls++;return {decision:'allow'}},todos,now:()=>T})
   }})
   assert.equal(result.action,'skip')
  }
  assert.equal(calls,4);assert.equal(proposals,4);assert.equal(gateCalls,0);assert.equal(todos.list().length,0)
 }finally{batch.stop();rmSync(home,{recursive:true,force:true})}
})
test('现行只读提案须有真实来源、模型同意及原意愿；重复消息不新增，不保留原话',()=>{
 const home=mkdtempSync(join(tmpdir(),'v2499-dm-'))
 try{
  const todos=createOwnerTodoEngine({dataDir:home,now:()=>T}),text='这条视频挺有意思 '+BV
  const row={incoming:true,senderUid:'12345',messageId:'m1',timestampMs:T,text}
  const args={row,channel:'dm',todoDisposition:'accept',suggestedTodo:{type:'watch_video',bvid:BV,evidence:BV},currentMessages:[text],decide:()=>({decision:'allow'}),todos,now:()=>T}
  assert.equal(intakeAiReadProposal({...args,row:{...row,incoming:false}}).skipped,'unverified-event')
  assert.equal(intakeAiReadProposal({...args,todoDisposition:'refuse'}).skipped,'model-refuse')
  assert.equal(intakeAiReadProposal({...args,decide:()=>({decision:'deny'})}).accepted,false)
  assert.equal(intakeAiReadProposal({...args,suggestedTodo:{type:'like_video',bvid:BV,evidence:BV}}).skipped,'unsupported-task-type')
  assert.equal(todos.list().length,0)
  assert.equal(intakeAiReadProposal(args).created,true)
  assert.equal(intakeAiReadProposal(args).duplicate,true)
  const item=todos.list()[0]
  assert.equal(todos.list().length,1);assert.equal(item.origin.kind,'bilibili-dm');assert.equal(item.origin.uid,'12345');assert.equal(item.ownerAuthorized,false);assert.equal(item.origin.quotedText,'')
  assert.ok(!readFileSync(join(home,'owner-todos.json'),'utf8').includes(text))
 }finally{rmSync(home,{recursive:true,force:true})}
})
