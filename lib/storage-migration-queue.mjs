/**
 * One-click, OFFLINE domain migration. Management HTTP may queue a request but
 * must never copy active storage or assert that the host has stopped.
 * Model and uv/pip cache only; Life memory and root moves retain manual
 * stopped-instance workflows.
 */
import {existsSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {validateLocalDataPath} from './storage-location.mjs'
import {inspectDomainMigration,migrateDomainOffline,inspectDomainReturnHome,returnDomainHomeOffline} from './storage-layout.mjs'
import {runtimeProcessesStopped,readCleanupJob} from './storage-cleanup-queue.mjs'

const NAME='.dafeiyu-domain-migration-job-v1.json'
const MAX_AGE_MS=30*60*1000
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const bounded=e=>String(e?.message||e||'未知异常').replace(/[\x00-\x1f]/g,' ').slice(0,220)
const file=root=>join(validateLocalDataPath(root),NAME)
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
 if(row?.schema!==1||!['waiting','running','failed','completed'].includes(row.status)||
    !['model','python'].includes(row.domain)||!['migrate','return-home'].includes(row.operation||'migrate')||typeof row.id!=='string')throw Error('迁移任务记录格式非法')
 if(row.status==='waiting'&&(!Number.isFinite(Date.parse(row.expiresAt))||Date.parse(row.expiresAt)<Date.now()))
  return {...row,status:'failed',reason:'等待停机超时；请检查目标位置后重新预约，任务不会自动重试'}
 // An interrupted copy may take longer than the queue window. Never allow
 // the plugin to write to that source merely because the clock advanced.
 if(row.status==='running'&&Date.parse(row.expiresAt)<Date.now())
  return {...row,notice:'离线迁移超时或中断；在人工确认文件与配置前禁止启动插件写入'}
 return row
}
export function assertMigrationStartupSafe(root){
 const job=readMigrationJob(root)
 if(job.status==='waiting'||job.status==='running')
  throw Error('存储迁移仍处于 '+job.status+' 状态；请完全退出 DSH，等待离线迁移助手完成，再启动插件。若助手异常中断，请先人工核查数据和路径。')
 return job
}
export function queueDomainMigration({root,domain,target,mode,returnHome=false,workerScript,parentPid=process.pid,spawnImpl=spawn}={}){
 if(!['model','python'].includes(domain))throw Error('一键预约仅适用于模型和包管理缓存；Life 记忆仍必须停机迁移')
 if(!workerScript||!Number.isSafeInteger(parentPid)||parentPid<=0)throw Error('迁移助手参数不完整')
 const base=validateLocalDataPath(root)
 const cleanup=readCleanupJob(base)
 if(cleanup.status==='waiting')throw Error('已有待停机清理的旧模型副本任务，不允许同时预约迁移')
 const old=readMigrationJob(base)
 if(['waiting','running'].includes(old.status))throw Error('已有待处理的迁移任务；请先查看其结果')
 const plan=returnHome?inspectDomainReturnHome({root:base,domain}):inspectDomainMigration({root:base,domain,target,mode})
 if(!plan.ok||plan.domain!==domain||!plan.requiresStop)throw Error('迁移预检未通过')
 const now=Date.now()
 const job={schema:1,id:randomUUID(),status:'waiting',createdAt:new Date(now).toISOString(),
  expiresAt:new Date(now+MAX_AGE_MS).toISOString(),domain,operation:returnHome?'return-home':'migrate',mode:plan.mode,root:base,target:plan.target,
  files:plan.files,bytes:plan.bytes,sourcePreserved:true,
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
 inspectProcesses=runtimeProcessesStopped,now=()=>Date.now(),pause=sleep,pollMs=2000}={}){
 const base=validateLocalDataPath(root),job=readMigrationJob(base)
 if(job.status!=='waiting'||job.id!==jobId||!Number.isSafeInteger(parentPid)||parentPid<=0||parentPid===process.pid)
  throw Error('离线迁移任务身份或父进程无效')
 const expiry=Date.parse(job.expiresAt)
 const fail=reason=>{const message=bounded(reason);write(base,{...job,status:'failed',finishedAt:new Date().toISOString(),reason:message});return {ok:false,reason:message}}
 if(!Number.isFinite(expiry)||expiry-now()>MAX_AGE_MS||expiry<=now())return fail('迁移预约已过期')
 while(processIsAlive(parentPid)){
  if(now()>=expiry)return fail('等待 DSH 完全退出超时；未执行迁移')
  await pause(pollMs)
 }
 try{
  const stopped=inspectProcesses()
  if(now()>=expiry)return fail('停机复核超过任务期限；未执行迁移')
  if(!stopped.ok)return fail('仍有潜在冲突的 DSH、Node、Python 或模型进程；未执行迁移：'+(stopped.conflicts||[]).join('、'))
  // Never trust the UI-time plan; the source may have changed while the host
  // was exiting. New downloads must not be silently omitted from a snapshot.
  const plan=job.operation==='return-home'?inspectDomainReturnHome({root:base,domain:job.domain}):inspectDomainMigration({root:base,domain:job.domain,target:job.target,mode:job.mode})
  if(plan.files!==job.files||plan.bytes!==job.bytes||plan.target!==job.target)
   return fail('停机期间数据数量、大小或目标位置发生变化；请重新检查后预约')
  write(base,{...job,status:'running',startedAt:new Date().toISOString(),notice:'停机已确认，正在离线复制和 SHA-256 校验；不要启动 DSH'})
  const result=job.operation==='return-home'
   ?returnDomainHomeOffline({root:base,domain:job.domain,confirmedStopped:true})
   :migrateDomainOffline({root:base,domain:job.domain,target:job.target,mode:job.mode,confirmedStopped:true})
  write(base,{...job,status:'completed',finishedAt:new Date().toISOString(),
   files:result.files,bytes:result.bytes,oldRootCopyArchive:result.oldRootCopyArchive||null,notice:job.operation==='return-home'?'当前数据已安全回迁默认目录；外置副本仍保留，请重启验证':'迁移路径已切换；旧数据已保留。请重启 DSH 验证新位置后再考虑清理'})
  return result
 }catch(error){return fail('停机迁移未完成：'+bounded(error))}
}
