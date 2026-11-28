import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmotionalState } from '../lib/emotional-state.mjs'
import { createLongTermMemory } from '../lib/long-term-memory.mjs'
import { createSocialContextAssembler } from '../lib/social-context-assembler.mjs'
import { createInteractionBatcher } from '../lib/interaction-batch.mjs'
const home=()=>mkdtempSync(join(tmpdir(),'dafeiyu-dev4-conversation-'))
const run=async(fn)=>{const dir=home();try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('dev.83 social mood comes only from existing model output, not incoming wording',async()=>{
 const choices=[{text:'鱼鱼谢谢你，真棒！',mood:'neutral',intensity:0},
  {text:'这段居然还有后续诶',mood:'curious',intensity:1},
  {text:'他引用了“我今天很难过”',mood:'neutral',intensity:0},
  {text:'刚才的事情让我很高兴',mood:'calm',intensity:2}]
 const seen=[],updates=[]
 const batch=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async prompt=>{
  const x=choices[seen.length];seen.push(prompt);return JSON.stringify({items:[{id:'0',action:'reply',reply:'自然交流',mood:x.mood,intensity:x.intensity}]})},onEmotion:x=>updates.push(x)})
 try{for(const x of choices)assert.equal(await batch.generate({kind:'dm',uid:'123456',text:x.text}),'自然交流')
  assert.equal(seen.length,choices.length)
  assert.deepEqual(updates,[{mood:'curious',intensity:1,source:'dm'},{mood:'calm',intensity:2,source:'dm'}])
 }finally{batch.stop()}
})

test('dev.83 historical emotional state remains readable; no new conversation keyword ledger',()=>run(dir=>{
 const emotion=createEmotionalState({dataDir:dir})
 emotion.update({mood:'warm',intensity:1,source:'main-session'})
 assert.equal(createEmotionalState({dataDir:dir}).snapshot().mood,'warm')
 assert.ok(!readdirSync(join(dir,'life-memory')).includes('conversation-feedback.json'))
 assert.doesNotMatch(readFileSync(join(dir,'life-memory/emotional-state.json'),'utf8'),/鱼鱼|main-room|turn-1/)
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

test('dev.83 production has no incoming keyword emotion writer; existing model paths remain',()=>{
 const fs=(path)=>readFileSync(new URL(path,import.meta.url),'utf8')
 const index=fs('../index.js')
 assert.match(index,/onOwnerMessage:async\(/)
 assert.doesNotMatch(index,/conversationLifeFeedback|conversation-life-feedback/)
 assert.match(index,/onOwnerEmotion:/)
 assert.match(index,/onReplyEmotion:/)
 assert.match(index,/onEmotion:/)
 assert.match(index,/getLifeStateContext:/)
 const batch=fs('../lib/interaction-batch.mjs')
 assert.match(batch,/lifeStateContext:excerpt\(roleTextView\(x,x\.lifeStateContext\),780\)/)
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
 assert.equal(observed.filter(x=>x.mood).length,0)
 assert.equal((await feel.execute({mood:'sad',intensity:3})).ok,false)
 assert.equal((await feel.execute({mood:'warm',intensity:1})).ok,true)
 assert.equal((await feel.execute({mood:'joyful',intensity:1})).ok,false)
 inbox({message:{id:'real2',role:'user',content:'今天做什么呢？'}})
 assert.equal((await feel.execute({mood:'curious',intensity:2})).ok,true)
 assert.equal(observed.filter(x=>x.mood).length,2)
 assert.equal(observed.filter(x=>x.incoming).length,2)
 m.stop()
}))
