/** Diagnostic status only. Never persist video IDs, account IDs, image data, prompts or model output. */
import {readFileSync,writeFileSync,renameSync,lstatSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
const STATUSES=new Set(['running','done','error','interrupted'])
const safeNumber=(n)=>Number.isFinite(n)&&n>=0?Math.floor(n):0
const scopeOf=(account)=>createHash('sha256').update('video-debug-status-v1\0'+String(account||'')).digest('hex').slice(0,20)
export function videoDebugSummary(job,account){
  const status=STATUSES.has(job?.status)?job.status:'error'
  return {version:1,scope:scopeOf(account),status,step:Math.max(0,Math.min(6,safeNumber(job?.step))),
    startedAt:safeNumber(job?.at),updatedAt:safeNumber(job?.updatedAt||Date.now()),
    reason:status==='error'?'video_debug_failed':status==='done'?'video_debug_finished':status==='interrupted'?'host_restarted':'in_progress'}
}
export function saveVideoDebugSummary(dir,job,account){
  if(!dir||!account)return false
  try{
    const file=join(dir,'video-perception-debug-last-run.json'),tmp=file+'.tmp'
    const body=JSON.stringify(videoDebugSummary(job,account))
    writeFileSync(tmp,body,{encoding:'utf8',mode:0o600});renameSync(tmp,file)
    return true
  }catch{return false}
}
export function readVideoDebugSummary(dir,account){
  if(!dir||!account)return null
  try{
    const file=join(dir,'video-perception-debug-last-run.json')
    if(lstatSync(file).isSymbolicLink())return null
    const bytes=readFileSync(file);if(bytes.length>2048)return null
    const row=JSON.parse(bytes.toString('utf8'))
    if(row?.version!==1||row.scope!==scopeOf(account)||!STATUSES.has(row.status))return null
    const at=safeNumber(row.startedAt),updatedAt=safeNumber(row.updatedAt)
    if(!at||!updatedAt||Date.now()-updatedAt>86400_000||updatedAt>Date.now()+30000)return null
    const interrupted=row.status==='running'
    return {status:interrupted?'interrupted':row.status,step:Math.max(0,Math.min(6,safeNumber(row.step))),
      at,updatedAt,stage:interrupted?'插件已重新启动；上轮运行未获得完整回执':row.status==='done'?'上轮任务已结束（完整结果仅本进程可见）':
        row.status==='error'?'上轮视频感知未成功，具体阶段请复核本机日志':'上轮任务被中断',
      ...(interrupted?{error:'上轮只读任务在插件重启前未确认完成，不能当作已理解。'}:{})}
  }catch{return null}
}
