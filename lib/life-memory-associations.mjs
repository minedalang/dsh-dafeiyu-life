/** Persisted, model-proposed relations between current public fading episodes.
 * No copied observations, no archive reads, no automatic lexical/semantic edge creation.
 * Only structural and provenance checks here; relation meaning is the model's interpretation.
 */
import {createHash} from 'node:crypto'
const DAY=86400000, HALF_LIFE=30*DAY, MAX_EDGES=512, MAX_RECEIPTS=4
const ACCOUNT=/^[a-f0-9]{16}$/, EPISODE=/^e-[a-f0-9]{18}$/, DIGEST=/^[a-f0-9]{64}$/
// Emotional relations require a separately verified per-episode emotion receipt.
// That source is not available in the current fading copy: do not invent it.
export const ASSOCIATION_TYPES=Object.freeze(['similarity','context','concept','contrast','temporal'])
const types=new Set(ASSOCIATION_TYPES)
const hash=x=>createHash('sha256').update(String(x)).digest('hex')
export const associationText=x=>String(x??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim()
const fingerprint=e=>hash(JSON.stringify([e.id,e.accountTag,e.visibility,e.stage,e.kind,e.at,e.bvid||'',associationText(e.text)]))
function source(e,account,now){return !!e&&EPISODE.test(e.id)&&ACCOUNT.test(account)&&e.accountTag===account&&e.visibility==='public-event'&&e.stage==='clear'&&['watch','comment','social'].includes(e.kind)&&Number.isFinite(e.at)&&e.at<=now&&!!associationText(e.text)}
const strength=(edge,now)=>Math.pow(2,-Math.max(0,now-edge.updatedAt)/HALF_LIFE)*(1+.2*(edge.receipts.length-1))
const edgeId=(a,b,type)=>hash([a,b,type].join('|')).slice(0,32)
function liveEdge(edge,byId,now){
 if(!edge||!types.has(edge.type)||!ACCOUNT.test(edge.accountTag)||!Array.isArray(edge.ends)||edge.ends.length!==2||edge.ends[0]>=edge.ends[1]||edge.id!==edgeId(...edge.ends,edge.type)||!Array.isArray(edge.fingerprints)||edge.fingerprints.length!==2||!edge.fingerprints.every(x=>DIGEST.test(x))||!Array.isArray(edge.receipts)||edge.receipts.length<1||edge.receipts.length>MAX_RECEIPTS||!edge.receipts.every(x=>DIGEST.test(x))||new Set(edge.receipts).size!==edge.receipts.length||!Number.isFinite(edge.createdAt)||!Number.isFinite(edge.updatedAt)||edge.createdAt>edge.updatedAt||edge.updatedAt>now||now-edge.updatedAt>=2*HALF_LIFE)return false
 return edge.ends.every((id,i)=>{const e=byId.get(id);return source(e,edge.accountTag,now)&&fingerprint(e)===edge.fingerprints[i]})
}
export function pruneAssociations(edges,episodes,now){
 if(!Array.isArray(edges)||!edges.length)return []
 const byId=new Map(episodes.map(e=>[e.id,e])),seen=new Set()
 return edges.filter(e=>{if(!liveEdge(e,byId,now)||seen.has(e.id))return false;seen.add(e.id);return true}).slice(0,MAX_EDGES)
}
export function applyAssociationProposals({edges=[],episodes,accountTag,proposals,batchId,now}){
 const next=pruneAssociations(edges,episodes,now).map(e=>({...e,receipts:[...e.receipts]})),byId=new Map(episodes.map(e=>[e.id,e]));let added=0,reinforced=0,duplicates=0,rejected=0
 if(!ACCOUNT.test(accountTag)||!DIGEST.test(String(batchId||''))||!Array.isArray(proposals))return {edges:next,added,reinforced,duplicates,rejected:Array.isArray(proposals)?proposals.length:0}
 for(const p of proposals.slice(0,3)){
  if(!p||!types.has(p.type)||!Array.isArray(p.sources)||p.sources.length!==2){rejected++;continue}
  const sorted=[...p.sources].sort((a,b)=>String(a?.id||'').localeCompare(String(b?.id||'')))
  const a=byId.get(sorted[0]?.id),b=byId.get(sorted[1]?.id)
  if(!source(a,accountTag,now)||!source(b,accountTag,now)||a.id===b.id||a.bvid&&a.bvid===b.bvid||p.type==='temporal'&&a.at===b.at){rejected++;continue}
  // Both complete evidence snapshots must still match after asynchronous model evaluation.
  if(![a,b].every((e,i)=>{const s=sorted[i],text=associationText(e.text),quote=associationText(s.quote);return text===associationText(s.text)&&typeof s.quote==='string'&&typeof s.text==='string'&&quote.length>=6&&quote.length<=160&&text.includes(quote)&&s.at===e.at})){rejected++;continue}
  const ends=[a.id,b.id],id=edgeId(...ends,p.type),existing=next.find(e=>e.id===id)
  if(existing){
   if(existing.receipts.includes(batchId)||existing.receipts.length>=MAX_RECEIPTS){duplicates++;continue}
   existing.receipts=[...existing.receipts,batchId];existing.updatedAt=now;reinforced++;continue
  }
  if(next.length>=MAX_EDGES){rejected++;continue} // no silent eviction of existing relations
  next.push({id,type:p.type,accountTag,ends,fingerprints:[fingerprint(a),fingerprint(b)],createdAt:now,updatedAt:now,receipts:[batchId]});added++
 }
 return {edges:next,added,reinforced,duplicates,rejected}
}
/** At most two hops, eight outgoing edges per node, no cycles, no new models.
 * Eligibility is supplied by the existing scoped retrieval path. */
export function activateAssociations({edges,accountTag,seedIds,eligibleIds,excludeIds=[],limit=2,now}){
 if(!ACCOUNT.test(accountTag)||!Array.isArray(seedIds)||!Array.isArray(eligibleIds))return []
 const allowed=new Set(eligibleIds),seeds=new Set(seedIds.slice(0,3).filter(id=>allowed.has(id))),excluded=new Set([...seeds,...(Array.isArray(excludeIds)?excludeIds:[])])
 const adjacency=new Map(),best=new Map()
 for(const edge of edges){if(edge.accountTag!==accountTag||!edge.ends.every(id=>allowed.has(id)))continue;for(const id of edge.ends){const list=adjacency.get(id)||[];list.push(edge);adjacency.set(id,list)}}
 const visit=(id,seed,path,visited,score)=>{
  if(path.length>=2)return
  const rows=(adjacency.get(id)||[]).sort((a,b)=>strength(b,now)-strength(a,now)||a.id.localeCompare(b.id)).slice(0,8)
  for(const e of rows){const target=e.ends.find(x=>x!==id);if(visited.has(target))continue
   const next=[...path,e],value=score*Math.min(1,strength(e,now))*(path.length?.55:1)
   const candidate={memoryId:target,fromId:seed,edgeIds:next.map(x=>x.id),types:next.map(x=>x.type),score:value}
   if(!excluded.has(target)&&(!best.has(target)||value>best.get(target).score))best.set(target,candidate)
   visit(target,seed,next,new Set([...visited,target]),value)
  }
 }
 for(const seed of seeds)visit(seed,seed,[],new Set([seed]),1)
 return [...best.values()].sort((a,b)=>b.score-a.score||a.memoryId.localeCompare(b.memoryId)).slice(0,Math.max(1,Math.min(3,Number(limit)||2)))
}
export function verifyAssociationPath({edges,accountTag,fromId,memoryId,edgeIds,types:claimedTypes}){
 if(!ACCOUNT.test(accountTag)||!Array.isArray(edgeIds)||edgeIds.length<1||edgeIds.length>2||!Array.isArray(claimedTypes)||claimedTypes.length!==edgeIds.length)return false
 const byId=new Map(edges.filter(x=>x.accountTag===accountTag).map(x=>[x.id,x]));let at=fromId;const visited=new Set([at])
 for(let i=0;i<edgeIds.length;i++){const e=byId.get(edgeIds[i]);if(!e||e.type!==claimedTypes[i]||!e.ends.includes(at))return false;at=e.ends.find(x=>x!==at);if(visited.has(at))return false;visited.add(at)}
 return at===memoryId
}
