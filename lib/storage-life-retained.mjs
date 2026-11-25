/** Explicit stopped-instance deletion of an OLD Life copy. Never removes the
 * active partition, Python environments, model files or the root itself.
 * Reads and audits privacy/forgetting state before old copies are eligible.
 */
import {existsSync,lstatSync,readdirSync,readFileSync,openSync,readSync,closeSync,mkdirSync,renameSync,rmSync,writeFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {storageLayoutStatus,STORAGE_DOMAINS} from './storage-layout.mjs'
import {validateLocalDataPath} from './storage-location.mjs'
import {verifyRelocatedLifeMemory} from './storage-life-runtime-check.mjs'
import {expandVideoObservationGroups} from './video-memory-observation-groups.mjs'

const MARKER='.dafeiyu-storage-domain-v1.json'
const JOURNAL='.dafeiyu-life-cleanup-v1.json'
const REL=Object.freeze([...STORAGE_DOMAINS.memory.items])
const STAGES=['clear','fuzzy','trace','forgotten']
const hashFile=path=>{
 const h=createHash('sha256'),fd=openSync(path,'r'),buf=Buffer.allocUnsafe(256*1024)
 try{let n;while((n=readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,n));return h.digest('hex')}
 finally{closeSync(fd)}
}
const json=path=>{
 const stat=lstatSync(path)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('记忆文件不安全')
 return JSON.parse(readFileSync(path,'utf8'))
}
function snapshot(base,{hash=false}={}){
 const h=createHash('sha256');let files=0,bytes=0
 for(const rel of REL){
  const dir=join(base,...rel.split('/'))
  if(!existsSync(dir))continue
  const stack=[[dir,rel]]
  while(stack.length){
   const [path,name]=stack.pop(),stat=lstatSync(path)
   if(stat.isSymbolicLink())throw Error('记忆旧副本包含符号链接，拒绝清理')
   if(stat.isDirectory()){
    h.update('d:'+name+'\0')
    for(const child of readdirSync(path).sort().reverse())stack.push([join(path,child),name+'/'+child])
   }else if(stat.isFile()){
    if(++files>120000||(bytes+=stat.size)>120*1024**3)throw Error('记忆资料超出安全清理限额')
    h.update('f:'+name+'\0'+stat.size+'\0'+(hash?hashFile(path):''))
   }else throw Error('记忆目录含特殊文件，拒绝清理')
  }
 }
 return {sha256:h.digest('hex'),files,bytes}
}
function semanticOldCopyIsNotNewer(root,target){
 for(const rel of REL){
  if(existsSync(join(root,...rel.split('/')))&&!existsSync(join(target,...rel.split('/'))))
   throw Error('旧副本含有当前目录缺失的 Life 分区：'+rel)
 }
 const oldMemory=join(root,'life-memory','episodic.json'),newMemory=join(target,'life-memory','episodic.json')
 if(!existsSync(oldMemory)||!existsSync(newMemory))throw Error('无法证明旧情节与当前情节的来源关系')
 const old=json(oldMemory),current=json(newMemory)
 if(old?.version!==1||current?.version!==1||!Array.isArray(old.episodes)||!Array.isArray(current.episodes))throw Error('记忆阶段记录不兼容')
 const latest=new Map(expandVideoObservationGroups(current.episodes).map(e=>[e.id,e]))
 if(!Array.isArray(old.archiveKeys)||!Array.isArray(current.archiveKeys))throw Error('Life 经历去重清单无效')
 const currentKeys=new Set(current.archiveKeys)
 if(old.archiveKeys.some(key=>!currentKeys.has(key)))throw Error('现役目录缺少旧副本经历去重记录，拒绝删除')
 for(const row of expandVideoObservationGroups(old.episodes)){
  const newer=latest.get(row.id)
  if(!newer)throw Error('旧副本含当前记忆中不存在的经历；为防止信息丢失，拒绝自动清理')
  if(!STAGES.includes(row.stage)||!STAGES.includes(newer.stage)||STAGES.indexOf(newer.stage)<STAGES.indexOf(row.stage))
   throw Error('旧副本遗忘阶段比现役数据更新；禁止清理')
 }
 // A successful episodic check alone must not authorize deletion of a unique
 // long-term fact or still-live deep attachment that exists only in the old copy.
 const oldIdentity=join(root,'long-term-memory','dafeiyu.json'),newIdentity=join(target,'long-term-memory','dafeiyu.json')
 if(existsSync(oldIdentity)){
  if(!existsSync(newIdentity))throw Error('当前 Life 缺失旧副本中的长期记忆身份文件')
  const source=json(oldIdentity),live=json(newIdentity)
  if(source?.version!==3||live?.version!==3||!Array.isArray(source.memories)||!Array.isArray(live.memories)||
      !Array.isArray(source.deleted)||!Array.isArray(live.deleted))throw Error('长期记忆身份格式或版本无法安全对照')
  const present=new Set([...live.memories,...live.deleted].map(row=>String(row?.id||'')))
  if(source.memories.some(row=>!row?.id||!present.has(String(row.id))))
   throw Error('当前 Life 缺少旧副本中的长期事实，拒绝自动清理')
  const discarded=new Set(live.deleted.map(row=>String(row?.id||'')))
  if(source.deleted.some(row=>!row?.id||!discarded.has(String(row.id))))
   throw Error('当前 Life 缺少旧副本中的长期遗忘记录，拒绝自动清理')
 }
 const currentRevPath=join(target,'detail-protection','revocations-v1.json')
 const currentRev=existsSync(currentRevPath)?json(currentRevPath):{version:1,ids:[]}
 if(currentRev?.version!==1||!Array.isArray(currentRev.ids))throw Error('现役深层遗忘保护无效')
 const revoked=new Set(currentRev.ids)
 const oldDetails=join(root,'life-memory','details','v1')
 if(existsSync(oldDetails)){
  const st=lstatSync(oldDetails)
  if(!st.isDirectory()||st.isSymbolicLink())throw Error('旧深层详情目录不可信')
  for(const account of readdirSync(oldDetails)){
   if(!/^[a-f0-9]{16}$/.test(account))throw Error('旧深层详情账号目录异常')
   const accountDir=join(oldDetails,account),accountStat=lstatSync(accountDir)
   if(!accountStat.isDirectory()||accountStat.isSymbolicLink())throw Error('旧深层详情账号目录不可信')
   for(const filename of readdirSync(accountDir)){
    if(!/^e-[a-f0-9]{18}\.json$/.test(filename))throw Error('旧深层详情文件名异常')
    const id=filename.slice(0,-5),entry=latest.get(id)
    if(!entry||entry.stage!=='clear'||revoked.has(id))continue // proven forgotten or faded
    const sourceFile=join(accountDir,filename)
    const newFile=join(target,'life-memory','details','v1',account,filename)
    if(!existsSync(newFile)||hashFile(sourceFile)!==hashFile(newFile))
     throw Error('现役分区缺少或改变了旧副本中的可回忆深层详情，拒绝自动清理')
   }
  }
 }
 const oldRev=join(root,'detail-protection','revocations-v1.json'),newRev=join(target,'detail-protection','revocations-v1.json')
 const olds=existsSync(oldRev)?json(oldRev):{version:1,ids:[]}
 const news=existsSync(newRev)?json(newRev):{version:1,ids:[]}
 if(olds.version!==1||news.version!==1||!Array.isArray(olds.ids)||!Array.isArray(news.ids))throw Error('遗忘保护版本或格式异常')
 const currentRevocations=new Set(news.ids)
 if(olds.ids.some(id=>!currentRevocations.has(id)))throw Error('现役目录缺少旧副本中的遗忘撤销记录；禁止清理')
}
export function inspectRetainedLifeCopies({root,verify=false}={}){
 const unavailable=reason=>({ok:true,eligible:false,verified:false,reason,files:0,bytes:0})
 try{
  const base=validateLocalDataPath(root),status=storageLayoutStatus(base),entry=status.domains.memory
  if(!entry.configured)return unavailable('Life 未独立分盘，原目录不是旧副本')
  const target=entry.root,marker=json(join(target,MARKER)),layout=json(join(base,'storage-layout-v1.json'))
  if(marker.version!==1||marker.base!==base||marker.target!==target||marker.domain!=='memory'||marker.nonce!==layout?.domains?.memory?.nonce||marker.verified!==true)
   return unavailable('当前 Life 分区迁移身份校验失败')
  if(existsSync(join(base,JOURNAL)))return unavailable('已有 Life 旧副本清理记录，请勿重复操作')
  if(!REL.some(rel=>existsSync(join(base,...rel.split('/')))))return unavailable('默认目录下没有可清理的 Life 旧副本')
  const old=snapshot(base,{hash:verify})
  const result={ok:true,eligible:true,verified:false,target,files:old.files,bytes:old.bytes,root:base}
  if(!verify)return {...result,reason:'仅检测旧副本，尚未验证新 Life 的可用性和遗忘记录'}
  const actual=verifyRelocatedLifeMemory({root:base})
  if(!actual.ready)return unavailable('当前 Life 只读功能验证尚未通过，禁止删除旧副本')
  semanticOldCopyIsNotNewer(base,target)
  const current=snapshot(target,{hash:true})
  return {...result,verified:true,sourceFingerprint:old.sha256,targetFingerprint:current.sha256,
   reason:'当前 Life 只读验证通过，旧副本无更新的遗忘记录或缺失经历；仍须停机复核'}
 }catch(error){return unavailable(String(error?.message||error).slice(0,170))}
}
/** Dangerous. Only used by the detached worker after shutdown and fresh hashes. */
export function cleanupRetainedLifeCopies({root,expected,confirmedStopped=false,confirmedRuntimeVerified=false,confirmedDeleteOldCopy=false}={}){
 if(!confirmedStopped||!confirmedRuntimeVerified||!confirmedDeleteOldCopy)throw Error('必须停机、完成 Life 只读验收并确认删除')
 const base=validateLocalDataPath(root),report=inspectRetainedLifeCopies({root:base,verify:true})
 if(!report.eligible||!report.verified||report.target!==expected?.target||
    report.sourceFingerprint!==expected.sourceFingerprint||report.targetFingerprint!==expected.targetFingerprint)
  throw Error('旧副本或当前 Life 已变化，拒绝清理：'+report.reason)
 const dirs=REL.filter(rel=>existsSync(join(base,...rel.split('/')))),stage=join(base,'.dafeiyu-life-cleanup-staging-'+randomUUID()),journal=join(base,JOURNAL)
 const header={version:1,kind:'life-old-copy-cleanup',target:report.target,dirs,files:report.files,bytes:report.bytes,startedAt:new Date().toISOString()}
 mkdirSync(stage,{mode:0o700})
 const moved=[]
 try{
  writeFileSync(journal,JSON.stringify({...header,status:'preparing'})+'\n',{flag:'wx',mode:0o600})
  for(const rel of dirs){
   const source=join(base,...rel.split('/')),dst=join(stage,...rel.split('/'))
   mkdirSync(dirname(dst),{recursive:true,mode:0o700})
   renameSync(source,dst);moved.push([source,dst])
  }
 }catch(error){
  let restored=true
  for(const [source,dst] of moved.reverse())try{renameSync(dst,source)}catch{restored=false}
  if(restored){try{rmSync(stage,{force:true,recursive:true});rmSync(journal,{force:true})}catch{}}
  throw Error('Life 旧副本隔离失败'+(restored?'，已恢复旧目录':'，请人工恢复暂存目录')+'：'+error.message)
 }
 writeFileSync(journal,JSON.stringify({...header,status:'quarantined',stage})+'\n')
 rmSync(stage,{force:true,recursive:true})
 writeFileSync(journal,JSON.stringify({...header,status:'complete',completedAt:new Date().toISOString()})+'\n')
 return {ok:true,deletedFiles:report.files,deletedBytes:report.bytes,activeLifeRoot:report.target,
  deletedRelativePaths:dirs,sourcePreserved:false}
}
