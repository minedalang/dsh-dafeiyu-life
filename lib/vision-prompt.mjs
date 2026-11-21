/**
 * User-editable observation priorities. Hard permission, rate and evidence checks
 * remain in the host and MCP implementation.
 */
export const MAX_VISION_PROMPT_CHARS = 4000
export const DEFAULT_VISION_PROMPT = `观察自适应分镜时，只依据实际送达的图片和时间码，描述人物、动作、表情、场景变化、可辨识文字及画面中的视觉梗。
清楚区分真正观察到的画面、低清预览与字幕/OCR等文字线索；看不清的内容要写明不确定性，不能把单帧画面推断成完整剧情或声音证据。`
export function normalizeVisionPrompt(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n?/g, '\n').replace(/\0/g, '').slice(0, MAX_VISION_PROMPT_CHARS).trim()
}
// New user edits must be rejected rather than saved as a silently clipped instruction.
// Legacy stored values are still read with normalizeVisionPrompt for compatibility.
export function validateVisionPromptUpdate(value) {
  if (typeof value !== 'string') throw TypeError('视觉观察重点必须是文本')
  const normalized = value.replace(/\r\n?/g, '\n').replace(/\0/g, '').trim()
  if (normalized.length > MAX_VISION_PROMPT_CHARS) throw RangeError('视觉观察重点不能超过4000字符，请精简后再保存')
  return normalized
}
// Legacy user settings remain stored unchanged. Only the known retired video-
// selection sentence is ignored when building an actual image observer's input.
// Screening and depth always belong to Life / the tool policy, never this text.
export function visionObservationFocus(value) {
  return normalizeVisionPrompt(value)
    .replace(/判断是否值得识图时[^\n。]*。?/g, '')
    .replace(/鱼鱼自主决定是否需要理解画面[^\n。]*。?/g, '')
    .replace(/\n[ \t]*\n+/g, '\n')
    .trim()
}
