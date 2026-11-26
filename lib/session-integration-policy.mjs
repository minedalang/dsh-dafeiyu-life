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
export function createHostSessionIntegration({dataDir,pid=process.pid,isPidAlive=pidAlive}={}){
  const file=join(dataDir,SESSION_INTEGRATION_FILE),lock=file+'.lock'
  const initial=()=>({version:1,mode:'autonomous-life',revision:0,pending:null})
  const read=()=>{
    let st;try{st=lstatSync(file)}catch(e){if(e?.code==='ENOENT')return initial();throw e}
    if(!st.isFile()||st.isSymbolicLink()||st.size>4096)throw Error('session-integration-storage-unsafe')
    const p=JSON.parse(readFileSync(file,'utf8'))
    if(p?.version!==1||!modes.includes(p.mode)||!validRevision(p.revision)||
      !(p.pending===null||(p.pending&&modes.includes(p.pending.mode)&&p.pending.mode!==p.mode&&Number.isSafeInteger(p.pending.pid)&&p.pending.pid>0&&p.revision<Number.MAX_SAFE_INTEGER)))throw Error('session-integration-invalid')
    return p
  }
  const save=p=>{
    const tmp=file+'.'+randomUUID()+'.tmp'
    try{writeFileSync(tmp,JSON.stringify(p)+'\n',{mode:0o600,flag:'wx'});renameSync(tmp,file)}finally{try{unlinkSync(tmp)}catch{}}
  }
  // Startup-only activation: the old host must have exited, not just unloaded
  // its plugin. Unknown process liveness or corrupt settings never open Life.
  let boot=null
  try{
    const initialRow=read()
    if(initialRow.pending&&initialRow.pending.pid!==pid&&!isPidAlive(initialRow.pending.pid)){
      boot=withDurableFileLock(lock,()=>{const p=read();if(!p.pending||p.pending.pid===pid||isPidAlive(p.pending.pid))return p
        const next={version:1,mode:p.pending.mode,revision:p.revision+1,pending:null};save(next);return next})
    }else boot=initialRow
  }catch{}
  const status=()=>{
    try{
      const p=read()
      // Even another process committing the pending mode cannot revive this
      // instance: the boot snapshot must equal the durable active generation.
      if(!boot||p.mode!==boot.mode||p.revision!==boot.revision)return {ok:false,mode:'unavailable',revision:-1,reason:'restart-or-repair-required'}
      return {ok:true,mode:p.pending?'unavailable':p.mode,activeMode:p.mode,revision:p.revision,requestedMode:p.pending?.mode||p.mode,restartRequired:Boolean(p.pending)}
    }catch{return {ok:false,mode:'unavailable',revision:-1,reason:'invalid-mode-storage'}}
  }
  const getPolicy=()=>{const s=status();return {mode:s.mode,revision:s.revision}}
  const requestMode=({mode,expectedRevision,confirm}={})=>{
    if(!modes.includes(mode)||confirm!=='REQUEST_SESSION_INTEGRATION_RESTART'||!validRevision(expectedRevision))throw Error('请明确确认有效模式与当前代际')
    return withDurableFileLock(lock,()=>{
      const s=status(),p=read()
      if(!s.ok||p.revision!==expectedRevision||p.pending)throw Error('模式已变化或等待重启，请刷新并完成原切换')
      if(mode===p.mode)return s
      if(p.revision>=Number.MAX_SAFE_INTEGER)throw Error('模式代际已达上限')
      save({...p,pending:{mode,pid}})
      return status()
    })
  }
  return {getPolicy,status,requestMode}
}
