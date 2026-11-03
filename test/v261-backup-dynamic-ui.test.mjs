import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createBackup, validateBackup, restoreBackupFiles } from '../lib/data-backup.mjs'
import { __test as reflectionTest } from '../lib/life-reflection.mjs'

const temp = () => mkdtempSync(join(tmpdir(), 'dafeiyu-dynamic-backup-'))
const put = (dir, rows) => {
  mkdirSync(join(dir, 'life-memory'), {recursive:true})
  writeFileSync(join(dir, 'life-memory/candidates.json'), JSON.stringify({
    version:1, candidates:rows, runs:[], lastReflectionAt:0, lastError:''
  }), 'utf8')
}
const dynamicComment = () => {
  const row=reflectionTest.normalizeCandidate({
    kind:'comment',key:'comment:dynamic:123456789012345:555666777',bvid:'',
    dynamicId:'123456789012345', title:'动态评论带来的真实经历',text:'实际已确认的公开动态评论'
  },Date.parse('2026-11-02T10:00:00Z'))
  assert.ok(row,'动态评论必须能形成反思候选')
  return row
}

test('真实动态评论候选无 BV 时，完整业务备份可导出、验证并恢复，原记录未丢失',()=>{
  const dir=temp(),target=temp()
  try{
    const row=dynamicComment()
    assert.equal(row.bvid,'')
    assert.equal(row.contentType,'dynamic')
    put(dir,[row])
    const backup=createBackup({root:dir,config:{},sqlite:{}})
    assert.equal(validateBackup(backup).integrity,'sha256-verified')
    assert.deepEqual(JSON.parse(backup.files['life-memory/candidates.json']).candidates,[row])
    restoreBackupFiles(target,backup)
    assert.deepEqual(JSON.parse(readFileSync(join(target,'life-memory/candidates.json'),'utf8')).candidates,[row])
  }finally{rmSync(dir,{recursive:true,force:true});rmSync(target,{recursive:true,force:true})}
})

test('视频评论和私人候选的原校验保持兼容',()=>{
  const dir=temp()
  try{
    const video=reflectionTest.normalizeCandidate({kind:'comment',key:'comment:video:good-1',
      bvid:'BV1pXHK6mE6z',title:'视频下的公开评论'})
    assert.ok(video)
    const privateRow={
      id:'c-'+'a'.repeat(18),key:'private:owner-dm:'+'b'.repeat(20),
      kind:'private-social',bvid:'',visibility:'owner-private',subjectUid:'owner',
      status:'pending',memoryIds:[]
    }
    put(dir,[video,privateRow])
    assert.equal(validateBackup(createBackup({root:dir,config:{},sqlite:{}})).integrity,'sha256-verified')
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('伪造/混用动态与 BV 标识、错误来源类型仍拒绝备份',()=>{
  const dir=temp()
  try{
    const good=dynamicComment()
    const bad=[
      {...good,dynamicId:'000001234567'},
      {...good,dynamicId:123456789012345},
      {...good,dynamicId:'https://t.bilibili.com/123456789012345'},
      {...good,bvid:'BV1pXHK6mE6z'},
      {...good,contentType:'video'},
      {...good,kind:'watch'},
      {...good,kind:'social'},
      {...good,dynamicId:''},
      {...good,bvid:'BVwrong'},
    ]
    for(const row of bad){
      put(dir,[row])
      assert.throws(()=>createBackup({root:dir,config:{},sqlite:{}}),/人生记忆候选备份无效.*来源 ID 不合法/,JSON.stringify(row))
    }
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('备份页面主操作直接可见，专项和危险恢复默认折叠且保留现有按钮事件 ID',()=>{
  const html=readFileSync(fileURLToPath(new URL('../lib/management-console.html',import.meta.url)),'utf8')
  const section=html.slice(html.indexOf('<section id="panel-backup" hidden>'),html.indexOf('<section id="panel-home" hidden>'))
  assert.match(section,/id="backup-export"[^>]*>备份全部业务数据/)
  assert.match(section,/id="backup-directory"/)
  assert.match(section,/<details class="backup-fold" id="backup-memory-tools">/)
  assert.match(section,/<details class="backup-fold backup-restore-fold" id="backup-recovery-tools">/)
  assert.doesNotMatch(section,/<details[^>]+\sopen(?:\s|>)/)
  for(const id of ['backup-directory-save','backup-directory-status','backup-progress','memory-backup-export',
    'memory-backup-export-status','life-memory-health','life-memory-health-refresh',
    'memory-backup-import-file','memory-backup-inspect','memory-backup-restore',
    'backup-import-file','backup-inspect','backup-restore']){
    assert.equal((section.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`缺少或重复绑定 ${id}`)
  }
  assert.match(section,/id="backup-restore"[^>]+disabled/)
  assert.match(section,/id="memory-backup-restore"[^>]+disabled/)
  assert.match(html,/@media\(prefers-color-scheme:dark\)/)
  assert.match(html,/@media\(max-width:700px\)/)
})

test('备份接口失败时在当前卡片展示原因，不会永远停留“正在保存”',()=>{
  const js=readFileSync(fileURLToPath(new URL('../lib/management-console.js',import.meta.url)),'utf8')
  const exportFlow=js.slice(js.indexOf("$('backup-export').addEventListener"),js.indexOf("let selectedMemoryBackup=null;"))
  assert.match(exportFlow,/catch\(e\)\{[\s\S]*?backup-progress.*?备份未完成/)
  const memoryFlow=js.slice(js.indexOf("let selectedMemoryBackup=null;"),js.indexOf("$('memory-backup-import-file').addEventListener"))
  assert.match(memoryFlow,/catch\(e\)\{[\s\S]*?memory-backup-export-status.*?专项备份未完成/)
  assert.match(exportFlow,/finally\{button\.disabled=false\}/)
  assert.match(memoryFlow,/finally\{button\.disabled=false\}/)
})
