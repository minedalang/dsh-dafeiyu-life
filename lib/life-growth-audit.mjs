/**
 * Account-scoped, read-only coverage projection from existing Life traces.
 * This is NOT model attention, counterfactual causation, or a growth writer.
 * Inputs are already redacted Life decision traces; no IDs or prose returned.
 */
const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(10000, value) : 0
export function projectLifeGrowthAudit({runs=[]}={}) {
  const rows = (Array.isArray(runs) ? runs : []).slice(0, 30)
  const audit = {
    scope: 'current-account-recent-traces',
    inspectedRuns: rows.length,
    modelDecisions: 0,
    lifeVoiceOffered: 0,
    experienceContextOffered: 0,
    publicInterestEvidenceOffered: 0,
    publicMemoryEvidenceOffered: 0,
    interestCueCandidates: 0,
    episodesOffered: 0,
    verifiedReadReceipts: 0,
    newEvidenceReadSteps: 0,
    noNoveltyReadSteps: 0,
    memoryProjectionsQueued: 0,
    verifiedExternalWrites: 0,
    episodeStepLimits: 0,
    unsettledRuns: 0,
    causalLinkConfirmed: false,
    meaning: '仅统计模型输入类别、候选、已核验回执与记忆排队。模型是否使用人格/兴趣作出决定、某条经历是否导致特质变化，现有日志不能证明。'
  }
  for (const row of rows) {
    const steps = Array.isArray(row?.steps) ? row.steps.slice(0, 96) : []
    const inputs = steps.filter(x => x?.type === 'model-input')
    audit.modelDecisions += steps.some(x => x?.type === 'model-choice') ? 1 : 0
    audit.lifeVoiceOffered += inputs.some(x => x.contextSources?.includes('life-voice')) ? 1 : 0
    audit.experienceContextOffered += inputs.some(x => x.contextSources?.includes('verified-read-evidence') || x.contextSources?.includes('episode-summary')) ? 1 : 0
    audit.publicInterestEvidenceOffered += inputs.some(x => x.contextSources?.includes('public-interest-evidence')) ? 1 : 0
    audit.publicMemoryEvidenceOffered += inputs.some(x => x.contextSources?.includes('public-memory-evidence')) ? 1 : 0
    audit.interestCueCandidates += steps.some(x => x?.type === 'candidate-scan' && count(x.cues) > 0) ? 1 : 0
    audit.episodesOffered += steps.some(x => x?.type === 'episode-context' && count(x.episodeOffered) > 0) ? 1 : 0
    audit.verifiedReadReceipts += steps.filter(x => x?.type === 'read-result' && x.state === 'verified').length
    audit.newEvidenceReadSteps += steps.filter(x => x?.type === 'experience-yield' && x.newEvidence === true).length
    audit.noNoveltyReadSteps += steps.filter(x => x?.type === 'experience-yield' && x.newEvidence === false).length
    audit.memoryProjectionsQueued += steps.filter(x => x?.type === 'memory-projection' && x.state === 'queued').length
    audit.verifiedExternalWrites += steps.filter(x => x?.type === 'execution-result' && x.result === 'verified' && x.delivery === 'platform-confirmed').length
    audit.episodeStepLimits += steps.filter(x => x?.type === 'action-result' && x.result === 'episode-step-limit').length
    audit.unsettledRuns += ['decision-unsettled', 'approval-unsettled', 'result-uncertain'].includes(row?.presentation) ? 1 : 0
  }
  for (const key of Object.keys(audit)) if (typeof audit[key] === 'number') audit[key] = count(audit[key])
  return audit
}
