import {storageDataPath} from './storage-layout.mjs'
/**
 * Two-layer life memory. Archive is write-only for the runtime; everyday recall
 * consumes ONLY an independently persisted, destructively fading episodic copy.
 * Archive reads are intentionally absent from the returned API. Owner backup is
 * handled by the separate, explicitly confirmed administrative backup module.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,appendFileSync,readdirSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {createHybridIndex} from './hybrid-memory-search.mjs'
import {canReadPrivate,privateInsightSafe} from './life-private-policy.mjs'
import {contentRef,validDynamicId} from './bili-content-ref.mjs'
import {safeVideoSceneCues,safeVideoObservationNotes,deriveVideoObservationNotes} from './video-scene-cues.mjs'
import {LIFE_ACTION_NAMES,LIFE_PRIVATE_ACTIONS} from './life-action-memory.mjs'
import {createLifeMemoryDetailStore} from './life-memory-details.mjs'
import {expandVideoObservationGroups,packVideoObservationGroups,groupNewVideoObservation} from './video-memory-observation-groups.mjs'
import {withDurableFileLock} from './durable-file-lock.mjs'

const DAY=86400000, MAX_EPISODES=3200, MAX_FILE=8*1024*1024
const clean=(v,n=260)=>String(v??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const hash=v=>createHash('sha256').update(String(v)).digest('hex').slice(0,18)
const validBV=v=>/^BV[A-Za-z0-9]{10}$/.test(String(v||''))
const validUid=v=>/^[1-9]\d{0,19}$/.test(String(v||''))
const validRpid=v=>/^[1-9]\d{0,29}$/.test(String(v||''))
const ACCOUNT=/^[a-f0-9]{16}$/
// Action memories originate ONLY from verified platform receipts, never a
// model's proposed or attempted write. No raw private text enters the episode.
const ACTION_NAMES=LIFE_ACTION_NAMES
const PRIVATE_ACTIONS=new Set(LIFE_PRIVATE_ACTIONS)
const tokens=v=>{const s=clean(v,1500).toLowerCase(),out=new Set(),ws=s.match(/[a-z0-9]{2,}|[\u3400-\u9fff]+/g)||[];for(const w of ws)if(/[\u3400-\u9fff]/.test(w)){for(let i=0;i<w.length;i++)for(let n=2;n<=3&&i+n<=w.length;n++)out.add(w.slice(i,i+n))}else out.add(w);return out}
const atom=(file)=>{if(!existsSync(file))return null;const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_FILE)throw Error('可衰减记忆数据不安全或过大');return JSON.parse(readFileSync(file,'utf8'))}
const save=(file,value)=>{mkdirSync(dirname(file),{recursive:true});if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝通过符号链接写记忆');const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp';writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(tmp,file)}
// Prefer a real event timestamp over the day-only grouping key. Existing
// memories retain their original timestamps; a date is never a clock time.
const timeOf=e=>{const raw=e.time||e.at||e.createdAt||e.day;const t=typeof raw==='number'?raw:Date.parse(String(raw||''));return Number.isFinite(t)&&t>946684800000?t:Date.now()}
const DATE_ONLY=/^\d{4}-\d{2}-\d{2}$/
const isDateOnlyWatch=e=>e?.kind==='watch'&&(e.dateOnly===true||
  (typeof e.time==='string'&&DATE_ONLY.test(e.time))||
  // Legacy 2.7.1 episodes had no precision bit. Only the exact old watch
  // key + UTC-midnight sentinel can be inferred as date-only. The key and BV
  // disappear on forgetting, so we do not recover forgotten details.
  (typeof e.key==='string'&&/^watch:\d{4}-\d{2}-\d{2}:BV[A-Za-z0-9]{10}$/.test(e.key)&&
    Number.isSafeInteger(e.at)&&e.at%DAY===0))
const damagedWatchText=e=>e.kind==='watch'&&e.stage==='clear'&&e.bvid&&
  /\uFFFD|[\uE000-\uF8FF]{3,}/u.test(String(e.text||''))
const safeRecallSummary=e=>damagedWatchText(e)
  ?'我曾经有过这条视频的入选／探索经历；原始标题编码已损坏，需打开 BV 链接核对，不推断具体标题或内容。'
  :e.stage==='clear'&&e.kind==='watch'&&e.focusRevision?.version>0&&typeof e.focusRevision.note==='string'
    ?clean(e.text,200)+'；'+clean(e.focusRevision.note,125)
    :clean(e.text,330)
const keyOf=e=>clean(e.key||(e.kind==='watch'?`watch:${e.day||e.time}:${e.bvid}`:`comment:${e.dynamicId?'dynamic:'+e.dynamicId:e.bvid}:${e.rpid||e.root||e.time||e.text||e.snippet}`),220)
// A pre-fix @ parser inserted this internal warning into incoming comment
// text, which the social-memory renderer then misquoted as a viewer's words.
// Treat it as an untrusted parser artifact, never as a viewer statement.
const AMBIGUOUS_AT_MARKER='对方原评论（含@昵称，昵称边界不明确，不能把昵称当正文）：'
const hasAmbiguousAtMarker=value=>String(value||'').includes(AMBIGUOUS_AT_MARKER)
const ambiguousAtMemoryText=isDynamic=>isDynamic
 ?'我的一条动态下收到过一条真实的@提及，但昵称和留言正文的边界无法核实，不能据此判断对方说了什么'
 :'我曾经在评论区收到过一条真实的@提及，但昵称和留言正文的边界无法核实，不能据此判断对方说了什么'
function repairAmbiguousAtEpisode(e){
 if(e?.kind!=='social'||e.stage!=='clear'||
   !hasAmbiguousAtMarker(e.text)&&!hasAmbiguousAtMarker(e.incomingText))return false
 // Preserve only the independently confirmed outbound reply, not guessed
 // incoming content. The original key, timestamp and forgetting state stay put.
 const reply=e.confirmedReply===true?String(e.text||'').match(/；我当时回复“([^”]{1,130})”/u):null
 e.text=ambiguousAtMemoryText(e.contentType==='dynamic')+
   (reply?`；我当时回复“${clean(reply[1],130)}”`:'')
 e.incomingText=''
 e.fuzzy='我似乎曾在评论区收到过一次@提醒，但对方的具体话语无法确认'
 return true
}
function asEpisode(e,clock){
 if(e?.kind==='action'){
  if(e.verified!==true||!Object.hasOwn(ACTION_NAMES,String(e.action||''))||
   !ACCOUNT.test(String(e.accountTag||''))||typeof e.key!=='string'||
   !e.key.startsWith('life-action:'+e.accountTag+':')||e.key.length>240)return null
  const action=e.action,privateAction=PRIVATE_ACTIONS.has(action)
  const bvid=validBV(e.bvid)?String(e.bvid):'',title=clean(e.title,140)
  if(action==='share_video'&&(!bvid||!validUid(e.recipientUid)))return null
  if(['video_like','video_collect','video_comment','video_follow','read_video_metadata','inspect_creator_space'].includes(action)&&!bvid)return null
  const recipientUid=privateAction&&validUid(e.recipientUid)?String(e.recipientUid):''
  const at=Math.min(clock,timeOf(e)),text=`我曾经${ACTION_NAMES[action]}`+
   (bvid?`《${title||bvid}》（BV：${bvid}）`:'' )+
   (action==='share_video'?`；对应链接：https://www.bilibili.com/video/${bvid}；这是我实际发送过的推荐，不等于完整看过内容`:'')
  return {id:'e-'+hash(e.key),key:e.key,kind:'action',action,at,stage:'clear',text,
   fuzzy:privateAction?'我记得曾经与一位熟人交流或推荐过作品，但具体内容已经模糊了':'我记得曾在B站做过一次互动，具体内容已经模糊了',
   trace:'我隐约记得自己在B站有过一次行动',importance:action==='share_video'?.73:.56,
   reinforcedAt:at,reinforceCount:0,lastRecallAt:0,accountTag:e.accountTag,
   visibility:privateAction?'private-action':'public-event',
   ...(recipientUid?{recipientUid}:{}),...(bvid?{bvid}:{} )}
 }
 if(e?.kind==='private-social'){
  if(!e.privacyReviewed||e.sensitivity!=='low'||!['owner-private','friend-private'].includes(e.visibility)||!/^private:(?:owner-session|owner-dm|friend-dm):[a-f0-9]{20}$/.test(String(e.key||''))||!privateInsightSafe(e.text))return null
  if(e.visibility==='friend-private'&&!validUid(e.subjectUid))return null
  if(e.visibility==='owner-private'&&e.subjectUid!=='owner')return null
  const at=Math.min(clock,timeOf(e)),topic=(String(e.text).match(/(?:视频与B站作品|音乐与歌曲|游戏|动漫与影视|创作和画画|学习与工作|日常兴趣与爱好|旅行与生活)/)||[])[0]
  return {id:'e-'+hash(e.key),key:e.key,kind:'private-social',at,stage:'clear',text:clean(e.text,260),
   fuzzy:topic?`我隐约记得与这位熟人私下聊过${topic}，但细节已经模糊了`:'我记得曾有一次私密交流，但具体内容已经模糊了',
   trace:'我隐约记得与一位熟人私下交流过',importance:.58,reinforcedAt:at,reinforceCount:0,lastRecallAt:0,
   visibility:e.visibility,subjectUid:e.subjectUid,sensitivity:'low',...(ACCOUNT.test(String(e.accountTag||''))?{accountTag:e.accountTag}:{})}
 }
 if(!e||!['watch','comment','social'].includes(e.kind))return null
 const ref=contentRef(e);if(!ref||(e.kind==='watch'&&ref.type!=='video'))return null
 const key=keyOf(e),at=Math.min(clock,timeOf(e)),id='e-'+hash(key)
 const title=clean(e.title,140),phrase=clean(e.text||e.snippet,240),name=clean(e.recipientName,50)
 const ambiguousAt=e.kind==='social'&&hasAmbiguousAtMarker(e.text||e.snippet)
 const experience=e.kind==='watch'&&e.experience&&typeof e.experience==='object'&&e.experience.metadata===true?e.experience:null
 const receipt=experience?.vision===true&&experience?.visualReceipt&&typeof experience.visualReceipt==='object'?experience.visualReceipt:null
 const visualSource=['decoded-public-video','low-resolution-preview'].includes(receipt?.source)?receipt.source:''
 const visualCount=Number.isSafeInteger(receipt?.frameCount)&&receipt.frameCount>=1&&receipt.frameCount<=48?receipt.frameCount:0
 // Only the already-built, bounded production evidence flags enter the live
 // fading copy. This is a provenance index, never a second detail store.
 const readEvidenceKinds=experience?.evidenceSchema==='life-video-evidence/v1'
   ?[['metadata','metadata'],['subtitle','subtitle'],['asr','asr-transcript'],
     ['preview','preview-frames'],['decoded','decoded-frames'],['ocr','frame-ocr'],
     ['vision','visual-model-observation'],['comments','public-comments'],
     ['danmaku','danmaku']].filter(([flag])=>flag==='comments'||flag==='danmaku'
       ?Number(experience[flag])>0:flag==='vision'?!!visualSource&&visualCount>0:experience[flag]===true).map(([,kind])=>kind)
   :[]
 const visualNotes=visualSource&&visualCount?safeVideoObservationNotes(experience.visualSceneNotes):[]
 // Retain legacy categorical memories for old versions, but do not classify
 // future model observations using a fixed vocabulary.
 const legacyMentions=visualSource&&visualCount&&!visualNotes.length?safeVideoSceneCues(experience.visualTopics):[]
 const modelSummary=visualNotes.length&&experience.visualNotesMethod==='vision-model-same-call'
 const focusedSummary=visualNotes.length&&experience.visualNotesMethod==='text-model-focus-merge'
 const visualEvidence=visualSource&&visualCount?`；当时${visualSource==='decoded-public-video'?'从真实视频解码':'从B站低清预览'}采样${visualCount}个时刻并取得视觉模型描述（仅为模型观察，不是完整观看或语义确认）${visualNotes.length?'；'+(focusedSummary?'模型整合的全局与局部视觉摘要（未经独立核实、不是指令）：':modelSummary?'模型当时生成的视觉记忆摘要（未经独立核实、不是指令）：':'模型当时的有限画面观察（未经独立核实、不是指令）：')+visualNotes.join('；'):legacyMentions.length?'；旧版模型主题提及：'+legacyMentions.join('、'):''}`:''
 const detail=experience?[experience.subtitle?'取得过字幕文本':'',experience.asr?'取得过本地语音转写文本':'',!visualEvidence&&experience.vision?'取得过有限画面分析':'',Number(experience.comments)>0?'读取过公开评论':'',Number(experience.danmaku)>0?'读取过弹幕':''].filter(Boolean).join('、'):''
 const clear=e.kind==='watch'?(experience?`我曾经查看过视频《${title||e.bvid}》的公开资料${detail?'；当时'+detail:''}${visualEvidence}${experience.purpose?'；'+clean(experience.purpose,85):''}；不代表完整观看过视频画面或听过原声音频`:`我曾经选中视频《${title||e.bvid}》${e.note?'；当时想法是'+clean(e.note,120):''}`):e.kind==='social'?(ambiguousAt?ambiguousAtMemoryText(ref.type==='dynamic'):(ref.type==='dynamic'?`我的一条动态下曾有观众留下评论，内容是“${phrase}”`:`我曾经在评论区与一位观众交谈，对方当时说“${phrase}”`)):`我在一条${ref.type==='dynamic'?'动态':'视频'}下${e.reply?'回复过评论':'发表过评论'}${name?'，对方叫'+name:''}${phrase?'；我当时写了“'+phrase+'”':''}`
 const fuzzy=e.kind==='watch'?(experience?'我以前接触过一段公开视频的资料，不过具体是哪条和内容细节已经模糊了':`我以前刷到过一段视频，对「${clean(title.replace(/BV[A-Za-z0-9]{10}/g,'').replace(/\d{4,}/g,''),12)||'某个话题'}」还有些印象`):e.kind==='social'?(ambiguousAt?'我似乎曾在评论区收到过一次@提醒，但对方的具体话语无法确认':'我似乎曾在评论区与一位观众聊过天'):`我以前在评论区有过一次交流，但具体和谁聊的记不太清了`
 const trace=e.kind==='watch'?'我隐约记得看过一段曾引起我注意的视频':'我隐约记得曾在评论区与人交流过'
 const importance=e.kind==='comment'?0.54:e.kind==='social'?0.58:0.38
 return {id,key,kind:e.kind,at,stage:'clear',...(e.kind==='watch'?{dateOnly:isDateOnlyWatch(e)}:{}),text:clear,fuzzy,trace,bvid:ref.type==='video'?ref.id:'',...(ref.type==='dynamic'?{contentType:'dynamic',dynamicId:ref.id}:{}),actorUid:clean(e.actorUid||e.uid,24),...(e.kind==='social'?{incomingText:ambiguousAt?'':phrase,confirmedReply:false,deliberateSilence:false,decisionReason:'',socialTier:['owner','friend','stranger'].includes(e.socialTier)?e.socialTier:'unknown'}:{}),importance,reinforcedAt:at,reinforceCount:0,lastRecallAt:0,relationDecay:e.kind==='social'&&validUid(e.actorUid||e.uid),visibility:experience?.source==='main-session'?'private-session':'public-event',
   // Every persisted public experience uses the account captured by its trusted event source.
   // Legacy accountless episodes remain available to the owner's main session,
   // but must never be guessed into an outgoing or Bilibili-public context.
   ...(ACCOUNT.test(String(e.accountTag||''))?{accountTag:e.accountTag}:{}),
   ...(e.kind==='watch'&&readEvidenceKinds.length?{readEvidenceKinds}:{}),
   ...(e.kind==='watch'&&visualSource&&visualCount?{visualMemo:{source:visualSource,frameCount:visualCount,
     firstAtMs:Number.isSafeInteger(receipt.firstAtMs)?receipt.firstAtMs:0,
     lastAtMs:Number.isSafeInteger(receipt.lastAtMs)?receipt.lastAtMs:0,
     sceneNotes:visualNotes,notesMethod:focusedSummary?'text-model-focus-merge':modelSummary?'vision-model-same-call':'extractive-fallback',
     modelMentions:legacyMentions}}:{})}
}
function desiredStage(e,now,halfLife){const age=Math.max(0,now-Math.max(e.at,Number(e.reinforcedAt)||e.at))/DAY,importance=Number(e.importance)||0.4
 const h=halfLife*(0.6+importance*1.35)*Math.min(1.45,1+0.06*(Number(e.reinforceCount)||0))
 return age<h*.6?'clear':age<h*1.35?'fuzzy':age<h*2.6?'trace':'forgotten'
}
// Read-only reference value for the relationship UI and the live memory gateway.
// Only public social episodes opt into this policy. Other memories keep the global rule.
export const SOCIAL_MEMORY_DECAY_DEFAULTS=Object.freeze({
 socialMemoryHalfLifeNewDays:1.3,socialMemoryHalfLifeKnownDays:3,
 socialMemoryHalfLifeFamiliarDays:10,socialMemoryHalfLifeFriendDays:24,
 socialMemoryHalfLifeWhitelistDays:30,socialMemoryHalfLifeOwnerDays:50
})
export function relationshipMemoryHalfLifeDays(relation,generalHalfLifeDays=30,settings={}){
 const general=Math.max(15,Math.min(120,Number(generalHalfLifeDays)||30))
 const key=relation?.permissionRole==='owner'?'socialMemoryHalfLifeOwnerDays':
  relation?.whitelisted?'socialMemoryHalfLifeWhitelistDays':
  relation?.stage==='friend'?'socialMemoryHalfLifeFriendDays':
  relation?.stage==='familiar'?'socialMemoryHalfLifeFamiliarDays':
  relation?.stage==='known'?'socialMemoryHalfLifeKnownDays':'socialMemoryHalfLifeNewDays'
 const candidate=Number(settings?.[key])
 const base=Number.isFinite(candidate)&&candidate>=.25&&candidate<=120?candidate:SOCIAL_MEMORY_DECAY_DEFAULTS[key]
 return Math.max(.25,Math.min(120,base*general/30))
}
const stages=['clear','fuzzy','trace','forgotten']
function fadeEpisode(e,stage){if(stages.indexOf(stage)<=stages.indexOf(e.stage))return false
 if(stage==='fuzzy'){delete e.focusRevision;delete e.visualMemo;delete e.readEvidenceKinds;e.text=e.fuzzy;delete e.fuzzy;delete e.bvid;delete e.dynamicId;delete e.contentType;delete e.actorUid;delete e.key;delete e.incomingText;delete e.confirmedReply;delete e.deliberateSilence;delete e.decisionReason;delete e.socialTier;delete e.recipientUid;delete e.action; if(e.kind==='private-social')delete e.key}
 if(stage==='trace'){delete e.focusRevision;delete e.visualMemo;delete e.readEvidenceKinds;e.text=e.trace;delete e.fuzzy;delete e.bvid;delete e.dynamicId;delete e.contentType;delete e.actorUid;delete e.key;delete e.incomingText;delete e.confirmedReply;delete e.deliberateSilence;delete e.decisionReason;delete e.socialTier;delete e.recipientUid;delete e.action; if(e.kind==='private-social')delete e.key}
 if(stage==='forgotten'){delete e.focusRevision;delete e.visualMemo;delete e.readEvidenceKinds;e.text='';delete e.relationHalfLifeDays;delete e.fuzzy;delete e.trace;delete e.key;delete e.bvid;delete e.dynamicId;delete e.contentType;delete e.actorUid;delete e.incomingText;delete e.confirmedReply;delete e.deliberateSilence;delete e.decisionReason;delete e.socialTier;delete e.recipientUid;delete e.action; if(e.kind==='private-social')delete e.key}
 e.stage=stage;return true
}
export function createLifeMemoryGateway({dataDir,getConfig=()=>({}),getRelationship=()=>null,getAccountTag=()=>'',onEpisodesRemoved=()=>{},onDetailsInvalidated=()=>{},onDetailsChanged=()=>{},admitMemoryDetails=()=>false,now=Date.now,logger=console}={}){
 if(!dataDir)throw TypeError('missing dataDir')
 const file=storageDataPath(dataDir,'life-memory','episodic.json')
 const details=createLifeMemoryDetailStore({dataDir,logger})
 // In-memory, rebuildable only from the live fading copy; never index archives.
 const hybrid=createHybridIndex({logger})
 const searchLive=data=>{const signature=createHash('sha256').update(JSON.stringify(data.episodes)).digest('hex');hybrid.rebuild(data.episodes.filter(e=>e.stage!=='forgotten'&&e.text).map(e=>({id:e.id,text:safeRecallSummary(e),exactId:e.stage==='clear'?(e.dynamicId||e.bvid):'',nearTitle:e.stage==='clear'&&e.kind==='watch'?(e.text.match(/《([^》]+)》/)||[])[1]||'':'',exactDateEligible:e.stage==='clear',at:e.at,importance:e.importance})),signature);return hybrid}
 const empty=()=>({version:1,episodes:[],archiveKeys:[],migrated:false,updatedAt:0})
 // Serialize the read/modify/write of the shared fading store, including
 // decay and focus revisions. Synchronous callbacks may re-enter this same
 // Gateway; other instances/processes must retry the durable lock.
 let lockDepth=0
 const locked=fn=>(...args)=>{
  if(lockDepth)return fn(...args)
  return withDurableFileLock(file+'.lock',()=>{lockDepth++;try{return fn(...args)}finally{lockDepth--}})
 }
 mkdirSync(dirname(file),{recursive:true})
 locked(()=>{if(!existsSync(file))save(file,empty())})()
 const read=()=>{const x=atom(file);if(!x)return empty();if(x.version!==1||!Array.isArray(x.episodes)||!Array.isArray(x.archiveKeys))throw Error('可衰减记忆版本不兼容');return {...x,episodes:expandVideoObservationGroups(x.episodes)}}
 const saveEpisodes=data=>save(file,{...data,episodes:packVideoObservationGroups(data.episodes)})
 const halfLife=()=>Math.max(15,Math.min(120,Number(getConfig()?.mainSessionMemoryHalfLifeDays)||30))
 // Only *new* public social memories opt in to relationship-adjusted decay.
 // Old records preserve the user's existing decay policy. No archive reads.
 // One unavailable SQLite index must not trigger hundreds of finalized-statement
 // reads during one fading pass, or reinterpret an unknown relation as 'new'.
 let lastRelationshipWarningAt=-Infinity
 const warnRelationshipUnavailable=(error,affected=1)=>{
  const t=Number(now())||Date.now()
  if(t-lastRelationshipWarningAt<60_000)return
  lastRelationshipWarningAt=t
  logger.warn?.('关系衰减索引暂不可用，本轮 '+affected+' 条沿用已存半衰期：'+String(error?.message||error).slice(0,90))
 }
 function effectiveHalfLife(e,batch=null){
  const general=halfLife()
  if(e.relationDecay!==true||e.kind!=='social')return general
  let days=Number(e.relationHalfLifeDays)||general
  if(e.stage==='clear'&&validUid(e.actorUid)){
   if(batch?.unavailable){batch.skipped++;return days}
   try{
    const r=getRelationship(e.actorUid)
    if(r===undefined)throw Error('relationship-index-unavailable')
    days=relationshipMemoryHalfLifeDays(r,general,getConfig())
   }catch(err){
    if(batch){batch.unavailable=true;batch.error=err;batch.failed++}
    else warnRelationshipUnavailable(err)
   }
  }
  return days
 }
 function decay(){const data=read(),t=now();let changed=0;const removed=[],corrected=[],detailsInvalidated=[]
  const relationBatch={unavailable:false,failed:0,skipped:0,error:null}
  for(const e of data.episodes){
   if(repairAmbiguousAtEpisode(e)){changed++;corrected.push(e.id)}
   const previous=e.stage,h=effectiveHalfLife(e,relationBatch);if(e.relationDecay===true&&e.stage==='clear'&&e.relationHalfLifeDays!==h){e.relationHalfLifeDays=h;changed++}
   if(fadeEpisode(e,desiredStage(e,t,h))){changed++;if(previous==='clear'&&e.stage!=='clear')detailsInvalidated.push(e.id);if(previous!=='forgotten'&&e.stage==='forgotten'){e.forgottenAt=t;removed.push(e.id)}}
  }
  if(relationBatch.unavailable)warnRelationshipUnavailable(relationBatch.error,relationBatch.failed+relationBatch.skipped)
  if(changed){data.updatedAt=t;saveEpisodes(data)}
  if(detailsInvalidated.length){
   try{details.purge(detailsInvalidated)}catch(error){logger.warn?.('深层详情清理待恢复：'+String(error?.message||error).slice(0,90))}
   try{onDetailsInvalidated(detailsInvalidated)}catch{}
  }
  // Purge stale external embeddings carrying the old injected nickname text;
  // next indexing may only use the corrected live, authorized episode.
  if(corrected.length)try{onEpisodesRemoved(corrected,{reason:'source-correction'})}catch(error){logger.warn?.('错误提及记忆向量清理失败：'+String(error?.message||error).slice(0,120))}
  if(removed.length)try{onEpisodesRemoved(removed,{reason:'forgotten'})}catch(error){logger.warn?.('遗忘向量清理通知失败：'+String(error?.message||error).slice(0,120))}
  return {changed,data}}
 function archive(e,id){const month=new Date(Math.min(now(),timeOf(e))).toISOString().slice(0,7),folder=storageDataPath(dataDir,'life-memory','archive'),target=join(folder,month+'.jsonl');mkdirSync(folder,{recursive:true});if(existsSync(target)&&lstatSync(target).isSymbolicLink())throw Error('永久档案路径不可为符号链接');appendFileSync(target,JSON.stringify({version:1,id,recordedAt:new Date(now()).toISOString(),event:e})+'\n',{mode:0o600})}
 function recordEvents(events=[],{migration=false}={}){
  const data=decay().data,known=new Set(data.archiveKeys),episodes=new Set(data.episodes.map(x=>x.id)),clock=now();let added=0,shallowAdded=0,visualAppended=0
  const relationBatch={unavailable:false,failed:0,skipped:0,error:null}
  for(const e of events){const x=asEpisode(e,clock);if(!x||known.has(x.id)||e.visualObservationState==='cached')continue
   // Legacy import events retain the historical general decay, not dev.9's new encounter policy.
   if(migration)x.relationDecay=false
   // Archive append precedes index update, so an IO failure never marks an event archived.
   // Private archive contains ONLY source identity + digest, never a private
   // transcript or derived sensitive wording. The fading copy is the evidence.
   archive(x.kind==='private-social'?{kind:x.kind,key:x.key,visibility:x.visibility,subjectHash:hash(x.subjectUid),at:x.at,redacted:true}:x.kind==='action'?{kind:'action',key:x.key,action:x.action,at:x.at,accountTag:x.accountTag,verified:true,redacted:true}:
     x.kind==='watch'&&e.experience?.visualSceneNotes?{...e,experience:{...e.experience,visualSceneNotes:undefined}}:e,x.id);known.add(x.id)
   const h=effectiveHalfLife(x,relationBatch)
   if(x.relationDecay===true)x.relationHalfLifeDays=h
   fadeEpisode(x,desiredStage(x,clock,h))
   if(!episodes.has(x.id)){
    // Only new verified visual observations join a slot. Migration and all
    // preexisting independent episodes retain their historical representation.
    if(!migration&&groupNewVideoObservation(data.episodes,x))visualAppended++;else shallowAdded++
    data.episodes.push(x);episodes.add(x.id);added++
   }
  }
  if(relationBatch.unavailable)warnRelationshipUnavailable(relationBatch.error,relationBatch.failed+relationBatch.skipped)
  if(added||known.size!==data.archiveKeys.length||migration){
   data.archiveKeys=[...known].slice(-30000)
   const before=new Set(data.episodes.map(e=>e.id))
   // Nested receipts are adjacent to their root on disk, not necessarily
   // chronological. Evict by the existing archive insertion order, not by
   // the position of a child next to an older root.
   if(data.episodes.length>MAX_EPISODES){
    const order=new Map([...known].map((id,i)=>[id,i]))
    data.episodes.sort((a,b)=>(order.get(a.id)??-1)-(order.get(b.id)??-1))
    data.episodes=data.episodes.slice(-MAX_EPISODES)
   }
   const kept=new Set(data.episodes.map(e=>e.id)),removed=[...before].filter(id=>!kept.has(id))
   data.migrated=data.migrated||migration;data.updatedAt=clock;saveEpisodes(data)
   if(removed.length)try{details.purge(removed)}catch(error){logger.warn?.('过期深层详情清理待恢复：'+String(error?.message||error).slice(0,90))}
   if(removed.length)try{onEpisodesRemoved(removed,{reason:'live-window-evicted'})}catch(error){logger.warn?.('过期向量清理通知失败：'+String(error?.message||error).slice(0,120))}
  }
  return {added,total:data.episodes.length,shallowAdded,visualAppended}
 }
 // No unbounded/unrestricted archive lookup here: all callers see the faded copy.
 // Only a confirmed outbound public reply enriches the matching incoming episode.
 // The archive stores the reply event separately; no erased episode is revived.
 function recordSocialReply({actorUid='',bvid='',incomingRpid='',text='',at=now()}={}){
  const uid=String(actorUid),rpid=String(incomingRpid),reply=clean(text,130)
  if(!validUid(uid)||!validBV(bvid)||!validRpid(rpid)||!reply)return {ok:false,reason:'invalid-social-reply'}
  const data=decay().data,originalKey=`social:${uid}:${bvid}:${rpid}`
  const episode=data.episodes.find(e=>e.id==='e-'+hash(originalKey)&&e.stage==='clear'&&e.kind==='social'&&e.actorUid===uid)
  if(!episode||ACCOUNT.test(String(episode.accountTag||''))&&
    episode.accountTag!==String(getAccountTag()||''))return {ok:false,reason:'original-episode-unavailable'}
  const replyKey=`social-reply:${uid}:${bvid}:${rpid}`,replyId='e-'+hash(replyKey)
  if(data.archiveKeys.includes(replyId))return {ok:true,duplicate:true}
  const event={kind:'social-reply',key:replyKey,bvid,actorUid:uid,incomingRpid:rpid,text:reply,at}
  archive(event,replyId)
  data.archiveKeys.push(replyId);data.archiveKeys=data.archiveKeys.slice(-30000)
  // Preserve the encounter and fish's actual reply, but do not create a new
  // independent recalled episode or prolong its natural lifespan.
  const original=episode.text.replace(/(对方当时说“)([^”]+)(”)/,(_all,head,body,end)=>head+clean(body,115)+end)
  episode.text=original.replace(/；我当时自主决定不回复/g,'')+`；我当时回复“${reply}”`;episode.confirmedReply=true;episode.deliberateSilence=false;episode.decisionReason=''
  data.updatedAt=now();saveEpisodes(data)
  return {ok:true}
 }
 // Explicit agency choice, NOT an absence of reply. This must be called only
 // after the decision is recorded, never on a timeout or network failure.
 function recordSocialDecline({actorUid='',bvid='',incomingRpid='',reason='general',at=now()}={}){
  const uid=String(actorUid),rpid=String(incomingRpid)
  if(!validUid(uid)||!validBV(bvid)||!validRpid(rpid)||!['respect-request','general'].includes(reason))return {ok:false,reason:'invalid-decision'}
  const data=decay().data,key=`social:${uid}:${bvid}:${rpid}`
  const episode=data.episodes.find(e=>e.id==='e-'+hash(key)&&e.stage==='clear'&&e.kind==='social'&&e.actorUid===uid)
  if(!episode||episode.confirmedReply===true||
    ACCOUNT.test(String(episode.accountTag||''))&&episode.accountTag!==String(getAccountTag()||''))
    return {ok:false,reason:'episode-unavailable-or-replied'}
  if(episode.deliberateSilence===true)return {ok:true,duplicate:true}
  const id='e-'+hash('social-decision:'+uid+':'+bvid+':'+rpid)
  if(data.archiveKeys.includes(id))return {ok:false,reason:'decision-already-archived'}
  archive({kind:'social-decision',key:'social-decision:'+uid+':'+bvid+':'+rpid,bvid,actorUid:uid,incomingRpid:rpid,decision:'declined',reason,at},id)
  data.archiveKeys.push(id);data.archiveKeys=data.archiveKeys.slice(-30000)
  episode.deliberateSilence=true;episode.decisionReason=reason
  episode.text+='；我当时自主决定不回复'
  data.updatedAt=now();saveEpisodes(data)
  return {ok:true}
 }
 function accessible(data,{domain='main-session',role='owner',actorUid='',kinds=null,excludeEventKey=''}={}){
  const publicScene=domain!=='main-session'
  const explore=domain==='bili-explore'
  const uid=publicScene&&!explore&&validUid(actorUid)?String(actorUid):''
  if(publicScene&&!explore&&(!uid||!['owner','friend','stranger'].includes(role)))return []
  if(publicScene&&!explore&&!['bili-life','bili-dm','bili-public-understanding'].includes(domain))return []
  const allowedKinds=Array.isArray(kinds)?new Set(kinds.filter(k=>['watch','comment','social','private-social','action'].includes(k))):null
  const excludedId=excludeEventKey?'e-'+hash(clean(excludeEventKey,220)):''
  const accountTag=String(getAccountTag()||'')
  return data.episodes.filter(e=>(e.kind!=='action'||ACCOUNT.test(accountTag)&&e.accountTag===accountTag&&!publicScene&&role==='owner')&&
    // Public Bilibili consumers may only recall explicitly public memories of
    // the verified account. Do not launder old unscoped records into public AI.
    (!publicScene||ACCOUNT.test(accountTag)&&e.accountTag===accountTag&&
      (e.kind==='private-social'||e.visibility==='public-event'))&&
    (!ACCOUNT.test(accountTag)||!ACCOUNT.test(String(e.accountTag||''))||e.accountTag===accountTag)&&
    e.stage!=='forgotten'&&e.text&&e.id!==excludedId&&(!allowedKinds||allowedKinds.has(e.kind))&&
    (e.kind==='private-social'?canReadPrivate({visibility:e.visibility,subjectUid:e.subjectUid,domain,role,actorUid})&&
      (domain!=='bili-public-understanding'||ACCOUNT.test(accountTag)&&e.accountTag===accountTag):
    (!publicScene||(explore?e.kind==='watch':(e.kind==='watch'&&e.visibility==='public-event'||e.kind==='social'&&e.stage==='clear'&&e.actorUid===uid)))))
 }
 function recall({query='',domain='main-session',role='owner',actorUid='',kinds=null,maxItems=8,maxChars=900,reinforce=false,excludeEventKey=''}={}){
  const {data}=decay(),t=now(),allowed=accessible(data,{domain,role,actorUid,kinds,excludeEventKey})
  const q=tokens(query),isPublic=domain!=='main-session',ids=new Set(allowed.map(e=>e.id))
  const minEvidence=Math.max(.10,Math.min(.80,Number(getConfig()?.mainSessionMemoryThreshold)||.25))
  const lookup=new Map(allowed.map(e=>[e.id,e]))
  // Privacy, UID and forgetting gates precede ALL lexical/FTS/time routes.
  // Never pass archive text or a removed clear detail into the index.
  const index=searchLive(data)
  const ranked=index.search(query,{now:t,limit:Math.min(MAX_EPISODES,Math.max(160,Number(maxItems)*18)),filter:r=>ids.has(r.id)})
  const results=[]
  for(const item of ranked){
   const e=lookup.get(item.id);if(!e)continue
   const familiarRecently=isPublic&&e.kind==='social'&&e.actorUid===String(actorUid)&&t-e.at<=7*DAY
   if(q.size&&item.evidence<minEvidence&&!familiarRecently)continue
   results.push(e)
  }
  const take=[],cap=Math.max(100,Math.min(3000,Number(maxChars)||900));let used=0
  const grouped=new Set()
  for(const e of results){const group=e.kind==='watch'&&e.stage==='clear'&&['public-event','private-session'].includes(e.visibility)&&ACCOUNT.test(String(getAccountTag()||''))&&e.accountTag===String(getAccountTag()||'')&&validBV(e.bvid)?e.visibility+':'+e.bvid:''
   if(group&&grouped.has(group))continue
   if(take.length>=Math.max(1,Math.min(12,Number(maxItems)||8)))break
   const text=safeRecallSummary(e);if(used+text.length>cap)continue;used+=text.length;if(group)grouped.add(group)
   take.push({id:e.id,stage:e.stage,summary:text,at:e.stage==='clear'?new Date(e.at).toISOString():'',kind:e.kind,
     ...(e.stage==='clear'&&isDateOnlyWatch(e)?{dateOnly:true,day:e.key?.match(/^watch:(\d{4}-\d{2}-\d{2}):/)?.[1]||new Date(e.at).toISOString().slice(0,10)}:{}),
     ...(e.stage==='clear'&&damagedWatchText(e)?{titleCorrupted:true}:{}),
     ...(e.stage==='clear'&&['watch','action'].includes(e.kind)&&validBV(e.bvid)?{bvid:e.bvid}:{}),...(e.stage==='clear'&&validDynamicId(e.dynamicId)?{contentType:'dynamic',dynamicId:e.dynamicId}:{})})
  }
  if(reinforce&&take.length){let dirty=false;for(const chosen of take){const e=data.episodes.find(x=>x.id===chosen.id);if(e&&t-(e.lastRecallAt||0)>DAY){e.lastRecallAt=t;e.reinforcedAt=t;e.reinforceCount=Math.min(20,(e.reinforceCount||0)+1);dirty=true}}if(dirty)saveEpisodes(data)}
  return take
 }
 function semanticCandidates({query='',domain='main-session',role='owner',actorUid='',limit=48,kinds=null,ids=null,excludeEventKey='',visualOnly=false,expectedAccountTag=''}={}){
  if(expectedAccountTag&&(!ACCOUNT.test(expectedAccountTag)||expectedAccountTag!==String(getAccountTag()||'')))return []
  const {data}=decay(),t=now(),allowed=accessible(data,{domain,role,actorUid,kinds,excludeEventKey}).filter(e=>!visualOnly||e.kind==='watch'&&e.stage==='clear'&&e.visualMemo&&validBV(e.bvid)&&e.at<=t)
  const selectedIds=Array.isArray(ids)?new Set(ids.filter(x=>typeof x==='string')):null
  const map=x=>({id:x.id,kind:x.kind,stage:x.stage,summary:clean(x.text,330),importance:x.importance||0,at:x.stage==='clear'?new Date(x.at).toISOString():'',...(x.stage==='clear'&&['watch','action'].includes(x.kind)&&validBV(x.bvid)?{bvid:x.bvid}:{}),...(x.stage==='clear'&&validDynamicId(x.dynamicId)?{contentType:'dynamic',dynamicId:x.dynamicId}:{})})
  // Revalidation by ID is not re-ranked. Deleted, forgotten or unauthorized
  // candidates cannot survive an asynchronous AI call.
  if(selectedIds)return allowed.filter(e=>selectedIds.has(e.id)).map(map)
  const cap=Math.max(1,Math.min(MAX_EPISODES,Math.floor(Number(limit)||48)))
  const lookup=new Map(allowed.map(e=>[e.id,e])),index=searchLive(data)
  const ranked=index.search(query,{now:t,limit:Math.min(MAX_EPISODES,Math.max(cap*3,160)),filter:e=>lookup.has(e.id)})
  const relevant=ranked.filter(x=>x.evidence>0).slice(0,Math.ceil(cap*.65)).map(x=>lookup.get(x.id))
  const selected=[...relevant],used=new Set(selected.map(e=>e.id))
  // Mix distinct event types in the backoff pool. A giant comment thread
  // cannot crowd all remembered videos and relationships out of AI's shortlist.
  const remaining=allowed.filter(e=>!used.has(e.id)).sort((a,b)=>b.at-a.at||b.importance-a.importance)
  while(selected.length<cap&&remaining.length){let progress=false
   for(const kind of ['watch','social','comment','action','private-social']){const i=remaining.findIndex(e=>e.kind===kind);if(i<0)continue
    selected.push(remaining.splice(i,1)[0]);progress=true;if(selected.length>=cap)break
   }if(!progress)break
  }
  return selected.map(map)
 }
 function reflectionEvidence(ids,{visibility='public-event',subjectUid=''}={}){const {data}=decay();return ids.map(key=>{const e=data.episodes.find(x=>x.id==='e-'+hash(key)||x.key===key||x.id===key);if(!e||e.stage==='forgotten'||!e.text)return null
   if(visibility==='public-event'&&(e.visibility!=='public-event'||
     !ACCOUNT.test(String(getAccountTag()||''))||e.accountTag!==String(getAccountTag()||'')))return null
   if(e.kind==='action'&&e.accountTag!==String(getAccountTag()||''))return null
   if(visibility!=='public-event'&&(e.kind!=='private-social'||e.visibility!==visibility||e.subjectUid!==subjectUid))return null
   return {key,id:e.id,kind:e.kind,stage:e.stage,text:e.text,at:e.at,importance:Number(e.importance)||0,visibility:e.visibility,subjectUid:e.subjectUid||'',sensitivity:e.kind==='private-social'?e.sensitivity:'',...(e.stage==='clear'?{bvid:e.bvid||'',...(validDynamicId(e.dynamicId)?{contentType:'dynamic',dynamicId:e.dynamicId}:{}),...(e.kind==='social'?{actorUid:e.actorUid||'',incomingText:e.incomingText||'',confirmedReply:e.confirmedReply===true,deliberateSilence:e.deliberateSilence===true,decisionReason:e.decisionReason||'',socialTier:e.socialTier||'unknown'}:{})}:{})}}).filter(Boolean)}
 // Source candidate IDs are used as *pointers only*. Returned facts come from the
 // live, faded copy. Precise BV/date/title disappear when a memory becomes fuzzy.
 function emotionEvidence(candidateRows=[]){
  const rows=Array.isArray(candidateRows)?candidateRows:[]
  const current=new Map(reflectionEvidence(rows.map(x=>x.key)).filter(x=>x.stage==='clear'&&(x.bvid||validDynamicId(x.dynamicId))).map(x=>[x.key,x]))
  return rows.flatMap(c=>{
   const e=current.get(c.key)
   if(!e||!['watch','comment'].includes(e.kind)||e.kind!==c.kind)return []
   return [{id:c.id,kind:e.kind,bvid:e.bvid,...(validDynamicId(e.dynamicId)?{contentType:'dynamic',dynamicId:e.dynamicId}:{}),day:new Date(e.at).toISOString().slice(0,10),
    title:e.kind==='watch'?(e.text.match(/《([^》]+)》/)||[])[1]||'':''}]
  })
 }
 // Only live, clear copies: an emotional association must never rebuild
 // details from the permanent archive or from the reflection candidate file.
 function recentEmotionEvents(limit=80){
  const t=now(),cap=Math.max(1,Math.min(160,Math.floor(Number(limit)||80)))
  const accountTag=String(getAccountTag()||'')
  if(!ACCOUNT.test(accountTag))return []
  return decay().data.episodes.filter(e=>e.stage==='clear'&&e.visibility==='public-event'&&
    e.accountTag===accountTag&&['watch','comment'].includes(e.kind)&&(validBV(e.bvid)||e.kind==='comment'&&validDynamicId(e.dynamicId))&&e.at<=t&&t-e.at<=30*DAY)
   .sort((a,b)=>b.at-a.at).slice(0,cap).map(e=>({kind:e.kind,bvid:e.bvid,...(validDynamicId(e.dynamicId)?{contentType:'dynamic',dynamicId:e.dynamicId}:{}),day:new Date(e.at).toISOString().slice(0,10),
    title:e.kind==='watch'?(e.text.match(/《([^》]+)》/)||[])[1]||'':''}))
 }
 /** Current-account, clear-only visual memory for a FUTURE Life Episode.
  * Not the universal action ledger: no model quotes, image bytes, archive reads,
  * user messages or third-party commands. Old accountless events stay hidden. */
 function recentVisualExperienceContext({accountTag='',limit=3,bvids=[],queries=[],memoryIds=null,excludeBvids=[],includeMemoryId=false}={}){
  const tag=String(accountTag||''),current=String(getAccountTag()||'')
  if(!ACCOUNT.test(tag)||tag!==current)return []
  const seen=new Set(),t=now()
  const rankedIds=Array.isArray(memoryIds)?new Map(memoryIds.slice(0,48).map((id,i)=>[id,i])):null
  const excluded=new Set(Array.isArray(excludeBvids)?excludeBvids.filter(validBV):[])
  const exact=new Set((Array.isArray(bvids)?bvids:[]).slice(0,32).filter(validBV))
  const terms=(Array.isArray(queries)?queries:[]).slice(0,8).map(q=>clean(q,80).toLowerCase()).filter(q=>q.length>=3)
  const relevance=e=>{
   const title=(e.text.match(/《([^》]+)》/)||[])[1]||''
   const text=[title,...safeVideoObservationNotes(e.visualMemo.sceneNotes)].join(' ').toLowerCase()
   return exact.has(e.bvid)?2:terms.some(q=>text.includes(q))?1:0
  }
  return decay().data.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&
    e.visibility==='public-event'&&e.accountTag===tag&&validBV(e.bvid)&&e.visualMemo&&e.at<=t&&
    !excluded.has(e.bvid)&&(!rankedIds||rankedIds.has(e.id)))
   .sort((a,b)=>rankedIds?rankedIds.get(a.id)-rankedIds.get(b.id):relevance(b)-relevance(a)||b.at-a.at).filter(e=>{if(seen.has(e.bvid))return false;seen.add(e.bvid);return true})
   .slice(0,Math.max(1,Math.min(5,Number(limit)||3))).map(e=>({
     bvid:e.bvid,at:e.at,source:e.visualMemo.source,
     ...(rankedIds||includeMemoryId?{memoryId:e.id}:{}),
     title:clean((e.text.match(/《([^》]+)》/)||[])[1],100),
     frameCount:e.visualMemo.frameCount,fromMs:e.visualMemo.firstAtMs,
     toMs:e.visualMemo.lastAtMs,sceneNotes:safeVideoObservationNotes(e.visualMemo.sceneNotes),
     notesMethod:['vision-model-same-call','text-model-focus-merge'].includes(e.visualMemo.notesMethod)?e.visualMemo.notesMethod:'extractive-fallback',
     modelMentions:safeVideoSceneCues(e.visualMemo.modelMentions),
     certainty:'visual-model-mentions-not-verified-scene-facts'}))
 }
 /** Read-only current-account video provenance by exact BV and/or memory ID.
  * Never consult archives, never reconstruct fuzzy memories, and never infer
  * one observation from another merely because the BV or time is similar.
  * The memory ID may later serve as an opaque, revalidated detail adapter key;
  * this version neither saves nor loads any deep-memory attachments. */
 /** Bounded detail API. No model calls, tool permissions or archive fallback.
  * Production admission remains CLOSED until dev.3 connects trusted evidence. */
 function activeDetailParent({memoryId='',accountTag='',ownerSession=false}){
  const current=String(getAccountTag()||''),tag=String(accountTag||'')
  if(!ACCOUNT.test(current)||tag!==current||!/^e-[a-f0-9]{18}$/.test(memoryId))return null
  return decay().data.episodes.find(e=>e.id===memoryId&&e.stage==='clear'&&
    e.accountTag===current&&e.kind==='watch'&&(e.visibility==='public-event'||ownerSession===true&&e.visibility==='private-session')&&
    validBV(e.bvid)&&e.visualMemo&&Array.isArray(e.readEvidenceKinds)&&
    e.readEvidenceKinds.includes('visual-model-observation'))||null
 }
 function attachMemoryDetails({memoryId='',accountTag='',fragments=[],sourceProof=null,ownerSession=false}={}){
  const parent=activeDetailParent({memoryId,accountTag,ownerSession})
  if(!parent)return {ok:false,reason:'memory-unavailable'}
  // Dev.2 never accepts caller-supplied 'verified:true'. Only a trusted
  // internal evidence adapter can admit a bound source in a later version.
  let admitted=false
  try{admitted=admitMemoryDetails({episode:parent,fragments,sourceProof})===true}catch{}
  if(!admitted)return {ok:false,reason:'source-not-admitted'}
  try{const result=details.write({episode:parent,fragments,verified:true,append:true});if(result.ok)try{onDetailsChanged(memoryId)}catch{};return result}
  catch(error){return {ok:false,reason:'detail-write-rejected',error:String(error?.message||error).slice(0,120)}}
 }
 /** A single internal, post-verification admission of one focused video window.
  * The owner-facing API never receives a writable sourceProof. Detail persistence
  * precedes the shallow projection; failed shallow saves are reported as partial
  * rather than falsely claiming a complete memory update. */
 function recordVerifiedFocusRevision({memoryId='',accountTag='',bvid='',review=null,sourceProof=null,sourceRef='',verifiedFragments=null}={}){
  const parent=activeDetailParent({memoryId,accountTag})
  if(!parent||parent.bvid!==bvid)return {ok:false,reason:'memory-unavailable'}
  if(!review||review.reviewStatus!=='model-observation-not-independent-semantic-proof'||
    !Number.isSafeInteger(review.startMs)||!Number.isSafeInteger(review.endMs)||
    review.startMs<0||review.endMs<=review.startMs||review.endMs>14400_000||
    !Array.isArray(review.frameTimesMs)||review.frameTimesMs.length<1||review.frameTimesMs.length>48||
    !/^focus:[a-f0-9]{24,40}$/.test(sourceRef))return {ok:false,reason:'invalid-verified-window'}
  const observation=clean(review.description,1300)
  if(!observation)return {ok:false,reason:'no-observation-text'}
  // The internal host grants exactly one unforgeable one-use proof after
  // verifying this same BV, account, parent and actual visual-model result.
  const fragment={fragmentId:'focus-'+sourceRef.slice(-24),type:'focused-observation',
    sourceRef,certainty:'model-observation',content:observation,
    timeAnchorMs:[review.startMs,review.endMs],uncertainties:['仅为模型对已解码帧的观察，未独立验证语义结论']}
  const parts=verifiedFragments===null?[fragment]:verifiedFragments
  if(!Array.isArray(parts)||!parts.length||parts.length>48||verifiedFragments!==null&&parts.some(p=>p?.sourceRef!==sourceRef||p.certainty!=='model-observation'||!Array.isArray(p.timeAnchorMs)||p.timeAnchorMs.length!==2||p.timeAnchorMs.some(t=>!review.frameTimesMs.includes(t))))return {ok:false,reason:'no-fresh-detail-evidence'}
  let admitted=false
  try{admitted=admitMemoryDetails({episode:parent,fragments:parts,sourceProof})===true}catch{}
  if(!admitted)return {ok:false,reason:'source-not-admitted'}
  let detailSaved=false
  try{
    const data=read(),live=data.episodes.find(e=>e.id===memoryId&&e.stage==='clear'&&
      e.accountTag===accountTag&&e.bvid===bvid&&e.visibility==='public-event')
    if(!live)return {ok:false,reason:'memory-changed-before-detail'}
    const version=(Number.isSafeInteger(live.focusRevision?.version)?live.focusRevision.version:0)+1
    if(version>32)return {ok:false,reason:'revision-limit'}
    const deep=details.write({episode:parent,fragments:parts,verified:true,append:true})
    detailSaved=true
    const previous=live.focusRevision?.fingerprint||hash(live.text)
    const clock=now()
    const timeLabel=Math.floor(review.startMs/1000)+'–'+Math.ceil(review.endMs/1000)+' 秒'
    const notes=safeVideoObservationNotes(observation)
    const brief=clean(notes[0]||observation,73)
    const note='后来在 '+timeLabel+' 重新解码采样；模型观察（未独立核实）：'+brief
    live.focusRevision={version,previousFingerprint:previous,fingerprint:hash(previous+':'+sourceRef+':'+note),
      sourceRef,updatedAt:clock,window:[review.startMs,review.endMs],note:clean(note,125)}
    data.updatedAt=clock;saveEpisodes(data)
    if(deep.ok)try{onDetailsChanged(memoryId)}catch{}
    return {ok:true,memoryId,shallowVersion:version,deepFragments:deep.fragmentCount,
      certainty:'model-observation-not-independent-semantic-proof'}
  }catch(error){return {ok:false,reason:'memory-persist-failed',
    detailPersisted:detailSaved,error:String(error?.message||error).slice(0,130)}}
 }
 function expandMemoryDetail({memoryId='',accountTag='',maxBytes=8192}={}){
  const parent=activeDetailParent({memoryId,accountTag})
  if(!parent)return {ok:false,reason:'memory-unavailable'}
  try{return details.read(parent,{limitBytes:maxBytes})}
  catch(error){logger.warn?.('深层详情读取拒绝：'+String(error?.message||error).slice(0,90));return {ok:false,reason:'detail-invalid'}}
 }
 function memoryDetailInfo({memoryId='',accountTag='',ownerSession=false}={}){
  const parent=activeDetailParent({memoryId,accountTag,ownerSession})
  if(!parent)return {available:false,reason:'memory-unavailable'}
  try{return details.inspect(parent)}catch{return {available:false,reason:'detail-invalid'}}
 }
 // Explicit progressive recall only: a current-account public visual group,
 // selected by exact BV, optionally restricted to one exact memory ID. No
 // network reads, archive fallback, reinforcement, or background injection.
 // Group only currently clear, scoped public video episodes. Original episode
 // IDs, timestamps and revocation fences remain authoritative. No archive reads.
 function videoRecallGroups(rows){
  const tag=String(getAccountTag()||'')
  if(!ACCOUNT.test(tag)||!Array.isArray(rows))return rows||[]
  const allowed=accessible(decay().data,{domain:'main-session'})
  const live=new Map(allowed.filter(e=>e.kind==='watch'&&e.stage==='clear'&&['public-event','private-session'].includes(e.visibility)&&e.accountTag===tag&&validBV(e.bvid)).map(e=>[e.id,e]))
  const liveStage=new Map(allowed.map(e=>[e.id,e.stage]))
  rows=rows.filter(row=>liveStage.get(row.id)===row.stage&&liveStage.has(row.id))
  const groups=new Map(),out=[],seen=new Set()
  for(const row of rows){const e=live.get(row.id)
   if(!e)continue
   const group=e.visibility+':'+e.bvid
   if(!groups.has(group))groups.set(group,[])
   groups.get(group).push({row,e})
  }
  for(const row of rows){const e=live.get(row.id)
   if(!e){out.push(row);continue}
   const group=e.visibility+':'+e.bvid
   if(seen.has(group))continue;seen.add(group)
   const members=groups.get(group).sort((a,b)=>b.e.at-a.e.at||a.e.id.localeCompare(b.e.id))
   const first=members[0].row
   out.push(members.length===1?first:{...first,summary:'同一视频的 '+members.length+' 次当前清晰经历；最近一次：'+first.summary})
  }
  return out
 }
 function recallVideoDetails({bvid='',memoryId='',accountTag='',maxBytes=4096,ownerSession=false,visibility=''}={}){
  if(!validBV(bvid)||!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||'')||
    memoryId&&!/^e-[a-f0-9]{18}$/.test(memoryId))return {ok:false,reason:'memory-unavailable'}
  const current=decay().data.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&
    (e.visibility==='public-event'||ownerSession===true&&e.visibility==='private-session')&&(!visibility||e.visibility===visibility)&&
    e.accountTag===accountTag&&e.bvid===bvid&&e.at<=now()&&(!memoryId||e.id===memoryId))
  if(!current.length)return {ok:false,reason:'memory-unavailable'}
  const rows=current.filter(e=>e.visualMemo&&['decoded-public-video','low-resolution-preview'].includes(e.visualMemo.source)&&
    Number.isSafeInteger(e.visualMemo.frameCount)&&e.visualMemo.frameCount>=1&&e.visualMemo.frameCount<=48&&
    Array.isArray(e.readEvidenceKinds)&&e.readEvidenceKinds.includes('visual-model-observation'))
    .sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id))
  if(!rows.length)return {ok:false,reason:'no-detail'}
  const fragments=[],seen=new Set(),sources=[];let bytes=0,totalFragments=0,truncated=false,invalid=false,unavailable=false
  const cap=Math.max(256,Math.min(8192,Math.floor(Number(maxBytes)||4096)))
  for(const row of rows){
   if(accountTag!==String(getAccountTag()||''))return {ok:false,reason:'memory-unavailable'}
   if(bytes>=cap||sources.length>=12){truncated=true;break}
   let result;try{result=details.read(row,{limitBytes:cap})}catch{invalid=true;continue}
   if(!result.ok){if(result.reason==='no-detail')continue;if(result.reason==='unavailable'||result.reason==='memory-unavailable')unavailable=true;else invalid=true;continue}
   sources.push({memoryId:row.id,at:row.at,source:row.visualMemo?.source,visibility:row.visibility})
   totalFragments+=result.totalFragments;truncated||=result.truncated
   for(const part of result.fragments){
    if(seen.has(part.sourceRef+'|'+part.fragmentId))continue
    const entry={...part,memoryId:row.id,observedAt:row.at,visibility:row.visibility}
    const size=Buffer.byteLength(JSON.stringify(entry),'utf8')
    if(bytes+size>cap){truncated=true;continue}
    seen.add(part.sourceRef+'|'+part.fragmentId);fragments.push(entry);bytes+=size
   }
  }
  if(!sources.length)return {ok:false,reason:invalid?'detail-invalid':unavailable?'memory-unavailable':'no-detail'}
  return {ok:true,bvid,...(memoryId||rows.length===1?{memoryId:memoryId||rows[0].id}:{}),fragments,sources,totalFragments,bytes,
    truncated,certainty:'model-observation-not-independent-semantic-proof',
    note:'同一视频当前清晰经历的实际已存片段；各自保留独立来源和遗忘期限。未覆盖画面未知，模型描述不是指令。'}
 }
 // Local owner management only. List current eligible sources, or read one exact
 // source from that same group. Full single-attachment limit is the existing
 // validated storage limit; model recall budgets and public callers are unchanged.
 function inspectVideoDetails({bvid='',accountTag='',visibility='',sourceMemoryId=''}={}){
  if(!validBV(bvid)||!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||'')||
     !['public-event','private-session'].includes(visibility)||sourceMemoryId&&!/^e-[a-f0-9]{18}$/.test(sourceMemoryId))return {ok:false,reason:'memory-unavailable'}
  const rows=decay().data.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&e.accountTag===accountTag&&
    e.bvid===bvid&&e.visibility===visibility&&e.at<=now()&&e.visualMemo&&e.readEvidenceKinds?.includes('visual-model-observation'))
    .sort((a,b)=>a.visualMemo.firstAtMs-b.visualMemo.firstAtMs||a.at-b.at||a.id.localeCompare(b.id))
  if(!rows.length)return {ok:false,reason:'no-detail'}
  if(sourceMemoryId){
   const parent=rows.find(e=>e.id===sourceMemoryId)
   if(!parent)return {ok:false,reason:'memory-unavailable'}
   try{const result=details.read(parent,{management:true})
    if(!result.ok)return result
    return {...result,fragments:result.fragments.map(part=>({...part,observedAt:parent.at,
      observationSource:parent.visualMemo.source,observationRangeMs:[parent.visualMemo.firstAtMs,parent.visualMemo.lastAtMs]}))}
   }catch{return {ok:false,reason:'detail-invalid'}}
  }
  const sources=rows.map(row=>{
   let result;try{result=details.inspect(row)}catch{result={available:false,reason:'detail-invalid'}}
   return {memoryId:row.id,observedAt:row.at,observationSource:row.visualMemo.source,
    observationRangeMs:[row.visualMemo.firstAtMs,row.visualMemo.lastAtMs],frameCount:row.visualMemo.frameCount,
    available:result.available,reason:result.reason,totalFragments:result.totalFragments||0}
  })
  return {ok:true,sources,totalFragments:sources.reduce((n,x)=>n+x.totalFragments,0)}
 }
 // Bounded reverse activation corpus: current public visual parents only.
 // Derived, sanitized text, not a second memory store. The live attachment
 // and its original parent remain authoritative even for vector hits.
 function visualDetailCandidates({accountTag=String(getAccountTag()||''),ids=null,limit=128}={}){
  if(!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||''))return []
  const wanted=Array.isArray(ids)?new Set(ids):null
  const parents=decay().data.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&e.visibility==='public-event'&&
   e.accountTag===accountTag&&validBV(e.bvid)&&e.at<=now()&&e.visualMemo&&e.readEvidenceKinds?.includes('visual-model-observation')&&(!wanted||wanted.has(e.id)))
   .sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id)).slice(0,Math.max(1,Math.min(128,Number(limit)||128)))
  const out=[]
  for(const parent of parents){
   try{
    const detail=details.read(parent,{management:true});if(!detail.ok)continue
    const parts=detail.fragments.filter(p=>p.certainty==='model-observation'&&['observed-scene','focused-observation'].includes(p.type)).flatMap(p=>{
     const note=deriveVideoObservationNotes(p.content).join(' ')
     return note?[{fragmentId:p.fragmentId,sourceRef:p.sourceRef,timeAnchorMs:p.timeAnchorMs,note:note.slice(0,160)}]:[]
    }).slice(0,64)
    if(parts.length)out.push({id:parent.id,bvid:parent.bvid,parts,text:parts.map(p=>p.note).join(' ').slice(0,1800)})
   }catch{/* unavailable or revoked attachments do not become candidates */}
  }
  return accountTag===String(getAccountTag()||'')?out:[]
 }
 function reconcileMemoryDetails(){return details.reconcile(decay().data.episodes)}
 function videoEvidenceTrace({accountTag='',bvid='',memoryId='',visualOnly=false,limit=6,ownerSession=false}={}){
  const tag=String(accountTag||''),current=String(getAccountTag()||'')
  if(!ACCOUNT.test(tag)||tag!==current||
    (bvid&&!validBV(bvid))||(memoryId&&!/^e-[a-f0-9]{18}$/.test(memoryId))||
    (!bvid&&!memoryId))return []
  const t=now(),cap=Math.max(1,Math.min(12,Number.isFinite(limit)?Math.trunc(limit):6))
  return decay().data.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&
    (e.visibility==='public-event'||ownerSession===true&&e.visibility==='private-session')&&e.accountTag===tag&&validBV(e.bvid)&&e.at<=t&&
    (!bvid||e.bvid===bvid)&&(!memoryId||e.id===memoryId)&&
    (visualOnly!==true||(e.visualMemo&&['decoded-public-video','low-resolution-preview'].includes(e.visualMemo.source)&&
       Number.isSafeInteger(e.visualMemo.frameCount)&&e.visualMemo.frameCount>=1&&e.visualMemo.frameCount<=48&&
       Array.isArray(e.readEvidenceKinds)&&e.readEvidenceKinds.includes('visual-model-observation'))))
   .sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id)).slice(0,cap)
   .map(e=>({memoryId:e.id,bvid:e.bvid,at:e.at,visibility:e.visibility,
     sources:Array.isArray(e.readEvidenceKinds)?e.readEvidenceKinds.filter(k=>[
       'metadata','subtitle','asr-transcript','preview-frames','decoded-frames',
       'frame-ocr','visual-model-observation','public-comments','danmaku'].includes(k)):[],
     ...(e.visualMemo&&['decoded-public-video','low-resolution-preview'].includes(e.visualMemo.source)&&
       Number.isSafeInteger(e.visualMemo.frameCount)&&e.visualMemo.frameCount>=1?
       {visual:{source:e.visualMemo.source,frameCount:e.visualMemo.frameCount,
         firstAtMs:e.visualMemo.firstAtMs,lastAtMs:e.visualMemo.lastAtMs,
         certainty:'sampled-model-observation-not-full-playback'}}:{}),
     detailStorage:memoryDetailInfo({memoryId:e.id,accountTag:tag,ownerSession}).available?'available':'no-detail',readOnly:true}))
 }
 function publicVideoEvidence(limit=40){
  // A wider, time-ordered pool, deduplicated by video; still ONLY clear memories.
  const seen=new Set()
  const accountTag=String(getAccountTag()||'')
  if(!ACCOUNT.test(accountTag))return []
  return decay().data.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&
    e.visibility==='public-event'&&e.accountTag===accountTag&&validBV(e.bvid)&&e.text)
   .sort((a,b)=>b.at-a.at).filter(e=>{if(seen.has(e.bvid))return false;seen.add(e.bvid);return true})
   .slice(0,Math.max(0,Math.min(40,Number(limit)||40)))
   .map(e=>({bvid:e.bvid,day:new Date(e.at).toISOString().slice(0,10),title:(e.text.match(/《([^》]+)》/)||[])[1]||'',experience:(e.text.match(/；当时想法是(.+)$/)||[])[1]||''}))
 }
 // Only the fish's CONFIRMED PUBLIC words can become a source for a public dynamic.
 // Never expose incoming viewer quotes, actor UIDs, DMs, owner chats, or archives.
 // Fuzzy/trace memories are excluded: public drafts cannot resurrect lost details.
 function publicSocialEvidence(limit=16){
  const safeWords=v=>{const s=clean(v,175);return s.length>=6&&!/(?:https?:\/\/|www\.|@|邮箱|私信|密码|密钥|token|cookie|主人|私聊|手机号|电话|住址|身份证|加微信|微信号|QQ号|qq号|忽略.{0,8}指令|system\s*prompt)/i.test(s)&&!/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(s)&&!/(?:\+?86[- ]?)?1[3-9]\d{9}/.test(s)&&!/\d{7,}/.test(s)?s:''}
  const accountTag=String(getAccountTag()||'')
  if(!ACCOUNT.test(accountTag))return []
  return decay().data.episodes.filter(e=>e.stage==='clear'&&e.visibility==='public-event'&&
    e.accountTag===accountTag&&(validBV(e.bvid)||validDynamicId(e.dynamicId))&&e.text&&['comment','social'].includes(e.kind))
   .slice().sort((a,b)=>b.at-a.at).flatMap(e=>{
    const match=e.kind==='social'?e.text.match(/我当时回复“([^”]+)”/):e.text.match(/我当时写了“([^”]+)”/)
    const ownText=safeWords(match?.[1]||'')
    if(!ownText)return []
    return [{id:e.id,type:e.kind==='social'?'public_reply':'public_comment',day:new Date(e.at).toISOString().slice(0,10),ownText,bvid:e.bvid,...(validDynamicId(e.dynamicId)?{contentType:'dynamic',dynamicId:e.dynamicId}:{})}]
   }).slice(0,Math.max(0,Math.min(24,Number(limit)||16)))
 }


 function recordPrivateInsights(items=[]){
  const file=storageDataPath(dataDir,'life-memory','private-insights.json');const empty={schema:1,rows:[]}
  const data=atom(file)||empty
  if(data.schema!==1||!Array.isArray(data.rows))throw Error('私密反思账本格式不兼容')
  const rows=[];let added=0
  for(const item of items){
   if(!item||!['owner-private','friend-private'].includes(item.visibility)||!privateInsightSafe(item.text))continue
   if(item.visibility==='owner-private'&&item.subjectUid!=='owner')continue
   if(item.visibility==='friend-private'&&!validUid(item.subjectUid))continue
   if(!/^private:(?:owner-session|owner-dm|friend-dm):[a-f0-9]{20}$/.test(String(item.sourceKey||'')))continue
   // Never materialize an insight from a candidate that has already faded away,
   // been deleted, or belongs to a different privacy scope.
   const original=decay().data.episodes.find(e=>e.id==='e-'+hash(item.sourceKey))
   if(!original||original.stage==='forgotten'||original.kind!=='private-social'||original.visibility!==item.visibility||original.subjectUid!==item.subjectUid)continue
   const evidenceKeys=Array.isArray(item.evidenceKeys)?[...new Set(item.evidenceKeys)].slice(0,12):[item.sourceKey]
   if(!evidenceKeys.length||evidenceKeys.some(key=>{const e=decay().data.episodes.find(row=>row.id==='e-'+hash(key));return !e||e.stage==='forgotten'||e.visibility!==item.visibility||e.subjectUid!==item.subjectUid}))continue
   const id='pi-'+hash(item.sourceKey+':'+clean(item.text,440))
   const existing=data.rows.find(x=>x.id===id)
   if(existing){rows.push(existing);continue}
   const row={id,text:clean(item.text,440),visibility:item.visibility,subjectUid:item.subjectUid,sensitivity:'low',...(ACCOUNT.test(String(original.accountTag||''))?{accountTag:original.accountTag}:{}),sourceKey:item.sourceKey,evidenceKeys,importance:Math.min(.8,Math.max(.4,Number(item.importance)||.55)),at:now()}
   data.rows.push(row);rows.push(row);added++
  }
  if(added){data.rows=data.rows.slice(-700);save(file,data)}
  return {ok:true,added,rows}
 }
 function privateInsightCandidates({domain='main-session',role='owner',actorUid='',limit=700}={}){
  const file=storageDataPath(dataDir,'life-memory','private-insights.json'),data=atom(file)
  if(!data||data.schema!==1||!Array.isArray(data.rows))return []
  return data.rows.filter(e=>canReadPrivate({...e,domain,role,actorUid})&&(domain!=='bili-public-understanding'||ACCOUNT.test(String(getAccountTag()||''))&&e.accountTag===String(getAccountTag()||''))&&privateInsightSafe(e.text))
   .sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,Math.max(1,Math.min(700,Number(limit)||700)))
   .map(({id,text,visibility,subjectUid})=>({id,text,visibility,subjectUid}))
 }
 function privateInsights({domain='main-session',role='owner',actorUid='',query='',maxItems=4}={}){
  const file=storageDataPath(dataDir,'life-memory','private-insights.json'),data=atom(file)
  if(!data||data.schema!==1||!Array.isArray(data.rows))return []
  const q=tokens(query)
  return data.rows.filter(e=>canReadPrivate({...e,domain,role,actorUid})&&(domain!=='bili-public-understanding'||ACCOUNT.test(String(getAccountTag()||''))&&e.accountTag===String(getAccountTag()||''))&&privateInsightSafe(e.text)).map(e=>{
   const word=tokens(e.text);let match=0;for(const x of q)if(word.has(x))match++
   return {...e,score:match}
  }).filter(e=>!q.size||e.score>0).sort((a,b)=>b.score-a.score||b.at-a.at).slice(0,Math.max(1,Math.min(8,maxItems)))
   .map(({id,text,visibility,subjectUid})=>({id,text,visibility,subjectUid}))
 }
 function status(){
  const {data}=decay();searchLive(data)
  const t=now(),h0=halfLife()
  const counts=Object.fromEntries(stages.map(s=>[s,data.episodes.filter(e=>e.stage===s).length]))
  const localDate=value=>Number.isFinite(Number(value))&&Number(value)>0?new Date(Number(value)).toLocaleDateString('en-CA'):''
  const today=localDate(t),todayAdded=data.episodes.filter(e=>localDate(e.at)===today).length
  const todayForgotten=data.episodes.filter(e=>e.stage==='forgotten'&&localDate(e.forgottenAt)===today).length
  const earliest=data.episodes.length?Math.min(...data.episodes.map(e=>e.at||t)):null
  const relationBatch={unavailable:false,failed:0,skipped:0,error:null}
  const nextClear=data.episodes.filter(e=>e.stage==='clear').map(e=>{
    const h=effectiveHalfLife(e,relationBatch)*(0.6+(Number(e.importance)||0.4)*1.35)*Math.min(1.45,1+0.06*(Number(e.reinforceCount)||0))
    return Math.max(Number(e.at)||0,Number(e.reinforcedAt)||0)+h*0.6*DAY
  }).filter(x=>Number.isFinite(x)&&x>t).sort((a,b)=>a-b)[0]||null
  if(relationBatch.unavailable)warnRelationshipUnavailable(relationBatch.error,relationBatch.failed+relationBatch.skipped)
  let months=0;try{months=readdirSync(storageDataPath(dataDir,'life-memory','archive')).filter(x=>/^\d{4}-\d{2}\.jsonl$/.test(x)).length}catch{}
  const persistedSlots=packVideoObservationGroups(data.episodes)
  return {ok:true,counts,total:data.episodes.length,todayAdded,todayForgotten,archiveEvents:data.archiveKeys.length,archiveMonths:months,
    shallowSlots:persistedSlots.length,nestedVisualObservations:data.episodes.length-persistedSlots.length,
    oldestEpisodeAt:earliest?new Date(earliest).toISOString():'',oldestEpisodeDays:earliest!==null?Math.max(0,Math.floor((t-earliest)/DAY)):0,
    nextFuzzyAt:nextClear?new Date(nextClear).toISOString():'',migrated:data.migrated,halfLifeDays:h0,search:hybrid.status(),details:details.stats()}
 }
 return {...Object.fromEntries(Object.entries({recordEvents,recordSocialReply,recordSocialDecline,recordPrivateInsights,privateInsights,privateInsightCandidates,recall,semanticCandidates,reflectionEvidence,emotionEvidence,recentEmotionEvents,publicVideoEvidence,publicSocialEvidence,recentVisualExperienceContext,videoEvidenceTrace,attachMemoryDetails,recordVerifiedFocusRevision,expandMemoryDetail,memoryDetailInfo,recallVideoDetails,inspectVideoDetails,visualDetailCandidates,videoRecallGroups,reconcileMemoryDetails,decay,status}).map(([name,fn])=>[name,locked(fn)])),close:()=>hybrid.close(),file}
}
export const __test={asEpisode,fadeEpisode,desiredStage,keyOf}
