import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner,parsePlannerDecisionObject,plannerActionMenu,validatePlannerDecision} from '../lib/autonomous-planner.mjs'

const NOW=Date.parse('2026-11-06T10:00:00Z')
const TAG='a'.repeat(16)
const TODO={id:'todo-read',type:'check_notifications',status:'open',title:'检查通知',createdAt:NOW-1000}
const config=()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerMinutes:30,
  autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24})
const inDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-action-menu-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

function rig(dir,{model,rows=[TODO],scope=()=>TAG,opportunities=()=>[],events=()=>[],capabilities=()=>[]}={}){
  let calls=0,reads=0,updates=0
  let prompt=''
  const planner=createAutonomousPlanner({dataDir:dir,getConfig:config,getTodos:()=>rows,now:()=>NOW,
    getLifeAccountTag:scope,getLifeEvents:events,getLifeEventStatus:()=>({pending:0,videoStartsToday:0,lastVideoAt:0}),
    getLifeCapabilities:capabilities,getLifeOpportunities:opportunities,
    invokeModel:async p=>{prompt=p;calls++;return model},executeRead:async()=>{reads++;return {ok:true}},
    updateTodo:async()=>{updates++},reflect:async()=>({ok:true})})
  return {planner,get calls(){return calls},get reads(){return reads},get updates(){return updates},get prompt(){return prompt}}
}

test('single fenced JSON is safe; prose, multiple objects and size overrun are never salvaged',()=>{
  const rows=[TODO]
  for(const content of ['{"action":"skip"}','```json\n{"action":"skip"}\n```','```\r\n{"action":"skip"}\r\n```']){
    assert.equal(validatePlannerDecision(content,rows).action,'skip')
    assert.equal(validatePlannerDecision(content,rows).invalid,undefined)
  }
  for(const text of ['Here: {"action":"skip"}','```json\n{"action":"skip"}\n```\n谢谢',
    '{"action":"skip"}{"action":"execute_read","id":"todo-read"}',
    '```json\n{"action":"skip"}\n```\n```json\n{"action":"execute_read"}\n```',
    ' '.repeat(4097)]){
    assert.equal(validatePlannerDecision(text,rows).diagnosticCode,'model-json-invalid')
  }
  assert.equal(parsePlannerDecisionObject('```json\n[]\n```').error,'model-response-shape')
  assert.equal(validatePlannerDecision('```json\n{"action":"execute_read","id":"fake"}\n```',rows).diagnosticCode,'model-target-invalid')
  assert.equal(validatePlannerDecision('```json\n{"action":"send_dm","id":"todo-read"}\n```',rows).diagnosticCode,'model-action-unknown')
})

test('menu does not advertise unrelated actions, and exact IDs/BV/capability are scoped to their own action',()=>{
  const base=plannerActionMenu({candidates:[TODO],opportunities:[{id:'op1',source:'discussion-read'}],canReflect:false})
  assert.deepEqual(base.map(x=>x.action),['skip','execute_read','defer','dismiss','inspect_opportunity'])
  assert.deepEqual(base.find(x=>x.action==='defer').ids,['todo-read','op1'])
  assert.equal(base.some(x=>x.action==='consider_social'||x.action==='use_capability'||x.action==='reflect'),false)
  const menu=plannerActionMenu({intents:[{id:'int1',status:'ready',selectedBvid:'BVabcdefghij',videos:[{bvid:'BVabcdefghij'}]}],
    lifeEvents:[{id:'social1',kind:'dm-received'},{id:'video1',kind:'manual-wake'}],
    lifeSkills:[{id:'bilibili.video-agent'}],videoEligible:true,canReflect:true})
  assert.deepEqual(menu.find(x=>x.action==='inspect_exploration').targets,[{id:'int1',bvids:['BVabcdefghij']}])
  assert.deepEqual(menu.find(x=>x.action==='consider_social').ids,['social1'])
  assert.deepEqual(menu.find(x=>x.action==='use_capability').capabilities,['bilibili.video-agent'])
  assert.ok(menu.some(x=>x.action==='reflect'))
})

test('fenced valid model choice executes one allowed read with one charged model call',()=>inDir(async dir=>{
  const x=rig(dir,{model:'```json\n{"action":"execute_read","id":"todo-read","reason":"想先看看通知"}\n```'})
  const out=await x.planner.tick({force:true})
  assert.equal(out.ok,true)
  assert.equal(out.action,'execute_read');assert.equal(out.result,'done')
  assert.equal(x.calls,1);assert.equal(x.reads,1);assert.equal(x.planner.status().runs,1)
  const menu=JSON.parse(x.prompt.split('【本轮真正允许的动作和精确目标（这些只是候选，执行仍要后端重新核验）】\n')[1].split('\n')[0])
  assert.deepEqual(menu.map(x=>x.action),['skip','execute_read','defer','dismiss'])
  assert.deepEqual(menu[1].ids,['todo-read'])
  assert.ok(!x.prompt.includes('"action":"use_capability"'))
}))

test('untrusted prose and fabricated action do not execute or re-invoke the model',()=>inDir(async dir=>{
  const x=rig(dir,{model:'这个回答好像可以：{"action":"execute_read","id":"todo-read"}'})
  const out=await x.planner.tick({force:true})
  assert.equal(out.result,'invalid-decision')
  assert.equal(out.diagnosticCode,'model-json-invalid')
  assert.equal(x.calls,1);assert.equal(x.reads,0);assert.equal(x.updates,0)
  assert.equal(x.planner.status().runs,1)
}))

test('an unknown target in fenced JSON is rejected with no write or tool call',()=>inDir(async dir=>{
  const x=rig(dir,{model:'```json\n{"action":"execute_read","id":"invented"}\n```'})
  const out=await x.planner.tick({force:true})
  assert.equal(out.result,'invalid-decision');assert.equal(out.diagnosticCode,'model-target-invalid')
  assert.equal(x.reads,0);assert.equal(x.updates,0)
}))
