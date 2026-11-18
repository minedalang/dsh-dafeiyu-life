/**
 * Bounded same-account, same-video metadata read sharing. Call ONLY AFTER
 * each caller has passed the original read-action authorization. An in-flight
 * read shares one Bilibili request; a short successful cache cannot be used
 * while the shared platform-read budget is in cooldown. No disk data, writes,
 * images or private messages enter this cache.
 */
const BV=/^BV[0-9A-Za-z]{10}$/
export function createLifePublicReadCoalescer({now=Date.now,ttlMs=40_000,maxEntries=64}={}){
  const entries=new Map()
  const status={shared:0,reused:0,missed:0}
  const run=async({scope,bvid,readAllowed=()=>true}={},work)=>{
    if(typeof work!=='function')throw TypeError('Missing video metadata read')
    if(typeof scope!=='string'||!scope||scope.length>200||!BV.test(String(bvid||'')))return work()
    if(readAllowed()!==true)return work() // existing persisted -509 gate still executes
    const key=scope+'\0'+bvid,t=now()
    for(const [id,row] of entries)if(!row.promise&&(row.expiresAt<=t||entries.size>maxEntries))entries.delete(id)
    const old=entries.get(key)
    if(old?.promise){status.shared++;return old.promise}
    if(old?.expiresAt>t){status.reused++;return old.value}
    status.missed++
    const row={promise:null,expiresAt:0,value:null}
    const pending=Promise.resolve().then(work)
    row.promise=pending;entries.set(key,row)
    try{
      const value=await pending
      // Some MCP implementations return failed reads as ordinary JSON. Never
      // cache uncertain/failure results or large unbounded public payloads.
      let raw=value
      if(typeof value==='string'){try{raw=JSON.parse(value)}catch{raw=null}}
      const valid=raw&&typeof raw==='object'&&raw.isError!==true&&raw.ok!==false&&
        raw.code!==-509&&raw.code!==-412&&raw.code!==-352&&raw.code!==403&&raw.error===undefined
      let size=Infinity
      try{size=JSON.stringify(value).length}catch{}
      if(valid&&size<=80_000){row.value=value;row.expiresAt=now()+Math.max(1000,Math.min(60_000,ttlMs));row.promise=null}
      else entries.delete(key)
      if(entries.size>maxEntries){for(const id of entries.keys()){if(id===key)continue;if(!entries.get(id)?.promise)entries.delete(id);if(entries.size<=maxEntries)break}}
      return value
    }catch(e){entries.delete(key);throw e}
  }
  return {run,status:()=>({...status,entries:entries.size})}
}
