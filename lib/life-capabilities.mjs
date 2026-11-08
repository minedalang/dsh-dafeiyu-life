/**
 * dev.4: deterministic, platform-neutral capability registry. Models only see
 * declared descriptions and cannot provide new handlers or elevate permissions.
 * A capability's available() and execute() callbacks are owned by the actual
 * platform adapter; their original authorization and receipt checks remain.
 */
const ID=/^[a-z][a-z0-9_-]{1,30}\.[a-z][a-z0-9_-]{1,38}$/
// Only these fixed reasons may cross from a platform adapter to planner/UI.
// Never expose raw platform errors, account identifiers or capability handlers.
const SAFE_REASONS=new Set(['account-not-ready','disabled','video-busy','daily-video-quota','report-off-one-round'])
export function createLifeCapabilities(entries=[]){
  const skills=new Map()
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
      try{state=skill.available()}catch{state={ok:false,reason:'adapter-unavailable'}}
      if(state?.ok===true)available.push({id:skill.id,platform:skill.platform,risk:skill.risk,
        description:String(skill.description||'').slice(0,90)})
      else blocked.push({id:skill.id,platform:skill.platform,
        reason:SAFE_REASONS.has(state?.reason)?state.reason:'adapter-unavailable'})
    }
    return {ok:true,available:available.slice(0,12),blocked:blocked.slice(0,12)}
  }
  const list=()=>inspect().available
  const run=(id,options={})=>{
    const skill=skills.get(id)
    if(!skill)return {started:false,reason:'unknown-capability'}
    try{
      if(skill.available()?.ok!==true)return {started:false,reason:'not-available'}
      return skill.execute(options)
    }catch(e){return {started:false,reason:'adapter-error',error:String(e?.message||e).slice(0,90)}}
  }
  return {list,inspect,run}
}
