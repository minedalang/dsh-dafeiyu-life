import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationLifeFeedback, classifyConversationSignal } from '../lib/conversation-life-feedback.mjs'
import { createEmotionalState } from '../lib/emotional-state.mjs'
import { createLongTermMemory } from '../lib/long-term-memory.mjs'
import { createSocialContextAssembler } from '../lib/social-context-assembler.mjs'
import { createInteractionBatcher } from '../lib/interaction-batch.mjs'
const home=()=>mkdtempSync(join(tmpdir(),'dafeiyu-dev4-conversation-'))
const run=(fn)=>{const dir=home();try{return fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('dev.4 only explicit safe exchange signals move fish emotion; never mirror user sorrow',()=>run(dir=>{
 const emotion=createEmotionalState({dataDir:dir})
 const feedback=createConversationLifeFeedback({dataDir:dir,onEmotion:x=>emotion.update(x)})
 const message={source:'main-session',role:'owner',sessionId:'main-room',eventId:'turn-1',text:'鱼鱼谢谢你，今天帮到我了'}
 assert.equal(feedback.observe(message).observed,true)
 assert.equal(emotion.snapshot().mood,'warm')
 assert.equal(feedback.observe(message).skipped,'duplicate')
 assert.equal(feedback.observe({...message,eventId:'turn-2',text:'密码是123456'}).skipped,'no-safe-signal')
 assert.equal(feedback.observe({...message,eventId:'turn-3',text:'我今天有点难过'}).observed,true)
 assert.equal(emotion.snapshot().mood,'warm')
 assert.equal(feedback.observe({...message,eventId:'turn-4',text:'鱼鱼，你真棒！'}).mood,'joyful')
 const file=readFileSync(join(dir,'life-memory/conversation-feedback.json'),'utf8')
 assert.doesNotMatch(file,/鱼鱼|密码|123456|main-room|turn-1|今天/)
 const newInstance=createConversationLifeFeedback({dataDir:dir,onEmotion:x=>emotion.update(x)})
 assert.equal(newInstance.observe(message).skipped,'duplicate')
 assert.equal(emotion.snapshot().history.filter(x=>x.source==='main-session').length,3)
}))

test('dev.4 rejected DM, invalid UID, disabled system and stale messages cannot write feedback',()=>run(dir=>{
 let calls=0
 const f=createConversationLifeFeedback({dataDir:dir,onEmotion:()=>{calls++;return {ok:true}}})
 const row={source:'dm',role:'friend',uid:'123456',eventId:'msg1',text:'谢谢鱼鱼！'}
 assert.equal(f.observe({...row,role:'stranger'}).skipped,'untrusted-source')
 assert.equal(f.observe({...row,uid:'0'}).skipped,'invalid-uid')
 assert.equal(f.observe({...row,at:Date.now()-4*86400_000}).skipped,'stale-event')
 assert.equal(f.observe({...row,source:'main-session'}).skipped,'untrusted-source')
 assert.equal(f.observe(row).observed,true)
 assert.equal(f.observe(row).skipped,'duplicate')
 assert.equal(calls,1)
 const disabled=createConversationLifeFeedback({dataDir:dir,isEnabled:()=>false,onEmotion:()=>{calls++}})
 assert.equal(disabled.observe({...row,eventId:'msg2'}).skipped,'disabled')
 assert.equal(calls,1)
}))

test('dev.4 natural friend DM obtains isolated state context, but public comment does not',async()=>{
 const a=createSocialContextAssembler({policy:{actor:uid=>({role:uid==='1'?'owner':'friend'}),memoryScope:()=>'',canViewIdentity:()=>false,canViewRelationship:()=>false},
 getLifeStateContext:({uid,query})=>`鱼鱼成长记录：${uid}，${query}`})
 const dm=await a.message({kind:'dm',uid:'2',text:'一起聊点新的'})
 assert.match(dm.lifeStateContext,/鱼鱼成长记录/)
 const comment=await a.message({kind:'comment',uid:'2',text:'一起聊点新的'})
 assert.equal(comment.lifeStateContext,'')
})

test('dev.4 selected main Session observes verified owner inbox and unmounts cleanly',()=>run(dir=>{
 let signal=[];const handlers=new Map(),contexts=[],sections=[]
 const agent={id:'room1',session:{id:'room1',snapshotEvents:()=>[]},ctx:{on:(event,handler)=>{handlers.set(event,handler);return()=>handlers.delete(event)},systemPrompt:{section:x=>{sections.push(x);return()=>{}},context:x=>{contexts.push(x);return()=>{}}},tools:{register:()=>()=>{}}}}
 const m=createLongTermMemory({dataDir:dir,agents:{get:id=>id==='room1'?agent:null},getConfig:()=>({mainSessionId:'room1',mainSessionMemoryEnabled:true}),defineTool:x=>x,onOwnerMessage:x=>signal.push(x)})
 m.start()
 const hook=handlers.get('agent/inbox/inserted');assert.equal(typeof hook,'function')
 hook({message:{role:'user',id:'hello-1',content:'鱼鱼谢谢你啦'}})
 hook({message:{role:'assistant',id:'assistant-1',content:'谢谢你'}})
 assert.equal(signal.length,1)
 assert.equal(signal[0].sessionId,'room1')
 assert.equal(signal[0].eventId,'hello-1')
 m.stop();assert.equal(handlers.size,0)
}))

test('dev.4 static production wiring covers main, owner DM and friend DM, with no second model round',()=>{
 const fs=(path)=>readFileSync(new URL(path,import.meta.url),'utf8')
 const index=fs('../index.js')
 assert.match(index,/onOwnerMessage:async\(/)
 assert.match(index,/conversationLifeFeedback\.observe\(\{source:'main-session'/)
 assert.match(index,/conversationLifeFeedback\.observe\(\{source:'dm',role:'owner'/)
 assert.match(index,/conversationLifeFeedback\.observe\(\{source:'dm',role,uid/)
 assert.match(index,/getLifeStateContext:/)
 const batch=fs('../lib/interaction-batch.mjs')
 assert.match(batch,/lifeStateContext:sanitize\(x\.lifeStateContext/)
})

test('dev.4 main Session optional mood tool needs a genuine new user turn, is bounded and renderable',async()=>run(async dir=>{
 const handlers=new Map(),tools=[];let observed=[]
 const agent={id:'room1',session:{id:'room1',snapshotEvents:()=>[]},ctx:{
  on:(event,handler)=>{handlers.set(event,handler);return()=>handlers.delete(event)},
  systemPrompt:{section:()=>()=>{},context:()=>()=>{}},tools:{register:spec=>{tools.push(spec);return()=>{}}}
 }}
 const m=createLongTermMemory({dataDir:dir,agents:{get:()=>agent},getConfig:()=>({mainSessionId:'room1',mainSessionMemoryEnabled:false}),defineTool:x=>x,
  onOwnerEmotion:x=>{observed.push(x);return {ok:true}},onOwnerMessage:x=>{observed.push({incoming:x.text})}})
 m.start()
 const feel=tools.find(x=>x.name==='dafeiyu_feel');assert.ok(feel)
 assert.deepEqual(feel.output.render({}, {ok:true}),[{type:'text',text:'{"ok":true}'}])
 assert.equal((await feel.execute({mood:'warm',intensity:1})).ok,false)
 const inbox=handlers.get('agent/inbox/inserted')
 inbox({message:{id:'internal',role:'user',source:{kind:'plugin:dafeiyu-owner-dm-experience'},content:'鱼鱼谢谢你'}})
 assert.equal((await feel.execute({mood:'warm',intensity:1})).ok,false)
 inbox({message:{id:'real1',role:'user',content:'鱼鱼谢谢你'}})
 assert.equal((await feel.execute({mood:'sad',intensity:3})).ok,false)
 assert.equal((await feel.execute({mood:'warm',intensity:1})).ok,true)
 assert.equal((await feel.execute({mood:'joyful',intensity:1})).ok,false)
 inbox({message:{id:'real2',role:'user',content:'今天做什么呢？'}})
 assert.equal((await feel.execute({mood:'curious',intensity:2})).ok,true)
 assert.equal(observed.filter(x=>x.mood).length,2)
 assert.equal(observed.filter(x=>x.incoming).length,2)
 m.stop()
}))
