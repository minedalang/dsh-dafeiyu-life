/** Explicit owner-initiated local PowerShell launcher; never accepts arbitrary shell arguments. */
import {spawn as nodeSpawn,spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
const errText=e=>String(e?.message||e||'').replace(/[\u0000-\u001f]/g,' ').slice(0,180)
export function findWindowsOllama({env=process.env,where=spawnSync,exists=existsSync}={}) {
  const installed=join(env.LOCALAPPDATA||'', 'Programs','Ollama','ollama.exe')
  if (env.LOCALAPPDATA && exists(installed))return installed
  try {
    const result=where('where.exe',['ollama.exe'],{windowsHide:true,encoding:'utf8',timeout:1200})
    const path=String(result?.stdout||'').split(/\r?\n/).map(s=>s.trim()).find(s=>/^(?:[a-z]:\\|\\\\)[^\r\n]*ollama\.exe$/i.test(s))
    if(result?.status===0 && path && exists(path))return path
  }catch{}
  return null
}
export async function openOllamaPowerShell({platform=process.platform,find=findWindowsOllama,spawn= nodeSpawn}={}) {
  if(platform!=='win32')return {ok:false,error:'快捷启动目前只支持 Windows，请在终端手动执行 ollama serve'}
  const executable=find()
  if(!executable)return {ok:false,error:'未找到 ollama.exe。请先安装 Windows 版 Ollama，并重新打开 DSH 后再试。'}
  // Escapes PowerShell single-quoted string, never runs commands from HTTP input.
  const quoted=executable.replace(/'/g,"''")
  const script=`Write-Host '大肥鱼：启动 Ollama 本地服务（Ctrl+C 停止）'; & '${quoted}' serve; Write-Host 'Ollama 已退出，或端口被其他实例占用；请检查上方提示。'`
  // DSH may run as an Electron GUI process without a console. PowerShell's
  // Start-Process opens a second, visible console reliably; an encoded fixed
  // script avoids command-interpreter quoting of local installation paths.
  const encoded=Buffer.from(script,'utf16le').toString('base64')
  const launch=`Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NoExit','-EncodedCommand','${encoded}') -WindowStyle Normal`
  return await new Promise(resolve=>{
    let child,settled=false,stderr=''
    const done=x=>{if(!settled){settled=true;resolve(x)}}
    try{
      child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',launch],
        {windowsHide:true,shell:false,stdio:['ignore','ignore','pipe']})
      child.stderr?.on('data',chunk=>{stderr+=String(chunk).slice(0,320);stderr=stderr.slice(-320)})
      child.once('error',e=>done({ok:false,error:'无法打开 PowerShell：'+errText(e)}))
      child.once('close',code=>done(code===0?{ok:true,opened:true,
        message:'已发送打开 PowerShell 窗口并运行 ollama serve 的请求。请查看实际窗口输出并刷新状态；若端口占用请退出已有的 Ollama。'}:
        {ok:false,error:'PowerShell 启动窗口失败：'+errText(stderr||('退出状态 '+code))}))
    }catch(e){done({ok:false,error:'无法打开 PowerShell：'+errText(e)})}
  })
}
