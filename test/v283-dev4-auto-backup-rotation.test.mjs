import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,existsSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createBackup} from '../lib/data-backup.mjs'
import {saveAutomaticBackup,listBackupFiles,inspectBackupInDirectory,pruneAutomaticBackups} from '../lib/backup-rotation.mjs'

test('每日最多一份自动业务备份；保留五日；不清理手动文件',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dsh-auto-'))
 try{
  const backup=createBackup({root:dir,config:{masterEnabled:true},sqlite:{},version:'2.8.3-dev.4'})
  const at=day=>new Date(2026,10,day,11)
  for(let day=10;day<=16;day++){
   assert.equal(saveAutomaticBackup(dir,backup,{now:at(day)}).created,true)
   assert.equal(saveAutomaticBackup(dir,backup,{now:at(day)}).created,false)
  }
  const rows=listBackupFiles(dir)
  assert.equal(rows.length,5)
  assert.deepEqual(rows.map(x=>x.day),['2026-11-16','2026-11-15','2026-11-14','2026-11-13','2026-11-12'])
  assert.equal(inspectBackupInDirectory(dir,rows[0].name).summary.integrity,'sha256-verified')
  assert.throws(()=>inspectBackupInDirectory(dir,'../config.json'),/有效/)
  writeFileSync(join(dir,'pre-restore-2026-11-10T10-00-00-000Z-01234567.json'),'{}')
  pruneAutomaticBackups(dir,{now:at(20)})
  assert.equal(existsSync(join(dir,'pre-restore-2026-11-10T10-00-00-000Z-01234567.json')),true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
