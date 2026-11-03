/**
 * Bounded image-only B站 cover lookup. It is a network read, and therefore
 * participates in the same account-local request budget as inbox and MCP reads.
 * The metadata's pic URL is untrusted input: reject non-image hosts and
 * redirects rather than letting DSH fetch arbitrary addresses.
 */
const validBV=value=>/^BV[0-9A-Za-z]{10}$/.test(String(value||''))
const allowedImage=url=>{
  let parsed
  try{parsed=new URL(String(url||''))}catch{return ''}
  if(parsed.protocol!=='https:'||parsed.port||parsed.username||parsed.password)return ''
  if(!/^(?:i[0-2]\.hdslb\.com|archive\.biliimg\.com)$/i.test(parsed.hostname))return ''
  return parsed.href
}

async function limitedImageBody(response,maxBytes){
  const len=Number(response.headers?.get('content-length')||0)
  if(!Number.isFinite(len)||len>maxBytes)return null
  if(!response.body?.getReader){
    const all=Buffer.from(await response.arrayBuffer())
    return all.byteLength<=maxBytes?all:null
  }
  const reader=response.body.getReader(),chunks=[]
  let total=0
  try{
    while(true){
      const {done,value}=await reader.read()
      if(done)break
      const bytes=Buffer.from(value||[])
      total+=bytes.length
      if(total>maxBytes){await reader.cancel().catch(()=>{});return null}
      chunks.push(bytes)
    }
  }finally{try{reader.releaseLock()}catch{}}
  return Buffer.concat(chunks,total)
}

export async function fetchBiliCover(bv,{readBudget,fetchImpl=globalThis.fetch,maxBytes=5*1024*1024}={}){
  if(!validBV(bv))return null
  if(typeof readBudget?.guard!=='function')throw TypeError('封面读取必须提供统一请求预算')
  const metadata=await readBudget.guard('cover-metadata',async()=>{
    const res=await fetchImpl('https://api.bilibili.com/x/web-interface/view?bvid='+bv,{
      signal:AbortSignal.timeout(8000),
      headers:{'user-agent':'Mozilla/5.0',referer:'https://www.bilibili.com/'},
    })
    const json=await res.json().catch(()=>null)
    return {status:res.status,code:json?.code,data:json?.data}
  })
  if(metadata.status!==200||metadata.code!==0)return null
  const url=allowedImage(metadata.data?.pic)
  if(!url)return null
  const image=await readBudget.guard('cover-image',()=>fetchImpl(url,{
    redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{'user-agent':'Mozilla/5.0',referer:'https://www.bilibili.com/'},
  }))
  if(!image.ok)return null
  const type=String(image.headers?.get('content-type')||'').split(';')[0].trim().toLowerCase()
  if(!/^image\/(?:jpeg|png|webp|gif)$/.test(type))return null
  const buf=await limitedImageBody(image,maxBytes)
  return buf?{buf,type}:null
}
