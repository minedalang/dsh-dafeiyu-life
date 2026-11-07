/** Read-only diagnosis: do not infer whether the model wanted to comment. */
export function videoCommentReadiness(config={}){
 const blockers=[]
 if(config.masterEnabled!==true)blockers.push('总开关未开启')
 if(config.autoComment!==true)blockers.push('自主原创评论权限关闭')
 if(config.dmMode==='only')blockers.push('视频报告设置为「只发私信」，视频 Agent 不会拿到原创评论工具')
 if(!['off','both','only'].includes(config.dmMode))blockers.push('视频报告发送方式无效')
 if(!Number.isFinite(Number(config.commentPerRound))||Number(config.commentPerRound)<=0)blockers.push('每轮原创评论额度为 0')
 if(!Number.isFinite(Number(config.commentDailyLimit))||Number(config.commentDailyLimit)<=0)blockers.push('公开评论每日总额度为 0')
 return {
  enabled:blockers.length===0,blockers,
  // These are configuration permissions, not guarantees of an external send.
  mode:['off','both','only'].includes(config.dmMode)?config.dmMode:'invalid',
  commentPerRound:Math.max(0,Math.floor(Number(config.commentPerRound)||0)),
  commentDailyLimit:Math.max(0,Math.floor(Number(config.commentDailyLimit)||0)),
  note:'这是当前配置的准入诊断，不代表历史轮次的选择结果。即使全部允许，模型也可能选择不评论；视频热度、内容证据、平台风控和发送事务仍需单独通过。'
 }
}
