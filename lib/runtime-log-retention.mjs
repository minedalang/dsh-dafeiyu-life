/** Disposable diagnostic files only. No memory, platform transaction/receipt,
 * task, credential, user report or backup is a target of this maintenance. */
import {lstatSync,openSync,closeSync,readSync,writeSync,fstatSync,constants,renameSync,rmSync,readdirSync,writeFileSync} from 'node:fs'
import {join,resolve,dirname,parse} from 'node:path'
import {randomUUID} from 'node:crypto'
import {withDurableFileLock} from './durable-file-lock.mjs'
import {formatLocalLogTimestamp} from './log-time.mjs'
const DAY=86400_000,MiB=1024*1024
export const RUNTIME_LOG_RETENTION=Object.freeze({days:7,maxBytes:2*MiB,interval:60*60_000,discussionDays:7,socialDiagnosticDays:30,modelInvocationDays:7,modelUsageMonths:24,traceDays:7,traceMaxRuns:60,orphanRoundDays:7})
export const RUNTIME_LOG_SOURCES=Object.freeze(['duty.log.1','duty.log','install.log','asr-install.log'])
const ACTIVE=new Set(RUNTIME_LOG_SOURCES.slice(1)),LOCK='.runtime-log-maintenance.lock'
const stat=p=>lstatSync(p,{throwIfNoEntry:false})
function safeDirectory(path){
  const chain=[];let p=resolve(path);while(p!==parse(p).root){chain.push(p);p=dirname(p)}
  for(const part of chain.reverse()){const s=stat(part);if(!s)return false;if(!s.isDirectory()||s.isSymbolicLink())throw Error('unsafe-log-directory')}
  return true
}
function regular(path){const s=stat(path);if(s&&(!s.isFile()||s.isSymbolicLink()||s.nlink!==1))throw Error('unsafe-log-file');return s}
const same=(a,b)=>Boolean(a&&b&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs)
const timeHeader=/^(?:===\s*)?(\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?)(?=\s|$)/
const headerTime=line=>{const match=timeHeader.exec(line);return match?Date.parse(match[1]):NaN}
function boundedTail(path,s,maxBytes){
  const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{
    const opened=fstatSync(fd);if(!same(s,opened))throw Error('log-changed')
    const start=Math.max(0,s.size-maxBytes),buffer=Buffer.alloc(s.size-start);let n=0
    while(n<buffer.length){const got=readSync(fd,buffer,n,buffer.length-n,start+n);if(!got)break;n+=got}
    if(n!==buffer.length||!same(s,fstatSync(fd)))throw Error('log-changed')
    if(!start)return buffer.toString('utf8')
    const newline=buffer.indexOf(10);return newline<0?'':buffer.subarray(newline+1).toString('utf8')
  }finally{closeSync(fd)}
}
function trimText(raw,s,cutoff,truncated=false){
  // Each stamped event owns its following undated child-output lines. Legacy
  // undated leading data has no reliable time: use file birth time (or mtime).
  let keep=!truncated&&Number(s.birthtimeMs||s.mtimeMs)>cutoff,output=[]
  for(const line of raw.split(/(?<=\n)/)){
    const at=headerTime(line);if(Number.isFinite(at))keep=at>cutoff
    if(keep)output.push(line)
  }
  return output.join('')
}
function replaceIfCurrent(path,s,text){
  if(!same(s,regular(path)))throw Error('log-changed')
  if(!text){rmSync(path);return}
  const tmp=path+'.'+randomUUID()+'.logtmp'
  try{writeFileSync(tmp,text,{flag:'wx',mode:0o600});if(!same(s,regular(path)))throw Error('log-changed');renameSync(tmp,path)}
  finally{try{rmSync(tmp,{force:true})}catch{}}
}
function trimFile(path,{now,maxBytes,days,jsonl=false}){
  const s=regular(path);if(!s)return false
  const cutoff=now-days*DAY
  if(s.mtimeMs<=cutoff){replaceIfCurrent(path,s,'');return true}
  const raw=boundedTail(path,s,maxBytes)
  const text=jsonl?raw.split(/(?<=\n)/).filter(line=>{try{const at=Date.parse(JSON.parse(line).at);return Number.isFinite(at)&&at>cutoff}catch{return false}}).join(''):trimText(raw,s,cutoff,s.size>maxBytes)
  if(s.size>maxBytes||text!==raw){replaceIfCurrent(path,s,text);return true}
  return false
}
export function withRuntimeLogLock(root,fn){
  if(!safeDirectory(root))throw Error('missing-log-directory')
  const lock=join(root,LOCK);regular(lock)
  return withDurableFileLock(lock,fn)
}
/** Shared host writer, independent of video round completion. Never throw into
 * a Life/installation operation. Python's duty.log appends share this lock. */
