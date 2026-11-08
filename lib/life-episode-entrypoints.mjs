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
