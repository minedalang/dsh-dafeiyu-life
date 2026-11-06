/**
 * Phase 6i/6j: additional cross-process, per-source write barrier for LEGACY social sends.
 * It does not select a decision maker or replace a platform receipt. A write which
 * may have reached Bilibili is permanently non-replayable without offline review.
 * No raw account, UID, source key, conversation, draft or platform receipt is stored.
 */
import {createHash} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,openSync,writeSync,fsyncSync,closeSync,renameSync,rmSync,rmdirSync} from 'node:fs'
import {join} from 'node:path'

const ACCOUNT=/^[a-f0-9]{16}$/
const CHANNELS=new Set(['dm','comment'])
const STATES=new Set(['prepared','attempted','confirmed','uncertain'])
const ROOT='social-send-transactions'
const sha=s=>createHash('sha256').update(s).digest('hex')
const scopeId=s=>sha('social-send-scope-v1\0'+s).slice(0,24)
const eventId=(s,c,k)=>sha('social-send-event-v1\0'+s+'\0'+c+'\0'+k)
function safeDir(p){
  if(!existsSync(p))return false
  const st=lstatSync(p)
  if(!st.isDirectory()||st.isSymbolicLink())throw Error('unsafe transaction directory')
  return true
}
function safeFile(p){
  if(!existsSync(p))return false
  const st=lstatSync(p)
  if(!st.isFile()||st.isSymbolicLink()||st.size>2048)throw Error('unsafe transaction record')
  return true
}
function writeDurable(file,obj,{create=false}={}){
  const path=create?file:file+'.tmp-'+process.pid+'-'+Math.random().toString(16).slice(2)
  let fd
  try{
    fd=openSync(path,'wx',0o600)
    writeSync(fd,JSON.stringify(obj)+'\n')
    fsyncSync(fd)
  }finally{if(fd!==undefined)closeSync(fd)}
  if(!create){renameSync(path,file)}
}
const alive=pid=>{
  if(!Number.isSafeInteger(pid)||pid<=0)return true
  try{process.kill(pid,0);return true}catch(e){return e?.code!=='ESRCH'}
}
const safeKey=k=>typeof k==='string'&&k.length>=3&&k.length<=300&&!/[\u0000-\u001f]/.test(k)

