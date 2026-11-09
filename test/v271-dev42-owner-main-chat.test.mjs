import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMainSessionBridge} from '../lib/main-session-bridge.mjs'
import {plannerActionMenu,validateOfferedLifeAction} from '../lib/autonomous-planner.mjs'

const scope='1234567890abcdef',id='abcdef012345abcdef012345'
const key=scope+':'+id
const at=new Date('2026-11-09T12:00:00').getTime()
const config=()=>({masterEnabled:true,lifeAgentMode:'active',mainSessionBridgeEnabled:true,
  ownerSpontaneousChatEnabled:true,mainSessionId:'main'})
function harness({cfg=config(),clock=at,fail=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'owner-chat-')),calls=[]
  let t=clock
  const agent={id:'main',followup:async m=>{calls.push(m);if(fail)throw Error('transport timeout: secret 123')}}
  const agents={get:(id)=>id==='main'?agent:null,list:()=>[agent]}
  const make=()=>createMainSessionBridge({dataDir:dir,agents,getConfig:()=>cfg,now:()=>t,
    getWatched:()=>[],getComments:()=>({rows:[]}),logger:{warn(){}}})
  return {dir,calls,make,setTime:value=>{t=value},cleanup:()=>rmSync(dir,{recursive:true,force:true})}
}
test('Life makes owner contact a selectable but nonmandatory action with exact verified source',()=>{
  const events=[{id,kind:'experience-ready'},{id:'b'.repeat(24),kind:'dm-received'}]
  const menu=plannerActionMenu({lifeEvents:events,ownerChatAvailable:true})
  assert.deepEqual(menu.find(x=>x.action==='talk_to_owner').ids,[id,'owner-idle'])
  assert.equal(validateOfferedLifeAction({action:'talk_to_owner',id},menu),true)
  assert.equal(validateOfferedLifeAction({action:'talk_to_owner',id:'owner-idle'},menu),true)
  assert.equal(validateOfferedLifeAction({action:'talk_to_owner',id:'c'.repeat(24)},menu),false)
  assert.equal(plannerActionMenu({lifeEvents:events,ownerChatAvailable:false}).some(x=>x.action==='talk_to_owner'),false)
})
test('opt-in, quiet time and exact online main session gate proactive messages',async()=>{
  const h=harness();try{
    const bridge=h.make()
    assert.equal(bridge.ownerChatReadiness({sourceKey:key}).eligible,true)
    assert.equal((await bridge.initiateOwnerChat({sourceKey:key,eventKind:'video-round-ended',reason:'test'})).ok,false)
    assert.equal(h.calls.length,0)
    const result=await bridge.initiateOwnerChat({sourceKey:key,eventKind:'experience-ready',reason:'想到一件事'})
    assert.equal(result.ok,true);assert.equal(result.queued,true);assert.equal(result.delivered,false)
    assert.equal(h.calls.length,1)
    assert.equal(h.calls[0].source.kind,'dafeiyu-life-owner-chat')
    assert.match(h.calls[0].content[0].text,/可以自然地分享自己的想法/)
    assert.equal((await h.make().initiateOwnerChat({sourceKey:key,eventKind:'experience-ready'})).reason,'source-used')
    assert.equal(h.calls.length,1)
    const state=JSON.parse(readFileSync(join(h.dir,'main-session-memory.json'),'utf8'))
    assert.equal(state.ownerChatAttempts.length,1);assert.equal(state.ownerChatAttempts[0].status,'queued')
  }finally{h.cleanup()}
})
test('host transport uncertainty is never retried or described as delivered',async()=>{
  const h=harness({fail:true});try{
    const bridge=h.make(),result=await bridge.initiateOwnerChat({sourceKey:key,eventKind:'experience-ready',reason:'want to talk'})
    assert.equal(result.ok,false);assert.equal(result.uncertain,true)
    assert.equal((await h.make().initiateOwnerChat({sourceKey:key,eventKind:'experience-ready'})).ok,false)
    assert.equal(h.calls.length,1)
    const status=h.make().status().ownerChat
    assert.equal(status.attempts[0].status,'unknown')
    assert.doesNotMatch(JSON.stringify(status),/secret 123|main|abcdef/)
  }finally{h.cleanup()}
})
test('disabled permission never schedules and quiet hours block',async()=>{
  const h=harness({cfg:{...config(),ownerSpontaneousChatEnabled:false}});try{
    assert.equal(h.make().ownerChatReadiness().reason,'not-authorized')
    assert.equal((await h.make().initiateOwnerChat({sourceKey:key,eventKind:'experience-ready'})).ok,false)
    h.setTime(new Date('2026-11-09T23:00:00').getTime())
    const h2=harness({clock:new Date('2026-11-09T23:00:00').getTime()})
    try{assert.equal(h2.make().ownerChatReadiness().reason,'quiet-hours')}finally{h2.cleanup()}
  }finally{h.cleanup()}
})
test('main session spontaneous communication does not override EmotionRecall suspension or install style cards',()=>{
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const bridge=readFileSync(new URL('../lib/main-session-bridge.mjs',import.meta.url),'utf8')
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  assert.match(src,/paused:true, \/\/ 2\.6\.0:/)
  assert.match(src,/runOwnerChat:async/)
  assert.match(src,/ownerSpontaneousChatEnabled: z\.boolean\(\)\.default\(false\)/)
  assert.match(html,/owner-spontaneous-chat-enabled/)
  assert.doesNotMatch(html,/俏皮碎碎念|温柔日常/)
  assert.match(bridge,/agent\.followup/)
})

