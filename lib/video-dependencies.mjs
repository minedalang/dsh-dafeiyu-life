/** Read-only dependency evidence and explicitly authorized cross-platform FFmpeg installation launcher.
 * No bundled binary, no private data, and no inferred success from a directory.
 */
import {spawn as spawnProcess, spawnSync as spawnSynchronous} from 'node:child_process'
import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs'
import {join,basename,isAbsolute,resolve} from 'node:path'
import {storageDataPath} from './storage-layout.mjs'
import {largeDataStatus} from './storage-large-data-v2.mjs'
const safeError=e=>String(e?.message||e||'').replace(/[\u0000-\u001f]/g,' ').slice(0,140)
export const ASR_MODELS=Object.freeze(['tiny','base','small','medium','large-v3'])
export function validateFFmpegSelection(value,{stat=statSync}={}) {
  const selected=String(value||'').trim()
  if(!selected)return {ok:true,binary:'ffmpeg',source:'PATH'}
  if(selected.length>700||/[\x00-\x1f]/.test(selected)||!isAbsolute(selected)||
    !/^ffmpeg(?:\.exe)?$/i.test(basename(selected)))
    return {ok:false,reason:'ffmpeg-path-invalid'}
  try{if(!stat(selected).isFile())return {ok:false,reason:'ffmpeg-path-not-file'}}
  catch{return {ok:false,reason:'ffmpeg-path-not-found'}}
  return {ok:true,binary:resolve(selected),source:'custom-path'}
}
export function inspectWhisperModelDirectory(value,{stat=statSync}={}) {
  const selected=String(value||'').trim()
  if(!selected||selected.length>700||/[\x00-\x1f]/.test(selected)||!isAbsolute(selected))
    return {ok:false,reason:'whisper-model-path-invalid'}
  try{
    if(!stat(selected).isDirectory()||!stat(join(selected,'model.bin')).isFile()||
      !stat(join(selected,'config.json')).isFile())return {ok:false,reason:'whisper-model-files-missing'}
  }catch{return {ok:false,reason:'whisper-model-files-missing'}}
  return {ok:true,path:resolve(selected)}
}
export function probeFFmpeg({run=spawnSynchronous,binary=''}={}) {
  const choice=validateFFmpegSelection(binary)
  if(!choice.ok)return {available:false,reason:choice.reason}
  try{
    const result=run(choice.binary,['-version'],{encoding:'utf8',windowsHide:true,timeout:2500,maxBuffer:16384})
    if(result.status!==0)return {available:false,reason:result.error?.code==='ENOENT'?'not-found':'unavailable'}
    const line=String(result.stdout||'').split(/\r?\n/)[0].slice(0,150)
    if(!/^ffmpeg version\s/i.test(line))return {available:false,reason:'invalid-version-output'}
    return {available:true,version:line,source:choice.source}
  }catch{return {available:false,reason:'unavailable'}}
}
export function testFFmpegDecode({run=spawnSynchronous,binary=''}={}) {
  const choice=validateFFmpegSelection(binary)
  if(!choice.ok)return {ok:false,reason:choice.reason}
  if(!probeFFmpeg({run,binary}).available)return {ok:false,reason:'ffmpeg-not-found'}
  try{
    const x=run(choice.binary,['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','color=c=black:s=32x32:d=0.2','-frames:v','1','-f','null','-'],
      {windowsHide:true,encoding:'utf8',timeout:9000,maxBuffer:4096})
    return x.status===0?{ok:true,decoded:true}:{ok:false,reason:x.error?.code==='ETIMEDOUT'?'timeout':'decode-failed'}
  }catch{return {ok:false,reason:'decode-failed'}}
}
export function readWhisperReadiness({stateDir,model='small',modelPath='',pythonAvailable=false,packageAvailable=false,exists=existsSync,list=readdirSync,stat=statSync,read=readFileSync}={}) {
  const choice=ASR_MODELS.includes(model)?model:'small'
  const v2=largeDataStatus(stateDir)
  const cacheRoots=v2.configured?[join(v2.whisperHome,'hub'),join(stateDir,'.hf-cache','hub')]:[storageDataPath(stateDir,'.hf-cache','hub')]
  // A cache directory alone does NOT imply the selected model downloaded successfully.
  let modelCached=false
  for(const cache of cacheRoots)try{
    const d=join(cache,`models--Systran--faster-whisper-${choice}`,'snapshots')
    for(const snapshot of list(d).slice(0,16)){
      const folder=join(d,snapshot)
      if(exists(join(folder,'model.bin'))&&exists(join(folder,'config.json'))){modelCached=true;break}
    }
  }catch{}
  const custom=String(modelPath||'').trim()
  const customSelection=custom?inspectWhisperModelDirectory(custom,{stat}):null
  if(custom)modelCached=customSelection?.ok===true
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
  return {model:choice,modelSource:custom?'custom-path':'hf-cache',modelPathValid:custom?customSelection?.ok===true:null,modelPathError:custom&&!customSelection?.ok?customSelection?.reason:null,environmentReady:Boolean(pythonAvailable&&packageAvailable),modelCached,lastRun}
}
// Only fixed package-manager commands; no URLs, shell interpolation or user-supplied flags.
let ffmpegInstall={phase:'idle',platform:process.platform,startedAt:null,finishedAt:null,result:''}
let ffmpegInstallTask=null
export const ffmpegInstallStatus=()=>({...ffmpegInstall})
export function ffmpegInstallCommand({platform=process.platform,run=spawnSynchronous,exists=existsSync}={}){
  const available=name=>{
    try{return run(name,['--version'],{encoding:'utf8',windowsHide:true,timeout:2500,maxBuffer:2048}).status===0}catch{return false}
  }
  if(platform==='darwin'){
    const brew=['/opt/homebrew/bin/brew','/usr/local/bin/brew'].find(x=>exists(x))||'brew'
    return available(brew)?{binary:brew,args:['install','ffmpeg'],label:'macOS Homebrew'}:
      {error:'未检测到 Homebrew，请先按 https://brew.sh/ 安装，再安装 FFmpeg'}
  }
  if(platform==='linux'){
    if(!available('pkexec'))return {error:'Linux 缺少 polkit 图形授权工具 pkexec；请在终端手动使用发行版包管理器安装 FFmpeg'}
    if(available('apt-get'))return {binary:'pkexec',args:['apt-get','install','-y','ffmpeg'],label:'Linux apt-get / polkit'}
    if(available('dnf'))return {binary:'pkexec',args:['dnf','install','-y','ffmpeg'],label:'Linux dnf / polkit'}
    if(available('pacman'))return {binary:'pkexec',args:['pacman','-S','--noconfirm','ffmpeg'],label:'Linux pacman / polkit'}
    return {error:'未找到受支持的 Linux 软件包管理器；请使用系统发行版官方方式安装 FFmpeg'}
  }
  return {error:'当前系统暂无受控的一键 FFmpeg 安装器，请使用 ffmpeg.org/download.html 获取官方安装方式'}
}
export async function openFFmpegInstaller({platform=process.platform,run=spawnSynchronous,spawn=spawnProcess,binary=''}={}) {
  if(ffmpegInstallTask)return {ok:true,started:true,alreadyRunning:true,message:'FFmpeg 正在安装，请等待任务结束后重新检测'}
  if(probeFFmpeg({run,binary}).available)return {ok:true,alreadyInstalled:true,message:'FFmpeg 已可访问，无须重新安装。可继续执行解码自测。'}
  if(platform!=='win32'){
    const command=ffmpegInstallCommand({platform,run})
    if(command.error)return {ok:false,error:command.error}
    ffmpegInstall={phase:'installing',platform,startedAt:new Date().toISOString(),finishedAt:null,result:command.label+' 已启动'}
    ffmpegInstallTask=new Promise(resolve=>{
      let child
      try{
        child=spawn(command.binary,command.args,{shell:false,windowsHide:true,stdio:'ignore'})
        child.once('error',e=>resolve({ok:false,error:'包管理器启动失败：'+safeError(e)}))
        child.once('close',code=>resolve(code===0?{ok:true}:{ok:false,error:command.label+' 安装失败（退出码 '+Number(code)+'）'}))
      }catch(e){resolve({ok:false,error:'启动安装失败：'+safeError(e)})}
    }).then(value=>{
      ffmpegInstall={...ffmpegInstall,phase:value.ok?'finished':'failed',finishedAt:new Date().toISOString(),result:value.error||'安装器完成；请重新检测实际 FFmpeg 版本和解码能力'}
      return value
    }).finally(()=>{ffmpegInstallTask=null})
    return {ok:true,started:true,message:'已启动 '+command.label+' 安装程序；可能需要系统授权。安装器完成后请重新检测 FFmpeg。'}
  }
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
