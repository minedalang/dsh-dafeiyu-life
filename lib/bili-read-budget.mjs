/**
 * Shared, account-scoped budget for background Bilibili read calls.
 * This is deliberately a local safety guard, NOT an assertion of a platform quota.
 * Pending requests are counted at dispatch, including network failures; rate-limit
 * responses trigger exponential cooldown. Nothing here grants a write permission.
 */
import {readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync,openSync,closeSync,statSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {classifyReadFailure} from './read-action-diagnostics.mjs'
import {withDurableFileLock} from './durable-file-lock.mjs'

const WINDOW_MIN=60_000,WINDOW_HOUR=60*60_000
const ADAPTIVE_DECAY_MS=6*60*60_000
const SOCIAL_INBOX_TOOLS=new Set(['social-unread','mcp:bili_unread_messages','mcp:bili_received_replies','mcp:bili_received_at_and_likes','mcp:bili_dynamic_reply_inbox'])
const SOCIAL_PROTECTION_MS=15*60_000 // Initial pause for low-priority notifications after any platform rate-limit
const SOCIAL_SLOW_MS=10*60_000 // Minimum per-notification endpoint during the 6-hour observation window
const clamp=(n,min,max,fallback)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Math.floor(Number(n)))):fallback
const restricted=error=>{
  const text=String(error?.message||error||'').slice(0,300)
  return /(?:HTTP\s*(?:403|412|429)|(?:code|错误码)\s*[=:：]?\s*-?(?:352|412|429|509)|rate\s*limit|too\s*many\s*requests|请求过于频繁|请求频繁|风控|验证码|访问被拒绝)/i.test(text)
}
export class BiliReadDeferredError extends Error {
  constructor(reason,retryAt){super(`B站后台读取已暂停（${reason}），下次最早尝试：${new Date(retryAt).toLocaleString()}`);this.name='BiliReadDeferredError';this.reason=reason;this.retryAt=retryAt}
}
export function createBiliReadBudget({dataDir,now=Date.now,minuteLimit=30,hourLimit=450,getLimits=()=>({}),schedule=null,logger=console}={}){
  if(!dataDir)throw TypeError('read budget dataDir required')
  const file=join(dataDir,'bili-read-budget.json')
  const lockFile=file+'.read-lock'
  const limits=()=>{
    const selected=getLimits()||{}
    const min=clamp(selected.minuteLimit??minuteLimit,5,180,30)
    return {min,hour:clamp(selected.hourLimit??hourLimit,min,6000,450)}
  }
  const empty=()=>({version:1,attempts:[],blockedUntil:0,backoffCount:0,lastReason:'',lastErrorAt:0,
    lastDmListAttemptAt:0,lastDmMessagesAttemptAt:0,dmListRateLevel:0,lastDmRateLimitAt:0,lastDmRateDecayAt:0,
    socialProtectionUntil:0,socialSafeUntil:0,lastReadAtByKind:{}})
  const parseLedger=(json)=>{
    if(json?.version!==1||!Array.isArray(json.attempts)||json.attempts.length>10000||
       !Number.isSafeInteger(json.blockedUntil)||!Number.isInteger(json.backoffCount))throw Error('format')
    return {...empty(),...json,attempts:json.attempts.filter(x=>Number.isSafeInteger(x?.at)&&typeof x?.kind==='string'),
      lastDmListAttemptAt:Number.isSafeInteger(json.lastDmListAttemptAt)?json.lastDmListAttemptAt:0,
      lastDmMessagesAttemptAt:Number.isSafeInteger(json.lastDmMessagesAttemptAt)?json.lastDmMessagesAttemptAt:0,
      socialProtectionUntil:Number.isSafeInteger(json.socialProtectionUntil)?json.socialProtectionUntil:0,
      socialSafeUntil:Number.isSafeInteger(json.socialSafeUntil)?json.socialSafeUntil:0,
      lastReadAtByKind:Object.fromEntries(Object.entries(json.lastReadAtByKind&&typeof json.lastReadAtByKind==='object'&&!Array.isArray(json.lastReadAtByKind)?json.lastReadAtByKind:{})
        .filter(([k,v])=>/^[a-z][a-z0-9:_-]{0,55}$/.test(k)&&Number.isSafeInteger(v)&&v>0).slice(0,60)),
      dmListRateLevel:clamp(json.dmListRateLevel,0,3,0),
      lastDmRateLimitAt:Number.isSafeInteger(json.lastDmRateLimitAt)?json.lastDmRateLimitAt:0,
      lastDmRateDecayAt:Number.isSafeInteger(json.lastDmRateDecayAt)?json.lastDmRateDecayAt:0}
  }
  let db=empty()
  const refresh=()=>{
    try{db=parseLedger(JSON.parse(readFileSync(file,'utf8')))}
    catch(e){if(e.code==='ENOENT'){db=empty();return}
      throw Error('B站后台请求预算账本损坏，已暂停后台读取，不会清空限流记录')}
  }
  refresh()
  // Atomic lock keeps two hosts from consuming the same token or clobbering
  // each other's cooldown. It is held only for short synchronous JSON writes,
  // never around an HTTP request or a model call.
  const withLedgerLock=fn=>{
    mkdirSync(dirname(file),{recursive:true,mode:0o700})
    try{return withDurableFileLock(lockFile,()=>{refresh();return fn()},{now})}
    catch(error){
      if(error?.code==='LEDGER_BUSY')throw new BiliReadDeferredError('ledger-busy',now()+5_000)
      throw error
    }
  }

  const keep=()=>{const t=now();db.attempts=db.attempts.filter(x=>x.at>t-WINDOW_HOUR&&x.at<=t+60_000).slice(-6000)}
  const save=()=>{
    mkdirSync(dirname(file),{recursive:true,mode:0o700})
    const tmp=file+'.'+process.pid+'.tmp'
    try{writeFileSync(tmp,JSON.stringify(db)+'\n',{mode:0o600});renameSync(tmp,file)}
    finally{try{unlinkSync(tmp)}catch{}}
  }
  const retryAt=()=>{
    keep();const t=now(),recent=db.attempts.filter(x=>x.at>t-WINDOW_MIN)
    const {min,hour}=limits()
    const byMinute=recent.length>=min?recent[0]?.at+WINDOW_MIN:0
    const byHour=db.attempts.length>=hour?db.attempts[0]?.at+WINDOW_HOUR:0
    return {at:Math.max(db.blockedUntil,byMinute,byHour),reason:db.blockedUntil>t?'platform-cooldown':byMinute>t?'minute-budget':byHour>t?'hour-budget':''}
  }
  const dmListIntervalMs=()=>[5,10,20,30][db.dmListRateLevel]*60_000
  const dmListNextAt=()=>{
    const persisted=Math.max(0,db.lastDmListAttemptAt||0)
    const old=Math.max(0,...db.attempts.filter(x=>x.kind==='dm-list').map(x=>x.at))
    const last=Math.max(persisted,old,Number(db.lastDmRateLimitAt)||0)
    return last?last+dmListIntervalMs():0
  }
  const dmUnreadNextAt=()=>{
    const last=Math.max(Number(db.lastReadAtByKind['dm-unread'])||0,
      ...db.attempts.filter(x=>x.kind==='dm-unread').map(x=>x.at),0)
    return last?last+dmListIntervalMs():0
  }
  const socialUnreadNextAt=()=>{
    const last=Math.max(Number(db.lastReadAtByKind['social-unread'])||0,
      ...db.attempts.filter(x=>x.kind==='social-unread').map(x=>x.at),0)
    return Math.max(last?last+5*60_000:0,socialNextAt('social-unread'))
  }
  const socialNextAt=kind=>{
    if(!SOCIAL_INBOX_TOOLS.has(kind))return 0
    const t=now()
    if(db.socialSafeUntil<=t)return 0
    // Each notification endpoint may do one cautious probe after the initial
    // account-level pause, but cannot burst repeatedly across host restarts.
    const last=Math.max(Number(db.lastReadAtByKind[kind])||0,
      ...db.attempts.filter(x=>x.kind===kind).map(x=>x.at),0)
    return Math.max(db.socialProtectionUntil,last?last+SOCIAL_SLOW_MS:0)
  }
  const acquire=kind=>withLedgerLock(()=>{
    const pause=retryAt(),t=now(),endpoint=String(kind||'read').slice(0,35)
    if(pause.at>t)throw new BiliReadDeferredError(pause.reason,pause.at)
    if(endpoint==='dm-list'&&dmListNextAt()>t)
      throw new BiliReadDeferredError('dm-list-interval',dmListNextAt())
    if(endpoint==='dm-unread'&&dmUnreadNextAt()>t)
      throw new BiliReadDeferredError('dm-unread-interval',dmUnreadNextAt())
    if(endpoint==='social-unread'&&socialUnreadNextAt()>t)
      throw new BiliReadDeferredError('social-unread-interval',socialUnreadNextAt())
    const socialAt=socialNextAt(endpoint)
    if(socialAt>t)throw new BiliReadDeferredError('social-rate-protection',socialAt)
    db.attempts.push({kind:endpoint,at:t})
    if(endpoint==='dm-list')db.lastDmListAttemptAt=t
    if(endpoint==='dm-messages')db.lastDmMessagesAttemptAt=t
    // Record only endpoint names/times: no account identifiers, recipients or
    // private text. Recent per-kind snapshots survive attempt-window pruning.
    if(endpoint==='dm-list'||endpoint==='dm-messages'||endpoint==='dm-unread'||SOCIAL_INBOX_TOOLS.has(endpoint))
      db.lastReadAtByKind[endpoint]=t
    save()
    return true
  })
  const noteError=(error,kind='')=>{
    if(!restricted(error))return false
    return withLedgerLock(()=>{
      db.backoffCount=Math.min(7,db.backoffCount+1)
      db.lastRateLimitKind=String(kind||'').slice(0,35)
      // Do not let comment/@ notifications resume at their old 2-minute
      // frequency immediately after a DM -509. The long observation window
      // only reduces polling, it does not block urgent send preflight reads.
      db.socialProtectionUntil=Math.max(db.socialProtectionUntil,now()+SOCIAL_PROTECTION_MS)
      db.socialSafeUntil=Math.max(db.socialSafeUntil,now()+ADAPTIVE_DECAY_MS)
      db.blockedUntil=Math.max(db.blockedUntil,now()+Math.min(30*60_000,5*60_000*2**(db.backoffCount-1)))
      if(['dm-list','dm-messages','dm-unread'].includes(db.lastRateLimitKind)){
        db.dmListRateLevel=Math.min(3,db.dmListRateLevel+1)
        db.lastDmRateLimitAt=now()
        db.lastDmRateDecayAt=0
      }
      db.lastReason='B站拒绝请求或要求验证';db.lastErrorAt=now();save()
      logger.warn?.('B站只读请求出现限流/验证信号，后台冷却到 '+new Date(db.blockedUntil).toLocaleString())
      return true
    })
  }
  const noteSuccess=(kind='')=>withLedgerLock(()=>{
    // A success from an unrelated endpoint cannot clear the last restricted
    // endpoint, nor prematurely erase the independent 6h adaptive read floor.
    const endpoint=String(kind||'').slice(0,35)
    let changed=false
    if(endpoint==='dm-list'&&db.dmListRateLevel>0&&
       now()-Math.max(db.lastDmRateLimitAt,db.lastDmRateDecayAt)>=ADAPTIVE_DECAY_MS){
      db.dmListRateLevel--
      db.lastDmRateDecayAt=now()
      changed=true
    }
    const dmClass=k=>['dm-list','dm-messages','dm-unread'].includes(k)
    const socialClass=k=>SOCIAL_INBOX_TOOLS.has(k)
    const sameProtectedClass=!endpoint||!db.lastRateLimitKind||db.lastRateLimitKind===endpoint||
      (dmClass(db.lastRateLimitKind)&&dmClass(endpoint))||
      (socialClass(db.lastRateLimitKind)&&socialClass(endpoint))
    if(db.backoffCount>0&&now()>=db.blockedUntil&&sameProtectedClass){
      db.backoffCount=0;db.lastReason='';db.lastRateLimitKind='';changed=true
    }
    if(changed)save()
  })
  const rawGuard=async(kind,task)=>{
    acquire(kind)
    try{
      const result=await task()
      const raw=typeof result==='string'?(()=>{try{return JSON.parse(result)}catch{return {}}})():result
      const rejected=classifyReadFailure(raw)
      if(rejected.code==='account-auth'){
        // A login failure is not a model's choice or a read receipt. Repeated
        // background inbox polls should not hit the same invalid credential
        // every two minutes. Manual relogin remains possible independently.
        withLedgerLock(()=>{db.blockedUntil=Math.max(db.blockedUntil,now()+15*60_000)
          db.lastReason='B站登录态需要检查';db.lastErrorAt=now();save()})
      }else if(rejected.code==='platform-rate-limit'){
        // Typed Python errors deliberately omit all raw platform prose. The
        // failure category itself must still trigger the existing cooldown.
        noteError(new Error('rate limit'),kind)
      }else if(raw && (raw.code===-412||raw.code===-352||raw.code===-509||raw.code===429||raw.status===403||raw.status===429||raw.status===412||
        (typeof raw.error==='string'&&restricted(raw.error))))
        noteError(Error('code='+raw.code+' HTTP '+raw.status+' '+String(raw.error||'').slice(0,120)),kind)
      else if(!rejected.failed)noteSuccess(kind)
      return result
    }catch(e){noteError(e,kind);throw e}
  }
  // Schedule BEFORE consuming a platform request token. The scheduler is
  // never allowed to erase cooldowns, reinterpret -509, or write receipts.
  const admitted=(kind,task)=>typeof schedule==='function'?schedule(kind,task):task()
  const guard=(kind,task)=>admitted(kind,()=>rawGuard(kind,task))
  const status=()=>{
    refresh()
    const t=now(),pause=retryAt(),groups=new Map()
    const {min,hour}=limits()
    for(const attempt of db.attempts){
      const row=groups.get(attempt.kind)||{kind:attempt.kind,minute:0,hour:0}
      row.hour++
      if(attempt.at>t-WINDOW_MIN)row.minute++
      groups.set(attempt.kind,row)
    }
    const byKind=[...groups.values()].sort((a,b)=>b.hour-a.hour||a.kind.localeCompare(b.kind)).slice(0,40)
    const socialEndpoints=Object.fromEntries([...SOCIAL_INBOX_TOOLS].map(kind=>[kind,socialNextAt(kind)>t?socialNextAt(kind):0]))
    return {minuteLimit:min,hourLimit:hour,minuteUsed:db.attempts.filter(x=>x.at>t-WINDOW_MIN).length,
      hourUsed:db.attempts.length,byKind,blocked:pause.at>t,reason:pause.reason,retryAt:pause.at>t?pause.at:0,
      backoffCount:db.backoffCount,lastErrorAt:db.lastErrorAt,lastReason:db.lastReason,lastRateLimitKind:db.lastRateLimitKind||'',
      dmListNextAt:dmListNextAt()>t?dmListNextAt():0,dmListIntervalMinutes:dmListIntervalMs()/60_000,
      dmUnreadNextAt:dmUnreadNextAt()>t?dmUnreadNextAt():0,
      socialUnreadNextAt:socialUnreadNextAt()>t?socialUnreadNextAt():0,
      lastReadAtByKind:{...db.lastReadAtByKind},
      dmListRateLevel:db.dmListRateLevel,lastDmRateLimitAt:db.lastDmRateLimitAt,
      lastDmListAttemptAt:db.lastDmListAttemptAt,lastDmMessagesAttemptAt:db.lastDmMessagesAttemptAt,
      socialSafeUntil:db.socialSafeUntil>t?db.socialSafeUntil:0,
      socialProtectionUntil:db.socialProtectionUntil>t?db.socialProtectionUntil:0,
      socialEndpoints,
      note:'只统计已接入的后台只读接口；不代表 B站官方配额或插件所有请求'}
  }
  return {acquire,noteError,noteSuccess,guard,schedule:admitted,status}
}
