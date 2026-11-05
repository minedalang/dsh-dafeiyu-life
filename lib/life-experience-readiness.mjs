/**
 * Dev.4 experience acceptance: truthful, read-only status of the existing
 * Life Agent video delegation gates. This is NOT a dry-run send or a promise
 * that the model will choose video exploration.
 */
const nonneg=n=>Number.isFinite(Number(n))?Math.max(0,Number(n)):0
export function lifeExperienceReadiness({config={},planner={},events={},capabilities=[],at=Date.now()}={}){
  const mode=['shadow','active'].includes(config.lifeAgentMode)?config.lifeAgentMode:'off'
  const master=config.masterEnabled===true,plannerEnabled=config.autonomousPlannerEnabled===true
  const pending=nonneg(events.pending),social=nonneg(events.pendingSocial)
  const starts=Math.floor(nonneg(events.videoStartsToday)),lastVideoAt=nonneg(events.lastVideoAt)
  const supported=Array.isArray(capabilities)?capabilities.filter(x=>/^[a-z][a-z0-9_-]{1,30}\.[a-z][a-z0-9_-]{1,38}$/.test(String(x?.id||''))).length:0
  const quota=Math.max(0,Math.min(288,Number.isFinite(Number(config.autonomousPlannerDailyLimit))?Number(config.autonomousPlannerDailyLimit):24))
  const used=nonneg(planner.runs),remaining=Math.max(0,quota-used)
  const blockers=[]
  if(!master)blockers.push('master-off')
  if(!plannerEnabled)blockers.push('planner-off')
  if(mode==='off')blockers.push('not-life-mode')
  if(mode==='shadow')blockers.push('shadow-no-video')
  if(remaining===0)blockers.push('model-quota')
  if(events.ok!==true)blockers.push('event-ledger-unavailable')
  if(supported===0)blockers.push('no-video-capability')
  if(starts>=2)blockers.push('video-day-limit')
  const cooldownUntil=lastVideoAt+180*60_000
  if(lastVideoAt>0&&at<cooldownUntil)blockers.push('video-cooldown')
  const eligible=blockers.length===0
  return {
    mode,decisionEnabled:master&&plannerEnabled&&mode!=='off',
    videoDelegationEligible:eligible,blockers,
    remainingDecisions:remaining,dailyDecisionLimit:quota,
    videoStartsToday:starts,videoStartLimit:2,videoCooldownUntil:lastVideoAt>0&&at<cooldownUntil?cooldownUntil:null,
    offeredVideoCapabilities:supported,pendingEvents:pending,pendingSocialEvents:social,
    lastPlannerResult:String(planner.lastResult||'').slice(0,80),
    // This is eligibility before the next model choice, not execution evidence.
    note:'仅显示当前门禁；不保证有完整可信候选、不保证模型选择探索，也不代表视频已观看。'
  }
}
