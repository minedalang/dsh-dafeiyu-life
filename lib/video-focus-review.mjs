/**
 * Suggest ONE bounded, verified focus candidate after a trusted overview.
 * This is never permission to read more frames. Only Life may choose a later
 * revisit through the existing willingness/receipt and account gates.
 * Machine-detected changes only supply time candidates; model text only
 * signals uncertainty, never supplies URLs, commands or invented timestamps.
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

/**
 * Only timestamps belonging to an independently verified, account-scoped
 * videoshot OVERVIEW may be offered as candidate real-video focus windows.
 * Image-model prose is untrusted and never an executable timestamp/URL.
 */
export function planGlobalPreviewFocusCandidates({bvid,overview,maxCandidates=4}={}){
  const video=overview?.perceptionHandoff?.video
  const visual=overview?.visual
  const evidence=overview?.videoEvidence
  const info=overview?.info
  if(!BV.test(String(bvid||''))||overview?.ok!==true||overview.bvid!==bvid||
     video?.source!=='low-resolution-preview'||visual?.ok!==true||visual.bvid!==bvid||
     evidence?.bvid!==bvid||(info?.bvid&&info.bvid!==bvid)||
     !['analyzed','cached'].includes(visual.status)||!String(video.modelDescription||'').trim()||
     !evidence?.sources?.some(x=>x.kind==='preview_frames'&&x.status==='sampled')||
     !evidence?.sources?.some(x=>x.kind==='preview_visual_analysis'&&['analyzed','cached'].includes(x.status)))return []
  const duration=Number(info?.duration)
  if(!numeric(duration)||duration<8||duration>2700)return []
  const provenance=evidence.sources.find(x=>x.kind==='preview_frames')
  if(!Array.isArray(provenance?.timePointsMs)||
     !Array.isArray(video.frameTimesMs)||
     provenance.timePointsMs.length!==video.frameTimesMs.length||
     provenance.timePointsMs.some((ms,i)=>ms!==video.frameTimesMs[i])||
     provenance.timePointsMs.some(ms=>!Number.isSafeInteger(ms)||ms>duration*1000))return []
  const verified=Array.isArray(video.frameTimesMs)?video.frameTimesMs.filter(t=>
    Number.isSafeInteger(t)&&t>=0&&t<=duration*1000).map(t=>t/1000):[]
  if(!verified.length||verified.length!==video.frameTimesMs.length)return []
  // Python's local pixel-change signals are hints, NOT semantic relevance.
  // Bind every hint back to a time actually present in the verified overview.
  const hints=Array.isArray(visual?.sampling?.review_candidate_hints)
    ?visual.sampling.review_candidate_hints.filter(h=>h&&h.source==='python-videoshot-neighbor-diff'&&
      numeric(h.second)&&numeric(h.pixel_change)&&h.pixel_change>=0&&h.pixel_change<=1&&
      verified.some(t=>Math.abs(t-h.second)<.11)).slice(0,4):[]
  const requested=Array.isArray(visual?.sampling?.review_candidates_seconds)
    ?visual.sampling.review_candidates_seconds.filter(numeric):[]
  const requestedVerified=requested.filter(t=>verified.some(v=>Math.abs(t-v)<.11))
  const pool=hints.length?hints.map(h=>h.second):requestedVerified.length?requestedVerified:verified
  const count=Math.min(4,Math.max(1,Math.floor(maxCandidates)||4),pool.length)
  const anchors=[]
  for(let j=0;j<count;j++){
    const t=pool[Math.min(pool.length-1,Math.floor((j+.5)*pool.length/count))]
    if(anchors.some(x=>Math.abs(x.atSeconds-t)<1))continue
    const width=Math.min(15,duration),start=Math.max(0,Math.min(duration-width,t-width/2))
    const hint=hints.find(h=>Math.abs(h.second-t)<.11)
    anchors.push({atSeconds:t,startSeconds:Math.round(start*100)/100,
      endSeconds:Math.round((start+width)*100)/100,source:'verified-preview-sample',
      ...(hint?{pixelChange:hint.pixel_change,selectionBasis:'python-pixel-change-and-timeline'}:
        {selectionBasis:'verified-preview-timeline'})})
  }
  // Nearby captions are only trusted where the existing evidence bundle has
  // verified this same BV's subtitle / ASR origin and explicit time spans.
  const speech=overview.perceptionHandoff?.speech
  const kind=speech?.source==='official-subtitles'?'subtitle':speech?.source==='machine-asr'?'asr_transcript':null
  const speechVerified=kind&&evidence.sources.some(x=>x.kind===kind&&x.status==='verified')
  const segments=speechVerified&&Array.isArray(speech.segments)?speech.segments:[]
  const clean=x=>String(x||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,110)
  // A model sentence may help Life understand a candidate ONLY if it carries
  // a timestamp independently present in the verified sampled-frame receipt.
  // This is still a *model hypothesis*, never proof of that event or authority
  // to add a new focus timestamp. Discard unrelated/hallucinated timecodes.
  const modelLines=String(video.modelDescription||'').split(/\r?\n/).slice(0,90)
  const annotated=[]
  for(const line of modelLines){
    const m=/^\s*(?:[-*•]\s*)?\[?(\d{1,2}):([0-5]\d)\]?\s*[-:：、.]?\s*(.+)$/.exec(line)
    if(!m)continue
    const seconds=Number(m[1])*60+Number(m[2])
    if(!verified.some(t=>Math.abs(t-seconds)<=1.1))continue
    const description=clean(m[3])
    if(description.length>=4)annotated.push({seconds,description})
  }
  return anchors.map(anchor=>{
    const nearby=segments.filter(s=>Number.isSafeInteger(s?.startMs)&&Number.isSafeInteger(s?.endMs)&&
      s.endMs>=anchor.startSeconds*1000&&s.startMs<=anchor.endSeconds*1000&&
      typeof s.text==='string'&&s.text.trim())
      .sort((a,b)=>Math.abs((a.startMs+a.endMs)/2-anchor.atSeconds*1000)-
        Math.abs((b.startMs+b.endMs)/2-anchor.atSeconds*1000))[0]
    const visualCue=annotated.find(x=>Math.abs(x.seconds-anchor.atSeconds)<=1.1)
    return {...anchor,
      ...(nearby?{nearbySpeech:clean(nearby.text),speechSource:speech.source}:{}),
      ...(visualCue?{visualCue:visualCue.description,visualCueSource:'unverified-visual-model-at-verified-time'}:{}),
      scanCoverage:visual.sampling?.timeline_scan_complete===true?'scanned-under-limits':'partial-or-unknown',
      visualCertainty:'low-res-sampled-frame-not-verified-local-event'}
  })
}
