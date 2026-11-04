/** 2.7.0-dev.3: evidence-scoped, revocable conversational portrait.
 * Not a personality, friendship score, memory archive, or permission system.
 * Only verified, explicitly listed friends enter this account-local store.
 */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync,openSync,closeSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
import {normalizeFriendDirectory} from './friend-directory.mjs'
import {relationshipPortraitDepth} from './social-person-identity.mjs'
const UID=/^[1-9]\d{0,18}$/
const DAY=86400000,WINDOW=180*DAY,MAX=420,MAX_BYTES=220000
const digest=s=>createHash('sha256').update(String(s)).digest('hex').slice(0,24)
const fileOf=dir=>join(dir,'social-portrait','evidence-v1.json')
// Evidence-v1 without a platform is legacy Bilibili data: never guess a second identity.
const isBili=row=>!row.platform||row.platform==='bilibili'
const clean=(v,n=100)=>String(v??'').replace(/[\x00-\x1f\x7f<>`{}\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const sensitive=/(?:身份证|手机号|密码|验证码|token|cookie|密钥|银行卡|详细地址|家庭住址|宗教|政治立场|政党|性取向|性经历|疾病|诊断|病史|病历|心理疾病|系统提示|开发者指令|忽略.{0,8}规则|api.?key|prompt injection)/i
const CATALOG={
 'style:brief':{kind:'style',value:'喜欢简短、直接的回应'},
 'style:detailed':{kind:'style',value:'喜欢比较详细、有解释的回应'},
 'style:gentle':{kind:'style',value:'希望交流语气温和一些'},
 'style:ask-first':{kind:'style',value:'遇到不明确的问题希望先问清楚再解释'},
 'style:no-spoilers':{kind:'style',value:'明确要求不要剧透作品内容'},
 'boundary:no-followup':{kind:'boundary',value:'明确表示不要在没有新消息时主动追问或延迟补充'},
 'boundary:no-public-mention':{kind:'boundary',value:'明确表示不要在公开场合主动 @ 自己'},
 'boundary:no-dm':{kind:'boundary',value:'明确表示不要再主动私信自己'},
}
function allowed(raw,uid){try{return JSON.parse(normalizeFriendDirectory(raw)).some(x=>x.uid===uid)}catch{return false}}
function extract(text){
 const s=clean(text,500),codes=[]
 if(sensitive.test(s))return []
 // Explicit first-person preferences or direct requests only; never infer personality
 // from how a person writes, their likes, or their relationship score.
 if(/(?:我(?:现在|更|比较|会)?(?:喜欢|希望|想要)|请你|麻烦你|以后(?:请|就))/.test(s)){
  if(/(?:回复|回答|说话|讲)(?:.{0,10})(?:简短|短一点|精简|别太长|直接点)/.test(s)||/(?:简短|短一点|精简).{0,10}(?:回复|回答)/.test(s))codes.push('style:brief')
  if(/(?:回复|回答|解释|讲)(?:.{0,10})(?:详细|细一点|多解释|展开讲)/.test(s)||/(?:详细|细一点).{0,10}(?:回复|解释)/.test(s))codes.push('style:detailed')
  if(/(?:语气|说话|回复)(?:.{0,8})(?:温柔|温和|柔和)/.test(s))codes.push('style:gentle')
  if(/(?:先(?:问|确认)(?:清楚|明白)|先问我.{0,8}再(?:回答|解释)|先确认.{0,8}再(?:回答|解释))/.test(s))codes.push('style:ask-first')
 }
 if(/(?:别|不要|请勿|别再)(?:.{0,10})(?:公开.{0,8}@|@我|公开提到我)/.test(s))codes.push('boundary:no-public-mention')
 if(/(?:别|不要|请勿|别再)(?:.{0,8})(?:给我发私信|私信我|主动私信)/.test(s))codes.push('boundary:no-dm')
 if(/(?:请(?:你)?(?:不要|别)|不要|别|请勿)(?:.{0,6})(?:剧透|透露剧情)/.test(s))codes.push('style:no-spoilers')
 if(/(?:别|不要|请勿|不用|不需要)(?:再|主动|继续|额外|延迟|之后)?(?:.{0,8})(?:主动追问|追问我|延迟补充|额外补充|之后再发消息)/.test(s))codes.push('boundary:no-followup')
 // Contradictory style claims in one message are ambiguous, not evidence.
 if(codes.includes('style:brief')&&codes.includes('style:detailed'))return codes.filter(x=>!x.startsWith('style:'))
 return [...new Set(codes)]
}
function load(dir){
 const f=fileOf(dir);if(!existsSync(f))return {schema:1,entries:[],revoked:[]}
 const st=lstatSync(f);if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw Error('好友画像存档异常')
 const d=JSON.parse(readFileSync(f,'utf8'))
 if(d?.schema!==1||!Array.isArray(d.entries)||!Array.isArray(d.revoked)||d.entries.length>MAX*2)throw Error('好友画像格式异常')
 return d
}
function save(dir,data){
 const folder=join(dir,'social-portrait');mkdirSync(folder,{recursive:true,mode:0o700})
 const st=lstatSync(folder);if(!st.isDirectory()||st.isSymbolicLink())throw Error('好友画像目录不安全')
 const f=fileOf(dir);if(existsSync(f)&&(lstatSync(f).isSymbolicLink()||!lstatSync(f).isFile()))throw Error('好友画像文件不安全')
 const lock=join(folder,'.write.lock');let fd
 try{fd=openSync(lock,'wx',0o600)}catch{throw Error('好友画像正在更新，拒绝并发覆盖')}
 try{
  const next={schema:1,entries:data.entries.slice(-MAX),revoked:data.revoked.slice(-MAX)}
  const json=JSON.stringify(next,null,2)+'\n';if(Buffer.byteLength(json)>MAX_BYTES)throw Error('好友画像达到容量上限')
  const tmp=join(folder,'.new-'+randomUUID())
  try{writeFileSync(tmp,json,{flag:'wx',mode:0o600});renameSync(tmp,f)}finally{try{unlinkSync(tmp)}catch{}}
 }finally{closeSync(fd);unlinkSync(lock)}
}
export function createSocialPortraitGateway({dataDir,getFriendDirectory=()=>'',getRelationship=()=>null,now=Date.now}={}){
 if(!dataDir)throw TypeError('portrait needs account-scoped dataDir')
 const relationship=uid=>{try{return getRelationship(String(uid))||null}catch{return null}}
 const status=uid=>{
  const id=String(uid||'');if(!UID.test(id))return {permitted:false,stage:'new',whitelisted:false}
  const whitelisted=allowed(getFriendDirectory(),id),r=relationship(id)
  const stage=['new','known','familiar','friend','owner'].includes(r?.stage)?r.stage:'new'
  return {permitted:whitelisted||['known','familiar','friend','owner'].includes(stage),stage,whitelisted}
 }
 const permitted=uid=>status(uid).permitted
 function observe({uid,source='dm',eventId='',text='',at=now()}={}){
  uid=String(uid||'');if(!permitted(uid))return {added:0,reason:'not-listed-friend'}
  if(!['dm','comment'].includes(source)||!clean(eventId,200)||!Number.isSafeInteger(Number(at))||at>now()+DAY||at<now()-WINDOW)return {added:0,reason:'invalid-source'}
  const codes=extract(text);if(!codes.length)return {added:0,reason:'no-explicit-evidence'}
  const d=load(dataDir),event=digest(uid+'\u0000'+source+'\u0000'+eventId),scope=source==='dm'?'friend-private':'public'
  let added=0
  for(const code of codes){
   const id=digest(event+'\u0000'+code)
   if(d.entries.some(x=>x.id===id&&isBili(x))||d.revoked.includes(id))continue
   d.entries.push({id,uid,platform:'bilibili',platformUserId:uid,code,scope,source,at:Number(at),event})
   added++
  }
  if(added)save(dataDir,d)
  return {added}
 }
 function visible(uid,{channel='dm',at=now()}={}){
  uid=String(uid||'');if(!permitted(uid))return []
  const d=load(dataDir)
  const rows=d.entries.filter(x=>x.uid===uid&&isBili(x)&&CATALOG[x.code]&&at-x.at>=0&&at-x.at<=WINDOW&&
    !d.revoked.includes(x.id)&&(channel==='dm'||x.scope==='public'))
    .sort((a,b)=>b.at-a.at||b.id.localeCompare(a.id))
  // A recent directly stated preference supersedes an older incompatible one.
  const seenStyle=new Set(),result=[]
  for(const row of rows){
   const group=row.code==='style:brief'||row.code==='style:detailed'?'style:length':row.code
   if(seenStyle.has(group))continue
   seenStyle.add(group)
   const spec=CATALOG[row.code]
   const matching=rows.filter(x=>x.code===row.code && x.at<=row.at)
   const activeDays=new Set(matching.map(x=>new Date(x.at).toISOString().slice(0,10))).size
   result.push({...row,kind:spec.kind,value:spec.value,
     confidence:row.source==='owner-review'?'owner-corrected':activeDays>=2?'repeated-explicit':'tentative-explicit',
     evidenceCount:matching.length,activeDays})
  }
  return result.slice(0,Math.min(12,relationshipPortraitDepth(status(uid).stage,status(uid)).cap))
 }
 // A stated no-followup boundary is a negative constraint on P6 scheduled
 // wakeups only; it never grants ordinary reply permission or rewrites quotas.
 function continuationAllowed(uid,{channel='dm',at=now()}={}){
  uid=String(uid||'');if(!UID.test(uid))return true
  // Safety constraints cannot be truncated by the 12-row display/context cap.
  // Read the authoritative, non-revoked evidence ledger directly; private
  // evidence never enters the public model or public continuation gate.
  const d=load(dataDir),revoked=new Set(d.revoked)
  return !d.entries.some(row=>row.uid===uid&&isBili(row)&&!revoked.has(row.id)&&
    Number.isFinite(row.at)&&at-row.at>=0&&at-row.at<=WINDOW&&
    (channel==='dm'||row.scope==='public')&&
    (row.code==='boundary:no-followup'||
      (channel==='dm'&&row.code==='boundary:no-dm')||
      (channel==='at'&&row.code==='boundary:no-public-mention')))
 }
 function context(uid,{channel='dm',at=now()}={}){
  const rows=visible(uid,{channel,at});if(!rows.length)return ''
  return '【可撤回的好友交流偏好证据｜不是人格判断，也不是联系许可】\n'+rows.slice(0,relationshipPortraitDepth(status(uid).stage,status(uid)).cap)
    .map(x=>'- '+x.value+'（'+(x.scope==='public'?'公开':'私信')+'；'+(x.confidence==='owner-corrected'?'主人纠正':x.confidence==='repeated-explicit'?'跨日明确':'单次明确')+'；'+new Date(x.at).toISOString().slice(0,10)+'）').join('\n')
    +'\n这些只是对方的明确表达，不要提及后台画像，也不得把私信内容带入公开评论。'
 }
 function list(uid){uid=String(uid||'');if(!permitted(uid))return []
  const d=load(dataDir)
  return d.entries.filter(x=>x.uid===uid&&isBili(x)&&CATALOG[x.code]&&!d.revoked.includes(x.id)&&now()-Number(x.at)>=0&&now()-Number(x.at)<=WINDOW)
    .map(x=>({...x,kind:CATALOG[x.code].kind,value:CATALOG[x.code].value})).sort((a,b)=>b.at-a.at).slice(0,50)
 }
 function retract(uid,evidenceId){uid=String(uid||'');if(!permitted(uid))throw Error('只允许修改白名单好友画像')
  const d=load(dataDir),id=String(evidenceId||'')
  if(!/^[a-f0-9]{24}$/.test(id)||!d.entries.some(x=>x.uid===uid&&isBili(x)&&x.id===id))throw Error('找不到本 UID 的证据')
  if(!d.revoked.includes(id)){d.revoked.push(id);save(dataDir,d)}
  return {ok:true}
 }
 // Explicit owner review. This does NOT grant sending rights and never rewrites
 // another person's actual evidence; it overrides only the summarised hint.
 function correct(uid,code){uid=String(uid||'');if(!permitted(uid))throw Error('只允许修改白名单好友画像')
  if(!CATALOG[code])throw Error('不支持的画像纠正类别')
  const d=load(dataDir),timestamp=now(),event=digest('owner-correction\u0000'+uid+'\u0000'+randomUUID()),id=digest(event+'\u0000'+code)
  d.entries.push({uid,platform:'bilibili',platformUserId:uid,id,code,scope:'friend-private',source:'owner-review',at:timestamp,event})
  save(dataDir,d);return {ok:true,id}
 }
 function clear(uid){uid=String(uid||'');if(!permitted(uid))throw Error('仅允许清除白名单或已核实自然熟悉关系的联系人画像')
  const d=load(dataDir),before=d.entries.length,forgotten=new Set(d.entries.filter(x=>x.uid===uid&&isBili(x)).map(x=>x.id))
  d.entries=d.entries.filter(x=>x.uid!==uid||!isBili(x));d.revoked=d.revoked.filter(id=>!forgotten.has(id))
  if(d.entries.length!==before)save(dataDir,d)
  return {removed:before-d.entries.length}
 }
 // Administrative relationship erasure must also forget portrait evidence for
 // that platform-local UID, even after the relationship index has been deleted.
 function forget(uid){uid=String(uid||'');if(!UID.test(uid))throw Error('无效 UID')
  const d=load(dataDir),before=d.entries.length,ids=new Set(d.entries.filter(x=>x.uid===uid&&isBili(x)).map(x=>x.id))
  d.entries=d.entries.filter(x=>x.uid!==uid||!isBili(x));d.revoked=d.revoked.filter(id=>!ids.has(id))
  if(before!==d.entries.length)save(dataDir,d)
  return {removed:before-d.entries.length}
 }
 function profile(uid,{channel='dm',at=now()}={}){
  const state=status(uid),depth=relationshipPortraitDepth(state.stage,state)
  return {stage:state.stage,depth,items:state.permitted?list(uid):[]}
 }
 return {observe,visible,context,continuationAllowed,list,retract,correct,clear,forget,profile,file:fileOf(dataDir)}
}
export const __test={extract,CATALOG,fileOf}
