/**
 * Legacy helper retained for callers using the former three-argument API.
 * The daily selected-video quota was retired. Only the per-round target
 * matters here; it is advisory and never an outbound write authorization.
 */
export function picksThisRound(_retiredPerDay, pickPerRound, _retiredPickedToday = 0) {
  return Math.max(1, Math.min(50, Math.floor(Number(pickPerRound) || 5)))
}
