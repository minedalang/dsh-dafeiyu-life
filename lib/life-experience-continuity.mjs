/**
 * Cross-scene continuity is an evidence view, not a second memory ledger.
 * Every detail is re-read from the current, fading LifeMemoryGateway copy.
 * Expired memories and task logs must never be used to reconstruct details.
 */
import {createHash} from 'node:crypto'
import {extractBiliShareLinks} from './bili-share-link.mjs'
import {unsupportedVideoExperience,stripNegatedFirstPersonActs} from './claim-provenance.mjs'
const clean=(v,n=240)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const UID=/^[1-9]\d{0,18}$/
const disallowedClaim=/(?:我|鱼鱼|刚才|刚刚|已经|真的|亲自).{0,10}(?:听了|听完|看完|看到了画面|听起来|听着真好|听着挺好|唱得好|播放完|看完整)/
const unsupportedFeel=/(?:太好听|真好听|挺好听|听感|音色好|嗓音好|旋律好听)/
export function naturalFollowupText(value,{audioObserved=false}={}){
 const text=clean(value,440)
 if(text.length<5||text.length>400||/[<>]/.test(text)||/https?:\/\/|(?:cookie|token|验证码|密码|system prompt|忽略以上)/i.test(text))return ''
 // A video-info/subtitle lookup is not audio playback. Do not imply sensory evidence.
 const affirmative=stripNegatedFirstPersonActs(text)
 if(unsupportedVideoExperience(affirmative)||!audioObserved&&(disallowedClaim.test(affirmative)||unsupportedFeel.test(affirmative)))return ''
 return text
}
export function liveExperienceEvidence({gateway,uid,role='stranger',topic='',title='',maxItems=4}={}){
 if(!gateway||!UID.test(String(uid)))return []
 const query=clean([topic,title].filter(Boolean).join(' '),150)
 if(!query)return []
 // This scope first runs LifeMemoryGateway's per-domain privacy and forgetting gates.
 const rows=gateway.recall({query,domain:'bili-dm',role,actorUid:String(uid),kinds:['watch'],maxItems,maxChars:1100})||[]
 return rows.filter(x=>x.stage==='clear'&&x.kind==='watch'&&x.summary).slice(0,maxItems)
  .map(x=>({id:x.id,summary:clean(x.summary,280),bvid:clean(x.bvid,20)}))
}
/** A deferred owner share can become a contact candidate, not a task or send grant.
 * Require the original Episode's own observation, not a same-BV historical cache. */
export function ownerExplorationCandidate({share,episodes=[],visualEvidence=[],uid,now=Date.now()}={}){
 const bv=String(share?.bvid||''),id=String(share?.id||'')
 if(!UID.test(String(uid||''))||!/^[a-f0-9]{24}$/.test(id)||!/^BV[0-9A-Za-z]{10}$/.test(bv)||
   share.parentId||share.senderRole!=='owner'||share.senderUid!==String(uid)||share.status!=='inspected'||
   share.resolvedKind!=='video'||share.deferredExploration?.goal!=='observe_video'||
   !Number.isSafeInteger(share.at)||share.at>now||now-share.at>24*3600_000)return null
 const matches=episodes.filter(e=>e.source==='inspected-opportunity'&&e.sourceId==='friend-shared-bili-link:'+id&&
   e.expiresAt>now&&['inspected','completed'].includes(e.status)&&e.episodeStatus!=='review'&&
   e.observedVideoBvids?.includes(bv))
 if(matches.length!==1)return null
 const episode=matches[0],step=episode.episodeHistory?.find(s=>s.action==='observe-video'&&s.bvid===bv&&
   Number.isSafeInteger(s.at)&&s.at>=share.at&&s.at<=now&&Number.isSafeInteger(s.frameCount)&&s.frameCount>=1&&s.frameCount<=48&&
   ['decoded-public-video','low-resolution-preview'].includes(s.visualSource))
 if(!step)return null
 const evidence=visualEvidence.find(e=>e.readOnly===true&&e.visibility==='public-event'&&e.bvid===bv&&
   /^e-[a-f0-9]{18}$/.test(e.memoryId||'')&&e.at>=share.at&&e.at<=step.at+60_000&&
   e.sources?.includes('visual-model-observation')&&e.visual?.source===step.visualSource&&e.visual.frameCount===step.frameCount)
 if(!evidence)return null
 return {id:'owner-exploration:'+id,shareId:id,episodeId:episode.id,bvid:bv,title:clean(share.title,85),
   frameCount:step.frameCount,observedAt:step.at,sharedAt:share.at,memoryId:evidence.memoryId}
}
/** Verify the original platform message using the existing opaque share identity.
 * Any other incoming message at or after it supersedes this conservative first scope. */
