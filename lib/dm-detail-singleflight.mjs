/**
 * In-flight-only coalescing of the SAME authenticated DM detail request.
 * Different account scopes, contacts, and limits never share a result.
 * No private messages are cached after settlement and no request can bypass
 * the Bilibili shared budget/backoff, which remains inside the supplied task.
 */
const SCOPE=/^[a-f0-9]{16}$/
const UID=/^[1-9]\d{0,18}$/
export function createDmDetailSingleflight({getAccountTag=()=>''}={}){
  const active=new Map()
  function read({uid,limit=50}={},task){
    if(typeof task!=='function')throw TypeError('DM detail task missing')
    const scope=String(getAccountTag()||'')
    const target=String(uid||'')
    // Unknown account scope is never eligible for cross-caller reuse.
    if(!SCOPE.test(scope)||!UID.test(target)||!Number.isSafeInteger(limit)||limit<1||limit>50)
      return Promise.resolve().then(task)
    const key=`${scope}:${target}:${limit}`
    const existing=active.get(key)
    if(existing)return existing
    const pending=Promise.resolve().then(task).then(result=>{
      if(String(getAccountTag()||'')!==scope)throw Error('DM detail account changed')
      return result
    })
    active.set(key,pending)
    const clear=()=>{if(active.get(key)===pending)active.delete(key)}
    // Consume BOTH settlement outcomes; never introduce an unhandled promise.
    void pending.then(clear,clear)
    return pending
  }
  return {read,status:()=>({inflight:active.size})}
}
