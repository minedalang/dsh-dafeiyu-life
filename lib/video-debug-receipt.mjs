/** Diagnostic status only. Never persist video IDs, account IDs, image data, prompts or model output. */
import {readFileSync,writeFileSync,renameSync,lstatSync,mkdirSync} from 'node:fs'
import {createHash,randomBytes} from 'node:crypto'
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
/** Export-friendly last owner focus verdict. The existing owner's .bat exporter
 * already includes reports/; do not alter or overwrite that custom script.
 * Only a closed set of harmless machine status codes and counts is stored.
 */
export function ownerFocusSafeReport(job,account){
  const focus=job?.ownerFocus||{}
  if(job?.sourceMode!=='owner-focus'||job.status!=='done'||
     !['focused','focus-unavailable'].includes(focus.status))return null
  const stageSet=new Set(['verified','decode-or-tool','visual-model','evidence','focus-verification'])
  const codes=new Set(['focus-evidence-verified','tool-result-unavailable','visual-model-incomplete',
    'decoded-frame-provenance-rejected','decoded-visual-receipt-rejected',
    'focus-window-budget-time-rejected','focus-tool-failed','focus-execution-error'])
  const diag=focus.focusDiagnosis||{}
  const selected=focus.selectedTargets?.[0]
  return {schema:'owner-focus-technical-diagnostic/v1',scope:scopeOf(account),
    at:safeNumber(job.updatedAt||Date.now()),status:focus.status,
    stage:stageSet.has(diag.stage)?diag.stage:'decode-or-tool',
    code:codes.has(diag.code)?diag.code:'unknown-focus-failure',
    requestedSeconds:Number.isSafeInteger(selected?.durationSeconds)&&selected.durationSeconds<=120?
      selected.durationSeconds:0,
    decodedFrames:Math.min(48,safeNumber(diag.decodedFrames)),
    decodedCandidates:Math.min(240,safeNumber(diag.decodedCandidates)),
    frameBudget:Math.min(48,safeNumber(diag.frameBudget)),
    samplerVersion:Math.min(100,safeNumber(diag.samplerVersion)),
    verifiedWindows:Math.min(8,Array.isArray(focus.focusWindows)?focus.focusWindows.length:0)}
}

export function saveVideoDebugSummary(dir,job,account){
  if(!dir||!account)return false
  try{
    const file=join(dir,'video-perception-debug-last-run.json'),tmp=file+'.tmp'
    const body=JSON.stringify(videoDebugSummary(job,account))
    writeFileSync(tmp,body,{encoding:'utf8',mode:0o600});renameSync(tmp,file)
    const report=ownerFocusSafeReport(job,account)
    if(report){
      // reports/ is already included by the existing owner export script.
      // A symlinked report folder must never be followed.
      try{
        const reportDir=join(dir,'reports')
        mkdirSync(reportDir,{recursive:true,mode:0o700})
        if(lstatSync(reportDir).isSymbolicLink())throw Error('unsafe reports path')
        const target=join(reportDir,'video-focus-last-diagnostic.json')
        try{if(lstatSync(target).isSymbolicLink())throw Error('unsafe report file')}catch(e){
          if(e.code!=='ENOENT')throw e
        }
        const pending=target+'.'+process.pid+'.'+randomBytes(8).toString('hex')+'.tmp'
        writeFileSync(pending,JSON.stringify(report),{encoding:'utf8',mode:0o600,flag:'wx'})
        renameSync(pending,target)
      }catch{/* optional export receipt cannot erase a completed job */}
    }
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
