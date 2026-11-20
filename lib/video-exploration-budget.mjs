/** Bounded per-video, per-Episode autonomous focus exploration policy.
 * This is a host-side resource limit, not a willingness policy or new scheduler.
 */
export const VIDEO_EXPLORATION_TIERS=Object.freeze({
  12:Object.freeze({candidates:4,perBatch:2,windows:2,frames:12,seconds:30,bytes:24*1048576,batches:2}),
  24:Object.freeze({candidates:6,perBatch:3,windows:4,frames:24,seconds:90,bytes:50*1048576,batches:3}),
  48:Object.freeze({candidates:8,perBatch:4,windows:6,frames:48,seconds:180,bytes:100*1048576,batches:4})
})
export const videoExplorationTier=frames=>VIDEO_EXPLORATION_TIERS[[12,24,48].includes(Number(frames))?Number(frames):24]
const safeInt=x=>Number.isSafeInteger(x)&&x>=0
export function remainingExplorationBudget(tier,usage={}) {
  return {
    windows:Math.max(0,tier.windows-(safeInt(usage.windows)?usage.windows:0)),
    frames:Math.max(0,tier.frames-(safeInt(usage.frames)?usage.frames:0)),
    seconds:Math.max(0,tier.seconds-(safeInt(usage.seconds)?usage.seconds:0)),
    bytes:Math.max(0,tier.bytes-(safeInt(usage.bytes)?usage.bytes:0)),
    batches:Math.max(0,tier.batches-(safeInt(usage.batches)?usage.batches:0))
  }
}
/** A model may choose only independently verified anchor timestamps. No URLs
 * or arbitrary timestamp may be substituted. Adjacent selected anchors can
 * overlap but overlapping windows never acquire additional resource rights.
 */
export function planFocusBatch({targets,candidates,tier,usage={},videoDurationSeconds,history=[]}={}) {
  const remaining=remainingExplorationBudget(tier,usage)
  if(!Array.isArray(targets)||targets.length===0||targets.length>tier.perBatch||
    remaining.batches<1||remaining.frames<1||remaining.bytes<1048576)
    return {ok:false,reason:'focus-batch-budget-or-size'}
  if(!Array.isArray(candidates)||!Number.isFinite(videoDurationSeconds)||videoDurationSeconds<5||videoDurationSeconds>14400)
    return {ok:false,reason:'focus-overview-unavailable'}
  const plans=[],seen=new Set()
  for(const row of targets){
    if(!row||typeof row!=='object'||Object.keys(row).some(k=>!['atSeconds','durationSeconds'].includes(k))||
      typeof row.atSeconds!=='number'||!Number.isFinite(row.atSeconds)||
      !Number.isSafeInteger(row.durationSeconds)||row.durationSeconds<5||row.durationSeconds>120)
      return {ok:false,reason:'invalid-focus-target'}
    const candidate=candidates.find(x=>x.atSeconds===row.atSeconds)
    if(!candidate||seen.has(row.atSeconds))return {ok:false,reason:'focus-target-unverified-or-duplicate'}
    seen.add(row.atSeconds)
    const width=Math.min(row.durationSeconds,Math.floor(videoDurationSeconds))
    if(width<5)return {ok:false,reason:'window-too-short'}
    const start=Math.max(0,Math.min(videoDurationSeconds-width,row.atSeconds-width/2))
    const roundedStart=Math.round(start*100)/100,end=Math.round((start+width)*100)/100
    if(!Number.isFinite(start)||end>videoDurationSeconds+.01||end>43200)return {ok:false,reason:'focus-window-out-of-range'}
    if(history.some(x=>x.atSeconds===row.atSeconds&&x.durationSeconds===row.durationSeconds))
      return {ok:false,reason:'focus-window-already-reviewed'}
    plans.push({...candidate,startSeconds:roundedStart,endSeconds:end,
      requestedDurationSeconds:row.durationSeconds,anchors:[{atSeconds:row.atSeconds,durationSeconds:row.durationSeconds}]})
  }
  // Merge overlaps only when their combined real window is <=120s; count
  // merged media once while retaining both verified interests in provenance.
  plans.sort((a,b)=>a.startSeconds-b.startSeconds)
  const merged=[]
  for(const plan of plans) {
    const last=merged.at(-1)
    if(last&&plan.startSeconds<=last.endSeconds+.01&&
       Math.max(last.endSeconds,plan.endSeconds)-last.startSeconds<=120){
      last.endSeconds=Math.max(last.endSeconds,plan.endSeconds)
      last.anchors.push(...plan.anchors)
    }else merged.push(plan)
  }
  if(merged.length>remaining.windows)return {ok:false,reason:'focus-windows-budget-exhausted'}
  const totalDuration=merged.reduce((sum,p)=>sum+p.endSeconds-p.startSeconds,0)
  if(totalDuration>remaining.seconds+.02)return {ok:false,reason:'focus-time-budget-exhausted'}
  return {ok:true,plans:merged,remaining,totalDuration:Math.round(totalDuration*100)/100}
}
