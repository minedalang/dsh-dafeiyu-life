/** Owner-triggered, cross-platform native Ollama service recovery.
 * Does not install a runtime, open PowerShell, alter proxies or accept shell input.
 */
import {spawn as nativeSpawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {existsSync} from 'node:fs'
import {join} from 'node:path'
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let starting=null
export function ollamaExecutable({platform=process.platform,env=process.env,exists=existsSync}={}){
  const candidates=platform==='win32'?[join(env.LOCALAPPDATA||'C:\\__unavailable','Programs','Ollama','ollama.exe')]:
    platform==='darwin'?['/Applications/Ollama.app/Contents/Resources/ollama','/opt/homebrew/bin/ollama','/usr/local/bin/ollama']:
    ['/usr/local/bin/ollama','/usr/bin/ollama']
  return candidates.find(p=>exists(p))||'ollama'
}
// Netstat lists TCPv4 and TCPv6 together. The unspecified remote endpoint and
// zero port identify listening rows without depending on translated state names.
export function parseOllamaListeners(output){
  const pids=new Set()
  for(const line of String(output||'').split(/\r?\n/)){
    const match=line.trim().match(/^TCP\s+\S+:11434\s+(?:0\.0\.0\.0|\[::\]):0\s+\S+\s+(\d+)$/i)
    if(match&&Number(match[1])>0)pids.add(Number(match[1]))
  }
  return [...pids]
}
const runFile=promisify(execFile)
async function windowsTool(name,args,{env=process.env,run=runFile}={}){
  const {stdout}=await run(join(env.SystemRoot||'C:\\Windows','System32',name),args,{windowsHide:true,shell:false,timeout:4000,maxBuffer:2*1024*1024})
  return stdout
}
export async function inspectOllamaListeners({platform=process.platform,env=process.env,run=runFile}={}){
  if(platform!=='win32')return null
  try{return {available:true,pids:parseOllamaListeners(await windowsTool('netstat.exe',['-ano'],{env,run}))}}
  catch{return {available:false,pids:[]}}
}
async function windowsOllamaBusy({env=process.env,run=runFile}={}){
  const text=await windowsTool('tasklist.exe',['/FO','CSV','/NH'],{env,run})
  return /^"ollama(?: app)?\.exe",/im.test(text)
}
export function ollamaDesktopExecutable({env=process.env,exists=existsSync}={}){
  const candidate=join(env.LOCALAPPDATA||'C:\\__unavailable','Programs','Ollama','ollama app.exe')
  return exists(candidate)?candidate:null
}
const conflict=()=>({ok:false,code:'ollama-port-conflict',error:'检测到多个进程监听 11434 端口（可能是 IPv4 / IPv6 两个 Ollama 实例）。请等待推理结束，退出重复服务，仅保留一个 Ollama；插件不会自动结束进程或切换地址。'})
export async function ensureOllamaService({probe,spawn=nativeSpawn,waitFor=wait,platform=process.platform,executable=ollamaExecutable(),desktopExecutable=ollamaDesktopExecutable(),inspect=()=>inspectOllamaListeners({platform}),isBusy=windowsOllamaBusy}={}){
  if(typeof probe!=='function')throw Error('Ollama service probe required')
  if(starting)return starting
  starting=(async()=>{
    try{
      const running=(await probe()).running
      const listeners=platform==='win32'?await inspect():null
      if(listeners?.pids?.length>1)return conflict()
      if(running)return {ok:true,alreadyRunning:true,message:'Ollama 服务已就绪；已安装模型无需重新下载或验收'}
      if(platform==='win32'){
        // Never create an orphan CLI daemon on Windows. If ownership cannot
        // be checked or an existing process is starting, leave it untouched.
        if(!listeners?.available)return {ok:false,error:'无法核验本机 11434 端口，请从开始菜单检查 Ollama；未启动额外服务。'}
        if(listeners.pids.length||await isBusy())return {ok:false,error:'已有 Ollama 进程或 11434 端口被占用，但本地 API 未就绪。请检查系统托盘或等待启动完成；未启动额外服务。'}
        if(!desktopExecutable)return {ok:false,error:'未找到默认安装位置的 Ollama 桌面应用。请从开始菜单启动已安装的 Ollama，或安装官方桌面客户端。'}
        const latest=await inspect()
        if(latest?.pids?.length>1)return conflict()
        if(!latest?.available||latest.pids.length||await isBusy())return {ok:false,error:'Ollama 进程或端口状态已变化，请刷新后检查；未启动额外服务。'}
      }
      const child=spawn(platform==='win32'?desktopExecutable:executable,platform==='win32'?[]:['serve'],{shell:false,detached:true,windowsHide:true,stdio:'ignore'})
      const launch=await new Promise(resolve=>{
        let finished=false
        const done=x=>{if(!finished){finished=true;resolve(x)}}
        child.once('error',e=>done({ok:false,error:e?.code==='ENOENT'?'未找到 Ollama，请先安装客户端':'启动 Ollama 失败：'+String(e?.code||'错误')}))
        child.once('spawn',()=>done({ok:true}))
      })
      if(!launch.ok)return launch
      child.unref?.()
      for(let i=0;i<12;i++){
        await waitFor(500)
        if((await probe()).running){
          if(platform==='win32'&&(await inspect())?.pids?.length>1)return conflict()
          return {ok:true,started:true,message:'Ollama 已恢复运行，原有模型与验收记录无需重做'}
        }
      }
      return {ok:false,error:'已发起 Ollama 启动，但本地服务未在检测期内就绪；请检查系统上的 Ollama 应用或端口 11434'}
    }catch(e){return {ok:false,error:'未能启动 Ollama：'+String(e?.code||'运行环境不支持')}}
  })()
  try{return await starting}finally{starting=null}
}

/** Coalesce management health checks. No model calls, startup, downloads or authority. */
export function createOllamaHealthProbe({list,inspectListeners=inspectOllamaListeners,now=Date.now,ttlMs=20_000}={}){
  if(typeof list!=='function')throw TypeError('Ollama model list required')
  let revision=0,cache=null,pending=null
  const invalidate=()=>{revision++;cache=null;pending=null}
  const inspect=async (modelId,current)=>{
    if(!modelId)return null
    const t=now()
    if(cache?.modelId===modelId&&t>=cache.at&&t-cache.at<ttlMs)return cache
    if(pending?.modelId===modelId)return pending.promise
    const epoch=revision
    const task={modelId,promise:null}
    task.promise=(async()=>{
      let state='unavailable'
      try{
        const result=await Promise.resolve().then(()=>current??list())
        if(result?.running===true){
          const selected=Array.isArray(result.models)?result.models.find(m=>m.id===modelId):null
          state=selected?.installed===true?(selected.verified===true?'ready':'unverified'):'model-missing'
        }
      }catch{/* Only classify as unavailable; never expose raw transport errors. */}
      try{if((await inspectListeners())?.pids?.length>1)state='port-conflict'}catch{/* Do not invent a conflict. */}
      const value={modelId,at:now(),state}
      if(epoch!==revision||pending!==task)return null
      cache=value;return value
    })().finally(()=>{if(pending===task)pending=null})
    pending=task
    return task.promise
  }
  return {inspect,invalidate}
}
