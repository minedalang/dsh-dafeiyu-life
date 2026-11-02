import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeReflection,__test as refTest} from '../lib/life-reflection.mjs'
import {createPersonalityEvolution} from '../lib/personality-evolution.mjs'
import {preparePrivateLifeEvent} from '../lib/life-private-policy.mjs'

const NOW=Date.parse('2026-11-01T00:30:00Z')
const config=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,mainSessionMemoryHalfLifeDays:30})
const watch={kind:'watch',key:'watch:diag:1',bvid:'BV1234567890',title:'探索新事物',day:'2026-11-01',at:NOW}
function withMemory(fn){
 const dataDir=mkdtempSync(join(tmpdir(),'fish-reflection-diagnostics-'))
 const gateway=createLifeMemoryGateway({dataDir,getConfig:config,now:()=>NOW})
 return Promise.resolve().then(()=>fn({dataDir,gateway})).finally(()=>{gateway.close();rmSync(dataDir,{recursive:true,force:true})})
}

test('开启时严格 JSON 示例包含 trait_proposals，关闭时不要求人格变化，私密场景开启后仅提受限候选',()=>{
 const row={id:'c-test',key:watch.key,kind:'watch',text:'探索新事物'}
 const enabled=refTest.reflectionPrompt([row],true)
 const disabled=refTest.reflectionPrompt([row],false)
 const format=prompt=>JSON.parse(prompt.match(/JSON 结构必须严格为：([^\n]+)/)?.[1]||'{}')
 assert.ok(Array.isArray(format(enabled).trait_proposals))
 assert.equal(format(disabled).trait_proposals,undefined)
 assert.match(enabled,/可为空/)
 const privatePrompt=refTest.reflectionPrompt([{...row,kind:'private-social'}],true)
 assert.ok(Array.isArray(format(privatePrompt).trait_proposals))
 assert.match(privatePrompt,/不引用任何私信原文/)
})

test('公开批次报告候选提出与实际采纳条数；无需产生长期认识也能形成小幅人格证据',()=>withMemory(async({dataDir,gateway})=>{
 gateway.recordEvents([watch])
 const personality=createPersonalityEvolution({dataDir,memoryGateway:gateway,now:()=>NOW})
 personality.setEnabled(true)
 const reflection=createLifeReflection({dataDir,getConfig:config,memoryGateway:gateway,now:()=>NOW,
   getPersonalityEnabled:()=>personality.status().enabled,
   onPersonalityProposals:(p,b)=>personality.applyProposals(p,b),
   commitMemories:()=>({added:0,rows:[]}),
   invokeModel:async prompt=>{
    assert.ok(JSON.parse(prompt.match(/JSON 结构必须严格为：([^\n]+)/)?.[1]||'{}').trait_proposals)
    const [row]=JSON.parse(prompt.match(/<candidate_data>\n([^\n]+)\n<\/candidate_data>/)[1])
    return JSON.stringify({memories:[],trait_proposals:[{trait:'curiosity',direction:1,candidate_ids:[row.id]}]})
   },
 })
 reflection.addEvents([watch])
 const result=await reflection.reflect({force:true})
 assert.equal(result.ok,true)
 assert.equal(result.domain,'public-event')
 assert.equal(result.personalityEnabled,true)
 assert.equal(result.personalityProposed,1)
 assert.equal(result.personalityAccepted,1)
 assert.equal(result.created,0)
 assert.equal(personality.status().traits.find(x=>x.id==='curiosity').evidenceCount,1)
 assert.equal(reflection.status().recentPublicRun.personalityAccepted,1)
}))

test('私密反思开启时可考虑匿名特质；已成功执行后仍能查看最近技术失败',()=>withMemory(async({dataDir,gateway})=>{
 const friend=preparePrivateLifeEvent({source:'friend-dm',role:'friend',uid:'456',eventId:'diagfriend',text:'我不想你主动给我发私信',at:NOW})
 assert.ok(friend)
 gateway.recordEvents([friend])
 const reflection=createLifeReflection({dataDir,getConfig:config,memoryGateway:gateway,now:()=>NOW,
   getPersonalityEnabled:()=>true,onPersonalityProposals:()=>{throw new Error('private must not reach personality')},
   commitMemories:()=>({added:0,rows:[]}),
   invokeModel:async()=>JSON.stringify({memories:[],trait_proposals:[{trait:'curiosity',direction:1,candidate_ids:['c-any']}]}),
 })
 reflection.addEvents([friend])
 const first=await reflection.reflect({force:true})
 assert.equal(first.domain,'friend-private')
 assert.equal(first.personalityEnabled,true)
 assert.equal(first.personalityProposed,0)
 assert.equal(first.personalityAccepted,0)
 // Public model failure and then success: the last error must remain diagnosable.
 gateway.recordEvents([watch]);reflection.addEvents([watch])
 let fail=true
 const publicReflection=createLifeReflection({dataDir,getConfig:config,memoryGateway:gateway,now:()=>NOW,
   getPersonalityEnabled:()=>false,commitMemories:()=>({added:0,rows:[]}),
   invokeModel:async()=>{if(fail)throw Error('模拟 headless 模型超时');return JSON.stringify({memories:[]})},
 })
 const error=await publicReflection.reflect({force:true})
 assert.equal(error.ok,false)
 assert.match(publicReflection.status().recentFailure.error,/headless 模型超时/)
 fail=false
 const recovery=await publicReflection.reflect({force:true})
 assert.equal(recovery.ok,true)
 assert.equal(recovery.domain,'public-event')
 assert.equal(publicReflection.status().lastError,'')
 assert.match(publicReflection.status().recentFailure.error,/headless 模型超时/)
}))

test('管理页展示实际处理权限与人格证据数量，不把模拟记录算进真实记录',()=>{
 const source=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(source,/personalityAccepted/)
 assert.match(source,/recentFailure/)
 assert.match(source,/loadPersonalityEvolution\(false\);const domainLabel/)
})
