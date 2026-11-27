import {verifyEpisodeVideoVisual} from './life-episode-video-visual.mjs'
const BV=/^BV[0-9A-Za-z]{10}$/
export function sharedVideoTargetAllowed({row,uid,role,scope,currentScope,enabled,permitted,offered}={}){
 return enabled===true&&permitted===true&&offered===true&&['owner','friend'].includes(role)&&
  /^[a-f0-9]{16}$/.test(String(scope||''))&&scope===currentScope&&String(row?.senderUid||'')===String(uid||'')&&
  row?.status==='inspected'&&row.resolvedKind==='video'&&row.evidenceLevel==='video-metadata-only'&&BV.test(String(row.bvid||''))
}
const safe=(v,n)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,n):''
export function projectSharedVideoObservation(result,bvid){
 if(!BV.test(String(bvid||''))||result?.ok!==true||result.bvid!==bvid||result.videoEvidence?.bvid!==bvid||result.videoEvidence?.schema!=='life-video-evidence/v1'||result.perceptionHandoff?.bvid!==bvid||result.perceptionHandoff?.schema!=='life-video-perception-handoff/v1'||result.viewDepth!=='standard'||!Array.isArray(result.videoEvidence.sources))return {verified:false,reason:'video-read-unavailable'}
 const visual=verifyEpisodeVideoVisual({result,bvid,depth:'standard'}),speech=result.perceptionHandoff?.speech
 const kind=speech?.source==='official-subtitles'?'subtitle':speech?.source==='machine-asr'?'asr_transcript':''
 const speechOk=Boolean(kind&&result.videoEvidence.sources?.some(x=>x.kind===kind&&x.status==='verified')&&safe(speech?.textExcerpt,160))
 return {verified:Boolean(visual||speechOk),bvid,readOnly:true,fullPlayback:false,visualObserved:Boolean(visual),speechAvailable:speechOk,
  ...(visual?{frameCount:visual.frameCount,visualSource:visual.source,visualDescription:safe(result.perceptionHandoff.video.modelDescription,380)}:{}),
  ...(speechOk?{speechSource:speech.source,speechExcerpt:safe(speech.textExcerpt,160)}:{}),
  ...(!visual&&!speechOk?{reason:'no-perception-evidence'}:{})}
}
