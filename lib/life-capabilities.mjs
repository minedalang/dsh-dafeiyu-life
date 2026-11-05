/**
 * dev.4: deterministic, platform-neutral capability registry. Models only see
 * declared descriptions and cannot provide new handlers or elevate permissions.
 * A capability's available() and execute() callbacks are owned by the actual
 * platform adapter; their original authorization and receipt checks remain.
 */
const ID=/^[a-z][a-z0-9_-]{1,30}\.[a-z][a-z0-9_-]{1,38}$/
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
  const list=()=>{
    const offers=[]
    for(const skill of skills.values()){
      let available=false
      try{available=skill.available()?.ok===true}catch{}
      if(available)offers.push({id:skill.id,platform:skill.platform,risk:skill.risk,
        description:String(skill.description||'').slice(0,90)})
    }
    return offers.slice(0,12)
  }
  const run=id=>{
    const skill=skills.get(id)
    if(!skill)return {started:false,reason:'unknown-capability'}
    try{
      if(skill.available()?.ok!==true)return {started:false,reason:'not-available'}
      return skill.execute()
    }catch(e){return {started:false,reason:'adapter-error',error:String(e?.message||e).slice(0,90)}}
  }
  return {list,run}
}
