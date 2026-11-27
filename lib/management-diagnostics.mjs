import {spawn} from 'node:child_process'
import {mkdtemp,writeFile,readFile,readdir,lstat,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,win32} from 'node:path'

// Invoke the existing exporter, not a second collection policy. No caller-controlled
// path, command, URL, cookie, arbitrary environment setting or output location.
const PAYLOAD="$ErrorActionPreference='Stop'; $s=[IO.File]::ReadAllText($env:BILI_EXPORT_SCRIPT,[Text.Encoding]::UTF8); $marker='# POWERSHELL_PAYLOAD_BEGIN'; $i=$s.LastIndexOf($marker); if($i -lt 0){throw 'Missing payload marker'}; Invoke-Expression $s.Substring($i+$marker.Length)"
const ARCHIVE=/^bili-duty-logs-\d{8}-\d{6}-\d{3}\.zip$/
const MAX_BYTES=128*1024*1024
export async function collectManagementDiagnostics({root,script,python='',snapshot,platform=process.platform,spawnProcess=spawn,systemRoot=process.env.SystemRoot||'C:\\Windows',timeoutMs=300_000}={}){
 if(platform!=='win32')throw Error('当前平台不支持原 Windows 诊断导出器，请使用原导出工具。')
 const scriptInfo=await lstat(script).catch(()=>null)
 if(!scriptInfo?.isFile()||scriptInfo.isSymbolicLink())throw Error('原诊断导出器缺失或不安全。')
 const temporary=await mkdtemp(join(tmpdir(),'dafeiyu-management-diagnostics-'))
 try{
  const snapshotFile=join(temporary,'live-snapshot.json'),text=JSON.stringify(snapshot||null)
  if(Buffer.byteLength(text)>65536||snapshot?.ok!==true||snapshot.schemaVersion!==1)throw Error('实时诊断状态暂不可用。')
  await writeFile(snapshotFile,text,{flag:'wx',mode:0o600})
  const env={...process.env,BILI_EXPORT_SCRIPT:script,BILI_EXPORT_ROOT:root,BILI_EXPORT_DIR:temporary,BILI_EXPORT_PYTHON_ARG:python,BILI_EXPORT_STATUS_URL:'',BILI_EXPORT_LIVE_SNAPSHOT_FILE:snapshotFile,BILI_EXPORT_FULL_MEMORY:'1',BILI_EXPORT_BINARY_EVIDENCE:'0',BILI_EXPORT_STRICT:'0',BILI_EXPORT_NO_PAUSE:'1'}
  const exe=win32.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe')
  await new Promise((resolve,reject)=>{
   const child=spawnProcess(exe,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',PAYLOAD],{env,windowsHide:true,shell:false,stdio:'ignore'});let timedOut=false
   const timer=setTimeout(()=>{timedOut=true;try{child.kill()}catch{}},timeoutMs)
   child.once('error',()=>{clearTimeout(timer);reject(Error('无法启动原诊断导出器。'))})
   child.once('close',code=>{clearTimeout(timer);if(timedOut)reject(Error('诊断导出超时，请用原 BAT 工具重试。'));else if(code!==0)reject(Error('原诊断导出器执行失败，请用 BAT 工具查看详情。'));else resolve()})
  })
  const files=(await readdir(temporary)).filter(x=>ARCHIVE.test(x))
  if(files.length!==1)throw Error('诊断导出未生成唯一 ZIP。')
  const filename=files[0],path=join(temporary,filename),st=await lstat(path)
  if(!st.isFile()||st.isSymbolicLink()||st.size<22||st.size>MAX_BYTES)throw Error('诊断 ZIP 不可用或超过网页 128 MiB 上限，请使用原 BAT 工具。')
  const bytes=await readFile(path);if(bytes.length!==st.size||bytes.readUInt32LE(0)!==0x04034b50)throw Error('诊断 ZIP 校验未通过。')
  return {filename,bytes}
 }finally{await rm(temporary,{recursive:true,force:true}).catch(()=>{})}
}
