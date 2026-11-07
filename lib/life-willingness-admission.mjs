/**
 * 2.7.1-dev.9: cross-process Life decision admission, NOT a sender or a
 * replayable task queue. Keeps only a hashed account scope, opaque claim token,
 * state and timing. A crash / unknown execution outcome must NOT silently free
 * another process to decide or send: expired approved claims require offline review; pre-approval consideration may
 * be recovered only after the original process is confirmed dead and TTL elapsed.
 */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,readFileSync,writeFileSync,renameSync} from 'node:fs'
import {join} from 'node:path'
import {withLifeWillingnessLedgerLock} from './life-planner-atomic.mjs'

const FILE='life-willingness-admission.json',MAX=32_768,TTL=10*60_000
const SCOPE=/^[a-f0-9]{16}$/
const keyFor=scope=>createHash('sha256').update('dsh-life-admission-v1\0'+scope).digest('hex').slice(0,32)
const uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x)
const storageError=()=>({ok:false,reason:'life-admission-storage-unavailable'})
function read(dataDir){
  const path=join(dataDir,FILE)
  if(!existsSync(path))return {version:1,claims:{},settled:{}}
  const stat=lstatSync(path)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX)throw Error('life-admission-unsafe')
  const value=JSON.parse(readFileSync(path,'utf8'))
  if(value?.version!==1||!value.claims||!value.settled||Array.isArray(value.claims)||Array.isArray(value.settled)||
    typeof value.claims!=='object'||typeof value.settled!=='object'||Object.keys(value.claims).length>64||Object.keys(value.settled).length>64)throw Error('life-admission-invalid')
  for(const [key,c] of Object.entries(value.claims)){
    if(!/^[a-f0-9]{32}$/.test(key)||!uuid(c?.token)||!['considering','approved'].includes(c?.stage)||
      !Number.isSafeInteger(c.at)||!Number.isSafeInteger(c.until)||c.until<=c.at||
      !Number.isSafeInteger(c.pid)||c.pid<1)throw Error('life-admission-invalid-claim')
  }
  for(const [key,at] of Object.entries(value.settled))if(!/^[a-f0-9]{32}$/.test(key)||!Number.isSafeInteger(at)||at<0)throw Error('life-admission-invalid-settled')
  return value
}
function write(dataDir,row){
  const path=join(dataDir,FILE),tmp=path+'.'+process.pid+'.'+randomUUID()+'.tmp'
  if(existsSync(path)){const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink())throw Error('life-admission-unsafe')}
  const text=JSON.stringify(row,null,2)+'\n'
  if(Buffer.byteLength(text)>MAX)throw Error('life-admission-capacity')
  writeFileSync(tmp,text,{flag:'wx',mode:0o600});renameSync(tmp,path)
}
const pidAlive=pid=>{try{process.kill(pid,0);return true}catch(error){return error?.code!=='ESRCH'}}
export function createLifeWillingnessAdmission({dataDir,now=Date.now,cooldownMs=0}={}){
  if(!dataDir)throw TypeError('life admission dataDir required')
  const operation=fn=>{
    try{
      const res=withLifeWillingnessLedgerLock(dataDir,fn,{now})
      return res?.ok===false?res:res
    }catch{return storageError()}
  }
  function acquire(scope){
    if(!SCOPE.test(String(scope||'')))return {ok:false,reason:'life-account-unavailable'}
    return operation(()=>{
      const row=read(dataDir),key=keyFor(scope),previous=row.claims[key]
      // A crashed *consideration* cannot have a platform proof: only an approved
      // record can authorize an action. After the full TTL and confirmed dead
      // PID, it is safe to recover this pre-approval phase atomically.
      // Approved/unknown claims NEVER expire into a new permission.
      const abandoned=Boolean(previous&&previous.stage==='considering'&&previous.until<=now()&&!pidAlive(previous.pid))
      if(previous&&!abandoned)return {ok:false,reason:previous.until<=now()?'life-choice-review-required':'life-choice-in-progress',needsReview:previous.until<=now()}
      if(abandoned)delete row.claims[key]
      const last=Number(row.settled[key]||0)
      if(cooldownMs>0&&last>0&&now()>=last&&now()-last<cooldownMs)
        return {ok:false,reason:'life-cross-channel-rest',notBefore:last+cooldownMs}
      const token=randomUUID()
      row.claims[key]={token,stage:'considering',at:now(),until:now()+TTL,pid:process.pid}
      write(dataDir,row)
      return {ok:true,token,until:now()+TTL,recoveredConsideration:abandoned}
    })
  }
  function approve(scope,token){
    return operation(()=>{
      const row=read(dataDir),claim=row.claims[keyFor(scope)]
      if(!claim||claim.token!==token)return {ok:false,reason:'life-choice-claim-lost'}
      if(claim.until<=now())return {ok:false,reason:'life-choice-review-required'}
      claim.stage='approved';write(dataDir,row)
      return {ok:true,until:claim.until}
    })
  }
  function check(scope,token){
    try{
      const claim=read(dataDir).claims[keyFor(scope)]
      return claim?.token===token&&claim.stage==='approved'&&claim.until>now()
    }catch{return false}
  }
  function settle(scope,token,{verified=false}={}){
    return operation(()=>{
      const row=read(dataDir),key=keyFor(scope),claim=row.claims[key]
      if(!claim||claim.token!==token)return {ok:false,reason:'life-choice-claim-lost'}
      delete row.claims[key]
      if(verified)row.settled[key]=now()
      // bounded per-account numeric cooldown; no UIDs or source texts
      const sorted=Object.entries(row.settled).sort((a,b)=>b[1]-a[1]).slice(0,64)
      row.settled=Object.fromEntries(sorted)
      write(dataDir,row)
      return {ok:true}
    })
  }
  function status(scope){
    if(!SCOPE.test(String(scope||'')))return {ok:false,reason:'life-account-unavailable'}
    try{
      const row=read(dataDir),claim=row.claims[keyFor(scope)]
      return {ok:true,held:Boolean(claim),needsReview:Boolean(claim&&claim.until<=now()),stage:claim?.stage||'idle',lastVerifiedAt:row.settled[keyFor(scope)]||0}
    }catch{return storageError()}
  }
  return {acquire,approve,check,settle,status}
}
/** Offline-only recovery, after all DSH instances have been stopped and the
 * administrator has checked the last unknown platform transaction. */
export function recoverLifeWillingnessOffline({dataDir,scope,confirmedAllStopped=false,platformTransactionReviewed=false}={}){
  if(!dataDir||!SCOPE.test(String(scope||''))||!confirmedAllStopped||!platformTransactionReviewed)
    return {ok:false,reason:'explicit-offline-review-required'}
  try{
    return withLifeWillingnessLedgerLock(dataDir,()=>{
      const row=read(dataDir),key=keyFor(scope),claim=row.claims[key]
      if(!claim)return {ok:true,removed:false}
      if(pidAlive(claim.pid))return {ok:false,reason:'life-choice-owner-may-be-running'}
      delete row.claims[key];write(dataDir,row)
      return {ok:true,removed:true}
    })
  }catch{return storageError()}
}
