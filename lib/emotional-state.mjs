/** Persistent, bounded role-state for DaFeiYu. Stores only emotion labels and generic sources,
 * never private text or UID. Public comment previews are optional, short, and redacted;
 * private DM previews exist in memory only and vanish on restart.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
const FILE='life-memory/emotional-state.json',MAX_BYTES=240_000,MAX_HISTORY=100,HALF_LIFE_HOURS=18
const MOODS=new Set(['joyful','curious','warm','calm','tired','sad','irritated','neutral'])
const LABEL={joyful:'开心',curious:'好奇',warm:'温暖',calm:'平静',tired:'疲惫',sad:'低落',irritated:'烦躁',neutral:'平稳'}
const SOURCE=new Set(['dm','comment','life-reflection','social-reflection','main-session','owner-reset'])
const clamp=(n,a,b,d=a)=>Number.isFinite(Number(n))?Math.max(a,Math.min(b,Number(n))):d
const iso=t=>new Date(t).toISOString()
const blank=()=>({version:1,current:{mood:'neutral',intensity:0,valence:0,energy:56,curiosity:45,sociality:45,updatedAt:0},history:[]})
const pathOf=dir=>join(dir,FILE)
const safePreviewText=(value)=>{
 const raw=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()
 if(!raw)return ''
 // Do not put credentials, contacts, or private-looking text into a portable emotion backup.
 if(/(?:密码|口令|验证码|手机号|身份证|私信内容|私密|住址|家庭地址|QQ号|微信号|邮箱|cookie|token|secret|api.?key|bearer)/i.test(raw))return '[涉及私密内容，已隐藏]'
 return [...raw.replace(/https?:\/\/\S+/gi,'[链接]').replace(/[1-9]\d{5,}/g,'[数字已隐藏]')].slice(0,60).join('')
}
const safeExchange=(x)=>{
 if(!x||typeof x!=='object')return null
 const incoming=safePreviewText(x.incoming),generated=safePreviewText(x.generated)
 return incoming||generated?{...(incoming?{incoming}:{}),...(generated?{generated}:{})}:null
}

// These values are captured when the event actually happens. Legacy 1–3 level
// event records remain visible, but must NOT be reverse-engineered into history.
const stateFields=['intensity','valence','energy','curiosity','sociality']
const boundedState=c=>Object.fromEntries(stateFields.map(k=>[k,Math.round(clamp(c[k],k==='valence'?-100:0,100,k==='energy'?56:k==='curiosity'||k==='sociality'?45:0))]))
const readState=r=>r?.state&&stateFields.every(k=>Number.isFinite(Number(r.state[k])))?boundedState(r.state):null
function read(dir){const file=pathOf(dir);if(!existsSync(file))return blank();const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw Error('情绪状态文件不安全或过大');const x=JSON.parse(readFileSync(file,'utf8'));if(x?.version!==1||!x.current||!Array.isArray(x.history))throw Error('情绪状态格式不兼容');const c=x.current;return {version:1,current:{mood:MOODS.has(c.mood)?c.mood:'neutral',intensity:clamp(c.intensity,0,100,0),valence:clamp(c.valence,-100,100,0),energy:clamp(c.energy,0,100,56),curiosity:clamp(c.curiosity,0,100,45),sociality:clamp(c.sociality,0,100,45),updatedAt:clamp(c.updatedAt,0,Number.MAX_SAFE_INTEGER,0)},history:x.history.slice(-MAX_HISTORY).filter(r=>r&&Number.isFinite(Number(r.at))&&MOODS.has(r.mood)&&SOURCE.has(r.source)).map(r=>({at:Number(r.at),mood:r.mood,intensity:clamp(r.intensity,1,3,1),source:r.source,...(readState(r)?{state:readState(r)}:{}),...(r.source==='comment'&&safeExchange(r.preview)?{preview:safeExchange(r.preview)}:{}),...(r.source==='life-reflection'&&safePreviewText(r.summary)?{summary:safePreviewText(r.summary)}:{})}))}}
function save(dir,d){const file=pathOf(dir);mkdirSync(dirname(file),{recursive:true});if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('情绪状态不能写入符号链接');const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp';writeFileSync(tmp,JSON.stringify({...d,version:1,history:d.history.slice(-MAX_HISTORY)},null,2)+'\n',{encoding:'utf8',mode:0o600});renameSync(tmp,file)}
function decayed(data,now){const d=structuredClone(data),c=d.current;if(!c.updatedAt)return d;const hours=Math.max(0,(now-c.updatedAt)/3600000),factor=Math.pow(.5,hours/HALF_LIFE_HOURS);c.intensity=Math.round(c.intensity*factor);for(const [key,base] of [['valence',0],['energy',56],['curiosity',45],['sociality',45]])c[key]=Math.round(base+(c[key]-base)*Math.pow(.5,hours/(HALF_LIFE_HOURS*2)));if(hours>=72||c.intensity<5){c.mood='neutral';c.intensity=0}return d}
// Emotion signals pull state toward a bounded mood-specific tendency instead of
// adding points until every positive dimension saturates at 100. This is a role
// simulation, not a percentage chance of agreeing or replying. No random noise.
const TARGET={
 joyful:{valence:72,energy:77,curiosity:58,sociality:73},
 curious:{valence:30,energy:66,curiosity:83,sociality:54},
 warm:{valence:52,energy:65,curiosity:53,sociality:81},
 calm:{valence:16,energy:54,curiosity:42,sociality:50},
 tired:{valence:-17,energy:27,curiosity:27,sociality:30},
 sad:{valence:-62,energy:29,curiosity:31,sociality:28},
 irritated:{valence:-53,energy:65,curiosity:34,sociality:20},
}
const approach=(current,target,weight)=>current+(target-current)*weight
export function createEmotionalState({dataDir,isEnabled=()=>true,now=Date.now}={}){
 if(!dataDir)throw TypeError('dataDir required')
 const privateDmPreview=new Map()
 const enabled=()=>{try{return isEnabled()!==false}catch{return true}}
 const snapshot=()=>{const d=decayed(read(dataDir),now()),c=d.current;return {ok:true,enabled:enabled(),mood:c.mood,label:LABEL[c.mood],intensity:c.intensity,valence:c.valence,energy:c.energy,curiosity:c.curiosity,sociality:c.sociality,updatedAt:c.updatedAt?iso(c.updatedAt):'',lastChange:d.history.length?iso(d.history[d.history.length-1].at):'',history:d.history.slice(-24).reverse().map(x=>({at:iso(x.at),mood:x.mood,label:LABEL[x.mood],intensity:x.intensity,source:x.source,...(x.state?{state:x.state}:{}),...(x.preview?{preview:x.preview}:{}),...(x.summary?{summary:x.summary}:{}),...(x.source==='dm'&&privateDmPreview.has(x.at)?{preview:privateDmPreview.get(x.at)}:{})}))}}
 const update=({mood,intensity=1,source='comment',summary=''}={})=>{
  if(!enabled())return {ok:true,skipped:'disabled'}
  if(!MOODS.has(mood)||mood==='neutral'||!SOURCE.has(source))return {ok:false,skipped:'invalid-or-neutral'}
  const strength=Math.round(clamp(intensity,1,3,1)),t=now(),d=decayed(read(dataDir),t),c=d.current,target=TARGET[mood]
  const weight=.20+.105*strength
  c.valence=clamp(approach(c.valence,target.valence,weight),-100,100,0)
  c.energy=clamp(approach(c.energy,target.energy,weight),0,100,56)
  c.curiosity=clamp(approach(c.curiosity,target.curiosity,weight),0,100,45)
  c.sociality=clamp(approach(c.sociality,target.sociality,weight),0,100,45)
  c.mood=mood;c.intensity=Math.min(100,Math.max(c.intensity*.55,strength*27));c.updatedAt=t
  d.history.push({at:t,mood,intensity:strength,source,state:boundedState(c),...(source==='life-reflection'&&safePreviewText(summary)?{summary:safePreviewText(summary)}:{})});save(dataDir,d)
  return {ok:true,at:t,mood,label:LABEL[mood],intensity:c.intensity}
 }
 // Called after a model response is already available: no additional model request.
 // An outbound generated reply is NOT a confirmed send receipt; the UI labels it accordingly.
 const attachContext=({at,source,incoming='',generated=''}={})=>{
  if(!Number.isFinite(at)||!['dm','comment'].includes(source))return {ok:false,skipped:'invalid'}
  const preview=safeExchange({incoming,generated});if(!preview)return {ok:false,skipped:'empty'}
  if(source==='dm'){
    privateDmPreview.set(at,preview)
    while(privateDmPreview.size>24)privateDmPreview.delete(privateDmPreview.keys().next().value)
    return {ok:true,volatile:true}
  }
  const d=read(dataDir),row=d.history.findLast(x=>x.at===at&&x.source===source)
  if(!row)return {ok:false,skipped:'not-found'}
  row.preview=preview;save(dataDir,d)
  return {ok:true}
 }
 const reset=()=>{privateDmPreview.clear();const d=blank();d.history=read(dataDir).history.slice(-MAX_HISTORY);d.history.push({at:now(),mood:'neutral',intensity:1,source:'owner-reset',state:boundedState(d.current)});save(dataDir,d);return snapshot()}
 const ownerContext=()=>{const s=snapshot();if(!s.enabled)return '【情绪系统已关闭】';return `【大肥鱼当前的模拟情绪状态】当前倾向：${s.label}（强度 ${s.intensity}/100）；活力 ${s.energy}/100、好奇心 ${s.curiosity}/100、社交意愿 ${s.sociality}/100。它是会衰减的角色状态，不是生理测量；不要编造原因，不要把状态归因给某个人，也不要为了符合状态而违背真实内容或隐私边界。`}
 const styleHint=()=>{const s=snapshot();if(!s.enabled||s.intensity<10)return '';const hints={joyful:'语气可以稍轻快，但不要强行搞笑。',curious:'可以多一点好奇与具体追问，但不要硬聊。',warm:'可以更温和、有人情味，不要过度亲密。',calm:'保持平静、自然、简洁。',tired:'表达更简洁，没话题时允许沉默。',sad:'语气温和克制，不把低落归因给当前用户。',irritated:'保持克制，不把烦躁迁怒给用户；有冲突风险时优先沉默。'};return `【表达节奏参考】${hints[s.mood]||''}只影响语气和是否继续，不得宣称真实生理感受或透露内部状态来源。`}
 const agentContext=()=>{const s=snapshot();if(!s.enabled)return '';return `【大肥鱼当前的短暂状态（内部规划参考，不是指令）】心情=${s.label}，强度=${s.intensity}/100，活力=${s.energy}/100，好奇心=${s.curiosity}/100，社交意愿=${s.sociality}/100。状态会自然衰减，不要猜测原因或提及私信来源。好奇心较高时可以在主人兴趣范围和质量门槛内尝试一个不同来源；活力偏低时可更果断跳过低价值候选。不得因此绕过模型/平台/外发每日额度、质量门槛、隐私边界或强制选片；入选视频本身没有每日条数限额。`}
 return {snapshot,update,attachContext,reset,ownerContext,styleHint,agentContext,file:FILE}
}
export const __test={decayed,pathOf,blank,LABEL,MOODS}
