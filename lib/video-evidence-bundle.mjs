/**
 * 2.8.1-dev.2a — read-only, bounded video perception provenance contract.
 *
 * A receipt from one sensor does not authorize a claim from another sensor:
 * subtitles != local ASR; preview frames != video playback; a vision response
 * describes sampled frames only; comments/danmaku are third-party discussion.
 * This is NOT a Life action proof, a viewing receipt, or a persistence store.
 * No raw text, image bytes, API credentials, local paths or third-party UIDs.
 */
export const VIDEO_EVIDENCE_SCHEMA = 'life-video-evidence/v1'
const BV = /^BV[0-9A-Za-z]{10}$/
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const safeBv = value => BV.test(String(value || ''))
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400 * 12
const timeMs = value => Math.round(value * 1000)
const capped = (value, max) => Math.min(max, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0))
const placeholder = /^(?:[-—–\s]*|(?:无|没有|未找到|未获取|未取得|无法获取|获取失败|读取失败|转写失败|转写未成功|字幕没取到|字幕获取失败|暂无|不支持|失败|未生成)(?:相关|有效|可用|该视频|的视频|AI)?(?:字幕|转写|内容|画面|预览|文本|结果|描述)?(?:信息|数据|文本)?[。.!！\s]*)$/i
const goodText = value => typeof value === 'string' && value.trim().length >= 2 &&
  !placeholder.test(value.trim()) &&
  !/^(?:error|failed|错误[:：]|失败[:：]|该视频没有字幕|字幕(?:不可用|获取失败|未获取))[\s:：。!]*/i.test(value.trim())
const isError = value => object(value).ok === false || !!object(value).error
const matchesTarget = (value, bvid) => !object(value).bvid || object(value).bvid === bvid
const distinctSeconds = (values, max = 24) => {
  if (!Array.isArray(values)) return []
  const out = []
  for (const value of values.slice(0, 100)) {
    if (!number(value)) continue
    const ms = timeMs(value)
    if (!out.includes(ms)) out.push(ms)
    if (out.length >= max) break
  }
  return out.sort((a, b) => a - b)
}
const segmentSpans = value => {
  const rows = Array.isArray(value) ? value : Array.isArray(object(value).timed_segments) ? value.timed_segments :
    Array.isArray(object(value).segments) ? value.segments : []
  const spans = []
  for (const item of rows.slice(0, 64)) {
    if (!item || typeof item !== 'object') continue
    // Upstream APIs disagree on timestamp units. Only accept explicit seconds
    // keys, never guess that a generic `from` or `start` is seconds.
    const start = item.startSeconds ?? item.start_seconds
    const end = item.endSeconds ?? item.end_seconds
    if (!number(start) || !number(end) || end < start) continue
    spans.push({startMs: timeMs(start), endMs: timeMs(end)})
    if (spans.length >= 24) break
  }
  return spans
}

