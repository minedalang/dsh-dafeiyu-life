import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeMessageBurst,deliverMessageBurst,createSessionMessageBurstController,messageBurstInstruction} from '../lib/message-burst.mjs'

function fakeAgent(){
  const handlers=new Map(),steered=[],followups=[]
  const inbox={nextTurn:[],nextStep:[],remove(id){
    const found=[...this.nextStep,...this.nextTurn].find(x=>x.id===id)
    const before=this.nextStep.length+this.nextTurn.length
    this.nextStep=this.nextStep.filter(x=>x.id!==id)
    this.nextTurn=this.nextTurn.filter(x=>x.id!==id)
    if(found)for(const fn of handlers.get('agent/inbox/discarded')||[])fn({message:found})
    return before!==this.nextStep.length+this.nextTurn.length
  },claim(id){
    const before=this.nextStep.length+this.nextTurn.length
    this.nextStep=this.nextStep.filter(x=>x.id!==id)
    this.nextTurn=this.nextTurn.filter(x=>x.id!==id)
    return before!==this.nextStep.length+this.nextTurn.length
  }}
  const cancels=[]
  const agent={id:'main',status:'running',cancel:(cause,options)=>cancels.push({cause,options}),inbox,ctx:{on(name,fn){const rows=handlers.get(name)||[];rows.push(fn);handlers.set(name,rows);return ()=>handlers.set(name,(handlers.get(name)||[]).filter(x=>x!==fn))}},steer(message){steered.push(message);inbox.nextStep.push(message)},followup(message){followups.push(message);inbox.nextTurn.push(message)}}
  return {agent,steered,followups,cancels,emit(name,...args){for(const fn of handlers.get(name)||[])fn(...args)}}
}

test('one shared normalizer keeps the 1–3 independent-message contract and caps output',()=>{
  assert.deepEqual(normalizeMessageBurst(['  第一条  ','','第二条','第三条','第四条'],{maxMessages:3,maxChars:8}),['第一条','第二条','第三条'])
  assert.deepEqual(normalizeMessageBurst({messages:['A','B','C']},{maxMessages:2}),['A','B'])
  assert.deepEqual(normalizeMessageBurst('单条回复'),['单条回复'])
  assert.deepEqual(normalizeMessageBurst(['',' '],{minMessages:1}),[])
  assert.match(messageBurstInstruction({context:'主 Session'}),/不得为了凑数/)
})

test('shared delivery sends sequentially, persists each confirmed bubble, and stops on unknown receipt',async()=>{
  const calls=[],persisted=[]
  const result=await deliverMessageBurst({messages:['一','二','三'],
    beforeSend:async({index})=>({ok:index<3}),
    send:async({text,index})=>{calls.push({text,index});return index===1?{ok:false,error:'timeout'}:{ok:true,receiptId:'r'+index}},
    onConfirmed:async({text})=>persisted.push(text)})
  assert.deepEqual(calls.map(x=>x.text),['一','二'])
  assert.deepEqual(persisted,['一'])
  assert.equal(result.status,'partial-unknown')
  assert.equal(result.confirmed,1)
  assert.deepEqual(result.confirmedMessages,['一'])
})

test('main Session turns a selected burst into separate visible assistant turns',()=>{
  const h=fakeAgent(),controller=createSessionMessageBurstController({agent:h.agent,enabled:()=>true,maxMessages:()=>3,logger:{warn(){}}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:7}})
  assert.deepEqual(controller.start(['第一条','第二条','第三条']),{ok:true,queued:3})
  assert.equal(h.steered.length,1)
  assert.match(h.steered[0].content[0].text,/第一条/)
  const firstId=h.steered[0].id;h.agent.inbox.claim(firstId)
  h.emit('session/event',null,{type:'assistant/message',data:{turn:7,message:{content:[{type:'text',text:'第一条'}]}}})
  h.emit('agent/turn-stopping',{turn:7,signal:new AbortController().signal})
  assert.equal(h.steered.length,1)
  assert.equal(h.followups.length,1)
  assert.match(h.followups[0].content[0].text,/第二条/)
  h.emit('session/event',null,{type:'turn/end',data:{turn:7}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:8}})
  h.emit('agent/inbox/claimed',{message:h.followups[0],turn:8})
  h.emit('session/event',null,{type:'assistant/message',data:{turn:8,message:{content:[{type:'text',text:'第二条'}]}}})
  h.emit('agent/turn-stopping',{turn:8,signal:new AbortController().signal})
  assert.equal(h.followups.length,2)
  assert.match(h.followups[1].content[0].text,/第三条/)
  h.emit('session/event',null,{type:'turn/end',data:{turn:8}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:9}})
  h.emit('agent/inbox/claimed',{message:h.followups[1],turn:9})
  h.emit('session/event',null,{type:'assistant/message',data:{turn:9,message:{content:[{type:'text',text:'第三条'}]}}})
  h.emit('agent/turn-stopping',{turn:9,signal:new AbortController().signal})
  assert.deepEqual(controller.status(),{active:false})
  controller.dispose()
})

