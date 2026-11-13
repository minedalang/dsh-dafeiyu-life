/**
 * Read-only owner diagnosis: connect EXISTING verified exploration, scoped
 * interests and public reflection counters. Never assert a trait changed just
 * because a read/selection occurred. No UID, BV, DM, model prose or tokens.
 */
const bounded=x=>Number.isFinite(Number(x))?Math.max(0,Math.min(9999,Math.floor(Number(x)))):0
export function projectLifeGrowthAttribution({yieldEvidence={},interestEvidence=[],reflection={}}={}){
  const interested=(Array.isArray(interestEvidence)?interestEvidence:[])
    .filter(x=>x?.source==='interest-milestone'&&['emerging','growing','stable'].includes(x.stage)&&
      bounded(x.evidenceCount)>=3&&bounded(x.evidenceDays)>=2)
    .slice(0,8).map(x=>({stage:x.stage,evidenceCount:bounded(x.evidenceCount),
      evidenceDays:bounded(x.evidenceDays)}))
  const publicRun=reflection?.recentPublicRun?.personalityEnabled===true?reflection.recentPublicRun:null
  return {
    scope:'current-account-public-evidence-only',
    exploration:{episodes:bounded(yieldEvidence.episodes),verifiedVideoMetadata:bounded(yieldEvidence.video),
      verifiedDiscussionItems:bounded(yieldEvidence.discussion),verifiedCreatorPosts:bounded(yieldEvidence.creator),
      verifiedHomeCandidates:bounded(yieldEvidence.home)},
    independentInterestMilestones:interested,
    reflection:publicRun?{personalityObserved:bounded(publicRun.personalityObserved),
      personalityProposed:bounded(publicRun.personalityProposed),
      personalityAccepted:bounded(publicRun.personalityAccepted),
      processed:bounded(publicRun.processed)}:null,
    caveat:'新读取与兴趣证据不等于喜欢。人格变化仅以原反思和人格账本的实际记录为准；此处不产生偏好、人格或写入授权。'
  }
}
