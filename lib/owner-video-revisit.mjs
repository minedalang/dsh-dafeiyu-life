/** Owner-triggered, read-only focus target. A gallery timestamp is an anchor,
 * never a trusted visual conclusion or permission to publish anything. */
import {planVideoMomentFollowup} from './video-moment-followup.mjs'
import {LIFE_GALLERY_TTL_MS} from './life-video-gallery.mjs'
const BV=/^BV[A-Za-z0-9]{10}$/
const ID=/^[a-f0-9]{32}$/
const FILE=/^(?:storyboard|focus)-\d{2}\.jpg$/
const TIME_EPSILON=0.02
export function planOwnerGalleryRevisit({row,account,bvid,mode,atSeconds,imageFile='',durationSeconds,now=Date.now()}={}){
  if(!row||!ID.test(String(row.id||''))||row.verified!==true||
     !BV.test(String(bvid||''))||row.bvid!==bvid||
     !Number.isSafeInteger(row.at)||row.at>now+60_000||now-row.at>=LIFE_GALLERY_TTL_MS||
     !/^[a-f0-9]{16}$/.test(String(account||'')))return {ok:false,reason:'gallery-unavailable'}
  if(!['frame','time'].includes(mode)||typeof atSeconds!=='number'||!Number.isFinite(atSeconds)||
     atSeconds<0||atSeconds>14400)return {ok:false,reason:'invalid-anchor'}
  if(mode==='frame'&&(!FILE.test(String(imageFile||''))||
      !Array.isArray(row.images)||!row.images.some(image=>image.file===imageFile&&
        Array.isArray(image.times)&&image.times.some(t=>typeof t==='number'&&
          Math.abs(t-atSeconds)<=TIME_EPSILON))))return {ok:false,reason:'frame-not-in-gallery'}
  const plan=planVideoMomentFollowup({bvid,atSeconds,durationSeconds})
  if(!plan.ok)return {ok:false,reason:plan.reason}
  return {...plan,mode,galleryId:row.id,anchorSeconds:atSeconds}
}
/** Select only an explicitly stored, verified observation ID. Historical
 * galleries without such identity cannot guess a parent from timestamps. */
export function matchOwnerGalleryMemory(rows,{bvid,memoryId}={}){
 if(!BV.test(String(bvid||''))||!/^e-[a-f0-9]{18}$/.test(String(memoryId||''))||!Array.isArray(rows))return null
 const candidates=rows.filter(e=>e?.bvid===bvid&&e.memoryId===memoryId)
 return candidates.length===1?memoryId:null
}
