/**
 * Retains independent evidence for the most recent completed Life return-home.
 * The general migration task journal is shared by model/python/Life and may be
 * overwritten by unrelated later work. This record never authorizes deletion
 * by itself; the external cleanup verifier always rechecks current ownership,
 * the exact old snapshot and active Life readiness.
 */
import {existsSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {validateLocalDataPath} from './storage-location.mjs'
const NAME='.dafeiyu-life-return-evidence-v1.json'
const isReturn=x=>x?.status==='completed'&&x.domain==='memory'&&x.operation==='return-home'&&
 Array.isArray(x.externalSources)&&x.externalSources.length===1&&typeof x.externalSources[0]==='string'
/** Persist only after the offline worker has completed return-home. */
export function writeLifeReturnEvidence(root,job,result){
 if(job?.domain!=='memory'||job?.operation!=='return-home'||result?.returnedHome!==true||
   !Array.isArray(job.externalSources)||job.externalSources.length!==1)throw Error('Life 回迁留存凭据输入无效')
 const base=validateLocalDataPath(root),dest=join(base,NAME),tmp=dest+'.'+randomUUID()+'.tmp'
 const row={schema:1,status:'completed',domain:'memory',operation:'return-home',
  id:job.id,finishedAt:new Date().toISOString(),externalSources:job.externalSources,
  externalSnapshot:result.externalSnapshot||null,oldRootCopyArchive:result.oldRootCopyArchive||null}
 writeFileSync(tmp,JSON.stringify(row)+'\n',{flag:'wx',mode:0o600})
 try{renameSync(tmp,dest)}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
 return row
}
export function readLifeReturnEvidence(root,{migrationJob,strict=false}={}){
 // Older installations have no standalone record: the current return-home job
 // remains a valid source while its completed task journal is still present.
 if(isReturn(migrationJob))return migrationJob
 const base=validateLocalDataPath(root),dest=join(base,NAME)
 if(!existsSync(dest))return null
 try{
  const stat=lstatSync(dest)
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size>8192)throw Error('Life 回迁凭据不是安全文件')
  const row=JSON.parse(readFileSync(dest,'utf8'))
  if(row?.schema!==1||!isReturn(row)||typeof row.id!=='string')throw Error('Life 回迁凭据格式异常')
  return row
 }catch(error){if(strict)throw error;return null}
}
