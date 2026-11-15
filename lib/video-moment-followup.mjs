/**
 * Read-only, evidence-bound revisit plan. A question about an UNOBSERVED
 * video moment must trigger another read; never fill gaps by inference.
 * Description-only cues need an already verified, time-anchored observation.
 */
const BV=/^BV[A-Za-z0-9]{10}$/
const finite=n=>typeof n==='number'&&Number.isFinite(n)
const clean=x=>String(x||'').trim().slice(0,160)
export function planVideoMomentFollowup({bvid,atSeconds,afterSeconds=0,description='',priorObservations=[],durationSeconds}={}){
  if(!BV.test(String(bvid||''))||!finite(durationSeconds)||durationSeconds<3||durationSeconds>2700)
    return {ok:false,reason:'unverified-video-target'}
  let anchor=atSeconds,origin='explicit-time'
  if(!finite(anchor)){
    const phrase=clean(description)
    // Never mine arbitrary third-party instructions or a model's unrestricted
    // guess for a timestamp. Only match an actually observed cue, if provided.
    const rows=Array.isArray(priorObservations)?priorObservations.slice(0,50):[]
    const matches=rows.filter(row=>finite(row?.fromMs)&&finite(row?.toMs)&&row.fromMs>=0&&
      row.toMs>=row.fromMs&&row.toMs<=durationSeconds*1000&&
      phrase.length>=4&&clean(row.description).includes(phrase))
    if(matches.length!==1)return {ok:false,reason:'time-anchor-required',hint:'需明确时间或唯一的既有分镜证据锚点；不得凭弹幕推断事件时间'}
    anchor=matches[0].toMs/1000;origin='observed-event-anchor'
  }
  if(anchor<0||anchor>durationSeconds)return {ok:false,reason:'time-out-of-range'}
  const after=finite(afterSeconds)?Math.max(0,Math.min(60,afterSeconds)):0
  const center=Math.min(durationSeconds,anchor+after)
  const length=Math.min(12,durationSeconds)
  const start=Math.max(0,Math.min(durationSeconds-length,center-length/2))
  const end=start+length
  return {ok:true,status:'ready',origin,startSeconds:Math.round(start*100)/100,
    endSeconds:Math.round(end*100)/100,anchorSeconds:anchor}
}
