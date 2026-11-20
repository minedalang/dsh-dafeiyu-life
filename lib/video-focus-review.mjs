/**
 * Suggest bounded, verified focus windows after a trusted overview.
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
  if(!Array.isArray(times)||times.length<1||times.length>48||times.some(t=>t<plan.startSeconds*1000-300||t>plan.endSeconds*1000+300))return null
  return {startMs:Math.round(plan.startSeconds*1000),endMs:Math.round(plan.endSeconds*1000),
    frameTimesMs:times.slice(0,48),frameCount:times.length,description:String(result.description).slice(0,2800),
    source:'decoded-public-video-focus',pixelSize:Array.isArray(s.frame_pixel_size)?s.frame_pixel_size.slice(0,2):null,
    inputBytes:s.input_bytes,reviewStatus:'model-observation-not-independent-semantic-proof'}
}

/**
 * Only timestamps belonging to an independently verified, account-scoped
 * videoshot OVERVIEW may be offered as candidate real-video focus windows.
 * Image-model prose is untrusted and never an executable timestamp/URL.
 */
export function planGlobalPreviewFocusCandidates({bvid,overview,maxCandidates=8}={}){
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
  if(!numeric(duration)||duration<8||duration>14400)return []
  const provenance=evidence.sources.find(x=>x.kind==='preview_frames')
  if(!Array.isArray(provenance?.timePointsMs)||
     !Array.isArray(video.frameTimesMs)||
     provenance.timePointsMs.length!==video.frameTimesMs.length||
     provenance.timePointsMs.some((ms,i)=>ms!==video.frameTimesMs[i])||
     provenance.timePointsMs.some(ms=>!Number.isSafeInteger(ms)||ms>duration*1000))return []
  const verified=Array.isArray(video.frameTimesMs)?video.frameTimesMs.filter(t=>
    Number.isSafeInteger(t)&&t>=0&&t<=duration*1000).map(t=>t/1000):[]
  if(!verified.length||verified.length!==video.frameTimesMs.length)return []
  // Python hints / optional PBP heat and model suggestions are all *ranking*
  // signals; only the verified, already observed frame timestamps may create
  // executable focus candidates. An image-model recommendation is never proof
  // of an event and cannot introduce any new time, URL or retrieval target.
  const hints=Array.isArray(visual?.sampling?.review_candidate_hints)
    ?visual.sampling.review_candidate_hints.filter(h=>h&&h.source==='python-videoshot-neighbor-diff'&&
      numeric(h.second)&&numeric(h.pixel_change)&&h.pixel_change>=0&&h.pixel_change<=1&&
      verified.some(t=>Math.abs(t-h.second)<.11)).slice(0,4):[]
  const changes=Array.isArray(visual?.sampling?.frame_change_hints)
    ?visual.sampling.frame_change_hints.filter(h=>h&&h.source==='python-videoshot-neighbor-diff'&&
      numeric(h.second)&&numeric(h.pixel_change)&&h.pixel_change>=0&&h.pixel_change<=1&&
      verified.some(t=>Math.abs(t-h.second)<.11)).slice(0,48):[]
  const heatSource=visual?.sampling?.heat_source==='bili-pbp-heat-curve'?'bili-pbp-heat-curve':null
  const heat=heatSource&&Array.isArray(visual?.sampling?.heat_hints)
    ?visual.sampling.heat_hints.filter(h=>h&&numeric(h.second)&&numeric(h.heat)&&
      h.heat>=0&&h.heat<=1&&verified.some(t=>Math.abs(t-h.second)<.11)).slice(0,48):[]
  const clean=x=>String(x||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,110)
  const modelLines=String(video.modelDescription||'').split(/\r?\n/).slice(0,110)
  const annotated=[],recommended=[]
  for(const line of modelLines){
    const rec=/^\s*(?:[-*•]\s*)?复查候选\s*[:：]\s*\[(\d{1,3}):([0-5]\d)\]\s*(.{4,})$/.exec(line)
    const timed=rec||/^\s*(?:[-*•]\s*)?\[?(\d{1,3}):([0-5]\d)\]?\s*[-:：、.]?\s*(.{4,})$/.exec(line)
    if(!timed)continue
    const seconds=Number(timed[1])*60+Number(timed[2])
    const actual=verified.find(t=>Math.abs(t-seconds)<=1.1)
    if(actual===undefined)continue
    const description=clean(timed[3])
    if(description.length<4)continue
    annotated.push({seconds:actual,description})
    if(rec&&!recommended.some(x=>Math.abs(x.seconds-actual)<.11))
      recommended.push({seconds:actual,description})
  }
  const match=(rows,t)=>rows.find(x=>Math.abs(x.second-t)<.11)
  const recAt=t=>recommended.find(x=>Math.abs(x.seconds-t)<.11)
  const metrics=t=>({change:match(changes,t)?.pixel_change??match(hints,t)?.pixel_change??0,
    crowd:match(heat||[],t)?.heat??0})
  const legacy=Array.isArray(visual?.sampling?.review_candidates_seconds)
    ?visual.sampling.review_candidates_seconds.filter(numeric).filter(t=>
        verified.some(v=>Math.abs(v-t)<.11)).slice(0,4):[]
  // Life should see the model's distinct, verified-time semantic proposals,
  // not a preselected top four chosen by a technical ranker. Do not pad
  // a small semantic set with arbitrary timestamps. If the model gives no
  // usable proposals, offer at most four explicitly *technical* fallback
  // windows so Life can still decline, choose, or wait without fake semantics.
  const proposals=recommended.map(x=>x.seconds)
  const heatOrder=(heat||[]).filter(x=>x.heat>0).sort((a,b)=>b.heat-a.heat).map(x=>x.second)
  const technical=(hints.length?hints.map(x=>x.second):legacy.length?legacy:verified)
  const changeOrder=verified.slice().sort((a,b)=>metrics(b).change-metrics(a).change)
  const prioritized=proposals.length?proposals:[...heatOrder,...technical,...changeOrder,...verified]
  const max=proposals.length
    ?Math.min(8,Math.max(1,Math.floor(maxCandidates)||8))
    :Math.min(4,Math.max(1,Math.floor(maxCandidates)||4))
  const anchors=[],minGap=Math.min(15,Math.max(3,duration/80))
  for(const raw of prioritized){
    if(anchors.length>=max)break
    const t=verified.find(x=>Math.abs(x-raw)<.11)
    if(t===undefined||anchors.some(x=>Math.abs(x.atSeconds-t)<minGap))continue
    const width=Math.min(15,duration),start=Math.max(0,Math.min(duration-width,t-width/2))
    const m=metrics(t),rec=recAt(t)
    const selectionBasis=rec?'model-suggested-verified-preview-time':
      m.crowd>0?'optional-pbp-heat-and-preview-difference':
      match(hints,t)?'python-pixel-change-and-timeline':'verified-preview-timeline'
    anchors.push({atSeconds:t,startSeconds:Math.round(start*100)/100,
      endSeconds:Math.round((start+width)*100)/100,source:'verified-preview-sample',
      pixelChange:m.change,selectionBasis,
      ...(rec?{semanticSuggested:true}:{}),
      ...(m.crowd>0?{heat:m.crowd,heatSource}: {})})
  }
  anchors.sort((a,b)=>a.atSeconds-b.atSeconds)
  // Nearby captions are only trusted where the existing evidence bundle has
  // verified this same BV's subtitle / ASR origin and explicit time spans.
  const speech=overview.perceptionHandoff?.speech
  const kind=speech?.source==='official-subtitles'?'subtitle':speech?.source==='machine-asr'?'asr_transcript':null
  const speechVerified=kind&&evidence.sources.some(x=>x.kind===kind&&x.status==='verified')
  const segments=speechVerified&&Array.isArray(speech.segments)?speech.segments:[]
  return anchors.map(anchor=>{
    const nearby=segments.filter(s=>Number.isSafeInteger(s?.startMs)&&Number.isSafeInteger(s?.endMs)&&
      s.endMs>=anchor.startSeconds*1000&&s.startMs<=anchor.endSeconds*1000&&
      typeof s.text==='string'&&s.text.trim())
      .sort((a,b)=>Math.abs((a.startMs+a.endMs)/2-anchor.atSeconds*1000)-
        Math.abs((b.startMs+b.endMs)/2-anchor.atSeconds*1000))[0]
    const visualCue=recAt(anchor.atSeconds)||annotated.find(x=>Math.abs(x.seconds-anchor.atSeconds)<=1.1)
    return {...anchor,
      ...(nearby?{nearbySpeech:clean(nearby.text),speechSource:speech.source}:{}),
      ...(visualCue?{visualCue:visualCue.description,visualCueSource:'unverified-visual-model-at-verified-time'}:{}),
      scanCoverage:visual.sampling?.timeline_scan_complete===true?'scanned-under-limits':'partial-or-unknown',
      visualCertainty:'low-res-sampled-frame-not-verified-local-event'}
  })
}
