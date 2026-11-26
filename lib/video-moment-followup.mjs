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
 return {tool:'bili_video_revisit_moment',args:{bvid,at_seconds:(startMs+endMs)/2000,recall_memory_id:parent.memoryId,recall_start_ms:startMs,recall_end_ms:endMs},kind:'optional-current-observation',note:'如果本轮真正需要了解现在的视频画面，可考虑一次补看；也可以如实说明不知道、询问或延期。新观察不能回答当时实际看到了什么；不自动联网。'}
}

/** Resolve an exact phrase from complete, currently accessible PUBLIC detail.
 * A partial page cannot establish uniqueness. Never turn summary, archive,
 * private history, or an untrusted model timestamp into an anchor. */
export function resolveLiveVideoCue({result,bvid,description}={}){
 const phrase=clean(description)
 if(!BV.test(String(bvid||''))||phrase.length<4||result?.ok!==true||result.bvid!==bvid||
    result.hasMore!==false||result.truncated===true||result.partialSources===true||result.missingSources!==0||
    !Array.isArray(result.fragments)||result.fragments.length!==result.totalFragments)return null
 if(result.fragments.some(part=>part?.visibility!=='public-event'||part.certainty!=='model-observation'||
    typeof part.content!=='string'||part.contentComplete===false))return null
 const matches=result.fragments.filter(part=>part.content.includes(phrase))
 if(matches.length!==1)return null
 const part=matches[0]
 if(!/^e-[a-f0-9]{18}$/.test(String(part.memoryId||''))||!Array.isArray(part.timeAnchorMs)||part.timeAnchorMs.length!==2||
    !part.timeAnchorMs.every(Number.isSafeInteger)||part.timeAnchorMs[0]<0||part.timeAnchorMs[1]<part.timeAnchorMs[0]||
    part.timeAnchorMs[1]>14400000||part.timeAnchorMs[1]-part.timeAnchorMs[0]>12000)return null
 return {fromMs:part.timeAnchorMs[0],toMs:part.timeAnchorMs[1],description:phrase,
   // Internal equality proof only, never sent to a model or persisted.
   proof:JSON.stringify([part.memoryId,part.sourceRef,part.fragmentId,part.observedAt,part.timeAnchorMs,part.content])}
}

/** A recall-derived request must retain the exact originally requested gap.
 * Other current public observations can already answer it. Re-prove the gap
 * across the group before spending resources; no time shifts or old cursors. */
export function validateVideoRecallGap({bvid,memoryId,startMs,endMs,atSeconds,afterSeconds,eventCue,trace,result}={}){
 if(!/^e-[a-f0-9]{18}$/.test(String(memoryId||''))||eventCue||
    (afterSeconds!==undefined&&afterSeconds!==0)||!finite(atSeconds)||atSeconds!==(startMs+endMs)/2000)return false
 const candidate=proposeVideoRecallFollowup({result,bvid,startMs,endMs,trace})
 return candidate?.args.recall_memory_id===memoryId
}

/** A private-chat numeric range must include an actual time named by the
 * current incoming message. A relative event needs the live cue path instead.
 * This recognizes time notation, not intent; the model still decides to read. */
export function hasExplicitVideoTime(text,startMs,endMs){
 const source=String(text||'').slice(0,1600),anchors=[]
 for(const m of source.matchAll(/(?:第|在|从|到|时间[点码]?[：:\s]*)(\d{1,3})\s*(?:分(?:钟)?\s*(\d{1,2})?\s*秒?|秒)/g)){
  const minute=/分/.test(m[0]);if(minute&&Number(m[2]||0)>=60)continue
  anchors.push((minute?Number(m[1])*60+Number(m[2]||0):Number(m[1]))*1000)
 }
 for(const m of source.matchAll(/(?:^|[^\d:：])(\d{1,2})[:：]([0-5]\d)(?:[:：]([0-5]\d))?(?![\d:：])/g))
  anchors.push((m[3]===undefined?Number(m[1])*60+Number(m[2]):Number(m[1])*3600+Number(m[2])*60+Number(m[3]))*1000)
 return anchors.some(ms=>ms>=startMs&&ms<=endMs)
}

/** Turn-local cross-channel continuation. All callbacks are trusted host adapters;
 * the model can choose only an actually delivered public BV and bounded time.
 * No durable task, send, retry or archive access is created here. */
