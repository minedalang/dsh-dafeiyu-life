/**
 * Versioned, non-destructive recommended experience settings.
 * Existing installations retain their saved values until the owner explicitly
 * restores a group in the management console and clicks its normal Save button.
 * Never include credentials, private identities, enabled/authorization toggles,
 * or per-user message/publish quotas in a reset group.
 */
export const RECOMMENDED_EXPERIENCE_VERSION='2.6.0-dev.4'
export const RECOMMENDED_EXPERIENCE_GROUPS=Object.freeze({
  reflection:Object.freeze({
    mainSessionReflectionMinCandidates:6,
    mainSessionReflectionBatchSize:24,
    mainSessionReflectionIntervalHours:1,
    mainSessionReflectionDailyBatches:16,
  }),
  recall:Object.freeze({
    mainSessionMemoryHalfLifeDays:30,
    mainSessionMemoryThreshold:0.35,
    mainSessionMemoryMaxItems:8,
    mainSessionMemoryMaxChars:1200,
    mainSessionMemoryDailyQuota:30,
    mainSessionMemoryFactsMax:2,
  }),
  retrieval:Object.freeze({
    mainSessionMemoryCandidates:48,
    mainSessionMemorySearchDailyLimit:80,
  }),
  commentContext:Object.freeze({commentReplyHotCount:12}),
  dmContext:Object.freeze({dmContextMessages:40}),
})
export const RECOMMENDED_EXPERIENCE_SETTINGS=Object.freeze({
  version:RECOMMENDED_EXPERIENCE_VERSION,
  groups:RECOMMENDED_EXPERIENCE_GROUPS,
})
