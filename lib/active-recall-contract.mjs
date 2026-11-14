/** Cross-channel, read-only AI recall request contract.
 * This validates model-suggested search terms, NOT identity, privacy or memory.
 * Retrieval remains owned by MemoryRetriever / the authoritative receipt ledgers.
 */
const tidy=(value,max=96)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
/** Up to three independent search formulations. Never interpret a UID, role,
 * archive path or model-authored scope as an authorization. */
export function normalizeRecallQueries(raw,{limit=3,maxChars=96}={}){
  const values=Array.isArray(raw)?raw:[raw]
  const seen=new Set(),out=[]
  for(const value of values.slice(0,12)){
    if(typeof value!=='string')continue
    const term=tidy(value,maxChars)
    if(term.length<2||seen.has(term.toLocaleLowerCase()))continue
    // A recall term is data only; reject URLs and control-like payloads rather
    // than allowing them to become an untrusted retrieval instruction.
    if(/https?:\/\/|(?:SESSDATA|bili_jct|access[_-]?token|api[_-]?key)/i.test(term))continue
    seen.add(term.toLocaleLowerCase());out.push(term)
    if(out.length>=Math.max(1,Math.min(3,limit)))break
  }
  return out
}
/** Join already privacy-filtered evidence only; never combine raw archives. */
export function combineRecallContext(parts,{maxChars=1200}={}){
  const seen=new Set(),lines=[]
  for(const part of parts){
    for(const line of String(part||'').split('\n')){
      const v=tidy(line,460)
      if(!v||seen.has(v))continue
      seen.add(v);lines.push(v)
    }
  }
  return lines.join('\n').slice(0,Math.max(150,Math.min(2500,maxChars)))
}
