/**
 * Desktop UI may request cleanup, but MUST NOT delete while it is running.
 * A separate Node worker waits for the DSH process to exit, refuses if any
 * potentially conflicting runtime remains, then independently rechecks SHA.
 */
import {existsSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs'
import {join,win32} from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawn,spawnSync} from 'node:child_process'
import {validateLocalDataPath} from './storage-location.mjs'
import {inspectRetainedModelCopies,cleanupRetainedModelCopies} from './storage-maintenance.mjs'
const NAME='.dafeiyu-model-cleanup-job-v1.json'
const MAX_AGE_MS=30*60*1000
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const bounded=e=>String(e?.message||e||'未知异常').replace(/[\x00-\x1f]/g,' ').slice(0,220)
function file(root){return join(validateLocalDataPath(root),NAME)}
export function readCleanupJob(root){
 const p=file(root)
 if(!existsSync(p))return {status:'idle'}
 if(!lstatSync(p).isFile()||lstatSync(p).isSymbolicLink()||lstatSync(p).size>8192)throw Error('清理任务状态文件不可信')
 const value=JSON.parse(readFileSync(p,'utf8'))
 if(value?.schema!==1||!['waiting','failed','completed'].includes(value.status))throw Error('清理任务格式无效')
 if(value.status==='waiting'&&(!Number.isFinite(Date.parse(value.expiresAt))||Date.parse(value.expiresAt)<Date.now()))
  return {...value,status:'failed',reason:'清理助手未在预约时间内完成；未自动重试，请重新验证模型'}
 return value
}
function write(root,value){
 const dest=file(root),tmp=dest+'.'+randomUUID()+'.tmp'
 writeFileSync(tmp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600})
 try{renameSync(tmp,dest)}catch(e){rmSync(tmp,{force:true});throw e}
}
export function queueModelCleanup({root,verification,workerScript,parentPid=process.pid,spawnImpl=spawn}={}){
 const base=validateLocalDataPath(root),now=Date.now()
 if(!verification?.ready||!verification?.at||now-verification.at>10*60*1000||verification.at>now)
  throw Error('运行时验证已失效或未全部通过，请重新点击一键验证')
 const other=join(base,'.dafeiyu-life-cleanup-job-v1.json')
 if(existsSync(other)){
  const stat=lstatSync(other)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)throw Error('Life 清理任务身份文件异常')
  const row=JSON.parse(readFileSync(other,'utf8'))
  if(['waiting','running'].includes(row?.status))throw Error('已有 Life 清理任务，不能同时预约模型清理')
 }
 const previous=readCleanupJob(base)
 if(previous.status==='waiting')throw Error('已有待执行清理任务，请完全退出 DSH；不能重复预约')
 if(previous.status==='completed')throw Error('旧副本已清理，不可重复执行')
 const inspected=inspectRetainedModelCopies({root:base,verify:true})
 if(!inspected.eligible||!inspected.verified||inspected.target!==verification.target)
  throw Error('旧副本位置或内容已经变化，必须重新验证')
 const job={schema:1,id:randomUUID(),status:'waiting',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+MAX_AGE_MS).toISOString(),
   target:inspected.target,files:inspected.files,bytes:inspected.bytes,notice:'已预约：完整退出 DSH 后才执行；进程或校验有异常就停止'}
 write(base,job)
 let child
 try{
  child=spawnImpl(process.execPath,[workerScript,'--root',base,'--parent-pid',String(parentPid),'--job-id',job.id],{
   detached:true,stdio:'ignore',shell:false,windowsHide:true,
   env:process.versions.electron?{...process.env,ELECTRON_RUN_AS_NODE:'1'}:process.env,
  })
  if(!child?.pid)throw Error('清理助手未能启动')
  child.unref?.()
 }catch(error){write(base,{...job,status:'failed',reason:'无法启动离线清理助手：'+bounded(error)});throw error}
 return {ok:true,scheduled:true,status:job.status,bytes:job.bytes,files:job.files,
   message:'已预约停机清理；请完整退出 DSH 与相关 Python 进程。验证失败或未退出时不会删除旧副本'}
}
// Ollama can spawn its own llama-server.exe. Unlike the DSH Embedding runtime,
// that server normally reads Ollama's independent model store. Ignore it ONLY
// when local OS process metadata proves both its parent and binary belong to
// Ollama, and its explicit model argument is outside the legacy DSH root.
// Failure to obtain trustworthy metadata is a blocking result, not permission.
const winPath=value=>String(value||'').replace(/^\\\\\?\\/,'').replace(/\//g,'\\')
const inWinDir=(dir,candidate)=>{
 const rel=win32.relative(winPath(dir),winPath(candidate))
 return rel===''||(rel!=='..'&&!rel.startsWith('..\\')&&!win32.isAbsolute(rel))
}
const inOllamaBundle=value=>/(?:^|[\\/])ollama(?:[\\/]|$)/i.test(String(value||''))
function explicitModelArg(command){
 const match=/(?:^|\s)--model(?:\s+|=)(?:"([^"]+)"|'([^']+)'|(.+?)(?=\s+--[\w-]+(?:\s|=|$)|$))/i.exec(String(command||''))
 return (match?.[1]||match?.[2]||match?.[3]||'').trim()
}
/** Only an externally-owned Ollama server with a known external model is exempt. */
export function provenExternalOllamaRunner(info,{root}={}){
 if(!root||!info||!/^(?:ollama(?:\.exe)?)$/i.test(String(info.parentName||'')))return false
 const exe=String(info.exe||''),parentExe=String(info.parentExe||''),command=String(info.command||'')
 const model=explicitModelArg(command)
 if(!win32.isAbsolute(winPath(exe))||!win32.isAbsolute(winPath(parentExe))||!win32.isAbsolute(winPath(model)))return false
 if(!inOllamaBundle(exe)||!inOllamaBundle(parentExe))return false
 if(inWinDir(root,exe)||inWinDir(root,parentExe)||inWinDir(root,model))return false
 // Reject any command line mentioning the legacy DSH root, even when the
 // --model argument appears safe. A process could be using another old file.
 const source=winPath(root).replace(/[\\]+$/,'').toLowerCase()
 if(winPath(command).toLowerCase().includes(source))return false
 return true
}
function inspectWindowsOllamaRunner(pid,{root,exec}){
 if(!Number.isSafeInteger(pid)||pid<=0||!root)return false
 const script=`$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $p) { exit 3 }; $q=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$p.ParentProcessId); if ($null -eq $q) { exit 3 }; [pscustomobject]@{ pid=[int]$p.ProcessId; exe=[string]$p.ExecutablePath; command=[string]$p.CommandLine; parentName=[string]$q.Name; parentExe=[string]$q.ExecutablePath } | ConvertTo-Json -Compress`
 try{
  const r=exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:65536})
  if(r.error||r.status!==0)return false
  const info=JSON.parse(String(r.stdout||''))
  return info.pid===pid&&provenExternalOllamaRunner(info,{root})
 }catch{return false}
}

