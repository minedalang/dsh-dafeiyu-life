import {AsyncLocalStorage} from 'node:async_hooks'

/** Trusted host integration policy, shared by memory mount and Session bridge.
 * No model input, saved legacy flags or external content can select this policy.
 * Omitting the provider preserves the legacy full-mode contract.
 */
export const fullSessionIntegration=()=>({mode:'full',revision:0})

export function readSessionIntegration(provider=fullSessionIntegration){
  try{
    const p=provider()
    if(p&&['full','cooperative'].includes(p.mode)&&Number.isSafeInteger(p.revision)&&p.revision>=0)
      return {mode:p.mode,revision:p.revision}
  }catch{}
  return {mode:'unavailable',revision:-1}
}

export function sameFullSessionIntegration(previous,current){
  return previous?.mode==='full'&&current?.mode==='full'&&previous.revision===current.revision
}

// An automatic dispatch retains its original host generation across awaits.
// Unscoped explicit tools keep their existing authorization path. A nested
// automatic operation may not replace an expired outer generation.
export function sessionIntegrationPaused(){
  const error=Error('session-integration-paused');error.code='session-integration-paused';return error
}

export function createAutomaticSessionScope(provider=fullSessionIntegration){
  const scope=new AsyncLocalStorage()
  const capture=()=>readSessionIntegration(provider)
  const isCurrent=previous=>sameFullSessionIntegration(previous,capture())
  const current=()=>{const previous=scope.getStore();return previous===undefined||isCurrent(previous)}
  const run=(previous,task)=>{
    if(!current()||!isCurrent(previous))throw sessionIntegrationPaused()
    return scope.run(previous,task)
  }
  // Capture at the actual automatic entry, not when the timer was installed.
  // A nested entry cannot revive an expired outer scope.
  const dispatch=(task,onPaused=()=>({ok:true,skipped:'session-integration-paused',modelCalled:false}))=>{
    const previous=capture()
    if(!current()||!isCurrent(previous))return onPaused()
    return run(previous,task)
  }
  return {capture,isCurrent,current,run,dispatch}
}
