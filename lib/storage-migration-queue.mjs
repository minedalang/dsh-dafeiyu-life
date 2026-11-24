/**
 * One-click, OFFLINE domain migration. Management HTTP may queue a request but
 * must never copy active storage or assert that the host has stopped.
 * Model, uv/pip cache, and Life memory share a stopped-instance queue.
 * Core-root relocation remains a separate manual stopped-instance workflow.
 */
import {existsSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {validateLocalDataPath} from './storage-location.mjs'
import {storageLayoutStatus} from './storage-layout.mjs'
import {runtimeProcessesStopped,readCleanupJob} from './storage-cleanup-queue.mjs'
import {writeLifeReturnEvidence} from './storage-life-return-evidence.mjs'
import {readMaintenanceExemptPid} from './storage-migration-maintenance-state.mjs'
import {largeDataStatus,inspectLargeDataMigration,migrateLargeDataOffline} from './storage-large-data-v2.mjs'

const NAME='.dafeiyu-domain-migration-job-v1.json'
const CANCEL_NAME='.dafeiyu-domain-migration-cancel-v1.json'
const MAX_AGE_MS=30*60*1000
function assertNoLifeCleanup(root){
 const p=join(root,'.dafeiyu-life-cleanup-job-v1.json')
 if(!existsSync(p))return
 const stat=lstatSync(p)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw Error('Life 清理任务状态文件不可信')
 const row=JSON.parse(readFileSync(p,'utf8'))
 if(row?.schema!==1||!['waiting','running','failed','completed'].includes(row.status))throw Error('Life 清理任务状态异常')
 if(row.status==='waiting'&&Number.isFinite(Date.parse(row.expiresAt))&&Date.parse(row.expiresAt)<Date.now())return
 if(['waiting','running'].includes(row.status))throw Error('Life 旧副本清理仍在等待或执行，禁止启动或迁移')
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const bounded=e=>String(e?.message||e||'未知异常').replace(/[\x00-\x1f]/g,' ').slice(0,220)
const file=root=>join(validateLocalDataPath(root),NAME)
function cancelFile(root){return join(validateLocalDataPath(root),CANCEL_NAME)}
export function readMigrationCancellation(root,jobId){
 const dest=cancelFile(root)
 if(!existsSync(dest))return false
 const stat=lstatSync(dest)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024)throw Error('迁移取消凭据文件不可信')
 const row=JSON.parse(readFileSync(dest,'utf8'))
 if(row?.schema!==1||typeof row.jobId!=='string'||typeof row.requestedAt!=='string')throw Error('取消凭据格式异常')
 return row.jobId===jobId
}
export function requestMigrationCancellation({root,jobId}={}){
 const base=validateLocalDataPath(root),row=readMigrationJob(base)
 if(!['waiting','running'].includes(row.status)||row.id!==jobId)throw Error('迁移任务已变更或结束，不可取消')
 if(readMigrationCancellation(base,jobId))return {ok:true,requested:true,status:row.status}
 // Cancellation intent lives in a separate atomic file so the worker cannot
 // accidentally overwrite it while writing status or committing the pointer.
 const dest=cancelFile(base),tmp=dest+'.'+randomUUID()+'.tmp'
 writeFileSync(tmp,JSON.stringify({schema:1,jobId,requestedAt:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600})
 try{renameSync(tmp,dest)}finally{if(existsSync(tmp))rmSync(tmp,{force:true})}
 return {ok:true,requested:true,status:row.status}
}
function write(root,row){
 const dest=file(root),temp=dest+'.'+randomUUID()+'.tmp'
 writeFileSync(temp,JSON.stringify(row)+'\n',{flag:'wx',mode:0o600})
 try{renameSync(temp,dest)}catch(e){rmSync(temp,{force:true});throw e}
}
export function readMigrationJob(root){
 const dest=file(root)
 if(!existsSync(dest))return {status:'idle'}
 const stat=lstatSync(dest)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw Error('迁移任务状态文件不可信')
 const row=JSON.parse(readFileSync(dest,'utf8'))
 if(row?.schema!==1||!['waiting','running','failed','completed','cancelled'].includes(row.status)||
    !['model','python','memory','large'].includes(row.domain)||!['migrate','return-home'].includes(row.operation||'migrate')||typeof row.id!=='string')throw Error('迁移任务记录格式非法')
 // An expired status is NOT terminal: the worker could still be copying.
 // Keep maintenance mode until it is actually settled, never elect a partial cache.
 if(['waiting','running'].includes(row.status)&&Date.parse(row.expiresAt)<Date.now())
  return {...row,notice:'迁移超过预约期限或曾被中断；仅允许安全取消与状态核对，不会接管半成品'}
 return row
}
/** Reconcile only a provably exited worker. Never release on timeout alone. */
export function reconcileInterruptedMigration(root,{processIsAlive=pid=>{
 try{process.kill(pid,0);return true}catch(e){return e?.code!=='ESRCH'}
},now=Date.now()}={}){
 const base=validateLocalDataPath(root),job=readMigrationJob(base)
 if(!['waiting','running'].includes(job.status)||!Number.isSafeInteger(job.workerPid)||job.workerPid<=0||
   !Number.isFinite(Date.parse(job.workerStartedAt))||now-Date.parse(job.workerStartedAt)<5000||processIsAlive(job.workerPid))return job
 // Exact worker PID was confirmed absent. The source is retained by design.
 // If the pointer was published before the crash, trust only verified domain
 // identity; do not infer completion from a nonempty staging directory.
 const layout=storageLayoutStatus(base)
 const keys=job.domain==='model'?['whisper','embedding','media']:[job.domain]
 const published=job.domain==='large'?largeDataStatus(base).configured&&largeDataStatus(base).target===job.target:
  job.operation==='return-home'
  ?keys.every(key=>layout.domains[key].configured===false)
  :keys.every(key=>layout.domains[key].configured===true&&layout.domains[key].root===job.target)
 const status=published?'completed':readMigrationCancellation(base,job.id)?'cancelled':'failed'
 const reason=published?'后台结束回执缺失；已重新验证生效分区身份，旧副本仍保留。请重启 DSH 验证功能':
  status==='cancelled'?'离线助手已退出，未发布新位置；安全取消完成，半成品不被接管':
  '离线助手已退出，未发布新位置；原生效目录保持不变，迁移没有完成'
 write(base,{...job,status,recoveredAfterInterruption:true,finishedAt:new Date().toISOString(),reason,notice:reason})
 return readMigrationJob(base)
}
export function assertMigrationStartupSafe(root){
 const base=validateLocalDataPath(root)
 assertNoLifeCleanup(base)
 const job=readMigrationJob(base)
 if(job.status==='waiting'||job.status==='running')
  throw Error('存储迁移仍处于 '+job.status+' 状态；只允许迁移维护页面启动，不允许业务模块接管正在复制的缓存')
 return job
}
export function queueDomainMigration({root,domain,target,mode,returnHome=false,workerScript,parentPid=process.pid,spawnImpl=spawn}={}){
 if(domain!=='large'||returnHome)throw Error('旧版数据迁移已移除，只允许 V2 大型数据统一迁移')
 if(!workerScript||!Number.isSafeInteger(parentPid)||parentPid<=0)throw Error('迁移助手参数不完整')
 const base=validateLocalDataPath(root)
 assertNoLifeCleanup(base)
 const cleanup=readCleanupJob(base)
 if(cleanup.status==='waiting')throw Error('已有待停机清理的旧模型副本任务，不允许同时预约迁移')
 const old=readMigrationJob(base)
 if(['waiting','running'].includes(old.status))throw Error('已有待处理的迁移任务；请先查看其结果')
 const plan=inspectLargeDataMigration({root:base,target})
 if(!plan.ok||plan.domain!==domain||!plan.requiresStop)throw Error('迁移预检未通过')
 const now=Date.now()
 // A previous cancellation ticket must not apply to this new job.
 const oldCancel=cancelFile(base)
 if(existsSync(oldCancel)){
  if(lstatSync(oldCancel).isSymbolicLink()||!lstatSync(oldCancel).isFile())throw Error('旧迁移取消文件不可信')
  rmSync(oldCancel,{force:true})
 }
 const job={schema:1,id:randomUUID(),status:'waiting',createdAt:new Date(now).toISOString(),
  expiresAt:new Date(now+MAX_AGE_MS).toISOString(),domain,operation:returnHome?'return-home':'migrate',mode:plan.mode,root:base,target:plan.target,
  files:plan.files,bytes:plan.bytes,
  externalSources:returnHome?[...new Set(plan.sources.map(x=>x.sourceRoot))]:[],sourcePreserved:true,
  notice:'正在等待 DSH 和相关进程退出；此时未移动任何文件，失败不会自动重试'}
 write(base,job)
 try{
  const child=spawnImpl(process.execPath,[workerScript,'--root',base,'--parent-pid',String(parentPid),'--job-id',job.id],{
   detached:true,stdio:'ignore',shell:false,windowsHide:true,
   env:process.versions.electron?{...process.env,ELECTRON_RUN_AS_NODE:'1'}:process.env,
  })
  if(!child?.pid)throw Error('未能启动离线迁移助手')
  child.unref?.()
 }catch(error){write(base,{...job,status:'failed',finishedAt:new Date().toISOString(),reason:'助手启动失败：'+bounded(error)});throw error}
 return {ok:true,scheduled:true,status:'waiting',domain,target:job.target,files:job.files,bytes:job.bytes,
  message:'已预约停机迁移。请正常退出 DSH Desktop/Headless 和相关 Python/模型进程；助手确认退出并再次预检后才会复制并切换路径。完成后重启 DSH 查看结果。'}
}
export async function runQueuedMigration({root,parentPid,jobId,
 processIsAlive=pid=>{try{process.kill(pid,0);return true}catch(e){return e?.code!=='ESRCH'}},
 inspectProcesses=()=>runtimeProcessesStopped({root,ignorePid:readMaintenanceExemptPid(root,jobId)}),now=()=>Date.now(),pause=sleep,pollMs=2000}={}){
 const base=validateLocalDataPath(root),job=readMigrationJob(base)
 if(job.status!=='waiting'||job.id!==jobId||!Number.isSafeInteger(parentPid)||parentPid<=0||parentPid===process.pid)
  throw Error('离线迁移任务身份或父进程无效')
 const expiry=Date.parse(job.expiresAt)
 const cancelled=()=>readMigrationCancellation(base,job.id)
 let lastCancelCheck=0
 const checkpoint=(force=false)=>{
  const current=Date.now()
  if(!force&&current-lastCancelCheck<150)return
  lastCancelCheck=current
  if(cancelled())throw Error('MIGRATION_CANCEL_REQUESTED')
 }
 const settle=(status,reason)=>{const message=bounded(reason);write(base,{...job,status,finishedAt:new Date().toISOString(),reason:message});return {ok:false,status,reason:message}}
 const fail=reason=>settle('failed',reason)
 const cancel=reason=>settle('cancelled',reason)
 // Report the actual worker PID. After a power loss, a later startup can
 // inspect this identity instead of treating mere elapsed time as completion.
 write(base,{...job,workerPid:process.pid,workerStartedAt:new Date().toISOString()})
 if(!Number.isFinite(expiry)||expiry-now()>MAX_AGE_MS||expiry<=now())return fail('迁移预约已过期')
 while(processIsAlive(parentPid)){
  if(cancelled())return cancel('已取消等待，未开始复制')
  if(now()>=expiry)return fail('等待 DSH 完全退出超时；未执行迁移')
  await pause(pollMs)
 }
 try{
  checkpoint(true)
  const stopped=inspectProcesses()
  if(now()>=expiry)return fail('停机复核超过任务期限；未执行迁移')
  if(!stopped.ok)return fail('仍有潜在冲突的 DSH、Node、Python 或模型进程；未执行迁移：'+(stopped.conflicts||[]).join('、'))
  // Never trust the UI-time plan; the source may have changed while the host
  // was exiting. New downloads must not be silently omitted from a snapshot.
  if(job.domain!=='large'||job.operation==='return-home')return fail('旧版迁移任务已退役，不再执行')
  const plan=inspectLargeDataMigration({root:base,target:job.target})
  if(plan.files!==job.files||plan.bytes!==job.bytes||plan.target!==job.target)
   return fail('停机期间数据数量、大小或目标位置发生变化；请重新检查后预约')
  checkpoint(true)
  write(base,{...job,status:'running',workerPid:process.pid,startedAt:new Date().toISOString(),phase:'copying',notice:'停机已确认，正在离线复制和 SHA-256 校验；业务模块暂停启动'})
  const ensureStopped=()=>{
   checkpoint(true)
   const again=inspectProcesses()
   checkpoint(true)
   if(!again.ok)throw Error('离线复制期间检测到新进程，未切换存储路径：'+(again.conflicts||[]).join('、'))
  }
  let config={}
  try{config=JSON.parse(readFileSync(join(base,'config.json'),'utf8'))}catch{}
  const mainPython=config.pythonPath||join(base,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python')
  const extraPythons=[config.visionPythonPath,join(base,'.venv-asr',process.platform==='win32'?'Scripts/python.exe':'bin/python')].filter(path=>path&&existsSync(path))
  const result=migrateLargeDataOffline({root:base,target:job.target,python:mainPython,extraPythons,confirmedStopped:true,ensureStopped,checkpoint})
  write(base,{...job,status:'completed',finishedAt:new Date().toISOString(),
   files:result.files,bytes:result.bytes,oldRootCopyArchive:result.oldRootCopyArchive||null,
   externalSnapshot:result.externalSnapshot||null,
   notice:'V2 大型模型位置已切换，旧副本保留；请重启并实测当前模型运行'})
  return result
 }catch(error){return String(error?.message||error)==='MIGRATION_CANCEL_REQUESTED'
   ?cancel('已在复制或校验检查点安全取消；原生效数据与配置指针未切换')
   :fail('停机迁移未完成：'+bounded(error))}
}
