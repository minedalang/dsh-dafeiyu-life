/**
 * Cross-scene continuity is an evidence view, not a second memory ledger.
 * Every detail is re-read from the current, fading LifeMemoryGateway copy.
 * Expired memories and task logs must never be used to reconstruct details.
 */
import {unsupportedVideoExperience} from './claim-provenance.mjs'
const clean=(v,n=240)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const UID=/^[1-9]\d{0,18}$/
const disallowedClaim=/(?:我|鱼鱼|刚才|刚刚|已经|真的|亲自).{0,10}(?:听了|听完|看完|看到了画面|听起来|听着真好|听着挺好|唱得好|播放完|看完整)/
const unsupportedFeel=/(?:太好听|真好听|挺好听|听感|音色好|嗓音好|旋律好听)/
export function naturalFollowupText(value,{audioObserved=false}={}){
 const text=clean(value,440)
 if(text.length<5||text.length>400||/[<>]/.test(text)||/https?:\/\/|(?:cookie|token|验证码|密码|system prompt|忽略以上)/i.test(text))return ''
 // A video-info/subtitle lookup is not audio playback. Do not imply sensory evidence.
 if(unsupportedVideoExperience(text)||!audioObserved&&(disallowedClaim.test(text)||unsupportedFeel.test(text)))return ''
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
export const safeExperienceOrigin=kind=>({
 'accepted-todo':'我当时是因为自己接受了一项探索建议，才去查看这段公开资料',
 'self-exploration':'我当时出于自己的好奇去查看这段公开资料',
 'main-session':'我当时是在明确的主 Session 任务中查看这段公开资料'
})[kind]||''
