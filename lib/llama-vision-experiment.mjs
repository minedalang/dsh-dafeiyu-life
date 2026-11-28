// Approved fixed asset catalogue for the isolated native vision trial only.
// Each size and SHA-256 is from the exact upstream Git LFS pointer, not Xet hash.
import {VideoReadFailure} from './video-visual-failure.mjs'
import {randomBytes} from 'node:crypto'
import {dirname} from 'node:path'
import {getLocalVisionTestImage,LOCAL_VISION_TEST_PROMPT} from './local-vision-model-manager.mjs'
export {LLAMA_VISION_MODELS,getLlamaVisionModel,llamaVisionAssetUrl} from './llama-vision-catalog.mjs'
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const waitClose=async(closed,ms)=>{let timer;try{await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(resolve,ms)})])}finally{clearTimeout(timer)}}
async function readBounded(response){
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error(`视觉服务 HTTP ${response.status}`)}
  const reader=response.body?.getReader();if(!reader)throw Error('视觉服务没有返回内容')
  const chunks=[];let size=0
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>300_000)throw Error('视觉响应超过原本地识图限制');chunks.push(Buffer.from(value))}}
  finally{await reader.cancel().catch(()=>{})}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
export async function withLlamaVisionRuntime({binary,weights,mmproj,model,port,signal,spawnImpl,fetchImpl,onPhase=()=>{},onChild=()=>{}},consume){
  signal.throwIfAborted()
  const key=randomBytes(32).toString('hex'),base=`http://127.0.0.1:${port}`
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('LLAMA_ARG_')))
  const args=['--model',weights,'--mmproj',mmproj,'--alias',model.id,'--host','127.0.0.1','--port',String(port),'--api-key',key,'--ctx-size','32768','--parallel','1','--n-gpu-layers','0','--jinja','--no-webui','--cors-origins','localhost']
  const child=spawnImpl(binary,args,{cwd:dirname(binary),env,windowsHide:true,shell:false,stdio:['ignore','ignore','ignore']})
  let exited=false,spawnFailed=false
  const closed=new Promise(resolve=>{child.once('close',()=>{exited=true;resolve()});child.once('error',()=>{spawnFailed=true})})
  const exitAbort=new AbortController()
  child.once('exit',()=>exitAbort.abort());child.once('error',()=>exitAbort.abort())
  const request=async(path,body,timeout)=>readBounded(await fetchImpl(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.any([signal,exitAbort.signal,AbortSignal.timeout(timeout)])}))
  let active=false
  try{
    onChild(child)
    onPhase('starting-runtime')
    const until=Date.now()+180_000
    let healthy=false
    while(Date.now()<until){
      signal.throwIfAborted();if(exited||spawnFailed)throw new VideoReadFailure('vision-native-start-failed','视觉 llama-server 启动失败或提前退出')
      try{if((await request('/health',null,2500))?.status==='ok'){healthy=true;break}}catch{}
      await sleep(500)
    }
    if(!healthy)throw new VideoReadFailure('vision-native-start-timeout','视觉 llama-server 初始化超时')
    signal.throwIfAborted();exitAbort.signal.throwIfAborted();onPhase('checking')
    active=true
    const result=await consume({port,key,model:model.id,signal:AbortSignal.any([signal,exitAbort.signal]),
      request:(body,timeout)=>{if(!active)throw Error('视觉运行时租约已结束');return request('/v1/chat/completions',body,timeout)}})
    signal.throwIfAborted();exitAbort.signal.throwIfAborted()
    return result
  }finally{
    active=false
    if(!exited&&!spawnFailed){try{child.kill('SIGTERM')}catch{};await waitClose(closed,8000)}
    if(!exited&&!spawnFailed){try{child.kill('SIGKILL')}catch{};await waitClose(closed,2000)}
    if(!exited&&spawnFailed)await waitClose(closed,2000)
    if(!exited)throw new VideoReadFailure('vision-native-close-unconfirmed','视觉子进程未确认退出，请检查本机进程；不要重复启动')
  }
}

export async function runLlamaVisionImageTest(options){
  const {model,signal}=options
  return withLlamaVisionRuntime(options,async({request})=>{
    const result=await request({model:model.id,stream:false,temperature:0,max_tokens:4096,chat_template_kwargs:{enable_thinking:false},messages:[{role:'user',content:[{type:'text',text:LOCAL_VISION_TEST_PROMPT},{type:'image_url',image_url:{url:'data:image/png;base64,'+getLocalVisionTestImage().toString('base64')}}]}]},180_000)
    signal.throwIfAborted()
    const choice=Array.isArray(result?.choices)&&result.choices.length===1?result.choices[0]:null
    if(choice?.finish_reason!=='stop'||typeof choice?.message?.content!=='string'||!choice.message.content.trim())throw Error('未取得完整可见的图片描述；不视为自检成功')
    return {answer:choice.message.content,finishReason:choice.finish_reason}
  })
}
