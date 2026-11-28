// Approved fixed asset catalogue for the isolated native vision trial only.
// Each size and SHA-256 is from the exact upstream Git LFS pointer, not Xet hash.
import {randomBytes} from 'node:crypto'
import {dirname} from 'node:path'
import {getLocalVisionTestImage,LOCAL_VISION_TEST_PROMPT} from './local-vision-model-manager.mjs'
const asset=(file,bytes,sha256)=>Object.freeze({file,bytes,sha256})
const model=(id,name,revision,weights,mmproj)=>Object.freeze({id,name,revision,repo:`unsloth/${name.replace(' ','-')}-GGUF`,weights,mmproj})
export const LLAMA_VISION_MODELS=Object.freeze([
  model('qwen3.5-2b','Qwen3.5 2B','31ea6ac42dacbee2db8a2540a323377b3f652c75',
    asset('Qwen3.5-2B-Q4_K_M.gguf',1280835808,'cbb39d5102a6e6ef9675912b1c21d02335f4374c6bc267faa6cb96d7987d4a7b'),
    asset('mmproj-F16.gguf',668227264,'7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7')),
  model('qwen3.5-4b','Qwen3.5 4B','e87f176479d0855a907a41277aca2f8ee7a09523',
    asset('Qwen3.5-4B-Q4_K_M.gguf',2740937888,'00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4'),
    asset('mmproj-F16.gguf',672423616,'cd88edcf8d031894960bb0c9c5b9b7e1fea6ebee02b9f7ce925a00d12891f864')),
])
export const getLlamaVisionModel=id=>LLAMA_VISION_MODELS.find(x=>x.id===id)||null
export const llamaVisionAssetUrl=(model,asset)=>`https://huggingface.co/${model.repo}/resolve/${model.revision}/${asset.file}`
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
export async function runLlamaVisionImageTest({binary,weights,mmproj,model,port,signal,spawnImpl,fetchImpl,onPhase=()=>{},onChild=()=>{}}){
  signal.throwIfAborted()
  const key=randomBytes(32).toString('hex'),base=`http://127.0.0.1:${port}`
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('LLAMA_ARG_')))
  const args=['--model',weights,'--mmproj',mmproj,'--alias',model.id,'--host','127.0.0.1','--port',String(port),'--api-key',key,'--ctx-size','32768','--parallel','1','--n-gpu-layers','0','--jinja','--no-webui','--cors-origins','localhost']
  const child=spawnImpl(binary,args,{cwd:dirname(binary),env,windowsHide:true,shell:false,stdio:['ignore','ignore','ignore']})
  let exited=false,spawnFailed=false
  const closed=new Promise(resolve=>{child.once('close',()=>{exited=true;resolve()});child.once('error',()=>{spawnFailed=true})})
  onChild(child)
  const exitAbort=new AbortController()
  child.once('exit',()=>exitAbort.abort());child.once('error',()=>exitAbort.abort())
  const request=async(path,body,timeout)=>readBounded(await fetchImpl(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.any([signal,exitAbort.signal,AbortSignal.timeout(timeout)])}))
  try{
    onPhase('starting-runtime')
    const until=Date.now()+180_000
    let healthy=false
    while(Date.now()<until){
      signal.throwIfAborted();if(exited||spawnFailed)throw Error('视觉 llama-server 启动失败或提前退出')
      try{if((await request('/health',null,2500))?.status==='ok'){healthy=true;break}}catch{}
      await sleep(500)
    }
    if(!healthy)throw Error('视觉 llama-server 初始化超时')
    signal.throwIfAborted();onPhase('checking')
    const result=await request('/v1/chat/completions',{model:model.id,stream:false,temperature:0,max_tokens:4096,chat_template_kwargs:{enable_thinking:false},messages:[{role:'user',content:[{type:'text',text:LOCAL_VISION_TEST_PROMPT},{type:'image_url',image_url:{url:'data:image/png;base64,'+getLocalVisionTestImage().toString('base64')}}]}]},180_000)
    signal.throwIfAborted()
    const choice=Array.isArray(result?.choices)&&result.choices.length===1?result.choices[0]:null
    if(choice?.finish_reason!=='stop'||typeof choice?.message?.content!=='string'||!choice.message.content.trim())throw Error('未取得完整可见的图片描述；不视为自检成功')
    return {answer:choice.message.content,finishReason:choice.finish_reason}
  }finally{
    if(!exited){if(!spawnFailed){try{child.kill('SIGTERM')}catch{}}await waitClose(closed,8000)}
    if(!exited&&!spawnFailed){try{child.kill('SIGKILL')}catch{};await waitClose(closed,2000)}
    if(!exited)throw Error('视觉子进程未确认退出，请检查本机进程；不要重复启动')
  }
}
