import {storageDataPath} from './storage-layout.mjs'
/**
 * Two-layer life memory. Archive is write-only for the runtime; everyday recall
 * consumes ONLY an independently persisted, destructively fading episodic copy.
 * Archive reads are intentionally absent from the returned API. Owner backup is
 * handled by the separate, explicitly confirmed administrative backup module.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,appendFileSync,readdirSync,rmSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {createHash,createHmac,randomBytes} from 'node:crypto'
import {createHybridIndex} from './hybrid-memory-search.mjs'
import {canReadPrivate,privateInsightSafe} from './life-private-policy.mjs'
import {contentRef,validDynamicId} from './bili-content-ref.mjs'
import {safeVideoSceneCues,safeVideoObservationNotes,deriveVideoObservationNotes} from './video-scene-cues.mjs'
import {LIFE_ACTION_NAMES,LIFE_PRIVATE_ACTIONS} from './life-action-memory.mjs'
import {createLifeMemoryDetailStore,validateDetailFragments} from './life-memory-details.mjs'
import {expandVideoObservationGroups,packVideoObservationGroups,groupNewVideoObservation} from './video-memory-observation-groups.mjs'
import {withDurableFileLock} from './durable-file-lock.mjs'
import {pruneAssociations,applyAssociationProposals,activateAssociations,verifyAssociationPath,associationEmotionEvidence} from './life-memory-associations.mjs'

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
const save=(file,value)=>{mkdirSync(dirname(file),{recursive:true});if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝通过符号链接写记忆');const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp';try{writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(tmp,file)}finally{try{rmSync(tmp,{force:true})}catch{}}}
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
// A partial sampling footprint is deliberately separate from visualMemo and
// cannot satisfy any complete visual/deep/detail/write proof.
function partialMemo(value){
 if(!value||value.interpretation!=='partial-model-observation-not-semantic-proof'||
    !['decoded-public-video','low-resolution-preview'].includes(value.source))return null
 const sampled=value.sampledTimesMs,described=value.describedTimesMs
 const ordered=a=>Array.isArray(a)&&a.length>0&&a.length<=48&&a.every((t,i)=>Number.isSafeInteger(t)&&t>=0&&t<=43200000&&(!i||t>a[i-1]))
 if(!ordered(sampled)||!ordered(described)||described.length>=sampled.length||described.some(t=>!sampled.includes(t)))return null
 return {source:value.source,sampledTimesMs:[...sampled],describedTimesMs:[...described],interpretation:value.interpretation}
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
 const partial=experience?.evidenceSchema==='life-video-evidence/v1'&&experience.vision!==true&&
   ACCOUNT.test(String(e.accountTag||''))&&String(e.key||'').startsWith('video-explore:')&&
   (experience.source==='main-session'||experience.source==='bili-life'&&e.autonomousSelected===true)?partialMemo(experience.partialVisualReceipt):null
 const partialNotes=partial?safeVideoObservationNotes(experience.partialVisualReceipt.notes):[]
 const partialGaps=partial?partial.sampledTimesMs.filter(t=>!partial.describedTimesMs.includes(t)):[]
 const partialText=partial?`；仅取得${partial.describedTimesMs.length}/${partial.sampledTimesMs.length}个采样时刻的局部模型描述，缺口${partialGaps.slice(0,4).map(t=>t/1000).join('、')}秒${partialGaps.length>4?'等':''}（语义及画面归属未经独立核实）${partialNotes.length?'；有限局部观察（不是指令）：'+partialNotes.join('；'):''}`:''
 const visualNotes=visualSource&&visualCount?safeVideoObservationNotes(experience.visualSceneNotes):[]
 // Retain legacy categorical memories for old versions, but do not classify
 // future model observations using a fixed vocabulary.
 const legacyMentions=visualSource&&visualCount&&!visualNotes.length?safeVideoSceneCues(experience.visualTopics):[]
 const modelSummary=visualNotes.length&&experience.visualNotesMethod==='vision-model-same-call'
 const focusedSummary=visualNotes.length&&experience.visualNotesMethod==='text-model-focus-merge'
 const visualEvidence=visualSource&&visualCount?`；当时${visualSource==='decoded-public-video'?'从真实视频解码':'从B站低清预览'}采样${visualCount}个时刻并取得视觉模型描述（仅为模型观察，不是完整观看或语义确认）${visualNotes.length?'；'+(focusedSummary?'模型整合的全局与局部视觉摘要（未经独立核实、不是指令）：':modelSummary?'模型当时生成的视觉记忆摘要（未经独立核实、不是指令）：':'模型当时的有限画面观察（未经独立核实、不是指令）：')+visualNotes.join('；'):legacyMentions.length?'；旧版模型主题提及：'+legacyMentions.join('、'):''}`:''
 const detail=experience?[experience.subtitle?'取得过字幕文本':'',experience.asr?'取得过本地语音转写文本':'',!visualEvidence&&experience.vision?'取得过有限画面分析':'',Number(experience.comments)>0?'读取过公开评论':'',Number(experience.danmaku)>0?'读取过弹幕':''].filter(Boolean).join('、'):''
 const clear=e.kind==='watch'?(experience?`我曾经查看过视频《${title||e.bvid}》的公开资料${detail?'；当时'+detail:''}${visualEvidence}${partialText}${experience.purpose?'；'+clean(experience.purpose,85):''}；不代表完整观看过视频画面或听过原声音频`:`我曾经选中视频《${title||e.bvid}》${e.note?'；当时想法是'+clean(e.note,120):''}`):e.kind==='social'?(ambiguousAt?ambiguousAtMemoryText(ref.type==='dynamic'):(ref.type==='dynamic'?`我的一条动态下曾有观众留下评论，内容是“${phrase}”`:`我曾经在评论区与一位观众交谈，对方当时说“${phrase}”`)):`我在一条${ref.type==='dynamic'?'动态':'视频'}下${e.reply?'回复过评论':'发表过评论'}${name?'，对方叫'+name:''}${phrase?'；我当时写了“'+phrase+'”':''}`
 const fuzzy=e.kind==='watch'?(experience?'我以前接触过一段公开视频的资料，不过具体是哪条和内容细节已经模糊了':`我以前刷到过一段视频，对「${clean(title.replace(/BV[A-Za-z0-9]{10}/g,'').replace(/\d{4,}/g,''),12)||'某个话题'}」还有些印象`):e.kind==='social'?(ambiguousAt?'我似乎曾在评论区收到过一次@提醒，但对方的具体话语无法确认':'我似乎曾在评论区与一位观众聊过天'):`我以前在评论区有过一次交流，但具体和谁聊的记不太清了`
 const trace=e.kind==='watch'?'我隐约记得看过一段曾引起我注意的视频':'我隐约记得曾在评论区与人交流过'
 const importance=e.kind==='comment'?0.54:e.kind==='social'?0.58:0.38
 return {id,key,kind:e.kind,at,stage:'clear',...(e.kind==='watch'?{dateOnly:isDateOnlyWatch(e)}:{}),text:clear,fuzzy,trace,bvid:ref.type==='video'?ref.id:'',...(ref.type==='dynamic'?{contentType:'dynamic',dynamicId:ref.id}:{}),actorUid:clean(e.actorUid||e.uid,24),...(e.kind==='social'?{incomingText:ambiguousAt?'':phrase,confirmedReply:false,deliberateSilence:false,decisionReason:'',socialTier:['owner','friend','stranger'].includes(e.socialTier)?e.socialTier:'unknown'}:{}),importance,reinforcedAt:at,reinforceCount:0,lastRecallAt:0,relationDecay:e.kind==='social'&&validUid(e.actorUid||e.uid),visibility:experience?.source==='main-session'?'private-session':'public-event',
   // Every persisted public experience uses the account captured by its trusted event source.
   // Legacy accountless episodes remain available to the owner's main session,
   // but must never be guessed into an outgoing or Bilibili-public context.
   ...(ACCOUNT.test(String(e.accountTag||''))?{accountTag:e.accountTag}:{}),
   ...(e.kind==='watch'&&readEvidenceKinds.length?{readEvidenceKinds}:{}),
   ...(partial?{partialVisualMemo:partial}:{}),
   ...(e.kind==='watch'&&visualSource&&visualCount?{visualMemo:{source:visualSource,frameCount:visualCount,
     firstAtMs:Number.isSafeInteger(receipt.firstAtMs)?receipt.firstAtMs:0,
     lastAtMs:Number.isSafeInteger(receipt.lastAtMs)?receipt.lastAtMs:0,
     sceneNotes:visualNotes,notesMethod:focusedSummary?'text-model-focus-merge':modelSummary?'vision-model-same-call':'extractive-fallback',
     modelMentions:legacyMentions}}:{})}
}
// Recovery-only proof of the exact original public fading row. Never read an
// archive from a Life recall API. Canonical keys survive packed child storage
// and JSON property order; the archive retains only a digest, not visual prose.
const canonicalRepairValue=v=>Array.isArray(v)?v.map(canonicalRepairValue):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonicalRepairValue(v[k])])):v
export function originalPublicWatchDigest(episode){
 if(episode?.kind!=='watch'||episode.visibility!=='public-event'||episode.stage!=='clear'||!ACCOUNT.test(String(episode.accountTag||'')))return null
 return createHash('sha256').update(JSON.stringify(canonicalRepairValue(episode))).digest('hex')
}
export function verifyOriginalPublicWatch(archive,episode){
 const digest=originalPublicWatchDigest(episode),event=archive?.event,clock=Date.parse(archive?.recordedAt||'')
 if(!digest||archive?.version!==1||archive.id!==episode.id||event?.kind!=='watch'||event.accountTag!==episode.accountTag||event.bvid!==episode.bvid||keyOf(event)!==episode.key||event.experience?.source==='main-session'||event.visualObservationState==='cached'||!Number.isFinite(clock)||clock<episode.at)return false
 if(Object.hasOwn(archive,'originalPublicWatchSha256'))return archive.originalPublicWatchSha256===digest
 // Old archives deliberately omit visual scene notes. Only a byte-equivalent
 // projection of what was actually retained can qualify; never invent notes.
 if(!event.time&&!event.at&&!event.createdAt&&!event.day)return false
 const projected=asEpisode(event,clock)
 return originalPublicWatchDigest(projected)===digest
}
export function desiredStage(e,now,halfLife){const age=Math.max(0,now-Math.max(e.at,Number(e.reinforcedAt)||e.at))/DAY,importance=Number(e.importance)||0.4
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
 delete e.partialVisualMemo
 if(stage==='fuzzy'){delete e.emotionObservation;delete e.focusRevision;delete e.visualMemo;delete e.readEvidenceKinds;e.text=e.fuzzy;delete e.fuzzy;delete e.bvid;delete e.dynamicId;delete e.contentType;delete e.actorUid;delete e.key;delete e.incomingText;delete e.confirmedReply;delete e.deliberateSilence;delete e.decisionReason;delete e.socialTier;delete e.recipientUid;delete e.action; if(e.kind==='private-social')delete e.key}
 if(stage==='trace'){delete e.emotionObservation;delete e.focusRevision;delete e.visualMemo;delete e.readEvidenceKinds;e.text=e.trace;delete e.fuzzy;delete e.bvid;delete e.dynamicId;delete e.contentType;delete e.actorUid;delete e.key;delete e.incomingText;delete e.confirmedReply;delete e.deliberateSilence;delete e.decisionReason;delete e.socialTier;delete e.recipientUid;delete e.action; if(e.kind==='private-social')delete e.key}
 if(stage==='forgotten'){delete e.emotionObservation;delete e.focusRevision;delete e.visualMemo;delete e.readEvidenceKinds;e.text='';delete e.relationHalfLifeDays;delete e.fuzzy;delete e.trace;delete e.key;delete e.bvid;delete e.dynamicId;delete e.contentType;delete e.actorUid;delete e.incomingText;delete e.confirmedReply;delete e.deliberateSilence;delete e.decisionReason;delete e.socialTier;delete e.recipientUid;delete e.action; if(e.kind==='private-social')delete e.key}
 e.stage=stage;return true
}
export function createLifeMemoryGateway({dataDir,getConfig=()=>({}),getRelationship=()=>null,getAccountTag=()=>'',onEpisodesRemoved=()=>{},onDetailsInvalidated=()=>{},onDetailsChanged=()=>{},admitMemoryDetails=()=>false,now=Date.now,logger=console}={}){
 if(!dataDir)throw TypeError('missing dataDir')
 const file=storageDataPath(dataDir,'life-memory','episodic.json')
 const details=createLifeMemoryDetailStore({dataDir,logger})
 const recallCursorKey=randomBytes(32) // process-local, not a second memory store
 const signRecallCursor=value=>createHmac('sha256',recallCursorKey).update(value).digest('hex')
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
 const pendingKey='pendingVisualDetails'
 const pendingRows=data=>{const rows=Object.hasOwn(data,pendingKey)?data[pendingKey]:[];if(!Array.isArray(rows)||rows.length>16)throw Error('深层记忆待写记录异常');return rows}
 const identity=e=>hash(JSON.stringify([e.id,e.accountTag,e.kind,e.at,e.bvid,e.visibility]))
 const eligible=e=>e?.stage==='clear'&&e.kind==='watch'&&ACCOUNT.test(e.accountTag)&&validBV(e.bvid)&&['public-event','private-session'].includes(e.visibility)&&e.visualMemo&&Array.isArray(e.readEvidenceKinds)&&e.readEvidenceKinds.includes('visual-model-observation')
 const stageRank={forgotten:0,trace:1,fuzzy:2,clear:3}
 const routineActions=new Set(['read_video_metadata','inspect_creator_space','read_public_search','inspect_public_person','review_public','todo_read'])
 const retentionValue=e=>Math.max(0,Math.min(1,Number(e?.importance)||0))-(e?.kind==='action'?(routineActions.has(e.action)?.35:.22):0)
 const compareRetention=(a,b,associationIds)=>
   (stageRank[b?.stage]||0)-(stageRank[a?.stage]||0)||
   Number(associationIds.has(b?.id))-Number(associationIds.has(a?.id))||
   Number(Boolean(b?.visualMemo))-Number(Boolean(a?.visualMemo))||
   Math.round(retentionValue(b)*1000)-Math.round(retentionValue(a)*1000)||
   Math.min(999,Number(b?.reinforceCount)||0)-Math.min(999,Number(a?.reinforceCount)||0)||
   (Number(b?.lastRecallAt)||0)-(Number(a?.lastRecallAt)||0)||
   (Number(b?.at)||0)-(Number(a?.at)||0)||String(a?.id||'').localeCompare(String(b?.id||''))
 // Aggregate mutations in the same atomic live ledger. No source IDs, text,
 // archive reads, or inferred pre-upgrade history. Missing days remain unknown.
 const healthKinds=['watch','comment','social','private-social','action','other']
 const healthCount=n=>Number.isSafeInteger(n)&&n>=0?Math.min(n,1_000_000_000):0
 const healthDay=t=>new Date(t).toLocaleDateString('en-CA')
 const healthRows=(data,t)=>{
  const dates=new Set(Array.from({length:7},(_,i)=>{const d=new Date(t);d.setDate(d.getDate()-6+i);return healthDay(d.getTime())})),out=new Map()
  for(const row of Array.isArray(data.healthEvents)?data.healthEvents.slice(-7):[]){if(!dates.has(row?.date))continue
   out.set(row.date,{date:row.date,added:healthCount(row.added),naturallyForgotten:healthCount(row.naturallyForgotten),evicted:healthCount(row.evicted),evictedForgotten:healthCount(row.evictedForgotten),byKind:Object.fromEntries(healthKinds.map(k=>[k,healthCount(row.byKind?.[k])])),reinforcedByQuote:healthCount(row.reinforcedByQuote)})
  }
  return [...out.values()].sort((a,b)=>a.date.localeCompare(b.date))
 }
 const noteHealth=(data,t,{added=0,naturallyForgotten=0,evicted=[],reinforcedByQuote=0}={})=>{
  if(!added&&!naturallyForgotten&&!evicted.length&&!reinforcedByQuote)return
  const rows=healthRows(data,t),date=healthDay(t),row=rows.find(x=>x.date===date)||{date,added:0,naturallyForgotten:0,evicted:0,evictedForgotten:0,byKind:Object.fromEntries(healthKinds.map(k=>[k,0])),reinforcedByQuote:0}
  row.added=healthCount(row.added+added);row.naturallyForgotten=healthCount(row.naturallyForgotten+naturallyForgotten);row.evicted=healthCount(row.evicted+evicted.length);row.evictedForgotten=healthCount(row.evictedForgotten+evicted.filter(x=>x.stage==='forgotten').length);row.reinforcedByQuote=healthCount(row.reinforcedByQuote+reinforcedByQuote)
  for(const item of evicted){const kind=healthKinds.includes(item.kind)?item.kind:'other';row.byKind[kind]=healthCount(row.byKind[kind]+1)}
  data.healthEvents=[...rows.filter(x=>x.date!==date),row].sort((a,b)=>a.date.localeCompare(b.date)).slice(-7)
 }
 const trimEpisodes=(data,archiveOrder)=>{
  if(!Array.isArray(data?.episodes)||data.episodes.length<=MAX_EPISODES)return []
  const associationIds=new Set(pruneAssociations(data.associations,data.episodes,now()).flatMap(edge=>edge.ends).filter(Boolean))
  const keep=new Set(data.episodes.slice().sort((a,b)=>compareRetention(a,b,associationIds)).slice(0,MAX_EPISODES).map(e=>e.id))
  const discarded=data.episodes.filter(e=>!keep.has(e.id));const partialIds=discarded.filter(e=>e.partialVisualMemo).map(e=>e.id)
  if(partialIds.length)details.purge(partialIds)
  noteHealth(data,now(),{evicted:discarded})
  const removed=discarded.map(e=>e.id)
  data.episodes=data.episodes.filter(e=>keep.has(e.id)).sort((a,b)=>(archiveOrder.get(a.id)??-1)-(archiveOrder.get(b.id)??-1))
  return removed
 }
 const saveEpisodes=data=>{
  if(Object.hasOwn(data,'associations'))data.associations=pruneAssociations(data.associations,data.episodes,now())
  const persisted={...data,episodes:packVideoObservationGroups(data.episodes)}
  if(pendingRows(data).length&&Buffer.byteLength(JSON.stringify(persisted,null,2)+'\n','utf8')>MAX_FILE)throw Error('深层记忆待写超出活体记忆预算')
  save(file,persisted)
 }
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
 // A bounded write intent lives ONLY in the same atomic fading snapshot as
 // its exact parent. It is not a recall source or a new observation queue.
 function stageDetails(data,parent,fragments,revision=null){
  const checked=validateDetailFragments(fragments),rows=pendingRows(data)
  if(Buffer.byteLength(JSON.stringify(checked),'utf8')>255*1024)throw Error('整条深层记忆超出存储预算')
  if(!eligible(parent)||details.isRevoked(parent.id))throw Error('深层主记忆已失效')
  const prior=details.read(parent,{management:true})
  if(prior.ok){
   const ids=new Map(prior.fragments.map(f=>[f.fragmentId,f]))
   for(const f of checked)if(ids.has(f.fragmentId)&&JSON.stringify(ids.get(f.fragmentId))!==JSON.stringify(f))throw Error('深层片段 ID 与原始证据冲突')
   const combined=validateDetailFragments([...prior.fragments,...checked.filter(f=>!ids.has(f.fragmentId))])
   if(Buffer.byteLength(JSON.stringify(combined),'utf8')>255*1024)throw Error('整条深层记忆超出存储预算')
  }else if(prior.reason!=='no-detail')throw Error('深层记忆身份或撤销状态异常')
  if(rows.some(r=>r.memoryId===parent.id))throw Error('此记忆仍有待恢复的详情')
  const row={memoryId:parent.id,accountTag:parent.accountTag,identity:identity(parent),fragments:checked,...(revision?{revision}:{})}
  if(rows.length>=16||Buffer.byteLength(JSON.stringify([...rows,row]),'utf8')>1024*1024)throw Error('深层记忆待写预算已满')
  data[pendingKey]=[...rows,row]
  return row
 }
 let recovering=false
 function recoverDetails(data){
  if(recovering)return {pending:pendingRows(data).length,completed:[]}
  recovering=true;const completed=[],results=new Map()
  try{
   for(const row of [...pendingRows(data)]){
    const parent=data.episodes.find(e=>e.id===row?.memoryId)
    try{
     // Never infer a parent, re-admit forgotten content or cross account scope.
     const stale=!eligible(parent)||identity(parent)!==row.identity||parent.accountTag!==row.accountTag||details.isRevoked(row.memoryId)
     if(!stale&&row.accountTag!==String(getAccountTag()||''))continue
     let deep=null
     const previous=parent?.focusRevision
     if(!stale){
      const revision=row.revision
      if(revision&&(!Number.isSafeInteger(revision.version)||revision.version<1||revision.version>32||
        revision.version!==(previous?.version||0)+1||revision.previousFingerprint!==(previous?.fingerprint||hash(parent.text))||
        !/^focus:[a-f0-9]{24,40}$/.test(revision.sourceRef)||revision.fingerprint!==hash(revision.previousFingerprint+':'+revision.sourceRef+':'+revision.note)||
        typeof revision.note!=='string'||revision.note.length>125||!Array.isArray(revision.window)||revision.window.length!==2||
        revision.window.some(t=>!Number.isSafeInteger(t)||t<0||t>14400_000)||revision.window[1]<=revision.window[0]||
        !Number.isSafeInteger(revision.updatedAt)||row.fragments.some(f=>f.sourceRef!==revision.sourceRef)))throw Error('待写摘要身份不匹配')
      deep=details.write({episode:parent,fragments:row.fragments,verified:true,append:true})
      if(revision)parent.focusRevision=revision
     }
     const priorRows=data[pendingKey]
     data[pendingKey]=priorRows.filter(r=>r!==row)
     try{saveEpisodes(data)}catch(e){data[pendingKey]=priorRows;if(parent){if(previous)parent.focusRevision=previous;else delete parent.focusRevision}throw e}
     if(deep){completed.push(row.memoryId);results.set(row.memoryId,{ok:true,memoryId:row.memoryId,fragmentCount:deep.fragmentCount,...(row.revision?{shallowVersion:row.revision.version,deepFragments:deep.fragmentCount,certainty:'model-observation-not-independent-semantic-proof'}:{})})}
    }catch{logger.warn?.('深层记忆详情待恢复；保留原始经历与已提交证据')}
   }
   for(const id of completed)try{onDetailsChanged(id)}catch{}
   return {pending:pendingRows(data).length,completed,results}
  }finally{recovering=false}
 }
 function settleDetails(data,row){
  const result=recoverDetails(data).results?.get(row.memoryId)
  return result||(pendingRows(data).includes(row)?{ok:false,reason:'detail-write-pending',memoryId:row.memoryId,pending:true}:{ok:false,reason:'memory-unavailable',memoryId:row.memoryId})
 }
 function decay(){const data=read(),t=now();let changed=0;const removed=[],corrected=[],detailsInvalidated=[],partialInvalidated=[]
  const revoked=data.episodes.some(e=>e.partialVisualMemo)?details.revokedIds():new Set()
  const relationBatch={unavailable:false,failed:0,skipped:0,error:null}
  for(const e of data.episodes){
   if(repairAmbiguousAtEpisode(e)){changed++;corrected.push(e.id)}
   const previous=e.stage,h=effectiveHalfLife(e,relationBatch);if(e.relationDecay===true&&e.stage==='clear'&&e.relationHalfLifeDays!==h){e.relationHalfLifeDays=h;changed++}
   const hadPartial=Boolean(e.partialVisualMemo),desired=desiredStage(e,t,h),target=hadPartial&&revoked.has(e.id)&&desired==='clear'?'fuzzy':desired
   if(fadeEpisode(e,target)){if(hadPartial)partialInvalidated.push(e.id);changed++;if(previous==='clear'&&e.stage!=='clear')detailsInvalidated.push(e.id);if(previous!=='forgotten'&&e.stage==='forgotten'){e.forgottenAt=t;removed.push(e.id)}}
  }
  if(relationBatch.unavailable)warnRelationshipUnavailable(relationBatch.error,relationBatch.failed+relationBatch.skipped)
  const edges=pruneAssociations(data.associations,data.episodes,t)
  const edgesChanged=Object.hasOwn(data,'associations')&&(!Array.isArray(data.associations)||edges.length!==data.associations.length)
  if(edgesChanged)data.associations=edges
  if(partialInvalidated.length)details.purge(partialInvalidated) // revoke before a clear partial row can be restored
  if(changed||edgesChanged){noteHealth(data,t,{naturallyForgotten:removed.length});data.updatedAt=t;saveEpisodes(data)}
  if(detailsInvalidated.length){
   try{details.purge(detailsInvalidated.filter(id=>!partialInvalidated.includes(id)))}catch(error){logger.warn?.('深层详情清理待恢复：'+String(error?.message||error).slice(0,90))}
   try{onDetailsInvalidated(detailsInvalidated)}catch{}
  }
  // Purge stale external embeddings carrying the old injected nickname text;
  // next indexing may only use the corrected live, authorized episode.
  if(corrected.length)try{onEpisodesRemoved(corrected,{reason:'source-correction'})}catch(error){logger.warn?.('错误提及记忆向量清理失败：'+String(error?.message||error).slice(0,120))}
  if(removed.length)try{onEpisodesRemoved(removed,{reason:'forgotten'})}catch(error){logger.warn?.('遗忘向量清理通知失败：'+String(error?.message||error).slice(0,120))}
  recoverDetails(data)
  return {changed,data}}
 function archive(e,id,originalPublicWatchSha256=null){const month=new Date(Math.min(now(),timeOf(e))).toISOString().slice(0,7),folder=storageDataPath(dataDir,'life-memory','archive'),target=join(folder,month+'.jsonl');mkdirSync(folder,{recursive:true});if(existsSync(target)&&lstatSync(target).isSymbolicLink())throw Error('永久档案路径不可为符号链接');appendFileSync(target,JSON.stringify({version:1,id,recordedAt:new Date(now()).toISOString(),event:e,...(originalPublicWatchSha256?{originalPublicWatchSha256}:{})})+'\n',{mode:0o600})}
 function recordEvents(events=[],{migration=false,detailAdmission=null}={}){
  const data=decay().data,known=new Set(data.archiveKeys),episodes=new Set(data.episodes.map(x=>x.id)),clock=now();let added=0,shallowAdded=0,visualAppended=0,detailRow=null,detailWrite=null
  const relationBatch={unavailable:false,failed:0,skipped:0,error:null}
  for(const e of events){const x=asEpisode(migration&&e?.experience?.partialVisualReceipt?{...e,experience:{...e.experience,partialVisualReceipt:undefined}}:e,clock);if(!x||known.has(x.id)||e.visualObservationState==='cached'||x.partialVisualMemo&&details.isRevoked(x.id))continue
   // Legacy import events retain the historical general decay, not dev.9's new encounter policy.
   if(migration)x.relationDecay=false
   // Archive append precedes index update, so an IO failure never marks an event archived.
   // Private archive contains ONLY source identity + digest, never a private
   // transcript or derived sensitive wording. The fading copy is the evidence.
   archive(x.kind==='private-social'?{kind:x.kind,key:x.key,visibility:x.visibility,subjectHash:hash(x.subjectUid),at:x.at,redacted:true}:x.kind==='action'?{kind:'action',key:x.key,action:x.action,at:x.at,accountTag:x.accountTag,verified:true,redacted:true}:
     x.kind==='watch'&&(e.experience?.visualSceneNotes||e.experience?.partialVisualReceipt)?{...e,experience:{...e.experience,visualSceneNotes:undefined,partialVisualReceipt:undefined}}:e,x.id,originalPublicWatchDigest(x));known.add(x.id)
   const h=effectiveHalfLife(x,relationBatch)
   if(x.relationDecay===true)x.relationHalfLifeDays=h
   fadeEpisode(x,desiredStage(x,clock,h))
   if(!episodes.has(x.id)){
    // Only new verified visual observations join a slot. Migration and all
    // preexisting independent episodes retain their historical representation.
    if(!migration&&groupNewVideoObservation(data.episodes,x))visualAppended++;else shallowAdded++
    data.episodes.push(x);episodes.add(x.id);added++
    // Only the live internal one-use proof may add an intent. Replay of an
    // older ordinary event never synthesizes missing details.
    if(!migration&&detailAdmission&&events.length===1&&eligible(x)&&e.visualObservationState==='fresh'&&x.accountTag===String(getAccountTag()||'')){
     try{const {fragments,sourceProof,review,sourceRef}=detailAdmission
      const parts=validateDetailFragments(fragments)
      const revision=review&&parts.every(p=>p.timeAnchorMs?.every(t=>review.frameTimesMs?.includes(t)))?focusRevisionFor(x,review,sourceRef,parts):null
      if(review&&!revision||admitMemoryDetails({episode:x,fragments:parts,sourceProof})!==true)throw Error('source-not-admitted')
      detailRow=stageDetails(data,x,parts,revision)
     }catch{detailWrite={ok:false,reason:'detail-admission-rejected'}}
    }
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
    trimEpisodes(data,order)
   }
   const kept=new Set(data.episodes.map(e=>e.id)),removed=[...before].filter(id=>!kept.has(id))
   noteHealth(data,clock,{added});data.migrated=data.migrated||migration;data.updatedAt=clock;saveEpisodes(data)
   if(removed.length)try{details.purge(removed)}catch(error){logger.warn?.('过期深层详情清理待恢复：'+String(error?.message||error).slice(0,90))}
   if(removed.length)try{onEpisodesRemoved(removed,{reason:'live-window-evicted'})}catch(error){logger.warn?.('过期向量清理通知失败：'+String(error?.message||error).slice(0,120))}
  }
  if(detailRow)detailWrite=settleDetails(data,detailRow)
  return {added,total:data.episodes.length,shallowAdded,visualAppended,...(detailAdmission?{detailWrite:detailWrite||{ok:false,reason:'no-new-verified-episode'}}:{})}
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
  const exact=['main-session','bili-explore'].includes(domain)&&/^BV[0-9A-Za-z]{10}$/.test(String(query).trim())?String(query).trim():''
  const ranked=exact?[]:searchLive(data).search(query,{now:t,limit:Math.min(MAX_EPISODES,Math.max(160,Number(maxItems)*18)),filter:r=>ids.has(r.id)})
  const results=[]
  if(exact)results.push(...allowed.filter(e=>e.stage==='clear'&&e.bvid===exact&&['watch','action'].includes(e.kind)).sort((a,b)=>Number(b.kind==='watch')-Number(a.kind==='watch')||b.at-a.at))
  for(const item of exact?[]:ranked){
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
  if(reinforce&&take.length){let dirty=false;for(const chosen of take){const e=data.episodes.find(x=>x.id===chosen.id);if(e&&e.stage==='clear'&&(Number(e.reinforceCount)||0)<20&&t-(e.lastRecallAt||0)>=DAY){e.lastRecallAt=t;e.reinforcedAt=t;e.reinforceCount=(Number(e.reinforceCount)||0)+1;dirty=true}}if(dirty)saveEpisodes(data)}
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
 // Owner management only: use current fading sources, never archive/candidate text.
 // IDs stay internal to the graph projection. Bilibili UID is a platform actor,
 // not a fictional character, inferred relationship or permission grant.
 function neuralEvidenceSnapshot({accountTag='',gardenRows=[],interestEvidence=[],episodeRows=null}={}){
  if(!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||'')||getConfig()?.mainSessionMemoryEnabled!==true)return {links:[],emotions:[]}
  const {data}=decay(),t=now(),live=data.episodes.filter(e=>e.stage==='clear'&&e.visibility==='public-event'&&e.accountTag===accountTag&&e.at<=t&&e.text)
  const byId=new Map(live.map(e=>[e.id,e])),garden=new Map(gardenRows.map(r=>[r.id,r])),links=[],seen=new Set(),grouped=new Map()
  // The graph aggregates a BV for display, but the actual evidence is still
  // the individual live observation. Public/private video groups never mix.
  const reps=new Map()
  if(Array.isArray(episodeRows))for(const row of episodeRows){const e=byId.get(row.id);if(e?.kind==='watch'&&validBV(e.bvid))reps.set(e.bvid,e.id)}
  const project=id=>{const e=byId.get(id);return e?.kind==='watch'&&reps.has(e.bvid)?reps.get(e.bvid):id}
  const link=(from,to,type,extra={})=>{
   if(from===to)return
   const key=[type,...[from,to].sort(),extra.associationType||''].join('|');if(seen.has(key))return;seen.add(key)
   from=project(from);to=project(to);if(from===to)return
   const displayKey=[type,...[from,to].sort(),extra.associationType||''].join('|'),old=grouped.get(displayKey)
   if(old){old.sourceCount++;if(type==='association'){old.strength=Math.max(old.strength,extra.strength);old.confirmations=Math.max(old.confirmations,extra.confirmations);old.updatedAt=Math.max(old.updatedAt,extra.updatedAt)}return}
   const row={from,to,type,...extra,sourceCount:1};grouped.set(displayKey,row);links.push(row)
  }
  for(const e of live){
   if(e.kind==='social'&&validUid(e.actorUid)&&e.key?.startsWith('social:'+e.actorUid+':')){
    const person='observed-person:'+e.actorUid
    if(garden.get(person)?.gardenEvidence==='verified-interaction-metadata')link(person,e.id,'relationship',{evidence:'verified-public-actor'})
   }
  }
  for(const row of gardenRows){
   if(row.source!=='life-reflection'||row.gardenEvidence!=='identity-memory'||!Array.isArray(row.evidenceKeys))continue
   for(const candidate of row.evidenceKeys){
    if(!/^c-[a-f0-9]{18}$/.test(String(candidate))||!String(row.sourceKey||'').startsWith('life-reflection:'))continue
    const e=byId.get('e-'+candidate.slice(2))
    if(e&&e.key&&'c-'+hash(e.key)===candidate)link(row.id,e.id,'source',{evidence:'reflection-candidate-source'})
   }
  }
  for(const item of interestEvidence){
   const e=byId.get(item.episodeId)
   if(e?.kind==='watch'&&e.bvid===item.bvid&&e.at===item.at&&garden.get(item.interestId)?.gardenEvidence==='selected-video-trend')link(item.interestId,e.id,'interest',{evidence:'autonomous-selection-source'})
  }
  for(const edge of data.associations||[]){
   if(edge.accountTag!==accountTag||!edge.ends.every(id=>byId.has(id)))continue
   link(edge.ends[0],edge.ends[1],'association',{evidence:'historical-model-proposed-relation',associationType:edge.type,confirmations:edge.receipts.length,updatedAt:edge.updatedAt,strength:Math.min(1,Math.pow(2,-Math.max(0,t-edge.updatedAt)/(30*DAY))*(1+.2*(edge.receipts.length-1)))})
  }
  const emotions=live.flatMap(e=>{const o=associationEmotionEvidence(e,t);return o?[{id:e.id,...o}]:[]})
  const partialCoverage=live.flatMap(e=>{
   if(e.kind!=='watch'||!validBV(e.bvid)||reps.get(e.bvid)!==e.id)return []
   const p=partialMemo(e.partialVisualMemo);if(!p)return []
   return [{id:e.id,sampledCount:p.sampledTimesMs.length,describedCount:p.describedTimesMs.length,missingTimesMs:p.sampledTimesMs.filter(t=>!p.describedTimesMs.includes(t))}]
  })
  return {links,emotions,...(partialCoverage.length?{partialCoverage}:{})}
 }
 // Only an admitted live public comment and the existing per-item model signal.
 // No batch reflection mood, current mood, DM or retrospective timestamp guessing.
 function recordEpisodeEmotion({accountTag='',eventKey='',mood='',intensity=0,at=0}={}){
  const t=now()
  if(!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||'')||getConfig()?.mainSessionMemoryEnabled!==true||!/^social:[1-9]\d{0,19}:BV[A-Za-z0-9]{10}:[1-9]\d{0,29}$/.test(eventKey)||!['joyful','curious','warm','calm','tired','sad','irritated'].includes(mood)||!Number.isInteger(intensity)||intensity<1||intensity>3||!Number.isFinite(at)||at>t||t-at>60_000)return {ok:false,reason:'emotion-source-unavailable'}
  const {data}=decay(),e=data.episodes.find(x=>x.id==='e-'+hash(eventKey)&&x.key===eventKey&&x.accountTag===accountTag&&x.visibility==='public-event'&&x.kind==='social'&&x.stage==='clear'&&x.at<=at&&x.actorUid===eventKey.split(':')[1])
  if(!e)return {ok:false,reason:'emotion-source-unavailable'}
  if(e.emotionObservation)return {ok:true,duplicate:true}
  e.emotionObservation={sourceEventId:e.id,mood,intensity,at,source:'comment-model'}
  const next={...data,updatedAt:t}
  if(Buffer.byteLength(JSON.stringify({...next,episodes:packVideoObservationGroups(next.episodes)},null,2)+'\n')>MAX_FILE)return {ok:false,reason:'emotion-storage-capacity'}
  saveEpisodes(next);return {ok:true}
 }
 function recordAssociations({accountTag='',proposals=[],batchId=''}={}){
  if(getConfig()?.mainSessionMemoryEnabled!==true||!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||''))return {ok:false,reason:'association-scope-unavailable'}
  const {data}=decay(),t=now()
  const {edges,added,reinforced,duplicates,rejected}=applyAssociationProposals({edges:data.associations,episodes:data.episodes,accountTag,proposals,batchId,now:t})
  if(added||reinforced){
   const next={...data,associations:edges,updatedAt:t}
   if(Buffer.byteLength(JSON.stringify({...next,episodes:packVideoObservationGroups(next.episodes)},null,2)+'\n')>MAX_FILE)return {ok:false,reason:'association-storage-capacity'}
   saveEpisodes(next)
  }
  return {ok:true,added,reinforced,duplicates,rejected}
 }
 function associationCandidates({accountTag='',seedIds=[],eligibleIds=[],excludeIds=[],limit=2}={}){
  if(getConfig()?.mainSessionMemoryEnabled!==true||!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||''))return []
  const {data}=decay()
  return activateAssociations({edges:data.associations||[],accountTag,seedIds,eligibleIds,excludeIds,limit,now:now()})
 }
 function validateAssociationPath({accountTag='',fromId,memoryId,edgeIds,types}={}){
  if(getConfig()?.mainSessionMemoryEnabled!==true||!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||''))return false
  const {data}=decay();return verifyAssociationPath({edges:data.associations||[],accountTag,fromId,memoryId,edgeIds,types})
 }
 // Re-prove a returned activation at display time. Only public clear
 // representatives of the exact raw path are eligible; never join by title.
 function associationActivationSteps({accountTag='',receipt,episodeRows=[]}={}){
  if(getConfig()?.mainSessionMemoryEnabled!==true||!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||'')||receipt?.accountTag!==accountTag)return []
  const {data}=decay(),edges=data.associations||[]
  if(receipt.mode!=='immediate'&&!verifyAssociationPath({edges,accountTag,...receipt}))return []
  const live=new Map(data.episodes.filter(e=>e.accountTag===accountTag&&e.visibility==='public-event'&&e.stage==='clear').map(e=>[e.id,e]))
  const reps=new Map(),loaded=new Set()
  for(const row of episodeRows){const e=live.get(row.id);if(!e)continue;loaded.add(e.id);if(e.kind==='watch'&&validBV(e.bvid))reps.set(e.bvid,e.id)}
  const project=id=>{const e=live.get(id);return e?.kind==='watch'&&reps.has(e.bvid)?reps.get(e.bvid):id}
  if(receipt.mode==='immediate'){
   const a=live.get(receipt.fromId),b=live.get(receipt.memoryId)
   if(!a||!b)return []
   if(['episode-text-v1','episode-ai-v1'].includes(receipt.basis)){if(![a,b].every(e=>['comment','social'].includes(e.kind))||a.bvid&&a.bvid===b.bvid||a.dynamicId&&a.dynamicId===b.dynamicId)return []}
   else if(receipt.basis!==undefined&&receipt.basis!=='visual-ai-v1'||a.kind!=='watch'||b.kind!=='watch'||!a.visualMemo||!b.visualMemo||!validBV(a.bvid)||!validBV(b.bvid)||a.bvid===b.bvid)return []
   const from=project(a.id),to=project(b.id)
   return loaded.has(from)&&loaded.has(to)&&from!==to?[{from,to,type:'immediate'}]:[]
  }
  const byId=new Map(edges.filter(e=>e.accountTag===accountTag).map(e=>[e.id,e]));let at=receipt.fromId;const steps=[]
  for(const id of receipt.edgeIds){const e=byId.get(id),next=e.ends.find(x=>x!==at),from=project(at),to=project(next)
   if(!loaded.has(from)||!loaded.has(to)||from===to)return []
   steps.push({from,to,type:e.type});at=next
  }
  return steps
 }
 // Internal post-confirmation hook, not a public recall/search API. The caller
 // must already have verified the model-selected two-end association receipt.
 function reinforceConfirmedPublicEpisodes({accountTag='',ids=[]}={}){return reinforcePublicParents(accountTag,ids,2)}
 function reinforceConfirmedPublicDetail({accountTag='',id=''}={}){return reinforcePublicParents(accountTag,[id],1)}
 function reinforceQuotedPublicEpisode({accountTag='',id='',quote=''}={}){
  if(typeof quote!=='string'||quote.length<16||quote.length>80)return {ok:false,updated:0}
  return reinforcePublicParents(accountTag,[id],1,quote)
 }
 function reinforcePublicParents(accountTag,ids,count,quote=''){
  if(getConfig()?.mainSessionMemoryEnabled!==true||!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||'')||!Array.isArray(ids)||ids.length!==count||new Set(ids).size!==count)return {ok:false,updated:0}
  const {data}=decay(),t=now(),rows=ids.map(id=>data.episodes.find(e=>e.id===id))
  if(rows.some(e=>!e||e.accountTag!==accountTag||e.visibility!=='public-event'||e.stage!=='clear'||!['watch','comment','social'].includes(e.kind)||!e.text||e.at>t||count===1&&(quote?!clean(e.text,330).includes(quote):(!eligible(e)||!details.inspect(e).available||pendingRows(data).some(r=>r.memoryId===e.id)))))return {ok:false,updated:0}
  let updated=0
  for(const e of rows){
   if((Number(e.reinforceCount)||0)>=20||t-(Number(e.lastRecallAt)||0)<DAY)continue
   e.lastRecallAt=t;e.reinforcedAt=t;e.reinforceCount=(Number(e.reinforceCount)||0)+1;updated++
  }
  if(updated){if(quote)noteHealth(data,t,{reinforcedByQuote:updated});saveEpisodes(data)}
  return {ok:true,updated}
 }
 function reflectionEvidence(ids,{visibility='public-event',subjectUid=''}={}){const {data}=decay(),lookup=new Map();for(const [i,e] of data.episodes.entries())for(const value of [e.id,e.key])if(!lookup.has(value))lookup.set(value,{e,i});return ids.map(key=>{const direct=lookup.get(key),derived=lookup.get('e-'+hash(key)),e=(!direct||derived&&derived.i<direct.i?derived:direct)?.e;if(!e||e.stage==='forgotten'||!e.text)return null
   if(visibility==='public-event'&&(e.visibility!=='public-event'||
     !ACCOUNT.test(String(getAccountTag()||''))||e.accountTag!==String(getAccountTag()||'')))return null
   if(e.kind==='action'&&e.accountTag!==String(getAccountTag()||''))return null
   if(visibility!=='public-event'&&(e.kind!=='private-social'||e.visibility!==visibility||e.subjectUid!==subjectUid))return null
   const associationEmotion=associationEmotionEvidence(e,now());return {key,id:e.id,kind:e.kind,stage:e.stage,text:e.text,at:e.at,...(associationEmotion?{associationEmotion}:{}),importance:Number(e.importance)||0,visibility:e.visibility,subjectUid:e.subjectUid||'',sensitivity:e.kind==='private-social'?e.sensitivity:'',...(e.stage==='clear'?{dateOnly:isDateOnlyWatch(e),bvid:e.bvid||'',...(validDynamicId(e.dynamicId)?{contentType:'dynamic',dynamicId:e.dynamicId}:{}),...(e.kind==='social'?{actorUid:e.actorUid||'',incomingText:e.incomingText||'',confirmedReply:e.confirmedReply===true,deliberateSilence:e.deliberateSilence===true,decisionReason:e.decisionReason||'',socialTier:e.socialTier||'unknown'}:{})}:{})}}).filter(Boolean)}
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
  try{const data=read(),row=stageDetails(data,parent,fragments);saveEpisodes(data);return settleDetails(data,row)}
  catch(error){return {ok:false,reason:'detail-write-rejected',error:String(error?.message||error).slice(0,120)}}
 }
 /** A single internal, post-verification admission of one focused video window.
  * The owner-facing API never receives a writable sourceProof. The pending
  * intent is committed before the attachment; unresolved detail is not exposed. */
 function focusRevisionFor(parent,review,sourceRef,parts){
  if(parent.visibility!=='public-event'||!review||review.reviewStatus!=='model-observation-not-independent-semantic-proof'||
    !Number.isSafeInteger(review.startMs)||!Number.isSafeInteger(review.endMs)||review.startMs<0||review.endMs<=review.startMs||review.endMs>14400_000||
    !Array.isArray(review.frameTimesMs)||!review.frameTimesMs.length||review.frameTimesMs.length>48||review.frameTimesMs.some(t=>!Number.isSafeInteger(t)||t<review.startMs||t>review.endMs)||
    !/^focus:[a-f0-9]{24,40}$/.test(sourceRef)||!clean(review.description,1300)||!Array.isArray(parts)||!parts.length||parts.length>48||
    parts.some(p=>p?.sourceRef!==sourceRef||p.certainty!=='model-observation'))return null
  const version=(Number.isSafeInteger(parent.focusRevision?.version)?parent.focusRevision.version:0)+1
  if(version>32)return null
  const previousFingerprint=parent.focusRevision?.fingerprint||hash(parent.text)
  const timeLabel=Math.floor(review.startMs/1000)+'–'+Math.ceil(review.endMs/1000)+' 秒'
  const notes=safeVideoObservationNotes(clean(review.description,1300))
  const note=clean('后来在 '+timeLabel+' 重新解码采样；模型观察（未独立核实）：'+clean(notes[0]||review.description,73),125)
  return {version,previousFingerprint,fingerprint:hash(previousFingerprint+':'+sourceRef+':'+note),sourceRef,updatedAt:now(),window:[review.startMs,review.endMs],note}
 }
 function recordVerifiedFocusRevision({memoryId='',accountTag='',bvid='',review=null,sourceProof=null,sourceRef='',verifiedFragments=null}={}){
  const parent=activeDetailParent({memoryId,accountTag})
  if(!parent||parent.bvid!==bvid)return {ok:false,reason:'memory-unavailable'}
  if(!review||!Number.isSafeInteger(review.startMs)||!Number.isSafeInteger(review.endMs))return {ok:false,reason:'invalid-verified-window'}
  const fragment={fragmentId:'focus-'+sourceRef.slice(-24),type:'focused-observation',sourceRef,certainty:'model-observation',content:clean(review.description,1300),timeAnchorMs:[review.startMs,review.endMs],uncertainties:['仅为模型对已解码帧的观察，未独立验证语义结论']}
  const parts=verifiedFragments===null?[fragment]:verifiedFragments
  if(verifiedFragments!==null&&(!Array.isArray(parts)||parts.some(p=>!Array.isArray(p.timeAnchorMs)||p.timeAnchorMs.length!==2||p.timeAnchorMs.some(t=>!review.frameTimesMs?.includes(t)))))return {ok:false,reason:'no-fresh-detail-evidence'}
  const revision=focusRevisionFor(parent,review,sourceRef,parts)
  if(!revision)return {ok:false,reason:'invalid-verified-window'}
  let admitted=false
  try{admitted=admitMemoryDetails({episode:parent,fragments:parts,sourceProof})===true}catch{}
  if(!admitted)return {ok:false,reason:'source-not-admitted'}
  try{
   const data=read(),live=data.episodes.find(e=>e.id===memoryId&&identity(e)===identity(parent))
   if(!eligible(live))return {ok:false,reason:'memory-changed-before-detail'}
   // Replaying an already committed source does not advance its revision.
   const prior=details.read(live,{management:true})
   if(prior.ok&&prior.fragments.some(p=>p.sourceRef===sourceRef)){
    if(!parts.every(p=>prior.fragments.some(f=>JSON.stringify(f)===JSON.stringify(validateDetailFragments([p])[0]))))return {ok:false,reason:'source-conflict'}
    if(live.focusRevision)return {ok:true,duplicate:true,memoryId,shallowVersion:live.focusRevision.version,deepFragments:prior.totalFragments}
   }
   const row=stageDetails(data,live,parts,revision);saveEpisodes(data)
   return settleDetails(data,row)
  }catch{return {ok:false,reason:'memory-persist-failed'}}
 }
 function expandMemoryDetail({memoryId='',accountTag='',maxBytes=8192}={}){
  const parent=activeDetailParent({memoryId,accountTag})
  if(!parent)return {ok:false,reason:'memory-unavailable'}
  if(pendingRows(read()).some(r=>r.memoryId===parent.id))return {ok:false,reason:'detail-write-pending'}
  try{return details.read(parent,{limitBytes:maxBytes})}
  catch(error){logger.warn?.('深层详情读取拒绝：'+String(error?.message||error).slice(0,90));return {ok:false,reason:'detail-invalid'}}
 }
 function memoryDetailInfo({memoryId='',accountTag='',ownerSession=false}={}){
  const parent=activeDetailParent({memoryId,accountTag,ownerSession})
  if(!parent)return {available:false,reason:'memory-unavailable'}
  if(pendingRows(read()).some(r=>r.memoryId===parent.id))return {available:false,reason:'detail-write-pending'}
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
 function recallVideoDetails({bvid='',memoryId='',accountTag='',maxBytes=4096,ownerSession=false,visibility='',startMs,endMs,firstObservation=false,order='recent',cursor='',maxFragments=null}={}){
  const windowed=startMs!==undefined||endMs!==undefined
  if(windowed&&(!Number.isSafeInteger(startMs)||!Number.isSafeInteger(endMs)||startMs<0||endMs<startMs||endMs>86_400_000))return {ok:false,reason:'invalid-detail-time-range'}
  if(!validBV(bvid)||!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||'')||
    memoryId&&!/^e-[a-f0-9]{18}$/.test(memoryId))return {ok:false,reason:'memory-unavailable'}
  if(!['earliest','recent'].includes(order)||typeof cursor!=='string'||cursor.length>256)return {ok:false,reason:'invalid-detail-selector'}
  // Cursor carries only offsets and a signed snapshot digest, never content.
  // All pages re-enter this same current-account/privacy/decay gate.
  if(maxFragments!==null&&(!Number.isSafeInteger(maxFragments)||maxFragments<1||maxFragments>12))return {ok:false,reason:'invalid-detail-selector'}
  const scope=JSON.stringify([accountTag,bvid,memoryId,ownerSession===true,visibility,startMs??null,endMs??null,firstObservation===true,order,...(maxFragments===null?[]:[maxFragments])])
  let offset=0,charOffset=0,expectedDigest=''
  if(cursor){
   const m=/^(\d{1,6})\.(\d{1,5})\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(cursor)
   if(!m||signRecallCursor(scope+'|'+m.slice(1,4).join('.'))!==m[4])return {ok:false,reason:'invalid-detail-cursor'}
   offset=Number(m[1]);charOffset=Number(m[2]);expectedDigest=m[3]
  }
  const liveData=decay().data
  const current=liveData.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&
    (e.visibility==='public-event'||ownerSession===true&&e.visibility==='private-session')&&(!visibility||e.visibility===visibility)&&
    e.accountTag===accountTag&&e.bvid===bvid&&e.at<=now()&&(!memoryId||e.id===memoryId))
  if(!current.length)return {ok:false,reason:cursor?'detail-cursor-stale':'memory-unavailable'}
  let rows=current.filter(e=>e.visualMemo&&['decoded-public-video','low-resolution-preview'].includes(e.visualMemo.source)&&
    Number.isSafeInteger(e.visualMemo.frameCount)&&e.visualMemo.frameCount>=1&&e.visualMemo.frameCount<=48&&
    Array.isArray(e.readEvidenceKinds)&&e.readEvidenceKinds.includes('visual-model-observation'))
    .sort((a,b)=>(order==='earliest'?a.at-b.at:b.at-a.at)||a.id.localeCompare(b.id))
  if(!rows.length)return {ok:false,reason:cursor?'detail-cursor-stale':'no-detail'}
  if(firstObservation===true)rows=rows.slice().sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)).slice(0,1)
  // Legacy appended focus may lie outside its parent's sampling envelope.
  // Select actual stored anchors before allocating the response budget.
  if(windowed)rows=rows.slice().sort((a,b)=>a.visualMemo.firstAtMs-b.visualMemo.firstAtMs||a.at-b.at||a.id.localeCompare(b.id))
  const targeted=windowed||firstObservation===true
  const cap=Math.max(256,Math.min(ownerSession===true?12288:8192,Math.floor(Number(maxBytes)||4096)))
  const fragments=[],sources=[],seen=new Set(),snapshot=createHash('sha256').update(scope)
  let bytes=0,totalFragments=0,invalid=false,unavailable=false,missingSources=0,availableSources=0,stopped=false,nextOffset=offset,nextChar=charOffset,minimumBytes=0
  const pendingIds=new Set(pendingRows(liveData).filter(r=>r.accountTag===accountTag).map(r=>r.memoryId))
  // Stream one bounded attachment at a time; never retain all content in memory.
  // Even after filling the page, count/hash remaining eligible evidence so
  // the continuation cannot silently drift after a forget/restore/new observation.
  for(const row of rows){
   if(accountTag!==String(getAccountTag()||''))return {ok:false,reason:'memory-unavailable'}
   if(pendingIds.has(row.id)){missingSources++;continue}
   let result;try{result=details.read(row,{management:true})}catch{invalid=true;missingSources++;continue}
   if(!result.ok){missingSources++;if(result.reason==='no-detail')continue;if(result.reason==='unavailable'||result.reason==='memory-unavailable')unavailable=true;else invalid=true;continue}
   availableSources++
   const matching=windowed?result.fragments.filter(p=>p.timeAnchorMs?.[0]<=endMs&&p.timeAnchorMs?.[1]>=startMs):result.fragments
   if(targeted)matching.sort((a,b)=>(a.timeAnchorMs?.[0]??Infinity)-(b.timeAnchorMs?.[0]??Infinity)||(a.timeAnchorMs?.[1]??Infinity)-(b.timeAnchorMs?.[1]??Infinity))
   for(const part of matching){
    // Identity includes the parent so repeated verified observations remain independent.
    const key=row.id+'|'+part.sourceRef+'|'+part.fragmentId
    if(seen.has(key))continue;seen.add(key)
    const entry={...part,memoryId:row.id,observedAt:row.at,visibility:row.visibility}
    const raw=JSON.stringify(entry);snapshot.update(raw).update('\n')
    const pos=totalFragments++
    if(stopped||pos<offset)continue
    if(maxFragments!==null&&fragments.length>=maxFragments){stopped=true;continue}
    const hasSource=sources.some(x=>x.memoryId===row.id)
    if(!hasSource&&sources.length>=12){stopped=true;continue}
    const size=Buffer.byteLength(raw,'utf8')
    const start=pos===offset?charOffset:0
    let delivered=entry,deliveredSize=size
    if(start||size>cap-bytes){
     // Prefer a complete next fragment on the next page. A single oversized
     // legacy board is instead read in Unicode-safe chunks of the SAME evidence.
     if(fragments.length){stopped=true;continue}
     const chars=Array.from(entry.content)
     if(start>=chars.length){stopped=true;minimumBytes=cap+1;continue}
     const chunk=n=>({...entry,content:chars.slice(start,n).join(''),contentCharRange:[start,n],contentTotalChars:chars.length,contentComplete:false})
     let lo=start+1,hi=chars.length,best=null
     minimumBytes=Buffer.byteLength(JSON.stringify(chunk(lo)),'utf8')
     if(minimumBytes>cap){stopped=true;continue}
     while(lo<=hi){const mid=Math.floor((lo+hi)/2),candidate=chunk(mid),n=Buffer.byteLength(JSON.stringify(candidate),'utf8');if(n<=cap){best=candidate;deliveredSize=n;lo=mid+1}else hi=mid-1}
     delivered=best;const end=best.contentCharRange[1];minimumBytes=0
     nextOffset=end===chars.length?pos+1:pos;nextChar=end===chars.length?0:end
     if(nextChar)stopped=true
    }else{nextOffset=pos+1;nextChar=0}
    if(!hasSource)sources.push({memoryId:row.id,at:row.at,source:row.visualMemo?.source,visibility:row.visibility})
    fragments.push(delivered);bytes+=deliveredSize
   }
  }
  const digest=snapshot.digest('hex')
  if(cursor&&(digest!==expectedDigest||offset>=totalFragments))return {ok:false,reason:'detail-cursor-stale',note:'当前有效证据已改变；重新发起回忆，不使用旧游标。'}
  if(!totalFragments&&!invalid&&!unavailable&&rows.some(r=>pendingIds.has(r.id)))return {ok:false,reason:'detail-write-pending',note:'已有核验观察正在恢复保存，不需要重复补看。',...(windowed?{requestedRangeMs:[startMs,endMs]}:{})}
  if(!totalFragments)return {ok:false,reason:invalid?'detail-invalid':unavailable?'memory-unavailable':windowed&&availableSources?'no-detail-in-time-range':'no-detail',...(windowed?{requestedRangeMs:[startMs,endMs]}:{})}
  if(!fragments.length)return {ok:false,recallPage:true,reason:'detail-budget-too-small',totalFragments,minimumBytes,budgetBytes:cap,hasMore:true,note:'存在有效证据，但本次预算不足；提高预算后重试原请求。'}
  const hasMore=nextOffset<totalFragments||nextChar>0
  const payload=[nextOffset,nextChar,digest].join('.')
  return {ok:true,recallPage:true,bvid,...(memoryId||rows.length===1?{memoryId:memoryId||rows[0].id}:{}),fragments,sources,totalFragments,returnedFragments:fragments.length,remainingFragments:totalFragments-nextOffset,bytes,budgetBytes:cap,hasMore,truncated:hasMore,...(hasMore?{nextCursor:payload+'.'+signRecallCursor(scope+'|'+payload)}:{}),missingSources,...(invalid||unavailable?{partialSources:true}:{}),...(windowed?{requestedRangeMs:[startMs,endMs]}:{}),...(firstObservation===true?{firstCurrentObservation:true}:{}),certainty:'model-observation-not-independent-semantic-proof',
    note:'当前有效历史模型观察；未覆盖画面未知。hasMore 是未读取而非遗忘；按需继续同一选择条件。contentCharRange 为同一原始描述的字符分段，不是新画面或新时间。'}
 }
 // Local owner management only. List current eligible sources, or read one exact
 // source from that same group. Full single-attachment limit is the existing
 // validated storage limit; model recall budgets and public callers are unchanged.
 function inspectVideoDetails({bvid='',accountTag='',visibility='',sourceMemoryId=''}={}){
  if(!validBV(bvid)||!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||'')||
     !['public-event','private-session'].includes(visibility)||sourceMemoryId&&!/^e-[a-f0-9]{18}$/.test(sourceMemoryId))return {ok:false,reason:'memory-unavailable'}
  const liveData=decay().data,pendingIds=new Set(pendingRows(liveData).map(r=>r.memoryId))
  const rows=liveData.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&e.accountTag===accountTag&&
    e.bvid===bvid&&e.visibility===visibility&&e.at<=now()&&e.visualMemo&&e.readEvidenceKinds?.includes('visual-model-observation'))
    .sort((a,b)=>a.visualMemo.firstAtMs-b.visualMemo.firstAtMs||a.at-b.at||a.id.localeCompare(b.id))
  if(!rows.length)return {ok:false,reason:'no-detail'}
  if(sourceMemoryId){
   const parent=rows.find(e=>e.id===sourceMemoryId)
   if(!parent)return {ok:false,reason:'memory-unavailable'}
   if(pendingIds.has(parent.id))return {ok:false,reason:'detail-write-pending'}
   try{const result=details.read(parent,{management:true})
    if(!result.ok)return result
    return {...result,fragments:result.fragments.map(part=>({...part,observedAt:parent.at,
      observationSource:parent.visualMemo.source,observationRangeMs:[parent.visualMemo.firstAtMs,parent.visualMemo.lastAtMs]}))}
   }catch{return {ok:false,reason:'detail-invalid'}}
  }
  const sources=rows.map(row=>{
   let result;try{result=pendingIds.has(row.id)?{available:false,reason:'detail-write-pending'}:details.inspect(row)}catch{result={available:false,reason:'detail-invalid'}}
   return {memoryId:row.id,observedAt:row.at,observationSource:row.visualMemo.source,
    observationRangeMs:[row.visualMemo.firstAtMs,row.visualMemo.lastAtMs],frameCount:row.visualMemo.frameCount,
    available:result.available,reason:result.reason,totalFragments:result.totalFragments||0}
  })
  return {ok:true,sources,totalFragments:sources.reduce((n,x)=>n+x.totalFragments,0)}
 }
 // Reverse activation covers the entire bounded live store, not a recent-128 window.
 // Derived, sanitized text, not a second memory store. The live attachment
 // and its original parent remain authoritative even for vector hits.
 function readVisualDetailCandidates({accountTag=String(getAccountTag()||''),ids=null,limit=MAX_EPISODES,visibility='public-event'}={}){
  if(!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||''))return []
  const wanted=Array.isArray(ids)?new Set(ids):null
  const liveData=decay().data,pendingIds=new Set(pendingRows(liveData).map(r=>r.memoryId))
  const parents=liveData.episodes.filter(e=>!pendingIds.has(e.id)&&e.kind==='watch'&&e.stage==='clear'&&e.visibility===visibility&&
   e.accountTag===accountTag&&validBV(e.bvid)&&e.at<=now()&&e.visualMemo&&e.readEvidenceKinds?.includes('visual-model-observation')&&(!wanted||wanted.has(e.id)))
   .sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id)).slice(0,Math.max(1,Math.min(MAX_EPISODES,Number(limit)||MAX_EPISODES)))
  const out=[]
  for(const parent of parents){
   try{
    const detail=details.read(parent,{management:true});if(!detail.ok)continue
    const parts=detail.fragments.filter(p=>p.certainty==='model-observation'&&['observed-scene','focused-observation'].includes(p.type)).flatMap(p=>{
     const note=deriveVideoObservationNotes(p.content).join(' ')
     return note?[{fragmentId:p.fragmentId,sourceRef:p.sourceRef,timeAnchorMs:p.timeAnchorMs,note:note.slice(0,340)}]:[]
    }).slice(0,64)
    if(parts.length)out.push({id:parent.id,bvid:parent.bvid,parts,text:parts.map(p=>p.note).join(' ').slice(0,1800),...(visibility==='private-session'?{visibility,title:clean((parent.text.match(/《([^》]+)》/)||[])[1],100)}:{})})
   }catch{/* unavailable or revoked attachments do not become candidates */}
  }
  return accountTag===String(getAccountTag()||'')?out:[]
 }
 // Public callers cannot opt in to owner-only details through options.
 function visualDetailCandidates(options={}){return readVisualDetailCandidates({...options,visibility:'public-event'})}
 function ownerPrivateVisualCandidates({accountTag='',ids=null,limit=MAX_EPISODES}={}){
  if(getConfig()?.mainSessionMemoryEnabled!==true||!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||''))return []
  return readVisualDetailCandidates({accountTag,ids,limit,visibility:'private-session'})
 }
 function recoverPendingVisualDetails(){const data=read();if(!pendingRows(data).length)return {pending:0};return {pending:pendingRows(decay().data).length}}
 function reconcileMemoryDetails(){return details.reconcile(decay().data.episodes)}
 // Only exact, still-live PUBLIC missing sampling anchors; no private
 // history, archive read, fresh network access, or complete visual authority.
 function partialVideoGapTrace({accountTag='',bvid='',memoryId='',startMs,endMs}={}){
  if(!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||'')||!validBV(bvid)||
    memoryId&&!/^e-[a-f0-9]{18}$/.test(memoryId)||!Number.isSafeInteger(startMs)||startMs!==endMs||startMs<0||startMs>14400000)return []
  const live=decay().data.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&e.accountTag===accountTag&&
    e.visibility==='public-event'&&e.bvid===bvid&&e.at<=now()&&e.partialVisualMemo)
  // Do not repeat a known sample from another still-live partial observation.
  if(live.some(e=>partialMemo(e.partialVisualMemo)?.describedTimesMs.includes(startMs)))return []
  return live.filter(e=>!memoryId||e.id===memoryId).filter(e=>{
   const p=partialMemo(e.partialVisualMemo)
   return p&&p.sampledTimesMs.includes(startMs)&&!p.describedTimesMs.includes(startMs)
  }).sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id)).slice(0,1).map(e=>({
   memoryId:e.id,bvid:e.bvid,visibility:'public-event',partialGapAtMs:startMs}))
 }
 // A small optional planning view. No raw text, private source, archive,
 // full-visual grant or automatic network access. Existing detail takes priority.
 function partialVideoGapCandidates({accountTag='',limit=3}={}){
  if(!ACCOUNT.test(accountTag)||accountTag!==String(getAccountTag()||''))return []
  const rows=decay().data.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&e.accountTag===accountTag&&
    e.visibility==='public-event'&&validBV(e.bvid)&&e.at<=now()&&e.partialVisualMemo).sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id))
  const known=new Set(),seen=new Set(),out=[]
  for(const e of rows)for(const at of partialMemo(e.partialVisualMemo)?.describedTimesMs||[])known.add(e.bvid+':'+at)
  const cap=Math.max(1,Math.min(3,Number(limit)||3))
  let checked=0
  for(const e of rows){
   const p=partialMemo(e.partialVisualMemo);if(!p)continue
   for(const at of p.sampledTimesMs){
    const k=e.bvid+':'+at
    if(known.has(k)||seen.has(k)||at>14400000)continue
    seen.add(k);if(++checked>12)return out
    const r=recallVideoDetails({bvid:e.bvid,accountTag,visibility:'public-event',startMs:at,endMs:at})
    if(r?.ok!==false||!['no-detail','no-detail-in-time-range'].includes(r.reason))continue
    out.push({bvid:e.bvid,memoryId:e.id,atMs:at,title:clean((e.text.match(/《([^》]+)》/)||[])[1],100),
      sampledCount:p.sampledTimesMs.length,describedCount:p.describedTimesMs.length})
    if(out.length>=cap)return out
   }
  }
  return out
 }
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
  const limit=MAX_EPISODES,used=data.episodes.length,remembered=(counts.clear||0)+(counts.fuzzy||0)+(counts.trace||0),forgotten=counts.forgotten||0
  const visibilityGroups=[['public-event','公开经历'],['private-session','主人私下体验'],['friend-private','熟人私聊'],['owner-private','主人私聊'],['public-action','公开操作'],['private-action','私密操作']]
  const kindGroups=[['watch','视频经历'],['social','公开互动'],['comment','公开留言'],['private-social','私密交流'],['action','平台动作']]
  const byVisibility=Object.fromEntries(visibilityGroups.map(([key])=>[key,data.episodes.filter(e=>e.visibility===key).length]))
  const byKind=Object.fromEntries(kindGroups.map(([key])=>[key,data.episodes.filter(e=>e.kind===key).length]))
  const live=data.episodes.filter(e=>e.stage!=='forgotten')
  const topOccupants=[
    {key:'watch-clear',label:'清晰视频经历',count:data.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear').length},
    {key:'watch-faded',label:'已变模糊/印象的视频经历',count:data.episodes.filter(e=>e.kind==='watch'&&['fuzzy','trace'].includes(e.stage)).length},
    {key:'social-public',label:'公开互动与评论',count:live.filter(e=>['social','comment'].includes(e.kind)).length},
    {key:'private-social',label:'私密交流',count:live.filter(e=>e.kind==='private-social').length},
    {key:'actions',label:'平台操作经历',count:live.filter(e=>e.kind==='action').length},
    {key:'forgotten',label:'已遗忘占位',count:forgotten},
    {key:'other',label:'其他经历',count:live.filter(e=>!kindGroups.some(([key])=>key===e.kind)).length}
  ].map(row=>({...row,ratio:limit?Number((row.count/limit).toFixed(4)):0})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label))
  const retainedByDay=Array.from({length:7},(_,i)=>{const d=new Date(t);d.setDate(d.getDate()-6+i);const date=localDate(d.getTime());return {date,count:data.episodes.filter(e=>localDate(e.at)===date).length}})
  const reinforced=live.filter(e=>Number(e.reinforceCount)>0).length
  const actions=Object.entries(ACTION_NAMES).map(([key,label])=>({key,label,count:live.filter(e=>e.kind==='action'&&e.action===key).length})).filter(r=>r.count).sort((a,b)=>b.count-a.count)
  const fadedActions=live.filter(e=>e.kind==='action'&&!Object.hasOwn(ACTION_NAMES,e.action||'')).length
  if(fadedActions)actions.push({key:'unspecified',label:'细节已衰减或未知',count:fadedActions})
  const pressure=used>=limit?'full':used/limit>=.85?'high':used/limit>=.6?'medium':'low'
  return {ok:true,counts,total:used,todayAdded,todayForgotten,archiveEvents:data.archiveKeys.length,archiveMonths:months,
    shallowSlots:persistedSlots.length,nestedVisualObservations:data.episodes.length-persistedSlots.length,
    associations:{active:(data.associations||[]).filter(e=>e.accountTag===String(getAccountTag()||'')).length},
    health:{capacity:{limit,used,remaining:Math.max(0,limit-used),utilization:Number((used/limit).toFixed(4)),pressure,remembered,forgotten},
      byStage:stages.map(key=>({key,label:key==='clear'?'清晰':key==='fuzzy'?'模糊':key==='trace'?'印象':'已遗忘',count:counts[key]||0,ratio:limit?Number(((counts[key]||0)/limit).toFixed(4)):0})),
      byKind:kindGroups.map(([key,label])=>({key,label,count:byKind[key]||0,ratio:limit?Number(((byKind[key]||0)/limit).toFixed(4)):0})),
      byVisibility:visibilityGroups.map(([key,label])=>({key,label,count:byVisibility[key]||0,ratio:limit?Number(((byVisibility[key]||0)/limit).toFixed(4)):0})),
      topOccupants,retainedByDay,actions,reinforced,eventsByDay:healthRows(data,t)},
    oldestEpisodeAt:earliest?new Date(earliest).toISOString():'',oldestEpisodeDays:earliest!==null?Math.max(0,Math.floor((t-earliest)/DAY)):0,
    nextFuzzyAt:nextClear?new Date(nextClear).toISOString():'',migrated:data.migrated,halfLifeDays:h0,search:hybrid.status(),details:{...details.stats(),pending:pendingRows(data).length}}
 }
 return {...Object.fromEntries(Object.entries({recordEvents,recordSocialReply,recordSocialDecline,recordPrivateInsights,privateInsights,privateInsightCandidates,recall,semanticCandidates,neuralEvidenceSnapshot,recordEpisodeEmotion,recordAssociations,reinforceConfirmedPublicEpisodes,reinforceConfirmedPublicDetail,reinforceQuotedPublicEpisode,associationCandidates,validateAssociationPath,associationActivationSteps,reflectionEvidence,emotionEvidence,recentEmotionEvents,publicVideoEvidence,publicSocialEvidence,recentVisualExperienceContext,videoEvidenceTrace,partialVideoGapTrace,partialVideoGapCandidates,attachMemoryDetails,recordVerifiedFocusRevision,expandMemoryDetail,memoryDetailInfo,recallVideoDetails,inspectVideoDetails,visualDetailCandidates,ownerPrivateVisualCandidates,videoRecallGroups,recoverPendingVisualDetails,reconcileMemoryDetails,decay,status}).map(([name,fn])=>[name,locked(fn)])),close:()=>hybrid.close(),file}
}
export const __test={asEpisode,fadeEpisode,desiredStage,keyOf}
