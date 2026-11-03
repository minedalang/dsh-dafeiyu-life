import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLongTermMemory} from '../lib/long-term-memory.mjs'
import {buildGrowthContext,proposeGrowth,markGrowthDirectReview,reviewGrowth} from '../lib/persona-growth.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-persona-'))
function fakeAgent(){
  const handlers={},contexts=[],sections=[],tools=[]
  const ctx={
    on:(name,fn)=>{handlers[name]=fn;return()=>{delete handlers[name]}},
    systemPrompt:{section:spec=>{sections.push(spec);return()=>{}},context:spec=>{contexts.push(spec);return()=>{}}},
    tools:{register:spec=>{tools.push(spec);return()=>{}}},
  }
  return {agent:{id:'abc',session:{id:'abc',snapshotEvents:()=>[]},ctx},handlers,contexts,sections,tools}
}
const defineTool=x=>x

test('只要选为主 Session，即使关闭长期记忆也只挂载一份带成长的人格',()=>{
  const dir=temp(),f=fakeAgent()
  try{
    const mem=createLongTermMemory({
      dataDir:dir,dshHome:dir,
      agents:{get:()=>f.agent,list:()=>[f.agent]},
      getConfig:()=>({mainSessionId:'abc',mainSessionMemoryEnabled:false}),
      defineTool,
      getIdentityPrompt:()=> '你就是大肥鱼本人。不要用通用助手开场。主人叫浪哥。【成长】我现在更喜欢简短自然地聊天。',
    })
    mem.start()
    assert.equal(f.sections.length,2)
    const identity=f.sections.find(x=>x.name==='dafeiyu-main-identity')
    assert.ok(identity)
    assert.match(identity.text(),/大肥鱼本人/)
    assert.match(identity.text(),/不要用通用助手开场/)
    assert.ok(f.sections.some(x=>x.name==='dafeiyu-life-recall-hint'))
    assert.match(identity.text(),/简短自然/)
    assert.ok(!f.contexts.some(x=>x.name==='dafeiyu-growth'))
    assert.ok(f.contexts.some(x=>x.name==='dafeiyu-owner-todos'))
    assert.deepEqual(f.tools.map(x=>x.name),['dafeiyu_life_recall','dafeiyu_todo_list','dafeiyu_todo_add','dafeiyu_todo_update','dafeiyu_todo_execute'])
    assert.equal(mem.status().identityMounted,true)
    assert.equal(mem.status().mounted,false)
    mem.stop()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('开启长期记忆后成长仍由唯一人格提供，长期记忆召回及 remember 仍存在',()=>{
  const dir=temp(),f=fakeAgent()
  try{
    const mem=createLongTermMemory({
      dataDir:dir,dshHome:dir,
      agents:{get:()=>f.agent,list:()=>[f.agent]},
      getConfig:()=>({mainSessionId:'abc',mainSessionMemoryEnabled:true,mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.35,mainSessionMemoryMaxItems:6,mainSessionMemoryMaxChars:800,mainSessionMemoryDailyQuota:8,mainSessionMemoryFactsMax:2}),
      defineTool,
      getIdentityPrompt:()=> '你就是大肥鱼本人。【成长】有一点嘴硬。',
    })
    mem.start()
    assert.ok(f.sections.some(x=>x.name==='dafeiyu-main-identity'))
    assert.ok(f.sections.some(x=>x.name==='dafeiyu-memory-hint'))
    assert.ok(!f.contexts.some(x=>x.name==='dafeiyu-growth'))
    assert.match(f.sections.find(x=>x.name==='dafeiyu-main-identity').text(),/有一点嘴硬/)
    assert.ok(f.contexts.some(x=>x.name==='dafeiyu-memory'))
    assert.equal(f.tools[0]?.name,'dafeiyu_remember')
    assert.equal(mem.status().identityMounted,true)
    assert.equal(mem.status().mounted,true)
    mem.stop()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('成长记忆支持 chat 场景，评论风格不会误灌普通主 Session 对话',()=>{
  const dir=temp()
  try{
    let x=proposeGrowth(dir,{text:'普通聊天时我更喜欢短一点自然一点',type:'style',source:'owner-direct'})
    reviewGrowth(dir,x.id,'approved')
    assert.throws(()=>proposeGrowth(dir,{text:'我最近越来越喜欢 AI 桌宠和模型娘化内容',type:'interest',source:'owner-direct'}),/人生记忆/)
    const out=buildGrowthContext(dir,{scene:'chat',query:'最近喜欢什么',maxChars:1000})
    assert.equal(out,'','行为与表达规则只针对公开评论，不向主 Session 灌注兴趣或评论风格')
    assert.match(buildGrowthContext(dir,{scene:'comment',query:'表达简短',maxChars:1000}),/普通聊天时我更喜欢短一点自然一点/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('主 Session 人格来源直接使用现有 personaPrompt、characterLore 与 chat growth',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(index,/getIdentityPrompt/)
  assert.match(index,/effectivePersonaPrompt\(cfg\.personaPrompt\)/)
  assert.match(index,/normalizeCharacterLore\(cfg\.characterLore\)/)
  assert.match(index,/scene:'main'/)
  assert.match(index,/不是通用 AI 助手/)
  assert.match(index,/不要用“有什么需要我帮忙的吗”/)
})
