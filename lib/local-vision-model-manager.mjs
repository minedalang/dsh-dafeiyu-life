/**
 * 2.8.1-dev.2b: fixed-catalog, loopback-only Ollama model manager.
 * No third-party code is copied. Model weights are downloaded by a separately
 * installed Ollama daemon only after an explicit owner action.
 */
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
const ENDPOINT='http://127.0.0.1:11434'
export const LOCAL_VISION_MODELS=Object.freeze([
  Object.freeze({id:'qwen3.5-4b',name:'Qwen3.5 4B',ollama:'qwen3.5:4b',source:'https://ollama.com/library/qwen3.5:4b',license:'Apache-2.0'}),
  Object.freeze({id:'minicpm-v4.7-1b',name:'MiniCPM-V 4.7 1B',ollama:'openbmb/minicpm-v4.7:1b',source:'https://github.com/OpenBMB/MiniCPM-V',license:'upstream model license; review before use',compatibility:'部分 Ollama 版本尚不能加载该模型；下载后必须通过图片推理自检。'}),
])
const BY_ID=new Map(LOCAL_VISION_MODELS.map(model=>[model.id,model]))
const PHASES=new Set(['pulling','checking','deleting'])
// Single immutable test asset: the exact owner-supplied PNG used in Ollama
// requests is served by the management API. No generated approximation.
const TEST_IMAGE_BYTES=readFileSync(new URL('./assets/local-vision-selftest-dafeiyu.png',import.meta.url))
const TEST_IMAGE_BASE64=TEST_IMAGE_BYTES.toString('base64')
export function getLocalVisionTestImage(){return TEST_IMAGE_BYTES}
const TEST_IMAGE=Object.freeze({
  mime:'image/png',url:'/api/bili-duty/local-vision/selftest-image',
  description:'大肥鱼角色立绘，蓝色头发与鱼尾，深蓝色女仆服饰。',
  expected:'由用户查看实际回复后自行判断；程序不进行语义打分',
})
const brief=(x,max=460)=>{
  // Keep the terminal cause (DNS/proxy/TLS/timeout) rather than clipping it after the URL.
  const message=String(x?.message||x||'').replace(/[\x00-\x1f]+/g,' ').replace(/([?&](?:token|key|signature|secret|password)=)[^&\s]+/gi,'$1[redacted]')
  return message.length<=max?message:message.slice(0,120)+' … '+message.slice(-(max-125))
}
const downloadError=(error)=>{
  const message=String(error?.message||error||'')
  if(/max retries exceeded|r2\.cloudflarestorage\.com|no such host|proxyconnect|connection reset|i\/o timeout|tls handshake timeout|x509/i.test(message)){
    return 'Ollama 下载网络失败：请确认 Ollama 后台服务已使用 HTTPS_PROXY，核对本机代理端口、DNS 和 Cloudflare R2 可达性；必要时完全退出并重启 Ollama。详情：'+brief(error,380)
  }
  return brief(error)
}
export function getLocalVisionModel(id){return BY_ID.get(id)||null}
export function createLocalVisionModelManager({fetchImpl=globalThis.fetch,logger=console}={}){
  if(typeof fetchImpl!=='function')throw TypeError('fetch is required')
  let task=null,controller=null
  const progress={phase:'idle',model:'',percent:0,completed:0,total:0,error:'',updatedAt:Date.now()}
  const checked=new Set()
  const verificationByModel=new Map()
  const update=values=>Object.assign(progress,values,{updatedAt:Date.now()})
  async function request(path,{method='GET',body,signal,timeoutMs=2400}={}){
    const response=await fetchImpl(ENDPOINT+path,{
      method,headers:body?{'content-type':'application/json'}:undefined,
      body:body?JSON.stringify(body):undefined,
      signal:signal||AbortSignal.timeout(timeoutMs),redirect:'error',
    })
    if(!response.ok){
      let reason=''
      // A model-loading failure (e.g. Failed to load CLIP model) is more
      // informative than HTTP 500 and must be shown beside the self-test.
      if(path==='/api/chat'){
        try{
          const body=await response.text()
          if(body){
            try{reason=String(JSON.parse(body)?.error||body)}catch{reason=body}
          }
        }catch{}
      }
      throw Error('本地 Ollama 请求失败 HTTP '+response.status+(reason?'：'+brief(reason,360):''))
    }
    return response
  }
  function modelState(x,installed){return {...x,installed,verified:installed&&checked.has(x.id),verification:verificationByModel.get(x.id)||null}}
  async function list(){
    try{
      const response=await request('/api/tags')
      const result=await response.json()
      const installed=new Set((Array.isArray(result.models)?result.models:[]).map(x=>String(x.name||x.model||'')))
      return {running:true,models:LOCAL_VISION_MODELS.map(x=>modelState(x,installed.has(x.ollama))),testImage:TEST_IMAGE,progress:{...progress},runtime:'Ollama',runtimeRequired:true}
    }catch(error){return {running:false,models:LOCAL_VISION_MODELS.map(x=>modelState(x,false)),testImage:TEST_IMAGE,progress:{...progress},runtime:'Ollama',runtimeRequired:true,error:brief(error)+'；请先从 https://ollama.com/download 安装并启动 Ollama。'}}
  }
  async function verify(model,{signal}={}){
    checked.delete(model.id)
    const result={model:model.id,reviewId:randomUUID(),status:'running',
      startedAt:new Date().toISOString(),answer:'',error:'',doneReason:'',hadThinking:false}
    verificationByModel.set(model.id,result)
    update({phase:'checking',model:model.id,error:''})
    try{
      const response=await request('/api/chat',{method:'POST',body:{
        model:model.ollama,stream:false,keep_alive:'0',think:false,
        options:{temperature:0},
        messages:[{role:'user',content:'请观察这张大肥鱼的角色图片，用中文自然、具体地描述你真正看见的内容，包括人物外观、头发、服饰、配饰、姿态和背景。若有看不清的地方请直说，不要猜测。',images:[TEST_IMAGE_BASE64]}],
      },signal:signal?AbortSignal.any([signal,AbortSignal.timeout(180_000)]):undefined,timeoutMs:180_000})
      const data=await response.json()
      // Do not impose a synthetic output-token limit or truncate the final
      // response. Only an actual, successful image response enters user review.
      result.answer=String(data?.message?.content||'')
      result.hadThinking=Boolean(data?.message?.thinking)
      result.doneReason=String(data?.done_reason||'').slice(0,80)
      if(!result.answer.trim())throw Error('图片请求已返回，但没有可供用户查看的最终文字；无法人工验收')
      result.status='awaiting_review'
      result.finishedAt=new Date().toISOString()
      update({phase:'idle',model:model.id,percent:100,error:''})
      return {ok:true,verified:false,awaitingReview:true,model:model.id,reviewId:result.reviewId}
    }catch(error){
      checked.delete(model.id)
      result.status='failed'
      result.error=brief(error,400)
      result.finishedAt=new Date().toISOString()
      update({phase:signal?.aborted?'cancelled':'error',model:model.id,error:result.error})
      throw error
    }
  }
  async function review(id,{reviewId,accepted}={}){
    const model=getLocalVisionModel(id)
    if(!model)throw Error('不支持的本地视觉模型')
    if(task||PHASES.has(progress.phase))throw Error('模型任务正在执行，暂不能确认')
    if(typeof accepted!=='boolean')throw Error('必须明确认可或否决验证结果')
    const record=verificationByModel.get(id)
    if(!record||record.status!=='awaiting_review'||record.reviewId!==reviewId)
      throw Error('验证记录已失效，请重新执行图片识别后再确认')
    const state=await list()
    if(!state.running||!state.models.find(x=>x.id===id)?.installed)
      throw Error('模型已不可用，不能确认图片识别结果')
    checked.delete(id)
    record.status=accepted?'approved':'rejected'
    record.reviewedAt=new Date().toISOString()
    record.reviewedBy='owner'
    if(accepted)checked.add(id)
    update({phase:'idle',model:id,error:''})
    return {ok:true,model:id,verified:accepted,reviewed:true}
  }
  function start(id){
    const model=getLocalVisionModel(id)
    if(!model)throw Error('不支持的本地视觉模型')
    if(task||PHASES.has(progress.phase))throw Error('已有本地视觉模型任务正在执行')
    controller=new AbortController()
    const signal=controller.signal
    update({phase:'pulling',model:id,percent:0,completed:0,total:0,error:''})
    task=(async()=>{
      try{
        const response=await request('/api/pull',{method:'POST',body:{model:model.ollama,stream:true},signal,timeoutMs:120_000})
        if(!response.body)throw Error('Ollama 未返回下载进度')
        let pending='',length=0
        for await(const chunk of response.body){
          if(signal.aborted)throw Object.assign(Error('已取消下载'),{name:'AbortError'})
          length+=chunk.length
          if(length>15_000_000)throw Error('Ollama 进度输出超过安全上限')
          pending+=Buffer.from(chunk).toString('utf8')
          if(pending.length>200_000)throw Error('Ollama 进度消息异常')
          while(pending.includes('\n')){
            const newline=pending.indexOf('\n');const row=pending.slice(0,newline);pending=pending.slice(newline+1)
            if(!row.trim())continue
            const data=JSON.parse(row)
            if(data.error)throw Error('模型下载失败：'+brief(data.error))
            const completed=Math.max(0,Number(data.completed)||0),total=Math.max(0,Number(data.total)||0)
            update({phase:'pulling',completed,total,percent:total?Math.min(99,Math.floor(completed/total*100)):0})
          }
        }
        if(pending.trim()){
          const data=JSON.parse(pending);if(data.error)throw Error('模型下载失败：'+brief(data.error))
        }
        return await verify(model,{signal})
      }catch(error){
        checked.delete(id)
        update({phase:signal.aborted?'cancelled':'error',error:signal.aborted?'已取消下载或验证':downloadError(error),model:id})
        logger.warn?.('本地视觉模型未就绪：'+brief(error))
        throw error
      }finally{task=null;controller=null}
    })()
    return task
  }
  function cancel(){if(!controller)return false;controller.abort();return true}
  async function remove(id){
    const model=getLocalVisionModel(id)
    if(!model)throw Error('不支持的本地视觉模型')
    if(task||PHASES.has(progress.phase))throw Error('本地模型任务进行中，暂不能删除')
    update({phase:'deleting',model:id,error:''})
    try{
      await request('/api/delete',{method:'DELETE',body:{model:model.ollama}})
      checked.delete(id);verificationByModel.delete(id);update({phase:'idle',percent:0,model:'',error:''})
      return {ok:true,deleted:true}
    }catch(error){update({phase:'error',error:brief(error)});throw error}
  }
  return {list,start,cancel,remove,review,verifyId:async id=>{
    const model=getLocalVisionModel(id)
    if(!model)throw Error('不支持的本地视觉模型')
    if(task||PHASES.has(progress.phase))throw Error('已有本地视觉模型任务正在执行')
    const state=await list()
    if(!state.running||!state.models.find(x=>x.id===id)?.installed)
      throw Error('当前模型尚未下载或 Ollama 未运行，不能执行图片自检')
    try{return await verify(model)}
    catch(error){checked.delete(id);update({phase:'error',model:id,error:brief(error)});throw error}
  },progress:()=>({...progress})}
}
