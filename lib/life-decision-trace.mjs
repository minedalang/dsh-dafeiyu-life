/**
 * A bounded local debugging journal for actual Life Agent turns. It does NOT
 * record prompts, model prose, UIDs, video identifiers, filenames or targets.
 * Account-scoped, read-only from the management console and not model memory.
 */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

const ID=/^[0-9a-f-]{36}$/i, SCOPE=/^[0-9a-f]{16}$/i
const ROOT='life-decision-traces', MAX_STEPS=96, MAX_RUNS=60, MAX_AGE=7*86400000
const TYPES=new Set(['start','candidate-scan','context-evidence','quota-reserved','video-round-feedback','episode-context','video-comment-summary','model-call','model-choice','preflight','action-start','read-result','memory-projection','next-wake','action-result','delegation-result','event-settlement','journal','finish','error','blocked','candidate-detail','model-input','model-output','execution-plan','execution-result','event-resolution','unknown-stage'])
const cleanCode=value=>{
  const s=String(value??'').slice(0,64)
  return /^[a-z0-9][a-z0-9._-]*$/i.test(s)?s:'unclassified'
}
const sanitize=fields=>{
  const out={}
  for(const key of ['action','result','code','reason','mode','trigger','tool','state','origin','layer','reservationReason','latestOutcome','kind','platform','selection','modelScene','modelValidity','delivery','eventStatus','restReasonCode']){
    if(Object.hasOwn(fields||{},key))out[key]=cleanCode(fields[key])
  }
  for(const key of ['episodeCount','episodeOffered','todos','cues','intentions','opportunities','social','video','reflection','eventCount','charged','waiting','review','provided','picked','reviewed','wanted','passed','insufficient','reviewRejected','proposed','approved','blocked','verified','unverified','ageMinutes','inputChars','outputChars','menuCount','reasonChars','targetCount','candidateCount','eventAgeMinutes']){
    if(Number.isSafeInteger(fields?.[key])&&fields[key]>=0)out[key]=Math.min(10000,fields[key])
  }
  if(Object.hasOwn(out,'restReasonCode')&&!['need-rest','not-now','not-interested','need-evidence','avoid-disturb','no-priority'].includes(out.restReasonCode))delete out.restReasonCode
  if(typeof fields?.latestPickedKnown==='boolean')out.latestPickedKnown=fields.latestPickedKnown
  if(typeof fields?.reasonProvided==='boolean')out.reasonProvided=fields.reasonProvided
  for(const key of ['promptHash','targetRef']){
    if(typeof fields?.[key]==='string'&&/^[a-f0-9]{16}$/.test(fields[key]))out[key]=fields[key]
  }
  // Code-only representations: no model prompt, private messages, UIDs, BVIDs,
  // freeform model rationale, addresses or usernames in ordinary Life traces.
  for(const key of ['menuActions','contextSources']){
    if(Array.isArray(fields?.[key]))out[key]=[...new Set(fields[key].map(cleanCode))].slice(0,30)
  }
  if(['selection-reader-timeout','selection-ledger-busy','selection-ledger-unavailable','selection-ledger-missing','account-not-ready'].includes(fields?.selectionLedgerCode))
    out.selectionLedgerCode=fields.selectionLedgerCode
  if(typeof fields?.modelCallMs==='number'&&Number.isFinite(fields.modelCallMs))out.modelCallMs=Math.max(0,Math.min(600000,Math.round(fields.modelCallMs)))
  if(Array.isArray(fields?.eventRefs))out.eventRefs=fields.eventRefs.filter(x=>typeof x==='string'&&/^[a-f0-9]{16}$/.test(x)).slice(0,4)
  if(Number.isSafeInteger(fields?.platformCode)&&fields.platformCode!==0&&Math.abs(fields.platformCode)<=99999)out.platformCode=fields.platformCode
  return out
}
const safeDir=path=>{if(existsSync(path)){const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Life 决策诊断目录不安全')}}
const safeFile=path=>{if(existsSync(path)){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>75000)throw Error('Life 决策诊断文件不安全')}}
export function createLifeDecisionTrace({dataDir,getAccountTag,now=Date.now}={}){
  if(!dataDir||typeof getAccountTag!=='function')throw TypeError('Life 决策诊断依赖缺失')
  const scope=()=>{const tag=getAccountTag();if(!SCOPE.test(String(tag||'')))throw Error('当前 Life 账号尚未核验');return createHash('sha256').update(String(tag)).digest('hex').slice(0,24)}
  const directory=()=>{
    const base=join(dataDir,ROOT);safeDir(dataDir);safeDir(base);mkdirSync(base,{recursive:true,mode:0o700})
    const dir=join(base,scope());safeDir(dir);mkdirSync(dir,{recursive:true,mode:0o700});return dir
  }
  const write=(file,row)=>{
    safeFile(file);const tmp=file+'.'+randomUUID()+'.tmp'
    try{writeFileSync(tmp,JSON.stringify(row)+'\n',{flag:'wx',mode:0o600});renameSync(tmp,file)}finally{try{rmSync(tmp,{force:true})}catch{}}
  }
  const prune=dir=>{
    const names=readdirSync(dir).filter(name=>ID.test(name.slice(0,-5))&&name.endsWith('.json'))
      .map(name=>({name,at:lstatSync(join(dir,name)).mtimeMs})).sort((a,b)=>a.at-b.at)
    for(const item of names.filter((row,i)=>i<Math.max(0,names.length-MAX_RUNS)||row.at<now()-MAX_AGE)){
      try{rmSync(join(dir,item.name),{force:true})}catch{}}
  }
  const begin=({mode='off',trigger='automatic'}={})=>{
    const dir=directory(),id=randomUUID(),account=scope(),startedAt=now()
    const file=join(dir,id+'.json')
    const row={version:1,id,at:startedAt,updatedAt:startedAt,mode:cleanCode(mode),trigger:cleanCode(trigger),state:'running',steps:[]}
    const step=(type,fields={})=>{
      if(row.steps.length>=MAX_STEPS)return
      if(scope()!==account)throw Error('Life 决策诊断账号已切换')
      row.steps.push({at:now(),type:TYPES.has(type)?type:'unknown-stage',...sanitize(fields),...(TYPES.has(type)?{}:{code:'unsupported-trace-stage'})})
      row.updatedAt=now();write(file,row)
    }
    write(file,row);prune(dir)
    return {id,step,discard:()=>{if(scope()===account)rmSync(file,{force:true})},finish:fields=>{
      if(scope()!==account)return
      const result=sanitize(fields||{})
      row.state=result.state||'finished';step('finish',result)
      row.state=result.state||'finished';write(file,row)
    }}
  }
  const list=({limit=20}={})=>{
    const dir=directory(),cutoff=now()-MAX_AGE
    const records=[]
    for(const name of readdirSync(dir).filter(x=>x.endsWith('.json')&&ID.test(x.slice(0,-5))).sort().reverse().slice(0,MAX_RUNS)){
      try{const file=join(dir,name);safeFile(file);const row=JSON.parse(readFileSync(file,'utf8'))
        if(row?.version===1&&row.id===name.slice(0,-5)&&row.at>=cutoff&&row.at<=now()+60000)
          records.push(row)
      }catch{}
    }
    return {ok:true,runs:records.sort((a,b)=>b.at-a.at).slice(0,Math.max(1,Math.min(60,limit))).map(row=>({id:row.id,at:row.at,updatedAt:row.updatedAt,state:row.state,mode:row.mode,trigger:row.trigger,steps:row.steps}))}
  }
  const get=id=>{
    if(!ID.test(String(id||'')))return {ok:false,error:'无效诊断 ID'}
    const dir=directory(),file=join(dir,id+'.json');if(!existsSync(file))return {ok:false,error:'没有当前账号的该次诊断'}
    safeFile(file);const row=JSON.parse(readFileSync(file,'utf8'))
    return row?.version===1&&row.id===id&&row.at>=now()-MAX_AGE?{ok:true,run:row}:{ok:false,error:'诊断已过期或不兼容'}
  }
  return {begin,list,get}
}
