import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {relationshipMemoryHalfLifeDays,SOCIAL_MEMORY_DECAY_DEFAULTS} from '../lib/life-memory-gateway.mjs'
const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
test('六类关系基准周期可独立配置且对真实 gateway 生效，不改 UID 权限',()=>{
 const cases=[['New','new',null,1.3],['Known','known',null,3],['Familiar','familiar',null,10],['Friend','friend',null,24],['Whitelist','new',true,30],['Owner','new','owner',50]]
 for(const [label,stage,special,def] of cases){
  const key=`socialMemoryHalfLife${label}Days`
  assert.equal(SOCIAL_MEMORY_DECAY_DEFAULTS[key],def)
  assert.match(index,new RegExp(key+': z\\.number\\(\\)\\.default'))
  assert.match(index,new RegExp(`'${key}'`))
  assert.match(html,new RegExp(`id="social-memory-half-${label.toLowerCase()}"`))
  const relation={stage,permissionRole:special==='owner'?'owner':'stranger',whitelisted:special===true}
  assert.equal(relationshipMemoryHalfLifeDays(relation,30,{[key]:7}),7,label)
  assert.equal(relationshipMemoryHalfLifeDays(relation,60,{[key]:7}),14,label)
  assert.equal(relationshipMemoryHalfLifeDays(relation,30,{[key]:-4}),def,'无效输入不覆盖安全默认')
 }
 assert.match(index,/relationshipMemoryHalfLifeDays\(row,cfg.mainSessionMemoryHalfLifeDays,cfg\)/)
 assert.match(readFileSync(new URL('../lib/life-memory-gateway.mjs',import.meta.url),'utf8'),/relationshipMemoryHalfLifeDays\(r,general,getConfig\(\)\)/)
})
test('关系从人生记忆拆到生活与成长，仍能搜索昵称及查看可视化',()=>{
 assert.match(html,/data-tab="relationships"/)
 assert.match(html,/id="panel-relationships"/)
 const memoryPanel=html.slice(html.indexOf('<section id="panel-life"'),html.indexOf('<section id="panel-diagnostics"'))
 assert.doesNotMatch(memoryPanel,/id="life-relationship-section"/)
 assert.match(html,/class="relation-score-fill"|relation-score-fill/)
 assert.match(js,/loadRelationshipSettings/)
 assert.match(js,/loadFriendRelationships/)
 assert.match(js,/social-memory-policy-save/)
 assert.match(js,/relationships\/nicknames/)
})
test('自动继承仅来自默认或上游任务，不强行写入首个已验证模型',()=>{
 assert.doesNotMatch(html,/一键使用已验证模型/)
 assert.doesNotMatch(js,/models-use-recommended/)
 assert.match(js,/models-.*-effective/)
 assert.match(html,/选择一个默认模型，可应用到所有任务/)
 assert.match(js,/未单独指定：继承/)
 assert.match(html,/连接测试会实际调用模型/)
})

test('真实可衰减副本响应运行时关系记忆参数变化，同时不复活已模糊的 UID',async()=>{
 const {mkdtempSync,rmSync,readFileSync}=await import('node:fs')
 const {tmpdir}=await import('node:os')
 const {join}=await import('node:path')
 const {createLifeMemoryGateway}=await import('../lib/life-memory-gateway.mjs')
 const dir=mkdtempSync(join(tmpdir(),'dev9-config-memory-')),start=Date.parse('2026-10-01T10:00:00Z'),DAY=86400000
 let t=start,days=20
 const cfg=()=>({mainSessionMemoryHalfLifeDays:30,socialMemoryHalfLifeNewDays:days})
 const gate=createLifeMemoryGateway({dataDir:dir,now:()=>t,getConfig:cfg,getRelationship:()=>({stage:'new',permissionRole:'stranger'})})
 try{
  const e={kind:'social',key:'social:522504190:BV1234567890:54321',actorUid:'522504190',bvid:'BV1234567890',text:'一段无关的短句',at:t}
  assert.equal(gate.recordEvents([e]).added,1)
  const read=()=>JSON.parse(readFileSync(gate.file,'utf8')).episodes[0]
  assert.equal(read().relationHalfLifeDays,20)
  t+=DAY
  days=0.25
  gate.status()
  const faded=read()
  assert.notEqual(faded.stage,'clear')
  assert.equal(faded.actorUid,undefined)
  days=120;t+=DAY;gate.status()
  assert.notEqual(read().stage,'clear','参数增加不能从模糊记忆恢复 UID')
  assert.equal(read().actorUid,undefined)
 }finally{gate.close();rmSync(dir,{recursive:true,force:true})}
})

test('README 用真实社交场景说明模拟情绪，而不把演示当成实际聊天记录',()=>{
 const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8')
 assert.match(readme,/会回忆，会遗忘，也会成长/)
 assert.match(readme,/自主选择探索、互动、延期或不行动/)
 assert.match(readme,/也可以选择沉默、延期或休息/)
 assert.match(readme,/私密记忆的保存域/)
 assert.doesNotMatch(readme,/这是实际用户的聊天记录/)
})
