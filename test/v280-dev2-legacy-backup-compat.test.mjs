import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createBackup,createLifeMemoryBackup,inspectLifeMemoryBackup,
  restoreLifeMemoryBackup,restoreBackupFiles,validateBackup} from '../lib/data-backup.mjs'
import {recordInterestEvents,listLifeInterests} from '../lib/life-interests.mjs'
import {createColdSnapshot,restoreColdSnapshot,verifyColdSnapshot} from '../lib/cold-state-snapshot.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-v280-backup-'))
const put=(root,file,obj)=>{
  const path=join(root,file);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,typeof obj==='string'?obj:JSON.stringify(obj,null,2)+'\n','utf8')
}
const oldInterests=()=>({schema:1,entries:[{topic:'游戏',firstSeen:'2025-12-01T10:00:00.000Z',lastSeen:'2025-12-01T10:00:00.000Z',peakStage:'legacy-unverified',
 evidence:[{bvid:'BV1234567890',at:'2025-12-01T10:00:00.000Z',day:'2025-12-01'}],
 history:[{at:'2025-12-01T10:00:00.000Z',from:'insufficient',to:'legacy-unverified',evidenceCount:1},
          {at:'2026-11-10T10:00:00.000Z',from:'legacy-unverified',to:'emerging',evidenceCount:3}]}],updatedAt:'2026-11-10T10:00:00Z'})
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')

test('老用户兴趣成长历史中的 legacy-unverified 不再使全部业务备份失败，原文无损往返',()=>{
 const root=temp(),dest=temp()
 try {
  const source=JSON.stringify(oldInterests(),null,2)+'\n'
  put(root,'life-memory/interests.json',source)
  put(root,'owner-todos.json',{version:1,items:[]})
  const backup=createBackup({root,config:{masterEnabled:false},sqlite:{},version:'2.8.0-dev.2'})
  assert.equal(validateBackup(backup).integrity,'sha256-verified')
  assert.equal(backup.files['life-memory/interests.json'],source)
  assert.equal(restoreBackupFiles(dest,backup),2)
  assert.equal(readFileSync(join(dest,'life-memory/interests.json'),'utf8'),source)
  assert.equal(listLifeInterests(dest).length,1)
  assert.equal(listLifeInterests(dest)[0].stage,'legacy-unverified')
 }finally{rmSync(root,{recursive:true,force:true});rmSync(dest,{recursive:true,force:true})}
})

test('完整人生记忆专项备份接受旧兴趣阶段并能恢复；不改变永久档案和兴趣历史',()=>{
 const root=temp(),dest=temp()
 try {
  const source=JSON.stringify(oldInterests(),null,2)+'\n'
  put(root,'life-memory/interests.json',source)
  put(root,'life-memory/episodic.json',{version:1,episodes:[],archiveKeys:[],updatedAt:0})
  put(root,'long-term-memory/dafeiyu.json',{version:3,scope:'dafeiyu-identity',policy:{},memories:[],traces:[],deleted:[],migration:{legacySessionFiles:[]}})
  const backup=createLifeMemoryBackup(root)
  assert.equal(inspectLifeMemoryBackup(backup).integrity,'sha256-verified')
  assert.equal(restoreLifeMemoryBackup(dest,backup),3)
  assert.equal(readFileSync(join(dest,'life-memory/interests.json'),'utf8'),source)
  assert.equal(readFileSync(join(dest,'long-term-memory/dafeiyu.json'),'utf8'),backup.files['long-term-memory/dafeiyu.json'])
 }finally{rmSync(root,{recursive:true,force:true});rmSync(dest,{recursive:true,force:true})}
})

test('兴趣模块自身生成的 legacy-unverified 阶段也是合法备份输入',()=>{
 const root=temp()
 try{
  const s=oldInterests()
  s.entries[0].history=[];s.entries[0].peakStage='';s.entries[0].evidence=[{bvid:'BV1234567891',at:'2026-11-10T10:00:00Z',day:'2026-11-10'}]
  put(root,'life-memory/interests.json',s)
  const now=Date.parse('2026-11-12T12:00:00Z')
  const r=recordInterestEvents(root,[{kind:'watch',bvid:'BV1234567890',title:'游戏实况',tier:'selected',time:'2026-11-12T11:00:00Z'}],now,{accountTag:'0123456789abcdef'})
  assert.equal(r.added,1)
  const stored=JSON.parse(readFileSync(join(root,'life-memory/interests.json'),'utf8'))
  assert.equal(stored.entries[0].history.at(-1).to,'legacy-unverified')
  assert.equal(createBackup({root,config:{},sqlite:{}}).files['life-memory/interests.json']!==undefined,true)
  assert.equal(inspectLifeMemoryBackup(createLifeMemoryBackup(root)).integrity,'sha256-verified')
 }finally{rmSync(root,{recursive:true,force:true})}
})

test('备份校验仍拒绝伪造兴趣阶段，SHA-256 正确也不能绕过结构校验',()=>{
 const root=temp(),dest=temp()
 try {
  put(root,'life-memory/interests.json',oldInterests())
  const backup=createBackup({root,config:{},sqlite:{}})
  const x=JSON.parse(backup.files['life-memory/interests.json'])
  x.entries[0].history[0].to='auto-authorized-dm'
  backup.files['life-memory/interests.json']=JSON.stringify(x)
  backup.manifest.files['life-memory/interests.json']=sha(backup.files['life-memory/interests.json'])
  assert.throws(()=>validateBackup(backup),/兴趣历史不合法/)
  assert.throws(()=>restoreBackupFiles(dest,backup),/兴趣历史不合法/)
  assert.equal(existsSync(join(dest,'life-memory/interests.json')),false)
 }finally{rmSync(root,{recursive:true,force:true});rmSync(dest,{recursive:true,force:true})}
})

test('旧用户完整离线冷快照不依赖新兴趣 schema，能逐字节校验恢复且冻结权限',()=>{
 const parent=temp(),root=join(parent,'state'),snapshot=join(parent,'cold')
 try{
  mkdirSync(root)
  const original=JSON.stringify(oldInterests(),null,2)+'\n'
  put(root,'life-memory/interests.json',original)
  put(root,'character-identity.json',{version:1,id:'11111111-1111-1111-1111-111111111111',createdAt:1})
  put(root,'accounts/333/private.bin','private but needs to survive\n')
  assert.throws(()=>createColdSnapshot({root,destination:snapshot}),/必须先停止/)
  assert.equal(createColdSnapshot({root,destination:snapshot,stoppedConfirmed:true}).files,3)
  assert.equal(verifyColdSnapshot(snapshot).files,3)
  put(root,'life-memory/interests.json','changed')
  const restored=restoreColdSnapshot({root,snapshot,stoppedConfirmed:true,confirm:'RESTORE_FULL_DSH_STATE'})
  assert.equal(readFileSync(join(root,'life-memory/interests.json'),'utf8'),original)
  assert.equal(readFileSync(join(root,'accounts/333/private.bin'),'utf8'),'private but needs to survive\n')
  assert.equal(JSON.parse(readFileSync(join(root,'restore-freeze.json'),'utf8')).reviewRequired,true)
  assert.equal(readFileSync(join(restored.safeguardPath,'life-memory/interests.json'),'utf8'),'changed')
 }finally{rmSync(parent,{recursive:true,force:true})}
})
