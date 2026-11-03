/**
 * Shared, account-scoped budget for background Bilibili read calls.
 * This is deliberately a local safety guard, NOT an assertion of a platform quota.
 * Pending requests are counted at dispatch, including network failures; rate-limit
 * responses trigger exponential cooldown. Nothing here grants a write permission.
 */
import {readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync} from 'node:fs'
import {join,dirname} from 'node:path'

const WINDOW_MIN=60_000,WINDOW_HOUR=60*60_000
const clamp=(n,min,max,fallback)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Math.floor(Number(n)))):fallback
const restricted=error=>{
  const text=String(error?.message||error||'').slice(0,300)
  return /(?:HTTP\s*(?:403|412|429)|(?:code|错误码)\s*[=:：]?\s*-?(?:352|412|429)|rate\s*limit|too\s*many\s*requests|请求过于频繁|请求频繁|风控|验证码|访问被拒绝)/i.test(text)
}
export class BiliReadDeferredError extends Error {
  constructor(reason,retryAt){super(`B站后台读取已暂停（${reason}），下次最早尝试：${new Date(retryAt).toLocaleString()}`);this.name='BiliReadDeferredError';this.reason=reason;this.retryAt=retryAt}
}
export function createBiliReadBudget({dataDir,now=Date.now,minuteLimit=30,hourLimit=450,logger=console}={}){
  if(!dataDir)throw TypeError('read budget dataDir required')
  const file=join(dataDir,'bili-read-budget.json')
  const min=clamp(minuteLimit,5,180,30),hour=clamp(hourLimit,min,6000,450)
  let db={version:1,attempts:[],blockedUntil:0,backoffCount:0,lastReason:'',lastErrorAt:0}
  try{
    const json=JSON.parse(readFileSync(file,'utf8'))
    if(json?.version!==1||!Array.isArray(json.attempts)||json.attempts.length>10000||
       !Number.isSafeInteger(json.blockedUntil)||!Number.isInteger(json.backoffCount))throw Error('format')
    db={...db,...json,attempts:json.attempts.filter(x=>Number.isSafeInteger(x?.at)&&typeof x?.kind==='string')}
  }catch(e){if(e.code!=='ENOENT')throw Error('B站后台请求预算账本损坏，已暂停后台读取，不会清空限流记录')}
  const keep=()=>{const t=now();db.attempts=db.attempts.filter(x=>x.at>t-WINDOW_HOUR&&x.at<=t+60_000).slice(-6000)}
  const save=()=>{
    mkdirSync(dirname(file),{recursive:true,mode:0o700})
    const tmp=file+'.'+process.pid+'.tmp'
    try{writeFileSync(tmp,JSON.stringify(db)+'\n',{mode:0o600});renameSync(tmp,file)}
    finally{try{unlinkSync(tmp)}catch{}}
  }
  const retryAt=()=>{
    keep();const t=now(),recent=db.attempts.filter(x=>x.at>t-WINDOW_MIN)
    const byMinute=recent.length>=min?recent[0]?.at+WINDOW_MIN:0
    const byHour=db.attempts.length>=hour?db.attempts[0]?.at+WINDOW_HOUR:0
    return {at:Math.max(db.blockedUntil,byMinute,byHour),reason:db.blockedUntil>t?'platform-cooldown':byMinute>t?'minute-budget':byHour>t?'hour-budget':''}
  }
  const acquire=kind=>{
    const pause=retryAt(),t=now()
    if(pause.at>t)throw new BiliReadDeferredError(pause.reason,pause.at)
    db.attempts.push({kind:String(kind||'read').slice(0,35),at:t});save()
    return true
  }
  const noteError=error=>{
    if(!restricted(error))return false
    db.backoffCount=Math.min(7,db.backoffCount+1)
    db.blockedUntil=Math.max(db.blockedUntil,now()+Math.min(30*60_000,60_000*2**(db.backoffCount-1)))
    db.lastReason='B站拒绝请求或要求验证';db.lastErrorAt=now();save()
    logger.warn?.('B站只读请求出现限流/验证信号，后台冷却到 '+new Date(db.blockedUntil).toLocaleString())
    return true
  }
  const noteSuccess=()=>{if(db.backoffCount>0&&now()>=db.blockedUntil){db.backoffCount=0;db.lastReason='';save()}}
  const guard=async(kind,task)=>{
    acquire(kind)
    try{
      const result=await task()
      const raw=typeof result==='string'?(()=>{try{return JSON.parse(result)}catch{return {}}})():result
      if(raw && (raw.code===-412||raw.code===-352||raw.code===429||raw.status===403||raw.status===429||raw.status===412||
        (typeof raw.error==='string'&&restricted(raw.error))))
        noteError(Error('code='+raw.code+' HTTP '+raw.status+' '+String(raw.error||'').slice(0,120)))
      else noteSuccess()
      return result
    }catch(e){noteError(e);throw e}
  }
  const status=()=>{
    const t=now(),pause=retryAt(),groups=new Map()
    for(const attempt of db.attempts){
      const row=groups.get(attempt.kind)||{kind:attempt.kind,minute:0,hour:0}
      row.hour++
      if(attempt.at>t-WINDOW_MIN)row.minute++
      groups.set(attempt.kind,row)
    }
    const byKind=[...groups.values()].sort((a,b)=>b.hour-a.hour||a.kind.localeCompare(b.kind)).slice(0,40)
    return {minuteLimit:min,hourLimit:hour,minuteUsed:db.attempts.filter(x=>x.at>t-WINDOW_MIN).length,
      hourUsed:db.attempts.length,byKind,blocked:pause.at>t,reason:pause.reason,retryAt:pause.at>t?pause.at:0,
      backoffCount:db.backoffCount,lastErrorAt:db.lastErrorAt,lastReason:db.lastReason,
      note:'只统计已接入的后台只读接口；不代表 B站官方配额或插件所有请求'}
  }
  return {acquire,noteError,noteSuccess,guard,status}
}
