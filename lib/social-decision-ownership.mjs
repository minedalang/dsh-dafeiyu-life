/**
 * dev.4 Phase 4: account-scoped social DECISION ownership contract.
 *
 * This is deliberately NOT an outbound lock, a permission store, or a new
 * conversation ledger. The old DM/comment responders are the only production
 * decision owners until a separately reviewed atomic handoff exists. `active`
 * currently means video-life control, never social takeover. Models and callers
 * cannot request an owner promotion through this module.
 */
import {createHash} from 'node:crypto'

const ACCOUNT=/^[a-f0-9]{16}$/
const CHANNELS=new Set(['dm','comment'])
const MODES=new Set(['off','shadow','active'])
const TTL=24*60*60*1000
const LIMIT=400
const digest=(scope,channel,key)=>createHash('sha256')
  .update('social-decision-owner-v1\0'+scope+'\0'+channel+'\0'+key).digest('hex').slice(0,24)

export function createSocialDecisionOwnership({getAccountTag,getLifeAgentMode,handoffFence,now=Date.now}={}){
  if(typeof getAccountTag!=='function'||typeof getLifeAgentMode!=='function')
    throw TypeError('Social decision ownership requires explicit account and mode providers')
  // Observation statistics are intentionally volatile and contain only hashes.
  // They never participate in (or replace) the existing outbound receipt gate.
  const observed=new Map()
  const mode=()=>{const value=getLifeAgentMode();return MODES.has(value)?value:'off'}
  const scope=()=>String(getAccountTag()||'')
  const prune=()=>{
    const cutoff=now()-TTL
    for(const [key,row] of observed)if(row.at<cutoff)observed.delete(key)
    while(observed.size>LIMIT)observed.delete(observed.keys().next().value)
  }
  const route=({channel,requester='legacy',expectedScope}={})=>{
    if(!CHANNELS.has(channel))return {ok:false,reason:'unsupported-social-channel'}
    if(requester!=='legacy')return {ok:false,reason:'social-handoff-not-enabled'}
    const current=scope(),activeMode=mode()
    // No verified scope while Life Agent is on: stop, do not silently lend the
    // decision to an unbound account. Off mode retains the old legacy contract.
    if(activeMode!=='off'&&!ACCOUNT.test(current))return {ok:false,reason:'account-scope-unavailable'}
    if(expectedScope!==undefined && current!==expectedScope)return {ok:false,reason:'account-changed'}
    if(ACCOUNT.test(current)&&handoffFence){
      const fence=handoffFence.check({channel,expectedScope:current})
      if(!fence.ok)return {ok:false,reason:fence.reason}
    }
    return {ok:true,owner:'legacy',scope:current,lifeRole:activeMode==='off'?'disabled':'anonymous-wake-only'}
  }
  const observe=({channel,eventKey,verified=false}={})=>{
    if(!CHANNELS.has(channel)||verified!==true||typeof eventKey!=='string'||!eventKey||eventKey.length>180)
      return {ok:false,reason:'unverified-social-event'}
    const current=scope()
    if(!ACCOUNT.test(current))return {ok:false,reason:'account-scope-unavailable'}
    const key=digest(current,channel,eventKey)
    prune()
    const created=!observed.has(key)
    if(created){observed.set(key,{scope:current,channel,at:now()});prune()}
    return {ok:true,created,owner:'legacy'}
  }
  const status=()=>{
    prune()
    const current=scope(),activeMode=mode(),valid=ACCOUNT.test(current)
    const rows=valid?[...observed.values()].filter(r=>r.scope===current):[]
    return {ok:true,mode:activeMode,socialDecisionOwner:'legacy',lifeAgentSocialRole:activeMode==='off'?'disabled':'anonymous-wake-only',
      socialHandoffEnabled:false,accountReady:valid,
      handoffFence:handoffFence?handoffFence.inspect():{ok:true,mode:'not-configured',handoffEnabled:false},
      observedVerified:{dm:rows.filter(r=>r.channel==='dm').length,comment:rows.filter(r=>r.channel==='comment').length},
      note:'只统计本进程短期已核验入站事件；不是回复数、持久回执或跨进程独占凭证'}
  }
  return {route,observe,status}
}
