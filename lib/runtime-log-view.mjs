import {openSync,closeSync,readSync,lstatSync,fstatSync,constants} from 'node:fs'
import {join} from 'node:path'
// Fixed files only. Do not expose raw messages, model prompts, private text, paths or credentials.
const SOURCES=['duty.log.1','duty.log','install.log','asr-install.log']
const MAX_BYTES=8*1024*1024,MAX_ROWS=20000
const categories=[['rate-limit',/限流|风控|(?:^|\W)429(?:\W|$)|-509/iu],['timeout',/超时|timed?\s*out|timeout/iu],['network',/网络|连接失败|ECONN|ENOTFOUND|DNS|connection|network/iu],['model',/模型|headless|ollama|embedding|whisper/iu],['storage',/磁盘|写入|文件|备份|恢复|sqlite|EACCES|EPERM|ENOSPC/iu],['auth',/登录|凭据|授权|unauthorized|credential/iu]]
// Only emit known event labels, error codes and counts. Log lines can include
// arbitrary model output, private messages and credentials; regex redaction of
// arbitrary prose cannot establish that it is safe to expose in a browser.
const TIMESTAMP=/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)(?=\s|$)/
const EVENT_LABELS=[
 ['后台通知调度执行错误','后台通知调度执行错误'],['私信自动回复错误','私信自动回复错误'],['评论互动错误','评论互动错误'],['评论互动警告','评论互动警告'],['自主调度执行失败','自主生活调度执行失败'],['独立记忆检索路由不可用','独立记忆检索不可用'],['本地视觉模型安装或自检失败','本地视觉模型安装或自检失败'],['视觉识别失败','视觉识别失败'],['模型调用失败','模型调用失败'],['人生记忆','人生记忆'],['Life 深层观察附件','深层观察附件'],['Life 视觉记忆整合','视觉记忆整合'],['Life 局部视觉','局部视觉观察'],['互动 AI','互动模型'],['MCP 已就绪','MCP 就绪'],['MCP 子进程关闭','MCP 子进程关闭'],['刷B站开跑','视频探索开始'],['刷B站结束','视频探索结束'],['设置已保存并本地核验','设置保存回读'],['每日自动业务备份完成','自动业务备份完成'],['每日自动备份暂未完成','自动备份尚未完成'],['装转写依赖结束','语音依赖安装结束'],['本地语义回忆已就绪','本地语义回忆就绪'],['用户数据已备份到','业务备份完成'],['已挂载','插件加载'],['打开网页','打开管理中心'],['已更新','运行文件更新'],['schemastery','宿主依赖检测'],['dsh-tools','宿主工具依赖检测'],['自动找到 dsh','宿主程序发现'],['本轮视频工具漏斗','视频工具运行统计'],['评论复核开始','评论复核开始'],['评论复核结束','评论复核结束']]
