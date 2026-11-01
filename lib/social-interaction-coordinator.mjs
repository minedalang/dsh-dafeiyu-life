/** Durable per-sink event projection, deliberately independent of outbound sends.
 * No raw private DM text or nonfriend UID is stored in this journal. */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {privateInsightSafe} from './life-private-policy.mjs'
const digest=s=>createHash('sha256').update(String(s)).digest('hex').slice(0,32)
const ID=/^[1-9]\d{0,18}$/;const BV=/^BV[0-9a-zA-Z]{10}$/
const clean=(x,n=150)=>String(x??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,n)
const blank=()=>({schema:1,pending:[],completed:[],failed:0,lastError:''})
const HEX=/^[a-f0-9]{32}$/
const WORD=/^BV[0-9a-zA-Z]{10}$/;const DYNAMIC=/^[1-9][0-9]{5,19}$/
function safeCognition(value){
 if(!value||typeof value!=='object'||!HEX.test(String(value.key||'')))return null
 const kind=String(value.kind||''),source=String(value.source||'')
 if(!['friend-invitation','stranger-inspiration'].includes(kind)||!['dm','comment'].includes(source))return null
 const at=Number(value.at),expiresAt=Number(value.expiresAt)
 if(!Number.isSafeInteger(at)||!Number.isSafeInteger(expiresAt)||expiresAt<=at)return null
 const out={key:String(value.key),kind,status:'candidate',source,at,expiresAt}
 if(kind==='friend-invitation'){
  if(!ID.test(String(value.uid||''))||!WORD.test(String(value.bvid||'')))return null
  out.uid=String(value.uid);out.bvid=String(value.bvid)
 }else{
  if(!HEX.test(String(value.from||'')))return null
  out.from=String(value.from);out.topics=(Array.isArray(value.topics)?value.topics:[])
    .map(x=>clean(x,40)).filter(x=>x.length>=2&&x.length<=40).slice(0,3)
  if(!out.topics.length)return null
 }
 return out
}
function safeInterest(value,uid){
 if(!value||typeof value!=='object'||!ID.test(uid)||String(value.uid)!==uid)return null
 const source=String(value.source||''),key=clean(value.key,135)
 if(!['dm','comment'].includes(source)||!key)return null
 const statements=(Array.isArray(value.statements)?value.statements:[])
   .filter(x=>x&&['like','dislike'].includes(x.stance)
     &&['explicit-self-report','context-grounded-rejection','explicit-recommendation-rejection','explicit-recommendation-request'].includes(x.confidence)
     &&typeof x.topic==='string'&&clean(x.topic,35).length>=2)
   .slice(0,5).map(x=>({topic:clean(x.topic,35),stance:x.stance,confidence:x.confidence}))
 const video=WORD.test(String(value.video||''))?String(value.video):''
 const blockedChannels=[...new Set((Array.isArray(value.blockedChannels)?value.blockedChannels:[]).filter(x=>['dm','mention'].includes(x)))].slice(0,2)
 const consent=['on','off'].includes(value.consent)?value.consent:''
 const videoRejection=value.videoRejection===true&&!!video
 if(!statements.length&&!videoRejection&&!blockedChannels.length&&!consent)return null
 return {uid,source,key,at:Number.isSafeInteger(Number(value.at))?Number(value.at):Date.now(),statements,video,videoRejection,blockedChannels,consent}
}
function safeLifeEvent(value){
 if(value?.kind==='private-social'){
  if(!value.privacyReviewed||value.sensitivity!=='low'||!privateInsightSafe(value.text)||!/^private:(?:owner-session|owner-dm|friend-dm):[a-f0-9]{20}$/.test(String(value.key||'')))return null
  if(value.visibility==='owner-private'&&value.subjectUid!=='owner')return null
  if(value.visibility==='friend-private'&&!ID.test(String(value.subjectUid||'')))return null
  if(!['owner-private','friend-private'].includes(value.visibility))return null
  return {kind:'private-social',key:String(value.key),visibility:value.visibility,subjectUid:value.subjectUid,sensitivity:'low',privacyReviewed:true,text:clean(value.text,260),at:Number(value.at)||Date.now()}
 }
 if(!value||value.kind!=='social'||!ID.test(String(value.actorUid||'')))return null
 const dynamic=value.contentType==='dynamic'&&DYNAMIC.test(String(value.dynamicId||''))&&!value.bvid
 if(!dynamic&&!WORD.test(String(value.bvid||'')))return null
 const key=clean(value.key,240),text=clean(value.text,230)
 if(!key||!text)return null
 const at=Number(value.at)
 return {kind:'social',key,...(dynamic?{contentType:'dynamic',dynamicId:String(value.dynamicId)}:{bvid:String(value.bvid)}),actorUid:String(value.actorUid),text,at:Number.isFinite(at)&&at>0?at:Date.now(),
   socialTier:['owner','friend','stranger'].includes(value.socialTier)?value.socialTier:'stranger'}
}
export function createSocialInteractionCoordinator({dataDir,recordCognition=()=>({ok:true}),recordInterest=()=>({ok:true}),recordRelationship=()=>({ok:true}),recordLifeEvent=()=>({ok:true}),recordReply=()=>({ok:true}),recordDecline=()=>({ok:true}),logger=console}={}){
 if(!dataDir)throw TypeError('social coordinator requires dataDir')
 const file=join(dataDir,'social-interaction','outbox.json');let timer=null,busy=false,chain=Promise.resolve()
 const serialize=task=>{const step=chain.then(task,task);chain=step.catch(()=>{});return step}
 function load(){if(!existsSync(file))return blank();const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>2*1024*1024)throw Error('社交协调日志不安全');const d=JSON.parse(readFileSync(file,'utf8'));if(d.schema!==1||!Array.isArray(d.pending)||!Array.isArray(d.completed)||d.pending.length>400)throw Error('社交协调日志格式不兼容');return d}
 function save(data){mkdirSync(dirname(file),{recursive:true});const parent=lstatSync(dirname(file));if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('社交 outbox 目录不安全');if(existsSync(file)){const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw Error('社交 outbox 文件不安全')}
  const out={schema:1,pending:data.pending,completed:data.completed.slice(-5000),failed:data.failed||0,lastError:clean(data.lastError,160)}
  const json=JSON.stringify(out,null,2)+'\n';if(Buffer.byteLength(json)>2*1024*1024)throw Error('社交 outbox 已达到容量上限')
  const tmp=file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,json,{mode:0o600});renameSync(tmp,file)}
 function prepare(raw={}){
  if(!['incoming','reply','decline','outgoing-dm'].includes(raw.type)||!['dm','comment'].includes(raw.source)||!String(raw.eventKey||''))return null
  const id=digest(raw.type+'|'+raw.source+'|'+raw.eventKey),role=['owner','friend','stranger'].includes(raw.role)?raw.role:'stranger',at=Number(raw.at)||Date.now()
  const sinks={},payload={},actor=String(raw.actorUid||'')
  if(raw.type==='incoming'){
   if(role==='friend'&&ID.test(actor)){
    if(raw.interest){const interest=safeInterest(raw.interest,actor);if(interest){payload.interest=interest;sinks.interest=false}}
    payload.relationship={uid:actor,source:raw.source,direction:'incoming',eventId:id,at};sinks.relationship=false
   }
   if(raw.cognition){const cognition=safeCognition(raw.cognition);if(cognition){payload.cognition=cognition;sinks.cognition=false}}
   if(raw.lifeEvent){const lifeEvent=safeLifeEvent(raw.lifeEvent);if(lifeEvent&&((raw.source==='comment'&&lifeEvent.kind==='social')||(raw.source==='dm'&&lifeEvent.kind==='private-social'&&((role==='owner'&&lifeEvent.visibility==='owner-private')||(role==='friend'&&lifeEvent.visibility==='friend-private'&&lifeEvent.subjectUid===actor))))){payload.lifeEvent=lifeEvent;sinks.lifeEvent=false}}
  }else if(raw.type==='reply'||raw.type==='decline'){
   if(!ID.test(actor)||!BV.test(String(raw.bvid||''))||!/^\d{1,20}$/.test(String(raw.rpid||'')))return null
   payload.outcome={uid:actor,bvid:String(raw.bvid),rpid:String(raw.rpid),text:raw.type==='reply'?clean(raw.text,130):'',reason:raw.type==='decline'?(raw.reason==='respect-request'?'respect-request':'general'):'',at}
   sinks.outcome=false
   if(raw.type==='reply'&&role==='friend'){payload.relationship={uid:actor,source:'comment',direction:'outgoing',eventId:id,at};sinks.relationship=false}
  }else if(raw.type==='outgoing-dm'){
   if(role!=='friend'||!ID.test(actor))return null
   payload.relationship={uid:actor,source:'dm',direction:'outgoing',eventId:id,at};sinks.relationship=false
  }
  return {id,type:raw.type,source:raw.source,role,at,payload,sinks}
 }
 async function flushImpl(){if(busy)return {ok:false,busy:true,pending:load().pending.length};busy=true;const d=load();let completed=0,failures=0
  try{for(const item of [...d.pending]){
   const apply=async(name,fn)=>{if(item.sinks[name]!==false)return;const result=await fn(item.payload[name]||item.payload.outcome);if(result?.ok===false||result===false)throw Error(String(result?.error||result?.reason||name+' sink failed'));item.sinks[name]=true;save(d)}
   try{
    await apply('lifeEvent',recordLifeEvent)
    await apply('cognition',recordCognition)
    await apply('interest',recordInterest)
    await apply('relationship',recordRelationship)
    await apply('outcome',item.type==='reply'?recordReply:recordDecline)
    d.pending=d.pending.filter(x=>x.id!==item.id);d.completed.push(item.id);d.completed=d.completed.slice(-5000);d.lastError='';save(d);completed++
   }catch(e){failures++;d.failed=(Number(d.failed)||0)+1;d.lastError=clean(e?.message||e);save(d);logger.warn?.('社交投影待补偿：'+item.id.slice(0,8)+' '+d.lastError)}
  }return {ok:failures===0,pending:d.pending.length,completed,failures,lastError:d.lastError}
  }finally{busy=false}
 }
 async function recordImpl(raw){const item=prepare(raw);if(!item)return {ok:false,reason:'invalid-social-event'}
  const d=load();if(d.completed.includes(item.id))return {ok:true,duplicate:true,pending:d.pending.length}
  if(!d.pending.some(x=>x.id===item.id)){if(d.pending.length>=400)throw Error('社交 outbox 待补偿队列已满');d.pending.push(item);save(d)}
  return flushImpl()
 }
 const flush=()=>serialize(flushImpl)
 const record=raw=>serialize(()=>recordImpl(raw))
 const status=()=>{const d=load();return {ok:true,pending:d.pending.length,completed:d.completed.length,failed:d.failed||0,lastError:d.lastError||''}}
 const start=()=>{if(timer)return;void flush().catch(e=>logger.warn?.(e.message));timer=setInterval(()=>void flush().catch(e=>logger.warn?.(e.message)),60000);timer.unref?.()}
 const stop=()=>{if(timer)clearInterval(timer);timer=null}
 return {record,flush,status,start,stop,file}
}
