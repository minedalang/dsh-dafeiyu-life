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

export function createSocialDecisionOwnership({getAccountTag,getLifeAgentMode,handoffFence,
  getSendTransactionStatus=()=>null,getSocialShadowStatus=()=>null,now=Date.now}={}){
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
  const current=({channel,expectedScope}={})=>{
    if(!CHANNELS.has(channel))return {ok:false,reason:'unsupported-social-channel'}
    const bound=scope()
    if(expectedScope!==undefined&&expectedScope!==bound)return {ok:false,reason:'account-changed'}
    if(!ACCOUNT.test(bound))return {ok:false,reason:'account-scope-unavailable'}
    if(!handoffFence?.currentOwner)return {ok:true,owner:'legacy',generation:'initial',scope:bound}
    return handoffFence.currentOwner({channel,expectedScope:bound})
  }
  const route=({channel,requester='legacy',expectedScope,expectedGeneration}={})=>{
    if(!CHANNELS.has(channel))return {ok:false,reason:'unsupported-social-channel'}
    if(!['legacy','life-agent'].includes(requester))return {ok:false,reason:'unsupported-social-owner'}
    const bound=scope(),activeMode=mode()
    // Legacy off-mode remains read-only compatible without a verified account;
    // no Life production action may borrow that exception.
    if(!ACCOUNT.test(bound))return requester==='legacy'&&activeMode==='off'&&expectedScope===undefined?
      {ok:true,owner:'legacy',scope:bound,generation:'initial',lifeRole:'disabled'}:
      {ok:false,reason:'account-scope-unavailable'}
    if(expectedScope!==undefined&&bound!==expectedScope)return {ok:false,reason:'account-changed'}
    const owner=current({channel,expectedScope:bound})
    if(!owner.ok)return owner
    if(owner.owner!==requester)return {ok:false,reason:requester==='life-agent'?'social-handoff-not-enabled':'social-owner-mismatch'}
    if(requester==='life-agent'&&activeMode!=='active')return {ok:false,reason:'life-not-active'}
    if(expectedGeneration!==undefined&&expectedGeneration!==owner.generation)
      return {ok:false,reason:'social-owner-generation-changed'}
    if(handoffFence){
      const checked=handoffFence.check({channel,expectedScope:bound,requester,expectedGeneration:owner.generation})
      if(!checked.ok)return checked
    }
    return {ok:true,owner:requester,scope:bound,generation:owner.generation,
      lifeRole:requester==='life-agent'?'production-social-decision':activeMode==='off'?'disabled':'anonymous-wake-only'}
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
  // Pure diagnostic: the existing sender, identity, inbox and transaction
  // ledgers remain authoritative. It cannot grant permission or switch owners.
  const readiness=()=>{
    const current=scope(),activeMode=mode(),valid=ACCOUNT.test(current)
    let fence,send,shadow
    try{fence=handoffFence?.inspect()}catch{}
    try{send=getSendTransactionStatus()}catch{}
    try{shadow=getSocialShadowStatus()}catch{}
    const channels={}
    for(const channel of CHANNELS){
      const blocks=[]
      if(!valid)blocks.push('account-scope-unavailable')
      if(activeMode!=='active')blocks.push('life-not-active')
      // The shadow comparison is diagnostic evidence, NOT permission to send.
      const sample=shadow?.byChannel?.[channel]
      if(shadow?.enabled!==true)blocks.push('verified-social-context-not-opted-in')
      if(!sample||Number(sample.paired||0)<5)blocks.push('shadow-evidence-insufficient')
      const lane=fence?.channels?.[channel]
      if(fence?.ok!==true||!lane)blocks.push('handoff-fence-unavailable')
      else{
        if(lane.held)blocks.push('handoff-reservation-held')
        if(lane.inFlight>0)blocks.push('legacy-operation-in-flight')
        if(lane.inFlightNeedsReview>0||lane.needsReview===true)blocks.push('legacy-operation-review-required')
      }
      const tx=send?.channels?.[channel]
      if(send?.ok!==true||send?.accountReady!==true||!tx)blocks.push('send-transaction-inspection-unavailable')
      else if(Number(tx.attempted||0)>0||Number(tx.uncertain||0)>0||Number(tx.incomplete||0)>0)
        blocks.push('send-transaction-review-required')
      if(fence?.channels?.[channel]?.owner==='life-agent')blocks.push('life-production-requires-real-platform-acceptance')
      channels[channel]={owner:fence?.channels?.[channel]?.owner||'legacy',preflightBlockers:blocks,preflightReady:false,
        shadowPaired:Number(sample?.paired||0),legacyInFlight:Number(lane?.inFlight||0),
        sendNeedsReview:Number(tx?.attempted||0)+Number(tx?.uncertain||0)+Number(tx?.incomplete||0)}
    }
    return {ok:true,mode:'staged-owner-cutover',socialHandoffEnabled:Object.values(channels).some(x=>x.owner==='life-agent'),channels,
      note:'仅预检，不是正式社交接管授权；影子样本不是发送回执'}
  }
  const status=()=>{
    prune()
    const current=scope(),activeMode=mode(),valid=ACCOUNT.test(current)
    const rows=valid?[...observed.values()].filter(r=>r.scope===current):[]
    let fenceStatus
    try{fenceStatus=handoffFence?.inspect()}catch{fenceStatus={ok:false,reason:'handoff-fence-storage-unsafe'}}
    const unavailable=valid&&!!handoffFence&&fenceStatus?.ok!==true
    const owners=Object.fromEntries([...CHANNELS].map(ch=>[ch,unavailable?'unavailable':fenceStatus?.channels?.[ch]?.owner||'legacy']))
    const lifeActive=Object.values(owners).some(x=>x==='life-agent')
    return {ok:!unavailable,mode:activeMode,socialDecisionOwner:unavailable?'unavailable':lifeActive?(Object.values(owners).every(x=>x==='life-agent')?'life':'mixed'):'legacy',
      channels:owners,lifeAgentSocialRole:lifeActive?'production-social-decision':activeMode==='off'?'disabled':'anonymous-wake-only',
      socialHandoffEnabled:lifeActive,accountReady:valid,
      handoffFence:handoffFence?fenceStatus:{ok:true,mode:'not-configured',handoffEnabled:false},
      handoffReadiness:readiness(),
      observedVerified:{dm:rows.filter(r=>r.channel==='dm').length,comment:rows.filter(r=>r.channel==='comment').length},
      note:'只统计本进程短期已核验入站事件；不是回复数、持久回执或跨进程独占凭证'}
  }
  return {current,route,observe,readiness,status}
}
