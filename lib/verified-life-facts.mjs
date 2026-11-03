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
  video_uploaded_verified:'platform-upload-receipt',
  todo_read_completed:'verified-read-todo',
  message_sent_verified:'platform-send-receipt',
})
export const VERIFIED_LIFE_EVENT_TYPES=Object.freeze(Object.keys(KINDS))
const CHANNELS=new Set(['dm','comment','dynamic','main'])
const SCOPE=new Set(['public','owner-private','recipient-private'])
const clean=(s,n=120)=>String(s??'').replace(/[\r\n\x00-\x1f<>]/g,' ').trim().slice(0,n)
/** Only caller-verified receipts; never parse model JSON or external text here. */
export function lifeFactFromReceipt({type,operation,ok=false,sourceId='',at=Date.now(),bvid='',uid='',scope='public',channel='',receiptId=''}={}){
  if(ok!==true||!Object.hasOwn(KINDS,String(type))||operation!==KINDS[type])return null
  if(!Number.isSafeInteger(Number(at))||Number(at)<=0)return null
  if(!SCOPE.has(scope)||channel&&!CHANNELS.has(channel))return null
  if(['video_selected','video_metadata_read','video_visual_inspected','audio_playback_verified','video_uploaded_verified'].includes(type)&&!BV.test(String(bvid)))return null
  if(type==='message_sent_verified'&&!receiptId)return null
  if(scope!=='public'&&!UID.test(String(uid)))return null
  const id=clean(sourceId||receiptId,100)
  if(!id)return null
  return Object.freeze({type,sourceId:id,at:Number(at),bvid:BV.test(String(bvid))?String(bvid):'',uid:UID.test(String(uid))?String(uid):'',scope,channel:channel||'',receiptId:clean(receiptId,100)})
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
const unsoundSensory=(s)=>/(?:我|鱼鱼|咱)(?:自己|亲自|已经|刚刚|终于|真的|昨天|前几天|最近|认真|完整)?.{0,6}(?:听过|听完|听了|听到|亲耳|听起来|听着|看完|完整看过|看完了).{0,22}(?:歌曲|歌|曲|音乐|翻唱|视频|MV|旋律|声音|声线|唱功)/.test(s)||
  /(?:我|鱼鱼)(?:觉得|感觉).{0,15}(?:唱得真好|音色真棒|声音太好听|旋律太好听)/.test(s)
const ownUpload=(s)=>unsupportedVideoAuthorship(s)||/(?:我|鱼鱼)(?:最近|之前|曾经|刚刚|自己|已经|终于)?.{0,6}(?:投稿成功|上传了视频|发布了视频|发了(?:一条|一期|个)视频)/.test(s)
/** One API, one policy for model-generated outbound paths. Never grants consent. */
export function verifyLifeOutbound(text,{channel='dm',uid='',events=[],ownerText='',readRecords=[],musicRequest=false,allowUserQuotedText=false,at=Date.now()}={}){
  const body=String(text??'')
  const affirmative=stripNegatedFirstPersonActs(body)
  if(!CHANNELS.has(channel)||body.length>3000)return {ok:false,reason:'外发渠道或正文异常',code:'invalid-outbound'}
  const view=currentLifeFactView(events,{uid,channel,at})
  const has=type=>view.some(e=>e.type===type)
  // An authenticated user's quoted sentence is not evidence that fish performed
  // that act. Only trusted adapters may build verified event receipts.
  if(ownUpload(affirmative)&&!has('video_uploaded_verified'))return {ok:false,reason:'缺少本人投稿的真实平台回执',code:'unverified-upload'}
  if((unsoundSensory(affirmative)||unsupportedVideoExperience(affirmative)&&!ownUpload(affirmative))&&
    !has('audio_playback_verified')&&!has('video_visual_inspected'))return {ok:false,reason:'搜索或查看元数据不等于亲耳听歌或完整观看',code:'unverified-sensory'}
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
