import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  createLifeMemoryBackup, inspectLifeMemoryBackup, restoreLifeMemoryBackup,
  createBackup, validateBackup, restoreBackupFiles,
} from '../lib/data-backup.mjs'
import { saveBackupJson } from '../lib/backup-directory.mjs'
import { readJsonRequest } from '../lib/http-json-body.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-dual-restore-'))
const put=(root,name,value)=>{
  const file=join(root,...name.split('/'))
  mkdirSync(join(file,'..'),{recursive:true})
  writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n','utf8')
}
const candidate=i=>({
  id:'c-'+i.toString(16).padStart(18,'0'),key:`comment:dynamic:123456789012345:${i+10000}`,
  kind:'comment',contentType:'dynamic',bvid:'',dynamicId:'123456789012345',
  status:'pending',memoryIds:[],day:'2026-11-02',title:'鱼鱼在动态评论里的真实经历 🌻',
  text:'来自观众的真实文字：我想了解怎样做视频，看看方大同的歌 🎵🐟',
})
const makeLifeFixture=root=>{
  const candidates=Array.from({length:85},(_,i)=>candidate(i))
  put(root,'life-memory/candidates.json',{version:1,candidates,runs:[],lastReflectionAt:0,lastError:''})
  put(root,'life-memory/episodic.json',{
    version:1,episodes:[{id:'ep-demo',kind:'watch',stage:'clear',text:'曾了解方大同的作品 🎵',at:1772450000000}],
    archiveKeys:[],updatedAt:1772450000000,
  })
  put(root,'long-term-memory/dafeiyu.json',{
    version:3,scope:'dafeiyu-identity',policy:{},memories:[],traces:[],deleted:[],migration:{legacySessionFiles:[]},
  })
  put(root,'life-memory/archive/2026-11.jsonl',JSON.stringify({version:1,id:'event-one',event:{kind:'watch',text:'研究视频制作：Pillow + FFmpeg 💜'}})+'\n')
  return {candidates}
}
function chunksAroundUtf8(payload,needle){
  const at=payload.indexOf(Buffer.from(needle,'utf8'))
  assert.ok(at>1,`必须在载荷中找到 ${needle}`)
  return [payload.subarray(0,at+1),payload.subarray(at+1,at+2),payload.subarray(at+2)]
}
async function postBody(payload,chunks,strict=true){
  const req=new PassThrough()
  const result=readJsonRequest(req,65_000_000,{strict})
  for(const chunk of chunks)req.write(chunk)
  req.end()
  return result
}
const serialized=(data,confirmation)=>Buffer.from(JSON.stringify({backup:data,confirm:confirmation}),'utf8')
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')

test('专项人生记忆：当前数据含动态评论候选时，导出→落盘→上传碎片→校验→恢复全链路无损',async()=>{
  const source=temp(),folder=temp(),dest=temp()
  try{
    const original=makeLifeFixture(source)
    const bundle=createLifeMemoryBackup(source)
    assert.equal(inspectLifeMemoryBackup(bundle).integrity,'sha256-verified')
    assert.equal(bundle.files['life-memory/private-insights.json'],undefined)
    const filepath=saveBackupJson(folder,bundle,'dafeiyu-memory')
    const disk=JSON.parse(readFileSync(filepath,'utf8'))
    const buf=serialized(disk,'RESTORE_DAFEIYU_MEMORY')
    for(const needle of ['鱼鱼','真实经历','🎵','🐟','FFmpeg','🌻']){
      const parsed=await postBody(buf,chunksAroundUtf8(buf,needle))
      assert.equal(inspectLifeMemoryBackup(parsed.backup).integrity,'sha256-verified')
      assert.equal(parsed.backup.files['life-memory/candidates.json'],bundle.files['life-memory/candidates.json'])
    }
    const little=[]
    for(let i=0;i<buf.length;i+=97)little.push(buf.subarray(i,i+97))
    const parsed=await postBody(buf,little)
    const snapshot=saveBackupJson(folder,createLifeMemoryBackup(dest),'pre-memory-restore')
    assert.ok(existsSync(snapshot))
    assert.equal(restoreLifeMemoryBackup(dest,parsed.backup),Object.keys(bundle.files).length)
    assert.deepEqual(JSON.parse(readFileSync(join(dest,'life-memory/candidates.json'),'utf8')).candidates,original.candidates)
    assert.equal(readFileSync(join(dest,'life-memory/candidates.json'),'utf8'),bundle.files['life-memory/candidates.json'])
    assert.equal(readFileSync(join(dest,'life-memory/archive/2026-11.jsonl'),'utf8'),bundle.files['life-memory/archive/2026-11.jsonl'])
  }finally{for(const dir of [source,folder,dest])rmSync(dir,{recursive:true,force:true})}
})

