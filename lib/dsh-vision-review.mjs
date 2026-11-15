/**
 * Model-scoped, one-shot manual review for the exact DSH mascot probe.
 * Does not grant Bilibili writes; no model-derived auto-approval.
 */
import {randomUUID} from 'node:crypto'

const defaultDiagnostics = route => ({
  route: {
    status: route?.complete ? (route?.headlessVerified ? 'verified' : 'not_verified') : 'missing',
    provider: String(route?.provider||''), model: String(route?.model||''),
    api: String(route?.api||''), imageInputDeclared: route?.imageInputDeclared ?? null,
    reasoningEfforts: Array.isArray(route?.reasoningEfforts)?route.reasoningEfforts:null,
  },
  mcpImage: {status:'not_run'},
  attachmentBridge: {status:'not_observable',note:'插件无法读取 DSH 内部附件桥接的独立回执；需结合模型回答人工判断'},
  providerApi: {status:'not_run'},
  modelAnswer: {status:'not_run'},
})
const mergeDiagnostics = (route, supplied={}) => {
  const base=defaultDiagnostics(route)
  const out={...base}
  for(const key of ['route','mcpImage','attachmentBridge','providerApi','modelAnswer']){
    const value=supplied?.[key]
    if(value&&typeof value==='object'&&!Array.isArray(value))out[key]={...out[key],...value}
  }
  out.route={...base.route,...(supplied?.route||{})}
  return out
}

export function createDshVisionReview({getRoute,probe}={}){
  if(typeof getRoute!=='function'||typeof probe!=='function')throw TypeError('DSH probe requires route and executor')
  let record=null,verifiedKey='',busy=false
  const route=()=>{try{return getRoute()||{}}catch{return {}}}
  const key=()=>JSON.stringify(route())
  const status=()=>{
    const currentRoute=route(),routeKey=JSON.stringify(currentRoute)
    if(record&&record.routeKey!==routeKey)return {
      status:'route_changed',verified:false,answer:'',error:'视觉 Provider / 模型或实际路由配置已变更，请重新识图',
      route:currentRoute,diagnostics:mergeDiagnostics(currentRoute),
    }
    return record?{...record,route:currentRoute,verified:record.status==='approved'&&verifiedKey===routeKey}:
      {status:'idle',verified:false,answer:'',error:'',route:currentRoute,diagnostics:mergeDiagnostics(currentRoute)}
  }
  async function verify(){
    if(busy)throw Error('DSH 图片验收正在进行，请稍后重试')
    busy=true;verifiedKey=''
    const currentRoute=route(),routeKey=JSON.stringify(currentRoute)
    record={status:'running',routeKey,route:currentRoute,diagnostics:mergeDiagnostics(currentRoute),
      reviewId:randomUUID(),answer:'',error:'',startedAt:new Date().toISOString()}
    try{
      const result=await probe()
      if(!result?.ok){
        const error=Error(String(result?.error||'未得到真实图片识别回复'))
        error.status=String(result?.status||'probe_failed')
        error.diagnosticCode=String(result?.diagnosticCode||'')
        error.diagnostics=result?.diagnostics||{}
        throw error
      }
      if(key()!==routeKey)throw Error('验证期间视觉模型配置发生变化，结果已作废')
      if(!String(result.answer||'').trim())throw Error('未得到真实图片识别回复')
      record={...record,status:'awaiting_review',answer:String(result.answer),
        diagnostics:mergeDiagnostics(currentRoute,result.diagnostics),finishedAt:new Date().toISOString()}
      return {ok:true,awaitingReview:true,reviewId:record.reviewId,diagnostics:record.diagnostics}
    }catch(error){
      const diagnostics=mergeDiagnostics(currentRoute,error?.diagnostics)
      record={...record,status:'failed',answer:'',error:String(error?.message||error).slice(0,400),
        diagnosticCode:String(error?.diagnosticCode||''),diagnostics,finishedAt:new Date().toISOString()}
      throw error
    }finally{busy=false}
  }
  function review({reviewId,accepted}={}){
    if(busy)throw Error('图片识别尚未结束')
    if(typeof accepted!=='boolean')throw Error('需要明确认可或否决')
    if(!record||record.status!=='awaiting_review'||reviewId!==record.reviewId||record.routeKey!==key())
      throw Error('当前识图结果不匹配或已失效，请重新识图')
    record={...record,status:accepted?'approved':'rejected',reviewedAt:new Date().toISOString()}
    verifiedKey=accepted?key():''
    return {ok:true,verified:accepted}
  }
  return {status,verify,review,clear(){record=null;verifiedKey=''},isVerified(){return status().verified}}
}
