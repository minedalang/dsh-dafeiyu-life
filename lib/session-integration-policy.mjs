import {AsyncLocalStorage} from 'node:async_hooks'

/** Trusted host integration policy, shared by memory mount and Session bridge.
 * No model input, saved legacy flags or external content can select this policy.
 * Omitting the provider preserves the legacy autonomous-life default contract.
 */
export const autonomousLifeSessionIntegration=()=>({mode:'autonomous-life',revision:0})

export function readSessionIntegration(provider=autonomousLifeSessionIntegration){
  try{
    const p=provider()
    if(p&&['autonomous-life','memory-foundation'].includes(p.mode)&&Number.isSafeInteger(p.revision)&&p.revision>=0)
      return {mode:p.mode,revision:p.revision}
  }catch{}
  return {mode:'unavailable',revision:-1}
}

export function sameAutonomousLifeSessionIntegration(previous,current){
  return previous?.mode==='autonomous-life'&&current?.mode==='autonomous-life'&&previous.revision===current.revision
}

// An automatic dispatch retains its original host generation across awaits.
// Unscoped explicit tools keep their existing authorization path. A nested
// automatic operation may not replace an expired outer generation.
export function sessionIntegrationPaused(){
  const error=Error('session-integration-paused');error.code='session-integration-paused';return error
}

export function createAutomaticSessionScope(provider=autonomousLifeSessionIntegration){
  const scope=new AsyncLocalStorage()
  let inFlight=0
  const capture=()=>readSessionIntegration(provider)
  const isCurrent=previous=>sameAutonomousLifeSessionIntegration(previous,capture())
  const current=()=>{const previous=scope.getStore();return previous===undefined||isCurrent(previous)}
  const run=(previous,task)=>{
    if(!current()||!isCurrent(previous))throw sessionIntegrationPaused()
    inFlight++
    try{
      const result=scope.run(previous,task)
      if(result&&typeof result.then==='function')return Promise.resolve(result).finally(()=>{inFlight--})
      inFlight--;return result
    }catch(error){inFlight--;throw error}
  }
  // Capture at the actual automatic entry, not when the timer was installed.
  // A nested entry cannot revive an expired outer scope.
  const dispatch=(task,onPaused=()=>({ok:true,skipped:'session-integration-paused',modelCalled:false}))=>{
    const previous=capture()
    if(!current()||!isCurrent(previous))return onPaused()
    return run(previous,task)
  }
  return {capture,isCurrent,current,run,dispatch,scopedRevision:()=>scope.getStore()?.revision,inFlight:()=>inFlight}
}