export async function runContextualVideoRevisit({request,offeredBvids=[],isCurrent,readDetails,readTrace,execute,allowRange=()=>false}={}){
 const current=()=>{try{return isCurrent?.()===true}catch{return false}}
 const fail=reason=>({evidence:{ok:false,reason},validate:current})
 if(!current())return fail('video-revisit-scope-changed')
 if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['bvid','startMs','endMs','eventCue','afterSeconds'].includes(k)))return fail('invalid-revisit-request')
 const bvid=request.bvid
 if(!BV.test(String(bvid||''))||!offeredBvids.includes(bvid))return fail('video-revisit-not-offered')
 let startMs=request.startMs,endMs=request.endMs,cue=null
 try{
  if(request.eventCue!==undefined){
   if(typeof request.eventCue!=='string'||startMs!==undefined||endMs!==undefined||!Number.isSafeInteger(request.afterSeconds)||request.afterSeconds<1||request.afterSeconds>60)return fail('time-anchor-required')
   cue=resolveLiveVideoCue({bvid,description:request.eventCue,result:readDetails({bvid})})
   if(!cue)return fail('time-anchor-required')
   startMs=endMs=cue.toMs+request.afterSeconds*1000
  }else if(request.afterSeconds!==undefined)return fail('invalid-detail-time-range')
  if(!Number.isSafeInteger(startMs)||!Number.isSafeInteger(endMs)||startMs<0||endMs<startMs||endMs>14400000||endMs-startMs>12000)return fail('invalid-detail-time-range')
  if(!cue&&allowRange({bvid,startMs,endMs})!==true)return fail('time-anchor-required')
  const selector={bvid,startMs,endMs},result=readDetails(selector)
  if(!current())return fail('video-revisit-scope-changed')
  if(result?.ok===true){
   const fragments=(result.fragments||[]).slice(0,8).filter(p=>p.visibility==='public-event'&&p.certainty==='model-observation').map(p=>({timeAnchorMs:p.timeAnchorMs,observedAt:p.observedAt,description:String(p.content||'').slice(0,240),contentComplete:p.contentComplete!==false&&String(p.content||'').length<=240}))
   const snapshot=JSON.stringify(result.fragments),validate=()=>{try{return current()&&JSON.stringify(readDetails(selector)?.fragments)===snapshot&&(!cue||resolveLiveVideoCue({bvid,description:request.eventCue,result:readDetails({bvid})})?.proof===cue.proof)}catch{return false}}
   if(!fragments.length||!validate())return fail('video-recall-evidence-changed')
   return {evidence:{ok:true,bvid,status:'existing-historical-observations',fragments,partial:fragments.some(p=>!p.contentComplete)||result.hasMore===true||result.partialSources===true||result.missingSources>0||fragments.length!==result.totalFragments,limits:['historical-model-observation-not-current-fact','sampled-only']},validate}
  }
  const candidate=proposeVideoRecallFollowup({result,bvid,startMs,endMs,trace:readTrace({bvid})})
  if(!candidate)return fail(result?.reason||'recall-source-unavailable')
  const parentId=candidate.args.recall_memory_id
  const parentSnapshot=JSON.stringify(readTrace({bvid,memoryId:parentId}).find(p=>p.memoryId===parentId)||null)
  const parentCurrent=()=>{try{return current()&&parentSnapshot!=='null'&&JSON.stringify(readTrace({bvid,memoryId:parentId}).find(p=>p.memoryId===parentId)||null)===parentSnapshot}catch{return false}}
  const beforeRead=()=>parentCurrent()&&(!cue||resolveLiveVideoCue({bvid,description:request.eventCue,result:readDetails({bvid})})?.proof===cue.proof)
  if(!beforeRead())return fail('video-recall-evidence-changed')
  const observed=await execute(candidate.args,beforeRead,parentCurrent)
  if(!parentCurrent())return fail('video-recall-evidence-changed')
  if(observed?.ok!==true)return fail(observed?.readStatus||observed?.reason||'video-revisit-unavailable')
  const review=observed.review
  if(!review||!['observed-new-window','reused-cached-window'].includes(observed.status)||observed.bvid!==bvid)return fail('focus-receipt-unverified')
  // Check the new memory itself if it was durably admitted. If forgotten during
  // the continuation, no stale result can become a reply or planner action.
  const id=observed.deepMemory?.status==='updated'?observed.deepMemory.memoryId:null
  const detailSnapshot=id?JSON.stringify(readDetails({bvid,memoryId:id})?.fragments||[]):null
  const validate=()=>{try{return parentCurrent()&&(!id||(detailSnapshot!=='[]'&&readTrace({bvid,memoryId:id}).some(p=>p.memoryId===id&&p.visibility==='public-event'&&p.visual)&&JSON.stringify(readDetails({bvid,memoryId:id})?.fragments||[])===detailSnapshot))}catch{return false}}
  if(!validate())return fail('video-recall-evidence-changed')
  return {evidence:{ok:true,bvid,status:observed.status,windowMs:[review.startMs,review.endMs],frameTimesMs:review.frameTimesMs,description:String(review.description||'').slice(0,900),memoryState:observed.deepMemory?.status||'not-recorded',limits:['current-sampled-model-observation-not-past-recall','not-full-video-playback','no-audio-perception']},validate}
 }catch{return fail('video-revisit-unavailable')}
}
