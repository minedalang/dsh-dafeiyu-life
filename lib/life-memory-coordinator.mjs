/** Crash-resilient, per-sink life-event journal. All records are derived public
 * life-event evidence, never raw DM transcripts. */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {recordInterestEvents} from './life-interests.mjs'
const rel='life-memory/event-outbox.json'
const hash=v=>createHash('sha256').update(v).digest('hex').slice(0,32)
const jsonPath=dir=>join(dir,rel)
const blank=()=>({schema:1,pending:[],complete:[],lastError:'',updatedAt:0})
function load(file){if(!existsSync(file))return blank();const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>2*1024*1024)throw Error('人生经历协调日志不安全');const v=JSON.parse(readFileSync(file,'utf8'));if(v.schema!==1||!Array.isArray(v.pending)||!Array.isArray(v.complete)||v.pending.length>500)throw Error('人生经历协调日志格式无效');return v}
function save(file,v){mkdirSync(join(file,'..'),{recursive:true});if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝写入符号链接');const tmp=file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(v,null,2)+'\n',{mode:0o600});renameSync(tmp,file)}
export function createLifeMemoryCoordinator({dataDir,memoryGateway,lifeReflection,logger=console,now=Date.now}={}){
  if(!dataDir||!memoryGateway||!lifeReflection)throw TypeError('缺少人生记忆协调器依赖')
  const file=jsonPath(dataDir);let timer=null,busy=false,chain=Promise.resolve()
  const serialize=task=>{const step=chain.then(task,task);chain=step.catch(()=>{});return step}
  async function flushImpl(){if(busy)return {ok:false,busy:true,pending:load(file).pending.length};busy=true;const data=load(file);let completed=0
    try{for(const row of [...data.pending]){
      try{
        if(!row.episode){const r=memoryGateway.recordEvents(row.events);if(r?.ok===false)throw Error('经历库写入失败');row.episode=true;save(file,data)}
        if(row.reflect&&!row.candidate){const r=lifeReflection.addEvents(row.events);if(r?.ok===false)throw Error('反思候选写入失败');row.candidate=true;save(file,data)}
        if(!row.interest){recordInterestEvents(dataDir,row.events,now());row.interest=true;save(file,data)}
        data.pending=data.pending.filter(x=>x.id!==row.id);data.complete.push(row.id);data.complete=data.complete.slice(-20000);data.lastError='';data.updatedAt=now();save(file,data);completed++
      }catch(err){data.lastError=String(err?.message||err).slice(0,180);data.updatedAt=now();save(file,data);logger.warn?.('人生经历投影待补偿：'+data.lastError)}
    }return {ok:!data.pending.length,pending:data.pending.length,completed,lastError:data.lastError}
    }finally{busy=false}}
  async function recordEventsImpl(events=[],{reflect=true}={}){if(!Array.isArray(events)||!events.length)return {ok:true,skipped:'empty'}
    const valid=events.filter(x=>x&&typeof x.kind==='string'&&typeof x.key==='string'&&x.key.length<=240)
    if(!valid.length)return {ok:false,reason:'invalid-events'}
    const id=hash(valid.map(e=>e.kind+':'+e.key).join('|')+'|'+Boolean(reflect));const data=load(file)
    if(data.complete.includes(id))return {ok:true,duplicate:true,pending:data.pending.length}
    if(!data.pending.some(x=>x.id===id)){
      if(data.pending.length>=500)throw Error('人生事件待补偿队列已满')
      data.pending.push({id,events:valid,reflect:!!reflect,episode:false,candidate:false,interest:false});save(file,data)
    }
    return flushImpl()
  }
  const flush=()=>serialize(flushImpl)
  const recordEvents=(events=[],opts={})=>serialize(()=>recordEventsImpl(events,opts))
  const status=()=>{const v=load(file);return {ok:true,pending:v.pending.length,completed:v.complete.length,lastError:v.lastError,updatedAt:v.updatedAt}}
  const start=()=>{if(timer)return;void flush().catch(e=>logger.warn?.(String(e)));timer=setInterval(()=>{void flush().catch(e=>logger.warn?.(String(e)))},60000);timer.unref?.()}
  const stop=()=>{if(timer)clearInterval(timer);timer=null}
  return {recordEvents,flush,status,start,stop,file}
}