export function runtimeProcessesStopped({platform=process.platform,exec=spawnSync,selfPid=process.pid,root=null}={}){
 // Conservatively block competing DSH, Node, Python and model processes.
 // Cleanup alone may exempt a *proven* external Ollama runner on Windows.
 let rows=[]
 if(platform==='win32'){
  const r=exec('tasklist.exe',['/FO','CSV','/NH'],{encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:6_000_000})
  if(r.error||r.status!==0||!String(r.stdout).trim())throw Error('无法枚举 Windows 进程，安全拒绝清理')
  rows=String(r.stdout).split(/\r?\n/).map(s=>{const m=/^"([^"]+)","(\d+)"/.exec(s);return m?{name:m[1],pid:Number(m[2])}:null}).filter(Boolean)
 }else if(['darwin','linux'].includes(platform)){
  const r=exec('ps',['-A','-o','pid=','-o','comm='],{encoding:'utf8',timeout:10000,maxBuffer:6_000_000})
  if(r.error||r.status!==0||!String(r.stdout).trim())throw Error('无法枚举进程，安全拒绝清理')
  rows=String(r.stdout).split(/\r?\n/).map(s=>{const m=/^\s*(\d+)\s+(.+?)\s*$/.exec(s);return m?{pid:Number(m[1]),name:m[2].split(/[\\/]/).pop()}:null}).filter(Boolean)
 }else throw Error('此操作系统尚未验证停机判断，不执行清理')
 if(!rows.length)throw Error('进程清单为空，无法证明停机')
 const conflicts=rows.filter(p=>{
  if(p.pid===selfPid||!/^(?:node(?:\.exe)?|python(?:w|[0-9.]*)?(?:\.exe)?|uv(?:\.exe)?|ffmpeg(?:\.exe)?|llama-server(?:\.exe)?|dsh(?:[-\s\w.]*)?(?:\.exe)?|deepseek-harness(?:\.exe)?)$/i.test(p.name))return false
  // Migration still uses the stricter original scanner. This narrowly scoped
  // exception is available only to cleanup on Windows with a known DSH root.
  if(platform==='win32'&&root&&/^llama-server\.exe$/i.test(p.name)&&inspectWindowsOllamaRunner(p.pid,{root,exec}))return false
  return true
 })
 return {ok:conflicts.length===0,count:conflicts.length,conflicts:conflicts.slice(0,5).map(p=>p.name)}
}
export async function runQueuedCleanup({root,parentPid,jobId,processIsAlive=pid=>{try{process.kill(pid,0);return true}catch(e){return e?.code!=='ESRCH'}},
 inspectProcesses=()=>runtimeProcessesStopped({root}),now=()=>Date.now(),pause=sleep,pollMs=2000}={}){
 const base=validateLocalDataPath(root),job=readCleanupJob(base)
 if(job.status!=='waiting'||job.id!==jobId||!Number.isSafeInteger(parentPid)||parentPid<=0||parentPid===process.pid)
  throw Error('无效的离线清理任务身份或父进程')
 const expiry=Date.parse(job.expiresAt)
 const fail=reason=>{write(base,{...job,status:'failed',finishedAt:new Date().toISOString(),reason:bounded(reason)});return {ok:false,reason:bounded(reason)}}
 if(!Number.isFinite(expiry)||expiry-now()>MAX_AGE_MS||expiry<=now())return fail('清理预约已过期')
 while(processIsAlive(parentPid)){
  if(now()>=expiry)return fail('等待 DSH 退出超时，未删除旧副本')
  await pause(pollMs)
 }
 try{
  const stopped=inspectProcesses()
  if(!stopped.ok)return fail('仍检测到 DSH、Node、Python 或模型相关进程，未删除旧副本：'+stopped.conflicts.join('、'))
  // Never trust the status saved by the live UI: independently rehash all copies.
  const verified=inspectRetainedModelCopies({root:base,verify:true})
  if(!verified.eligible||!verified.verified||verified.target!==job.target||verified.files!==job.files||verified.bytes!==job.bytes)
   return fail('停机后模型数据发生变化，已拒绝清理')
  // Recheck after hashing: a DSH runtime may have started while verification ran.
  const stoppedAgain=inspectProcesses()
  if(!stoppedAgain.ok)return fail('模型复核期间出现新运行进程，未删除旧副本：'+stoppedAgain.conflicts.join('、'))
  const result=cleanupRetainedModelCopies({root:base,confirmedStopped:true,confirmedRuntimeVerified:true,confirmedDeleteOldCopy:true})
  write(base,{...job,status:'completed',finishedAt:new Date().toISOString(),deletedBytes:result.deletedBytes,deletedFiles:result.deletedFiles,
    notice:'仅迁移前保留的旧模型副本已清理，Python 与 Life 数据未删除'})
  return result
 }catch(error){return fail('离线清理失败：'+bounded(error))}
}
