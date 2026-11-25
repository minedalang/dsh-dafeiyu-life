/**
 * Read-only post-migration Life verification. Never calls decay(), reconcile(),
 * or embedding writers: verification must not change a user's experiences.
 * A file-level migration receipt alone is NOT proof of readable Life memories.
 */
import {existsSync,lstatSync,readdirSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {storageLayoutStatus,storageDataPath} from './storage-layout.mjs'
import {createHybridIndex} from './hybrid-memory-search.mjs'
import {validateDetailFragments} from './life-memory-details.mjs'
import {expandVideoObservationGroups} from './video-memory-observation-groups.mjs'

const ID=/^e-[a-f0-9]{18}$/
const ACCOUNT=/^[a-f0-9]{16}$/
const HASH=/^[a-f0-9]{64}$/
const safeError=e=>String(e?.message||e||'检查失败').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,180)
const knownStages=new Set(['clear','fuzzy','trace','forgotten'])
const dataJSON=(path,max=8*1024*1024)=>{
 const s=lstatSync(path)
 if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw Error('数据文件不安全或超出读取限额')
 return JSON.parse(readFileSync(path,'utf8'))
}
const directory=path=>{
 if(!existsSync(path))return false
 const s=lstatSync(path)
 if(!s.isDirectory()||s.isSymbolicLink())throw Error('目录存在不可信的链接或特殊文件')
 return true
}
/** Validates every directory entry without following a link, including absent optional partitions. */
function scanPlain(root,{maxEntries=40000,maxBytes=12*1024**3}={}){
 if(!directory(root))return {present:false,files:0,bytes:0}
 let files=0,bytes=0,visited=0;const pending=[root]
 while(pending.length){
  const p=pending.pop()
  for(const name of readdirSync(p)){
   const current=join(p,name),s=lstatSync(current)
   if(s.isSymbolicLink())throw Error('记忆目录存在符号链接，无法确认数据来源')
   if(s.isDirectory())pending.push(current)
   else if(s.isFile()){files++;bytes+=s.size}
   else throw Error('记忆目录包含不支持的特殊文件')
   if(++visited>maxEntries||bytes>maxBytes)throw Error('记忆资料超过安全验证上限')
  }
 }
 return {present:true,files,bytes}
}
function readEpisodes(path){
 const data=dataJSON(path)
 if(data?.version!==1||!Array.isArray(data.episodes)||!Array.isArray(data.archiveKeys)||data.episodes.length>3200||data.archiveKeys.length>30000)
  throw Error('情节记忆版本、数量或结构异常')
 data.episodes=expandVideoObservationGroups(data.episodes)
 const seen=new Set()
 for(const e of data.episodes){
  if(!e||!ID.test(String(e.id))||seen.has(e.id)||!knownStages.has(e.stage))throw Error('情节记忆身份或阶段异常')
  seen.add(e.id)
  if(e.stage==='forgotten'&&(
   e.text||e.bvid||e.key||e.visualMemo||e.incomingText||e.actorUid||e.recipientUid||e.dynamicId||e.readEvidenceKinds))
   throw Error('已遗忘情节仍含可回忆明文，拒绝验收')
 }
 return data
}
function readRevocations(path){
 if(!existsSync(path))return new Set()
 const data=dataJSON(path)
 if(data?.version!==1||!Array.isArray(data.ids)||data.ids.length>200000)throw Error('遗忘撤销记录版本或数量异常')
 const ids=new Set()
 for(const id of data.ids){if(!ID.test(id)||ids.has(id))throw Error('遗忘撤销 ID 不合法或重复');ids.add(id)}
 return ids
}
function detailsCheck(root,episodes,revoked){
 const details=join(root,'life-memory','details','v1')
 if(!directory(details))return {files:0,missing:true}
 const byId=new Map(episodes.map(e=>[e.id,e]));let files=0
 for(const tag of readdirSync(details)){
  if(!ACCOUNT.test(tag))throw Error('存在无法归属的深层详情账号目录')
  const dir=join(details,tag);directory(dir)
  for(const filename of readdirSync(dir)){
   if(!/^e-[a-f0-9]{18}\.json$/.test(filename)){
    // A leftover lock must be investigated before old data can be deleted.
    throw Error('深层详情目录存在待处理的临时文件或锁')
   }
   const id=filename.slice(0,-5),ep=byId.get(id),path=join(dir,filename)
   if(!ep||ep.accountTag!==tag||ep.stage!=='clear'||ep.kind!=='watch'||ep.visibility!=='public-event'||revoked.has(id))
    throw Error('深层详情与现役可回忆记忆或遗忘保护不一致')
   const doc=dataJSON(path,256*1024+4096)
   const fingerprint=createHash('sha256').update(JSON.stringify([ep.id,ep.accountTag,ep.kind,ep.at,ep.bvid,ep.visibility])).digest('hex')
   if(doc?.schema!=='life-memory-detail/v1'||doc.parentMemoryId!==id||doc.accountTag!==tag||doc.parentFingerprint!==fingerprint)
    throw Error('深层详情来源指纹不匹配')
   validateDetailFragments(doc.fragments)
   files++
  }
 }
 return {files,missing:false}
}
function vectorCheck(root,allEpisodes,revoked){
 const dir=join(root,'embedding-memory-index')
 if(!directory(dir))return {files:0,notApplicable:true}
 const manifestPath=join(dir,'manifest.json')
 if(!existsSync(manifestPath)){
  if(readdirSync(dir).length)throw Error('向量索引目录非空但缺少清单')
  return {files:0,notApplicable:true}
 }
 const manifest=dataJSON(manifestPath,4*1024*1024)
 if(manifest?.schema!==1||!Array.isArray(manifest.entries)||manifest.entries.length>10000||
    !Number.isSafeInteger(manifest.dimension)||manifest.dimension<1||manifest.dimension>8192||
    !/^vectors-[a-f0-9-]{20,50}\.f32$/.test(String(manifest.vectorFile||'')))throw Error('向量索引清单无效')
 const vectorPath=join(dir,manifest.vectorFile),s=lstatSync(vectorPath)
 if(!s.isFile()||s.isSymbolicLink()||s.size!==manifest.entries.length*manifest.dimension*4)throw Error('向量索引文件大小与清单不一致')
 const content=readFileSync(vectorPath)
 for(let offset=0;offset<content.length;offset+=4){
  if(!Number.isFinite(content.readFloatLE(offset)))throw Error('向量索引中包含 NaN 或无穷值，不能通过运行验证')
 }
 const seen=new Set()
 // Stale indexes are not recall sources; nevertheless refuse to mark a
 // revoked or explicitly forgotten memory's persisted vector as verified.
 const forgotten=new Set(allEpisodes.filter(x=>x.stage==='forgotten').map(x=>x.id))
 for(const e of manifest.entries){
  if(!e||typeof e.id!=='string'||!HASH.test(e.hash)||seen.has(e.id))throw Error('向量索引条目非法或重复')
  if(revoked.has(e.id)||forgotten.has(e.id))throw Error('持久化向量索引仍包含已遗忘记忆')
  seen.add(e.id)
 }
 return {files:manifest.entries.length,notApplicable:false}
}
/** Public output contains only counts/statuses, never the user's memory text. */
export function verifyRelocatedLifeMemory({root,allowDefaultHome=false}={}){
 const result={ok:true,ready:false,target:null,checks:{}}
 const check=(key,label,fn)=>{
  try{const stats=fn()||{};result.checks[key]={ok:true,label,...stats};return stats}
  catch(e){result.checks[key]={ok:false,label,reason:safeError(e)};return null}
 }
 let base,where,episodic,revoked
 const identity=check('identity','当前生效目录及分盘身份',()=>{
  base=storageLayoutStatus(root)
  const entry=base.domains.memory
  const relocated=entry.configured===true&&entry.root!==base.root
  const returnedHome=allowDefaultHome===true&&entry.configured===false&&entry.root===base.root
  if(!relocated&&!returnedHome)throw Error('Life 当前未在可验证的迁移后位置')
  where=entry.root
  for(const rel of ['life-memory','long-term-memory','detail-protection','embedding-memory-index']){
   const resolved=storageDataPath(base.root,rel)
   if(resolved!==join(where,rel))throw Error('Life 读取路径仍指向旧目录：'+rel)
  }
  result.target=where
  return {configured:relocated,returnedHome}
 })
 if(!identity)return result
 check('paths','分盘内目录安全与可读取',()=>{
  let files=0,bytes=0
  for(const rel of ['life-memory','long-term-memory','detail-protection','embedding-memory-index']){
   const data=scanPlain(join(where,rel));files+=data.files;bytes+=data.bytes
  }
  return {files,bytes}
 })
 const primary=check('episodes','情节记忆与遗忘阶段',()=>{
  const file=join(where,'life-memory','episodic.json')
  if(!existsSync(file))throw Error('新目录未发现可读取的主情节文件；无法确认回忆能力')
  episodic=readEpisodes(file)
  return {episodes:episodic.episodes.length,forgotten:episodic.episodes.filter(e=>e.stage==='forgotten').length}
 })
 check('revocations','深层详情遗忘保护',()=>{
  revoked=readRevocations(join(where,'detail-protection','revocations-v1.json'))
  return {revocations:revoked.size}
 })
 if(primary){
  check('recall','只读检索现役记忆',()=>{
   const index=createHybridIndex({sqlite:false})
   try{
    const live=episodic.episodes.filter(e=>e.stage!=='forgotten'&&typeof e.text==='string'&&e.text)
    index.rebuild(live.map(e=>({id:e.id,text:e.text,at:e.at,importance:e.importance})),String(episodic.updatedAt||'validation'))
    if(live.length){
     const probe=live.find(e=>e.text.length>=2)||live[0]
     const hits=index.search(probe.text.slice(0,80),{limit:Math.min(200,live.length),filter:r=>live.some(e=>e.id===r.id)})
     if(!hits.some(x=>x.id===probe.id))throw Error('现役记忆无法通过只读检索找到')
     if(hits.some(x=>episodic.episodes.find(e=>e.id===x.id)?.stage==='forgotten'))throw Error('已遗忘条目出现在检索结果')
    }
    return {live:live.length,backend:index.status().backend}
   }finally{index.close()}
  })
  if(revoked)check('details','深层详情与主记忆关联',()=>detailsCheck(where,episodic.episodes,revoked))
  if(revoked)check('vectors','现有向量索引清单',()=>vectorCheck(where,episodic.episodes,revoked))
 }
 result.ready=Object.values(result.checks).length===7&&Object.values(result.checks).every(c=>c.ok===true)
 return result
}