const ERROR_DETAILS={ETIMEDOUT:'连接或请求超时',ECONNRESET:'连接被对端重置',ECONNREFUSED:'连接被拒绝',ENOTFOUND:'无法解析目标域名',EAI_AGAIN:'DNS 查询暂时失败',ENOSPC:'存储空间不足',EACCES:'访问权限不足',EPERM:'操作权限不足',ENOENT:'所需文件或目录不存在',SQLITE_BUSY:'数据库暂时被占用',SQLITE_CORRUPT:'数据库完整性错误','HTTP 429':'请求频率受限','HTTP 503':'服务暂时不可用','-509':'平台请求保护'}
export function classifyRuntimeLine(line){
 const text=String(line),time=text.match(TIMESTAMP)?.[1]||null,head=text.split('\n',1)[0].replace(TIMESTAMP,'').trim()
 const declared=head.match(/^\[?(INFO|WARN(?:ING)?|ERROR|FATAL|DEBUG)\]?(?:\s|:)/i)?.[1]?.toLowerCase()
 const level=declared?(['error','fatal'].includes(declared)?'error':declared.startsWith('warn')?'warning':'info'):/失败|异常|错误|超时|Traceback|(?:^|\W)(?:error|exception|failed|fatal|timeout|ECONN\w*|ENOSPC|EACCES|EPERM)(?:\W|$)/iu.test(text)?'error':/警告|退避|限流|warning|warn|deferred/iu.test(text)?'warning':'info'
 const category=categories.find(([,pattern])=>pattern.test(text))?.[0]||'other'
 const reason=text.match(/\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENOSPC|EACCES|EPERM|ENOENT|SQLITE_BUSY|SQLITE_CORRUPT|HTTP 429|HTTP 503)\b|(?:^|\s)-509(?:\s|$)/i)?.[0]?.trim().toUpperCase()||null
 const eventHead=declared?head.replace(/^\[?(?:INFO|WARN(?:ING)?|ERROR|FATAL|DEBUG)\]?(?:\s|:)\s*/i,''):head
 const label=EVENT_LABELS.find(([prefix])=>eventHead.startsWith(prefix)||eventHead.startsWith('⚠️ '+prefix)||eventHead.startsWith('🔒 '+prefix))?.[1]
 const exception=text.match(/\b(?:TypeError|ReferenceError|RangeError|SyntaxError|TimeoutError|ConnectionError|PermissionError|FileNotFoundError|ModuleNotFoundError|ImportError|MemoryError|RuntimeError)\b/)?.[0]||null
 const detail=reason?ERROR_DETAILS[reason]||reason:exception?`异常类型：${exception}`:null
 return {time,level,category,reason,message:label||detail||(level==='error'?'未识别的异常事件':level==='warning'?'未识别的警告事件':'未识别的运行事件'),detail:label?detail:null,exception}
}
export function parseRuntimeEvents(text,{source='',truncated=false}={}){
 const events=[];let lines=[],lineNo=0,startLine=1,first=true
 const emit=()=>{if(!lines.length)return;const content=lines.join('\n'),row=classifyRuntimeLine(content)
  if(!row.time&&/^(?:install|asr-install)\.log$/.test(source))row.message=row.level==='error'?'依赖安装输出中检测到异常':'依赖安装输出'
  events.push({...row,source,lineStart:startLine,lineCount:lines.length});lines=[]}
 for(const line of String(text).split(/\r?\n/)){
  lineNo++;if(first&&truncated){first=false;continue}first=false
  if(!line.trim())continue
  if(TIMESTAMP.test(line)){emit();startLine=lineNo}
  else if(!lines.length)startLine=lineNo
  lines.push(line)
 }
 emit();return events
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
   let count=0,errorCount=0
   for(const row of parseRuntimeEvents(buf.subarray(0,n).toString('utf8'),{source,truncated:start>0})){
    count++;if(row.level==='error'){errors++;errorCount++}
    if(errorsOnly&&row.level!=='error')continue
    matched++;rows.push({...row,record:count,windowStartByte:start});if(rows.length>MAX_ROWS*2)rows.splice(0,MAX_ROWS)
   }
   coverage.push({source,status:'read',bytes:st.size,readBytes:n,windowStartByte:start,truncated:start>0||n!==buf.length,records:count,errors:errorCount})
  }catch(e){coverage.push({source,status:e?.code==='ENOENT'?'absent':'unavailable'})}finally{if(fd!==undefined)closeSync(fd)}
 }
 const max=exportAll?MAX_ROWS:300
 return {ok:true,format:'runtime-log-summary/v2',capturedAt:new Date().toISOString(),coverage,errors,matched,omitted:Math.max(0,matched-max),rows:rows.sort((a,b)=>(Date.parse(b.time)||0)-(Date.parse(a.time)||0)||SOURCES.indexOf(b.source)-SOURCES.indexOf(a.source)||b.record-a.record).slice(0,max),rawIncluded:false}
}
