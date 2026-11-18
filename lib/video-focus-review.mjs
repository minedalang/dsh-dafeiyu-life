/**
 * One optional second look after a trusted overview, under a shared byte budget.
 * Only machine-detected motion/cuts supply focus locations. Model text can only
 * signal uncertainty, NEVER supply arbitrary URLs, commands, or new timestamps.
 */
const numeric=x=>typeof x==='number'&&Number.isFinite(x)
const BV=/^BV[A-Za-z0-9]{10}$/
const uncertain=/不清楚|看不清|无法辨认|不确定|可能|似乎|难以|细节|模糊|缺少|尚不能|未覆盖|难以确认|无法判断/i
export function planVideoFocusReview({bvid,depth,visual,evidence}={}){
  if(!BV.test(String(bvid||''))||depth!=='deep'||visual?.bvid!==bvid||
    !['analyzed','cached'].includes(visual?.status)||!uncertain.test(String(visual.description||'')))return null
  const source=evidence?.sources?.find(x=>x.kind==='decoded_video_frames')
  const analysis=evidence?.sources?.find(x=>x.kind==='decoded_visual_analysis')
  if(!source||!analysis||!Array.isArray(source.timePointsMs)||source.timePointsMs.length<3)return null
  const sampling=visual?.sampling||{}
  const duration=sampling.video_duration_seconds
  const used=sampling.input_bytes,budget=sampling.network_budget_bytes
  if(!numeric(duration)||duration<8||!Number.isInteger(used)||!Number.isInteger(budget)||used>budget)return null
  const remaining=budget-used
  if(remaining<1048576)return {status:'skipped',reason:'network-budget-exhausted',remainingBytes:Math.max(0,remaining)}
  // Scene cuts are preferred; strong motion is a secondary candidate. Verify
  // that the candidate lies in a genuinely sampled time window before selecting.
  const points=[...(sampling.scene_change_seconds||[]),...(sampling.motion_hotspots_seconds||[])]
  const sampled=Array.isArray(sampling.sampled_windows)?sampling.sampled_windows:[]
  const allowed=t=>numeric(t)&&t>0&&t<duration&&sampled.some(w=>numeric(w.startSeconds)&&numeric(w.endSeconds)&&t>=w.startSeconds&&t<=w.endSeconds)
  const candidate=points.find(allowed)
  if(candidate===undefined)return {status:'skipped',reason:'no-verified-focus-candidate',remainingBytes:remaining}
  const width=Math.min(12,duration),start=Math.max(0,Math.min(duration-width,candidate-width/2)),end=Math.min(duration,start+width)
  return {status:'ready',reason:'uncertain-overview-near-verified-change',
    startSeconds:Math.round(start*100)/100,endSeconds:Math.round(end*100)/100,
    networkBudgetBytes:Math.min(25165824,remaining),remainingBytes:remaining}
}

export function verifyVideoFocusReview({bvid,plan,result,evidence}={}){
  if(plan?.status!=='ready'||result?.bvid!==bvid||result?.ok!==true||
    !['analyzed','cached'].includes(result.status)||!String(result.description||'').trim()||
    result.image_source!=='B站公开视频片段（离线解码）'||
    !numeric(result.focus_window?.startSeconds)||!numeric(result.focus_window?.endSeconds)||
    Math.abs(result.focus_window.startSeconds-plan.startSeconds)>0.02||
    Math.abs(result.focus_window.endSeconds-plan.endSeconds)>0.02||
    !evidence?.sources?.some(x=>x.kind==='decoded_video_frames')||
    !evidence?.sources?.some(x=>x.kind==='decoded_visual_analysis'))return null
  const s=result.sampling||{}
  if(!Number.isInteger(s.input_bytes)||s.input_bytes>plan.networkBudgetBytes||
    s.network_budget_bytes>plan.networkBudgetBytes||s.network_budget_bytes<1048576)return null
  const times=evidence.sources.find(x=>x.kind==='decoded_video_frames').timePointsMs
  if(!Array.isArray(times)||times.length<1||times.some(t=>t<plan.startSeconds*1000-300||t>plan.endSeconds*1000+300))return null
  return {startMs:Math.round(plan.startSeconds*1000),endMs:Math.round(plan.endSeconds*1000),
    frameTimesMs:times.slice(0,12),description:String(result.description).slice(0,2800),
    source:'decoded-public-video-focus',pixelSize:Array.isArray(s.frame_pixel_size)?s.frame_pixel_size.slice(0,2):null,
    inputBytes:s.input_bytes,reviewStatus:'model-observation-not-independent-semantic-proof'}
}
