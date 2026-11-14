import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,existsSync,readFileSync,readdirSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnPython} from './helpers/python-sqlite-runner.mjs'
import {requireBackupDirectory,saveBackupJson} from '../lib/backup-directory.mjs'
import {createBackup} from '../lib/data-backup.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-v2469-'))
const helper=join(import.meta.dirname,'..','lib','data-backup-sqlite.py')
const python=(op,root,body='',extra={})=>spawnPython([helper,op,root],{
  encoding:'utf8',input:body,env:{...process.env,...extra},timeout:15000})

test('备份目录必须由用户指定，且必须可写、不能是磁盘根目录',()=>{
  assert.throws(()=>requireBackupDirectory(''),/先.*目录/)
  assert.throws(()=>requireBackupDirectory('relative/backup'),/绝对路径/)
  assert.throws(()=>requireBackupDirectory(process.platform==='win32'?'C:\\':'/'),/根目录/)
  const root=temp()
  try {
    const dest=join(root,'a folder','备份')
    assert.equal(requireBackupDirectory(dest,{create:true}),dest)
    assert.deepEqual(readdirSync(dest),[])
    const content=createBackup({root,config:{personaPrompt:'喜欢吃白饭'},sqlite:{}})
    const file=saveBackupJson(dest,content)
    assert.equal(existsSync(file),true)
    assert.equal(JSON.parse(readFileSync(file,'utf8')).config.personaPrompt,'喜欢吃白饭')
    const safeguard=saveBackupJson(dest,content,'pre-restore')
    assert.notEqual(file,safeguard)
    assert.equal(readdirSync(dest).length,2)
    assert.throws(()=>saveBackupJson(dest,content,'../../../oops'),/非法/)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('SQLite 完整导出和恢复无须 Windows TEMP/TMP/TMPDIR',()=>{
  const root=temp(),target=temp()
  try {
    mkdirSync(join(root,'dynamic-sync'),{recursive:true})
    const fixture=spawnPython(['-c',
      "import sqlite3,sys;d=sqlite3.connect(sys.argv[1]);d.execute('create table knowledge (name text,status text)');d.execute('insert into knowledge values (?,?)',('鱼来','approved'));d.commit();d.close()",
      join(root,'meme-memory.sqlite3')],{encoding:'utf8'})
    assert.equal(fixture.status,0,fixture.stderr)
    const bad=join(root,'no-such-temp');
    const unusable={TEMP:bad,TMP:bad,TMPDIR:bad}
    const exported=python('export',root,'',unusable)
    assert.equal(exported.status,0,exported.stderr+' / '+exported.stdout)
    const data=JSON.parse(exported.stdout)
    assert.ok(data.sqlite['meme-memory.sqlite3'])
    const imported=python('restore',target,JSON.stringify(data),unusable)
    assert.equal(imported.status,0,imported.stderr+' / '+imported.stdout)
    const verify=spawnPython(['-c',
      "import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute('select name,status from knowledge').fetchone())",
      join(target,'meme-memory.sqlite3')],{encoding:'utf8'})
    assert.match(verify.stdout,/鱼来/)
    assert.match(verify.stdout,/approved/)
    assert.equal(existsSync(bad),false)
  }finally{rmSync(root,{recursive:true,force:true});rmSync(target,{recursive:true,force:true})}
})

test('管理中心提供可配置目录及诊断正文缺失说明',()=>{
  const root=join(import.meta.dirname,'..')
  const html=readFileSync(join(root,'lib','management-console.html'),'utf8')
  const js=readFileSync(join(root,'lib','management-console.js'),'utf8')
  const host=readFileSync(join(root,'index.js'),'utf8')
  assert.match(html,/backup-directory-save/)
  assert.match(js,/data-backup\/location/)
  assert.match(host,/saveBackupJson\(folder, backup\)/)
  assert.match(host,/requireBackupDirectory\(cfg.backupDirectory\)/)
  assert.match(js,/旧记录无法无成本补出原文/)
  assert.match(js,/仅打开视频，无法精准跳转/)
})
