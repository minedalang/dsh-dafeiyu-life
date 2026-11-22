/** UI-queued, detached OFFLINE cleanup of retained Life memory copies. */
import {existsSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {validateLocalDataPath} from './storage-location.mjs'
import {inspectRetainedLifeCopies,cleanupRetainedLifeCopies} from './storage-life-retained.mjs'
import {inspectExternalLifeCopy,deleteExternalLifeCopy} from './storage-external-life-retired.mjs'
import {runtimeProcessesStopped,readCleanupJob} from './storage-cleanup-queue.mjs'
import {readMigrationJob} from './storage-migration-queue.mjs'
const NAME='.dafeiyu-life-cleanup-job-v1.json',MAX_AGE=30*60*1000
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const bounded=x=>String(x?.message||x||'未知异常').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,190)
const path=root=>join(validateLocalDataPath(root),NAME)
function write(root,row){
 const dest=path(root),tmp=dest+'.'+randomUUID()+'.tmp'
 writeFileSync(tmp,JSON.stringify(row)+'\n',{flag:'wx',mode:0o600})
 try{renameSync(tmp,dest)}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
}
export function readLifeCleanupJob(root){
 const file=path(root)
 if(!existsSync(file))return {status:'idle'}
 const s=lstatSync(file)
 if(!s.isFile()||s.isSymbolicLink()||s.size>8192)throw Error('Life 清理任务文件不安全')
 const row=JSON.parse(readFileSync(file,'utf8'))
 if(row?.schema!==1||!['waiting','running','completed','failed'].includes(row.status)||typeof row.id!=='string')throw Error('Life 清理任务格式异常')
 if(row.status==='waiting'&&Date.parse(row.expiresAt)<Date.now())return {...row,status:'failed',reason:'等待退出超时；旧副本仍保留，请重新验证并预约'}
 return row
}
export function queueLifeCleanup({root,verification,workerScript,parentPid=process.pid,spawnImpl=spawn,now=Date.now}={}){
 const base=validateLocalDataPath(root),at=now()
 if(!workerScript||!Number.isSafeInteger(parentPid)||parentPid<=0)throw Error('离线清理助手参数无效')
 if(verification?.ready!==true||!Number.isFinite(verification.at)||at-verification.at>10*60_000||verification.at>at)
  throw Error('Life 一键验证未通过或已过期，请重新验证')
 const m=readMigrationJob(base),c=readCleanupJob(base)
 if(['waiting','running'].includes(m.status)||c.status==='waiting')throw Error('存在未完成的迁移或旧模型清理任务')
 const prev=readLifeCleanupJob(base)
 if(['waiting','running'].includes(prev.status))throw Error('已有 Life 清理任务等待执行')
 if(prev.status==='completed'&&prev.kind!=='external-life')throw Error('Life 原位置旧副本已经清理，不能重复执行')
 const report=inspectRetainedLifeCopies({root:base,verify:true})
 if(!report.eligible||!report.verified||report.target!==verification.target)throw Error('Life 旧副本不符合清理条件：'+report.reason)
 const row={schema:1,id:randomUUID(),kind:'default-life',status:'waiting',createdAt:new Date(at).toISOString(),expiresAt:new Date(at+MAX_AGE).toISOString(),
  target:report.target,files:report.files,bytes:report.bytes,sourceFingerprint:report.sourceFingerprint,
  targetFingerprint:report.targetFingerprint,notice:'已预约清理。请退出 DSH；停机后助手将再次验收 Life 和遗忘保护，未通过不删除。'}
 write(base,row)
 try{
  const child=spawnImpl(process.execPath,[workerScript,'--root',base,'--parent-pid',String(parentPid),'--job-id',row.id],{
   detached:true,stdio:'ignore',shell:false,windowsHide:true,
   env:process.versions.electron?{...process.env,ELECTRON_RUN_AS_NODE:'1'}:process.env,
  })
  if(!child?.pid)throw Error('离线助手未能启动')
  child.unref?.()
 }catch(error){write(base,{...row,status:'failed',reason:bounded(error),finishedAt:new Date().toISOString()});throw error}
 return {ok:true,scheduled:true,status:'waiting',bytes:row.bytes,files:row.files,
  message:'已预约 Life 旧副本清理；请完全退出 DSH。助手将重新检查进程、当前记忆、遗忘记录及 SHA-256，失败不会删除或自动重试。'}
}

