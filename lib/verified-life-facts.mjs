/**
 * Verified Life Facts v1: shared, read-only contract for facts BEFORE public or
 * private outbound speech. This is not a second long-term memory store.
 *
 * No model-supplied object is an event receipt. Adapters provide only results
 * that their existing authenticated/verified operation already returned. Views
 * are short-lived, scoped to a recipient/channel, and never read the archive.
 */
import {unsupportedVideoAuthorship,unsupportedVideoExperience,stripNegatedFirstPersonActs} from './claim-provenance.mjs'
import {verifyOutboundVideoLinks} from './outbound-video-link-evidence.mjs'

const BV=/^BV[0-9A-Za-z]{10}$/
const UID=/^[1-9]\d{0,18}$/
const KINDS=Object.freeze({
  video_selected:'public-video-selection',
  video_metadata_read:'public-video-metadata',
  video_visual_inspected:'verified-video-visual',
  audio_playback_verified:'verified-audio-playback',
  // These stronger receipts are reserved for adapters that can verify the ENTIRE work.
  // A frame preview or partial audio access must never forge them.
  video_full_view_verified:'verified-video-complete',
  audio_full_playback_verified:'verified-audio-complete',
  video_uploaded_verified:'platform-upload-receipt',
  todo_read_completed:'verified-read-todo',
  message_sent_verified:'platform-send-receipt',
  creator_follow_verified:'platform-creator-follow-receipt',
  creator_unfollow_verified:'platform-creator-unfollow-receipt',
  video_collected_verified:'platform-video-collect-receipt',
})
export const VERIFIED_LIFE_EVENT_TYPES=Object.freeze(Object.keys(KINDS))
const CHANNELS=new Set(['dm','comment','dynamic','main'])
const SCOPE=new Set(['public','owner-private','recipient-private'])
const clean=(s,n=120)=>String(s??'').replace(/[\r\n\x00-\x1f<>]/g,' ').trim().slice(0,n)
/** Only caller-verified receipts; never parse model JSON or external text here. */
export function lifeFactFromReceipt({type,operation,ok=false,sourceId='',at=Date.now(),bvid='',uid='',scope='public',channel='',receiptId='',targetUid=''}={}){
  if(ok!==true||!Object.hasOwn(KINDS,String(type))||operation!==KINDS[type])return null
  if(!Number.isSafeInteger(Number(at))||Number(at)<=0)return null
  if(!SCOPE.has(scope)||channel&&!CHANNELS.has(channel))return null
  if(['video_selected','video_metadata_read','video_visual_inspected','audio_playback_verified','video_full_view_verified','audio_full_playback_verified','video_uploaded_verified'].includes(type)&&!BV.test(String(bvid)))return null
  if(type==='message_sent_verified'&&!receiptId)return null
  if(['creator_follow_verified','creator_unfollow_verified'].includes(type)&&!UID.test(String(targetUid)))return null
  if(type==='video_collected_verified'&&!BV.test(String(bvid)))return null
  if(scope!=='public'&&!UID.test(String(uid)))return null
  const id=clean(sourceId||receiptId,100)
  if(!id)return null
  return Object.freeze({type,sourceId:id,at:Number(at),bvid:BV.test(String(bvid))?String(bvid):'',uid:UID.test(String(uid))?String(uid):'',scope,channel:channel||'',receiptId:clean(receiptId,100),targetUid:UID.test(String(targetUid))?String(targetUid):''})
}
/** Verified successful read results of THIS owner-message turn, not lastSearch. */
export function lifeFactsFromOwnerReads(rows=[],{uid='',at=Date.now()}={}){
  const out=[]
  for(const [i,r] of (Array.isArray(rows)?rows:[]).slice(0,12).entries()){
    if(r?.ok!==true)continue
    if(r.action==='search')for(const v of (Array.isArray(r.videos)?r.videos:[]).slice(0,40)){
      const fact=lifeFactFromReceipt({type:'video_metadata_read',operation:'public-video-metadata',ok:true,
        bvid:v.bvid,at,uid,scope:'owner-private',channel:'dm',sourceId:`search:${i}:${v.bvid}`})
      if(fact)out.push(fact)
    }
    if(r.action==='shared_video'){
      // Only the already recipient/account-scoped confirmed sent entry from the
      // social intent engine may supply this read record; a cached model URL may not.
      const fact=lifeFactFromReceipt({type:'video_selected',operation:'public-video-selection',ok:true,
        bvid:r.bvid,at,uid,scope:'owner-private',channel:'dm',sourceId:'confirmed-share:'+String(r.sourceId||'')})
      if(fact)out.push(fact)
    }
    if(r.action==='watch'){
      // A successful video-info/read action proves metadata access only, never
      // audio playback, visual perception or completion of a whole video.
      const fact=lifeFactFromReceipt({type:'video_metadata_read',operation:'public-video-metadata',ok:true,
        bvid:r.bvid,at,uid,scope:'owner-private',channel:'dm',sourceId:`watch-info:${i}:${r.bvid}`})
      if(fact)out.push(fact)
    }
  }
  return out
}
/** Convert an authenticated MCP single-target status response into short-lived owner-private
 * facts. Historical actions and current remote state are SEPARATE fields. Never
 * manufacture a follow/unfollow from current status alone, or imply a collect
 * remains current from a historical local receipt. The caller must have already
 * executed the trusted platform adapter and confirmed the account UID. */
