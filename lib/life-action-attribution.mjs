/**
 * dev.37: one non-executing attribution contract for the ORIGINAL agents.
 * This module never grants Life permission, schedules model calls, touches
 * platform APIs, or turns a decision into a factual completion.
 *
 * Source identifiers are ephemeral inputs: the existing Episode ledger hashes
 * them with the authenticated account tag before persisting anything.
 */
const SCOPE=/^[a-f0-9]{16}$/
const ACTION=/^[a-z][a-z0-9_-]{1,45}$/
const CHANNELS=new Set(['planner','video-agent','dm','comment','todo-followup','owner-todo','owner-dm','reflection','reflection-public','social-agent','dynamic'])
const OWNERS=new Set(['life','owner','reactive'])
const KINDS=new Set(['video','todo','social','reflection','exploration','other'])
const ERROR_CODES=new Set(['source-unavailable','account-changed','not-verified','unattributed','projection-failed','missing-platform-receipt','no-active-episode','invalid-action'])
const goodString=(s,max)=>typeof s==='string'&&s.length>=3&&s.length<=max&&!/[\u0000-\u001f\u007f]/.test(s)
const blank=()=>({verified:0,duplicate:0,blocked:0,unknown:0,unattributed:0,byChannel:{},lastCode:''})
export function createLifeActionAttribution({episodes,getAccountTag,logger={}}={}){
 if(!episodes||typeof episodes.record!=='function'||typeof episodes.sourceState!=='function'||typeof getAccountTag!=='function')
   throw TypeError('Life attribution requires original episode ledger and account binding')
 const metrics=blank()
 const report=(channel,code)=>{
   metrics.lastCode=ERROR_CODES.has(code)?code:'invalid-action'
   if(channel&&CHANNELS.has(channel))metrics.byChannel[channel]=(metrics.byChannel[channel]||0)+1
 }
 const current=()=>String(getAccountTag()||'')
 const validate=({accountTag,channel,owner,sourceRef,action,kind})=>{
   if(!SCOPE.test(String(accountTag||''))||current()!==accountTag)return 'account-changed'
   if(!CHANNELS.has(channel)||!OWNERS.has(owner)||!KINDS.has(kind)||!ACTION.test(String(action||'')))return 'invalid-action'
   if(!goodString(sourceRef,240))return 'source-unavailable'
   return ''
 }
 /** Call this ONLY after an independently verified canonical receipt. */
 const verified=({accountTag,channel,owner,sourceRef,receiptId,action,kind,publicBvid=''}={})=>{
   const bad=validate({accountTag,channel,owner,sourceRef,action,kind})
   if(bad){metrics.unattributed++;report(channel,bad);return {ok:false,reason:bad}}
   if(!goodString(receiptId,240)){
     metrics.unattributed++;report(channel,'missing-platform-receipt');return {ok:false,reason:'missing-platform-receipt'}
   }
   try{
     const r=episodes.record({accountTag,sourceRef,receiptId,action,kind,outcome:'verified',owner,channel,publicBvid})
     if(r?.ok!==true){metrics.unattributed++;report(channel,'projection-failed');return {ok:false,reason:r?.reason||'projection-failed'}}
     if(r.duplicate)metrics.duplicate++
     else metrics.verified++
     return {ok:true,duplicate:r.duplicate===true,episode:r.episode}
   }catch(e){
     metrics.unattributed++;report(channel,'projection-failed')
     logger.warn?.('Life 行动归属投影失败（不重发平台操作）：'+String(e?.message||e).slice(0,80))
     return {ok:false,reason:'projection-failed'}
   }
 }
 /** No unknown outbound creates a fake Episode; only freeze an EXISTING one. */
 const unknown=({accountTag,channel,owner,sourceRef,receiptId,action,kind}={})=>{
   const bad=validate({accountTag,channel,owner,sourceRef,action,kind})
   if(bad){metrics.unattributed++;report(channel,bad);return {ok:false,reason:bad}}
   if(!goodString(receiptId,240))return {ok:false,reason:'missing-platform-receipt'}
   try{
     const existing=episodes.sourceState(sourceRef)
     if(!existing||!['active','paused'].includes(existing.status)){
       metrics.unknown++;report(channel,'no-active-episode');return {ok:true,recorded:false,reason:'no-active-episode'}
     }
     const r=episodes.record({accountTag,sourceRef,receiptId,action,kind,outcome:'unknown',owner,channel})
     if(r?.ok!==true)return {ok:false,reason:r?.reason||'projection-failed'}
     metrics.unknown++;return {ok:true,recorded:!r.duplicate,episode:r.episode}
   }catch{return {ok:false,reason:'projection-failed'}}
 }
 /** Blocked/deferred/model-skipped attempts are NOT verified experiences. */
 const notSent=({accountTag,channel,code='not-verified'}={})=>{
   if(current()!==accountTag||!SCOPE.test(String(accountTag||'')))return {ok:false,reason:'account-changed'}
   metrics.blocked++;report(channel,code);return {ok:true,recorded:false}
 }
 const status=()=>({verified:metrics.verified,duplicate:metrics.duplicate,blocked:metrics.blocked,
   unknown:metrics.unknown,unattributed:metrics.unattributed,byChannel:{...metrics.byChannel},lastCode:metrics.lastCode,
   policy:'attribution-only-no-send-no-authority'})
 return {verified,unknown,notSent,status}
}
