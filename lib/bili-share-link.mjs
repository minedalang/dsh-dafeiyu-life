/** Strict Bilibili share-link parser/resolver. Never follows an off-site redirect,
 * sends cookies, accepts URL credentials/ports, or fetches arbitrary hosts.
 * Short-link resolution happens only after Life voluntarily chooses to inspect.
 */
const HOSTS=new Set(['b23.tv','bilibili.com','www.bilibili.com','m.bilibili.com','t.bilibili.com','space.bilibili.com'])
const BV=/^BV[0-9A-Za-z]{10}$/
const ID=/^[1-9][0-9]{5,19}$/
const SHORT=/^[A-Za-z0-9_-]{4,32}$/
const trimTail=value=>String(value||'').replace(/[\s\u0000-\u001f<>"'`]+$/g,'').replace(/[，。！？；：、）》】」』）\]}.,!?;:]+$/g,'')
function safeUrl(raw){
  try{
    const url=new URL(String(raw||''))
    if(url.protocol!=='https:'||!HOSTS.has(url.hostname.toLowerCase())||url.username||url.password||url.port||url.hash)return null
    if(url.hostname.toLowerCase()==='b23.tv'&&!/^\/[A-Za-z0-9_-]{4,32}\/?$/.test(url.pathname))return null
    return url
  }catch{return null}
}
export function parseBiliShareUrl(raw){
  const url=safeUrl(trimTail(raw));if(!url)return null
  const host=url.hostname.toLowerCase(),path=url.pathname.replace(/\/+$/,'')||'/'
  if(host==='b23.tv'){
    const code=path.slice(1)
    return SHORT.test(code)?{kind:'short',code}:null
  }
  if(host==='space.bilibili.com'){
    const uid=path.slice(1)
    return ID.test(uid)?{kind:'profile',uid}:null
  }
  const video=['bilibili.com','www.bilibili.com','m.bilibili.com'].includes(host)?/^\/video\/(BV[0-9A-Za-z]{10}|av[1-9][0-9]{1,14})$/i.exec(path):null
  if(video){
    const value=video[1]
    return /^BV/i.test(value)?{kind:'video',bvid:'BV'+value.slice(2)}:{kind:'video',aid:value.slice(2)}
  }
  const opus=['bilibili.com','www.bilibili.com','m.bilibili.com'].includes(host)?/^\/(?:opus|dynamic)\/([1-9][0-9]{5,19})$/.exec(path):null
  if(opus)return {kind:'dynamic',dynamicId:opus[1]}
  if(host==='t.bilibili.com'||host==='m.bilibili.com'){
    const dynamic=/^\/([1-9][0-9]{5,19})$/.exec(path)
    if(dynamic)return {kind:'dynamic',dynamicId:dynamic[1]}
  }
  return null
}
export function extractBiliShareLinks(text,{limit=2}={}){
  const source=String(text||'').slice(0,4000).replace(/\\\//g,'/'),cap=Math.max(1,Math.min(4,Number(limit)||2))
  const matches=source.match(/https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/gi)||[],out=[],seen=new Set()
  for(const match of matches){
    const parsed=parseBiliShareUrl(match)
    if(!parsed)continue
    const key=JSON.stringify(parsed)
    if(seen.has(key))continue
    seen.add(key);out.push(parsed)
    if(out.length>=cap)break
  }
  return out
}
const allowedRedirect=url=>url instanceof URL&&Boolean(safeUrl(url.href))
export async function resolveBiliShareLink(ref,{fetchImpl=globalThis.fetch,maxHops=5,timeoutMs=6000}={}){
  if(!ref||typeof ref!=='object')return {ok:false,code:'invalid-link-ref'}
  if(ref.kind!=='short'){
    if(ref.kind==='dynamic'&&ID.test(String(ref.dynamicId||'')))return {ok:true,kind:'dynamic',dynamicId:String(ref.dynamicId),canonicalUrl:'https://t.bilibili.com/'+String(ref.dynamicId)}
    if(ref.kind==='video'&&(BV.test(String(ref.bvid||''))||/^[1-9][0-9]{1,14}$/.test(String(ref.aid||''))))return {ok:true,kind:'video',...(ref.bvid?{bvid:ref.bvid}:{aid:String(ref.aid)})}
    if(ref.kind==='profile'&&ID.test(String(ref.uid||''))&&Number.isSafeInteger(Number(ref.uid)))return {ok:true,kind:'profile',uid:String(ref.uid),canonicalUrl:'https://space.bilibili.com/'+String(ref.uid)}
    return {ok:false,code:'unsupported-bilibili-link'}
  }
  if(!SHORT.test(String(ref.code||''))||typeof fetchImpl!=='function')return {ok:false,code:'invalid-short-link'}
  let current=new URL('https://b23.tv/'+ref.code)
  for(let hop=0;hop<Math.max(1,Math.min(6,maxHops));hop++){
    if(!allowedRedirect(current))return {ok:false,code:'offsite-redirect-blocked'}
    const already=parseBiliShareUrl(current.href)
    if(already&&already.kind!=='short')return resolveBiliShareLink(already,{fetchImpl,maxHops,timeoutMs})
    if(!already)return {ok:false,code:'unsupported-bilibili-link'}
    let response
    try{
      response=await fetchImpl(current.href,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',
        headers:{Accept:'text/html,application/xhtml+xml'},signal:AbortSignal.timeout(timeoutMs)})
    }catch{return {ok:false,code:'short-link-network-error'}}
    if(response?.body?.cancel)try{await response.body.cancel()}catch{}
    const status=Number(response?.status||0)
    if([301,302,303,307,308].includes(status)){
      const location=response.headers?.get?.('location')
      if(!location)return {ok:false,code:'redirect-location-missing'}
      let next
      try{next=new URL(location,current)}catch{return {ok:false,code:'redirect-location-invalid'}}
      if(!allowedRedirect(next))return {ok:false,code:'offsite-redirect-blocked'}
      current=next;continue
    }
    const parsed=parseBiliShareUrl(current.href)
    if(parsed&&parsed.kind!=='short')return resolveBiliShareLink(parsed,{fetchImpl,maxHops,timeoutMs})
    return {ok:false,code:status===200?'short-link-not-resolved':'short-link-http-error'}
  }
  return {ok:false,code:'redirect-hop-limit'}
}
export const __test={safeUrl,allowedRedirect,trimTail,HOSTS}
