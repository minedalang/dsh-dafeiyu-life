/**
 * Owner-only, READ-ONLY drawing projection for the current recallable garden.
 * Neither a neural simulation nor another memory index. Every edge requires
 * a shared, already-verified source reference; matching words alone do not
 * create emotional, interpersonal or interest relationships.
 */
import {createHash} from 'node:crypto'
const KINDS=new Set(['experience','relationship','interest','fact'])
const clean=(v,n=180)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const safeId=v=>typeof v==='string'&&/^[a-zA-Z0-9:_-]{3,120}$/.test(v)?v:''
const token=s=>createHash('sha256').update(String(s)).digest('hex').slice(0,16)
const FOOD_QUERY=/(?:喜欢吃|爱吃|想吃|吃什么|吃的|美食|食物|口味|零食|水果|饭菜|好吃)/i
const FOOD_TOPIC=/(?:美食|食物|饮食|口味|零食|水果|蔬菜|饭|菜|甜点|饮料|肉|蛋|鱼|米|面|早餐|午餐|晚餐|小吃|烹饪|做饭)/i
const allowInterestQuery=(m,q)=>{
 if(m?.gardenEvidence!=='selected-video-trend'||!q)return true
 const topic=String(Array.isArray(m.tags)?m.tags[0]||'':m.topic||'')
 if(FOOD_QUERY.test(q))return FOOD_TOPIC.test(topic)||Boolean(topic&&q.includes(topic))
 const specific=q.replace(/大肥鱼|肥鱼|鱼鱼|喜欢|喜爱|爱好|兴趣|偏好|最近|什么|想看|想了解|最近的|过去|曾经/g,'').replace(/[\s，。！？、,.!?]/g,'')
 return Boolean(specific)||Boolean(topic&&q.includes(topic))
}
const keywordRelevance=(m,q)=>{
 if(!q)return 0
 const clearBV=m?.stage==='clear'&&['watch','action'].includes(m?.kind)&&/^BV[0-9A-Za-z]{10}$/.test(String(m?.bvid||''))?m.bvid:''
 const fields=[m?.text,m?.summary,m?.事实键,clearBV,...(Array.isArray(m?.tags)?m.tags:[])].map(v=>String(v||'').toLocaleLowerCase())
 const text=fields.join(' ')
 // A concrete numeric/Latin identifier (e.g. memory-9997) must match
 // literally; broad Chinese bigrams alone cannot match 10k unrelated IDs.
 const identifiers=q.match(/[a-z0-9]{3,}/g)||[]
 if(identifiers.some(id=>!text.includes(id)))return 0
 if(text.includes(q))return 1.2+Math.min(.08,q.length/120)
 const terms=[]
 for(const part of q.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g)||[]){
  if(/[a-z0-9]/i.test(part))terms.push(part)
  else if(part.length===1)terms.push(part)
  else for(let i=0;i<part.length-1;i++)terms.push(part.slice(i,i+2))
 }
 const unique=[...new Set(terms)]
 if(!unique.length)return 0
 return unique.filter(term=>fields.some(field=>field.includes(term))).length/unique.length
}
/** Stable opaque graph ID, shared by the memory projection and semantic layout. */
export const neuralProjectionKey=m=>{
  const kind=KINDS.has(m?.gardenKind)?m.gardenKind:'experience'
  const label=clean(m?.text||m?.summary,115)
  return token(kind+':'+String(m?.id||m?.bvid||'')+':'+String(m?.createdAt||m?.at||'')+':'+label)
}
/** Ephemeral observation of a real, verified public-memory recall return. It is
 * not a thought log, a memory store, or a model-use/action receipt. */
export function createNeuralActivationTracker({getAccountTag,getEpoch=()=>0,validateRecall,validatePath,now=Date.now}={}){
 let latest=null,sequence=0;const seen=new WeakSet(),ttl=5*60_000
 const channels=new Set(['life','main-chat','owner-dm','friend-dm'])
 const scope=tag=>/^[a-f0-9]{16}$/.test(String(tag||''))&&tag===getAccountTag()
 const record=({accountTag='',rows=[],channel='life'}={})=>{
  try{
   if(!scope(accountTag)||!channels.has(channel)||!Array.isArray(rows)||seen.has(rows))return false
   const epoch=getEpoch()
   const linked=rows.find(row=>row.recallRoute==='association'&&row.associationProof)
   const p=linked?.associationProof
   if(!p||p.memoryId!==linked.memoryId||!rows.some(row=>row.memoryId===p.fromId&&['exact','direct'].includes(row.recallRoute))||!validateRecall({accountTag,rows})||!scope(accountTag)||getEpoch()!==epoch)return false
   const at=now();if(!Number.isFinite(at))return false
   latest={accountTag,epoch,channel,at,id:token('recall:'+at+':'+(++sequence)),fromId:p.fromId,memoryId:p.memoryId,edgeIds:[...p.edgeIds],types:[...p.types]};seen.add(rows);return true
  }catch{return false}
 }
 const read=accountTag=>{
  try{
   if(!latest||!scope(accountTag)||latest.accountTag!==accountTag||latest.epoch!==getEpoch()||now()<latest.at||now()-latest.at>=ttl||!validatePath(latest)||!scope(accountTag)||latest.epoch!==getEpoch()){latest=null;return null}
   return {...latest,edgeIds:[...latest.edgeIds],types:[...latest.types]}
  }catch{latest=null;return null}
 }
 return {record,read}
}
/** Convert already verified representative IDs to the same opaque graph IDs;
 * never expose storage identity, account, query, or the original edge hash. */