test('旧版记忆备份 schema2 / 无新角色身份：严格 HTTP 上传后可校验并恢复，不要求额外账号',async()=>{
  const folder=temp(),target=temp()
  try{
    put(folder,'life-memory/episodic.json',{version:1,episodes:[],archiveKeys:[],updatedAt:0})
    put(folder,'long-term-memory/dafeiyu.json',{version:2,memories:[],traces:[],deleted:[]})
    const bundle=createLifeMemoryBackup(folder)
    const disk=JSON.parse(readFileSync(saveBackupJson(folder,bundle,'dafeiyu-memory'),'utf8'))
    assert.ok(!JSON.stringify(disk).includes('character-identity.json'))
    const buf=serialized(disk,'RESTORE_DAFEIYU_MEMORY')
    const parsed=await postBody(buf,[buf.subarray(0,1),buf.subarray(1,18),buf.subarray(18)])
    assert.equal(inspectLifeMemoryBackup(parsed.backup).integrity,'sha256-verified')
    restoreLifeMemoryBackup(target,parsed.backup)
    assert.deepEqual(JSON.parse(readFileSync(join(target,'long-term-memory/dafeiyu.json'),'utf8')).memories,[])
  }finally{for(const dir of [folder,target])rmSync(dir,{recursive:true,force:true})}
})

test('专项备份篡改候选和非法路径必须拒绝，绝不改动正在使用的原记忆',async()=>{
  const folder=temp(),target=temp()
  try{
    makeLifeFixture(folder)
    const bundle=createLifeMemoryBackup(folder)
    put(target,'life-memory/candidates.json','现在的真实人生记忆，不允许覆盖')
    const tampered=structuredClone(bundle)
    tampered.files['life-memory/candidates.json']=tampered.files['life-memory/candidates.json'].replace('真实经历','未验证经历')
    assert.throws(()=>restoreLifeMemoryBackup(target,tampered),/记忆备份文件篡改或路径非法：life-memory\/candidates\.json/)
    const unsafe=structuredClone(bundle)
    unsafe.files['life-memory/../bili_credential.json']='cookie'
    unsafe.hashes['life-memory/../bili_credential.json']=sha('cookie')
    assert.throws(()=>restoreLifeMemoryBackup(target,unsafe),/文件篡改或路径非法/)
    assert.equal(readFileSync(join(target,'life-memory/candidates.json'),'utf8'),'现在的真实人生记忆，不允许覆盖')
  }finally{for(const dir of [folder,target])rmSync(dir,{recursive:true,force:true})}
})

test('恢复时不应让更早备份使已衰减的经历重新变清晰',()=>{
  const folder=temp(),target=temp()
  try{
    makeLifeFixture(folder)
    const saved=createLifeMemoryBackup(folder)
    put(target,'life-memory/episodic.json',{
      version:1,episodes:[{id:'ep-demo',kind:'watch',stage:'trace',text:'一段模糊的经历',at:1772450000000}],archiveKeys:[],updatedAt:1772450000000,
    })
    restoreLifeMemoryBackup(target,saved)
    const after=JSON.parse(readFileSync(join(target,'life-memory/episodic.json'),'utf8'))
    assert.equal(after.episodes[0].stage,'trace')
    assert.equal(after.episodes[0].text,'一段模糊的经历')
  }finally{for(const dir of [folder,target])rmSync(dir,{recursive:true,force:true})}
})

test('大备份：旧用户 seen.md 与专项候选可同时存在；两种恢复使用同一严格读取器',async()=>{
  const root=temp(),dest=temp()
  try{
    makeLifeFixture(root)
    put(root,'seen.md','鱼鱼曾经通过观看资料了解世界\r\n方大同歌曲 🎵🐟\r\n')
    const whole=createBackup({root,config:{},sqlite:{},version:'2.6.1'})
    const buf=serialized(whole,'RESTORE_VERIFIED_DATA')
    const parsed=await postBody(buf,chunksAroundUtf8(buf,'方大同'))
    assert.equal(validateBackup(parsed.backup).integrity,'sha256-verified')
    restoreBackupFiles(dest,parsed.backup)
    assert.equal(readFileSync(join(dest,'seen.md'),'utf8'),whole.files['seen.md'])
    assert.equal(readFileSync(join(dest,'life-memory/candidates.json'),'utf8'),whole.files['life-memory/candidates.json'])
    const server=fileURLToPath(new URL('../index.js',import.meta.url))
    const code=readFileSync(server,'utf8')
    assert.match(code,/const readBackupBody = \(req, maxBytes\) => readJsonRequest\(req, maxBytes, \{strict:true\}\)/)
    assert.match(code,/const body = await readBackupBody\(req, 90_000_000\)/)
    assert.match(code,/const body=await readBackupBody\(req,65_000_000\),backup=body\?\.backup/)
  }finally{for(const dir of [root,dest])rmSync(dir,{recursive:true,force:true})}
})

