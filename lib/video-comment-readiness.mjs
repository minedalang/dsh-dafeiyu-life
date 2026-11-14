/** Read-only diagnosis: do not infer whether the model wanted to comment. */
export function videoCommentReadiness(config={}){
 const blockers=[]
 if(config.masterEnabled!==true)blockers.push('总开关未开启')
 if(config.autoComment!==true)blockers.push('自主原创评论权限关闭')
 if(!Number.isFinite(Number(config.commentPerRound))||Number(config.commentPerRound)<=0)blockers.push('每轮原创评论额度为 0')
 if(!Number.isFinite(Number(config.commentDailyLimit))||Number(config.commentDailyLimit)<=0)blockers.push('公开评论每日总额度为 0')
 return {
  enabled:blockers.length===0,blockers,
  // These are configuration permissions, not guarantees of an external send.
  commentPerRound:Math.max(0,Math.floor(Number(config.commentPerRound)||0)),
  commentDailyLimit:Math.max(0,Math.floor(Number(config.commentDailyLimit)||0)),
  note:'这是当前配置的准入诊断，不代表历史轮次的选择结果。即使全部允许，模型也可能选择不评论；视频热度、内容证据、平台风控和发送事务仍需单独通过。'
 }
}

/** Stable, privacy-free code captured when a video round starts. */
export function videoCommentGateCode(config={}, {bridgeReady=true}={}){
 if(config.masterEnabled!==true)return 'master-disabled'
 if(config.autoComment!==true)return 'auto-comment-disabled'
 if(!(Number(config.commentPerRound)>0))return 'round-quota-zero'
 if(!(Number(config.commentDailyLimit)>0))return 'daily-quota-zero'
 if(bridgeReady!==true)return 'life-bridge-not-ready'
 return 'configured'
}


/** After the headless video Agent exits, distinguish missing consideration
 * from Life denial or platform uncertainty. This is a *diagnostic* only.
 * Counts never indicate whether model text was correct or content was watched.
 */
export function classifyVideoCommentRound({gate='unknown',pickedCount=null,review={},exitCode=null}={}){
 const count=x=>Number.isSafeInteger(x)&&x>=0?Math.min(40,x):0
 const reviewed=count(review?.reviewed),wanted=count(review?.wanted),passed=count(review?.passed),
  insufficient=count(review?.insufficient),reviewRejected=count(review?.reviewRejected),proposed=count(review?.proposed),approved=count(review?.approved),
  verified=count(review?.verified),unverified=count(review?.unverified),blocked=count(review?.blocked),
  reviewAttempted=count(review?.reviewAttempted),reviewDeferred=count(review?.reviewDeferred),reviewBlocked=count(review?.reviewBlocked)
 let code='no-confirmed-selection'
 if(exitCode!==0)code='video-process-not-completed'
 else if(gate==='life-bridge-not-ready')code='life-bridge-not-ready'
 else if(gate!=='configured')code='comment-config-blocked'
 else if(!Number.isSafeInteger(pickedCount))code='selection-unknown'
 else if(pickedCount===0)code='no-confirmed-selection'
 else if(verified>0)code='platform-verified'
 else if(unverified>0||approved>0)code='platform-unverified'
 else if(blocked>0)code='comment-technically-blocked'
 else if(proposed>0&&count(review?.declined)>0)code='life-declined'
 else if(proposed>0&&count(review?.deferred)>0)code='life-deferred'
 else if(proposed>0)code='proposed-not-approved'
 else if(wanted>0)code='wanted-but-not-proposed'
 // A rejected selection/read receipt remains a technical gap even if another
 // BV in the same round had a genuine voluntary pass.
 else if(reviewRejected>0)code='comment-review-rejected'
 else if(reviewDeferred>0)code='life-deferred'
 else if(reviewBlocked>0)code='comment-review-technical-failure'
 else if(reviewAttempted>0&&reviewed===0)code='comment-review-no-final-decision'
 else if(reviewed===0)code='model-review-not-observed'
 else if(insufficient===reviewed)code='insufficient-evidence'
 else if(passed===reviewed)code='model-chose-not-comment'
 else code='no-publish-after-review'
 return {code,reviewed,wanted,passed,insufficient,reviewRejected,reviewAttempted,reviewDeferred,reviewBlocked,proposed,approved,blocked,verified,unverified}
}
