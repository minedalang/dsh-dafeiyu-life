import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createBackup,validateBackup,restoreBackupFiles} from '../lib/data-backup.mjs'
import {saveBackupJson} from '../lib/backup-directory.mjs'
import {listBackupFiles,inspectBackupInDirectory,saveAutomaticBackup,pruneAutomaticBackups} from '../lib/backup-rotation.mjs'

const fresh=()=>mkdtempSync(join(tmpdir(),'dsh-dev5-backup-'))
test('历史业务文件超过旧 48 MiB 与 3000 条后仍完整导出、压缩、校验及恢复',()=>{
 const root=fresh(),out=fresh(),dest=fresh()
 try{
  const reportDir=join(root,'reports');mkdirSync(reportDir)
  // Many independent reports + a compressible history payload: old code
  // failed before delivering any backup. No part may be dropped silently.
  const payload='曾经看过的公开视频与互动记录。'.repeat(690)
  for(let i=0;i<3020;i++)writeFileSync(join(reportDir,`report_${i}.md`),payload,'utf8')
  const snapshot=createBackup({root,config:{masterEnabled:false},sqlite:{},version:'2.8.3-dev.5'})
  assert.equal(Object.keys(snapshot.files).length,3020)
  assert.ok(Object.values(snapshot.files).reduce((n,v)=>n+Buffer.byteLength(v),0)>48*1024*1024)
  assert.equal(validateBackup(snapshot).count,3020)
  const name=saveBackupJson(out,snapshot).split(/[\\/]/).at(-1)
  assert.ok(name.endsWith('.json.gz'))
  assert.ok(statSync(join(out,name)).size<50*1024*1024)
  assert.equal(inspectBackupInDirectory(out,name).summary.count,3020)
  assert.equal(listBackupFiles(out).length,1)
  assert.equal(restoreBackupFiles(dest,snapshot),3020)
  assert.equal(readFileSync(join(dest,'reports','report_3019.md'),'utf8'),payload)
 }finally{for(const dir of [root,out,dest])rmSync(dir,{recursive:true,force:true})}
})
test('gzip 备份损坏拒绝预览；手动与恢复前快照不受自动五日轮换影响',()=>{
 const source=fresh(),dir=fresh()
 try{
  const snapshot=createBackup({root:source,config:{},sqlite:{}})
  const manual=saveBackupJson(dir,snapshot).split(/[\\/]/).at(-1)
  const recovery=saveBackupJson(dir,snapshot,'pre-restore').split(/[\\/]/).at(-1)
  assert.match(manual,/\.json\.gz$/)
  assert.equal(inspectBackupInDirectory(dir,manual).summary.integrity,'sha256-verified')
  for(let d=1;d<=9;d++)saveAutomaticBackup(dir,snapshot,{now:new Date(2026,10,d,12)})
  pruneAutomaticBackups(dir,{now:new Date(2026,10,9,12)})
  const all=listBackupFiles(dir)
  assert.equal(all.filter(r=>r.type==='automatic').length,5)
  assert.ok(all.some(r=>r.name===manual))
  assert.ok(all.some(r=>r.name===recovery))
  writeFileSync(join(dir,manual),Buffer.from('not a gzip'))
  assert.throws(()=>inspectBackupInDirectory(dir,manual))
 }finally{rmSync(source,{recursive:true,force:true});rmSync(dir,{recursive:true,force:true})}
})
