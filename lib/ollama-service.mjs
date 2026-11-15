/** Owner-triggered, cross-platform native Ollama service recovery.
 * Does not install a runtime, open PowerShell, alter proxies or accept shell input.
 */
import {spawn as nativeSpawn} from 'node:child_process'
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
export async function ensureOllamaService({probe,spawn=nativeSpawn,waitFor=wait,executable=ollamaExecutable()}={}){
  if(typeof probe!=='function')throw Error('Ollama service probe required')
  if((await probe()).running)return {ok:true,alreadyRunning:true,message:'Ollama 服务已就绪；已安装模型无需重新下载或验收'}
  if(starting)return starting
  starting=(async()=>{
    let child
    try{
      child=spawn(executable,['serve'],{shell:false,detached:true,windowsHide:true,stdio:'ignore'})
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
        if((await probe()).running)return {ok:true,started:true,message:'Ollama 已恢复运行，原有模型与验收记录无需重做'}
      }
      return {ok:false,error:'已发起 Ollama 启动，但本地服务未在检测期内就绪；请检查系统上的 Ollama 应用或端口 11434'}
    }catch(e){return {ok:false,error:'未能启动 Ollama：'+String(e?.code||'运行环境不支持')}}
  })()
  try{return await starting}finally{starting=null}
}