export function createSocialSendTransaction({dataDir,getAccountTag,now=Date.now}={}){
  if(typeof dataDir!=='string'||!dataDir||typeof getAccountTag!=='function')
    throw TypeError('social transaction requires a state directory and trusted account provider')
  const root=join(dataDir,ROOT)
  const account=()=>String(getAccountTag()||'')
  const validate=(channel,eventKey,expectedScope)=>{
    if(!CHANNELS.has(channel))return {ok:false,reason:'unsupported-social-channel'}
    if(!safeKey(eventKey))return {ok:false,reason:'missing-stable-social-source'}
    const scope=account()
    if(!ACCOUNT.test(scope))return {ok:false,reason:'account-scope-unavailable'}
    if(expectedScope!==undefined&&scope!==expectedScope)return {ok:false,reason:'account-changed'}
    return {ok:true,scope}
  }
  const paths=(s,c,k)=>{
    const id=eventId(s,c,k)
    const base=join(root,scopeId(s),c)
    const dir=join(base,id)
    return {id,base,dir,file:join(dir,'state.json')}
  }
  const ensure=(s,c)=>{
    for(const dir of [dataDir,root,join(root,scopeId(s)),join(root,scopeId(s),c)]){
      if(!safeDir(dir))mkdirSync(dir,{mode:0o700})
    }
  }
  const parse=(file,id,channel)=>{
    if(!safeFile(file))return null
    const r=JSON.parse(readFileSync(file,'utf8'))
    if(r?.version!==1||r.id!==id||r.channel!==channel||!STATES.has(r.state)||
       !Number.isSafeInteger(r.at)||r.at<1||
       (r.state==='confirmed'&&!/^[a-f0-9]{64}$/.test(r.receiptHash||'')))throw Error('invalid transaction record')
    return r
  }
  // `send` is the EXISTING policy-gated platform adapter. This wrapper MUST
  // be called after the original permission checks and immediately before it.
  const execute=async({channel,eventKey,expectedScope}={},send)=>{
    const bound=validate(channel,eventKey,expectedScope)
    if(!bound.ok)return {ok:false,no_retry:true,reason:bound.reason,error:'社交发送事务身份或来源校验未通过：'+bound.reason}
    if(typeof send!=='function')return {ok:false,no_retry:true,reason:'no-platform-adapter'}
    const {scope}=bound,{id,dir,file}=paths(scope,channel,eventKey)
    try{
      ensure(scope,channel)
      try{mkdirSync(dir,{mode:0o700})}
      catch(e){if(e?.code==='EEXIST')return {ok:false,no_retry:true,reason:'social-send-already-reserved',error:'该消息已有发送事务（已完成或结果待复核），禁止重复发送'};throw e}
    }catch{return {ok:false,no_retry:true,reason:'social-transaction-storage-unsafe',error:'发送事务存储不可用，停止发送'}}
    let state={version:1,id,channel,state:'prepared',at:now(),pid:process.pid}
    try{
      // If this write is interrupted, the opaque directory remains a lock.
      writeDurable(file,state,{create:true})
      if(account()!==scope)return {ok:false,no_retry:true,reason:'account-changed'}
      state={...state,state:'attempted',attemptAt:now()}
      writeDurable(file,state)
    }catch{return {ok:false,no_retry:true,reason:'social-transaction-preflight-incomplete',error:'发送前事务占位未能持久化，未调用平台'}}
    // From here onwards every thrown exception, timeout or missing receipt is
    // an UNKNOWN outcome. Never retry even if the adapter claims an error.
    try{
      const result=await send()
      const receipt=channel==='dm'?String(result?.receiptId||''):String(result?.rpid||result?.rpid_str||'')
      const verified=channel==='dm'?receipt.length>0&&receipt.length<=160:
        /^\d{1,20}$/.test(receipt)&&receipt!=='0'
      if(result?.ok!==true||!verified){
        try{writeDurable(file,{...state,state:'uncertain',finishedAt:now()})}catch{}
        return {ok:false,no_retry:true,reason:'social-send-result-uncertain',error:'发送结果或平台回执不确定，禁止自动重试'}
      }
      // The receipt is hashed, NEVER recorded in plaintext, and is not itself
      // authorization to let Life Agent or another processor take ownership.
      writeDurable(file,{...state,state:'confirmed',receiptHash:sha('receipt\0'+receipt),finishedAt:now()})
      if(account()!==scope)return {ok:false,no_retry:true,reason:'account-changed-after-send',error:'发送后账号变化；已有平台回执，不可重发'}
      return result
    }catch{
      try{writeDurable(file,{...state,state:'uncertain',finishedAt:now()})}catch{}
      return {ok:false,no_retry:true,reason:'social-send-result-uncertain',error:'社交发送调用或回执持久化失败，结果待核实，禁止自动重试'}
    }
  }
  // Read-only aggregate. An unreadable directory is never auto removed.
  const inspect=()=>{
    const s=account()
    if(!ACCOUNT.test(s))return {ok:true,accountReady:false,mode:'legacy-write-guard',channels:{dm:{},comment:{}},lifeSocialEnabled:false}
    const channels={}
    try{
      safeDir(dataDir)
      if(safeDir(root))safeDir(join(root,scopeId(s)))
      for(const c of CHANNELS){
        const counts={confirmed:0,uncertain:0,incomplete:0,attempted:0}
        const dir=join(root,scopeId(s),c)
        if(safeDir(dir))for(const id of readdirSync(dir)){
          if(!/^[a-f0-9]{64}$/.test(id)){counts.incomplete++;continue}
          try{
            const entry=join(dir,id)
            if(!safeDir(entry)){counts.incomplete++;continue}
            const state=parse(join(entry,'state.json'),id,c)?.state
            if(state==='confirmed')counts.confirmed++
            else if(state==='uncertain')counts.uncertain++
            else if(state==='attempted')counts.attempted++
            else counts.incomplete++
          }catch{counts.incomplete++}
        }
        channels[c]=counts
      }
      return {ok:true,accountReady:true,mode:'legacy-write-guard',channels,lifeSocialEnabled:false}
    }catch{return {ok:false,reason:'social-transaction-storage-unsafe',lifeSocialEnabled:false}}
  }
  // This cannot resolve any attempted or uncertain platform send. A preparatory
  // record may only be removed after the original process has exited AND an
  // offline operator independently confirms the adapter was never entered.
  const reviewNoAttempt=({channel,eventKey,expectedScope,confirmation}={})=>{
    if(confirmation!=='我已停机核实此消息从未开始平台发送')return {ok:false,reason:'explicit-no-attempt-confirmation-required'}
    const bound=validate(channel,eventKey,expectedScope)
    if(!bound.ok)return bound
    try{
      const {id,dir,file}=paths(bound.scope,channel,eventKey)
      if(!safeDir(dir)||!safeFile(file))return {ok:false,reason:'transaction-incomplete-or-missing'}
      const row=parse(file,id,channel)
      if(row?.state!=='prepared')return {ok:false,reason:'platform-attempt-cannot-be-cleared'}
      if(alive(row.pid))return {ok:false,reason:'transaction-process-still-alive'}
      rmSync(file);rmdirSync(dir)
      return {ok:true,released:true,reason:'operator-verified-no-platform-attempt'}
    }catch{return {ok:false,reason:'transaction-review-required'}}
  }
  return {execute,inspect,reviewNoAttempt}
}
