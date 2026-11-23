/** Cost-source diagnostics for real Life visual attempts (not a second memory).
 * No BV, model response, screenshots or platform credentials may be emitted.
 * A model status is NOT a provider billing receipt.
 */
export function visualAttemptDiagnostic({action,status='',verified=false,previousFailure=false,existingMemory=false,modelAttempted=false}={}){
  if(!['observe_video','focus_video'].includes(action))return null
  if(existingMemory===true)return {attemptKind:'reused-memory',modelRun:'not-invoked',verification:'not-run'}
  const kind=previousFailure===true?'retry-after-failure':
    status==='cached'?'reused-cache':action==='focus_video'?'new-focus-evidence':'new-overview'
  const modelRun=status==='cached'?'cache-hit-reported':
    status==='analyzed'?'analysis-reported':
    modelAttempted===true?'attempt-reported':'unknown'
  return {attemptKind:kind,modelRun,verification:verified===true?'verified':'unverified'}
}
