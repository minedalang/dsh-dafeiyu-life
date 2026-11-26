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
