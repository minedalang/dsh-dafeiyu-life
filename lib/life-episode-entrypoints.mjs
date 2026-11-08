/**
 * Convert currently executable, ORIGINAL account-scoped source candidates to
 * opaque Episode continuity keys. An Episode is not born from `browse_home`:
 * any independently verified Life outcome may be the first step. Conversely,
 * a past episode/receipt does NOT make an expired, completed or cooled-down
 * task/interest executable again. We never expose these keys to the model as
 * additional permissions, and the episode ledger persists only their digest.
 */
import {READ_TODO_TYPES} from './owner-todos.mjs'

const SOURCE_ID=/^[^\u0000-\u001f\u007f]{1,160}$/u
const LIMIT=60

export function eligibleLifeEpisodeSources({intentions=[],todos=[],opportunities=[],now=Date.now()}={}){
  const out=[],seen=new Set()
  const add=(prefix,id)=>{
    if(typeof id!=='string'||!SOURCE_ID.test(id))return
    const key=prefix+':'+id
    if(key.length>240||seen.has(key)||out.length>=LIMIT)return
    seen.add(key);out.push(key)
  }
  for(const x of Array.isArray(intentions)?intentions.slice(0,30):[]){
    if(x&&['ready','inspected'].includes(x.status)&&Number(x.expiresAt)>now&&
      Number(x.nextAt||0)<=now&&Number(x.episodeSteps||1)<Number(x.episodeMaxSteps||5))add('intention',x.id)
  }
  for(const x of Array.isArray(todos)?todos.slice(0,100):[]){
    if(x&&READ_TODO_TYPES.has(x.type)&&['open','deferred'].includes(x.status||'open')&&
      (!x.dueAt||Number(x.dueAt)<=now))add('todo',x.id)
  }
  for(const x of Array.isArray(opportunities)?opportunities.slice(0,30):[]){
    // Public-person review and video opportunities share the original
    // source prefix, never a UID-based fallback or send authority.
    if(x&&x.eligible===true)add('exploration',x.id)
  }
  return out
}

/** Prioritize a previously verified, still-live Episode over endlessly
 * rotating newest homepage results. No old episode becomes a new permission:
 * the caller supplies ONLY canonical, already executable intentions.
 * Paused episodes are eligible only AFTER their nextAt, and review freezes
 * never enter the preferred lane. With no related Episode, retain the
 * canonical order exactly (including fresh user opportunities).
 */
export function prioritizeLifeContinuationCandidates(intentions=[],sourceState=()=>null,{now=Date.now(),limit=3}={}){
  if(!Array.isArray(intentions))return []
  const max=Math.max(1,Math.min(10,Number.isSafeInteger(limit)?limit:3))
  return intentions.slice(0,30).map((item,index)=>{
    let state=null
    try{state=sourceState('intention:'+item?.id)||null}catch{}
    const eligible=state&&['active','paused'].includes(state.status)&&
      Number(state.nextAt||0)<=now&&Number(state.steps||0)>0
    return {item,index,eligible,steps:eligible?Number(state.steps):0,
      lastAt:eligible?Number(state.lastAt||now):now}
  }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||
    (a.eligible&&b.eligible?(b.steps-a.steps||a.lastAt-b.lastAt):0)||a.index-b.index)
    .slice(0,max).map(row=>row.item)
}
