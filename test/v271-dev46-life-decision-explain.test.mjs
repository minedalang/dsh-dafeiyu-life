import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeAgentEvents,lifeEventDebugRef} from '../lib/life-agent-events.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
const TAG='9'.repeat(16), T=Date.parse('2026-11-10T01:51:43Z')
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dev46-trace-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:20,
  autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}

test('social quick skip records three specific anonymous event types, offered actions, model input and no outgoing send',()=>withDir(async dir=>{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>TAG,now:()=>T})
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>TAG,now:()=>T})
  const a=events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'private UID=11111 hello there'})
  const b=events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'comment UID=1234567 secret'})
  const c=events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'another-private-UID=99999'})
  let prompt=''
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>cfg,getTodos:()=>[],
    getLifeAccountTag:()=>TAG,getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),
    getLifeCapabilities:()=>[],getLifeVoice:()=> 'my-private-secret-marker',
    invokeModel:async p=>{prompt=p;return JSON.stringify({action:'skip',reason:'私信里说出了私密手机号 18000000000，我现在想休息'})},
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:v=>events.recordDecision(v),
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false}),
    beginDecisionTrace:args=>trace.begin(args)})
  const result=await planner.tick({socialWake:true})
  assert.equal(result.result,'voluntary-rest')
  assert.match(prompt,/consider_social/)
  const row=trace.list().runs[0]
  assert.equal(row.state,'finished')
  const details=row.steps.filter(x=>x.type==='candidate-detail')
  assert.equal(details.length,3)
  assert.deepEqual(details.map(x=>x.kind).sort(),['comment-received','dm-received','dm-received'])
  assert.deepEqual(new Set(details.flatMap(x=>x.eventRefs)),new Set([a,b,c].map(x=>lifeEventDebugRef(x.id))))
  const modelIn=row.steps.find(x=>x.type==='model-input')
  assert.equal(modelIn.modelScene,'social-fast')
  assert.ok(modelIn.menuActions.includes('consider_social'))
  assert.ok(modelIn.contextSources.includes('social-event-classes'))
  assert.match(modelIn.promptHash,/^[a-f0-9]{16}$/)
  assert.equal(row.steps.find(x=>x.type==='model-choice').reasonProvided,true)
  assert.equal(row.steps.find(x=>x.type==='execution-plan').delivery,'none')
  assert.equal(row.steps.filter(x=>x.type==='event-resolution'&&x.eventStatus==='considered-rest').length,3)
  assert.equal(row.steps.find(x=>x.type==='execution-result').delivery,'not-sent')
  const raw=JSON.stringify(row)
  for(const secret of ['my-private-secret-marker','18000000000','11111','1234567','99999','hello there'])
    assert.ok(!raw.includes(secret),secret)
}))

test('social attention action says local consideration only, never actual DM reply',()=>withDir(async dir=>{
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>TAG,now:()=>T})
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>TAG,now:()=>T})
  const a=events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'source-comment-42'})
  let sent=0
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>cfg,getTodos:()=>[],
    getLifeAccountTag:()=>TAG,getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),
    getLifeCapabilities:()=>[],invokeModel:async()=>JSON.stringify({action:'consider_social',id:a.id,reason:'想看看这个动静'}),
    getLifeSocialPreview:()=>({ok:false}),runFriendInitiative:async()=>{sent++;return {ok:true}},
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:v=>events.recordDecision(v),
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false}),
    beginDecisionTrace:args=>trace.begin(args)})
  const result=await planner.tick({socialWake:true})
  assert.equal(result.result,'social-signal-considered')
  assert.equal(sent,0)
  const steps=trace.list().runs[0].steps
  assert.ok(steps.some(x=>x.type==='action-start'&&x.tool==='social-attention-local'&&x.kind==='comment-received'))
  assert.ok(steps.some(x=>x.type==='execution-result'&&x.result==='no-verified-preview'))
  assert.ok(steps.some(x=>x.type==='event-resolution'&&x.eventStatus==='attention-selected'))
  assert.ok(steps.some(x=>x.type==='execution-result'&&x.delivery==='not-sent'))
}))

test('willingness records a candidate kind, structured model call and actual skip without leaking prose',()=>withDir(async dir=>{
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>TAG,now:()=>T})
  const arbiter=createLifeWillingness({dataDir:dir,getAccountTag:()=>TAG,now:()=>T,
    getContext:async()=>({voice:'my-private-owner-memory',world:{notice:'nope'},experience:{log:'secret-uid-99999'}}),
    invokeModel:async()=>JSON.stringify({action:'skip',reason:'今天我太累，不想发给 13800138000'}) ,
    beginTrace:args=>trace.begin(args)})
  const result=await arbiter.decide({trigger:'comment-received',sourceKey:'trusted-source-key-123',
    candidates:[{id:'candidate_1',kind:'comment_reply',label:'私密原文 abc123'}]})
  assert.equal(result.action,'skip')
  const steps=trace.list().runs[0].steps
  assert.ok(steps.some(x=>x.type==='candidate-detail'&&x.kind==='comment_reply'))
  assert.ok(steps.some(x=>x.type==='model-input'&&x.menuActions.includes('comment_reply')))
  assert.ok(steps.some(x=>x.type==='model-output'))
  assert.ok(steps.some(x=>x.type==='model-choice'&&x.action==='skip'&&x.reasonProvided))
  assert.ok(steps.some(x=>x.type==='execution-result'&&x.delivery==='not-sent'))
  const json=JSON.stringify(steps)
  for(const text of ['abc123','13800138000','my-private-owner-memory','secret-uid-99999','trusted-source-key-123'])
    assert.ok(!json.includes(text),text)
}))

test('sanitizer ignores arbitrary private fields and long unapproved actions',()=>withDir(async dir=>{
  const t=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>TAG,now:()=>T})
  const row=t.begin({mode:'active',trigger:'social'})
  row.step('model-input',{prompt:'password=secret-uid-123',inputChars:70,
    menuActions:['consider_social','delete all credentials','skip'],contextSources:['life-voice','untrusted private message'],
    promptHash:'a'.repeat(16),targetRef:'b'.repeat(16),reason:'secret phone'})
  row.finish({state:'finished'})
  const obj=t.list().runs[0].steps[0]
  assert.deepEqual(obj.menuActions,['consider_social','unclassified','skip'])
  assert.equal(obj.inputChars,70)
  assert.match(JSON.stringify(obj),/^((?!secret-uid|private message|password).)*$/)
}))
