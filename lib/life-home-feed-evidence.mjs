/** Sanitized, tool-grounded homepage result summary. No user-supplied text or
 * video identifiers enter the Life scheduler journal. An empty list, missing
 * data, and unavailable provider are distinct. */
const BV=/^BV[0-9A-Za-z]{10}$/
export function summarizeHomeFeedResult(raw,{includeCandidateBvids=false}={}){
  let value=raw
  if(typeof value==='string'){try{value=JSON.parse(value)}catch{return {status:'unavailable',count:0}}}
  if(!value||typeof value!=='object'||Array.isArray(value)||value.ok!==true||!Array.isArray(value.videos))
    return {status:'unavailable',count:0}
  // Count only valid platform BV candidates, not a model's claimed `count`.
  const candidateBvids=[...new Set(value.videos.slice(0,12).map(v=>String(v?.bvid||'')).filter(id=>BV.test(id)))]
  const summary={status:candidateBvids.length?'candidates':'empty',count:candidateBvids.length}
  // Raw IDs stay in process memory only long enough for the account-scoped
  // Life event ledger to hash them. They are never returned to the planner.
  if(includeCandidateBvids===true)summary.candidateBvids=candidateBvids
  return summary
}
