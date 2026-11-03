/** Video understanding policy: the existence of real subtitle/ASR text matters,
 * not a UI switch or a metadata claim that captions are available.
 * The decision never grants tools, raises quotas, or claims model vision succeeded.
 */
const unhelpful=/^(?:\s*|该视频没有字幕|无字幕|字幕(?:不可用|获取失败|未获取)|暂无字幕|没有字幕|未取得字幕|字幕by[^\n]{0,30})$/i
export function usableSubtitle(value){
 if(typeof value==='string'){
  const raw=value.trim()
  if(!raw||unhelpful.test(raw))return false
  try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed==='object')return usableSubtitle(parsed)}catch{}
  return raw.length>=12&&!/^\{.*(?:error|message)\s*:/i.test(raw)
 }
 if(!value||typeof value!=='object'||value.error)return false
 const text=typeof value.text==='string'?value.text.trim():''
 return text.length>=12&&!unhelpful.test(text)
}
export function visionDecision({subtitle,enabled=false,mode='reuse_video_model',quotaRemaining=1,roundRemaining=1,visualQuestion=false}={}){
 const hasSubtitle=usableSubtitle(subtitle)
 if(!enabled)return {kind:'disabled',hasSubtitle,required:false,attempt:false,reason:'vision-disabled'}
 if(quotaRemaining<=0||roundRemaining<=0)return {kind:'unavailable',hasSubtitle,required:!hasSubtitle,attempt:false,reason:'vision-budget-exhausted'}
 if(!hasSubtitle)return {kind:'required',hasSubtitle:false,required:true,attempt:true,reason:'no-usable-subtitle'}
 if(visualQuestion)return {kind:'recommended',hasSubtitle:true,required:false,attempt:true,reason:'visual-context-needed'}
 return {kind:'optional',hasSubtitle:true,required:false,attempt:false,reason:'subtitle-sufficient'}
}