test('Life may chat without an event, but cannot reuse idle opportunity on restart',async()=>{
  const h=harness();try{
    const source=scope+':idle:2026-11-09'
    const r=await h.make().initiateOwnerChat({sourceKey:source,eventKind:'self-initiated',reason:'今天忽然想说说话'})
    assert.equal(r.ok,true)
    assert.equal(h.calls.length,1)
    assert.equal(h.make().ownerChatReadiness({sourceKey:source}).reason,'source-used')
  }finally{h.cleanup()}
})
test('8h safety spacing and two-attempt daily limit remain durable',async()=>{
  const h=harness();try{
    assert.equal((await h.make().initiateOwnerChat({sourceKey:key,eventKind:'experience-ready'})).ok,true)
    h.setTime(new Date('2026-11-09T16:00:00').getTime())
    const second=scope+':'+'e'.repeat(24)
    assert.equal(h.make().ownerChatReadiness({sourceKey:second}).reason,'cooldown')
    h.setTime(new Date('2026-11-09T21:00:00').getTime())
    assert.equal((await h.make().initiateOwnerChat({sourceKey:second,eventKind:'experience-ready'})).ok,true)
    const third=scope+':'+'f'.repeat(24)
    assert.equal(h.make().ownerChatReadiness({sourceKey:third}).reason,'cooldown')
    assert.equal(h.make().status().ownerChat.attempts.length,2)
  }finally{h.cleanup()}
})

test('real Life planner can select owner-idle when there are no other Life candidates',async()=>{
  const {createAutonomousPlanner}=await import('../lib/autonomous-planner.mjs')
  const dir=mkdtempSync(join(tmpdir(),'life-owner-idle-'))
  try{
    let calls=0,selected=0,prompt=''
    const planner=createAutonomousPlanner({dataDir:dir,now:()=>at,
      getConfig:()=>({...config(),autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:6,autonomousPlannerMinutes:5,
        autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
      getLifeAccountTag:()=>scope,getLifeEvents:()=>[],getLifeEventStatus:()=>({}),getTodos:()=>[],
      getOwnerChatReadiness:()=>({eligible:true}),runOwnerChat:async input=>{selected++;assert.equal(input.id,'owner-idle');return {ok:true,queued:true,delivered:false}},
      invokeModel:async p=>{calls++;prompt=p;return JSON.stringify({action:'talk_to_owner',id:'owner-idle',reason:'我有点想聊聊'})},
      reflectionStatus:()=>({canAutoReflect:false,pending:0}),executeRead:async()=>({ok:false}),updateTodo:()=>({ok:false}),reflect:async()=>({ok:false})})
    const r=await planner.tick({force:true})
    assert.equal(calls,1)
    assert.equal(selected,1)
    assert.equal(r.action,'talk_to_owner')
    assert.equal(r.result,'owner-chat-queued')
    assert.match(prompt,/talk_to_owner/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('Life model may refuse contact without calling main Session',async()=>{
  const {createAutonomousPlanner}=await import('../lib/autonomous-planner.mjs')
  const dir=mkdtempSync(join(tmpdir(),'life-owner-rest-'))
  try{
    let called=false
    const planner=createAutonomousPlanner({dataDir:dir,now:()=>at,
      getConfig:()=>({...config(),autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:6,
        autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
      getLifeAccountTag:()=>scope,getLifeEvents:()=>[],getLifeEventStatus:()=>({}),getTodos:()=>[],
      getOwnerChatReadiness:()=>({eligible:true}),runOwnerChat:async()=>{called=true;return {ok:true}},
      invokeModel:async()=>JSON.stringify({action:'skip',reason:'我现在不想打扰主人'}),
      reflectionStatus:()=>({canAutoReflect:false,pending:0}),executeRead:async()=>({ok:false}),updateTodo:()=>({ok:false}),reflect:async()=>({ok:false})})
    const r=await planner.tick({force:true})
    assert.equal(r.result,'voluntary-rest')
    assert.equal(called,false)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
