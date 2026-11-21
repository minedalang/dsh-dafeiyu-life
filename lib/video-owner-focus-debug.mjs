/** Owner-only technical acceptance of one verified videoshot timestamp.
 * This is a pure resource/identity check, NOT Life willingness and NOT a
 * public platform write authorization. The caller additionally gates localhost,
 * account, job lifetime, and keeps the visual answer transient.
 */
import {planGlobalPreviewFocusCandidates} from './video-focus-review.mjs'
import {planFocusBatch} from './video-exploration-budget.mjs'

const BV=/^BV[A-Za-z0-9]{10}$/
export function verifiedOwnerFocusAnchors({bvid,overview}={}){
  if(!BV.test(String(bvid||'')) || overview?.bvid!==bvid || overview?.ok!==true ||
     !planGlobalPreviewFocusCandidates({bvid,overview}).length)return []
  const frame=overview.videoEvidence?.sources?.find(x=>x.kind==='preview_frames'&&x.status==='sampled')
  const visual=overview.videoEvidence?.sources?.find(x=>x.kind==='preview_visual_analysis'&&['analyzed','cached'].includes(x.status))
  const described=overview.perceptionHandoff?.video
  const duration=overview.info?.duration
  if(!frame||!visual||described?.source!=='low-resolution-preview'||
     !Number.isFinite(duration)||duration<5||duration>14400||
     !Array.isArray(frame.timePointsMs)||!Array.isArray(described.frameTimesMs)||
     frame.timePointsMs.length!==described.frameTimesMs.length||
     frame.timePointsMs.length<1||frame.timePointsMs.length>48)return []
  const ms=frame.timePointsMs
  if(ms.some((t,i)=>!Number.isSafeInteger(t)||t<0||t>duration*1000||
      t!==described.frameTimesMs[i]||(i>0&&t<=ms[i-1])))return []
  return ms.map(t=>t/1000)
}

export function planOwnerFocusDebugWindow({bvid,overview,atSeconds,durationSeconds,tier,globalNetworkBytes=0}={}){
  const anchors=verifiedOwnerFocusAnchors({bvid,overview})
  if(!anchors.length)return {ok:false,reason:'overview-not-verified'}
  if(typeof atSeconds!=='number'||!Number.isFinite(atSeconds)||
     !anchors.includes(atSeconds))return {ok:false,reason:'focus-anchor-not-verified',anchors}
  if(!Number.isSafeInteger(durationSeconds)||durationSeconds<5||durationSeconds>120)
    return {ok:false,reason:'invalid-focus-duration',anchors}
  if(!tier||!Number.isSafeInteger(tier.bytes)||!Number.isSafeInteger(tier.frames)||
     !Number.isSafeInteger(tier.seconds)||tier.frames<1||
     !Number.isSafeInteger(globalNetworkBytes)||globalNetworkBytes<0||
     globalNetworkBytes>=tier.bytes-1048576)
    return {ok:false,reason:'focus-network-budget-exhausted',anchors}
  const remainingBytes=tier.bytes-globalNetworkBytes
  const candidate={atSeconds,source:'verified-preview-sample'}
  const planned=planFocusBatch({targets:[{atSeconds,durationSeconds}],candidates:[candidate],
    tier,usage:{bytes:globalNetworkBytes},videoDurationSeconds:overview.info.duration})
  if(!planned.ok)return {ok:false,reason:planned.reason,anchors}
  return {ok:true,plan:{...planned.plans[0],status:'ready',
    networkBudgetBytes:remainingBytes},frameBudgetLimit:tier.frames,
    networkBudgetBytes:remainingBytes,anchors}
}
