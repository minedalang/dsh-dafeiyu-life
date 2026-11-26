/**
 * Explicit removal of a historical external Life partition AFTER safe return-home.
 * This is NEVER a migration target reuse path. Unknown, changed or unique data
 * is protected, and the active Life location is never deleted.
 */
import {assertCheckpointClear} from './cold-restore-fence.mjs'
import {existsSync,lstatSync,readdirSync,openSync,readSync,closeSync,renameSync,unlinkSync,rmdirSync} from 'node:fs'
import {join,dirname,relative,isAbsolute,sep} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {inspectHistoricalLifeTarget,storageLayoutStatus,STORAGE_DOMAINS} from './storage-layout.mjs'
import {validateLocalDataPath} from './storage-location.mjs'
import {readMigrationJob} from './storage-migration-queue.mjs'
import {readLifeReturnEvidence} from './storage-life-return-evidence.mjs'
import {verifyRelocatedLifeMemory} from './storage-life-runtime-check.mjs'

const within=(a,b)=>{const r=relative(a,b);return r===''||!!r&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r)}
const hashFile=path=>{
 const h=createHash('sha256'),f=openSync(path,'r'),buf=Buffer.allocUnsafe(256*1024)
 try{let n;while((n=readSync(f,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n));return h.digest('hex')}
 finally{closeSync(f)}
}
// Legacy return-home jobs did not store a historical D snapshot fingerprint.
// They are eligible ONLY when every D file also exists byte-for-byte in the
// current default Life (never infer that an unmatched file is safe to delete).
function oldFilesExistInCurrent(oldRoot,activeRoot){
 let matched=0
 for(const rel of STORAGE_DOMAINS.memory.items){
  const source=join(oldRoot,...rel.split('/'))
  if(!existsSync(source))continue
  const queue=[[source,join(activeRoot,...rel.split('/'))]]
  while(queue.length){
   const [a,b]=queue.pop(),sa=lstatSync(a)
   if(sa.isSymbolicLink()||!existsSync(b))throw Error('旧 D 盘存在当前 Life 中没有的资料，请人工核对并保留，禁止自动删除')
   const sb=lstatSync(b)
   if(sb.isSymbolicLink()||sa.isDirectory()!==sb.isDirectory()||sa.isFile()!==sb.isFile())
    throw Error('旧 D 盘与当前 Life 文件类型不同，禁止自动删除')
   if(sa.isDirectory())for(const name of readdirSync(a))queue.push([join(a,name),join(b,name)])
   else if(sa.isFile()){
    if(sa.size!==sb.size||hashFile(a)!==hashFile(b))throw Error('旧 D 盘含与当前 Life 不相同的文件，禁止自动删除')
    matched++
   }else throw Error('旧 D 盘存在不支持的文件类型，禁止自动删除')
  }
 }
 return matched
}
function evidence(root){
 const base=validateLocalDataPath(root),layout=storageLayoutStatus(base),
  job=readLifeReturnEvidence(base,{migrationJob:readMigrationJob(base),strict:true})||{}
 if(layout.domains.memory.configured)throw Error('Life 仍在外置分区；当前不是回迁后的旧 D 盘，禁止删除')
 if(job.status!=='completed'||job.domain!=='memory'||job.operation!=='return-home')
  throw Error('没有可核验的 Life 回迁完成记录，旧 D 盘不可自动清理')
 if(!Array.isArray(job.externalSources)||job.externalSources.length!==1||typeof job.externalSources[0]!=='string')
  throw Error('回迁记录缺少唯一的原外置目录，禁止自动清理')
 const target=validateLocalDataPath(job.externalSources[0])
 if(within(base,target)||within(target,base))throw Error('历史分区与核心目录相交，禁止清理')
 for(const item of Object.values(layout.domains))if(item.configured&&(within(item.root,target)||within(target,item.root)))
  throw Error('旧目录与其他生效分区相交，禁止清理')
 if(!existsSync(target))throw Error('历史 D 盘分区已不存在，无需删除')
 if(!lstatSync(target).isDirectory()||lstatSync(target).isSymbolicLink())throw Error('历史 D 盘位置不是安全目录')
 return {base,target,job}
}
export function inspectExternalLifeCopy({root,verify=false}={}){
 const {base,target,job}=evidence(root)
 const inspected=inspectHistoricalLifeTarget(base,target)
 const proof=job.externalSnapshot
 if(proof){
  if(proof.target!==target||typeof proof.fingerprint!=='string'||!proof.fingerprint)
   throw Error('历史 Life 快照凭据不匹配，拒绝删除')
  if(inspected.fingerprint!==proof.fingerprint||inspected.files!==proof.files||inspected.bytes!==proof.bytes)
   throw Error('旧 D 盘在回迁后发生新增或修改（可能包含用户新文件），禁止自动删除')
 }
 const result={ok:true,eligible:false,target,files:inspected.files,bytes:inspected.bytes,
  fingerprint:inspected.fingerprint,proof:proof?'return-home-snapshot':'strict-current-copy',
  reason:'检测到旧 D 盘副本，尚未进行当前 Life 只读验证与唯一数据检查'}
 if(!verify)return result
 const active=verifyRelocatedLifeMemory({root:base,allowDefaultHome:true})
 if(!active.ready)throw Error('当前 C 盘 Life 一键功能验证未通过，禁止删除旧 D 盘')
 if(!proof)oldFilesExistInCurrent(target,base)
 return {...result,eligible:true,verified:true,
  reason:proof?'回迁时指纹与当前旧分区完全一致，当前 Life 只读验证通过':'旧版回迁无快照：已证明旧 D 每个文件在当前 C 盘都有逐字节一致的副本，但无法判断文件何时加入 D 盘；请人工审查后再确认删除'}
}
/** Only called by detached worker after explicit confirmation and rehash. */
export function deleteExternalLifeCopy({root,expected,confirmedStopped=false,confirmedDelete=false,ensureStopped=()=>{}}={}){
 assertCheckpointClear(root)
 if(!confirmedStopped||!confirmedDelete)throw Error('必须用户确认、完全停机后才允许清理旧 D 盘')
 const checked=inspectExternalLifeCopy({root,verify:true})
 if(!checked.eligible||checked.target!==expected?.target||checked.fingerprint!==expected?.fingerprint||
    checked.files!==expected?.files||checked.bytes!==expected?.bytes)throw Error('旧 D 盘目录或指纹已变化，拒绝删除')
 ensureStopped()
 const target=checked.target,stage=join(dirname(target),'.dafeiyu-life-delete-staged-'+randomUUID())
 // Atomic rename protects the reusable path; no implicit replacement and no
 // recursive rm that might erase an unexpected new file.
 renameSync(target,stage)
 let deletedFiles=0,deletedBytes=0
 try{
  ensureStopped()
  // A second tree digest on the renamed snapshot. Reuse the original inspection
  // only with its original marker target through a temporary binding? Instead
  // inspect each entry and compare against an immutable pre-rename manifest.
  const files=[];const dirs=[];const hash=createHash('sha256'),stack=[['',stage]]
  let bytes=0,visited=0
  while(stack.length){
   const [rel,path]=stack.pop(),stat=lstatSync(path)
   if(stat.isSymbolicLink())throw Error('隔离中的旧目录出现链接，不删除')
   if(stat.isDirectory()){
    dirs.push(path);hash.update('d:'+rel+'\0')
    for(const name of readdirSync(path).sort().reverse())stack.push([rel?rel+'/'+name:name,join(path,name)])
   }else if(stat.isFile()){
    files.push({path,size:stat.size,sha:hashFile(path)})
    bytes+=stat.size;hash.update('f:'+rel+'\0'+stat.size+'\0'+files.at(-1).sha)
   }else throw Error('隔离中的旧目录存在特殊文件，不删除')
   if(++visited>120000||bytes>120*1024**3)throw Error('隔离的旧 Life 超出安全清理上限')
  }
  if(hash.digest('hex')!==checked.fingerprint||files.length!==checked.files||bytes!==checked.bytes)
   throw Error('旧 D 盘隔离后内容变化，拒绝删除')
  // Recheck each file immediately before unlinking; newly added files not in
  // this manifest keep their parent nonempty and cause rmdir to fail.
  for(const row of files){
   const stat=lstatSync(row.path)
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==row.size||hashFile(row.path)!==row.sha)
    throw Error('清理期间文件变化；停止进一步删除并保留隔离目录')
   unlinkSync(row.path);deletedFiles++;deletedBytes+=row.size
  }
  for(const path of dirs.reverse())rmdirSync(path)
  return {ok:true,target,deletedFiles,deletedBytes,reusable:true}
 }catch(error){
  if(deletedFiles===0&&existsSync(stage)&&!existsSync(target)){
   try{renameSync(stage,target)}catch{/* keep retained stage if restore fails */}
  }
  throw Error('旧 D 盘清理停止：'+error.message+(deletedFiles?'；有部分已删除，剩余文件保留在隔离目录，请人工核对':'，未删除文件'))
 }
}
