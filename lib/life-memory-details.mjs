import {storageDataPath} from './storage-layout.mjs'
/**
 * v2.8.3-dev.2: optional, bounded detail attachments of the fading Life memory.
 * Not an archive or an independent fact source. Read authorization MUST be
 * checked in LifeMemoryGateway before calling the store.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,readdirSync} from 'node:fs'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {withDurableFileLock} from './durable-file-lock.mjs'

const ID=/^e-[a-f0-9]{18}$/
const ACCOUNT=/^[a-f0-9]{16}$/
const LIMIT=256*1024
const MAX_FRAGMENTS=64
const FRAGMENT_MAX=32*1024
const allowedTypes=new Set(['observed-scene','focused-observation','verified-action-detail'])
const allowedCertainty=new Set(['model-observation','verified-receipt'])
const detailVisibility=e=>['public-event','private-session'].includes(e?.visibility)
const fingerprint=e=>createHash('sha256').update(JSON.stringify([e.id,e.accountTag,e.kind,e.at,e.bvid,e.visibility])).digest('hex')
const safeNode=path=>{if(existsSync(path)){const s=lstatSync(path);if(s.isSymbolicLink())throw Error('深层记忆路径不可为符号链接');return s}return null}
function ensureDir(path){const s=safeNode(path);if(s&&!s.isDirectory())throw Error('深层记忆目录不安全');if(!s)mkdirSync(path,{recursive:false,mode:0o700})}
function atom(file){const s=safeNode(file);if(!s)return null;if(!s.isFile()||s.size>LIMIT+4096)throw Error('深层记忆文件无效');return JSON.parse(readFileSync(file,'utf8'))}
function atomic(file,payload){if(safeNode(file)&&!lstatSync(file).isFile())throw Error('拒绝覆盖非普通深层文件');const temp=file+'.'+randomUUID()+'.tmp';try{writeFileSync(temp,payload,{flag:'wx',mode:0o600});renameSync(temp,file)}finally{try{rmSync(temp,{force:true})}catch{}}}
export function validateDetailFragments(fragments){
 if(!Array.isArray(fragments)||!fragments.length||fragments.length>MAX_FRAGMENTS)throw Error('深层片段数量超出范围')
 const seen=new Set()
 return fragments.map((value,i)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||!allowedTypes.has(value.type))throw Error('不支持的深层片段类型')
  if(typeof value.content!=='string'||!value.content.trim()||Buffer.byteLength(value.content,'utf8')>FRAGMENT_MAX)throw Error('深层片段正文为空或过大')
  if(!allowedCertainty.has(value.certainty))throw Error('片段缺少明确的不确定性级别')
  const fragmentId=String(value.fragmentId||'')
  if(!/^[a-z0-9-]{4,64}$/.test(fragmentId)||seen.has(fragmentId))throw Error('深层片段 ID 不合法或重复')
  seen.add(fragmentId)
  const sourceRef=String(value.sourceRef||'')
  if(!/^[a-z0-9:_-]{8,120}$/i.test(sourceRef))throw Error('深层证据缺少可信来源引用')
  let startMs=null,endMs=null
  if(value.timeAnchorMs!==undefined){
   if(!Array.isArray(value.timeAnchorMs)||value.timeAnchorMs.length!==2||
     value.timeAnchorMs.some(x=>!Number.isSafeInteger(x)||x<0||x>12*60*60*1000)||value.timeAnchorMs[1]<value.timeAnchorMs[0])throw Error('无效视觉时间锚点')
   ;[startMs,endMs]=value.timeAnchorMs
  }
  if(value.type!=='verified-action-detail'&&startMs===null)throw Error('视觉细节必须有真实采样时间')
  const uncertainties=Array.isArray(value.uncertainties)?value.uncertainties:[]
  if(uncertainties.length>8||uncertainties.some(v=>typeof v!=='string'||Buffer.byteLength(v,'utf8')>350))throw Error('不确定性描述超出预算')
  return {fragmentId,type:value.type,sourceRef,certainty:value.certainty,content:value.content.trim(),
   ...(startMs!==null?{timeAnchorMs:[startMs,endMs]}:{}),uncertainties:uncertainties.map(v=>v.trim())}
 })
}
export function createLifeMemoryDetailStore({dataDir,logger=console}={}){
 if(!dataDir)throw Error('deep memory requires dataDir')
 const main=storageDataPath(dataDir,'life-memory')
 const root=join(main,'details','v1')
 // Revocation survives standalone memory backups, which restore life-memory/.
 // It does not turn the permanent task archive into a recall source.
 const protections=storageDataPath(dataDir,'detail-protection')
 const revokedFile=join(protections,'revocations-v1.json')
 const availableDirs=()=>{
  safeNode(main);safeNode(join(main,'details'));safeNode(root)
  if(!existsSync(main))ensureDir(main)
  if(!existsSync(join(main,'details')))ensureDir(join(main,'details'))
  if(!existsSync(root))ensureDir(root)
 }
 const folder=accountTag=>{if(!ACCOUNT.test(accountTag))throw Error('无效的当前账号范围');return join(root,accountTag)}
 const target=(accountTag,id)=>{if(!ID.test(id))throw Error('无效的主记忆 ID');return join(folder(accountTag),id+'.json')}
 function revocations(){
  safeNode(protections)
  const s=safeNode(revokedFile)
  if(!s)return {version:1,ids:[]}
  if(!s.isFile()||s.size>8*1024*1024)throw Error('深层遗忘保护记录异常')
  const doc=JSON.parse(readFileSync(revokedFile,'utf8'))
  if(doc?.version!==1||!Array.isArray(doc.ids)||doc.ids.length>200000)throw Error('深层遗忘保护记录损坏')
  return doc
 }
 function revoke(ids){
  const valid=[...new Set(ids)].filter(id=>ID.test(id))
  if(!valid.length)return 0
  ensureDir(protections)
  const doc=revocations(),set=new Set(doc.ids)
  for(const id of valid)set.add(id)
  if(set.size>200000)throw Error('遗忘保护记录空间不足，已拒绝丢弃历史撤销信息')
  if(set.size!==doc.ids.length)atomic(revokedFile,JSON.stringify({version:1,ids:[...set]})+'\n')
  return valid.length
 }
 function isRevoked(id){return revocations().ids.includes(id)}
 function write({episode,fragments,verified=false,append=false}={}){
  if(verified!==true||!episode||episode.stage!=='clear'||episode.kind!=='watch'||!detailVisibility(episode)||!ACCOUNT.test(episode.accountTag)||!ID.test(episode.id))throw Error('深层记忆不满足可信来源和主记忆门禁')
  if(isRevoked(episode.id))throw Error('此记忆详情已被遗忘保护撤销')
  const checked=validateDetailFragments(fragments)
  const file=target(episode.accountTag,episode.id)
  availableDirs();ensureDir(folder(episode.accountTag))
  // Use the existing PID/token durable lock. Only a demonstrably dead
  // owner can be reclaimed. Unknown legacy directory locks fail closed.
  const lock=file+'.lock'
  const previousLock=safeNode(lock)
  if(previousLock&&!previousLock.isFile())throw Error('深层写入存在旧版或不可信的锁，待人工核验')
  return withDurableFileLock(lock,()=>{
   const previous=atom(file)
   if(previous&&previous.parentFingerprint!==fingerprint(episode))throw Error('主记忆身份已改变，拒绝覆盖旧详情')
   let combined=checked
   if(append===true&&previous){
    const original=validateDetailFragments(previous.fragments)
    const ids=new Set(original.map(x=>x.fragmentId))
    combined=[...original,...checked.filter(x=>!ids.has(x.fragmentId))]
    if(combined.length===original.length)return {ok:true,duplicate:true,fragmentCount:original.length}
    combined=validateDetailFragments(combined)
   }
   const record={schema:'life-memory-detail/v1',parentMemoryId:episode.id,accountTag:episode.accountTag,
    parentFingerprint:fingerprint(episode),kind:'watch',visibility:episode.visibility,fragments:combined}
   const body=JSON.stringify(record)+'\n'
   if(Buffer.byteLength(body,'utf8')>LIMIT)throw Error('整条深层记忆超出存储预算')
   atomic(file,body)
   return {ok:true,fragmentCount:combined.length,bytes:Buffer.byteLength(body,'utf8')}
  })
 }
 function read(episode,{limitBytes=8192,management=false}={}){
  if(!episode||episode.stage!=='clear'||episode.kind!=='watch'||!detailVisibility(episode)||!ACCOUNT.test(episode.accountTag)||!ID.test(episode.id)||isRevoked(episode.id))return {ok:false,reason:'unavailable'}
  const file=target(episode.accountTag,episode.id)
  for(const parent of [main,join(main,'details'),root,folder(episode.accountTag)]){const st=safeNode(parent);if(st&&!st.isDirectory())throw Error('深层记忆路径不安全')}
  if(!existsSync(file))return {ok:false,reason:'no-detail'}
  const row=atom(file)
  if(row?.schema!=='life-memory-detail/v1'||row.parentMemoryId!==episode.id||row.accountTag!==episode.accountTag||row.visibility!==episode.visibility||row.parentFingerprint!==fingerprint(episode)||!Array.isArray(row.fragments))return {ok:false,reason:'identity-mismatch'}
  // Validate every fragment before exposing any content.
  const fragments=validateDetailFragments(row.fragments)
  const cap=management===true?LIMIT:Math.max(256,Math.min(16384,Math.trunc(Number(limitBytes)||8192)))
  let bytes=0
  const selected=[]
  for(const fragment of fragments){const n=Buffer.byteLength(JSON.stringify(fragment),'utf8');if(bytes+n>cap)break;selected.push(fragment);bytes+=n}
  return {ok:true,fragments:selected,totalFragments:fragments.length,truncated:selected.length<fragments.length,bytes}
 }
 function inspect(episode){const result=read(episode,{limitBytes:256});return {available:result.ok===true,reason:result.ok?'available':result.reason,...(result.ok?{totalFragments:result.totalFragments}:{})}}
 function purge(ids){
  const valid=[...new Set(ids)].filter(id=>ID.test(id))
  if(!valid.length)return {ok:true,removed:0}
  // Write the revocation before deleting. If deletion fails, future reads
  // still refuse even when a prior backup is restored.
  revoke(valid)
  let removed=0
  if(existsSync(root)&&safeNode(root).isDirectory())for(const tag of readdirSync(root)){
   if(!ACCOUNT.test(tag))continue
   const dir=folder(tag);if(!safeNode(dir)?.isDirectory())continue
   for(const id of valid){const p=target(tag,id);if(safeNode(p)){rmSync(p,{force:true});removed++}}
  }
  return {ok:true,removed}
 }
 function reconcile(episodes=[]){
  if(!existsSync(root))return {ok:true,removed:0}
  const eligible=new Map(episodes.filter(e=>e?.stage==='clear'&&e.kind==='watch'&&detailVisibility(e)&&ACCOUNT.test(String(e.accountTag||''))).map(e=>[e.id,e]))
  const remove=[]
  for(const tag of readdirSync(root)){
   if(!ACCOUNT.test(tag))throw Error('发现无法识别的深层账号目录，已停止清理')
   const dir=folder(tag);if(!safeNode(dir)?.isDirectory())throw Error('深层账号目录不安全')
   for(const file of readdirSync(dir)){
    if(!/^e-[a-f0-9]{18}\.json$/.test(file)){
     if(!file.endsWith('.lock')&&!file.endsWith('.tmp'))throw Error('发现未知深层附件文件')
     continue
    }
    const id=file.slice(0,-5),ep=eligible.get(id)
    if(!ep||ep.accountTag!==tag||isRevoked(id))remove.push(id)
    else{
     const doc=atom(target(tag,id));if(doc?.parentFingerprint!==fingerprint(ep)||doc.visibility!==ep.visibility)remove.push(id)
    }
   }
  }
  return purge(remove)
 }
 function stats(){
  if(!existsSync(root))return {enabled:true,attachments:0,bytes:0}
  let count=0,bytes=0
  for(const name of readdirSync(root)){
   if(!ACCOUNT.test(name))continue
   const dir=folder(name);if(!safeNode(dir)?.isDirectory())continue
   for(const f of readdirSync(dir)){if(!/^e-[a-f0-9]{18}\.json$/.test(f))continue;const s=safeNode(join(dir,f));if(s?.isFile()){count++;bytes+=s.size}}
  }
  return {enabled:true,attachments:count,bytes}
 }
 return {write,read,inspect,purge,reconcile,stats}
}