export function lifeFactsFromCreatorSnapshot(snapshot,{accountUid='',channel='main'}={}){
  if(snapshot?.ok!==true||!UID.test(String(accountUid))||String(snapshot.accountUid)!==String(accountUid)||!UID.test(String(snapshot.creatorUid))||
    !BV.test(String(snapshot.bvid))||!CHANNELS.has(channel))return {facts:[],current:{follow:'unknown',collect:'not-verified'}}
  const uid=String(accountUid),target=String(snapshot.creatorUid),bvid=String(snapshot.bvid),facts=[]
  const add=(type,time,key)=>{
    const ms=Date.parse(String(time||''))
    if(!Number.isSafeInteger(ms)||ms<=0||ms>Date.now()+86400000)return
    const fact=lifeFactFromReceipt({type,operation:KINDS[type],ok:true,scope:'owner-private',uid,targetUid:target,
      bvid,channel,at:ms,sourceId:`platform:${type}:${target}:${bvid}:${key}`})
    if(fact)facts.push(fact)
  }
  const h=snapshot.followHistory
  if(h?.recordedByPlugin===true){
    if(h.lastConfirmedAction==='follow'||h.lastConfirmedAction==='unfollow')add('creator_follow_verified',h.followedAt,'follow')
    if(h.lastConfirmedAction==='unfollow')add('creator_unfollow_verified',h.unfollowedAt,'unfollow')
  }
  if(snapshot.videoActionHistory?.collect==='confirmed-once'&&/^\d{4}-\d\d-\d\d$/.test(String(snapshot.videoActionDates?.collect||'')))
    add('video_collected_verified',snapshot.videoActionDates.collect+'T12:00:00Z','collect')
  const status=['following','not-following','restricted-or-unknown'].includes(snapshot.followCurrent)?snapshot.followCurrent:'unknown'
  return {facts,current:{follow:status,collect:'not-verified'},
    meaning:'平台当前关注状态是单目标实时核验；历史回执只证明当时做过，不代表当前仍收藏或仍关注'}
}

/** Successful read-only TODO history is an operation receipt, not video/audio memory. */
export function lifeFactsFromCompletedTodos(tasks=[],{uid='',at=Date.now()}={}){
  const out=[]
  for(const t of (Array.isArray(tasks)?tasks:[]).slice(0,60)){
    if(t?.status!=='done'||!Number(t.completedAt)||!['search_videos','watch_video'].includes(t.type)||
      !Array.isArray(t.history)||!t.history.some(h=>h.to==='done'&&h.reason==='收到成功回执'))continue
    if(String(t.origin?.uid||'')!==String(uid)||!UID.test(String(uid)))continue
    const fact=lifeFactFromReceipt({type:'todo_read_completed',operation:'verified-read-todo',ok:true,at:Number(t.completedAt),
      uid,scope:'recipient-private',channel:t.origin?.kind==='bilibili-comment'?'comment':'dm',sourceId:'todo:'+clean(t.id,60)})
    if(fact)out.push(fact)
    if(t.type==='watch_video'&&BV.test(String(t.bvid||''))){
      const video=lifeFactFromReceipt({type:'video_metadata_read',operation:'public-video-metadata',ok:true,
        bvid:t.bvid,at:Number(t.completedAt),uid,scope:'recipient-private',
        channel:t.origin?.kind==='bilibili-comment'?'comment':'dm',sourceId:'completed-video-todo:'+clean(t.id,60)})
      if(video)out.push(video)
    }
  }
  return out
}
/** Privacy and forgetting are *caller responsibilities*: use only currently
 * permitted sources, NEVER archives, cross-UID summaries or old search caches.
 * This second gate prevents scope/age leakage even if a caller makes a mistake.
 */
