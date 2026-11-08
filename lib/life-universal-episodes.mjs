/**
 * Life Episode is a causal context ledger, NOT another memory store, platform
 * receipt, prompt transcript, task queue or sending authorization.
 * Every record must be backed by a canonical source receipt. Per-account
 * references are one-way digests; no BV, UID, comment, title or model prose.
 */
import {createHash,randomBytes} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {withPlannerLedgerLock} from './life-planner-atomic.mjs'

const ACCOUNT=/^[a-f0-9]{16}$/, ID=/^[a-f0-9]{24}$/
const HOUR=3600_000,DAY=24*HOUR,MAX_BYTES=110_000
const ACTION=/^[a-z][a-z0-9_-]{1,45}$/
const VERIFIED=new Set(['verified','completed','considered'])
const ALLOWED=new Set(['verified','completed','considered','delegated','paused','blocked','unknown'])
const KIND=new Set(['video','todo','social','reflection','exploration','other'])
const digest=(account,source)=>createHash('sha256').update('life-episode-v1\0'+account+'\0'+source).digest('hex').slice(0,24)
const blank=()=>({version:1,episodes:[]})
const makeId=()=>randomBytes(12).toString('hex')
const validRow=r=>r&&ID.test(r.id)&&ID.test(r.seriesId)&&ID.test(r.source)&&KIND.has(r.kind)&&
  Number.isSafeInteger(r.at)&&Number.isSafeInteger(r.lastAt)&&
  ['active','paused','review','completed'].includes(r.status)&&Array.isArray(r.steps)
