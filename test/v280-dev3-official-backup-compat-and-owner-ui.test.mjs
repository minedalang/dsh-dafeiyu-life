import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {
  createBackup, validateBackup, validateRestoreIdentity, restoreBackupFiles,
  backupAuthenticity, FORMAT, SCHEMA,
} from '../lib/data-backup.mjs'

const src=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8')
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
const oldFile='旧用户的不可丢失资料：过山车上临时开会 🎢\n'
const sampleFiles={'seen.md':oldFile,'long-term-memory/dafeiyu.json':JSON.stringify({version:3,scope:'dafeiyu-identity',policy:{},memories:[],traces:[],deleted:[]})}
function schema1(format='dsh-dafeiyu-life-backup'){
  // This is the actual official v2.4.99 envelope: no manifest, schema 1,
  // old package/earlier upstream package name, no character-identity.json.
  return {format,schema:1,version:'2.4.99',createdAt:'2026-10-29T08:07:06.123Z',
    config:{ownerUid:'123456789',autoComment:false},files:{...sampleFiles},sqlite:{}}
}
function schema2(version){
  const b={format:FORMAT,schema:SCHEMA,version,createdAt:'2026-11-02T06:30:00.000Z',
    config:{ownerUid:'123456789'},files:{...sampleFiles},sqlite:{}}
  b.manifest={algorithm:'sha256',files:Object.fromEntries(Object.entries(b.files).map(([k,v])=>[k,sha(v)])),config:sha(b.config),sqlite:sha(b.sqlite)}
  return b
}

test('v2.4.99 schema 1 official format can be inspected and restored without rewriting old files',()=>{
  const root=mkdtempSync(join(tmpdir(),'fish-legacy-v1-'))
  try{
    const b=schema1();const sum=validateBackup(b)
    assert.equal(sum.integrity,'legacy-unsealed')
    assert.equal(sum.legacyUnscoped,true)
    assert.equal(sum.count,2)
    assert.equal(backupAuthenticity(b),'legacy-unsealed')
    assert.equal(validateRestoreIdentity(root,b).legacyBackup,true)
    assert.equal(restoreBackupFiles(root,b),2)
    assert.equal(readFileSync(join(root,'seen.md'),'utf8'),oldFile)
    assert.equal(readFileSync(join(root,'long-term-memory','dafeiyu.json'),'utf8'),sampleFiles['long-term-memory/dafeiyu.json'])
    assert.equal(b.manifest,undefined,'never forge a manifest on the original legacy backup')
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('first-generation upstream official format name can be imported with separate warning',()=>{
  const b=schema1('dsh-bili-scroll-plus-backup')
  assert.equal(validateBackup(b).integrity,'legacy-unsealed')
})

test('v2.5.0, v2.5.4, v2.6.0, v2.6.1, v2.6.2, v2.7.0 signed envelope remains accepted',()=>{
  for (const v of ['2.5.0','2.5.1','2.5.2','2.5.3','2.5.4','2.6.0','2.6.1','2.6.2','2.7.0']) {
    const b=schema2(v)
    assert.equal(validateBackup(b).integrity,'sha256-verified',v)
    assert.equal(validateBackup(b).legacyUnscoped,true,'signed older versions can still lack identity binding')
    const root=mkdtempSync(join(tmpdir(),'fish-schema2-'))
    try{assert.equal(restoreBackupFiles(root,b),2)}finally{rmSync(root,{recursive:true,force:true})}
  }
})

test('signed backups must still reject tampering; legacy variants reject unsafe paths and bogus identity',()=>{
  const b=schema2('2.7.0');b.files['seen.md']='tampered'
  assert.throws(()=>validateBackup(b),/完整性校验/)
  for(const variant of [schema1(),schema1('dsh-bili-scroll-plus-backup')]) {
    variant.files['../../secret.txt']='unsafe'
    assert.throws(()=>validateBackup(variant),/路径/)
  }
  assert.throws(()=>validateBackup({...schema1(),schema:3}),/不支持/)
  assert.throws(()=>validateBackup({...schema1(),format:'stranger-backup'}),/不支持/)
})

test('legacy restore cannot bypass modern account identity protection when evidence exists',()=>{
  const root=mkdtempSync(join(tmpdir(),'fish-legacy-identity-'))
  try{
    const a='00000000-0000-4000-8000-000000000001'
    const b='00000000-0000-4000-8000-000000000002'
    writeFileSync(join(root,'character-identity.json'),JSON.stringify({version:1,id:a,createdAt:1700000000000}))
    const incoming=schema1()
    incoming.files['character-identity.json']=JSON.stringify({version:1,id:b,createdAt:1700000000000})
    assert.throws(()=>restoreBackupFiles(root,incoming),/不同的鱼鱼角色/)
    assert.equal(JSON.parse(readFileSync(join(root,'character-identity.json'),'utf8')).id,a)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('owner preview shows local time and distinguishes unsigned old backups from signed ones',()=>{
  const js=src('lib/management-console.js'),api=src('index.js')
  assert.match(js,/toLocaleString\('zh-CN'/)
  assert.match(js,/备份创建于/)
  assert.match(js,/旧版无原始校验清单/)
  assert.match(js,/RESTORE_LEGACY_UNSCOPED_DATA/)
  assert.match(api,/RESTORE_LEGACY_UNSCOPED_DATA/)
  assert.match(api,/!summary\.legacyUnscoped && body\.confirm/)
})

test('to-do management styles live in head and preserve selectors after moving to plans',()=>{
  const html=src('lib/management-console.html')
  const todo=html.indexOf('<div id="life-todo-section"')
  const scripts=html.indexOf('<script defer src="/api/bili-duty/manage.js"')
  assert.ok(todo>scripts)
  const after=html.slice(todo,html.indexOf('</section>',todo))
  assert.doesNotMatch(after,/<style>/)
  assert.match(html,/#panel-plans #owner-todo-list\{display:grid/)
  assert.match(html,/#panel-plans \.life-plan-admin-inner \.life-action\{display:inline-flex/)
  assert.match(html,/#panel-plans \.life-plan-admin-inner \.life-action\.life-green\{background:/)
  for(const id of ['owner-todo-add','owner-todo-remind','owner-todo-settings-save','owner-todo-list','owner-todo-refresh']) assert.ok(html.includes(`id="${id}"`),id)
})

test('README restores npm monthly/yearly badges; release notes are publication-facing',()=>{
  assert.match(src('README.md'),/shields\.io\/npm\/dm\/dsh-dafeiyu-life/)
  assert.match(src('README.md'),/shields\.io\/npm\/dy\/dsh-dafeiyu-life/)
  assert.doesNotMatch(src('README.md'),/尚未发布正式版/)
  assert.match(src('RELEASE_NOTES_v2.8.0.md'),/正式版更新说明/)
  assert.doesNotMatch(src('RELEASE_NOTES_v2.8.0.md'),/发布说明草案/)
  assert.match(src('client.js'),/欢迎私信反馈 Bug 与改进建议/)
})
