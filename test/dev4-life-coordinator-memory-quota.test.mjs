import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryCoordinator} from '../lib/life-memory-coordinator.mjs'
import {__test as memory} from '../lib/long-term-memory.mjs'
import {createMemoryConsolidator} from '../lib/memory-consolidation.mjs'
const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-life-sync-'))

test('LifeMemoryCoordinator：反思 sink 失败后重启补偿，不重做已完成的经历和兴趣写入',async()=>{
 const dir=temp();let gatewayWrites=0,candidateWrites=0,shouldFail=true
 try{
  const mk=()=>createLifeMemoryCoordinator({dataDir:dir,logger:{warn(){}},memoryGateway:{recordEvents:()=>{gatewayWrites++;return {added:1}}},
    lifeReflection:{addEvents:()=>{candidateWrites++;if(shouldFail)throw Error('synthetic failure');return {added:1}}}})
  const events=[{kind:'social',key:'social:123:BV1bWHT6xEJg:98765',bvid:'BV1bWHT6xEJg',actorUid:'123',text:'公开评论',at:Date.now()}]
  const first=mk()
  const written=await first.recordEvents(events,{reflect:true})
  assert.equal(written.ok,false);assert.equal(written.pending,1)
  assert.equal(gatewayWrites,1);assert.equal(candidateWrites,1)
  const logged=readFileSync(first.file,'utf8')
  assert.match(logged,/"episode": true/)
  first.stop();shouldFail=false
  const restored=mk()
  const recovered=await restored.flush()
  assert.equal(recovered.pending,0)
  assert.equal(gatewayWrites,1,'gateway already completed; must not re-run')
  assert.equal(candidateWrites,2)
  const duplicate=await restored.recordEvents(events,{reflect:true})
  assert.equal(duplicate.duplicate,true)
  assert.equal(gatewayWrites,1);restored.stop()
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('主人聊天每日新增额度只影响新事实：重复强化和事实键更新可继续完成',()=>{
 const data={policy:{dailyQuota:2},memories:[],traces:[],deleted:[]}
 const write=(text,opts={})=>memory.addMemoryToStore(data,{text,source:'main-session-ai',...opts})
 assert.equal(write('主人最近在学习水彩绘画').ok,true)
 assert.equal(write('主人打算系统学习交互设计').ok,true)
 const quota=write('主人决定每周学习编程课程')
 assert.equal(quota.quotaExceeded,true)
 assert.equal(data.memories.length,2)
 const duplicate=write('主人最近在学习水彩绘画')
 assert.equal(duplicate.duplicate,true)
 const latest=write('主人最近改为专注油画练习',{fact_key:'主人.近期绘画项目',supersedes:data.memories[0].id})
 assert.equal(latest.ok,true)
 assert.equal(latest.quotaExceeded,undefined)
 assert.equal(data.memories[0].已被取代.by,latest.id)
})

test('记忆压缩：不达标不删除、正常凝练必须保留源 ID、不可混入稳定事实',async()=>{
 const groups=[
  {id:'a',source:'main-session-ai',importance:.6,text:'喜欢 科技 视频 AI 本地 模型 研究',createdAt:'2026-10-20'},
  {id:'b',source:'main-session-ai',importance:.6,text:'喜欢 科技 视频 AI 本地 模型 应用',createdAt:'2026-10-21'},
  {id:'c',source:'main-session-ai',importance:.6,text:'喜欢 科技 视频 AI 本地 模型 学习',createdAt:'2026-10-22'},
  {id:'hidden',source:'owner-manual',importance:1,category:'stable_profile',text:'喜欢 科技 视频 AI 本地 模型 研究'},
 ]
 const commits=[]
 const c=createMemoryConsolidator({getMemories:()=>groups,commit:input=>{commits.push(input);return {ok:true}},
  invokeModel:async()=>JSON.stringify({skip:false,text:'主人 喜欢 科技 视频 AI 本地 模型 研究'}),getConfig:()=>({mainSessionMemoryConsolidationEnabled:false})})
 assert.equal((await c.run()).reason,'disabled')
 const result=await c.run({force:true})
 assert.equal(result.added,1)
 assert.equal(commits.length,1)
 assert.deepEqual(commits[0].sourceIds,['a','b','c'])
 assert.ok(!commits[0].sourceIds.includes('hidden'))
})
