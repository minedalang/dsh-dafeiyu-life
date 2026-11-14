/**
 * Per-intention EPHEMERAL context for Life's public exploration decisions.
 * This is not Life Memory, a platform receipt, or a sending authorization.
 * Only public, bounded observations and the fish's own decisions may enter.
 * Canonical Life opportunity receipts remain the sole execution evidence.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync,rmSync,readdirSync} from 'node:fs'
import {join} from 'node:path'
import {randomBytes} from 'node:crypto'
import {withPlannerLedgerLock} from './life-planner-atomic.mjs'

const TAG=/^[a-f0-9]{16}$/, EP=/^[a-f0-9]{24}$/, BV=/^BV[0-9A-Za-z]{10}$/
const DAY=86_400_000,TTL=7*DAY,MAX_BYTES=64_000,MAX_EVENTS=24
const ACTION=/^[a-z][a-z0-9_-]{1,50}$/
const sanitized=x=>String(x??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()
// Do not persist public snippets containing contact or secret-like material.
const unsafe=x=>/(?:\b\d{8,}\b|(?:1[3-9]\d{9})|(?:token|cookie|api.?key|password|验证码|身份证|手机号|家庭住址|邮箱|私信|聊天记录)|https?:\/\/\S+)/i.test(x)
const clean=(x,n)=>{const value=sanitized(x).slice(0,n);return unsafe(value)?'':value}
const compactVideo=x=>{
  if(!BV.test(String(x?.bvid||'')))return null
  const title=clean(x?.title,120)
  return {bvid:x.bvid,...(title?{title}:{})}
}
const compactEvidence=x=>{
  if(!x||typeof x!=='object')return null
  const verified=x.verified===true
  // Never restore a speculative action or cached model answer as a receipt.
  const bvid=BV.test(String(x.bvid||''))?x.bvid:''
  const title=verified?clean(x.title,120):''
  const description=verified?clean(x.description,480):''
  const excerpts=verified?(Array.isArray(x.discussionExcerpts)?x.discussionExcerpts:[])
    .slice(0,4).map(v=>clean(v,260)).filter(Boolean):[]
  const videos=verified?(Array.isArray(x.videos)?x.videos:[]).slice(0,5).map(compactVideo).filter(Boolean):[]
  const observations=verified?(Array.isArray(x.observations)?x.observations:[])
    .slice(0,6).map(v=>clean(v,140)).filter(Boolean):[]
  return {verified,...(bvid?{bvid}:{}),...(title?{title}:{}),...(description?{description}:{}),
    ...(excerpts.length?{discussionExcerpts:excerpts}:{}),...(videos.length?{videos}:{}),
    ...(observations.length?{observations}:{}),
    ...(Number.isSafeInteger(x.count)&&x.count>=0?{count:Math.min(100_000,x.count)}:{})}
}
const compactEvent=(x,at)=>{
  const type=['decision','result','opening'].includes(String(x?.type))?x.type:null
  if(!type)return null
  const action=ACTION.test(String(x.action||''))?x.action:''
  const event={type,at,action}
  if(type==='opening'&&ACTION.test(String(x.source||'')))event.source=String(x.source)
  if(type==='decision'){
    event.reason=clean(x.reason,260)
    event.offered=(Array.isArray(x.offered)?x.offered:[]).filter(v=>ACTION.test(String(v))).slice(0,20)
  }
  if(type==='result'){
    event.outcome=['verified','blocked','unknown','paused','closed','not-started'].includes(x.outcome)?x.outcome:'not-started'
  }
  const evidence=compactEvidence(x.evidence)
  if(evidence)event.evidence=evidence
  return event
}
const safe=(path,dir=false)=>{
  if(!existsSync(path))return
  const s=lstatSync(path)
  if(s.isSymbolicLink()||(dir?!s.isDirectory():!s.isFile()||s.size>MAX_BYTES))throw Error('Episode temporary session storage unsafe')
}
export function createLifeEpisodeSessions({stateDir,getAccountTag,now=Date.now}={}){
  if(!stateDir||typeof getAccountTag!=='function')throw TypeError('Episode session needs account scope')
  const scope=()=>{const a=String(getAccountTag()||'');if(!TAG.test(a))throw Error('Episode session account unavailable');return a}
  const loc=(account,id)=>{
    if(!TAG.test(account)||!EP.test(id))throw Error('Invalid Episode scope')
    const root=join(stateDir,'life-episode-sessions'),dir=join(root,account)
    safe(root,true);safe(dir,true)
    return {root,dir,file:join(dir,id+'.json')}
  }
  const load=(account,id)=>{
    const {file}=loc(account,id);safe(file)
    if(!existsSync(file))return {version:1,account,id,createdAt:now(),updatedAt:now(),events:[]}
    const data=JSON.parse(readFileSync(file,'utf8'))
    if(data?.version!==1||data.account!==account||data.id!==id||!Array.isArray(data.events))throw Error('Episode session format invalid')
    if(now()-Number(data.updatedAt||0)>TTL)return {version:1,account,id,createdAt:now(),updatedAt:now(),events:[]}
    return data
  }
  const append=({accountTag,episodeId,...entry}={})=>{
    const account=scope()
    if(accountTag&&accountTag!==account)return {ok:false,reason:'account-changed'}
    if(!EP.test(String(episodeId||'')))return {ok:false,reason:'invalid-episode'}
    const item=compactEvent(entry,now())
    if(!item)return {ok:false,reason:'invalid-entry'}
    return withPlannerLedgerLock(stateDir,()=>{
      if(scope()!==account)return {ok:false,reason:'account-changed'}
      const {root,dir,file}=loc(account,episodeId)
      mkdirSync(dir,{recursive:true,mode:0o700});safe(root,true);safe(dir,true);safe(file)
      const data=load(account,episodeId)
      data.updatedAt=now()
      data.events.push(item)
      data.events=data.events.slice(-MAX_EVENTS)
      let body=JSON.stringify(data)+'\n'
      // Prioritize most recent episode evidence if the temporary context grows.
      while(Buffer.byteLength(body)>MAX_BYTES-2048&&data.events.length>1){data.events.shift();body=JSON.stringify(data)+'\n'}
      if(Buffer.byteLength(body)>MAX_BYTES-2048)return {ok:false,reason:'session-full'}
      const tmp=file+'.'+randomBytes(8).toString('hex')+'.tmp'
      try{writeFileSync(tmp,body,{flag:'wx',mode:0o600});renameSync(tmp,file)}finally{rmSync(tmp,{force:true})}
      return {ok:true,events:data.events.length}
    },{now})
  }
  const context=({accountTag,episodeId}={})=>{
    const account=scope()
    if(accountTag&&accountTag!==account||!EP.test(String(episodeId||'')))return {events:[]}
    const data=load(account,episodeId)
    // Store detailed evidence locally; send bounded chronological context to
    // the model to avoid unbounded input tokens while preserving actual history.
    const events=data.events.slice(-16)
    const serial=JSON.stringify(events)
    return {events,characters:serial.length,updatedAt:data.updatedAt}
  }
  const finish=({accountTag,episodeId}={})=>{
    const account=scope()
    if(accountTag&&accountTag!==account||!EP.test(String(episodeId||'')))return {ok:false}
    return withPlannerLedgerLock(stateDir,()=>{
      const {file}=loc(account,episodeId);safe(file);rmSync(file,{force:true});return {ok:true}
    },{now})
  }
  const prune=()=>{
    const account=scope(),{dir}=loc(account,'0'.repeat(24))
    if(!existsSync(dir))return 0
    let removed=0
    for(const name of readdirSync(dir).filter(x=>EP.test(x.replace(/\.json$/,''))&&x.endsWith('.json')).slice(0,160)){
      const id=name.slice(0,-5),file=loc(account,id).file;safe(file)
      const mtime=lstatSync(file).mtimeMs
      if(now()-mtime>=TTL){rmSync(file,{force:true});removed++}
    }
    return removed
  }
  return {append,context,finish,prune}
}
