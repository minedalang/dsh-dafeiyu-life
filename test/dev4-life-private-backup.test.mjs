import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {preparePrivateLifeEvent} from '../lib/life-private-policy.mjs'
import {createBackup,createLifeMemoryBackup,restoreBackupFiles} from '../lib/data-backup.mjs'

const at=Date.parse('2026-11-01T00:00:00Z')
const fixture=()=>{
 const root=mkdtempSync(join(tmpdir(),'dsh-private-backup-'))
 const memory=createLifeMemoryGateway({dataDir:root,getConfig:()=>({}),now:()=>at})
 const event=preparePrivateLifeEvent({source:'owner-dm',role:'owner',uid:'123',eventId:'m1',text:'我今天累了，想轻松聊天',at})
 memory.recordEvents([event]);memory.recordPrivateInsights([{sourceKey:event.key,visibility:event.visibility,subjectUid:event.subjectUid,
  text:'我发现尊重对方明确表达的交流节奏很重要，以后我会更耐心地交流'}])
 return {root,memory,event}
}
test('通用可携带备份不包含私密人生经历、私密候选或私密认识；明确的独立人生记忆备份才包含',()=>{
 const {root,memory,event}=fixture()
 try{
  const portable=createBackup({root,config:{},sqlite:{}})
  assert.equal(portable.files['life-memory/private-insights.json'],undefined)
  assert.equal(JSON.parse(portable.files['life-memory/episodic.json']).episodes.filter(e=>e.kind==='private-social').length,0)
  for(const [key,value] of Object.entries(portable.files))if(key.startsWith('life-memory/'))assert.doesNotMatch(value,/私密交流|owner-private|friend-private|主人私信/)
  const explicit=createLifeMemoryBackup(root)
  assert.ok(explicit.files['life-memory/private-insights.json'])
  assert.ok(JSON.parse(explicit.files['life-memory/episodic.json']).episodes.some(e=>e.kind==='private-social'))
 }finally{memory.close();rmSync(root,{recursive:true,force:true})}
})

test('导入通用备份不会把本机私密可衰减经历误删除或复活',()=>{
 const {root,memory}=fixture()
 try{
  const portable=createBackup({root,config:{},sqlite:{}})
  restoreBackupFiles(root,portable)
  assert.equal(memory.recall({query:'轻松',domain:'main-session',role:'owner'}).length,1)
  assert.equal(memory.privateInsights({domain:'main-session',role:'owner',query:'尊重'}).length,1)
 }finally{memory.close();rmSync(root,{recursive:true,force:true})}
})
