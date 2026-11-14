/** Public-safe, UID-bound recognition cue for a single comment author.
 * Do NOT derive public familiarity from the legacy mixed DM/comment index.
 * The account-scoped channel ledger is evidence, not a sending authorization.
 */
export function publicCommentFamiliarity({role='stranger',channels=null,scoped=false}={}) {
  if (!scoped) return ''
  const contact=role==='owner'||role==='friend'
  const c=channels?.comment||{}
  const incoming=Number.isSafeInteger(c.incoming)&&c.incoming>0?c.incoming:0
  const outgoing=Number.isSafeInteger(c.outgoing)&&c.outgoing>0?c.outgoing:0
  const days=Number.isSafeInteger(c.activeDays)&&c.activeDays>0?c.activeDays:0
  // The current incoming notification is already recorded by the coordinator.
  // A first incoming comment alone cannot prove a previous encounter.
  const priorPublic=incoming>=2||outgoing>=1
  const established=priorPublic&&incoming>=2&&outgoing>=1&&days>=2
  if (established)
    return '【当前评论者的公开熟悉度】已凭同一 B站 UID 与该账号的公开往来记录确认：此前曾多次在评论区相遇，且存在双向互动。可以自然表现出认得对方，但无需每次主动打招呼。具体聊过什么尚未提供；只有请求 public-social 记忆并检索命中后才可提及具体旧话题。不可透露私信、后台关系分、授权名册或 UID。'
  if (priorPublic)
    return '【当前评论者的公开熟悉度】已有该 B站 UID 过去的公开评论接触证据，可以自然觉得眼熟或再次相遇；但不等于很亲密，也没有证据支持具体旧话题。若需要回忆具体公共交流，可按需申请 memory。禁止使用私信经历编造公开对话。'
  if (contact)
    return '【当前评论者的身份线索】该 UID 与当前账号的已配置联系人一致，可以自然认出这是认识的人；但尚无足够可信的既往公开评论往来证据。可以视本次语境自然打招呼，不可声称此前在评论区聊过，也不可公开透露私信、联系人名册、权限或关系设定。'
  return ''
}
