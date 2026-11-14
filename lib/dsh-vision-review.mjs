/**
 * Model-scoped, one-shot manual review for the exact DSH mascot probe.
 * Does not grant Bilibili writes; no model-derived auto-approval.
 */
import {randomUUID} from 'node:crypto'
export function createDshVisionReview({getRoute,probe}={}){
  if(typeof getRoute!=='function'||typeof probe!=='function')throw TypeError('DSH probe requires route and executor')
  let record=null,verifiedKey='',busy=false
  const key=()=>JSON.stringify(getRoute())
  const status=()=>{
    const routeKey=key()
    if(record&&record.routeKey!==routeKey)return {status:'route_changed',verified:false,answer:'',error:'视觉 Provider / 模型已变更，请重新识图'}
    return record?{...record,verified:record.status==='approved'&&verifiedKey===routeKey}:{status:'idle',verified:false,answer:'',error:''}
  }
  async function verify(){
    if(busy)throw Error('DSH 图片验收正在进行，请稍后重试')
    busy=true;verifiedKey=''
    const routeKey=key()
    record={status:'running',routeKey,reviewId:randomUUID(),answer:'',error:'',startedAt:new Date().toISOString()}
    try{
      const result=await probe()
      if(key()!==routeKey)throw Error('验证期间视觉模型配置发生变化，结果已作废')
      if(!result?.ok || !String(result.answer||'').trim())throw Error(String(result?.error||'未得到真实图片识别回复'))
      record={...record,status:'awaiting_review',answer:String(result.answer),finishedAt:new Date().toISOString()}
      return {ok:true,awaitingReview:true,reviewId:record.reviewId}
    }catch(error){record={...record,status:'failed',answer:'',error:String(error?.message||error).slice(0,400)};throw error}
    finally{busy=false}
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