export function appendRuntimeLog(root,name,message,{now=Date.now()}={}){
  if(!ACTIVE.has(name))return false
  try{return withRuntimeLogLock(root,()=>{
    const path=join(root,name),cap=RUNTIME_LOG_RETENTION.maxBytes
    const prefix=formatLocalLogTimestamp(new Date(now))+'  '
    let text=String(message??'');if(!text.endsWith('\n'))text+='\n'
    // Limit one pathological child-output chunk, keeping the newest complete
    // UTF-8 lines; never allocate/read an unbounded existing log.
    if(Buffer.byteLength(prefix+text)>cap){const bytes=Buffer.from(text);const tail=bytes.subarray(Math.max(0,bytes.length-cap+Buffer.byteLength(prefix)+64));const nl=tail.indexOf(10);text='[日志输出过长，保留尾部]\n'+(nl<0||nl===tail.length-1?tail.toString('utf8').replace(/^\uFFFD+/,''):tail.subarray(nl+1).toString('utf8'))}
    const data=Buffer.from(prefix+text);if(data.length>cap)return false
    const old=regular(path)
    if(old&&old.size+data.length>cap){
      if(name==='duty.log'){
        // Only one rotated file. Trim its inherited oversized/expired data
        // after rotation; never follow a pre-existing backup link.
        const bak=path+'.1';regular(bak);renameSync(path,bak)
        trimFile(bak,{now,maxBytes:cap,days:RUNTIME_LOG_RETENTION.days})
      }else{
        // Install/ASR viewers use a single filename; preserve the newest tail.
        const room=cap-data.length,raw=room>0?boundedTail(path,old,room):''
        replaceIfCurrent(path,old,trimText(raw,old,now-RUNTIME_LOG_RETENTION.days*DAY,old.size>room))
      }
    }
    const before=regular(path),fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_APPEND|(constants.O_NOFOLLOW||0),0o600)
    try{const st=fstatSync(fd);if(!st.isFile()||st.nlink!==1||(before&&(st.dev!==before.dev||st.ino!==before.ino)))throw Error('log-changed');writeSync(fd,data)}finally{closeSync(fd)}
    return true
  })}catch{return false}
}
const dayName=/^\d{4}-\d{2}-\d{2}\.jsonl$/,monthName=/^\d{4}-\d{2}\.jsonl$/
const localDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
/** All-account maintenance, not a Life wake. No arbitrary paths or recursive
 * deletes. Retry access/lock failures next hourly pass. */
