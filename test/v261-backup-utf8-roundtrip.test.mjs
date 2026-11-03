import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackup, validateBackup, restoreBackupFiles, validateRestoreIdentity } from '../lib/data-backup.mjs'
import { readJsonRequest } from '../lib/http-json-body.mjs'
import { saveBackupJson } from '../lib/backup-directory.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-backup-utf8-'))
const text='## 看过的视频\r\n| 日期 | BV号 | 标题 | 作者 | 状态 |\r\n'
  +'| 2026-11-02 | BV1pXHK6mE6z | 方大同的《麦恩莉》🎵🐟 | 中文 UP | 已保存 |\r\n'
  +'用户互动：鱼鱼记得曾经讨论过「你的好奇心是什么？」\r\n'
function legacyFixture(root){
  writeFileSync(join(root,'seen.md'),text.repeat(200))
  writeFileSync(join(root,'duty.md'),'# 鱼鱼的约定\n请尊重真实经历与记忆衰减。\n')
  mkdirSync(join(root,'out'),{recursive:true})
  writeFileSync(join(root,'out','2026-11-02.md'),'方大同的音乐作品还需要更深入了解 🌻')
  return createBackup({root,config:{personaPrompt:'不编造听感',masterEnabled:false},sqlite:{},version:'2.4.69'})
}
async function uploadInChunks(input,chunks,strict=true){
  const req=new PassThrough()
  const p=readJsonRequest(req,90_000_000,{strict})
  for(const c of chunks)req.write(c)
  req.end()
  return p
}

test('备份文件保存后再次读取：旧版业务备份原样有效、中文及 emoji 不变，可恢复',()=>{
  const source=temp(),dest=temp(),output=temp()
  try{
    const backup=legacyFixture(source)
    assert.equal(backup.schema,2)
    assert.equal(backup.files['character-identity.json'],undefined,'老用户没有新角色 ID 时仍然兼容')
    assert.deepEqual(validateRestoreIdentity(output,backup),{ok:true,legacyBackup:true})
    const saved=saveBackupJson(dest,backup)
    const reread=JSON.parse(readFileSync(saved,'utf8'))
    assert.equal(validateBackup(reread).integrity,'sha256-verified')
    assert.equal(reread.files['seen.md'],backup.files['seen.md'])
    restoreBackupFiles(output,reread)
    assert.equal(readFileSync(join(output,'seen.md'),'utf8'),backup.files['seen.md'])
    assert.equal(readFileSync(join(output,'out','2026-11-02.md'),'utf8'),backup.files['out/2026-11-02.md'])
    assert.equal(readdirSync(dest).filter(x=>x.endsWith('.partial')).length,0)
  } finally {for(const d of [source,dest,output])rmSync(d,{recursive:true,force:true})}
})

test('浏览器上传合法旧备份：任意 TCP 分块切开 seen.md 中汉字和 emoji，也不能改变字节或 SHA-256',async()=>{
  const source=temp(),output=temp()
  try{
    const backup=legacyFixture(source)
    const payload=Buffer.from(JSON.stringify({backup,confirm:'RESTORE_VERIFIED_DATA'}),'utf8')
    const probes=[Buffer.from('鱼'),Buffer.from('方'),Buffer.from('🎵'),Buffer.from('🐟'),Buffer.from('🌻')]
    for(const token of probes){
      const pos=payload.indexOf(token)
      assert.ok(pos>0,`缺少 ${token.toString('utf8')} 证据`)
      // Split within the multibyte character, not at UTF-8 boundaries.
      const boundary=pos+1
      const body=await uploadInChunks(payload,[payload.subarray(0,boundary),payload.subarray(boundary)])
      assert.equal(validateBackup(body.backup).integrity,'sha256-verified')
      assert.equal(body.backup.files['seen.md'],backup.files['seen.md'])
    }
    // Simulate a real uploader sending many fragmented network buffers.
    const slices=[]
    for(let i=0;i<payload.length;i+=311)slices.push(payload.subarray(i,i+311))
    const parsed=await uploadInChunks(payload,slices)
    assert.equal(validateBackup(parsed.backup).integrity,'sha256-verified')
    restoreBackupFiles(output,parsed.backup)
    assert.equal(readFileSync(join(output,'seen.md'),'utf8'),backup.files['seen.md'])
  }finally{for(const d of [source,output])rmSync(d,{recursive:true,force:true})}
})

test('已真正损坏的历史文件或哈希不匹配的文件仍拒绝恢复，不修改现有内容',async()=>{
  const source=temp(),destination=temp()
  try{
    const backup=legacyFixture(source)
    const tampered=structuredClone(backup)
    tampered.files['seen.md']=tampered.files['seen.md'].replace('方大同','�大同')
    const parsed=await uploadInChunks(null,[Buffer.from(JSON.stringify({backup:tampered}))])
    assert.throws(()=>validateBackup(parsed.backup),/备份完整性校验失败：seen\.md/)
    writeFileSync(join(destination,'seen.md'),'正在使用的重要原始数据')
    assert.throws(()=>restoreBackupFiles(destination,parsed.backup),/完整性校验失败/)
    assert.equal(readFileSync(join(destination,'seen.md'),'utf8'),'正在使用的重要原始数据')
  }finally{for(const d of [source,destination])rmSync(d,{recursive:true,force:true})}
})

test('损坏或超限的备份 HTTP 载荷拒绝，其他旧接口继续保持空对象兼容',async()=>{
  assert.deepEqual(await uploadInChunks(null,[Buffer.from('{broken')],false),{})
  await assert.rejects(uploadInChunks(null,[Buffer.from('{broken')],true),/JSON 无法解析/)
  const req=new PassThrough(),pending=readJsonRequest(req,3,{strict:true})
  req.end(Buffer.from('中文中文'))
  await assert.rejects(pending,/大小限制/)
})
