/**
 * Post-migration diagnostics and an explicit, OFFLINE-only model copy cleanup.
 * Does not touch Python, Life memory, permissions, or external tools (Ollama).
 * A config pointer is NOT proof that the destination model works at runtime.
 */
import {assertColdRestoreClear} from './cold-restore-fence.mjs'
import {existsSync,lstatSync,readdirSync,readFileSync,writeFileSync,mkdirSync,renameSync,rmSync,realpathSync,openSync,closeSync,readSync} from 'node:fs'
import {join,relative,sep,isAbsolute,dirname} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {storageLayoutStatus,STORAGE_DOMAINS} from './storage-layout.mjs'
import {validateLocalDataPath} from './storage-location.mjs'

const MARKER='.dafeiyu-storage-domain-v1.json'
const JOURNAL='.dafeiyu-model-cleanup-v1.json'
const PARTS=['whisper','embedding','media']
const LIMIT_ITEMS=120000, LIMIT_BYTES=120*1024**3
const inside=(root,path)=>{const r=relative(root,path);return r===''||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r)}
function hash(file){
 const fd=openSync(file,'r'),h=createHash('sha256'),buf=Buffer.allocUnsafe(256*1024)
 try{let n;while((n=readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n));return h.digest('hex')}
 finally{closeSync(fd)}
}
function actualFile(path,domain,component){
 const st=lstatSync(path)
 if(st.isFile())return path
 if(st.isSymbolicLink()&&domain==='whisper'){
  const real=realpathSync(path)
  if(inside(component,real)&&lstatSync(real).isFile())return real
 }
 throw Error('旧模型副本包含不可信的链接或特殊文件：'+path)
}
function comparePaths(source,target,domain,{verify=false}={}){
 const queue=[[source,target,source]]
 let bytes=0,files=0
 while(queue.length){
  const [a,b,component]=queue.pop(),stat=lstatSync(a)
  if(stat.isDirectory()&&!stat.isSymbolicLink()){
   if(!existsSync(b)||!lstatSync(b).isDirectory()||lstatSync(b).isSymbolicLink())throw Error('目标目录缺失或类型不同：'+b)
   const aa=readdirSync(a).sort(),bb=readdirSync(b).sort()
   if(verify&&JSON.stringify(aa)!==JSON.stringify(bb))throw Error('旧副本与当前生效模型文件列表不同：'+a)
   for(const name of aa)queue.push([join(a,name),join(b,name),component])
  }else{
   const real=actualFile(a,domain,component),st=lstatSync(real)
   files++;bytes+=(stat.isSymbolicLink()?stat.size:st.size)
   if(verify&&(!existsSync(b)||!lstatSync(b).isFile()||lstatSync(b).isSymbolicLink()||lstatSync(b).size!==st.size||hash(real)!==hash(b)))
    throw Error('旧副本与当前生效模型内容不同：'+a)
  }
  if(files>LIMIT_ITEMS||bytes>LIMIT_BYTES)throw Error('旧副本超出安全检查限额')
 }
 return {bytes,files}
}
/** Bounded metadata preview; verify=true performs byte-for-byte SHA-256. */
export function inspectRetainedModelCopies({root,verify=false}={}){
 const base=validateLocalDataPath(root),layout=storageLayoutStatus(base)
 const roots=[...new Set(PARTS.map(key=>layout.domains[key].root))]
 const unavailable=reason=>({ok:true,eligible:false,verified:false,bytes:0,files:0,paths:[],reason})
 if(roots.length!==1||!PARTS.every(key=>layout.domains[key].configured))return unavailable('模型三个分区尚未统一迁移到同一位置')
 const target=roots[0]
 const markerPath=join(target,MARKER)
 const marker=JSON.parse(readFileSync(markerPath,'utf8'))
 if(marker.domain!=='model'||!marker.previousEntries||!PARTS.every(key=>marker.previousEntries[key]===null))
  return unavailable('模型组来自旧的独立分区或二次迁移；不能把原目录认定为可清理副本')
 if(marker.base!==base||marker.target!==target||marker.verified!==true)return unavailable('模型组身份校验失败')
 if(existsSync(join(base,JOURNAL)))return unavailable('已存在旧模型清理记录；为防止重复清理，请人工检查')
 const paths=[];let bytes=0,files=0
 try{
  for(const domain of PARTS)for(const rel of STORAGE_DOMAINS[domain].items){
   const source=join(base,...rel.split('/')),dest=join(target,...rel.split('/'))
   if(!existsSync(source))continue
   validateLocalDataPath(source)
   if(!lstatSync(source).isDirectory()||lstatSync(source).isSymbolicLink())throw Error('源目录含链接或非目录节点：'+source)
   const stats=comparePaths(source,dest,domain,{verify})
   files+=stats.files;bytes+=stats.bytes
   if(files>LIMIT_ITEMS||bytes>LIMIT_BYTES)throw Error('旧副本总量超出安全检查限额')
   paths.push({domain,relative:rel,source,bytes:stats.bytes,files:stats.files})
  }
  if(!paths.length)return unavailable('原业务根目录已不存在可清理的模型旧副本')
  return {ok:true,eligible:true,verified:verify,bytes,files,paths,target,reason:verify?'内容校验通过；仍须用户重启并实测模型运行':'仅统计旧副本；尚未逐文件校验，也未验证运行'}
 }catch(error){return {ok:true,eligible:false,verified:false,bytes,files,paths,target,reason:String(error?.message||error)}}
}
/** Destructive! Only an informed operator on a stopped installation may call this. */
export function cleanupRetainedModelCopies({root,confirmedStopped=false,confirmedRuntimeVerified=false,confirmedDeleteOldCopy=false}={}){
 assertColdRestoreClear(root)
 if(!confirmedStopped||!confirmedRuntimeVerified||!confirmedDeleteOldCopy)
  throw Error('必须先退出 DSH/所有 Python 进程、实测新模型可用，并显式确认删除旧模型副本')
 const base=validateLocalDataPath(root),report=inspectRetainedModelCopies({root:base,verify:true})
 if(!report.eligible||!report.verified)throw Error('旧模型清理被安全拒绝：'+report.reason)
 const stage=join(base,'.dafeiyu-model-cleanup-staging-'+randomUUID()),journal=join(base,JOURNAL)
 const marker={version:1,kind:'model-legacy-cleanup',target:report.target,paths:report.paths.map(x=>x.relative),
  files:report.files,bytes:report.bytes,startedAt:new Date().toISOString(),status:'preparing'}
 mkdirSync(stage,{mode:0o700})
 const renamed=[]
 try{
  writeFileSync(journal,JSON.stringify(marker)+'\n',{flag:'wx',mode:0o600})
  for(const item of report.paths){
   const from=validateLocalDataPath(item.source),dest=join(stage,...item.relative.split('/'))
   mkdirSync(dirname(dest),{recursive:true,mode:0o700})
   renameSync(from,dest);renamed.push({from,dest})
  }
 }catch(error){
  // No destructive operation has happened yet: restore all moved directories.
  let restored=true
  for(const {from,dest} of renamed.reverse())try{renameSync(dest,from)}catch{restored=false}
  if(restored){try{rmSync(stage,{recursive:true,force:true});rmSync(journal,{force:true})}catch{}}
  throw Error('旧副本暂存失败'+(restored?'，已恢复原目录':'，请人工检查暂存目录')+'：'+error.message)
 }
 // Once committed to deletion, retain an audit journal even if a file lock
 // prevents complete removal; never repeat or automatically remove anything.
 writeFileSync(journal,JSON.stringify({...marker,status:'quarantined',stage})+'\n')
 rmSync(stage,{recursive:true,force:true})
 writeFileSync(journal,JSON.stringify({...marker,status:'complete',completedAt:new Date().toISOString()})+'\n')
 return {ok:true,deletedFiles:report.files,deletedBytes:report.bytes,modelTarget:report.target,
  legacySource:base,deletedPaths:report.paths.map(x=>x.relative),restartRequired:false,rollbackOldCopyAvailable:false}
}
