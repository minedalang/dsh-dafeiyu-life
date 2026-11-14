/**
 * 2.8.1-dev.2b: fixed-catalog, loopback-only Ollama model manager.
 * No third-party code is copied. Model weights are downloaded by a separately
 * installed Ollama daemon only after an explicit owner action.
 */
const ENDPOINT='http://127.0.0.1:11434'
export const LOCAL_VISION_MODELS=Object.freeze([
  Object.freeze({id:'qwen3.5-4b',name:'Qwen3.5 4B',ollama:'qwen3.5:4b',source:'https://ollama.com/library/qwen3.5:4b',license:'Apache-2.0'}),
  Object.freeze({id:'minicpm-v4.7-1b',name:'MiniCPM-V 4.7 1B',ollama:'openbmb/minicpm-v4.7',source:'https://github.com/OpenBMB/MiniCPM-V',license:'upstream model license; review before use',compatibility:'部分 Ollama 版本尚不能加载该模型；下载后必须通过图片推理自检。'}),
])
const BY_ID=new Map(LOCAL_VISION_MODELS.map(model=>[model.id,model]))
const PHASES=new Set(['pulling','checking','deleting'])
const tinyPng='iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAA6klEQVR4nO3cSQqAMBAAQSP+/8vxBdLggoJV98DQzCmHGXPOhWPr2wN8nUBBoCBQECgIFAQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoLBdej3GTWM87+zXuw0KAgWBgkBBoCBQECgIFAQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoCBQECgIFK4dFvjBoVwbFAQKAgWBgkBBoCBQECgIFAQKAgWBgkBBoCBQECgIFAQKO+KAB79R8QFuAAAAAElFTkSuQmCC'
const brief=(x,max=160)=>String(x?.message||x||'').replace(/[\x00-\x1f]+/g,' ').slice(0,max)
export function getLocalVisionModel(id){return BY_ID.get(id)||null}
export function createLocalVisionModelManager({fetchImpl=globalThis.fetch,logger=console}={}){
  if(typeof fetchImpl!=='function')throw TypeError('fetch is required')
  let task=null,controller=null
  const progress={phase:'idle',model:'',percent:0,completed:0,total:0,error:'',updatedAt:Date.now()}
  const checked=new Set()
  const update=values=>Object.assign(progress,values,{updatedAt:Date.now()})
  async function request(path,{method='GET',body,signal,timeoutMs=2400}={}){
    const response=await fetchImpl(ENDPOINT+path,{
      method,headers:body?{'content-type':'application/json'}:undefined,
      body:body?JSON.stringify(body):undefined,
      signal:signal||AbortSignal.timeout(timeoutMs),redirect:'error',
    })
    if(!response.ok)throw Error('本地 Ollama 请求失败 HTTP '+response.status)
    return response
  }
  async function list(){
    try{
      const response=await request('/api/tags')
      const result=await response.json()
      const installed=new Set((Array.isArray(result.models)?result.models:[]).map(x=>String(x.name||x.model||'')))
      return {running:true,models:LOCAL_VISION_MODELS.map(x=>({...x,installed:installed.has(x.ollama),verified:checked.has(x.id)})),progress:{...progress},runtime:'Ollama',runtimeRequired:true}
    }catch(error){return {running:false,models:LOCAL_VISION_MODELS.map(x=>({...x,installed:false,verified:false})),progress:{...progress},runtime:'Ollama',runtimeRequired:true,error:brief(error)+'；请先从 https://ollama.com/download 安装并启动 Ollama。'}}
  }
  async function verify(model,{signal}={}){
    update({phase:'checking',model:model.id,error:''})
    const response=await request('/api/chat',{method:'POST',body:{model:model.ollama,stream:false,keep_alive:'0',options:{num_predict:32},messages:[{role:'user',content:'请只回答：图片中央正方形是什么颜色？',images:[tinyPng]}]},signal,timeoutMs:90_000})
    const data=await response.json()
    if(!/(红|red)/i.test(String(data?.message?.content||'')))throw Error('图片颜色自检未通过：模型未识别中央红色正方形')
    checked.add(model.id)
    update({phase:'ready',model:model.id,percent:100,error:''})
    return {ok:true,verified:true,model:model.id}
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
        update({phase:signal.aborted?'cancelled':'error',error:signal.aborted?'已取消下载或验证':brief(error),model:id})
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
    if(task)throw Error('本地模型任务进行中，暂不能删除')
    update({phase:'deleting',model:id,error:''})
    try{
      await request('/api/delete',{method:'DELETE',body:{model:model.ollama}})
      checked.delete(id);update({phase:'idle',percent:0,model:'',error:''})
      return {ok:true,deleted:true}
    }catch(error){update({phase:'error',error:brief(error)});throw error}
  }
  return {list,start,cancel,remove,verifyId:async id=>{
    const model=getLocalVisionModel(id)
    if(!model)throw Error('不支持的本地视觉模型')
    if(task||PHASES.has(progress.phase))throw Error('已有本地视觉模型任务正在执行')
    try{return await verify(model)}
    catch(error){checked.delete(id);update({phase:'error',model:id,error:brief(error)});throw error}
  },progress:()=>({...progress})}
}