export function projectNeuralActivation(receipt,steps,episodeRows){
 if(!receipt||!Array.isArray(steps)||!steps.length||steps.length!==receipt.types.length)return null
 const ids=new Map(episodeRows.map(row=>[row.id,neuralProjectionKey({...row,gardenKind:'experience',gardenEvidence:'fading-life-episode'})]))
 const path=steps.map(step=>({from:ids.get(step.from),to:ids.get(step.to),associationType:step.type}))
 if(path.some((step,i)=>!step.from||!step.to||step.associationType!==receipt.types[i]||step.from===step.to||i>0&&path[i-1].to!==step.from))return null
 return {id:receipt.id,at:receipt.at,steps:path,...(['life','main-chat','owner-dm','friend-dm'].includes(receipt.channel)?{channel:receipt.channel}:{})}
}
const refsFor=m=>{
  // Explicit source IDs from verified ledgers only; tags/title/semantic overlap
  // never prove a relationship. Don't pass source IDs to the browser.
  const raw=[...(Array.isArray(m?.sourceIds)?m.sourceIds:[]),
    ...(Array.isArray(m?.evidenceRefs)?m.evidenceRefs:[]),
    ...(Array.isArray(m?.sourceRefs)?m.sourceRefs:[]),
    m?.sourceEventId,m?.episodeId,m?.originEventId]
  return new Set(raw.map(safeId).filter(Boolean).slice(0,16))
}
const candidate=m=>{
  const kind=KINDS.has(m?.gardenKind)?m.gardenKind:'experience'
  const label=clean(m?.text||m?.summary,115)
  if(!label||m?.deletedAt||m?.已被取代||m?.stage==='forgotten')return null
  const clearBV=m?.stage==='clear'&&['watch','action'].includes(m?.kind)&&/^BV[0-9A-Za-z]{10}$/.test(String(m?.bvid||''))?m.bvid:''
  return {id:neuralProjectionKey(m),kind,
    ...(clearBV?{bvid:clearBV}:{}),
    title:label.slice(0,46),summary:clean(m?.text||m?.summary,330),time:clean(m?.createdAt||m?.at,35),
    source:clean(m?.gardenEvidence||m?.source||m?.kind,65),
    clarity:['clear','fuzzy','trace'].includes(m?.stage)?m.stage:'unmarked',
    refs:refsFor(m),
    // Emotion is only supported by an explicit original emotion observation
    // bound to an evidence id; a current mood must NEVER be backdated.
    emotion:typeof m?.emotionObservation==='object'&&
      safeId(m.emotionObservation.sourceEventId)&&refsFor(m).has(m.emotionObservation.sourceEventId)
      ?clean(m.emotionObservation.mood,28):''}
}
/**
 * Dense owner-side projection. `showAll` is opt-in for backwards compatibility:
 * the full scene keeps genuine nonmatching memories as dim context, while the
 * search hits remain colored. This does not create memories or cross-category
 * evidence, and never returns private source IDs.
 */
