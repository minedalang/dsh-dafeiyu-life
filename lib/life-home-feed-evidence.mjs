/** Sanitized, tool-grounded homepage result summary. No user-supplied text or
 * video identifiers enter the Life scheduler journal. An empty list, missing
 * data, and unavailable provider are distinct. */
const BV=/^BV[0-9A-Za-z]{10}$/
export function summarizeHomeFeedResult(raw){
  let value=raw
  if(typeof value==='string'){try{value=JSON.parse(value)}catch{return {status:'unavailable',count:0}}}
  if(!value||typeof value!=='object'||Array.isArray(value)||value.ok!==true||!Array.isArray(value.videos))
    return {status:'unavailable',count:0}
  // Count only valid platform BV candidates, not a model's claimed `count`.
  const ids=new Set(value.videos.slice(0,12).map(v=>String(v?.bvid||'')).filter(id=>BV.test(id)))
  return {status:ids.size?'candidates':'empty',count:ids.size}
}
