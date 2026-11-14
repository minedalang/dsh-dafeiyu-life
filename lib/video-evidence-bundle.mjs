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
  const rows = Array.isArray(value) ? value : Array.isArray(object(value).segments) ? value.segments : []
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
    coverage:'partial-text', ...(segmentSpans(s).length ? {spans:segmentSpans(s)} : {})})

  const v = object(visual)
  const matchedVisual = !isError(v) && matchesTarget(v, bvid)
  const times = matchedVisual ? distinctSeconds(v.times) : []
  const sample = object(v.sampling)
  const samplingMeta = matchedVisual && sample.sampler_version === 2 &&
    sample.strategy === 'activity-time+local-thumbnail-difference' ?
    {selection:'activity-time+thumbnail-dedup',candidatesExamined:capped(sample.candidates_examined,12),
      framesSelected:capped(sample.frames_selected,3),sheetsDownloaded:capped(sample.sheets_downloaded,3)} : null
  if (times.length) sources.push({kind:'preview_frames',origin:'bili-videoshot',
    status:'sampled',coverage:'sampled-low-resolution-frames',timePointsMs:times,
    ...(samplingMeta ? {sampling:samplingMeta} : {})})
  const recognized = matchedVisual && ['analyzed','cached'].includes(v.status) && goodText(v.description)
  if (recognized) sources.push({kind:'preview_visual_analysis',
    origin:'bili-preview-vision',status:v.status==='cached'?'cached':'analyzed',
    coverage:'sampled-low-resolution-frames',
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
    verifiedContent:hasText || recognized,
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
    preview:kinds.has('preview_frames'),vision:kinds.has('preview_visual_analysis'),
    comments:bundle?.sources?.find(x=>x.kind==='public_comments')?.count||0,
    danmaku:bundle?.sources?.find(x=>x.kind==='danmaku')?.count||0}
}
