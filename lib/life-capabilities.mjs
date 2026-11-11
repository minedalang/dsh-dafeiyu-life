/**
 * dev.4: deterministic, platform-neutral capability registry. Models only see
 * declared descriptions and cannot provide new handlers or elevate permissions.
 * A capability's available() and execute() callbacks are owned by the actual
 * platform adapter; their original authorization and receipt checks remain.
 */
const ID=/^[a-z][a-z0-9_-]{1,30}\.[a-z][a-z0-9_-]{1,38}$/
// Only these fixed reasons may cross from a platform adapter to planner/UI.
// Never expose raw platform errors, account identifiers or capability handlers.
const SAFE_REASONS=new Set(['account-not-ready','disabled','video-busy','video-launch-cooldown','daily-video-quota','report-off-one-round','video-technical-backoff','launcher-unavailable','overlay-invalid',
  'headless-preflight-failed','spawn-failed','video-delegation-not-started','adapter-error','adapter-unavailable'])
export function createLifeCapabilities(entries=[],{now=Date.now,technicalBackoffMs=15*60_000}={}){
  const skills=new Map(),failures=new Map()
  const safeReason=reason=>SAFE_REASONS.has(reason)?reason:'adapter-error'
  const checkCooldown=id=>{
    const row=failures.get(id)
    if(row&&now()<row.until)return {ok:false,reason:'video-technical-backoff',retryAt:row.until,failureCode:row.reason}
    if(row)failures.delete(id)
    return null
  }
  const track=(id,value)=>{
    if(value?.started===true){failures.delete(id);return value}
    const reason=safeReason(value?.reason)
    if(['launcher-unavailable','overlay-invalid','headless-preflight-failed',
         'spawn-failed','adapter-error','video-delegation-not-started'].includes(reason)){
      const old=failures.get(id),failuresCount=old?.count+1||1
      failures.set(id,{reason,count:failuresCount,until:now()+Math.min(60*60_000,
        technicalBackoffMs*Math.min(4,failuresCount))})
    }
    return {...value,reason}
  }
  for(const entry of entries){
    if(!entry||typeof entry!=='object'||!ID.test(String(entry.id||''))||
      !['read','delegated-existing-permissions'].includes(entry.risk)||
      typeof entry.available!=='function'||typeof entry.execute!=='function'||skills.has(entry.id))
      throw Error('Life Agent capability registration rejected')
    const [platform]=entry.id.split('.')
    skills.set(entry.id,{...entry,platform})
  }
  const inspect=()=>{
    const available=[],blocked=[]
    for(const skill of skills.values()){
      let state
      try{state=checkCooldown(skill.id)||skill.available()}catch{state={ok:false,reason:'adapter-error'}}
      if(state?.ok===true)available.push({id:skill.id,platform:skill.platform,risk:skill.risk,
        description:String(skill.description||'').slice(0,90)})
      else blocked.push({id:skill.id,platform:skill.platform,
        reason:SAFE_REASONS.has(state?.reason)?state.reason:'adapter-unavailable',
        ...(state?.retryAt?{retryAt:state.retryAt,failureCode:state.failureCode}:{})})
    }
    return {ok:true,available:available.slice(0,12),blocked:blocked.slice(0,12)}
  }
  const list=()=>inspect().available
  const run=(id,options={})=>{
    const skill=skills.get(id)
    if(!skill)return {started:false,reason:'unknown-capability'}
    try{
      // The menu was only a snapshot. Recheck availability at delegation
      // and preserve its safe reason when state changed after Life chose it.
      const admission=checkCooldown(id)||skill.available()
      if(admission?.ok!==true)return {started:false,reason:SAFE_REASONS.has(admission?.reason)?admission.reason:'not-available',
        ...(admission?.retryAt?{retryAt:admission.retryAt}:{})}
      const response=skill.execute(options)
      return response&&typeof response.then==='function'
        ?response.then(row=>track(id,row),()=>track(id,{started:false,reason:'adapter-error'}))
        :track(id,response)
    }catch{return track(id,{started:false,reason:'adapter-error'})}
  }
  return {list,inspect,run}
}
