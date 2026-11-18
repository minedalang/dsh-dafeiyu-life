/** A genuine visual read, unlike metadata, requires BOTH decoded/preview samples
 * and the corresponding model observation. No model action, title or HTTP
 * metadata alone is a frame receipt. Pure validator for the Life planner. */
const BV=/^BV[0-9A-Za-z]{10}$/
const SOURCE=Object.freeze({'decoded-public-video':'decoded_visual_analysis',
  'low-resolution-preview':'preview_visual_analysis'})
export function verifyEpisodeVideoVisual({result,bvid,depth}={}){
  if(!BV.test(String(bvid||''))||!['standard','deep'].includes(depth)||
     result?.ok!==true||result.bvid!==bvid||result.viewDepth!==depth||
     result?.visual?.ok!==true||!['analyzed','cached'].includes(result.visual.status)||
     result.videoEvidence?.verifiedContent!==true)return null
  const video=result.perceptionHandoff?.video,source=video?.source
  const frameCount=Number(video?.frameCount),times=video?.frameTimesMs
  if(!SOURCE[source]||!Number.isSafeInteger(frameCount)||frameCount<1||frameCount>48||
     !Array.isArray(times)||times.length!==frameCount||
     !String(video.modelDescription||'').trim())return null
  const duration=Number(result.info?.duration)
  if(!Number.isFinite(duration)||duration<=0||duration>3*3600)return null
  let last=-1
  for(const at of times){if(!Number.isSafeInteger(at)||at<0||at>duration*1000||at<=last)return null;last=at}
  const proof=(result.videoEvidence.sources||[]).find(x=>x?.kind===SOURCE[source]&&
    ['cached','analyzed'].includes(x.status)&&Array.isArray(x.timePointsMs)&&
    x.timePointsMs.length===times.length&&x.timePointsMs.every((t,i)=>t===times[i]))
  if(!proof)return null
  return {ok:true,bvid,depth,frameCount,source,firstAtMs:times[0],lastAtMs:last}
}
