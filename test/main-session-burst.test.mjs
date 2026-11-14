import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLongTermMemory} from '../lib/long-term-memory.mjs'

function makeAgent(){
  const handlers=new Map(),tools=new Map(),steered=[],followups=[]
  const inbox={nextTurn:[],nextStep:[],remove(id){const n=this.nextTurn.length+this.nextStep.length;this.nextTurn=this.nextTurn.filter(x=>x.id!==id);this.nextStep=this.nextStep.filter(x=>x.id!==id);return n!==this.nextTurn.length+this.nextStep.length}}
  const agent={id:'main',inbox,session:{deriveMessages:()=>[]},steer(message){steered.push(message);inbox.nextStep.push(message)},followup(message){followups.push(message);inbox.nextTurn.push(message)},ctx:{
    on(name,fn){const rows=handlers.get(name)||[];rows.push(fn);handlers.set(name,rows);return ()=>handlers.set(name,(handlers.get(name)||[]).filter(x=>x!==fn))},
    systemPrompt:{section:()=>()=>{},context:()=>()=>{}},
    tools:{register(spec){tools.set(spec.name,spec);return ()=>tools.delete(spec.name)}}
  }}
  return {agent,handlers,tools,steered,followups,emit(name,...args){for(const fn of handlers.get(name)||[])fn(...args)}}
}

test('selected main Session exposes the same P6-A burst contract and emits separate visible assistant turns',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'main-session-burst-')),h=makeAgent()
  const memory=createLongTermMemory({dataDir:dir,dshHome:dir,agents:{get:id=>id==='main'?h.agent:null,list:()=>[h.agent]},
    getConfig:()=>({mainSessionId:'main',mainSessionMemoryEnabled:false,dmP6Enabled:true,dmP6MaxBubbles:3}),
    defineTool:spec=>spec,logger:{warn(){}}})
  try{
    memory.start()
    const tool=h.tools.get('dafeiyu_chat_burst')
    assert.ok(tool)
    h.emit('session/event',null,{type:'turn/start',data:{turn:4}})
    const started=await tool.execute({messages:['第一条','第二条']})
    assert.deepEqual(started,{ok:true,queued:2})
    assert.equal(h.steered.length,1)
    h.agent.inbox.remove(h.steered[0].id)
    h.emit('session/event',null,{type:'assistant/message',data:{turn:4,message:{content:[{type:'text',text:'第一条'}]}}})
    h.emit('agent/turn-stopping',{turn:4,signal:new AbortController().signal})
    assert.equal(h.steered.length,1)
    assert.equal(h.followups.length,1)
    assert.match(h.followups[0].content[0].text,/第二条/)
    h.emit('session/event',null,{type:'turn/end',data:{turn:4}})
    h.emit('session/event',null,{type:'turn/start',data:{turn:5}})
    h.agent.inbox.remove(h.followups[0].id)
    h.emit('agent/inbox/claimed',{message:h.followups[0],turn:5})
    h.emit('session/event',null,{type:'assistant/message',data:{turn:5,message:{content:[{type:'text',text:'第二条'}]}}})
    h.emit('agent/turn-stopping',{turn:5,signal:new AbortController().signal})
    assert.deepEqual(h.agent.inbox.nextTurn,[])
    assert.deepEqual(h.agent.inbox.nextStep,[])
  }finally{memory.stop();rmSync(dir,{recursive:true,force:true})}
})
