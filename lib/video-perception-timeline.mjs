/**
 * 2.8.1-dev.3b.1: read-only cross-source timeline projection.
 * Only co-temporal proximity is asserted; it is NOT semantic agreement, an OCR
 * result, an audio-listening receipt or proof of full playback. No persistence.
 */
const BV = /^BV[A-Za-z0-9]{10}$/
const plain = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {}
const validSeconds = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 43200
const ms = seconds => Math.round(seconds * 1000)
const clean = (s,limit=120) => String(s||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit)

export function buildVideoPerceptionTimeline({bvid,evidence,subtitle,visual}={}) {
  if (!BV.test(String(bvid||'')) || evidence?.bvid !== bvid || evidence?.schema !== 'life-video-evidence/v1') return null
  const sources = Array.isArray(evidence.sources) ? evidence.sources : []
  const caption = sources.find(s=>s.kind==='subtitle' && s.status==='verified')
  const asr = sources.find(s=>s.kind==='asr_transcript' && s.status==='verified')
  const frames = sources.find(s=>['decoded_video_frames','preview_frames'].includes(s.kind))
  const visualAnalysis = sources.find(s=>['decoded_visual_analysis','preview_visual_analysis'].includes(s.kind))
  const s=plain(subtitle)
  const verifiedText = Boolean((caption||asr) && (!s.bvid || s.bvid===bvid) && s.ok!==false && !s.error)
  const rows = verifiedText ? (Array.isArray(s.timed_segments)?s.timed_segments : Array.isArray(s.segments)?s.segments:[]) : []
  const spans=[]
  for (const row of rows.slice(0,240)) {
    if (!row || !validSeconds(row.startSeconds) || !validSeconds(row.endSeconds) || row.endSeconds < row.startSeconds) continue
    const excerpt=clean(row.text||row.content,120)
    if (!excerpt) continue
    spans.push({startMs:ms(row.startSeconds),endMs:ms(row.endSeconds),excerpt})
    if (spans.length>=160)break
  }
  const selected = Array.isArray(frames?.timePointsMs) ? frames.timePointsMs.filter(t=>Number.isInteger(t)&&t>=0).slice(0,48) : []
  const sourceType=frames?.kind==='decoded_video_frames'?'decoded-video':frames?.kind==='preview_frames'?'preview':'none'
  const anchors=[]
  if (selected.length) {
    for (const t of selected) {
      // Captions overlapping a representative frame are nearby speech/text,
      // never a proof that the visual model recognized that caption on-screen.
      const nearby=spans.filter(r=>r.startMs<=t+1500 && r.endMs>=t-1500).slice(0,2)
      anchors.push({atMs:t,imageSource:sourceType,visualDescriptionAvailable:Boolean(visualAnalysis),
        ...(nearby.length?{nearbyCaptions:nearby.map(r=>({startMs:r.startMs,endMs:r.endMs,excerpt:r.excerpt}))}:{})})
    }
  } else if (spans.length) {
    for (const r of spans.slice(0,48)) anchors.push({atMs:Math.round((r.startMs+r.endMs)/2),imageSource:'none',
      nearbyCaptions:[{...r}]})
  }
  return {
    schema:'life-video-perception-timeline/v1',bvid,
    alignment:'time-proximity-only',anchors,
    sourceAvailability:{videoFrames:sourceType,visualModelResponse:Boolean(visualAnalysis),
      captions:Boolean(caption),localAsr:Boolean(asr),timedCaptionSegments:spans.length,
      ocr:'not-observed',originalAudio:'not-listened'},
    limitations:['co-occurrence-is-not-semantic-confirmation','no-audio-perception','no-ocr-receipt',
      'not-full-video-playback',...(verifiedText && !spans.length ? ['transcript-has-no-timestamps'] : [])]
  }
}