export function pruneRuntimeLogs(root,{now=Date.now(),activeRoundId=''}={}){
  const result={removed:0,trimmed:0,failed:0,skipped:0}
  const run=fn=>{try{fn()}catch{result.failed++}}
  const remove=(path,s)=>{if(!same(s,regular(path)))throw Error('log-changed');rmSync(path);result.removed++}
  const trim=(path,policy)=>{if(trimFile(path,{now,...policy})){if(stat(path))result.trimmed++;else result.removed++}}
  const sweep=(folder,pattern,fn)=>run(()=>{if(!safeDirectory(folder))return;for(const name of readdirSync(folder))if(pattern.test(name))run(()=>{const path=join(folder,name),s=regular(path);if(s)fn(path,s,name)})})
  run(()=>withRuntimeLogLock(root,()=>{for(const name of RUNTIME_LOG_SOURCES)run(()=>trim(join(root,name),{maxBytes:RUNTIME_LOG_RETENTION.maxBytes,days:RUNTIME_LOG_RETENTION.days}))}))
  const today=new Date(now),dayCut=days=>localDate(new Date(today.getFullYear(),today.getMonth(),today.getDate()-(days-1)))
  const daily=(folder,days)=>sweep(join(root,folder),dayName,(path,s,name)=>{if(name.slice(0,10)<dayCut(days)&&s.mtimeMs<=now-DAY)remove(path,s)})
  daily('video-discussion-reads',RUNTIME_LOG_RETENTION.discussionDays)
  // A historical migration uses mention diagnostics as its only source on old
  // installs. Never delete until the original receipt migration completed.
  run(()=>{const path=join(root,'comment-ledger-import-v1.json'),s=regular(path);if(!s||s.size>4096)return;const marker=JSON.parse(boundedTail(path,s,4096));if(marker.version===1&&Number.isFinite(Date.parse(marker.completedAt)))daily('mention-diagnostics',RUNTIME_LOG_RETENTION.socialDiagnosticDays)})
  daily('meme-diagnostics',RUNTIME_LOG_RETENTION.socialDiagnosticDays)
  sweep(join(root,'video-round-observations'),/^[a-f0-9]{24}\.jsonl$/,(path,s,name)=>{if(name.slice(0,-6)!==activeRoundId&&s.mtimeMs<=now-RUNTIME_LOG_RETENTION.orphanRoundDays*DAY)remove(path,s)})
  run(()=>withRuntimeLogLock(root,()=>sweep(join(root,'model-invocations'),/^[a-f0-9]{16}\.jsonl(?:\.old)?$/,(path)=>trim(path,{maxBytes:512*1024,days:RUNTIME_LOG_RETENTION.modelInvocationDays,jsonl:true}))))
  // Model usage is statistical history, not ordinary log text. Keep the
  // exact existing 24-month lookup horizon, including the current month.
  const monthCut=localDate(new Date(today.getFullYear(),today.getMonth()-(RUNTIME_LOG_RETENTION.modelUsageMonths-1),1)).slice(0,7)
  sweep(join(root,'model-usage'),monthName,(path,s,name)=>{if(name.slice(0,7)<monthCut&&s.mtimeMs<=now-DAY)remove(path,s)})
  run(()=>{const traces=join(root,'life-decision-traces');if(!safeDirectory(traces))return
    for(const account of readdirSync(traces).filter(n=>/^[a-f0-9]{24}$/.test(n)))run(()=>{
      const folder=join(traces,account);if(!safeDirectory(folder))return
      const files=[];sweep(folder,/^[a-f0-9-]{36}\.json$/i,(path,s)=>files.push({path,s}))
      sweep(folder,/^[a-f0-9-]{36}\.json\.[a-f0-9-]{36}\.tmp$/i,(path,s)=>{if(s.mtimeMs<=now-DAY)remove(path,s)})
      files.sort((a,b)=>b.s.mtimeMs-a.s.mtimeMs)
      for(const [i,{path,s}] of files.entries())if(s.mtimeMs<=now-RUNTIME_LOG_RETENTION.traceDays*DAY||(i>=RUNTIME_LOG_RETENTION.traceMaxRuns&&s.mtimeMs<=now-DAY))run(()=>remove(path,s))
    })
  })
  // Interrupted atomic rewrites only; exact generated temp names, old files.
  sweep(join(root,'model-invocations'),/^[a-f0-9]{16}\.jsonl(?:\.old)?\.[a-f0-9-]{36}\.logtmp$/i,(path,s)=>{if(s.mtimeMs<=now-DAY)remove(path,s)})
  sweep(root,/^(?:duty\.log(?:\.1)?|install\.log|asr-install\.log)\.[a-f0-9-]{36}\.logtmp$/i,(path,s)=>{if(s.mtimeMs<=now-DAY)remove(path,s)})
  return result
}
