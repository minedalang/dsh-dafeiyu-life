/**
 * Life Planner local-disk coordination (all accounts share one daily model
 * budget). These directories are atomic on the same NTFS/POSIX filesystem.
 * They are NOT distributed locks for a network filesystem. A process crash
 * leaves a claim in place: never unlock by age or refund quota. Only the
 * non-sending run lease may be recovered when its former owner is proven dead.
 * No UID, account tag, prompt, task ID or other private value is written here.
 */
import {randomUUID} from 'node:crypto'
import {closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,rmdirSync,unlinkSync,writeSync} from 'node:fs'
import {join} from 'node:path'

const NAME=/^(?:autonomous-planner-(?:ledger|run|run-recovery)|life-agent-events-ledger|life-opportunities-ledger|life-willingness-ledger)\.lock$/
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
    const ownerAlive=alive(row.pid)
    return {held:true,needsReview:!ownerAlive,ownerAlive,since:row.at}
  }catch{return {held:true,needsReview:true,reason:'incomplete-claim'}}
}
function claim(dir,name,now){
  if(!NAME.test(name))throw TypeError('invalid planner lock type')
  mkdirSync(dir,{recursive:true,mode:0o700});safeDirectory(dir)
  const path=join(dir,name)
  try{mkdirSync(path,{mode:0o700})}catch(e){if(e?.code==='EEXIST')return {ok:false,reason:name==='autonomous-planner-run-recovery.lock'?'planner-recovery-in-progress':name.endsWith('run.lock')?'planner-already-running':name.startsWith('life-agent')?'life-event-ledger-busy':name.startsWith('life-opportunities')?'life-opportunities-ledger-busy':'planner-ledger-busy'};throw e}
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
/**
 * A dead former process cannot be executing the old planner run. Recover ONLY
 * that run's scheduling lease, never account admission, a send transaction, a
 * pending action, or any short ledger writer lock. Do not infer death from age.
 *
 * A separate atomic recovery claim serializes multiple DSH instances. The
 * original lock is rechecked while holding that claim, then atomically moved
 * aside before deletion. A second instance may obtain the fresh run lock but
 * can never obtain the abandoned lock's token or run the old action again.
 * Unknown/corrupt/live claims fail closed and remain available for inspection.
 */
function reclaimDeadPlannerRun(dataDir,now){
  const name='autonomous-planner-run.lock'
  try{
    if(!existsSync(dataDir))return {ok:true,recovered:false,reason:'no-lock'}
    safeDirectory(dataDir)
    const before=inspectClaim(dataDir,name)
    if(!before.held)return {ok:true,recovered:false,reason:'no-lock'}
    if(before.ownerAlive!==false)return {ok:false,recovered:false,reason:before.reason||
      (before.ownerAlive===true?'planner-owner-alive':'planner-lock-review-required')}
    const guard=claim(dataDir,'autonomous-planner-run-recovery.lock',now)
    if(!guard.ok){
      const guardStatus=inspectClaim(dataDir,'autonomous-planner-run-recovery.lock')
      return {ok:false,recovered:false,reason:guardStatus.ownerAlive===false?'planner-recovery-guard-orphaned':
        guardStatus.needsReview?'planner-recovery-guard-review-required':guard.reason}
    }
    try{
      // Another instance may have recovered the same run while we waited.
      const current=inspectClaim(dataDir,name)
      if(!current.held)return {ok:true,recovered:false,reason:'already-recovered'}
      if(current.ownerAlive!==false)return {ok:false,recovered:false,reason:current.reason||
        (current.ownerAlive===true?'planner-owner-alive':'planner-lock-review-required')}
      const path=join(dataDir,name),owner=join(path,'owner.json')
      if(readdirSync(path).join(',')!=='owner.json')return {ok:false,recovered:false,reason:'planner-lock-review-required'}
      const stat=readStat(owner)
      if(!stat?.isFile()||stat.isSymbolicLink()||stat.size>512)return {ok:false,recovered:false,reason:'planner-lock-review-required'}
      const row=JSON.parse(readFileSync(owner,'utf8'))
      if(row.version!==1||row.kind!==name||!/^[0-9a-f-]{36}$/.test(row.token)||
        !Number.isSafeInteger(row.pid)||row.pid<1||alive(row.pid))
        return {ok:false,recovered:false,reason:'planner-lock-review-required'}
      // Never unlink an owner.json at the well-known active lock path: another
      // process may have claimed that name. Move the stale directory first.
      const tombstone=join(dataDir,'.autonomous-planner-abandoned-'+randomUUID())
      renameSync(path,tombstone)
      const moved=JSON.parse(readFileSync(join(tombstone,'owner.json'),'utf8'))
      if(moved.kind!==name||moved.token!==row.token||moved.pid!==row.pid||alive(moved.pid)){
        // External maintenance raced our atomic move. Preserve the evidence;
        // never delete something we cannot independently prove was abandoned.
        if(!existsSync(path))try{renameSync(tombstone,path)}catch{}
        return {ok:false,recovered:false,reason:'planner-lock-review-required'}
      }
      unlinkSync(join(tombstone,'owner.json'))
      rmdirSync(tombstone)
      return {ok:true,recovered:true,reason:'dead-owner-reclaimed'}
    }finally{if(!release(guard))throw Error('planner-recovery-guard-release-failed')}
  }catch{return {ok:false,recovered:false,reason:'planner-lock-review-required'}}
}
export function createPlannerRunLease({dataDir,now=Date.now}={}){
  if(typeof dataDir!=='string'||!dataDir)throw TypeError('planner run lease needs dataDir')
  const active=new Set(),recovery={count:0,lastAt:0,lastResult:'',lastError:''}
  const recoverAbandoned=()=>{
    const result=reclaimDeadPlannerRun(dataDir,now)
    if(result.recovered){recovery.count++;recovery.lastAt=now();recovery.lastResult='dead-owner-reclaimed';recovery.lastError=''}
    else if(!result.ok&&result.reason!=='planner-owner-alive'&&result.reason!=='planner-recovery-in-progress'){
      recovery.lastError=result.reason
    }
    return result
  }
  return {
    recoverAbandoned,
    acquire(){
      let lock=claim(dataDir,'autonomous-planner-run.lock',now)
      if(!lock.ok&&lock.reason==='planner-already-running'){
        const inspected=inspectClaim(dataDir,'autonomous-planner-run.lock')
        if(inspected.ownerAlive===false){
          const result=recoverAbandoned()
          lock=result.ok?claim(dataDir,'autonomous-planner-run.lock',now):{ok:false,reason:result.reason}
        }else if(inspected.needsReview)lock={ok:false,reason:'planner-lock-review-required'}
      }
      if(lock.ok)active.add(lock.token)
      return lock
    },
    release(lock){
      if(!lock?.ok||!active.has(lock.token))return {ok:false,reason:'not-owner'}
      if(!release(lock))return {ok:false,reason:'manual-review-required'}
      active.delete(lock.token);return {ok:true}
    },
    inspect(){
      try{if(!existsSync(dataDir))return {ok:true,held:false,needsReview:false,autoRecovery:{...recovery}};
        safeDirectory(dataDir);return {ok:true,...inspectClaim(dataDir,'autonomous-planner-run.lock'),autoRecovery:{...recovery}}}
      catch{return {ok:false,held:true,needsReview:true,reason:'planner-storage-unsafe',autoRecovery:{...recovery}}}
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

// One short filesystem transaction coordinates admission across plugin processes.
// The durable claim outlives the lock until a verified receipt or offline review.
export function withLifeWillingnessLedgerLock(dataDir,fn,{now=Date.now}={}){
  const lock=claim(dataDir,'life-willingness-ledger.lock',now)
  if(!lock.ok)return {ok:false,reason:lock.reason}
  try{return fn()}finally{if(!release(lock))throw Error('life-willingness-ledger-release-failed')}
}
