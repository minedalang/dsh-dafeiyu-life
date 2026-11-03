/**
 * Read-only composition for the local, owner-facing memory garden.
 * This is a VIEW of distinct, existing evidence stores, never a new memory or
 * a context source for external social agents. No raw DM, archive or deleted
 * memories may enter this projection.
 */
const clean=(v,n=700)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const buckets=['experience','relationship','interest','fact']
export function memoryGardenKind(m={}){
  if(m.source==='relationship-observation'||m.memoryKind==='relationship'||/^(?:关系|人物)\./.test(String(m.事实键||'')))return 'relationship'
  if(m.source==='life-interest'||m.memoryKind==='interest'||/^(?:大肥鱼\.兴趣|兴趣\.)/.test(String(m.事实键||'')))return 'interest'
  // An arbitrary main-session sentence is not automatically a stable fact.
  if(m.category==='stable_profile'||m.事实键||m.memoryKind==='fact'||m.source==='owner-manual')return 'fact'
  return 'experience'
}
const searchMatch=(m,q)=>!q||[m.text,m.事实键,m.source,...(Array.isArray(m.tags)?m.tags:[])].some(x=>String(x||'').toLocaleLowerCase().includes(q))
export function memoryGardenSnapshot({memories=[],interests=[],people=[],query='',kind='',limit=90,peopleError=''}={}){
  const q=clean(query,120).toLocaleLowerCase(),filter=buckets.includes(kind)?kind:''
  const cap=Math.min(120,Math.max(1,Math.floor(Number(limit)||90)))
  const rows=[]
  for(const m of memories){
    if(!m||!clean(m.text)||m.已被取代||m.deletedAt)continue
    rows.push({...m,gardenKind:memoryGardenKind(m),gardenEvidence:'identity-memory'})
  }
  for(const m of interests){
    // Only the existing evidence-mature interest projection is eligible.
    if(!m||m.source!=='life-interest'||m.memoryKind!=='interest'||!clean(m.text))continue
    rows.push({...m,gardenKind:'interest',gardenEvidence:'selected-video-trend'})
  }
  for(const p of people){
    // Whitelist/owner placeholders are not relationships. Require a verified
    // interaction counter and a real last observation timestamp.
    if(!/^[1-9]\d{0,18}$/.test(String(p?.uid||''))||!Number.isInteger(Number(p.count))||Number(p.count)<1||!(Number(p.lastAt)>0))continue
    const name=clean(p.name,60),uid=String(p.uid)
    const title=name?`「${name}」（UID ${uid}）`:`UID ${uid}`
    const count=Math.min(99999,Math.floor(Number(p.count)))
    // Timestamps from older SQLite rows may be corrupt. Never let one broken
    // contact turn the entire owner-only garden into an HTTP 500.
    const observedAt=Number(p.lastAt)
    if(!Number.isFinite(observedAt)||observedAt<0||observedAt>8.64e15)continue
    rows.push({id:'observed-person:'+uid,source:'relationship-observation',memoryKind:'relationship',gardenKind:'relationship',gardenEvidence:'verified-interaction-metadata',
      // This is an observation label, NOT a model-remembered relationship or an authorization.
      text:`与 ${title} 有 ${count} 次已记录的公开评论或私信往来；目前关系阶段：${clean(p.stageLabel,40)||'尚未判定'}。互动计数不是亲密度保证，也不授予私信或评论权限。`,
      tags:[uid,name,'人物','互动'].filter(Boolean),createdAt:new Date(observedAt).toISOString(),importance:0.5})
  }
  const counts={experience:0,relationship:0,interest:0,fact:0}
  for(const r of rows)if(searchMatch(r,q))counts[r.gardenKind]++
  const visible=rows.filter(r=>searchMatch(r,q)&&(!filter||r.gardenKind===filter))
    .sort((a,b)=>(Date.parse(b.createdAt||b.at||'')||0)-(Date.parse(a.createdAt||a.at||'')||0))
  const take=visible.slice(0,cap)
  return {ok:true,rows:take,counts,total:visible.length,truncated:visible.length>take.length,
    sources:{identityMemory:memories.length,learnedInterest:interests.length,verifiedPeople:people.filter(p=>Number(p?.count)>0&&Number(p?.lastAt)>0).length},
    warning:clean(peopleError,150),note:'身份认识、成熟后天兴趣与已核实互动线索来自不同现有存储；人物线索不等于长期记忆或聊天权限。未读取封存档案、删除记录或私信正文。'}
}
export const __test={searchMatch}