/** Separate user-confirmed cleanup for the RETIRED external partition. */
export function queueExternalLifeCleanup({root,verification,workerScript,parentPid=process.pid,spawnImpl=spawn,now=Date.now}={}){
 const base=validateLocalDataPath(root),at=now()
 if(!workerScript||!Number.isSafeInteger(parentPid)||parentPid<=0)throw Error('离线清理助手参数无效')
 if(!verification?.ready||!Number.isFinite(verification.at)||verification.at>at||at-verification.at>10*60_000)
  throw Error('旧 D 盘副本验证未通过或已过期，请重新检查')
 if(['waiting','running'].includes(readMigrationJob(base).status)||readCleanupJob(base).status==='waiting')
  throw Error('存在待处理的迁移或模型清理任务，不能预约旧 D 盘清理')
 if(['waiting','running'].includes(readLifeCleanupJob(base).status))throw Error('已有 Life 清理任务，禁止并行删除')
 const checked=inspectExternalLifeCopy({root:base,verify:true})
 if(!checked.eligible||checked.target!==verification.target||checked.fingerprint!==verification.fingerprint)
  throw Error('历史分区位置或内容已变化，必须重新验证')
 const row={schema:1,id:randomUUID(),kind:'external-life',status:'waiting',createdAt:new Date(at).toISOString(),
  expiresAt:new Date(at+MAX_AGE).toISOString(),target:checked.target,files:checked.files,bytes:checked.bytes,
  fingerprint:checked.fingerprint,notice:'已明确预约旧 D 盘清理；退出 DSH 后重新核验指纹。禁止自动覆盖或复用。'}
 write(base,row)
 try{
  const child=spawnImpl(process.execPath,[workerScript,'--root',base,'--parent-pid',String(parentPid),'--job-id',row.id],{
   detached:true,stdio:'ignore',shell:false,windowsHide:true,
   env:process.versions.electron?{...process.env,ELECTRON_RUN_AS_NODE:'1'}:process.env,
  })
  if(!child?.pid)throw Error('离线清理助手未能启动')
  child.unref?.()
 }catch(error){write(base,{...row,status:'failed',finishedAt:new Date().toISOString(),reason:bounded(error)});throw error}
 return {ok:true,scheduled:true,status:'waiting',target:row.target,files:row.files,bytes:row.bytes,
  message:'已预约停机清理历史 D 盘 Life 分区；完全退出 DSH 后才执行。若发现新增文件或一致性问题则保留旧分区。'}
}

export async function runQueuedLifeCleanup({root,parentPid,jobId,
 processIsAlive=pid=>{try{process.kill(pid,0);return true}catch(e){return e?.code!=='ESRCH'}},
 inspectProcesses=()=>runtimeProcessesStopped({root}),now=Date.now,pause=sleep,pollMs=2000}={}){
 const base=validateLocalDataPath(root),job=readLifeCleanupJob(base)
 if(job.status!=='waiting'||job.id!==jobId||!Number.isSafeInteger(parentPid)||parentPid<=0||parentPid===process.pid)
  throw Error('Life 离线清理任务身份无效')
 const expiry=Date.parse(job.expiresAt)
 const fail=reason=>{const message=bounded(reason);write(base,{...job,status:'failed',finishedAt:new Date().toISOString(),reason:message});return {ok:false,reason:message}}
 if(!Number.isFinite(expiry)||expiry>now()+MAX_AGE||expiry<=now())return fail('清理预约已过期')
 while(processIsAlive(parentPid)){
  if(now()>=expiry)return fail('等待 DSH 完全退出超时，旧副本仍保留')
  await pause(pollMs)
 }
 try{
  if(now()>=expiry)return fail('停机复核超时')
  const stopped=inspectProcesses()
  if(!stopped.ok)return fail('仍有相关运行进程，旧副本未删除：'+(stopped.conflicts||[]).join('、'))
  if(job.kind==='external-life'){
   const checked=inspectExternalLifeCopy({root:base,verify:true})
   if(!checked.eligible||checked.target!==job.target||checked.fingerprint!==job.fingerprint||
       checked.files!==job.files||checked.bytes!==job.bytes)
    return fail('历史 D 盘内容或当前 Life 发生变化，停止清理')
   const again=inspectProcesses()
   if(!again.ok)return fail('复核期间发现新进程，未删除旧 D 盘：'+(again.conflicts||[]).join('、'))
   write(base,{...job,status:'running',startedAt:new Date().toISOString(),notice:'严格停机，正在删除经过身份与文件指纹验证的历史 D 盘副本'})
   const result=deleteExternalLifeCopy({root:base,expected:checked,confirmedStopped:true,confirmedDelete:true,
    ensureStopped:()=>{const state=inspectProcesses();if(!state.ok)throw Error('检测到新运行进程，拒绝删除')}})
   write(base,{...job,status:'completed',finishedAt:new Date().toISOString(),deletedFiles:result.deletedFiles,deletedBytes:result.deletedBytes,
    notice:'历史 D 盘 Life 分区已由用户明确确认并停机删除；当前 C 盘 Life 及其他分区保持不变'})
   return result
  }
  const checked=inspectRetainedLifeCopies({root:base,verify:true})
  if(!checked.verified||!checked.eligible||checked.target!==job.target||checked.sourceFingerprint!==job.sourceFingerprint||
   checked.targetFingerprint!==job.targetFingerprint||checked.files!==job.files||checked.bytes!==job.bytes)
   return fail('当前 Life 或旧副本在预约后发生变化，必须重新验证')
  const second=inspectProcesses()
  if(!second.ok)return fail('复核期间检测到新进程，旧副本未删除：'+(second.conflicts||[]).join('、'))
  write(base,{...job,status:'running',startedAt:new Date().toISOString(),notice:'已停机，正在隔离并清理旧 Life 副本，请勿启动 DSH'})
  const result=cleanupRetainedLifeCopies({root:base,expected:checked,confirmedStopped:true,confirmedRuntimeVerified:true,confirmedDeleteOldCopy:true})
  write(base,{...job,status:'completed',finishedAt:new Date().toISOString(),deletedFiles:result.deletedFiles,deletedBytes:result.deletedBytes,
   notice:'仅原位置 Life 旧副本清理完成；当前生效 Life、Python、模型及核心配置未删除'})
  return result
 }catch(e){return fail('Life 离线清理未完成：'+bounded(e))}
}
