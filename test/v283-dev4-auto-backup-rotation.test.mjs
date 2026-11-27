import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,existsSync,rmSync,writeFileSync,readFileSync,utimesSync,symlinkSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createBackup} from '../lib/data-backup.mjs'
import {saveAutomaticBackup,listBackupFiles,inspectBackupInDirectory,pruneAutomaticBackups,deleteBackupInDirectory,hasTodaysAutomatic} from '../lib/backup-rotation.mjs'

test('每日最多一份自动业务备份；保留两日；不清理手动文件',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-auto-'))
 try{
  const backup=createBackup({root:dir,config:{masterEnabled:true},sqlite:{},version:'2.8.3-dev.4'})
  const at=day=>new Date(2026,10,day,11)
  for(let day=10;day<=16;day++){
   assert.equal(saveAutomaticBackup(dir,backup,{now:at(day)}).created,true)
   assert.equal(saveAutomaticBackup(dir,backup,{now:at(day)}).created,false)
  }
  const rows=listBackupFiles(dir)
  assert.equal(rows.length,2)
  assert.deepEqual(rows.map(x=>x.day),['2026-11-16','2026-11-15'])
  assert.equal(inspectBackupInDirectory(dir,rows[0].name).summary.integrity,'sha256-verified')
  assert.throws(()=>inspectBackupInDirectory(dir,'../config.json'),/有效/)
  writeFileSync(join(dir,'pre-restore-2026-11-10T10-00-00-000Z-01234567.json'),'{}')
  pruneAutomaticBackups(dir,{now:at(20)})
  assert.equal(existsSync(join(dir,'pre-restore-2026-11-10T10-00-00-000Z-01234567.json')),true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('自动备份设置独立，统一清单可组合筛选内容与自动/手动来源',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const start=html.indexOf('<section class="backup-auto-section"'),end=html.indexOf('<section class="backup-library-section"')
 assert.ok(start>=0&&end>start)
 assert.match(html.slice(start,end),/id="backup-auto-enabled"/)
 assert.doesNotMatch(html.slice(start,end),/id="backup-list"/)
 assert.match(html,/id="backup-content-filter"/)
 assert.match(html,/id="backup-origin-filter"/)
 assert.match(js,/contentFilter===kind/)
 assert.match(js,/originFilter===origin/)
})

test('恢复前人生记忆备份按记忆+恢复前保护筛选，业务备份不会混入',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-backup-types-'))
 try{
  for(const name of ['dafeiyu-memory','pre-memory-restore','dafeiyu-auto','dafeiyu-backup','pre-restore']){
   writeFileSync(join(dir,name+'-2026-11-24T01-02-03-000Z-01234567.json'),'{}')
  }
  const found=listBackupFiles(dir,{limit:50})
  assert.equal(found.length,5)
  for(const row of found){
   assert.equal(row.contentType,['dafeiyu-memory','pre-memory-restore'].some(x=>row.name.startsWith(x+'-'))?'memory':'business')
   assert.equal(row.origin,row.name.startsWith('dafeiyu-auto-')?'automatic':row.name.startsWith('pre-')?'recovery':'manual')
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
})


test('备份跨类型按实际文件时间排序，删除须匹配原文件且拒绝任意路径',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-delete-backup-'))
 try{
  const names=['dafeiyu-memory-2026-11-24T01-02-03-000Z-01234567.json','dafeiyu-backup-2026-11-24T01-02-03-000Z-01234567.json','pre-restore-2026-11-24T01-02-03-000Z-01234567.json']
  for(const [i,n] of names.entries()){writeFileSync(join(dir,n),'{}');utimesSync(join(dir,n),100+i,100+i)}
  const rows=listBackupFiles(dir);assert.deepEqual(rows.map(x=>x.name),names.slice().reverse())
  const selected=rows[1];assert.throws(()=>deleteBackupInDirectory(dir,selected.name,{...selected,size:999}),/已变化/)
  assert.throws(()=>deleteBackupInDirectory(dir,'../config.json',selected),/有效/)
  assert.equal(deleteBackupInDirectory(dir,selected.name,selected),true);assert.equal(existsSync(join(dir,selected.name)),false)
  assert.equal(listBackupFiles(dir).length,2);assert.equal(existsSync(join(dir,names[2])),true)
  const unsafe='dafeiyu-auto-2026-11-24T01-02-03-000Z-01234567.json'
  // Windows may require developer mode for symbolic links. The directory case is universal.
  try{symlinkSync(join(dir,names[2]),join(dir,unsafe));assert.throws(()=>deleteBackupInDirectory(dir,unsafe,rows[0]),/不安全/)}catch(e){if(!['EPERM','EACCES','ENOSYS'].includes(e.code))throw e}
  const unsafeDir='dafeiyu-auto-2026-11-24T01-02-03-000Z-01234568.json';mkdirSync(join(dir,unsafeDir));assert.throws(()=>deleteBackupInDirectory(dir,unsafeDir,rows[0]),/不安全/);assert.equal(existsSync(join(dir,unsafeDir)),true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})


test('损坏的当日文件不能冒充成功或清除最后一份有效备份；同名目录、旧格式及他人备份不参与轮换',()=>{
 const root=mkdtempSync(join(tmpdir(),'dsh-rotation-scope-')),dir=mkdtempSync(join(tmpdir(),'dsh-rotation-out-'))
 try{
  const at=day=>new Date(2026,10,day,11),A='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
  const snapshot=id=>{writeFileSync(join(root,'character-identity.json'),JSON.stringify({version:1,id,createdAt:1}));return createBackup({root,config:{},sqlite:{}})}
  const a=snapshot(A),b=snapshot(B),old=saveAutomaticBackup(dir,a,{now:at(10)}).filePath,foreign=saveAutomaticBackup(dir,b,{now:at(10)}).filePath
  const c=snapshot('cccccccc-cccc-4ccc-accc-cccccccccccc'),foreignOld=saveAutomaticBackup(dir,c,{now:at(10)}).filePath
  assert.throws(()=>saveAutomaticBackup(dir,{...a,schema:1,manifest:undefined},{now:at(11)}),/完整校验/)
  const bad=join(dir,'dafeiyu-auto-2026-11-16T01-02-03-000Z-01234567.json.gz')
  const fakeDir=join(dir,'dafeiyu-auto-2026-11-16T01-02-03-000Z-01234568.json')
  const unsigned=join(dir,'dafeiyu-auto-2026-11-16T01-02-03-000Z-01234569.json')
  writeFileSync(bad,'damaged');mkdirSync(fakeDir);writeFileSync(unsigned,JSON.stringify({...a,schema:1,manifest:undefined}))
  const otherToday=saveAutomaticBackup(dir,b,{now:at(16)}).filePath
  assert.equal(hasTodaysAutomatic(dir,at(16),{characterId:A}),false)
  assert.equal(pruneAutomaticBackups(dir,{now:at(16),characterId:A}),0)
  assert.equal(existsSync(old),true);assert.equal(existsSync(foreign),false,'B only prunes its own old backup')
  const result=saveAutomaticBackup(dir,a,{now:at(16),characterId:A})
  assert.equal(result.created,true);assert.equal(result.removed,1);assert.equal(existsSync(old),false)
  assert.equal(hasTodaysAutomatic(dir,at(16),{characterId:A}),true)
  assert.equal(existsSync(foreignOld),true);assert.equal(existsSync(otherToday),true);assert.equal(existsSync(bad),true);assert.equal(existsSync(unsigned),true);assert.equal(existsSync(fakeDir),true)
  assert.throws(()=>saveAutomaticBackup(dir,a,{now:at(16),characterId:B}),/身份/)
  // A previously verified file can be corrupted later; the positive cache must invalidate.
  writeFileSync(result.filePath,'later corruption')
  assert.equal(hasTodaysAutomatic(dir,at(16),{characterId:A}),false)
  assert.equal(saveAutomaticBackup(dir,a,{now:at(16),characterId:A}).created,true)
 }finally{rmSync(root,{recursive:true,force:true});rmSync(dir,{recursive:true,force:true})}
})