export function ownerExplorationInboxCurrent({rows,scope,uid,candidate}={}){
 if(!Array.isArray(rows)||!/^[a-f0-9]{16}$/.test(scope||'')||!UID.test(String(uid||''))||!candidate)return false
 const incoming=rows.filter(r=>r?.incoming===true&&String(r.senderUid)===String(uid))
 const originals=incoming.filter(r=>r.system!==true&&r.messageId&&Math.abs(Number(r.timestampMs)-candidate.sharedAt)<1000&&
   extractBiliShareLinks(r.text,{limit:2}).some(ref=>createHash('sha256').update([scope,String(uid),String(r.messageId),JSON.stringify(ref)].join('\0')).digest('hex').slice(0,24)===candidate.shareId))
 if(originals.length!==1)return false
 const source=originals[0]
 return !incoming.some(r=>r.messageId!==source.messageId&&(!Number.isFinite(Number(r.timestampMs))||Number(r.timestampMs)>=Number(source.timestampMs)))
}
/** No second willingness vote: the original Planner selected this exact candidate
 * and expression. Probe the source, reserve the existing owner contact claim,
 * then use the existing platform transaction. No auto retry after uncertainty. */
export async function deliverOwnerExploration({candidate,scope,uid,text,getCurrent,probe,reserve,settle,send,checkText,onConfirmed=()=>{}}={}){
 const current=()=>{try{return JSON.stringify(getCurrent())===JSON.stringify(candidate)}catch{return false}}
 const body=typeof text==='string'&&text.trim()===text&&text.length<=180&&naturalFollowupText(text)===text?text:''
 const validText=()=>{try{return checkText(body)===true}catch{return false}}
 const mark=status=>{try{settle(status)}catch{/* Reserved source remains non-retryable. */}}
 if(!candidate||!body||!current()||!validText())return {ok:false,reason:'owner-exploration-source-or-expression-invalid'}
 let rows
 try{rows=await probe()}catch{return {ok:false,reason:'owner-exploration-inbox-unavailable'}}
 if(!ownerExplorationInboxCurrent({rows,scope,uid,candidate}))return {ok:false,reason:'owner-exploration-new-input-or-unverified-source'}
 if(!current()||!validText())return {ok:false,reason:'owner-exploration-source-changed'}
 let claim;try{claim=reserve()}catch{return {ok:false,reason:'owner-exploration-contact-unavailable'}}
 if(claim?.ok!==true)return {ok:false,reason:claim?.reason||'owner-exploration-contact-blocked'}
 if(!current()){mark('blocked');return {ok:false,reason:'owner-exploration-source-changed'}}
 let result
 try{result=await send(body,()=>current()&&validText())}catch{mark('unknown');return {ok:false,uncertain:true,reason:'owner-exploration-send-unknown'}}
 if(result?.ok!==true||!String(result.receiptId||'')){
   const blocked=result?.notAttempted===true
   mark(blocked?'blocked':'unknown')
   return {ok:false,uncertain:!blocked,reason:blocked?'owner-exploration-send-blocked':'owner-exploration-send-unknown'}
 }
 mark('confirmed')
 if(current())try{await onConfirmed(body,result.receiptId)}catch{/* Never repeat a confirmed send for failed memory projection. */}
 return {ok:true,delivered:true}
}
export const safeExperienceOrigin=kind=>({
 'accepted-todo':'我当时是因为自己接受了一项探索建议，才去查看这段公开资料',
 'self-exploration':'我当时出于自己的好奇去查看这段公开资料',
 'main-session':'我当时是在明确的主 Session 任务中查看这段公开资料',
 'owner-manual-revisit':'我当时按照主人的明确请求补看了公开视频的局部采样'
})[kind]||''
