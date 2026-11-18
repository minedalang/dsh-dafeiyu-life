/** Cross-process short JSON transaction lock. Never delete a live writer's lock. */
import {closeSync,existsSync,openSync,readFileSync,statSync,unlinkSync,writeFileSync} from 'node:fs'
import {randomBytes} from 'node:crypto'

const ownerAlive=pid=>{
  if(!Number.isSafeInteger(pid)||pid<=0)return true // Unknown owner: fail closed.
  try{process.kill(pid,0);return true}
  catch(e){return e?.code!=='ESRCH'} // EACCES/EPERM/Windows ambiguity: fail closed.
}
export function withDurableFileLock(file,fn,{now=Date.now,staleMs=30_000}={}){
  const token=randomBytes(16).toString('hex')
  const claim=()=>{
    const fd=openSync(file,'wx',0o600)
    try{writeFileSync(fd,JSON.stringify({pid:process.pid,token,at:now()}))}
    catch(e){closeSync(fd);try{unlinkSync(file)}catch{};throw e}
    return fd
  }
  let fd
  try{fd=claim()}
  catch(e){
    if(e?.code!=='EEXIST')throw e
    let stale=false,owner=null
    try{
      const st=statSync(file)
      if(now()-st.mtimeMs>staleMs){
        const raw=readFileSync(file,'utf8')
        owner=JSON.parse(raw)
        stale=typeof owner?.token==='string'&&/^[a-f0-9]{32}$/.test(owner.token)&&!ownerAlive(owner.pid)
      }
    }catch{} // Corruption does not authorize removal.
    if(stale){
      try{
        const recheck=JSON.parse(readFileSync(file,'utf8'))
        if(recheck.token===owner.token)unlinkSync(file)
      }catch{}
    }
    try{fd=claim()}
    catch(e2){if(e2?.code==='EEXIST'){const busy=Error('durable_ledger_busy');busy.code='LEDGER_BUSY';throw busy}throw e2}
  }
  try{return fn()}
  finally{
    closeSync(fd)
    try{const current=JSON.parse(readFileSync(file,'utf8'));if(current.token===token)unlinkSync(file)}catch{}
  }
}