export function createUniversalLifeEpisodes({stateDir,getAccountTag,now=Date.now}={}){
  if(!stateDir||typeof getAccountTag!=='function')throw TypeError('Life Episode requires account-scoped storage')
  const scope=()=>{const tag=String(getAccountTag()||'');if(!ACCOUNT.test(tag))throw Error('Life Episode account scope unavailable');return tag}
  const filename=account=>join(stateDir,'life-episodes',account+'.json')
  const safe=(path,dir=false)=>{
    if(!existsSync(path))return
    const st=lstatSync(path)
    if(st.isSymbolicLink()||(dir?!st.isDirectory():!st.isFile()||st.size>MAX_BYTES))throw Error('Life Episode unsafe storage')
  }
  const read=account=>{
    const folder=join(stateDir,'life-episodes'),path=filename(account);safe(folder,true);safe(path)
    if(!existsSync(path))return blank()
    const data=JSON.parse(readFileSync(path,'utf8'))
    if(data?.version!==1||!Array.isArray(data.episodes))throw Error('Life Episode version unsupported')
    return {version:1,episodes:data.episodes.filter(validRow).slice(-80)}
  }
  const write=(account,data)=>{
    const folder=join(stateDir,'life-episodes');mkdirSync(folder,{recursive:true,mode:0o700});safe(folder,true)
    const path=filename(account);safe(path)
    const content=JSON.stringify({version:1,episodes:data.episodes.slice(-80)})+'\n'
    if(Buffer.byteLength(content)>MAX_BYTES)throw Error('Life Episode size bound')
    const temp=path+'.'+makeId()+'.tmp'
    try{writeFileSync(temp,content,{flag:'wx',mode:0o600});renameSync(temp,path)}finally{try{rmSync(temp,{force:true})}catch{}}
  }
  const view=e=>({id:e.id,seriesId:e.seriesId,kind:e.kind,status:e.status,
    segment:e.segment,lastAt:e.lastAt,steps:e.steps.filter(x=>VERIFIED.has(x.outcome)).length,ageMinutes:Math.max(0,Math.floor((now()-e.lastAt)/60_000)),
    lastAction:e.steps.at(-1)?.action||'',lastOutcome:e.steps.at(-1)?.outcome||'',
    nextAt:e.nextAt||0,history:e.steps.slice(-5).map(x=>({action:x.action,outcome:x.outcome}))})
  const list=({limit=5,includeClosed=false}={})=>{
    const data=read(scope()),t=now()
    return data.episodes.filter(e=>e.lastAt<=t+60_000&&t-e.lastAt<7*DAY&&
      (includeClosed||['active','paused','review'].includes(e.status)))
      .sort((a,b)=>b.lastAt-a.lastAt).slice(0,Math.max(1,Math.min(20,limit))).map(view)
  }
  // A verified reflection/social event is part of a Life Episode but must
  // NOT trigger repeated empty model calls. Due requires a fresh, executable
  // intention from the original account-scoped opportunity ledger.
  const due=({eligibleSources=[],delayMs=2*60_000}={})=>{
    if(!Array.isArray(eligibleSources)||!eligibleSources.length)return false
    const account=scope(),sourceKeys=new Set(eligibleSources.slice(0,20).map(x=>digest(account,String(x))))
    const t=now()
    return read(account).episodes.some(e=>sourceKeys.has(e.source)&&e.status==='active'&&
      e.steps.some(x=>VERIFIED.has(x.outcome))&&t>=e.nextAt&&
      t-e.lastAt>=Math.max(60_000,delayMs))
  }
  // Observable continuity health, not a model decision or an execution
  // authority. Distinguish a one-step episode with no currently executable
  // canonical intention from voluntary pause and platform-unknown freeze.
  const health=({eligibleSources=[]}={})=>{
    const account=scope(),t=now()
    const eligible=new Set((Array.isArray(eligibleSources)?eligibleSources:[]).slice(0,20).map(x=>digest(account,String(x))))
    const recent=read(account).episodes.filter(e=>e.lastAt<=t+60_000&&t-e.lastAt<7*DAY)
    const active=recent.filter(e=>e.status==='active')
    const one=active.filter(e=>e.steps.filter(x=>VERIFIED.has(x.outcome)).length===1)
    return {active:active.length,firstStepOnly:one.length,
      staleFirstStep:one.filter(e=>t-e.lastAt>=60*60_000).length,
      firstStepWithoutEligibleSource:one.filter(e=>!eligible.has(e.source)).length,
      eligibleToResume:active.filter(e=>eligible.has(e.source)&&t>=e.nextAt).length,
      paused:recent.filter(e=>e.status==='paused').length,
      needsReview:recent.filter(e=>e.status==='review').length}
  }
  const sourceState=sourceRef=>{
    if(!sourceRef)return null
    const account=scope(),key=digest(account,sourceRef)
    const row=[...read(account).episodes].reverse().find(x=>x.source===key)
    return row?view(row):null
  }
  /** Exactly one record per canonical receipt. Do not call for model wishes. */
  const record=({accountTag,sourceRef,receiptId,action,outcome='verified',kind='other',parentId='',nextAt=0}={})=>{
    const account=scope(),t=now()
    if(accountTag&&accountTag!==account)return {ok:false,reason:'account-changed'}
    if(!sourceRef||String(sourceRef).length>240||!receiptId||String(receiptId).length>240||
      !ACTION.test(String(action||''))||!ALLOWED.has(outcome)||!KIND.has(kind))return {ok:false,reason:'invalid-evidence'}
    return withPlannerLedgerLock(stateDir,()=>{
      if(scope()!==account)return {ok:false,reason:'account-changed'}
      const data=read(account),source=digest(account,sourceRef),receipt=digest(account,'receipt:'+receiptId)
      const existing=data.episodes.find(e=>e.steps.some(s=>s.ref===receipt))
      if(existing)return {ok:true,duplicate:true,episode:view(existing)}
      let e=ID.test(parentId)?data.episodes.find(x=>x.id===parentId&&x.source===source&&(x.status==='active'||x.status==='paused'&&x.nextAt<=t)):null
      if(!e)e=[...data.episodes].reverse().find(x=>x.source===source&&(x.status==='active'||x.status==='paused'&&x.nextAt<=t)&&t-x.lastAt<3*DAY)
      if(!e){
        const prior=[...data.episodes].reverse().find(x=>x.source===source&&t-x.lastAt<7*DAY)
        const id=makeId()
        e={id,seriesId:prior?.seriesId||id,source,kind,segment:prior?prior.segment+1:1,
          at:t,lastAt:t,nextAt:t,status:'active',steps:[]}
        data.episodes.push(e)
      }
      const verified=VERIFIED.has(outcome)
      // A deferred model intention or uncertain outcome isn't a completed step.
      if(verified){
        e.steps.push({ref:receipt,action,outcome,at:t})
        e.status=e.steps.filter(x=>VERIFIED.has(x.outcome)).length>=5?'completed':'active'
        e.nextAt=Number.isSafeInteger(nextAt)&&nextAt>=t?nextAt:t+2*60_000
      }else if(outcome==='unknown'){e.status='review';e.nextAt=0}
      else if(outcome==='paused'){e.status='paused';e.nextAt=Math.max(t+15*60_000,Number(nextAt)||t+HOUR)}
      else if(outcome==='delegated'){e.status='active';e.nextAt=t+2*60_000}
      else{e.status='paused';e.nextAt=t+HOUR}
      if(!verified)e.steps.push({ref:receipt,action,outcome,at:t})
      // A non-verified entry doesn't consume the 5 verified-step limit, but a
      // pathological sequence of attempts is still bounded and kept separate.
      if(e.steps.length>8)e.steps=e.steps.slice(-8)
      e.lastAt=t
      data.episodes=data.episodes.filter(x=>t-x.lastAt<7*DAY).slice(-80)
      write(account,data)
      return {ok:true,created:!e.steps.slice(0,-1).length,episode:view(e)}
    },{now})
  }
  const pauseLatest=({accountTag,delayMs=HOUR}={})=>{
    const account=scope(),t=now()
    if(accountTag&&accountTag!==account)return {ok:false,reason:'account-changed'}
    return withPlannerLedgerLock(stateDir,()=>{
      if(scope()!==account)return {ok:false,reason:'account-changed'}
      const data=read(account),e=[...data.episodes].reverse().find(x=>x.status==='active')
      if(!e)return {ok:true,updated:false}
      e.status='paused';e.nextAt=t+Math.max(15*60_000,Math.min(DAY,delayMs));e.lastAt=t
      write(account,data);return {ok:true,updated:true,episode:view(e)}
    },{now})
  }
  return {record,list,due,health,sourceState,pauseLatest}
}
