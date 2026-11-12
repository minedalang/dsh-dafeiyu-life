/**
 * 2.8.0 shared Life action contract. An observation offers an opportunity, a
 * model decision owns intention, and a sealed one-shot proof only permits the
 * ORIGINAL sender to attempt the exact action. Neither observing nor owning a
 * proof asserts delivery. Do not expose identities or public text in traces.
 */
import {createHash} from 'node:crypto'

export const VIDEO_ACTION_KIND=Object.freeze({
  like_video:'video_like',collect_video:'video_collect',
  follow_creator:'video_follow',comment_video:'video_comment'
})
export const LIFE_ACTION_OUTCOMES=Object.freeze([
  'not_offered','declined','deferred','blocked','executing','verified','uncertain'
])
const BV=/^BV[0-9A-Za-z]{10}$/
const CONTROL=/[\u0000-\u001f\u007f]/
const SOURCES=new Set(['life-opportunity','life-todo','life-search-child','social-read-now','owner-dm-read','comment-reply-receipt','video-agent'])

/** All video entrypoints use one evidence shape; an observation is never a write permission. */
export function verifiedVideoObservation({source,sourceId,bvid,title,at=Date.now(),accountTag}={}){
  if(!SOURCES.has(source)||typeof sourceId!=='string'||sourceId.length<1||sourceId.length>200||CONTROL.test(sourceId)||
    !BV.test(String(bvid||''))||typeof title!=='string'||!title.trim()||title.length>200||CONTROL.test(title)||
    !/^[a-f0-9]{16}$/.test(String(accountTag||''))||!Number.isSafeInteger(at)||at<=0)
    return {ok:false,code:'observation-unverified'}
  return {ok:true,source,sourceId,bvid,title:title.trim().slice(0,100),at,accountTag,
    evidenceLevel:'verified-public-metadata',watched:false}
}

export function exactVideoAction({kind,target,commentText=''}={}){
  if(!Object.values(VIDEO_ACTION_KIND).includes(kind)||!BV.test(String(target||'')))return null
  if(kind==='video_comment'){
    if(typeof commentText!=='string'||!commentText.trim()||commentText.length>180||
      CONTROL.test(commentText)||/@/.test(commentText)||/https?:\/\/|www\./i.test(commentText))return null
  }else if(commentText!=='')return null
  return {kind,target,commentText:kind==='video_comment'?commentText:''}
}

export function lifeActionOutcome({offered=true,decision='',gate='',delivery=''}={}){
  if(!offered)return 'not_offered'
  if(gate)return 'blocked'
  if(decision==='skip'||decision==='refuse')return 'declined'
  if(decision==='defer')return 'deferred'
  if(delivery==='verified')return 'verified'
  if(['uncertain','accepted-unverified','unconfirmed','failed'].includes(delivery))return 'uncertain'
  return 'executing'
}

/** A tool's claimed outer success does not establish video metadata. The
 * exact BV and a nonempty verified info title must agree. */
export function observedVideoFromRead({source,sourceId,expectedBvid,read,accountTag,at=Date.now()}={}){
  if(read?.ok!==true||read?.bvid!==expectedBvid)return {ok:false,code:'read-not-verified'}
  let info=read.info
  if(typeof info==='string'){try{info=JSON.parse(info)}catch{return {ok:false,code:'info-invalid'}}}
  if(info?.data&&typeof info.data==='object')info=info.data
  if(info?.bvid!==expectedBvid)return {ok:false,code:'info-target-mismatch'}
  return verifiedVideoObservation({source,sourceId,bvid:expectedBvid,title:info.title,accountTag,at})
}

/** Compatibility adapter for a verified owner request with no independent
 * model-planned intention yet. The SAME Life willingness arbiter makes ONE
 * decision; no emotion score or second social agent can override it.
 * This is an opportunity disposition, not a grant to bypass the original
 * sender. Legacy tool permissions, identity and post-write checks remain.
 */
export async function unifiedLegacySocialChoice({lifeWillingness,source,uid,messageId,intent='explore',target='',thread='',hint=''}={}){
  if(!['bili-dm','bili-comment'].includes(source)||!/^[1-9]\d{0,18}$/.test(String(uid||''))||
    !String(messageId||'').trim()||!lifeWillingness||typeof lifeWillingness.decide!=='function')
    return {decision:'blocked',reason:'life-intent-unavailable'}
  const mapped={explore:'social_read',chat:'reflect',like:'video_like',collect:'video_collect',
    follow:'video_follow',unfollow:'video_unfollow',publish:'write_dynamic'}[intent]
  if(!mapped)return {decision:'blocked',reason:'unsupported-life-action'}
  const identity=[source,uid,messageId,intent,target,thread].map(String).join('\0')
  // The namespace is stable, but no identifiers or untrusted text appear in
  // the anonymous willingness trace or persist as the source key.
  const key=createHash('sha256').update(identity).digest('hex')
  const candidate={id:'legacy_social',kind:mapped,label:({
    explore:'自主决定是否了解这条经核验的社会推荐',chat:'自主决定是否回应这条社交邀请',
    like:'自主决定是否点赞已确定目标',collect:'自主决定是否收藏已确定目标',
    follow:'自主决定是否关注已确定目标',unfollow:'自主决定是否取关已确定目标',
    publish:'自主决定是否处理已经明确授权的发布请求'})[intent]}
  let choice
  try{choice=await lifeWillingness.decide({scene:source==='bili-dm'?'dm':'comment',
    trigger:'legacy-verified-social-request',sourceKey:'legacy-social:'+key,
    uid:String(uid),candidates:[candidate],hint:String(hint||'').slice(0,200)},
    {queueIfBusy:true})}
  catch{return {decision:'blocked',reason:'life-intent-unavailable'}}
  if(choice?.ok!==true)return {decision:choice?.action==='defer'?'defer':choice?.action==='skip'?'refuse':'blocked',
    reason:choice?.reason||'life-intent-not-authorized'}
  // Consume exact kind of the single model selection before the existing
  // source-specific guarded executor. Delegation never means platform sent.
  const used=lifeWillingness.verify(choice.proof,mapped)
  if(used?.ok!==true){lifeWillingness.receipt(choice.proof,{status:'not-sent'});
    return {decision:'blocked',reason:'life-intent-proof-invalid'}}
  lifeWillingness.receipt(choice.proof,{status:'delegated'})
  return {decision:'allow',reason:'life-model-chose',score:null,mode:'life',newDecision:true}
}
