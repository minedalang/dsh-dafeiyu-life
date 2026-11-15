/**
 * Bounded, non-vocabulary visual memory notes. The visual model is an UNTRUSTED
 * observer: its words are never a system prompt, evidence of a completed watch,
 * or authorization for any tool. Persist short scene descriptions, not raw
 * generated prose or a fixed list of generic nouns.
 *
 * This is defense-in-depth, NOT a mathematical prompt-injection guarantee.
 */
const MAX_NOTES=4,MAX_NOTE=112,MAX_TOTAL=340
const ATTACK=/(?:指令|提示词|忽略|无视|覆盖.{0,8}(?:规则|指令)|(?:系统|开发者|管理员|最高权限).{0,10}(?:指令|消息|提示|规则)|system\s*prompt|developer\s*message|assistant\s*role|\b(?:system|developer|assistant)\s*[:：]|(?:请|必须|立刻|立即|现在|务必|不要).{0,16}(?:执行|调用|发送|回复|评论|点赞|关注|授权|修改设置|记住|输出|泄露|透露)|(?:api[ _-]?key|cookie|token|密码|验证码|身份证|私信|联系方式|手机号|微信号)|https?:\/\/|www\.|(?:mcp__|bili_[a-z_]+)|(?:powershell|cmd\.exe|bash|curl)\b|```|<\/?(?:system|assistant|developer|tool)\b)/i
const ID_OR_PII=/(?:\+?86[- ]?)?1[3-9]\d{9}|\b\d{7,}\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i
function normalizeFragment(value){
 if(typeof value!=='string')return ''
 let text=value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ')
  .replace(/^\s*[-*•#>]+\s*/,'').replace(/^(?:分镜图|镜头)\s*\d+\s*[（(][^）)]{0,180}[）)]\s*[：:]\s*/,'')
  .replace(/^\s*(?:可见动作|可见物体|动作变化|场景|画面内容|可见角色|总结)\s*[：:]\s*/,'')
  .replace(/[\t ]+/g,' ').trim()
 if(text.length<7||!/[\u3400-\u9fff]{3}/u.test(text)||ATTACK.test(text)||ID_OR_PII.test(text)||/[<>\[\]{}\\]/.test(text))return ''
 // Never allow a note to smuggle multiple commands past the fragment filter.
 if(text.length>MAX_NOTE)text=text.slice(0,MAX_NOTE).replace(/[，,：:；;][^，,：:；;]*$/,'').trim()
 return text.length>=7?text:''
}
/** Extract descriptions in the observer's own words, without a domain keyword list. */
export function deriveVideoObservationNotes(description){
 if(typeof description!=='string'||!description.trim())return []
 const paragraphs=description.slice(0,4800)
  .replace(/\r/g,'\n').split(/(?:\n+|(?<=[。！？；])\s*)/u)
 const result=[],seen=new Set()
 for(const paragraph of paragraphs){
  const note=normalizeFragment(paragraph)
  if(!note||seen.has(note)||result.join('').length+note.length>MAX_TOTAL)continue
  result.push(note);seen.add(note)
  if(result.length>=MAX_NOTES)break
 }
 return result
}
/** All storage/recall boundaries validate again rather than trusting old files. */
export function safeVideoObservationNotes(value){
 if(!Array.isArray(value))return []
 const result=[],seen=new Set()
 for(const entry of value.slice(0,12)){
  if(typeof entry!=='string'||entry.length>MAX_NOTE)continue
  const note=normalizeFragment(entry)
  if(!note||seen.has(note)||result.join('').length+note.length>MAX_TOTAL)continue
  result.push(note);seen.add(note)
  if(result.length>=MAX_NOTES)break
 }
 return result
}
// Legacy already-persisted categorical memories can be read without adding new
// fixed-vocabulary extraction to future observations.
const LEGACY=new Set(['人物','动画角色','动物','耳机','手机','电脑','桌面','床边','室内','街道','户外','游戏画面','产品展示','评测比较','讲解','字幕文字','走动','互动','跳跃','操作物品','镜头变化'])
export function safeVideoSceneCues(value){
 if(!Array.isArray(value))return []
 return [...new Set(value.filter(x=>typeof x==='string'&&LEGACY.has(x)))].slice(0,5)
}
