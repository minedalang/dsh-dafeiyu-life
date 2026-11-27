import {openSync,closeSync,readSync,lstatSync,fstatSync,constants} from 'node:fs'
import {join} from 'node:path'
// Fixed files only. Do not expose raw messages, model prompts, private text, paths or credentials.
const SOURCES=['duty.log.1','duty.log','install.log','asr-install.log']
const MAX_BYTES=8*1024*1024,MAX_ROWS=20000
const categories=[['rate-limit',/限流|风控|(?:^|\W)429(?:\W|$)|-509/iu],['timeout',/超时|timed?\s*out|timeout/iu],['network',/网络|连接失败|ECONN|ENOTFOUND|DNS|connection|network/iu],['model',/模型|headless|ollama|embedding|whisper/iu],['storage',/磁盘|写入|文件|备份|恢复|sqlite|EACCES|EPERM|ENOSPC/iu],['auth',/登录|凭据|授权|unauthorized|credential/iu]]
export function classifyRuntimeLine(line){
 const time=String(line).match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)(?=\s|$)/)?.[1]||null
 const level=/失败|异常|错误|超时|Traceback|(?:^|\W)(?:error|exception|failed|fatal|timeout|ECONN\w*|ENOSPC|EACCES|EPERM)(?:\W|$)/iu.test(line)?'error':/警告|退避|限流|warning|warn|deferred/iu.test(line)?'warning':'info'
 const category=categories.find(([,pattern])=>pattern.test(line))?.[0]||'other'
 const reason=String(line).match(/\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENOSPC|EACCES|EPERM|ENOENT|SQLITE_BUSY|SQLITE_CORRUPT|HTTP 429|HTTP 503)\b|(?:^|\s)-509(?:\s|$)/i)?.[0]?.trim()||null
 return {time,level,category,reason}
}
export function readRuntimeLogs(dir,{errorsOnly=false,exportAll=false}={}){
 const coverage=[],rows=[];let errors=0,matched=0
 for(const source of SOURCES){
  let fd
  try{
   const path=join(dir,source),before=lstatSync(path)
   if(!before.isFile()||before.isSymbolicLink())throw Error('not-regular-file')
   fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const st=fstatSync(fd)
   if(!st.isFile()||st.dev!==before.dev||st.ino!==before.ino)throw Error('file-changed')
   const start=Math.max(0,st.size-MAX_BYTES),buf=Buffer.alloc(st.size-start)
   let n=0;while(n<buf.length){const got=readSync(fd,buf,n,buf.length-n,start+n);if(!got)break;n+=got}
   let first=true,count=0,errorCount=0
   for(const line of buf.subarray(0,n).toString('utf8').split('\n')){
    if(first&&start>0){first=false;continue}first=false
    if(!line.trim())continue
    const row=classifyRuntimeLine(line);count++;if(row.level==='error'){errors++;errorCount++}
    if(errorsOnly&&row.level!=='error')continue
    matched++;rows.push({...row,source,record:count,windowStartByte:start});if(rows.length>MAX_ROWS*2)rows.splice(0,MAX_ROWS)
   }
   coverage.push({source,status:'read',bytes:st.size,readBytes:n,windowStartByte:start,truncated:start>0||n!==buf.length,records:count,errors:errorCount})
  }catch(e){coverage.push({source,status:e?.code==='ENOENT'?'absent':'unavailable'})}finally{if(fd!==undefined)closeSync(fd)}
 }
 const max=exportAll?MAX_ROWS:300
 return {ok:true,format:'runtime-log-summary/v1',capturedAt:new Date().toISOString(),coverage,errors,matched,omitted:Math.max(0,matched-max),rows:rows.sort((a,b)=>(Date.parse(b.time)||0)-(Date.parse(a.time)||0)||SOURCES.indexOf(b.source)-SOURCES.indexOf(a.source)||b.record-a.record).slice(0,max),rawIncluded:false}
}
