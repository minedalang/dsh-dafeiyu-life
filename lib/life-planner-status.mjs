/**
 * Read-only management projection for the existing Life planner and Episode
 * ledger. The planner counters are independent of optional account-scoped
 * Episode diagnostics; an unavailable account must never weaken Episode scope.
 */
const ACCOUNT_SCOPE = /^[a-f0-9]{16}$/

const readOptional = (fn, fallback) => {
  try { return { ok: true, value: fn() } }
  catch { return { ok: false, value: fallback } }
}

export function readLifePlannerDiagnostics({
  accountTag = '',
  accountBlocked = false,
  episodes,
  eligibleSources = () => [],
  attribution,
  resourceScheduler,
  projectSettings = () => null,
  socialDecisionOwnership,
  socialSendTransaction,
  socialShadow
} = {}) {
  const accountReady = accountBlocked !== true && ACCOUNT_SCOPE.test(String(accountTag || ''))
  const episodeList = accountReady
    ? readOptional(() => episodes.list({ limit: 5, includeClosed: true }), [])
    : { ok: false, value: [] }
  let episodeHealth = { ok: false, value: null }
  let sourceStatus = 'not-read'
  if (accountReady && episodeList.ok) {
    const sources = readOptional(() => eligibleSources(), [])
    if (!sources.ok) sourceStatus = 'unavailable'
    else {
      sourceStatus = 'available'
      episodeHealth = readOptional(() => episodes.health({ eligibleSources: sources.value }), null)
    }
  }

  const reason = !accountReady ? 'account-not-ready'
    : !episodeList.ok ? 'episode-storage-unavailable'
      : sourceStatus !== 'available' ? 'episode-sources-unavailable'
        : !episodeHealth.ok ? 'episode-health-unavailable' : 'ready'

  return {
    lifeEpisodes: episodeList.value,
    lifeEpisodeHealth: episodeHealth.value,
    lifeEpisodeStatus: {
      accountReady,
      listAvailable: episodeList.ok,
      sourcesAvailable: sourceStatus === 'available',
      healthAvailable: episodeHealth.ok,
      reason
    },
    // Attribution/resource status contains only bounded aggregate counters;
    // no Episode content, account identifiers or private source references.
    lifeActionAttribution: readOptional(() => attribution?.status?.() ?? null, null).value,
    lifeResourceCoordination: readOptional(() => resourceScheduler?.status?.() ?? null, null).value,
    lifeSettingsPreview: readOptional(() => projectSettings(), null).value,
    socialDecisionOwnership: accountReady
      ? readOptional(() => socialDecisionOwnership?.status?.() ?? null, null).value : null,
    socialSendTransaction: accountReady
      ? readOptional(() => socialSendTransaction?.inspect?.() ?? null, null).value : null,
    socialShadow: accountReady
      ? readOptional(() => socialShadow?.status?.() ?? null, null).value : null
  }
}
