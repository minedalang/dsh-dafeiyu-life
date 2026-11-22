/**
 * 2.8.3-dev.3: single, fail-closed owner of per-domain offline storage locations.
 * Root relocation (storage-location.mjs) is resolved first. No HTTP writer changes paths.
 * An absent layout means bit-for-bit legacy directory compatibility.
 */
import {existsSync,lstatSync,readFileSync,readdirSync,mkdirSync,copyFileSync,writeFileSync,renameSync,rmSync,openSync,readSync,closeSync,readlinkSync,realpathSync} from 'node:fs'
import {join,resolve,dirname,relative,isAbsolute,sep,parse} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {validateLocalDataPath} from './storage-location.mjs'

const FILE='storage-layout-v1.json'
const MARKER='.dafeiyu-storage-domain-v1.json'
export const STORAGE_DOMAINS=Object.freeze({
  whisper:Object.freeze({label:'Whisper 模型',items:['.hf-cache'],migration:'copy'}),
  embedding:Object.freeze({label:'Embedding 模型与运行时',items:['embedding-runtime'],migration:'copy'}),
  python:Object.freeze({label:'Python 环境及包管理缓存',items:['.venv','.venv-asr','.vision-venv','uv-cache','uv-tools','uv-python'],migration:'rebuild'}),
  media:Object.freeze({label:'影音与视觉可再生缓存',items:['tmp/asr','asr-transcript-cache','vision-cache'],migration:'copy'}),
  memory:Object.freeze({label:'Life 记忆、深层详情、遗忘保护与向量索引',items:['life-memory','long-term-memory','detail-protection','embedding-memory-index'],migration:'copy'}),
})
const within=(a,b)=>{const r=relative(a,b);return r===''||!!r&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r)}
const layoutPath=root=>join(root,FILE)
function loadRaw(root){
 const file=layoutPath(root)
 if(!existsSync(file))return {version:1,domains:{}}
 const s=lstatSync(file)
 if(!s.isFile()||s.isSymbolicLink()||s.size>16384)throw Error('存储分区配置不安全；禁止以旧目录默默启动')
 let obj
 try{obj=JSON.parse(readFileSync(file,'utf8'))}catch{throw Error('存储分区配置损坏；请修复后再启动')}
 if(obj?.version!==1||!obj.domains||typeof obj.domains!=='object'||Array.isArray(obj.domains)||Object.keys(obj.domains).some(x=>!STORAGE_DOMAINS[x]))throw Error('存储分区版本或数据域无效')
 return obj
}
export function storageLayoutStatus(root){
 const base=validateLocalDataPath(root,{allowMissing:true}),raw=loadRaw(base),domains={}
 for(const [key,spec] of Object.entries(STORAGE_DOMAINS)){
  const entry=raw.domains[key]
  if(!entry){domains[key]={key,label:spec.label,configured:false,root:base,mode:'legacy',items:spec.items};continue}
  if(typeof entry.target!=='string'||typeof entry.nonce!=='string'||!entry.nonce||!['copy','rebuild'].includes(entry.mode)||entry.mode!==spec.migration)throw Error('存储分区配置字段不合法：'+key)
  const dest=validateLocalDataPath(entry.target)
  if(within(base,dest)||within(dest,base))throw Error('分区目录与数据根目录不能互相嵌套：'+key)
  const markerFile=join(dest,MARKER)
  if(!existsSync(markerFile)||lstatSync(markerFile).isSymbolicLink()||!lstatSync(markerFile).isFile()||lstatSync(markerFile).size>4096)throw Error('分区身份标记丢失，禁止生成空白数据：'+key)
  let marker
  try{marker=JSON.parse(readFileSync(markerFile,'utf8'))}catch{throw Error('分区身份标记损坏：'+key)}
  if(marker?.version!==1||marker.base!==base||marker.target!==dest||marker.domain!==key||marker.nonce!==entry.nonce||marker.verified!==true)throw Error('分区身份验证失败：'+key)
  for(const [other,row] of Object.entries(domains))if(row.configured&&(within(row.root,dest)||within(dest,row.root)))throw Error('分区目录互相嵌套：'+other+' / '+key)
  domains[key]={key,label:spec.label,configured:true,root:dest,mode:entry.mode,items:spec.items,verifiedAt:marker.verifiedAt}
 }
 return {version:1,root:base,configured:Object.values(domains).filter(x=>x.configured).length,domains}
}
const norm=x=>String(x||'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'')
export function storageDataPath(root,...segments){
 const base=resolve(root),parts=segments.map(String),rel=norm(parts.join('/'))
 if(!rel||rel.split('/').some(s=>s==='..'||s==='.'||!s))throw Error('无效的存储相对路径')
 const status=storageLayoutStatus(base)
 for(const [key,spec] of Object.entries(STORAGE_DOMAINS)){
  const item=spec.items.find(dir=>rel===dir||rel.startsWith(dir+'/'))
  if(item&&status.domains[key].configured)return join(status.domains[key].root,...rel.split('/'))
 }
 return join(base,...parts)
}
export function storageDomainRoot(root,domain){
 if(!STORAGE_DOMAINS[domain])throw Error('未知存储域')
 return storageLayoutStatus(root).domains[domain].root
}
export function inspectDomainMigration({root,domain,target,mode}={}){
 const base=validateLocalDataPath(root),spec=STORAGE_DOMAINS[domain]
 if(!spec)throw Error('未知的数据分区')
 if(mode&&mode!==spec.migration)throw Error('此分区不支持所选迁移方式')
 const layout=storageLayoutStatus(base),old=layout.domains[domain]
 const dest=validateLocalDataPath(target,{allowMissing:true})
 if(within(base,dest)||within(dest,base))throw Error('存储域不能迁到当前数据根目录内或其父目录')
 if(old.configured&&(within(old.root,dest)||within(dest,old.root)))throw Error('不能迁到当前分区位置或其子目录')
 for(const [key,row] of Object.entries(layout.domains))if(key!==domain&&row.configured&&(within(row.root,dest)||within(dest,row.root)))throw Error('与已有分区目录相同或嵌套：'+key)
 if(existsSync(dest)&&readdirSync(dest).length)throw Error('目标分区目录必须为空，避免覆盖现有数据')
 let files=0,bytes=0
 for(const rel of spec.items){
  const src=join(old.root,...rel.split('/'))
  if(!existsSync(src))continue
  const stack=[src];let seen=0
  while(stack.length){
   const path=stack.pop(),s=lstatSync(path)
   if(s.isSymbolicLink()){
    // HF snapshots use relative links to blobs; allow only symlinks resolving to regular files within the same source component.
    if(domain!=='whisper'||!within(src,realpathSync(path))||!lstatSync(realpathSync(path)).isFile())throw Error('发现非预期的目录链接，拒绝迁移：'+rel)
    files++;bytes+=lstatSync(realpathSync(path)).size
   }else if(s.isDirectory()){
    for(const name of readdirSync(path))stack.push(join(path,name))
   }else if(s.isFile()){files++;bytes+=s.size}
   else throw Error('源目录包含特殊文件，拒绝迁移：'+rel)
   if(++seen>120000||files>120000||bytes>120*1024**3)throw Error('分区超出安全迁移限额')
  }
 }
 return {ok:true,root:base,sourceRoot:old.root,domain,label:spec.label,target:dest,mode:spec.migration,files,bytes,requiresStop:true,changesNow:false,sourcePreserved:true}
}
function sha(path){const h=createHash('sha256'),fd=openSync(path,'r'),buf=Buffer.allocUnsafe(256*1024);try{let n;while((n=readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n));return h.digest('hex')}finally{closeSync(fd)}}
function safeCopy(source,dest,domain){
 const stack=[[source,dest,source]];let files=0,bytes=0
 while(stack.length){
  const [from,to,component]=stack.pop(),s=lstatSync(from)
  if(s.isDirectory()&&!s.isSymbolicLink()){
   mkdirSync(to,{recursive:true,mode:0o700})
   for(const item of readdirSync(from))stack.push([join(from,item),join(to,item),component])
  }else{
   let actual=from
   if(s.isSymbolicLink()){
    if(domain!=='whisper'||!within(component,realpathSync(from))||!lstatSync(realpathSync(from)).isFile())throw Error('不可信的链接，迁移中止')
    // Materialize HF snapshot file links: Windows symlink creation needs elevated rights.
    actual=realpathSync(from)
   }else if(!s.isFile())throw Error('不支持的源文件类型')
   mkdirSync(dirname(to),{recursive:true,mode:0o700})
   copyFileSync(actual,to)
   if(sha(actual)!==sha(to))throw Error('SHA-256 校验不符，迁移中止')
   files++;bytes+=lstatSync(actual).size
  }
 }
 return {files,bytes}
}
function treesEqual(left,right,domain){
 const queue=[[left,right,left]]
 while(queue.length){
  const [a,b,component]=queue.pop(),s=lstatSync(a)
  if(s.isDirectory()&&!s.isSymbolicLink()){
   if(!existsSync(b)||!lstatSync(b).isDirectory())return false
   const names=readdirSync(a).sort(),other=readdirSync(b).sort()
   if(JSON.stringify(names)!==JSON.stringify(other))return false
   for(const n of names)queue.push([join(a,n),join(b,n),component])
  }else{
   const actual=s.isSymbolicLink()&&domain==='whisper'?realpathSync(a):a
   if(!existsSync(b)||!lstatSync(b).isFile()||lstatSync(b).size!==lstatSync(actual).size||sha(actual)!==sha(b))return false
  }
 }
 return true
}
/** Immediate rollback ONLY if the old and new copies are still byte-identical. */
export function rollbackDomainOffline({root,domain,confirmedStopped=false}={}){
 if(confirmedStopped!==true)throw Error('必须先完全退出所有 DSH / Python 进程')
 const base=validateLocalDataPath(root),spec=STORAGE_DOMAINS[domain]
 if(!spec)throw Error('未知的数据分区')
 const status=storageLayoutStatus(base),entry=status.domains[domain]
 if(!entry.configured)throw Error('此域尚未迁移')
 if(entry.mode==='rebuild')throw Error('Python 重建后路径回退须人工修复依赖，不允许直接恢复旧运行时')
 for(const rel of spec.items){
  const old=join(base,...rel.split('/')),current=join(entry.root,...rel.split('/'))
  if(existsSync(old)!==existsSync(current)||existsSync(old)&&!treesEqual(old,current,domain))throw Error('迁移后数据已有变化；为避免丢失记忆或更新，不允许自动回退')
 }
 const old=loadRaw(base),next={version:1,domains:{...old.domains}};delete next.domains[domain]
 const file=layoutPath(base),tmp=file+'.'+randomUUID()+'.tmp'
 writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600})
 try{renameSync(tmp,file)}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
 return {ok:true,domain,restoredLegacy:true,externalCopyPreserved:true,restartRequired:true}
}
/** Must run while ALL DSH / Python processes are stopped. No source deletion. */
export function migrateDomainOffline({root,domain,target,confirmedStopped=false}={}){
 if(confirmedStopped!==true)throw Error('必须完全退出 DSH/Headless/Python 并显式确认停机')
 const plan=inspectDomainMigration({root,domain,target}),base=plan.root,spec=STORAGE_DOMAINS[domain]
 const scratch=join(dirname(plan.target),'.dafeiyu-storage-migrating-'+randomUUID())
 const nonce=randomUUID(),destination=plan.target
 let published=false
 try{
  // Parent must be a trusted local directory. The destination stays empty until verified.
  mkdirSync(dirname(destination),{recursive:true,mode:0o700})
  validateLocalDataPath(dirname(destination))
  mkdirSync(scratch,{mode:0o700})
  let files=0,bytes=0
  if(spec.migration==='copy')for(const rel of spec.items){
   const src=join(plan.sourceRoot,...rel.split('/'))
   if(!existsSync(src))continue
   const result=safeCopy(src,join(scratch,...rel.split('/')),domain)
   files+=result.files;bytes+=result.bytes
  }
  // A second pass catches changes from a mistakenly running producer before the pointer is published.
  if(spec.migration==='copy')for(const rel of spec.items){
   const src=join(plan.sourceRoot,...rel.split('/')),dst=join(scratch,...rel.split('/'))
   if(existsSync(src)&&!treesEqual(src,dst,domain))throw Error('源数据在复制期间发生变化，拒绝切换路径')
  }
  // Python env intentionally is NOT copied; a clean, explicit reinstall is required after restart.
  const marker={version:1,base,target:destination,domain,nonce,verified:true,verifiedAt:new Date().toISOString(),files,bytes,mode:spec.migration}
  writeFileSync(join(scratch,MARKER),JSON.stringify(marker)+'\n',{flag:'wx',mode:0o600})
  if(existsSync(destination)){
   validateLocalDataPath(destination)
   if(readdirSync(destination).length)throw Error('目标目录在迁移期间变成非空')
   rmSync(destination,{recursive:false})
  }
  renameSync(scratch,destination)
  const prev=loadRaw(base),next={version:1,domains:{...prev.domains,[domain]:{target:destination,nonce,mode:spec.migration}}}
  const file=layoutPath(base),tmp=file+'.'+randomUUID()+'.tmp'
  writeFileSync(tmp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600})
  try{renameSync(tmp,file);published=true}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
  if(!storageLayoutStatus(base).domains[domain].configured)throw Error('迁移指针发布后的身份复核失败')
  return {ok:true,domain,target:destination,files,bytes,sourcePreserved:true,restartRequired:true,rebuildRequired:domain==='python'}
 }catch(error){
  // Keep new data intact after publication; a missing target must never silently create a new identity.
  if(!published){try{rmSync(scratch,{recursive:true,force:true})}catch{}}
  throw error
 }
}
export const storageLayoutFilename=()=>FILE
/** Read-only, bounded physical bytes. A link never counts its target twice. */
export function storageDomainsUsage(root){
 const status=storageLayoutStatus(root),rows=[]
 for(const [key,spec] of Object.entries(STORAGE_DOMAINS)){
  const current=status.domains[key],paths=spec.items.map(rel=>current.configured?join(current.root,...rel.split('/')):join(status.root,...rel.split('/')))
  let files=0,bytes=0,incomplete=false
  const stack=[...paths]
  while(stack.length&&files<30000){
   const path=stack.pop()
   try{
    if(!existsSync(path))continue
    const st=lstatSync(path)
    if(st.isSymbolicLink())continue
    if(st.isFile()){files++;bytes+=st.size}
    else if(st.isDirectory())for(const name of readdirSync(path))stack.push(join(path,name))
    else incomplete=true
   }catch{incomplete=true}
  }
  if(stack.length)incomplete=true
  rows.push({key,label:spec.label,configured:current.configured,root:current.root,mode:current.mode,
   sourceDefault:spec.items.map(rel=>join(status.root,...rel.split('/'))),files,bytes,incomplete,
   migration:spec.migration,requiresRestart:current.configured})
 }
 return rows
}