/** Build from verified read results, not model-written assertions. */
export function buildVideoEvidenceBundle({bvid, info, subtitle, visual, comments, danmaku, at = Date.now()} = {}) {
  if (!safeBv(bvid) || !Number.isSafeInteger(at) || at <= 0) return null
  const m = object(info), metadata = m.data && typeof m.data === 'object' ? m.data : m
  if (isError(m) || (metadata.bvid && metadata.bvid !== bvid)) return null
  const title = typeof metadata.title === 'string' ? metadata.title.trim() : ''
  if (!title || title.length > 200 || /[\u0000-\u001f\u007f]/.test(title)) return null

  const sources = [{kind:'metadata', origin:'bili-video-info', status:'verified', coverage:'video-metadata'}]
  const s = object(subtitle)
  const hasText = !isError(s) && matchesTarget(s, bvid) && goodText(s.text)
  const asr = hasText && s.source === 'local-asr'
  if (hasText) sources.push({kind:asr ? 'asr_transcript' : 'subtitle',
    origin:asr ? 'bili-transcribe-safe' : 'bili-subtitle', status:'verified',
    coverage:'partial-text', ...(asr ? {reliability:'machine-estimate-not-human-verified'} : {}),
    ...(segmentSpans(s).length ? {spans:segmentSpans(s)} : {})})

  const v = object(visual)
  const matchedVisual = !isError(v) && matchesTarget(v, bvid)
  const times = matchedVisual ? distinctSeconds(v.times, 48) : []
  const sample = object(v.sampling)
  const standardSample = (sample.sampler_version === 2 && sample.strategy === 'activity-time+local-thumbnail-difference') ||
    (sample.sampler_version === 3 && sample.strategy === 'uniform-time+local-thumbnail-difference')
  const focusedSample = [3,4].includes(sample.sampler_version) &&
    sample.strategy === 'focus-window+local-thumbnail-difference'
  const fullScan=sample.sampler_version===6
  const fullScanValid=!fullScan||(
    Number.isInteger(sample.index_frames_available)&&sample.index_frames_available>=1&&sample.index_frames_available<=3000&&
    Number.isInteger(sample.candidate_frames_scanned)&&sample.candidate_frames_scanned===sample.candidates_examined&&
    sample.candidate_frames_scanned<=sample.index_frames_available&&
    Number.isInteger(sample.source_sheets_available)&&sample.source_sheets_available>=1&&sample.source_sheets_available<=3000&&
    Number.isInteger(sample.source_sheets_scanned)&&sample.source_sheets_scanned===sample.sheets_downloaded&&
    typeof sample.timeline_scan_complete==='boolean'&&
    ['none','network-budget','sheet-cap','tile-cap','pixel-cap'].includes(sample.scan_limited_by)&&
    Array.isArray(sample.review_candidates_seconds)&&sample.review_candidates_seconds.length<=5&&
    sample.review_candidates_seconds.every(t=>number(t)&&times.some(v=>Math.abs(v-t*1000)<150))&&
    (sample.review_candidate_hints===undefined||(
      Array.isArray(sample.review_candidate_hints)&&sample.review_candidate_hints.length<=4&&
      sample.review_candidate_hints.every(h=>h&&h.source==='python-videoshot-neighbor-diff'&&
        number(h.second)&&number(h.pixel_change)&&h.pixel_change<=1&&
        sample.review_candidates_seconds.some(t=>Math.abs(t-h.second)<0.11)&&
        times.some(v=>Math.abs(v-h.second*1000)<150))))
  )
  const previewBoardSample = [5,6].includes(sample.sampler_version) && fullScanValid &&
    ['videoshot-storyboard-stratified','focus-videoshot-storyboard-stratified'].includes(sample.strategy) &&
    v.image_source === 'B站低清预览' && sample.low_resolution === true &&
    [12,24,48].includes(sample.frame_budget) && times.length >= 1 &&
    times.length <= sample.frame_budget &&
    sample.frames_selected === times.length &&
    sample.storyboard_count === Math.ceil(times.length/12) &&
    Number.isInteger(sample.candidates_examined) && sample.candidates_examined >= times.length &&
    sample.candidates_examined <= (fullScan?3000:144) &&
    Number.isInteger(sample.sheets_downloaded) && sample.sheets_downloaded >= 1 &&
    sample.sheets_downloaded <= (fullScan?48:6) &&
    Number.isInteger(sample.sprite_bytes) && sample.sprite_bytes >= 1 &&
    sample.sprite_bytes <= 8*1024*1024
  const decodedSample = sample.sampler_version === 4 &&
    sample.strategy === 'decoded-scene-2fps' &&
    sample.source_type === 'bili-public-playurl-durl' &&
    v.image_source === 'B站公开视频片段（离线解码）'
  const storyboardSample = [5,6,7].includes(sample.sampler_version) &&
    sample.strategy === 'decoded-storyboard-stratified-2fps' &&
    (sample.source_type === 'bili-public-playurl-durl' || (sample.sampler_version === 7 && sample.source_type === 'bili-public-playurl-dash')) &&
    v.image_source === 'B站公开视频片段（离线解码）'
  const windows = Array.isArray(sample.sampled_windows) ? sample.sampled_windows : []
  const videoDuration = sample.video_duration_seconds
  const storyboardWindowValid = storyboardSample && number(videoDuration) && videoDuration <= (sample.sampler_version === 7 ? 14400 : 2700) &&
    windows.length >= 1 && windows.length <= 8 &&
    windows.every(win => number(win.startSeconds) && number(win.endSeconds) &&
      win.endSeconds > win.startSeconds && win.endSeconds <= videoDuration+0.01 &&
      win.endSeconds-win.startSeconds <= 120) &&
    windows.reduce((acc,win) => acc+win.endSeconds-win.startSeconds,0) <= 120.5 &&
    times.length >= 1 && times.length <= 48 &&
    times.every(ms => windows.some(win => ms >= win.startSeconds*1000-250 && ms <= win.endSeconds*1000+250))
  const rangeV6Valid=![6,7].includes(sample.sampler_version) || (
    Number.isInteger(sample.input_bytes) && sample.input_bytes>=0 &&
    Number.isInteger(sample.network_budget_bytes) && sample.network_budget_bytes>=1048576 && sample.network_budget_bytes<={12:25165824,24:52428800,48:104857600}[sample.frame_plan] &&
    sample.input_bytes<=sample.network_budget_bytes &&
    Number.isInteger(sample.remote_video_bytes) && sample.remote_video_bytes>=sample.input_bytes &&
    (sample.sampler_version === 7
      ? (sample.source_type === 'bili-public-playurl-dash' ? sample.download_mode === 'indexed-dash-sidx-byte-ranges' : ['complete-bounded','indexed-mp4-byte-ranges'].includes(sample.download_mode))
      : ['complete-bounded','indexed-mp4-byte-ranges'].includes(sample.download_mode)) &&
    Number.isInteger(sample.download_ranges) && sample.download_ranges>=1 && sample.download_ranges<=1000 &&
    (sample.download_mode!=='complete-bounded'||sample.input_bytes===sample.remote_video_bytes)
  )
  const storyboardValid = storyboardWindowValid && rangeV6Valid && [12,24,48].includes(sample.frame_plan) &&
    ['standard','deep'].includes(sample.depth) &&
    sample.frame_budget === (sample.depth==='standard'?12:sample.frame_plan) &&
    sample.frames_selected === times.length &&
    sample.frames_selected <= sample.frame_budget &&
    sample.storyboard_count === Math.ceil(times.length/12) &&
    Number.isInteger(sample.candidates_examined) && sample.candidates_examined >= times.length &&
    sample.candidates_examined <= 240 &&
    ['unavailable','bili-pbp-heat-curve','bili-danmaku-xml-density'].includes(sample.heat_source) &&
    sample.viewer_heat_is_content_evidence === false
  const window = object(v.focus_window)
  const boundedWindow = focusedSample && Number.isFinite(window.startSeconds) &&
    Number.isFinite(window.endSeconds) && window.startSeconds >= 0 &&
    window.endSeconds <= 43200 && window.endSeconds - window.startSeconds >= 3 &&
    window.endSeconds - window.startSeconds <= 120 &&
    times.every(ms => ms >= window.startSeconds*1000 && ms <= window.endSeconds*1000)
    ? {startMs:timeMs(window.startSeconds), endMs:timeMs(window.endSeconds)} : null
  const clip = object(sample.clip_window)
  const verifiedClip = decodedSample && number(clip.startSeconds) &&
    number(clip.endSeconds) && clip.endSeconds > clip.startSeconds &&
    clip.endSeconds - clip.startSeconds <= 120 &&
    times.length > 0 && times.every(ms => ms >= clip.startSeconds*1000 && ms <= clip.endSeconds*1000)
    ? {startMs:timeMs(clip.startSeconds), endMs:timeMs(clip.endSeconds)} : null
  const previewBoardFocused = sample.strategy === 'focus-videoshot-storyboard-stratified'
  const previewBoardWindowValid = !previewBoardFocused || (Number.isFinite(window.startSeconds) &&
    Number.isFinite(window.endSeconds) && window.startSeconds >= 0 &&
    window.endSeconds <= 43200 && window.endSeconds-window.startSeconds >= 3 &&
    window.endSeconds-window.startSeconds <= 120 &&
    times.every(ms=>ms>=window.startSeconds*1000 && ms<=window.endSeconds*1000))
  const previewValid = (standardSample || focusedSample || (previewBoardSample && previewBoardWindowValid)) &&
    (!focusedSample || boundedWindow) && v.image_source !== 'B站公开视频片段（离线解码）'
  const decodedV4Valid = decodedSample && !!verifiedClip && times.length <= 3 &&
    Number.isInteger(sample.frames_selected) && sample.frames_selected === times.length &&
    Number.isInteger(sample.candidates_examined) && sample.candidates_examined >= times.length &&
    sample.candidates_examined <= 240
  const decodedValid = decodedV4Valid || storyboardValid
  // Older preview read receipts did not include sampling metadata; keep those
  // as preview-only, but reject fabricated/unknown decoded sample identities.
  const legacyPreview = !sample.strategy && sample.sampler_version == null &&
    v.image_source !== 'B站公开视频片段（离线解码）'
  const samplingMeta = matchedVisual && (previewValid || decodedValid) ?
    {selection:storyboardValid ? 'decoded-storyboard-stratified-2fps' : decodedValid ? 'decoded-scene-2fps' :
      previewBoardSample?'videoshot-storyboard-stratified':focusedSample?'focus-window+thumbnail-dedup':'uniform-time+thumbnail-dedup',
      candidatesExamined:capped(sample.candidates_examined,decodedValid?240:previewBoardSample?(fullScan?3000:144):12),
      framesSelected:capped(sample.frames_selected,storyboardValid||previewBoardSample?48:3),
      ...(storyboardValid ? {framePlan:sample.frame_plan,frameBudget:sample.frame_budget,
        storyboards:sample.storyboard_count,viewDepth:sample.depth,
        heatSource:sample.heat_source,
        windows:windows.map(win => ({startMs:timeMs(win.startSeconds),endMs:timeMs(win.endSeconds)})),
        sceneChangePointsMs:distinctSeconds(sample.scene_change_seconds,24),
        motionPointsMs:distinctSeconds(sample.motion_hotspots_seconds,12)} :
       previewBoardSample ? {storyboards:sample.storyboard_count,frameBudget:sample.frame_budget,
         sheetsDownloaded:sample.sheets_downloaded,lowResolution:true,
         ...(fullScan?{indexFramesAvailable:sample.index_frames_available,
           sourceSheetsAvailable:sample.source_sheets_available,
           timelineScanComplete:sample.timeline_scan_complete,
           scanLimitedBy:sample.scan_limited_by}: {})} :
       decodedV4Valid ? {sceneCandidates:capped(sample.scene_candidates,24),
        cutCandidates:capped(sample.cut_candidates,23),clipWindowMs:verifiedClip,
        sceneChangePointsMs:Array.isArray(sample.scene_change_seconds) ?
          distinctSeconds(sample.scene_change_seconds,12).filter(x=>x>=verifiedClip.startMs&&x<=verifiedClip.endMs) : [],
        motionPointsMs:Array.isArray(sample.motion_hotspots_seconds) ?
          distinctSeconds(sample.motion_hotspots_seconds,8).filter(x=>x>=verifiedClip.startMs&&x<=verifiedClip.endMs) : []} :
        {sheetsDownloaded:capped(sample.sheets_downloaded,3)}),
      ...(boundedWindow ? {focusWindowMs:boundedWindow} : {}),
      ...(previewBoardFocused&&previewBoardWindowValid ? {focusWindowMs:{startMs:timeMs(window.startSeconds),endMs:timeMs(window.endSeconds)}} : {})} : null
  if (matchedVisual && times.length && (previewValid || decodedValid || legacyPreview))
    sources.push({kind:decodedValid?'decoded_video_frames':'preview_frames',
      origin:decodedValid?'bili-public-playurl-ffmpeg':'bili-videoshot',
      status:'sampled',coverage:decodedValid?'sampled-public-video-frames':'sampled-low-resolution-frames',
      timePointsMs:times,...(samplingMeta ? {sampling:samplingMeta} : {})})
  // OCR can only come from the local Tesseract pass over actual decoded
  // representative frames, never from a model's freeform visual description
  // or an unverified/preview image. Store timings and counts, not raw text.
  const ocr = object(v.ocr)
  const ocrRows = storyboardValid && sample.ocr_engine === 'tesseract-cli' &&
    ocr.engine === 'tesseract-cli' && Number.isInteger(ocr.attempted) &&
    sample.ocr_attempted === ocr.attempted && ocr.attempted >= 1 && ocr.attempted <= 12 && Array.isArray(ocr.segments) &&
    ocr.segments.length <= ocr.attempted ? ocr.segments : []
  const trustedOcr = []
  for (const row of ocrRows) {
    if (!row || !number(row.atSeconds) || !Number.isFinite(row.confidence) ||
      row.confidence < 60 || row.confidence > 100 || !goodText(row.text) ||
      row.text.length > 120) continue
    const atMs = timeMs(row.atSeconds)
    if (!times.includes(atMs) || trustedOcr.some(x=>x===atMs)) continue
    trustedOcr.push(atMs)
  }
  if (trustedOcr.length) sources.push({kind:'frame_ocr',origin:'local-tesseract-cli',
    status:'machine-extracted',coverage:'sampled-decoded-still-frames',
    timePointsMs:trustedOcr, count:trustedOcr.length})

  const recognized = matchedVisual && ['analyzed','cached'].includes(v.status) && goodText(v.description)
  if (recognized && (previewValid || decodedValid || legacyPreview)) sources.push({
    kind:decodedValid?'decoded_visual_analysis':'preview_visual_analysis',
    origin:decodedValid?'bili-decoded-vision':'bili-preview-vision',
    status:v.status==='cached'?'cached':'analyzed',
    coverage:decodedValid?'sampled-public-video-frames':'sampled-low-resolution-frames',
    ...(times.length ? {timePointsMs:times} : {timeAnchor:'unavailable'})})

  const c = object(comments), d = object(danmaku)
  const commentCount = !isError(c) && matchesTarget(c,bvid) && Array.isArray(c.comments) ?
    capped(c.comments.filter(row=>row && typeof row.content==='string' && row.content.trim()).length,20) : 0
  const danmakuCount = !isError(d) && matchesTarget(d,bvid) && Array.isArray(d.danmakus) ?
    capped(d.danmakus.filter(row=>row && typeof row.text==='string' && row.text.trim()).length,100) : 0
  if (commentCount) sources.push({kind:'public_comments',origin:'bili-comments',
    status:'retrieved',coverage:'third-party-discussion',count:commentCount})
  if (danmakuCount) sources.push({kind:'danmaku',origin:'bili-danmaku',
    status:'retrieved',coverage:'third-party-discussion',count:danmakuCount})

  return {
    schema: VIDEO_EVIDENCE_SCHEMA, bvid, at,
    sources, observedVideoPlayback:false, analyzedOriginalAudio:false,
    verifiedContent:hasText || (recognized && (previewValid || decodedValid || legacyPreview)),
    // A subtitle or ASR transcript is textual content evidence, not proof of
    // listening to the recording; visual results cover sampled frames only.
    limits:['not-full-video-playback','no-original-audio-perception',
      ...(!times.length ? ['no-timed-visual-frames'] : [])],
  }
}

/** Diagnostic-only compact view for memory flags; never upgrade read permission. */
export function videoEvidenceFlags(bundle) {
  const kinds = new Set(bundle?.sources?.map(x => x.kind) || [])
  return {metadata:kinds.has('metadata'),subtitle:kinds.has('subtitle'),asr:kinds.has('asr_transcript'),
    preview:kinds.has('preview_frames'),decoded:kinds.has('decoded_video_frames'),
    vision:kinds.has('preview_visual_analysis')||kinds.has('decoded_visual_analysis'),
    ocr:kinds.has('frame_ocr'),
    comments:bundle?.sources?.find(x=>x.kind==='public_comments')?.count||0,
    danmaku:bundle?.sources?.find(x=>x.kind==='danmaku')?.count||0}
}