export function currentLifeFactView(events=[],{uid='',channel='dm',at=Date.now(),maxAgeMs=24*3600_000}={}){
  const result=[]
  for(const e of Array.isArray(events)?events:[]){
    if(!e||!Object.hasOwn(KINDS,String(e.type))||e.operation!==undefined&&e.operation!==KINDS[e.type]||
      !Number.isSafeInteger(Number(e.at))||Number(e.at)>at+60_000||at-Number(e.at)>maxAgeMs)continue
    if(e.scope!=='public'&&(e.uid!==String(uid)||!UID.test(String(uid))))continue
    if(e.channel&&e.channel!==channel)continue
    if(!clean(e.sourceId,100))continue
    if(!result.some(x=>x.type===e.type&&x.sourceId===e.sourceId))result.push(e)
  }
  return Object.freeze(result.slice(0,80))
}

const LINK=/(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]{10})(?![0-9A-Za-z])/ig
// Claims are checked by (kind, exact video) rather than by whether ANY sensory
// receipt exists. No natural-language regular expression proves every sentence;
// ambiguous positive first-person claims fail closed, while negations are stripped
// before this bounded, high-confidence check.
const BV_IN_TEXT=/BV[0-9A-Za-z]{10}(?![0-9A-Za-z])/g
const SENSORY_CLAIM=/(?:我|鱼鱼|咱|大肥鱼)(?:自己|亲自|已经|刚刚|刚才|真的|最近|认真|完整|终于|亲眼|亲耳|昨天|前几天|曾经|确实|好像|也|都|还)?[^。！？!\n；;]{0,9}?(听完了?|听过|听了|听到|亲耳听(?:过|到|了)?|看完了?|完整看过|看过|看了|亲眼看(?:过|到|了)?)[^。！？!\n；;]{0,28}/g
const AUDIO_OPINION=/(?:我|鱼鱼)(?:觉得|感觉)[^。！？!\n；;]{0,15}(?:唱得真好|音色真棒|声音太好听|旋律太好听)/g
const ownUpload=(s)=>unsupportedVideoAuthorship(s)||/(?:我|鱼鱼)(?:最近|之前|曾经|刚刚|自己|已经|终于)?.{0,6}(?:投稿成功|上传了视频|发布了视频|发了(?:一条|一期|个)视频)/.test(s)
const claimTarget=(text,position)=>{
  // Prefer the sentence containing the actual claim; never let a BV elsewhere
  // in a multi-topic reply become proof for a different video.
  const left=Math.max(0,...[...text.slice(0,position).matchAll(/[。！？!；;\n]/g)].map(x=>x.index+1))
  const right=(v=>v<0?text.length:v+position)(text.slice(position).search(/[。！？!；;\n]/))
  const mentions=[...new Set((text.slice(left,right).match(BV_IN_TEXT)||[]))]
  return mentions.length===1?mentions[0]:mentions.length>1?'ambiguous':''
}
const evidenceFor=(view,kind,target,full=false)=>{
  const evidenceTypes=kind==='audio'?(full?['audio_full_playback_verified']:['audio_playback_verified','audio_full_playback_verified']):
    kind==='visual'?(full?['video_full_view_verified']:['video_visual_inspected','video_full_view_verified']):['video_uploaded_verified']
  const matching=view.filter(e=>evidenceTypes.includes(e.type)&&e.bvid)
  if(target==='ambiguous')return false
  if(target)return matching.some(e=>e.bvid===target)
  // With no explicit BV, only one independently identified video can back the
  // claim; do not silently pick a different source from the whole fact view.
  const mentionedInView=new Set(view.filter(e=>e.bvid).map(e=>e.bvid))
  return mentionedInView.size===1&&matching.some(e=>e.bvid===mentionedInView.values().next().value)
}
const sensoryClaims=text=>{
  const found=[]
  for(const match of text.matchAll(SENSORY_CLAIM)){
    const action=match[1],segment=match[0]
    const visual=/看/.test(action)
    const full=/看完|听完/.test(action)||/(?:完整|全程|从头到尾|整首|整部|整段)/.test(segment)
    const relevant=/(?:歌|歌曲|音乐|曲|翻唱|视频|片子|MV|旋律|声音|声线|唱功|BV[0-9A-Za-z]{10})/i.test(segment)
    if(relevant)found.push({kind:visual?'visual':'audio',full,position:match.index})
  }
  for(const match of text.matchAll(AUDIO_OPINION))found.push({kind:'audio',full:false,position:match.index})
  return found
}
/** One API, one policy for model-generated outbound paths. Never grants consent. */
export function verifyLifeOutbound(text,{channel='dm',uid='',events=[],ownerText='',readRecords=[],musicRequest=false,allowUserQuotedText=false,at=Date.now()}={}){
  const body=String(text??'')
  const affirmative=stripNegatedFirstPersonActs(body)
  if(!CHANNELS.has(channel)||body.length>3000)return {ok:false,reason:'外发渠道或正文异常',code:'invalid-outbound'}
  const view=currentLifeFactView(events,{uid,channel,at})
  // A conversational promise or proposed follow is NOT a completed platform
  // action. This is a shared factual claim check (not a second desire vote).
  // Keep the pattern deliberately narrow to avoid blocking ordinary discussion
  // of whether two people might follow each other in the future.
  if(channel==='dm'&&
    /(?:互关快乐|互关成功|互关完成|已经互关|已经回关|回关成功|(?:我|鱼鱼|咱)(?:也|刚刚|已经)?(?:关注你了|回关你了|关注你啦|回关你啦))/.test(affirmative)&&
    !/(?:并未|没有|还没|尚未|不曾|别|不要|不能|无法)(?:[^。！？!\n]{0,8})(?:互关|回关|关注)/.test(affirmative)&&
    !view.some(e=>e.type==='creator_follow_verified'&&String(e.targetUid)===String(uid)))
    return {ok:false,reason:'没有当前收件人的平台关注成功回执，不能宣称互关完成',code:'unverified-social-follow'}
  const mentionedByUser=[...new Set(String(ownerText).match(BV_IN_TEXT)||[])]
  const targetOf=position=>{
    const explicit=claimTarget(affirmative,position)
    // The current message is the discourse anchor for an unspecified "this video".
    // It is NOT evidence of fish having watched/listened to anything.
    return explicit|| (mentionedByUser.length===1?mentionedByUser[0]:mentionedByUser.length>1?'ambiguous':'')
  }
  // A publishing receipt for video A cannot prove fish published video B.
  if(ownUpload(affirmative)&&!evidenceFor(view,'upload',targetOf(Math.max(0,affirmative.search(/(?:我|鱼鱼|咱|大肥鱼)/)))))
    return {ok:false,reason:'缺少该视频对应的真实平台投稿回执',code:'unverified-upload'}
  for(const claim of sensoryClaims(affirmative)){
    if(!evidenceFor(view,claim.kind,targetOf(claim.position),claim.full))
      return {ok:false,reason:claim.full?'没有该视频完整视听的核验回执':'缺少该视频对应的真实音频或视觉证据',code:'unverified-sensory'}
  }
  // Existing link verifier remains the source of truth for current owner DM
  // metadata. The general verifier additionally accepts exact current public
  // BV provenance from other authenticated adapters (never stale caches).
  const links=[...body.matchAll(LINK)].map(m=>m[1])
  if(links.length){
    const allowedBv=new Set(view.filter(e=>['video_selected','video_metadata_read','video_visual_inspected'].includes(e.type)).map(e=>e.bvid))
    if(readRecords.length){
      const checked=verifyOutboundVideoLinks(body,{ownerText,readRecords,musicRequest})
      if(!checked.ok)return {...checked,code:'unverified-video-link'}
    }else if(links.some(bv=>!allowedBv.has(bv)&&!String(ownerText).includes(bv)))
      return {ok:false,reason:'视频链接缺少当前可见的来源证据',code:'unverified-video-link'}
    if(musicRequest&&!readRecords.length&&links.some(bv=>!String(ownerText).includes(bv)))return {ok:false,reason:'无法确认视频链接与本次音乐请求相关',code:'music-link-not-verified'}
  }
  return {ok:true,evidenceCount:view.length,checkedLinks:links.length}
}