export function memoryNeuralProjection({gardenRows=[],episodes=[],limit=60,query='',kind='',showAll=false,semanticMatchIds=[],semanticScores={},verifiedGraph=null}={}){
  const max=Math.max(1,Math.min(10000,Math.floor(Number(limit)||60)))
  const q=clean(query,120).toLocaleLowerCase(),filter=KINDS.has(kind)?kind:''
  const semanticIds=new Set(Array.isArray(semanticMatchIds)?semanticMatchIds:[])
  const all=[...(Array.isArray(gardenRows)?gardenRows:[]),
    ...(Array.isArray(episodes)?episodes:[]).map(x=>({...x,gardenKind:'experience',gardenEvidence:'fading-life-episode'}))]
  const seen=new Set(),candidates=[],allCandidates=[],rawIds=new Map(),emotionById=new Map((verifiedGraph?.emotions||[]).map(e=>[e.id,e]))
  for(const m of all){
    const x=candidate(m)
    if(!x||seen.has(x.id))continue
    seen.add(x.id)
    rawIds.set(m.id,x.id)
    if(verifiedGraph!==null)x.emotion=''
    const observed=emotionById.get(m.id)
    if(observed&&x.clarity==='clear'&&m.gardenEvidence==='fading-life-episode'){x.emotion=observed.mood;x.emotionAt=observed.at;x.emotionSource=observed.source}
    allCandidates.push(x)
    // Legacy trace episodes deliberately lost event identity/time; they are
    // a dim background only, not a searchable current recollection.
    const fadedTrace=x.source==='fading-life-episode'&&x.clarity==='trace'
    const interestAllowed=allowInterestQuery(m,q)
    const keywordScore=keywordRelevance(m,q)
    const textMatch=!fadedTrace&&interestAllowed&&(!q||keywordScore>=.25)
    const cosine=Number(semanticScores?.[x.id])
    const semanticHit=!fadedTrace&&interestAllowed&&semanticIds.has(x.id)&&Number.isFinite(cosine)&&cosine>=-1&&cosine<=1
    if(semanticHit)x.similarity=Number(cosine.toFixed(4))
    const semanticScore=semanticHit?(cosine+1)/2:0
    x.relevanceScore=textMatch&&semanticHit?Math.max(keywordScore,semanticScore)+.025:textMatch?keywordScore:semanticScore
    x.matchType=textMatch&&semanticHit?'keyword+embedding':textMatch?'keyword':semanticHit?'embedding':''
    x.matched=(!filter||x.kind===filter)&&(textMatch||semanticHit)
    if(showAll||x.matched)candidates.push(x)
  }
  // Hits first, then unmatched context by original recency/order; a late match
  // must not vanish behind the node cap because older material is abundant.
  if(q)candidates.sort((a,b)=>Number(b.matched)-Number(a.matched)||
    (b.matched?(Number(b.relevanceScore)||0)-(Number(a.relevanceScore)||0):0)||
    (Date.parse(b.time||'')||0)-(Date.parse(a.time||'')||0))
  const nodes=candidates.slice(0,max)
  const matchCount=nodes.filter(x=>x.matched).length
  // Evidence index gives O(n * small source-ref set) work, rather than the
  // former quadratic pairwise scan (10k nodes could require 50M comparisons).
  const refOwners=new Map(),edges=[],edgeKeys=new Set(),counts={interest:0,relationship:0,source:0},fullCounts={interest:0,relationship:0,source:0,association:0},visibleIds=new Set(nodes.map(n=>n.id)),allIds=new Set(allCandidates.map(n=>n.id))
  for(const m of verifiedGraph===null?nodes:[]){
    for(const ref of m.refs){
      const prior=refOwners.get(ref)||[]
      // Render bounded star links for repeated evidence, not a complete clique.
      for(const other of prior.slice(0,2)){
        const type=m.kind==='interest'||other.kind==='interest'?'interest':m.kind==='relationship'||other.kind==='relationship'?'relationship':'source'
        const key=[m.id,other.id].sort().join('|')
        if(edgeKeys.has(key))continue
        edgeKeys.add(key);edges.push({from:other.id,to:m.id,type,evidence:'shared-verified-source'});counts[type]++
        if(edges.length>=2500)break
      }
      if(prior.length<4)prior.push(m)
      refOwners.set(ref,prior)
      if(edges.length>=2500)break
    }
    if(edges.length>=2500)break
  }
  // Verified gateway edges use exact live IDs. No browser-visible raw identifiers.
  // Legacy explicit-reference edges remain bounded and visible-only; their counts
  // are separately labelled, not claimed as exhaustive historical relations.
  Object.assign(fullCounts,counts)
  const verifiedSeen=new Set(),associationTypes={similarity:0,context:0,concept:0,contrast:0,temporal:0}
  for(const e of verifiedGraph?.links||[]){
    const from=rawIds.get(e.from),to=rawIds.get(e.to)
    if(!from||!to||from===to||!allIds.has(from)||!allIds.has(to)||!Object.hasOwn(fullCounts,e.type))continue
    const key=[from,to].sort().join('|'),typed=e.type+'|'+key+'|'+(e.associationType||'')
    if(verifiedSeen.has(typed)||e.type!=='association'&&edgeKeys.has(key))continue
    verifiedSeen.add(typed);fullCounts[e.type]++
    if(e.type==='association'&&Object.hasOwn(associationTypes,e.associationType))associationTypes[e.associationType]++
    if(!visibleIds.has(from)||!visibleIds.has(to)||(e.type==='association'?(counts.association||0)>=512:edges.length-(counts.association||0)>=2500))continue
    counts[e.type]=(counts[e.type]||0)+1
    edges.push({from,to,type:e.type,evidence:e.evidence,sourceCount:e.sourceCount||1,...(e.type==='association'?{associationType:e.associationType,strength:e.strength,confirmations:e.confirmations,updatedAt:e.updatedAt}:{})})
  }
  return {ok:true,query:q,kind:filter,nodes:nodes.map(({refs,...node})=>node),edges,
    evidenceTotals:fullCounts,associationTypes,emotionCount:allCandidates.filter(n=>n.emotion).length,visibleEmotionCount:nodes.filter(n=>n.emotion).length,
    total:nodes.length,available:candidates.length,matched:matchCount,nonmatching:nodes.length-matchCount,
    truncated:candidates.length>nodes.length,edgeCounts:counts,
    matchingMode:semanticIds.size?'embedding-and-keyword':'keyword',
    note:'只读当前可回忆记录；搜索结果按相关性排序；已衰减成印象的残缺经历仅作灰色背景，不进入命中列表。连线由当前有效的真实来源或经核验的历史模型关联构成；历史情绪仅显示同源模型信号。'}
}
