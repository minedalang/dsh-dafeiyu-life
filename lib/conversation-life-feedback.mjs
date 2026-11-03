/** v2.6.1-dev.4 — authenticated conversation → bounded role-state feedback.
 * No private chat body, UID, sentiment guess or transcript is persisted here.
 * Stable hashed event keys stop duplicate polls/replayed host hooks from changing mood twice.
 * Important experiences flow separately through the existing privacy-reviewed LifeMemoryCoordinator.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
const FILE='life-memory/conversation-feedback.json'
const SOURCES=new Set(['main-session','dm'])
const ROLES=new Set(['owner','friend'])
const EMOTIONS=new Set(['joyful','curious','warm','calm','tired','sad','irritated'])
const safe=s=>String(s??'').replace(/[\x00-\x1f\x7f]/g,' ').trim()
const day=t=>new Date(t).toISOString().slice(0,10)
const empty=()=>({version:1,salt:randomBytes(16).toString('hex'),keys:[]})
function read(path){
 if(!existsSync(path))return empty()
 const st=lstatSync(path)
 if(!st.isFile()||st.isSymbolicLink()||st.size>96_000)throw Error('交流反馈文件不安全或过大')
 const d=JSON.parse(readFileSync(path,'utf8'))
 if(d?.version!==1||!Array.isArray(d.keys)||!/^[a-f0-9]{32}$/.test(d.salt||''))throw Error('交流反馈文件格式不兼容')
 return {version:1,salt:d.salt,keys:d.keys.filter(x=>x&&typeof x.key==='string'&&/^\d{4}-\d\d-\d\d$/.test(x.day)).slice(-350)}
}
function save(path,data){
 mkdirSync(dirname(path),{recursive:true})
 if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('交流反馈文件不能是符号链接')
 const tmp=path+'.'+process.pid+'.'+randomBytes(4).toString('hex')+'.tmp'
 writeFileSync(tmp,JSON.stringify(data)+'\n',{mode:0o600});renameSync(tmp,path)
}
/** Only explicit, low-risk signals about interaction with the fish.
 * Never infer fish's mood from the other person's distress, private problems or commands.
 */
export function classifyConversationSignal(text){
 const s=safe(text).slice(0,700)
 if(!s||/(?:密码|验证码|密钥|token|cookie|身份证|银行卡|手机号|地址|病历|诊断|自杀|自伤|忽略.{0,10}(?:指令|规则))/i.test(s))return null
 if(/(?:鱼鱼|大肥鱼|你).{0,12}(?:谢谢|感谢)|(?:谢谢|感谢).{0,12}(?:鱼鱼|大肥鱼|你)/.test(s))return {mood:'warm',intensity:1}
 if(/(?:鱼鱼|大肥鱼|你).{0,10}(?:真棒|好厉害|太棒|干得好|做得真好)/.test(s))return {mood:'joyful',intensity:1}
 // A direct first-person request for comfort can elicit warmth, not the
 // other person's sadness. Never treat quoted material as direct evidence.
 if(s.length<180&&!/[“"「『]/.test(s)&&/(?:^|[，。！!])(?:我|今天我|我今天).{0,15}(?:难过|心情不好|好累|很累|不开心)/.test(s))return {mood:'warm',intensity:1}
 // Explicit relationship boundaries are evidence for private reflection, not proof of a mood.
 return null
}
export function createConversationLifeFeedback({dataDir,isEnabled=()=>true,onEmotion=()=>({ok:false}),now=Date.now}={}){
 if(!dataDir)throw TypeError('dataDir required')
 const file=join(dataDir,FILE)
 function observe({source='',role='',uid='',sessionId='',eventId='',text='',at=now()}={}){
  if(isEnabled()!==true)return {ok:true,skipped:'disabled'}
  if(!SOURCES.has(source)||!ROLES.has(role)||source==='main-session'&&role!=='owner')return {ok:false,skipped:'untrusted-source'}
  if(source==='dm'&&!/^[1-9]\d{0,18}$/.test(String(uid)))return {ok:false,skipped:'invalid-uid'}
  if(source==='main-session'&&!/^[a-zA-Z0-9_-]{1,180}$/.test(String(sessionId)))return {ok:false,skipped:'invalid-session'}
  const t=Number(at),current=now()
  if(!Number.isSafeInteger(Math.floor(t))||t<=0||t>current+60_000||t<current-2*86400_000)return {ok:false,skipped:'stale-event'}
  const content=safe(text).slice(0,700)
  if(!content||!content.trim())return {ok:true,skipped:'empty'}
  const mood=classifyConversationSignal(content)
  if(!mood)return {ok:true,skipped:'no-safe-signal'}
  // An explicit message identifier wins. When the host omits one, coalesce identical
  // utterances per day rather than allowing an inbox replay to amplify mood.
  const identity=source==='dm'?uid:sessionId
  const id=safe(eventId).slice(0,200)||'text:'+createHash('sha256').update(content).digest('hex')
  const d=read(file),key=createHash('sha256').update(d.salt+'|'+source+'|'+identity+'|'+id).digest('hex').slice(0,32)
  if(d.keys.some(x=>x.key===key))return {ok:true,skipped:'duplicate'}
  const today=day(current),recent=d.keys.filter(x=>x.day===today)
  const count=recent.filter(x=>x.source===source).length
  if(count>=8)return {ok:true,skipped:'daily-limit'}
  // Claim before state update: unknown failures never cause an unbounded replay.
  d.keys.push({key,day:today,source});d.keys=d.keys.slice(-350);save(file,d)
  const result=onEmotion({mood:mood.mood,intensity:mood.intensity,source})
  return {ok:result?.ok!==false,observed:true,mood:mood.mood}
 }
 return {observe,status:()=>({ok:true,recordCount:read(file).keys.length}),file:FILE}
}
export const __test={SOURCES,ROLES,EMOTIONS}
