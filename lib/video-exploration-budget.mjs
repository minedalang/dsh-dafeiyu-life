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
// A shifted duration/anchor is not new evidence if its time window was already
// verified. A minimum of two fresh seconds prevents sub-second boundary tricks.
export const MIN_NEW_FOCUS_SECONDS=2
function verifiedHistoryIntervals(history,videoDurationSeconds){
  if(!Array.isArray(history))return []
  const intervals=[]
  for(const row of history.slice(-96)){
    if(!row||typeof row!=='object')continue
    let start=NaN,end=NaN
    if(safeInt(row.startMs)&&safeInt(row.endMs)&&row.endMs>row.startMs){
      start=row.startMs/1000;end=row.endMs/1000
    }else if(Number.isFinite(row.startSeconds)&&Number.isFinite(row.endSeconds)){
      start=row.startSeconds;end=row.endSeconds
    }else if(Number.isFinite(row.atSeconds)&&Number.isSafeInteger(row.durationSeconds)&&
      row.durationSeconds>=5&&row.durationSeconds<=120){
      const width=Math.min(row.durationSeconds,Math.floor(videoDurationSeconds))
      start=Math.max(0,Math.min(videoDurationSeconds-width,row.atSeconds-width/2))
      end=start+width
    }
    if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&
      end<=videoDurationSeconds+.01&&end-start<=120.01)intervals.push([start,end])
  }
  return intervals.sort((a,b)=>a[0]-b[0])
}
/** How many seconds in [start,end] are NOT covered by prior verified focus.
 * Only trusted successful Episode receipts are supplied as history. A cache,
 * failed window, guessed model timestamp or old archive is not coverage.
 */
export function uncoveredFocusSeconds(start,end,history=[],videoDurationSeconds=14400){
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||
    !Number.isFinite(videoDurationSeconds)||videoDurationSeconds<5)return 0
  let uncovered=0,cursor=start
  for(const [a,b] of verifiedHistoryIntervals(history,videoDurationSeconds)){
    if(b<=cursor)continue
    if(a>=end)break
    if(a>cursor)uncovered+=Math.min(a,end)-cursor
    cursor=Math.max(cursor,Math.min(end,b))
    if(cursor>=end)break
  }
  return Math.round((uncovered+Math.max(0,end-cursor))*100)/100
}
/** A new planned interval is only a candidate for fresh evidence. After a
 * real decode, at least one verified frame timestamp must actually lie outside
 * the previously verified windows, or the read cannot count as novel.
 */
export function hasNewFocusFrameSample(frameTimesMs,history=[],videoDurationSeconds=14400){
  if(!Array.isArray(frameTimesMs)||!Number.isFinite(videoDurationSeconds)||
    videoDurationSeconds<5)return false
  const intervals=verifiedHistoryIntervals(history,videoDurationSeconds)
  return frameTimesMs.some(ms=>Number.isSafeInteger(ms)&&ms>=0&&
    ms<=videoDurationSeconds*1000+10&&
    !intervals.some(([a,b])=>ms>=a*1000-10&&ms<=b*1000+10))
}
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
  // Check actual merged media windows, not merely the requested time anchor.
  // A shorter entirely-contained window must never pass as a new discovery.
  if(merged.some(p=>uncoveredFocusSeconds(p.startSeconds,p.endSeconds,history,
    videoDurationSeconds)<MIN_NEW_FOCUS_SECONDS-.01))
    return {ok:false,reason:'focus-window-already-reviewed'}
  if(merged.length>remaining.windows)return {ok:false,reason:'focus-windows-budget-exhausted'}
  const totalDuration=merged.reduce((sum,p)=>sum+p.endSeconds-p.startSeconds,0)
  if(totalDuration>remaining.seconds+.02)return {ok:false,reason:'focus-time-budget-exhausted'}
  return {ok:true,plans:merged,remaining,totalDuration:Math.round(totalDuration*100)/100}
}