test('严格上传：无效 UTF-8、截断 JSON、空载荷、超长载荷都有清晰拒绝原因',async()=>{
  await assert.rejects(postBody(null,[Buffer.from([0x7b,0x22,0xe9,0x7d])]),/UTF-8/)
  await assert.rejects(postBody(null,[Buffer.from('{"backup":')]),/备份 JSON 无法解析/)
  await assert.rejects(postBody(null,[]),/备份上传内容为空/)
  const req=new PassThrough()
  const pending=readJsonRequest(req,4,{strict:true})
  req.end(Buffer.from('中文中文'))
  await assert.rejects(pending,/大小限制/)
  // Other endpoints retain old optional/empty-body semantics.
  assert.deepEqual(await postBody(null,[Buffer.from('{invalid')],false),{})
})


test('真实本地 HTTP 上传：完整和专项备份经不等长网络写块仍可读取、独立核验',async()=>{
  const root=temp()
  let server
  try{
    makeLifeFixture(root)
    put(root,'seen.md','长期资料：🎵方大同；曾经看过的记录 🐟\r\n')
    const general=createBackup({root,config:{},sqlite:{}})
    const memory=createLifeMemoryBackup(root)
    server=createServer(async(req,res)=>{
      try{
        const payload=await readJsonRequest(req,65_000_000,{strict:true})
        const summary=req.url==='/memory'?inspectLifeMemoryBackup(payload.backup):validateBackup(payload.backup)
        res.writeHead(200,{'content-type':'application/json'})
        res.end(JSON.stringify({ok:true,summary,hash:sha(payload.backup)}))
      }catch(e){res.statusCode=400;res.end(JSON.stringify({ok:false,error:String(e?.message||e)}))}
    })
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)})
    const port=server.address().port
    for(const [url,backup,needle] of [['/business',general,'方大同'],['/memory',memory,'🎵']]){
      const payload=serialized(backup,'RESTORE_VERIFIED_DATA')
      const chunks=chunksAroundUtf8(payload,needle)
      const response=await new Promise((resolve,reject)=>{
        const req=httpRequest({hostname:'127.0.0.1',port,path:url,method:'POST',headers:{'content-type':'application/json;charset=utf-8'}},r=>{
          const bytes=[];r.on('data',d=>bytes.push(d));r.on('end',()=>resolve({status:r.statusCode,body:JSON.parse(Buffer.concat(bytes).toString('utf8'))}))
        })
        req.once('error',reject)
        for(const chunk of chunks)req.write(chunk)
        req.end()
      })
      assert.equal(response.status,200,JSON.stringify(response.body))
      assert.equal(response.body.hash,sha(backup))
      assert.equal(response.body.summary.integrity,'sha256-verified')
    }
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve))
    rmSync(root,{recursive:true,force:true})
  }
})

test('业务备份不能携带私密社交候选；专项备份可独立保留并恢复隐私记录',()=>{
  const src=temp(),dst=temp()
  try{
    makeLifeFixture(src)
    const privateRow={id:'c-'+'f'.repeat(18),key:'private:owner-dm:'+('b'.repeat(20)),
      kind:'private-social',bvid:'',visibility:'owner-private',status:'pending',memoryIds:[],text:'仅内部允许的低敏私密抽象'}
    const file=join(src,'life-memory/candidates.json')
    const old=JSON.parse(readFileSync(file,'utf8'))
    old.candidates.push(privateRow)
    put(src,'life-memory/candidates.json',old)
    put(src,'life-memory/private-insights.json',{schema:1,rows:[{id:'pi-'+'a'.repeat(18),visibility:'owner-private',text:'仅限私密域的抽象'}]})
    const business=createBackup({root:src,config:{},sqlite:{}})
    const businessRows=JSON.parse(business.files['life-memory/candidates.json']).candidates
    assert.ok(!businessRows.some(c=>c.kind==='private-social'))
    assert.equal(business.files['life-memory/private-insights.json'],undefined)
    const memory=createLifeMemoryBackup(src)
    assert.ok(JSON.parse(memory.files['life-memory/candidates.json']).candidates.some(c=>c.kind==='private-social'))
    assert.ok(memory.files['life-memory/private-insights.json'])
    restoreLifeMemoryBackup(dst,memory)
    assert.equal(readFileSync(join(dst,'life-memory/private-insights.json'),'utf8'),memory.files['life-memory/private-insights.json'])
  }finally{for(const dir of [src,dst])rmSync(dir,{recursive:true,force:true})}
})