test('new owner input cancels unsent main-Session bubbles',()=>{
  const h=fakeAgent(),controller=createSessionMessageBurstController({agent:h.agent,enabled:()=>true,maxMessages:()=>3,logger:{warn(){}}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:8}})
  controller.start(['第一条','第二条','第三条'])
  h.agent.inbox.claim(h.steered[0].id)
  h.emit('session/event',null,{type:'assistant/message',data:{turn:8,message:{content:[{type:'text',text:'第一条'}]}}})
  h.emit('agent/inbox/inserted',{message:{id:'owner-new',role:'user',source:{kind:'user'},content:[{type:'text',text:'等等'}]}})
  h.emit('agent/turn-stopping',{turn:8,signal:new AbortController().signal})
  assert.equal(h.steered.length,1)
  assert.deepEqual(controller.status(),{active:false})
  assert.equal(h.cancels.length,1)
  assert.deepEqual(h.cancels[0].options,{keepInbox:true})
  controller.dispose()
})

test('main-Session burst stops rather than chaining after a non-text/tool step',()=>{
  const h=fakeAgent(),controller=createSessionMessageBurstController({agent:h.agent,enabled:()=>true,maxMessages:()=>3,logger:{warn(){}}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:9}})
  controller.start(['第一条','第二条'])
  h.agent.inbox.claim(h.steered[0].id)
  h.emit('session/event',null,{type:'assistant/message',data:{turn:9,message:{content:[{type:'tool-call',name:'some_tool'}]}}})
  h.emit('agent/turn-stopping',{turn:9,signal:new AbortController().signal})
  assert.equal(h.steered.length,1)
  assert.deepEqual(controller.status(),{active:false})
  controller.dispose()
})

test('explicit inbox removal emits discarded without recursively clearing the burst controller',()=>{
  const h=fakeAgent(),controller=createSessionMessageBurstController({agent:h.agent,enabled:()=>true,maxMessages:()=>3,logger:{warn(){}}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:10}})
  controller.start(['第一条','第二条'])
  const queuedId=h.steered[0].id
  assert.equal(h.agent.inbox.remove(queuedId),true)
  assert.deepEqual(controller.status(),{active:false})
  controller.dispose()
})

test('new owner input removes a queued followup bubble before its next Turn',()=>{
  const h=fakeAgent(),controller=createSessionMessageBurstController({agent:h.agent,enabled:()=>true,maxMessages:()=>3,logger:{warn(){}}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:11}})
  controller.start(['第一条','第二条'])
  h.agent.inbox.claim(h.steered[0].id)
  h.emit('session/event',null,{type:'assistant/message',data:{turn:11,message:{content:[{type:'text',text:'第一条'}]}}})
  h.emit('agent/turn-stopping',{turn:11,signal:new AbortController().signal})
  assert.equal(h.followups.length,1)
  h.emit('session/event',null,{type:'turn/end',data:{turn:11}})
  h.emit('agent/inbox/inserted',{message:{id:'new-owner',role:'user',source:{kind:'user'},content:[{type:'text',text:'我又想到一个问题'}]}})
  assert.deepEqual(h.agent.inbox.nextTurn,[])
  assert.deepEqual(controller.status(),{active:false})
  controller.dispose()
})
