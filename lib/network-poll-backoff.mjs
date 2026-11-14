/** Shared persistent read-only polling backoff for Bilibili DM / comment inbox.
 * Failures never imply a sent message, a missing inbox, or a successful decision.
 * DNS/transport failures use bounded recovery probes; platform rate limits remain
 * a separate, longer protection and are never cleared by network recovery.
 */
import { existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_FILE=16_000
export const classifyPollFailure = value => {
  const text=String(value?.message||value||'').toLowerCase()
  if(/-509|code\s*=\s*-509|请求过于频繁|too many requests|rate.?limit|http\s*429/.test(text))return 'rate-limit'
  if(/enotfound|eai_again|etimedout|econnreset|econnrefused|enetunreach|network|fetch failed|dns|超时|连接重置|getaddrinfo|cannot connect/.test(text))return 'network'
  return ''
}
const delays={
  'rate-limit':[5,15,30,60,90],
  // After the first two retries, keep checking read-only connectivity every
  // five minutes. A long local DNS outage must not freeze inbox recovery for 40m.
  network:[2,5,5,5,5],
}
export function createNetworkPollBackoff({dataDir,getAccountTag=()=>'',now=Date.now}={}){
  if(!dataDir)throw TypeError('dataDir required')
  const file=join(dataDir,'interaction-network-backoff.json')
  const empty=scope=>({version:2,scope,lanes:{}})
  const scope=()=>String(getAccountTag()||'').match(/^[a-f0-9]{16}$/)?.[0]||''
  const write=x=>{
    if(!x.scope)return
    mkdirSync(dataDir,{recursive:true})
    if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('网络退避状态被替换为符号链接')
    const temp=file+'.'+process.pid+'.tmp'
    writeFileSync(temp,JSON.stringify(x,null,2)+'\n',{encoding:'utf8',mode:0o600})
    renameSync(temp,file)
  }
  const read=()=>{
    const tag=scope()
    if(!tag)return empty('')
    try{
      if(!existsSync(file))return empty(tag)
      const st=lstatSync(file)
      if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_FILE)throw Error('网络退避状态不安全')
      const x=JSON.parse(readFileSync(file,'utf8'))
      if(![1,2].includes(x?.version)||x.scope!==tag||!x.lanes||typeof x.lanes!=='object')return empty(tag)
      // v1 persisted 40-minute DNS backoffs without any recovery probe. On the
      // first v2 read, grant exactly one immediate read-only recovery attempt.
      // If it still fails, v2's five-minute probe cadence takes over. Keep all
      // rate-limit lanes and their original retryAt unchanged.
      if(x.version===1){
        x.version=2
        for(const row of Object.values(x.lanes))if(row?.category==='network')row.nextAt=now()
        write(x)
      }
      return x
    }catch(e){if(e?.code==='ENOENT')return empty(tag);throw e}
  }
  const lane=name=>read().lanes[name]||{category:'',streak:0,nextAt:0}
  const check=name=>{
    const row=lane(name),remaining=Math.max(0,Number(row.nextAt||0)-now())
    return {allowed:remaining===0,remainingMs:remaining,nextAt:remaining?row.nextAt:0,category:row.category||'',streak:row.streak||0}
  }
  const settle=(name,error)=>{
    const x=read(),category=classifyPollFailure(error)
    if(!x.scope)return {category:'unscoped',nextAt:0}
    if(!category){delete x.lanes[name];write(x);return {category:'',nextAt:0}}
    const prior=x.lanes[name]||{},streak=prior.category===category?Math.min(5,Number(prior.streak||0)+1):1
    const dmRateLimit=name==='dm'&&category==='rate-limit'
    const sequence=dmRateLimit?[15,30,60,120,180]:delays[category]
    const nextAt=now()+sequence[streak-1]*60_000
    x.lanes[name]={category,streak,nextAt}
    write(x)
    return {category,streak,nextAt}
  }
  const clearNetwork = expected => {
    const x=read(),cleared=[]
    const allowed=new Set(['dm','replies','mentions'])
    for(const [name,value] of Object.entries(expected||{}).slice(0,3)){
      const row=x.lanes[name],at=Number(value)
      // Manual recovery is deliberately limited to DNS/transport failures.
      // Bilibili -509 / HTTP 429 rate-limit protection is never user-clearable.
      if(!allowed.has(name)||row?.category!=='network'||!Number.isSafeInteger(at)||
        at<=0||Number(row.nextAt)!==at)continue
      delete x.lanes[name];cleared.push(name)
    }
    if(!cleared.length)return {ok:false,reason:'stale-or-not-network'}
    write(x)
    return {ok:true,cleared}
  }
  const status=()=>({dm:check('dm'),replies:check('replies'),mentions:check('mentions')})
  return {check,settle,status,clearNetwork,file}
}