// Host-owned mode setting; deliberately outside importable business backups.
// A requested transition is a restart transaction, not a hot-switch claim.
// The old generation is invalidated immediately, and the requested generation
// cannot be activated by a plugin reload in the old host or a second live host.
import {join} from 'node:path'
import {lstatSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {withDurableFileLock} from './durable-file-lock.mjs'
export const SESSION_INTEGRATION_FILE='session-integration-v1.json'
const modes=['autonomous-life','memory-foundation']
const validRevision=n=>Number.isSafeInteger(n)&&n>=0
const pidAlive=pid=>{try{process.kill(pid,0);return true}catch(e){return e?.code!=='ESRCH'}}
// Independent preferences. The old mode names survive ONLY as adapters for
// existing generation consumers; they are not the v2 configuration truth.
export const SESSION_CAPABILITY_KEYS=Object.freeze(['platform','autonomous','persona','automaticMemory','bridge'])
const validCapabilities=c=>c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).length===SESSION_CAPABILITY_KEYS.length&&SESSION_CAPABILITY_KEYS.every(k=>typeof c[k]==='boolean')
const legacyCapabilities=mode=>({platform:true,autonomous:mode==='autonomous-life',persona:mode==='autonomous-life',automaticMemory:mode==='autonomous-life',bridge:mode==='autonomous-life'})
const capabilitiesOf=p=>p.version===2?p.capabilities:legacyCapabilities(p.mode)
const equalCapabilities=(a,b)=>SESSION_CAPABILITY_KEYS.every(k=>a[k]===b[k])
const automaticProjection=c=>c.platform&&c.autonomous?'autonomous-life':'memory-foundation'
export function createHostSessionIntegration({dataDir,pid=process.pid,isPidAlive=pidAlive}={}){
  const file=join(dataDir,SESSION_INTEGRATION_FILE),lock=file+'.lock'
  const initial=()=>({version:1,mode:'autonomous-life',revision:0,pending:null})
  const validPending=(p,valid)=>p.pending===null||(p.pending&&valid(p.pending)&&Number.isSafeInteger(p.pending.pid)&&p.pending.pid>0&&p.revision<Number.MAX_SAFE_INTEGER)
  const read=()=>{
    let st;try{st=lstatSync(file)}catch(e){if(e?.code==='ENOENT')return initial();throw e}
    if(!st.isFile()||st.isSymbolicLink()||st.size>4096)throw Error('session-integration-storage-unsafe')
    const p=JSON.parse(readFileSync(file,'utf8'))
    if(!validRevision(p?.revision)||!(p.version===1&&modes.includes(p.mode)&&validPending(p,x=>modes.includes(x.mode)&&x.mode!==p.mode)||
      p.version===2&&validCapabilities(p.capabilities)&&validPending(p,x=>validCapabilities(x.capabilities)&&!equalCapabilities(p.capabilities,x.capabilities))))throw Error('session-integration-invalid')
    return p
  }
  const save=p=>{
    const tmp=file+'.'+randomUUID()+'.tmp'
    try{writeFileSync(tmp,JSON.stringify(p)+'\n',{mode:0o600,flag:'wx'});renameSync(tmp,file)}finally{try{unlinkSync(tmp)}catch{}}
  }
  let boot=null
  try{
    const initialRow=read()
    if(initialRow.pending&&initialRow.pending.pid!==pid&&!isPidAlive(initialRow.pending.pid)){
      boot=withDurableFileLock(lock,()=>{const p=read();if(!p.pending||p.pending.pid===pid||isPidAlive(p.pending.pid))return p
        const next=p.version===2?{version:2,capabilities:p.pending.capabilities,revision:p.revision+1,pending:null}:{version:1,mode:p.pending.mode,revision:p.revision+1,pending:null};save(next);return next})
    }else boot=initialRow
  }catch{}
  const capabilityStatus=()=>{
    try{
      const p=read(),active=capabilitiesOf(p)
      // A v1 -> v2 pending request preserves the active snapshot, but the
      // old host must remain blocked even after another host commits it.
      if(!boot||p.revision!==boot.revision||!equalCapabilities(active,capabilitiesOf(boot)))return {ok:false,revision:-1,reason:'restart-or-repair-required'}
      const requested=p.pending?(p.version===2?p.pending.capabilities:legacyCapabilities(p.pending.mode)):active
      return {ok:true,available:!p.pending,revision:p.revision,active:{...active},requested:{...requested},restartRequired:Boolean(p.pending),legacy:p.version===1}
    }catch{return {ok:false,revision:-1,reason:'invalid-capability-storage'}}
  }
  const status=()=>{
    const s=capabilityStatus()
    if(!s.ok)return {...s,mode:'unavailable'}
    const activeMode=automaticProjection(s.active),requestedMode=automaticProjection(s.requested)
    return {ok:true,mode:s.available?activeMode:'unavailable',activeMode,revision:s.revision,requestedMode,restartRequired:s.restartRequired}
  }
  const getPolicy=()=>{const s=status();return {mode:s.mode,revision:s.revision}}
  const getCapabilities=()=>{const s=capabilityStatus();return s.ok&&s.available?s.active:null}
  const requestMode=({mode,expectedRevision,confirm}={})=>{
    if(!modes.includes(mode)||confirm!=='REQUEST_SESSION_INTEGRATION_RESTART'||!validRevision(expectedRevision))throw Error('请明确确认有效模式与当前代际')
    return withDurableFileLock(lock,()=>{
      const s=status(),p=read()
      if(p.version!==1)throw Error('已使用独立能力设置，请刷新管理中心')
      if(!s.ok||p.revision!==expectedRevision||p.pending)throw Error('模式已变化或等待重启，请刷新并完成原切换')
      if(mode===p.mode)return s
      if(p.revision>=Number.MAX_SAFE_INTEGER)throw Error('模式代际已达上限')
      save({...p,pending:{mode,pid}})
      return status()
    })
  }
  const requestCapabilities=({capabilities,expectedRevision,confirm}={})=>{
    if(!validCapabilities(capabilities)||confirm!=='REQUEST_CAPABILITIES_RESTART'||!validRevision(expectedRevision))throw Error('请明确确认完整能力设置与当前代际')
    return withDurableFileLock(lock,()=>{
      const s=capabilityStatus(),p=read()
      if(!s.ok||!s.available||p.revision!==expectedRevision)throw Error('能力设置已变化或等待重启，请刷新')
      if(equalCapabilities(s.active,capabilities))return s
      if(p.revision>=Number.MAX_SAFE_INTEGER)throw Error('能力代际已达上限')
      // Preserve the validated legacy active preferences in the v2 row. A
      // pending v1 request cannot be overwritten and v1 readers fail closed.
      save({version:2,capabilities:s.active,revision:p.revision,pending:{capabilities:{...capabilities},pid}})
      return capabilityStatus()
    })
  }
  return {getPolicy,status,requestMode,capabilityStatus,getCapabilities,requestCapabilities}
}
