/**
 * Owner-only, READ-ONLY drawing projection for the current recallable garden.
 * Neither a neural simulation nor another memory index. Every edge requires
 * a shared, already-verified source reference; matching words alone do not
 * create emotional, interpersonal or interest relationships.
 */
import {createHash,randomBytes} from 'node:crypto'
import {lstatSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs'
import {withDurableFileLock} from './durable-file-lock.mjs'
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
export function createNeuralActivationTracker({getAccountTag,getEpoch=()=>0,validateRecall,validatePath,validateImmediate=()=>false,historyFile=null,getHistoryIdentity=()=>'',now=Date.now}={}){
 let latest=null,pending=[],attempted=[],stats=null,history=[],activities=[],historyStorage=historyFile?'local':'memory';const seen=new WeakSet(),observedRows=new WeakSet(),claims=new WeakSet(),ttl=86400000
 const pairKey=r=>[r.fromId,r.memoryId].sort().join(':')
 const pruneAttempts=(tag,epoch,at)=>{attempted=attempted.filter(r=>r.tag===tag&&r.epoch===epoch&&at>=r.at&&at-r.at<86400000)}
 const channels=new Set(['life','main-chat','owner-dm','friend-dm'])
 const scope=tag=>/^[a-f0-9]{16}$/.test(String(tag||''))&&tag===getAccountTag()
 const scopedStats=tag=>{
  if(!scope(tag)){stats=null;latest=null;history=[];activities=[];return null}
  const epoch=getEpoch()
  if(!stats||stats.tag!==tag||stats.epoch!==epoch){latest=null;history=[];activities=[];stats={tag,epoch,observed:0,matched:0,candidates:0,verified:0,at:0,state:'no-observation',lastVerifiedAt:0,pathState:''}}
  return stats
 }
 const activity=(d,channel,state,at,kind='visual')=>{
  d.observed++;d.at=at;d.state=state
  const row={id:randomBytes(8).toString('hex'),at,channel,state,kind}
  activities=[...activities,row].slice(-20);return row
 }
 const saveReceipt=(d,receipt,row)=>{
  latest=receipt;history=[...history,receipt].slice(-20)
  d.verified++;d.lastVerifiedAt=receipt.at;d.state='verified';d.pathState='verified';row.state='verified';row.receiptId=receipt.id
 }
 // Explicit, delivered public episode IDs only; never store text, query or private IDs.
 const opaque=/^[a-f0-9]{16}$/,episode=/^e-[a-f0-9]{18}$/,edge=/^[a-f0-9]{32}$/
 const relationTypes=new Set(['similarity','context','concept','contrast','temporal','emotion'])
 const states=new Set(['no-hit','ordinary-recall','no-association','rejected','verified','invalidated','expired','unavailable'])
 const safeHistoryFile=()=>{try{const st=lstatSync(historyFile);if(!st.isFile()||st.isSymbolicLink()||st.size>32768)throw Error('recall-history-file-unsafe');return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
 const validReceipt=(p,tag,epoch)=>p&&opaque.test(p.id)&&p.accountTag===tag&&p.epoch===epoch&&channels.has(p.channel)&&Number.isSafeInteger(p.at)&&episode.test(p.fromId)&&episode.test(p.memoryId)&&p.fromId!==p.memoryId&&Array.isArray(p.edgeIds)&&Array.isArray(p.types)&&(p.mode==='immediate'?p.edgeIds.length===0&&p.types.length===1&&p.types[0]==='immediate'&&/^[a-f0-9]{64}$/.test(p.fingerprint):p.mode===undefined&&p.edgeIds.length>=1&&p.edgeIds.length<=2&&p.edgeIds.every(x=>edge.test(x))&&p.types.length===p.edgeIds.length&&p.types.every(x=>relationTypes.has(x)))
 const validActivity=a=>a&&opaque.test(a.id)&&Number.isSafeInteger(a.at)&&channels.has(a.channel)&&states.has(a.state)&&['visual','episode'].includes(a.kind)&&(!a.receiptId||opaque.test(a.receiptId))
 // Optional local observation cache only. Same character, verified account and
 // persistent binding generation; no queries, text, private records or authority.
 // Never restore it through business backup. Revalidate every path before use.
 const withHistory=(tag,fn)=>{
  if(!historyFile)return fn()
  const d=scopedStats(tag),identity=getHistoryIdentity();if(!d||!identity)return fn()
  let invoked=false,result
  try{return withDurableFileLock(historyFile+'.lock',()=>{
   const epoch=getEpoch(),exists=safeHistoryFile();let old=null
   if(exists){old=JSON.parse(readFileSync(historyFile,'utf8'));if(old?.version!==1||!Array.isArray(old.paths)||!Array.isArray(old.activities)||old.paths.length>20||old.activities.length>20)throw Error('recall-history-invalid')}
   if(old&&old.identity===identity&&old.accountTag===tag&&old.epoch===epoch){
    history=old.paths.filter(p=>validReceipt(p,tag,epoch)).map(p=>({id:p.id,accountTag:tag,epoch,channel:p.channel,at:p.at,fromId:p.fromId,memoryId:p.memoryId,edgeIds:[...p.edgeIds],types:[...p.types],...(p.mode==='immediate'?{mode:'immediate',fingerprint:p.fingerprint}:{})}));activities=old.activities.filter(validActivity).map(a=>({id:a.id,at:a.at,channel:a.channel,state:a.state,kind:a.kind,...(a.receiptId?{receiptId:a.receiptId}:{})}));latest=history.at(-1)||null
   }else{history=[];activities=[];latest=null}
   historyStorage='local';invoked=true;result=fn()
   if(!scope(tag)||getEpoch()!==epoch||getHistoryIdentity()!==identity){history=[];activities=[];latest=null;return result}
   const next={version:1,identity,accountTag:tag,epoch,paths:history.filter(p=>validReceipt(p,tag,epoch)),activities:activities.filter(validActivity)};const raw=JSON.stringify(next)+'\n'
   if((history.length||activities.length||old)&&JSON.stringify(old)!==JSON.stringify(next)&&Buffer.byteLength(raw)<=32768){
    safeHistoryFile();const tmp=historyFile+'.'+randomBytes(12).toString('hex')+'.tmp'
    try{writeFileSync(tmp,raw,{flag:'wx',mode:0o600});renameSync(tmp,historyFile)}finally{try{unlinkSync(tmp)}catch{}}
   }
   return result
  })}catch{
   // A busy/corrupt observation cache is not a memory read failure. Do not
   // replay disk data that could not be checked or overwrite an unsafe file.
   historyStorage='unavailable';if(invoked)return result
   history=[];activities=[];latest=null;return fn()
  }
 }
 const recordPublicEpisodes=({accountTag='',ids=[],channel='main-chat',proof=null}={})=>withHistory(accountTag,()=>{
  try{
   if(!scope(accountTag)||!channels.has(channel)||!Array.isArray(ids))return false
   const d=scopedStats(accountTag),at=now();if(!d||!Number.isFinite(at))return false
   prune(accountTag);const row=activity(d,channel,ids.length?'ordinary-recall':'no-hit',at,'episode');if(ids.length)d.matched++
   if(!proof)return true
   d.candidates++;d.state=row.state='rejected'
   if(!ids.includes(proof.fromId)||!ids.includes(proof.memoryId)||proof.edgeIds?.length!==1||!validatePath({accountTag,...proof})||!scope(accountTag)||d.epoch!==getEpoch())return false
   saveReceipt(d,{accountTag,epoch:d.epoch,channel,at,id:randomBytes(8).toString('hex'),fromId:proof.fromId,memoryId:proof.memoryId,edgeIds:[...proof.edgeIds],types:[...proof.types]},row);return true
  }catch{return false}
 })
 const record=({accountTag='',rows=[],channel='life'}={})=>withHistory(accountTag,()=>{
  try{
   if(!scope(accountTag)||!channels.has(channel)||!Array.isArray(rows)||seen.has(rows))return false
   const epoch=getEpoch(),d=scopedStats(accountTag)
   if(!d||observedRows.has(rows))return false
   prune(accountTag);observedRows.add(rows);const row=activity(d,channel,rows.length?'no-association':'no-hit',now());const valid=validateRecall({accountTag,rows})===true;if(rows.length&&valid)d.matched++;if(!valid)d.state=row.state='rejected'
   const linked=rows.find(row=>row.recallRoute==='association'&&(row.associationProof||row.immediateProof))
   const immediate=Boolean(linked?.immediateProof&&!linked.associationProof),p=linked?.associationProof||linked?.immediateProof
   if(linked){d.candidates++;d.state=row.state='rejected'}
   if(!p||p.memoryId!==linked.memoryId||!rows.some(row=>row.memoryId===p.fromId&&['exact','direct'].includes(row.recallRoute))||!valid||!scope(accountTag)||getEpoch()!==epoch)return false
   const at=now();if(!Number.isFinite(at))return false
   if(immediate&&!validateImmediate({accountTag,...p}))return false
   latest={accountTag,epoch,channel,at,id:randomBytes(8).toString('hex'),fromId:p.fromId,memoryId:p.memoryId,...(immediate?{mode:'immediate',fingerprint:p.fingerprint,edgeIds:[],types:['immediate']}:{edgeIds:[...p.edgeIds],types:[...p.types]})}
   if(immediate){pruneAttempts(accountTag,epoch,at);pending=pending.filter(r=>r.accountTag===accountTag&&r.epoch===epoch&&at>=r.at&&at-r.at<86400000&&!(r.fromId===p.fromId&&r.memoryId===p.memoryId||r.fromId===p.memoryId&&r.memoryId===p.fromId)).slice(-15);if(!attempted.some(r=>r.key===pairKey(latest))&&attempted.length<128)pending.push({...latest})}
   saveReceipt(d,latest,row);seen.add(rows);return true
  }catch{return false}
 })
 // Revalidate all retained receipts on each read, including old selections. A
 // removed path is discarded, never reconstructed from diagnostic activity.
 const prune=accountTag=>{
  const d=scopedStats(accountTag);if(!d)return []
  const at=now(),epoch=getEpoch(),valid=[]
  for(const r of history){
   let reason='';if(r.accountTag!==accountTag||r.epoch!==epoch||at<r.at)reason='invalidated'
   else if(at-r.at>=ttl)reason='expired'
   else try{if(!(r.mode==='immediate'?validateImmediate(r):validatePath(r)))reason='invalidated'}catch{reason='invalidated'}
   if(reason){if(latest?.id===r.id)d.pathState=reason;for(const a of activities)if(a.receiptId===r.id){a.state=reason;delete a.receiptId}}
   else valid.push(r)
  }
  if(!scope(accountTag)||getEpoch()!==epoch){scopedStats(accountTag);return []}
  history=valid;latest=valid.at(-1)||null;activities=activities.filter(a=>at>=a.at&&at-a.at<ttl).slice(-20)
  return valid
 }
 const summarize=valid=>{
  const ids=new Set(valid.map(r=>r.id))
  return {paths:valid.slice().reverse().map(r=>({id:r.id,at:r.at,channel:r.channel,mode:r.mode||'persistent',hops:r.types.length})),activities:activities.slice().reverse().map(a=>({id:a.id,at:a.at,channel:a.channel,state:a.receiptId&&!ids.has(a.receiptId)?'unavailable':a.state,kind:a.kind,...(ids.has(a.receiptId)?{receiptId:a.receiptId}:{})}))}
 }
 const snapshot=(accountTag,id='')=>withHistory(accountTag,()=>{
  const rows=prune(accountTag),r=id?rows.find(x=>x.id===id):rows.at(-1)
  return {receipt:r?{...r,edgeIds:[...r.edgeIds],types:[...r.types]}:null,...summarize(rows)}
 })
 const read=(accountTag,id='')=>snapshot(accountTag,id).receipt
 const recent=accountTag=>{const {receipt,...history}=snapshot(accountTag);return history}
 const diagnostic=accountTag=>{
  const d=scopedStats(accountTag)
  if(!d)return {state:'unavailable',observed:0,verified:0}
  return {state:d.state==='verified'&&d.pathState!=='verified'?d.pathState:d.state,observed:d.observed,matched:d.matched,candidates:d.candidates,verified:d.verified,at:d.at,lastVerifiedAt:d.lastVerifiedAt,pathState:d.pathState,historyStorage}
 }
 // Hints only; ordinary public reflection must still propose and prove a
 // relation. Bounded process-local pointers, no new disk store or model call.
 const reflectionHints=accountTag=>{
  if(!scope(accountTag)){pending=[];return []}
  const epoch=getEpoch(),at=now();pruneAttempts(accountTag,epoch,at)
  pending=pending.filter(r=>r.accountTag===accountTag&&r.epoch===epoch&&at>=r.at&&at-r.at<86400000&&validateImmediate(r))
  if(!scope(accountTag)||getEpoch()!==epoch)return []
  return pending.map(r=>({fromId:r.fromId,memoryId:r.memoryId}))
 }
 // A claim consumes one candidate before the existing model invocation. No
 // automatic retry or repeated same-pair charge in this 24h process window.
 const claimReflectionHint=(accountTag,hint)=>{
  try{
   const key=pairKey(hint);reflectionHints(accountTag)
   const epoch=getEpoch(),at=now(),row=pending.find(r=>pairKey(r)===key)
   if(!row||!scope(accountTag)||attempted.length>=128||attempted.some(r=>r.key===key))return null
   pending=pending.filter(r=>pairKey(r)!==key);attempted.push({tag:accountTag,epoch,at,key})
   const claim={...row};claims.add(claim);return Object.freeze(claim)
  }catch{return null}
 }
 const validateReflectionClaim=claim=>{
  try{return claims.has(claim)&&scope(claim.accountTag)&&claim.epoch===getEpoch()&&now()>=claim.at&&now()-claim.at<86400000&&validateImmediate(claim)&&scope(claim.accountTag)&&claim.epoch===getEpoch()}catch{return false}
 }
 return {record,recordPublicEpisodes,read,recent,snapshot,diagnostic,reflectionHints,claimReflectionHint,validateReflectionClaim}
}
/** Convert already verified representative IDs to the same opaque graph IDs;
 * never expose storage identity, account, query, or the original edge hash. */
export function projectNeuralActivation(receipt,steps,episodeRows){
 if(!receipt||!Array.isArray(steps)||!steps.length||steps.length!==receipt.types.length)return null
 const ids=new Map(episodeRows.map(row=>[row.id,neuralProjectionKey({...row,gardenKind:'experience',gardenEvidence:'fading-life-episode'})]))
 const path=steps.map(step=>({from:ids.get(step.from),to:ids.get(step.to),associationType:step.type}))
 if(path.some((step,i)=>!step.from||!step.to||step.associationType!==receipt.types[i]||step.from===step.to||i>0&&path[i-1].to!==step.from))return null
 return {id:receipt.id,at:receipt.at,steps:path,...(receipt.mode==='immediate'?{mode:'immediate'}:{}),...(['life','main-chat','owner-dm','friend-dm'].includes(receipt.channel)?{channel:receipt.channel}:{})}
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
  const verifiedSeen=new Set(),associationTypes={similarity:0,context:0,concept:0,contrast:0,temporal:0,emotion:0}
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
