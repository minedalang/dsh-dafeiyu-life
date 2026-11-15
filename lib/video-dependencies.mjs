/** Read-only dependency evidence and explicit Windows FFmpeg installation launcher.
 * No bundled binary, no private data, and no inferred success from a directory.
 */
import {spawn as spawnProcess, spawnSync as spawnSynchronous} from 'node:child_process'
import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs'
import {join} from 'node:path'
const safeError=e=>String(e?.message||e||'').replace(/[\u0000-\u001f]/g,' ').slice(0,140)
export const ASR_MODELS=Object.freeze(['tiny','base','small','medium','large-v3'])
export function probeFFmpeg({run=spawnSynchronous}={}) {
  try{
    const result=run('ffmpeg',['-version'],{encoding:'utf8',windowsHide:true,timeout:2500,maxBuffer:16384})
    if(result.status!==0)return {available:false,reason:result.error?.code==='ENOENT'?'not-found':'unavailable'}
    const line=String(result.stdout||'').split(/\r?\n/)[0].slice(0,150)
    if(!/^ffmpeg version\s/i.test(line))return {available:false,reason:'invalid-version-output'}
    return {available:true,version:line}
  }catch{return {available:false,reason:'unavailable'}}
}
export function testFFmpegDecode({run=spawnSynchronous}={}) {
  if(!probeFFmpeg({run}).available)return {ok:false,reason:'ffmpeg-not-found'}
  try{
    const x=run('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','color=c=black:s=32x32:d=0.2','-frames:v','1','-f','null','-'],
      {windowsHide:true,encoding:'utf8',timeout:9000,maxBuffer:4096})
    return x.status===0?{ok:true,decoded:true}:{ok:false,reason:x.error?.code==='ETIMEDOUT'?'timeout':'decode-failed'}
  }catch{return {ok:false,reason:'decode-failed'}}
}
export function readWhisperReadiness({stateDir,model='small',pythonAvailable=false,packageAvailable=false,exists=existsSync,list=readdirSync,stat=statSync,read=readFileSync}={}) {
  const choice=ASR_MODELS.includes(model)?model:'small'
  const cache=join(stateDir,'.hf-cache','hub')
  // A cache directory alone does NOT imply the selected model downloaded successfully.
  let modelCached=false
  try{
    const d=join(cache,`models--Systran--faster-whisper-${choice}`,'snapshots')
    for(const snapshot of list(d).slice(0,16)){
      const folder=join(d,snapshot)
      if(exists(join(folder,'model.bin'))&&exists(join(folder,'config.json'))){modelCached=true;break}
    }
  }catch{}
  let lastRun=null
  try{
    const file=join(stateDir,'asr-last-run.json')
    if(stat(file).size<=2048){
      const row=JSON.parse(read(file,'utf8'))
      if(row&&row.version===1&&typeof row.at==='string'&&/^\d{4}-\d\d-\d\dT/.test(row.at)&&
        ['started','success','failed'].includes(row.outcome)&&ASR_MODELS.includes(row.model)){
        lastRun={at:row.at,outcome:row.outcome,model:row.model,
          segments:Number.isInteger(row.segments)?Math.max(0,Math.min(160,row.segments)):0,
          reason:['unavailable','timeout','invalid-receipt','process-error','transcription-failed'].includes(row.reason)?row.reason:null}
      }
    }
  }catch{}
  return {model:choice,environmentReady:Boolean(pythonAvailable&&packageAvailable),modelCached,lastRun}
}
export async function openFFmpegInstaller({platform=process.platform,run=spawnSynchronous,spawn=spawnProcess}={}) {
  if(platform!=='win32')return {ok:false,error:'一键安装目前只支持 Windows；请按系统的软件包管理器安装 FFmpeg'}
  let winget=false
  try{winget=run('winget.exe',['--version'],{encoding:'utf8',windowsHide:true,timeout:1500}).status===0}catch{}
  if(!winget)return {ok:false,error:'未检测到 winget（Windows 应用安装程序）。可先从 Microsoft Store 安装 App Installer，或手动从 ffmpeg.org/download.html 安装。'}
  // Fixed, audited package ID. User inputs never enter shell commands.
  const script="Write-Host '大肥鱼 FFmpeg 安装（通过 Windows winget 官方源）'; winget install --id Gyan.FFmpeg.Essentials --exact --source winget; Write-Host '安装结束。请查看上方结果，重启 DSH 后在 AI 模型页重新检测 FFmpeg。'"
  const encoded=Buffer.from(script,'utf16le').toString('base64')
  const launcher=`Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NoExit','-EncodedCommand','${encoded}') -WindowStyle Normal`
  return await new Promise(resolve=>{
    let settled=false,child,stderr=''
    const done=value=>{if(!settled){settled=true;resolve(value)}}
    try{
      child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',launcher],
        {shell:false,windowsHide:true,stdio:['ignore','ignore','pipe']})
      child.stderr?.on('data',s=>{stderr=(stderr+String(s)).slice(-140)})
      child.once('error',e=>done({ok:false,error:'PowerShell 未能启动：'+safeError(e)}))
      child.once('close',code=>done(code===0?{ok:true,opened:true,message:'已打开可见的 winget 安装窗口。只有该窗口提示成功，并且重新检测 FFmpeg 成功，才算真正安装完成。'}:
        {ok:false,error:'安装窗口未能打开：'+safeError(stderr||`退出码 ${code}`)}))
    }catch(e){done({ok:false,error:'PowerShell 未能启动：'+safeError(e)})}
  })
}
