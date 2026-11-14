/**
 * Fish decides whether to inspect a video and how deeply. Tool availability,
 * subtitles, and model budget are facts, NOT automatic intent. In particular,
 * missing subtitles never mandates a paid/local vision call.
 */
const unhelpful=/^(?:\s*|该视频没有字幕|无字幕|字幕(?:不可用|获取失败|未获取)|暂无字幕|没有字幕|未取得字幕|字幕by[^\n]{0,30})$/i
export const VIDEO_VIEW_DEPTHS = Object.freeze(['skim', 'standard', 'deep'])
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
export function visionDecision({subtitle,enabled=false,quotaRemaining=1,roundRemaining=1,depth,visualQuestion=false}={}){
 const hasSubtitle=usableSubtitle(subtitle)
 // Explicit vision question is a legacy form of choosing standard depth;
 // an explicitly chosen skim still takes precedence.
 const selected=VIDEO_VIEW_DEPTHS.includes(depth)?depth:(visualQuestion?'standard':'skim')
 if(selected==='skim')return {kind:'skipped',depth:selected,hasSubtitle,required:false,attempt:false,reason:'life-chose-skim'}
 if(!enabled)return {kind:'disabled',depth:selected,hasSubtitle,required:false,attempt:false,reason:'vision-disabled'}
 if(quotaRemaining<=0||roundRemaining<=0)return {kind:'unavailable',depth:selected,hasSubtitle,required:false,attempt:false,reason:'vision-budget-exhausted'}
 return {kind:'chosen',depth:selected,hasSubtitle,required:false,attempt:true,
  reason:selected==='deep'?'life-chose-deep':'life-chose-standard'}
}
