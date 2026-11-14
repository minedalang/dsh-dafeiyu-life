/** Local, account-scoped diagnostic journal for Host model calls only.
 * No prompts, replies, platform UIDs, raw errors, tokens or credentials are saved.
 * Video Headless subprocess model calls are NOT measured here.
 * All failures in telemetry are swallowed: diagnostics never break a model call.
 */
import {existsSync,lstatSync,mkdirSync,openSync,closeSync,writeSync,readFileSync,renameSync,constants as fsConstants} from 'node:fs'
import {join} from 'node:path'

const ACCOUNT=/^[a-f0-9]{16}$/
const SAFE=/^[A-Za-z0-9._-]{1,72}$/
const MAX_FILE=512*1024
const MAX_READ=100
const failureCategory=error=>{
  const s=String(error?.message||error||'').slice(0,800)
  if(/\b(502|503|504)\b|bad_response_status_code/i.test(s))return 'gateway-or-upstream'
  if(/\b429\b|rate.limit|限流/i.test(s))return 'rate-limited'
  if(/\b(401|403)\b|unauthorized|authentication|鉴权|认证/i.test(s))return 'authentication'
  if(/ETIMEDOUT|timeout|timed.out|超时/i.test(s))return 'timeout'
  if(/ECONN|ENOTFOUND|EAI_AGAIN|DNS|网络/i.test(s))return 'network'
  return 'model-error'
}
const safeFile=p=>{
  const s=lstatSync(p,{throwIfNoEntry:false})
  if(!s)return false
  if(!s.isFile()||s.isSymbolicLink()||s.size>2*1024*1024)throw Error('unsafe model journal file')
  return true
}

export function createModelInvocationJournal({dataDir,getAccountTag,now=Date.now}={}){
  if(!dataDir||typeof getAccountTag!=='function')throw TypeError('model journal requires local dataDir and account scope')
  const paths=()=>{
    const account=String(getAccountTag()||'')
    if(!ACCOUNT.test(account))return null
    const dir=join(dataDir,'model-invocations')
    if(existsSync(dir)){
      const s=lstatSync(dir)
      if(!s.isDirectory()||s.isSymbolicLink())return null
    }else mkdirSync(dir,{recursive:true,mode:0o700})
    const current=join(dir,account+'.jsonl'),previous=current+'.old'
    safeFile(current);safeFile(previous)
    return {current,previous}
  }
  function record({scene='unknown',provider='',model='',durationMs=0,error=null,at=now(),trigger='host',expectedScope}={}){
    try{
      if(expectedScope!==undefined&&String(expectedScope)!==String(getAccountTag()||''))return false
      const files=paths()
      if(!files)return false
      const date=new Date(at)
      if(!Number.isFinite(date.getTime()))return false
      const ms=Number(durationMs)
      const row={at:date.toISOString(),scene:SAFE.test(scene)?scene:'other',
        trigger:SAFE.test(trigger)?trigger:'host',provider:SAFE.test(provider)?provider:'unavailable',
        model:SAFE.test(model)?model:'unavailable',durationMs:Number.isFinite(ms)?Math.max(0,Math.min(1_800_000,Math.floor(ms))):0,
        result:error?'failed':'completed',errorKind:error?failureCategory(error):'',
        tokenUsage:'not-reported',coverage:'host-model-call'}
      // Rotate at a bounded size; keep at most two files for each verified account.
      // Never follow symlinks at either path. In a cross-process rotation race,
      // losing diagnostic lines is preferable to changing model-call behavior.
      if(safeFile(files.current)&&lstatSync(files.current).size>=MAX_FILE){
        safeFile(files.previous)
        renameSync(files.current,files.previous)
      }
      const flags=fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_APPEND|(fsConstants.O_NOFOLLOW||0)
      const fd=openSync(files.current,flags,0o600)
      try{writeSync(fd,JSON.stringify(row)+'\n')}finally{closeSync(fd)}
      return true
    }catch{return false}
  }
  function recent(limit=40){
    try{
      const files=paths()
      if(!files)return []
      const count=Math.max(1,Math.min(MAX_READ,Math.floor(Number(limit)||40)))
      const lines=[]
      for(const filename of [files.previous,files.current]){
        if(!safeFile(filename))continue
        for(const line of readFileSync(filename,'utf8').split('\n')){
          if(!line)continue
          try{
            const row=JSON.parse(line)
            if(row?.coverage==='host-model-call'&&['completed','failed'].includes(row.result))lines.push(row)
          }catch{}
        }
      }
      return lines.slice(-count)
    }catch{return []}
  }
  return {record,recent}
}
