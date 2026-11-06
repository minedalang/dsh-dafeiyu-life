import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createBackup,createLifeMemoryBackup,inspectLifeMemoryBackup,
  restoreBackupFiles,restoreLifeMemoryBackup} from '../lib/data-backup.mjs'
import {lifeSettingsV2,planLifeSettingsV2} from '../lib/life-settings-control.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'life-rc-upgrade-'))
const put=(root,name,data)=>{
 const path=join(root,...name.split('/'));mkdirSync(join(path,'..'),{recursive:true})
 writeFileSync(path,JSON.stringify(data,null,2)+'\n','utf8')
}
const get=(root,name)=>JSON.parse(readFileSync(join(root,...name.split('/')),'utf8'))
const oldMemory=(stage='clear')=>({version:1,archiveKeys:['watch:public:old'],updatedAt:0,
 episodes:[{id:'e-stable',kind:'watch',stage,text:stage==='clear'?'老用户记得的公开资料':'',at:1762000000000}]})
const priorLongTerm=()=>({version:2,memories:[],traces:[],deleted:[]})

test('RC: 旧版双层人生记忆可备份与校验，恢复不会让本机已遗忘记忆复活',()=>{
 const from=temp(),to=temp()
 try{
  put(from,'life-memory/episodic.json',oldMemory())
  put(from,'long-term-memory/dafeiyu.json',priorLongTerm())
  put(to,'life-memory/episodic.json',oldMemory('forgotten'))
  const pack=createLifeMemoryBackup(from)
  assert.equal(inspectLifeMemoryBackup(pack).integrity,'sha256-verified')
  const total=restoreLifeMemoryBackup(to,pack)
  assert.ok(total>=2)
  assert.equal(get(to,'life-memory/episodic.json').episodes[0].stage,'forgotten')
  assert.equal(get(to,'life-memory/episodic.json').episodes[0].text,'')
  assert.equal(get(to,'long-term-memory/dafeiyu.json').version,2)
  assert.ok(get(to,'life-memory/episodic.json').archiveKeys.includes('watch:public:old'))
 }finally{rmSync(from,{recursive:true,force:true});rmSync(to,{recursive:true,force:true})}
})

test('RC: 普通备份保持原业务配置，角色身份不同则必须拒绝恢复',()=>{
 const from=temp(),to=temp()
 try{
  const character='11111111-1111-4111-8111-111111111111'
  put(from,'character-identity.json',{version:1,id:character,createdAt:1762000000000})
  put(to,'character-identity.json',{version:1,id:'22222222-2222-4222-8222-222222222222',createdAt:1762000000000})
  put(from,'life-memory/episodic.json',oldMemory())
  put(from,'long-term-memory/dafeiyu.json',priorLongTerm())
  const oldConfig={masterEnabled:false,lifeAgentMode:'active',autonomousPlannerEnabled:true,
    autonomousPlannerMinutes:60,autonomousPlannerDailyLimit:12,socialAutoSend:false}
  assert.equal(lifeSettingsV2(oldConfig).pace,'legacy-natural')
  const pack=createBackup({root:from,config:oldConfig,version:'2.7.0'})
  assert.equal(pack.config.autonomousPlannerMinutes,60)
  assert.equal(pack.config.autonomousPlannerDailyLimit,12)
  assert.equal(pack.config.socialAutoSend,false)
  assert.throws(()=>restoreBackupFiles(to,pack),/不同的鱼鱼角色/)
  assert.equal(get(to,'character-identity.json').id,'22222222-2222-4222-8222-222222222222')
 }finally{rmSync(from,{recursive:true,force:true});rmSync(to,{recursive:true,force:true})}
})

test('RC: 历史生活预设不能因升级自动变成新的安静/自然/活跃参数',()=>{
 const old={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,
   autonomousPlannerMinutes:60,autonomousPlannerDailyLimit:12,
   autonomousPlannerStartHour:9,autonomousPlannerEndHour:23}
 const saved=structuredClone(old)
 assert.equal(lifeSettingsV2(saved).pace,'legacy-natural')
 assert.deepEqual(saved,old)
 assert.equal(saved.autonomousPlannerMinutes,60)
 assert.equal(saved.autonomousPlannerDailyLimit,12)
})
