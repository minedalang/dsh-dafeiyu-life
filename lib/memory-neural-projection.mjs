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
  return {id:token(kind+':'+String(m?.id||m?.bvid||'')+':'+String(m?.createdAt||m?.at||'')+':'+label),kind,
    title:label.slice(0,46),summary:label,time:clean(m?.createdAt||m?.at,35),
    source:clean(m?.gardenEvidence||m?.source||m?.kind,65),
    clarity:['clear','fuzzy','trace'].includes(m?.stage)?m.stage:'unmarked',
    refs:refsFor(m),
    // Emotion is only supported by an explicit original emotion observation
    // bound to an evidence id; a current mood must NEVER be backdated.
    emotion:typeof m?.emotionObservation==='object'&&
      safeId(m.emotionObservation.sourceEventId)&&refsFor(m).has(m.emotionObservation.sourceEventId)
      ?clean(m.emotionObservation.mood,28):''}
}
export function memoryNeuralProjection({gardenRows=[],episodes=[],limit=60,query='',kind=''}={}){
  const max=Math.max(1,Math.min(80,Math.floor(Number(limit)||60)))
  const q=clean(query,120).toLocaleLowerCase(),f=KINDS.has(kind)?kind:''
  const all=[...(Array.isArray(gardenRows)?gardenRows:[]),
    ...(Array.isArray(episodes)?episodes:[]).map(x=>({...x,gardenKind:'experience',gardenEvidence:'fading-life-episode'}))]
  const seen=new Set(),nodes=[]
  for(const m of all){
    const x=candidate(m)
    if(!x||(f&&x.kind!==f)||(q&&!x.summary.toLocaleLowerCase().includes(q))||seen.has(x.id))continue
    seen.add(x.id);nodes.push(x)
    if(nodes.length>=max)break
  }
  const edges=[]
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
    const a=nodes[i],b=nodes[j]
    if(![...a.refs].some(ref=>b.refs.has(ref)))continue
    const type=a.kind==='interest'||b.kind==='interest'?'interest':a.kind==='relationship'||b.kind==='relationship'?'relationship':'source'
    edges.push({from:a.id,to:b.id,type,evidence:'shared-verified-source'})
    if(edges.length>=100)break
  }
  return {ok:true,query:q,kind:f,nodes:nodes.map(({refs,...publicNode})=>publicNode),edges:edges.slice(0,100),
    total:nodes.length,truncated:nodes.length>=max,
    note:'只读当前可回忆记录；连线仅由显式共享来源形成。没有可核验证据的兴趣或情绪关联不会绘制；没有模拟模型隐藏思考。'}
}
