import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {preparePrivateLifeEvent} from '../lib/life-private-policy.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createPersonalityEvolution} from '../lib/personality-evolution.mjs'
import {createLifeReflection} from '../lib/life-reflection.mjs'
import {createBackup,createLifeMemoryBackup,restoreBackupFiles} from '../lib/data-backup.mjs'

const NOW=Date.parse('2026-11-01T13:00:00Z')
const DAY=86400000
const config=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,mainSessionMemoryHalfLifeDays:90})
async function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'fish-private-personality-'))
 const gate=createLifeMemoryGateway({dataDir:root,getConfig:config,now:()=>NOW})
 const personality=createPersonalityEvolution({dataDir:root,memoryGateway:gate,now:()=>NOW})
 try{return await fn({root,gate,personality})}finally{gate.close();rmSync(root,{recursive:true,force:true})}
}
const event=(i,source='friend-dm',uid='456',text='我不想你主动给我发私信了')=>
 preparePrivateLifeEvent({source,role:source==='friend-dm'?'friend':'owner',uid,eventId:'message'+i,at:NOW-(3-i)*DAY,text})
const row=(e,i)=>({id:'c-private-'+i,key:e.key,kind:'private-social',visibility:e.visibility,subjectUid:e.subjectUid})
const propose=(trait,rows,extra={})=>({trait,direction:1,candidateIds:rows.map(r=>r.id),confidence:.9,evidenceQuote:'',...extra})

test('私密反思通过原有模型调用产生匿名、低权重人格成长，公开只能看到抽象倾向',()=>fixture(async({root,gate,personality})=>{
 personality.setEnabled(true)
 const events=[event(0),event(1,'owner-dm','123'),event(2,'friend-dm','789')]
 assert.ok(events.every(Boolean));gate.recordEvents(events)
 const reflection=createLifeReflection({dataDir:root,memoryGateway:gate,getConfig:config,now:()=>NOW,
  getPersonalityEnabled:()=>true,onPersonalityProposals:(proposals,batch)=>personality.applyProposals(proposals,batch),
  commitMemories:()=>{throw Error('不能写入公开长期记忆')},
  invokeModel:async prompt=>{
    assert.match(prompt,/私密域额外限制/)
    assert.doesNotMatch(prompt,/我不想你主动给我发私信了/)
    const [source]=JSON.parse(prompt.match(/<candidate_data>\n([^\n]+)\n<\/candidate_data>/)[1])
    return JSON.stringify({memories:[],trait_proposals:[{trait:'boundaries',direction:1,candidate_ids:[source.id],confidence:.9,evidence_quote:''}]})
  },logger:{warn:()=>{}}})
 reflection.addEvents(events)
 const first=await reflection.reflect({force:true})
 assert.equal(first.ok,true);assert.equal(first.domain,'friend-private');assert.equal(first.personalityProposed,1);assert.equal(first.personalityAccepted,1)
 const owner=await reflection.reflect({force:true})
 assert.equal(owner.ok,true);assert.equal(owner.domain,'owner-private');assert.equal(owner.personalityAccepted,1)
 const third=await reflection.reflect({force:true})
 assert.equal(third.ok,true);assert.equal(third.personalityAccepted,1)
 const trait=personality.status().traits.find(x=>x.id==='boundaries')
 assert.equal(trait.evidenceCount,3);assert.equal(trait.stage,'developing');assert.ok(trait.impactScore<=.9)
 const publicContext=personality.context({scene:'comment'})
 assert.match(publicContext,/更愿意清楚表达社交边界/)
 assert.doesNotMatch(publicContext,/主人|好友|私信|456|交流事件|我不想|对方/)
 const bytes=readFileSync(join(root,'personality-evolution/v1.json'),'utf8')
 assert.doesNotMatch(bytes,/"subjectUid"\s*:\s*"(?:123|456|789)"|我不想|减少主动联系或打扰|private:friend/)
 const data=JSON.parse(bytes)
 assert.equal(data.traits.boundaries.evidence.filter(x=>x.kind==='private-social').length,3)
 assert.equal(data.timeline.filter(x=>x.source==='private').length,3)
 const portable=JSON.parse(createBackup({root,config:{},sqlite:{}}).files['personality-evolution/v1.json'])
 assert.equal(portable.traits.boundaries.evidence.length,0)
 assert.equal(portable.timeline.filter(x=>x.source==='private').length,0)
 const full=JSON.parse(createLifeMemoryBackup(root).files['personality-evolution/v1.json'])
 assert.equal(full.traits.boundaries.evidence.length,3)
 restoreBackupFiles(root,createBackup({root,config:{},sqlite:{}}))
 assert.equal(personality.status().traits.find(x=>x.id==='boundaries').evidenceCount,3)
}))

test('伪造跨权限域、引用好友原话、社交外向或无证据私密候选不能改变人格',()=>fixture(({gate,personality})=>{
 personality.setEnabled(true)
 const friend=event(0),owner=event(1,'owner-dm','123')
 gate.recordEvents([friend,owner])
 const rows=[row(friend,0),row(owner,1)]
 assert.equal(personality.applyProposals([propose('boundaries',rows)],rows).added,0)
 assert.equal(personality.applyProposals([propose('social_openness',[rows[0]])],[rows[0]]).added,0)
 assert.equal(personality.applyProposals([propose('boundaries',[rows[0]],{evidenceQuote:'私信内容'})],[rows[0]]).added,0)
 assert.equal(personality.applyProposals([propose('boundaries',[rows[0]],{confidence:.4})],[rows[0]]).added,0)
 assert.equal(personality.applyProposals([propose('patience',[rows[0]])],[rows[0]]).added,0)
 assert.equal(personality.applyProposals([propose('boundaries',[{...rows[0],subjectUid:'789'}])],[{...rows[0],subjectUid:'789'}]).added,0)
 assert.equal(personality.status().traits.find(x=>x.id==='boundaries').evidenceCount,0)
}))

test('关闭成长人格或候选经历已遗忘时绝不生成私密人格证据',()=>fixture(({gate,personality})=>{
 const e=event(0);gate.recordEvents([e])
 const r=row(e,0)
 assert.equal(personality.applyProposals([propose('boundaries',[r])],[r]).added,0)
 personality.setEnabled(true)
 assert.equal(personality.applyProposals([propose('boundaries',[r])],[r]).added,1)
 assert.equal(personality.applyProposals([propose('boundaries',[r])],[r]).added,0)
 personality.setEnabled(false)
 assert.equal(personality.context({scene:'comment'}),'')
}))


test('仅同一位好友的反复私信不会形成可对外使用的稳定人格',()=>fixture(({gate,personality})=>{
 personality.setEnabled(true)
 const events=[event(0),event(1),event(2)]
 gate.recordEvents(events)
 const rows=events.map(row)
 assert.equal(personality.applyProposals([propose('boundaries',rows)],rows).added,3)
 assert.equal(personality.status().traits.find(x=>x.id==='boundaries').stage,'observed')
 assert.equal(personality.context({scene:'comment'}),'')
}))
