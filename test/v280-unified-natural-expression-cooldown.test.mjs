import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNaturalExpressionOpportunity, naturalRelationshipTier, NATURAL_RECONSIDER_COOLDOWN_MS } from '../lib/natural-expression-opportunity.mjs'
import { createSessionMessageBurstController, messageBurstInstruction } from '../lib/message-burst.mjs'

test('four relation cooloffs follow evidence stage, not mere whitelist status', () => {
  assert.deepEqual(NATURAL_RECONSIDER_COOLDOWN_MS,{owner:120000,intimate:300000,familiar:600000,stranger:1800000})
  for (const [stage,tier] of [['owner','owner'],['friend','intimate'],['familiar','familiar'],['known','stranger'],['new','stranger']]) assert.equal(naturalRelationshipTier(stage),tier)
  assert.equal(naturalRelationshipTier('whitelisted'),'stranger')
})

test('extra thoughts spend cooldown even on model silence, persist over restarts, and never use a daily quota',()=>{
  const dir=mkdtempSync(join(tmpdir(),'natural-thought-'))
  let clock=1800000000000
  try {
    const create=()=>createNaturalExpressionOpportunity({dataDir:dir,now:()=>clock,random:()=>0})
    const x=create()
    assert.equal(x.tryAcquire({account:'a',peer:'owner',stage:'owner'}).ok,true)
    assert.equal(create().tryAcquire({account:'a',peer:'owner',stage:'owner'}).reason,'cooldown')
    clock+=120000
    assert.equal(create().tryAcquire({account:'a',peer:'owner',stage:'owner'}).ok,true)
    clock+=120000
    assert.equal(create().tryAcquire({account:'a',peer:'owner',stage:'owner'}).ok,true)
    // All calls may occur within the same day; there is no total cap.
    for(let i=0;i<8;i++) {clock+=120000;assert.equal(create().tryAcquire({account:'a',peer:'owner',stage:'owner'}).ok,true)}
    assert.equal(create().tryAcquire({account:'b',peer:'owner',stage:'owner'}).ok,true,'account isolation')
    assert.equal(create().tryAcquire({account:'a',peer:'someone-else',stage:'owner'}).ok,true,'recipient isolation')
  }finally{rmSync(dir,{force:true,recursive:true})}
})

test('minority lottery may skip without spending cooldown; unsafe state fails closed',()=>{
  const dir=mkdtempSync(join(tmpdir(),'natural-thought-'))
  try{
    const x=createNaturalExpressionOpportunity({dataDir:dir,now:()=>1800000000000,random:()=>0.8})
    assert.equal(x.tryAcquire({account:'a',peer:'x',stage:'stranger'}).reason,'not-selected')
    assert.equal(x.tryAcquire({account:'a',peer:'x',stage:'stranger',probability:1}).ok,true)
    assert.equal(x.tryAcquire({account:'a',peer:'x',stage:'stranger',probability:1}).reason,'cooldown')
  }finally{rmSync(dir,{force:true,recursive:true})}
})

test('shared prompt has thought -> semantic rhythm -> structured bubbles, while allowing a short reply',()=>{
  const p=messageBurstInstruction({context:'三个渠道',requireArray:true})
  for (const part of ['①先决定','②再看','③最后','优先写成 2–3','简短回答','不得按标点或固定长度','不输出步骤或分析过程']) assert.ok(p.includes(part),part)
})

function fakeAgent(){
 const callbacks=new Map(),followups=[]
 const agent={status:'running',inbox:{nextTurn:[],nextStep:[],remove(){}},ctx:{on(name,fn){callbacks.set(name,[...(callbacks.get(name)||[]),fn]);return ()=>{}}},steer(){},followup(m){followups.push(m);this.inbox.nextTurn.push(m)}}
 const emit=(type,...data)=>{for (const fn of callbacks.get(type)||[])fn(...data)}
 return {agent,emit,followups}
}
test('main Session offers only one optional extra turn after a real user reply, never loops after internal followup',()=>{
 const h=fakeAgent(),ctl=createSessionMessageBurstController({agent:h.agent,tryReconsider:()=>true})
 h.emit('agent/inbox/inserted',{message:{role:'user',source:{kind:'user'},content:[{type:'text',text:'嗨'}]}})
 h.emit('session/event',null,{type:'turn/start',data:{turn:4}})
 h.emit('session/event',null,{type:'assistant/message',data:{turn:4,message:{content:[{type:'text',text:'你好，想和你聊聊。'}]}}})
 h.emit('agent/turn-stopping',{turn:4,signal:new AbortController().signal})
 assert.equal(h.followups.length,1)
 h.emit('session/event',null,{type:'turn/end',data:{turn:4}})
 h.emit('session/event',null,{type:'turn/start',data:{turn:5}})
 h.emit('agent/inbox/claimed',{message:h.followups[0],turn:5})
 h.emit('session/event',null,{type:'assistant/message',data:{turn:5,message:{content:[{type:'text',text:'又想到一点……'}]}}})
 h.emit('agent/turn-stopping',{turn:5,signal:new AbortController().signal})
 assert.equal(h.followups.length,1)
 ctl.dispose()
})
