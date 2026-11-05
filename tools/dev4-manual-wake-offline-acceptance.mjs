#!/usr/bin/env node
/** Zero-network, zero-real-model demonstration of a human Life Agent wake with backlog. */
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
const dir=mkdtempSync(join(tmpdir(),'dsh-manual-wake-'))
let fakeModels=0,realModels=0,networkCalls=0,externalMessagesSent=0
try{
  const now=()=>Date.parse('2026-11-05T12:00:00Z'),tag='a'.repeat(16)
  const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>tag,now})
  for(let i=0;i<31;i++)events.offer({kind:'comment-received',platform:'testsite',sourceKey:'synthetic-'+i})
  const old=events.offer({kind:'manual-wake',platform:'testsite',sourceKey:'first-click'})
  const active=events.offer({kind:'manual-wake',platform:'testsite',sourceKey:'latest-click'})
  assert.notEqual(old.id,active.id)
  assert.equal(events.peek()[0].id,active.id)
  assert.equal(events.status().pending,32)
  const planner=createAutonomousPlanner({dataDir:dir,now,getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'shadow',autonomousPlannerDailyLimit:6,autonomousPlannerMinutes:20,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
    getTodos:()=>[],getLifeAccountTag:()=>tag,getLifeEvents:()=>events.peek(),getLifeEventStatus:()=>events.status(),
    settleLifeEvents:(ids,reason)=>events.settle(ids,reason),recordLifeDecision:d=>events.recordDecision(d),
    getLifeIntentionCues:()=>[{id:'synthetic-interest',source:'interest-milestone',topic:'合成音乐兴趣'}],
    invokeModel:async prompt=>{fakeModels++;assert.ok(prompt.includes(active.id));return '{"action":"skip","reason":"这次想休息"}'},
    executeRead:()=>{throw Error('offline demo must not execute reads')},updateTodo:()=>{throw Error('offline demo must not change tasks')},reflect:()=>{throw Error('offline demo must not reflect')},
    runLifeCapability:()=>{throw Error('offline demo must not launch video')},getLifeCapabilities:()=>[]})
  const result=await planner.tick({force:true})
  assert.equal(result.ok,true)
  assert.equal(result.action,'skip')
  assert.equal(fakeModels,1)
  assert.equal(events.status().timeline[0].kinds.includes('manual-wake'),true)
  assert.equal(events.status().pendingSocial,28)
  const out={ok:true,kind:'dev4-manual-wake-offline',scenarios:4,
    checks:['人工唤醒在31条真实类型合成事件前进入候选','连续点击只保留一条待处理人工唤醒','影子模式调用假模型记录一次自主休息','合成社交事件不触发外发并保留队列'],
    fakeModelCalls:fakeModels,realModelCalls:realModels,networkCalls,externalMessagesSent,
    mode:'shadow',decision:result.action,remainingSyntheticSocialEvents:events.status().pendingSocial,
    note:'只使用临时目录与伪造事件/模型；不访问真实 B站、DSH、配置、账号或正式数据'}
  console.log(JSON.stringify(out,null,2))
}catch(e){console.error('人工唤醒离线验收失败：'+String(e?.stack||e));process.exitCode=1}
finally{rmSync(dir,{force:true,recursive:true})}
