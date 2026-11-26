/**
 * Read-only, evidence-bound revisit plan. A question about an UNOBSERVED
 * video moment must trigger another read; never fill gaps by inference.
 * Description-only cues need an already verified, time-anchored observation.
 */
const BV=/^BV[A-Za-z0-9]{10}$/
const finite=n=>typeof n==='number'&&Number.isFinite(n)
const clean=x=>String(x||'').trim().slice(0,160)
export function planVideoMomentFollowup({bvid,atSeconds,afterSeconds=0,description='',priorObservations=[],durationSeconds}={}){
  if(!BV.test(String(bvid||''))||!finite(durationSeconds)||durationSeconds<3||durationSeconds>14400)
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

/** A local, read-only suggestion for an explicitly requested current moment.
 * No missing historical fact is fabricated; new observation is not past recall.
 * Caller rechecks the public live memory before exposing a candidate. */
export function proposeVideoRecallFollowup({result,bvid,startMs,endMs,firstObservation=false,cursor='',trace=[]}={}){
 if(!BV.test(String(bvid||''))||firstObservation||cursor||result?.ok!==false||
    !['no-detail','no-detail-in-time-range'].includes(result.reason)||
    !Number.isSafeInteger(startMs)||!Number.isSafeInteger(endMs)||startMs<0||endMs<startMs||endMs>14400000||endMs-startMs>12000)return null
 const parent=Array.isArray(trace)&&trace.find(x=>x?.bvid===bvid&&x.visibility==='public-event'&&/^e-[a-f0-9]{18}$/.test(x.memoryId)&&x.visual&&x.sources?.includes('visual-model-observation'))
 if(!parent)return null
 return {tool:'bili_video_revisit_moment',args:{bvid,at_seconds:(startMs+endMs)/2000,recall_memory_id:parent.memoryId},kind:'optional-current-observation',note:'如果本轮真正需要了解现在的视频画面，可考虑一次补看；也可以如实说明不知道、询问或延期。新观察不能回答当时实际看到了什么；不自动联网。'}
}
