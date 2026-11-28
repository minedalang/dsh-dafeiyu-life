import {verifyEpisodeVideoVisual} from './life-episode-video-visual.mjs'
import {explainVideoVisionFailure} from './video-visual-failure.mjs'
const BV=/^BV[0-9A-Za-z]{10}$/
export function sharedVideoTargetAllowed({row,uid,role,scope,currentScope,enabled,permitted,offered}={}){
 return enabled===true&&permitted===true&&offered===true&&['owner','friend'].includes(role)&&
  /^[a-f0-9]{16}$/.test(String(scope||''))&&scope===currentScope&&String(row?.senderUid||'')===String(uid||'')&&
  row?.status==='inspected'&&row.resolvedKind==='video'&&row.evidenceLevel==='video-metadata-only'&&BV.test(String(row.bvid||''))
}
const safe=(v,n)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,n):''
// Shared reads may fail before a board exists. Keep these outcomes separate
// from an analyzed board and never forward raw tool/exception/model text.
const readFailures=Object.freeze({
 'vision-not-ready':'视觉识别未启用或模型尚未配置，本轮未取得画面。',
 'visual-read-failed':'本轮画面读取工具未完成，未取得可信画面。',
 'visual-read-unverified':'画面结果缺少完整可信来源或采样证据，不能视为已看过。',
 'life-vision-resource-unavailable':'视觉资源或同一视频读取锁繁忙，本轮未取得画面。',
 'authorization-changed':'当前账号或读取授权已变化，本轮结果不再可用。'
})
const failed=(status,stage)=>({code:status,status,stage,message:readFailures[status]})
export function sharedVideoReadFailure(reason){
 const status=reason==='authorization-changed'?'authorization-changed':
  ['video-visual-busy','resource-deferred'].includes(reason)?'life-vision-resource-unavailable':'visual-read-failed'
 return {verified:false,visualObserved:false,speechAvailable:false,reason:status,visualFailure:failed(status,'read')}
}
function explainSharedVisual(result){
 const visual=result.visual,detail=explainVideoVisionFailure(visual)
 if(detail)return {...detail,status:visual.status}
 if(result.visionDecision==='vision-disabled'||visual?.status==='vision_model_unavailable'||visual?.status==='vision-not-ready')
  return failed('vision-not-ready','preflight')
 if(['analyzed','cached','no_images_confirmed','preview_only','frames_ready'].includes(visual?.status))
  return failed('visual-read-unverified','evidence')
 return failed('visual-read-failed','read')
}
export function projectSharedVideoObservation(result,bvid){
 if(!BV.test(String(bvid||''))||result?.ok!==true||result.bvid!==bvid||result.videoEvidence?.bvid!==bvid||result.videoEvidence?.schema!=='life-video-evidence/v1'||result.perceptionHandoff?.bvid!==bvid||result.perceptionHandoff?.schema!=='life-video-perception-handoff/v1'||result.viewDepth!=='standard'||!Array.isArray(result.videoEvidence.sources))return {verified:false,reason:'video-read-unavailable'}
 const visual=verifyEpisodeVideoVisual({result,bvid,depth:'standard'}),speech=result.perceptionHandoff?.speech
 const kind=speech?.source==='official-subtitles'?'subtitle':speech?.source==='machine-asr'?'asr_transcript':''
 const failure=!visual?explainSharedVisual(result):null
 const partial=!visual&&result.visual?.status==='vision_incomplete'&&Array.isArray(result.perceptionHandoff?.video?.partialCellObservations)?
  result.perceptionHandoff.video.partialCellObservations.filter(x=>x?.status==='partial-model-generated-unverified'&&Number.isInteger(x.atMs)&&x.atMs>=0&&x.atMs<=43200000&&safe(x.description,100)).slice(0,3).map(x=>({atMs:x.atMs,description:safe(x.description,100)})):[]
 const speechOk=Boolean(kind&&result.videoEvidence.sources?.some(x=>x.kind===kind&&x.status==='verified')&&safe(speech?.textExcerpt,160))
 return {verified:Boolean(visual||speechOk),bvid,readOnly:true,fullPlayback:false,visualObserved:Boolean(visual),speechAvailable:speechOk,
  ...(visual?{visualEvidenceKind:result.visual.status==='cached'?'cached':'fresh',frameCount:visual.frameCount,visualSource:visual.source,visualDescription:safe(result.perceptionHandoff.video.modelDescription,380)}:{}),
  ...(speechOk?{speechSource:speech.source,speechExcerpt:safe(speech.textExcerpt,160)}:{}),
  ...(partial.length?{partialVisual:{status:'incomplete-model-observations',cells:partial,fullReceipt:false}}:{}),
  ...(failure?{visualFailure:failure}:{}),
  ...(!visual&&!speechOk?{reason:'no-perception-evidence'}:{})}
}

// A menu is not an instruction: expose only bounded references from the verified sender.
export function sharedLinkTurnRows({currentLinks=[],allowHistory=false,uid,recentForContact=()=>[],getLink=()=>null}={}){
 const sameSender=row=>row&&String(row.senderUid)===String(uid)
 if(currentLinks.length)return currentLinks.filter(sameSender)
 if(!allowHistory)return []
 return recentForContact().slice(0,2).map(row=>getLink(row.id)).filter(sameSender)
}
