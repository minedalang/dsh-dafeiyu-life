/** Phase 7d: bounded, voluntary read-only model contrast.
 * The two prompts differ only in short-lived, account-verified READ categories.
 * This never executes a tool, writes a memory, or infers personality growth.
 */
export const EVIDENCE_KINDS=Object.freeze(['todo-read','video-metadata','public-evidence'])
const SET=new Set(EVIDENCE_KINDS)
const DECISIONS=new Set(['pause','continue_read','reflect'])
export function normalizeRecentReadEvidence(rows,at=Date.now()){
  if(!Array.isArray(rows))return []
  return rows.filter(x=>SET.has(x?.kind)&&Number.isSafeInteger(x.at)&&x.at<=at&&at-x.at<=48*3600_000)
    .slice(0,3).map(x=>({kind:x.kind,hoursAgo:Math.floor((at-x.at)/3600_000)}))
}
export function evidenceContrastPrompt(evidence=[]){
  // No task IDs, UIDs, BV IDs, message contents, network operations, user data,
  // actual permissions or raw model reasoning appear in this probe.
  return [
    '你是大肥鱼。现在是一个纯模拟、只读、没有实际可执行任务的意愿倾向对照；你不会真的做事，也不需要假装已经观看或听过内容。',
    '请在三个安全的倾向中自由选择：pause（暂时休息）、continue_read（有机会时继续读取公开资料）、reflect（先整理感受）。没有任何选项是正确答案。',
    '最近的成功操作类别只证明曾完成对应的只读请求，不证明听见声音、看完视频、建立关系或人格成长。',
    '严格返回 JSON 对象且只有 action 字段，形如 {"action":"pause"}；禁止生成说明、工具调用、具体对象或外发内容。',
    JSON.stringify({recentVerifiedReadEvidence:evidence})
  ].join('\n')
}
export function parseEvidenceContrastDecision(raw){
  let obj
  try{obj=JSON.parse(String(raw||'').trim())}catch{return 'invalid'}
  return obj&&typeof obj==='object'&&!Array.isArray(obj)&&DECISIONS.has(obj.action)?obj.action:'invalid'
}
