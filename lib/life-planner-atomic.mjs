/**
 * Life Planner local-disk coordination (all accounts share one daily model
 * budget). These directories are atomic on the same NTFS/POSIX filesystem.
 * They are NOT distributed locks for a network filesystem. A process crash
 * leaves a claim in place: no automatic stale-timeout unlock or quota refund.
 * No UID, account tag, prompt, task ID or other private value is written here.
 */
import {randomUUID} from 'node:crypto'
import {closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,rmdirSync,unlinkSync,writeSync} from 'node:fs'
import {join} from 'node:path'

const NAME=/^(?:autonomous-planner-(?:ledger|run)|life-agent-events-ledger|life-opportunities-ledger)\.lock$/
const readStat=p=>{try{return lstatSync(p)}catch(e){if(e?.code==='ENOENT')return null;throw e}}
const safeDirectory=p=>{const st=readStat(p);if(!st||!st.isDirectory()||st.isSymbolicLink())throw Error('planner-storage-unsafe')}
const alive=pid=>{
  if(!Number.isSafeInteger(pid)||pid<1)return true
  try{process.kill(pid,0);return true}catch(e){return e?.code!=='ESRCH'}
}
function inspectClaim(dir,name){
  const path=join(dir,name)
  const stat=readStat(path)
  if(!stat)return {held:false,needsReview:false}
  if(!stat.isDirectory()||stat.isSymbolicLink())return {held:true,needsReview:true,reason:'unsafe-lock-path'}
  try{
    const claim=join(path,'owner.json'),file=readStat(claim)
    if(!file?.isFile()||file.isSymbolicLink()||file.size>512)throw Error('bad-claim')
    const row=JSON.parse(readFileSync(claim,'utf8'))
    if(row?.version!==1||row.kind!==name||typeof row.token!=='string'||
      !/^[0-9a-f-]{36}$/.test(row.token)||!Number.isSafeInteger(row.pid)||row.pid<1||
      !Number.isSafeInteger(row.at)||row.at<=0)throw Error('bad-claim')
    return {held:true,needsReview:!alive(row.pid),ownerAlive:alive(row.pid),since:row.at}
  }catch{return {held:true,needsReview:true,reason:'incomplete-claim'}}
}
function claim(dir,name,now){
  if(!NAME.test(name))throw TypeError('invalid planner lock type')
  mkdirSync(dir,{recursive:true,mode:0o700});safeDirectory(dir)
  const path=join(dir,name)
  try{mkdirSync(path,{mode:0o700})}catch(e){if(e?.code==='EEXIST')return {ok:false,reason:name.endsWith('run.lock')?'planner-already-running':name.startsWith('life-agent')?'life-event-ledger-busy':name.startsWith('life-opportunities')?'life-opportunities-ledger-busy':'planner-ledger-busy'};throw e}
  const token=randomUUID(),owner=join(path,'owner.json')
  try{
    const fd=openSync(owner,'wx',0o600)
    try{writeSync(fd,JSON.stringify({version:1,kind:name,token,pid:process.pid,at:now()})+'\n');fsyncSync(fd)}finally{closeSync(fd)}
    return {ok:true,token,path,owner}
  }catch{
    // An interrupted claim is deliberately left held for offline inspection.
    return {ok:false,reason:'planner-lock-incomplete'}
  }
}
function release(lock){
  if(!lock?.ok)return false
  const st=readStat(lock.owner)
  if(!st?.isFile()||st.isSymbolicLink()||st.size>512)return false
  try{
    const row=JSON.parse(readFileSync(lock.owner,'utf8'))
    if(row.token!==lock.token||row.pid!==process.pid)return false
    unlinkSync(lock.owner);rmdirSync(lock.path)
    return true
  }catch{return false}
}
export function withPlannerLedgerLock(dataDir,fn,{now=Date.now}={}){
  const lock=claim(dataDir,'autonomous-planner-ledger.lock',now)
  if(!lock.ok)return {ok:false,reason:lock.reason}
  try{return fn()}finally{if(!release(lock))throw Error('planner-ledger-release-failed')}
}
export function withLifeEventLedgerLock(dataDir,fn,{now=Date.now}={}){
  const lock=claim(dataDir,'life-agent-events-ledger.lock',now)
  if(!lock.ok)return {ok:false,reason:lock.reason}
  try{return fn()}finally{if(!release(lock))throw Error('life-event-ledger-release-failed')}
}
// Existing account-scoped life-opportunities JSON is a single writer's state
// snapshot. This short lock serializes its read/check/write transactions across
// DSH processes without changing the v1 ledger or introducing another fact source.
export function withLifeOpportunityLedgerLock(dataDir,fn,{now=Date.now}={}){
  const lock=claim(dataDir,'life-opportunities-ledger.lock',now)
  if(!lock.ok)return {ok:false,reason:lock.reason}
  try{return fn()}finally{if(!release(lock))throw Error('life-opportunities-ledger-release-failed')}
}
export function createPlannerRunLease({dataDir,now=Date.now}={}){
  if(typeof dataDir!=='string'||!dataDir)throw TypeError('planner run lease needs dataDir')
  const active=new Set()
  return {
    acquire(){const lock=claim(dataDir,'autonomous-planner-run.lock',now);if(lock.ok)active.add(lock.token);return lock},
    release(lock){
      if(!lock?.ok||!active.has(lock.token))return {ok:false,reason:'not-owner'}
      if(!release(lock))return {ok:false,reason:'manual-review-required'}
      active.delete(lock.token);return {ok:true}
    },
    inspect(){
      try{if(!existsSync(dataDir))return {ok:true,held:false,needsReview:false};safeDirectory(dataDir);return {ok:true,...inspectClaim(dataDir,'autonomous-planner-run.lock')}}
      catch{return {ok:false,held:true,needsReview:true,reason:'planner-storage-unsafe'}}
    }
  }
}
/** Offline maintenance only. MUST be called after the administrator confirms
 * all plugin instances are stopped. No API/model-driven route invokes this.
 * Suspicious files, unknown owner, live PID and symlinks always fail closed. */
export function recoverPlannerLockOffline(dataDir,name,{confirmedAllStopped=false}={}){
  if(!NAME.test(name)||confirmedAllStopped!==true)return {ok:false,reason:'explicit-shutdown-confirmation-required'}
  try{
    safeDirectory(dataDir)
    const path=join(dataDir,name),info=inspectClaim(dataDir,name)
    if(!info.held)return {ok:true,removed:false}
    if(info.ownerAlive!==false)return {ok:false,reason:'owner-live-or-unverified'}
    const row=JSON.parse(readFileSync(join(path,'owner.json'),'utf8'))
    if(row.kind!==name||row.pid<1||alive(row.pid)||readdirSync(path).join(',')!=='owner.json')
      return {ok:false,reason:'owner-live-or-unverified'}
    unlinkSync(join(path,'owner.json'));rmdirSync(path)
    return {ok:true,removed:true}
  }catch{return {ok:false,reason:'planner-lock-unsafe'}}
}
