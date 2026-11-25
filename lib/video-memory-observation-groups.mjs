/** One durable shallow video slot per account/BV/visibility for new visual
 * observations. Child receipts keep exact event IDs, clocks and independent
 * detail fingerprints; they are not additional top-level shallow memories.
 * No archive reads, no retroactive merging of legacy rows. */
import {createHash} from 'node:crypto'
const GROUP=Symbol('visual-observation-group')
const ID=/^e-[a-f0-9]{18}$/
const ACCOUNT=/^[a-f0-9]{16}$/
const BV=/^BV[A-Za-z0-9]{10}$/
const scope=e=>e?.stage==='clear'&&e.kind==='watch'&&ACCOUNT.test(String(e.accountTag||''))&&BV.test(String(e.bvid||''))&&
 ['public-event','private-session'].includes(e.visibility)?[e.accountTag,e.bvid,e.visibility].join(':'):''
const visual=e=>!!scope(e)&&['decoded-public-video','low-resolution-preview'].includes(e.visualMemo?.source)&&
 Number.isSafeInteger(e.visualMemo.frameCount)&&e.visualMemo.frameCount>=1&&e.visualMemo.frameCount<=48&&
 Array.isArray(e.readEvidenceKinds)&&e.readEvidenceKinds.includes('visual-model-observation')
const ordered=(a,b)=>a.at-b.at||a.id.localeCompare(b.id)
const mark=(e,id)=>{Object.defineProperty(e,GROUP,{value:id,writable:true,configurable:true,enumerable:false});return e}

/** Materialize only live stored receipts for existing per-event evidence APIs.
 * No persisted child can override the parent's account, BV or visibility. */
export function expandVideoObservationGroups(rows=[]){
 if(!Array.isArray(rows))throw Error('视频记忆结构无效')
 const out=[],seen=new Set()
 const add=e=>{if(!e||typeof e!=='object'||seen.has(e.id))throw Error('视频记忆身份重复或无效');seen.add(e.id);out.push(e)}
 for(const root of rows){
  if(!root||typeof root!=='object')throw Error('视频记忆结构无效')
  const {visualObservations,...base}=root
  add(base)
  if(visualObservations===undefined)continue
  if(!visual(base)||!ID.test(String(base.id||''))||!Array.isArray(visualObservations)||!visualObservations.length||visualObservations.length>3199)throw Error('视频观察主记忆无效')
  mark(base,base.id)
  for(const child of visualObservations){
   if(!child||typeof child!=='object'||Array.isArray(child)||['kind','bvid','accountTag','visibility','visualObservations'].some(k=>Object.hasOwn(child,k))||
    child.stage!=='clear'||!ID.test(String(child.id||''))||typeof child.key!=='string'||!child.key.startsWith('video-explore:')||
    child.id!=='e-'+createHash('sha256').update(child.key).digest('hex').slice(0,18)||
    !Number.isSafeInteger(child.at)||typeof child.text!=='string')throw Error('视频观察子证据无效')
   const observation={...child,kind:'watch',bvid:base.bvid,accountTag:base.accountTag,visibility:base.visibility}
   if(!visual(observation))throw Error('视频观察子证据缺少视觉凭据')
   add(mark(observation,base.id))
  }
 }
 if(out.length>3200)throw Error('视频观察经历总量超出上限')
 return out
}

/** Select a stable existing clear visual root; do not merge preexisting
 * independent historical rows. New receipts are appended beneath that root. */
export function groupNewVideoObservation(rows,episode){
 if(!visual(episode)||!String(episode.key||'').startsWith('video-explore:'))return false
 const matches=rows.filter(e=>visual(e)&&scope(e)===scope(episode)).sort(ordered)
 const root=matches.find(e=>e[GROUP]===e.id)||matches.find(e=>!e[GROUP])||matches[0]
 if(!root)return false
 const group=root[GROUP]||root.id
 mark(root,group);mark(episode,group)
 return true
}

/** Serialize to the existing episodic.json. When a root fades, promote a
 * still-clear child without changing its original ID or time. Faded records
 * lose the group link and concrete BV under the existing forgetting rules. */
export function packVideoObservationGroups(rows=[]){
 const groups=new Map(),members=new Set(),replacements=new Map()
 for(const e of rows){
  if(!e[GROUP]||!visual(e))continue
  const k=e[GROUP]+'|'+scope(e)
  if(!groups.has(k))groups.set(k,[])
  groups.get(k).push(e)
 }
 // A faded/evicted root must not spawn a second clear top-level slot if
 // a different legacy root of the same scope is still available.
 for(const [key,list] of [...groups]){
  if(list.some(e=>e.id===e[GROUP]))continue
  const replacement=rows.filter(e=>visual(e)&&scope(e)===scope(list[0])&&(!e[GROUP]||e[GROUP]===e.id)).sort(ordered)[0]
  if(!replacement)continue
  const replacementKey=replacement.id+'|'+scope(replacement)
  const target=groups.get(replacementKey)||[replacement]
  groups.set(replacementKey,[...target,...list]);groups.delete(key)
 }
 for(const list of groups.values()){
  if(list.length<2)continue
  const root=list.find(e=>e.id===e[GROUP])||list.find(e=>!e[GROUP])||[...list].sort(ordered)[0]
  const visualObservations=list.filter(e=>e!==root).sort(ordered).map(e=>{
   const {kind,bvid,accountTag,visibility,...child}=e
   members.add(e);return child
  })
  replacements.set(root,{...root,visualObservations})
 }
 return rows.filter(e=>!members.has(e)).map(e=>replacements.get(e)||{...e})
}
