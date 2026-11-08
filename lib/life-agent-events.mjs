/**
 * dev.4 A/B: platform-neutral, account-scoped life wake inbox. Only anonymous
 * event classes are persisted here; it is NOT a second memory, relationship
 * database, permission store or authoritative platform receipt.
 */
import {createHash,randomBytes} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {withLifeEventLedgerLock} from './life-planner-atomic.mjs'

const MAX_BYTES=128_000,RETENTION=7*86_400_000
const RETRY_LIMIT=3,RETRY_BASE_MS=5*60_000,RETRY_MAX_MS=60*60_000
const RETRY_REASONS=new Set(['invalid','model-error','preflight-error'])
// A valid choice about another topic is not evidence that the fish rejected
// every incoming life signal. Leave unselected signals for a bounded later
// chance without converting them into model failures or permanent tasks.
const PASSOVER_DELAYS_MS=[30*60_000,2*60*60_000,6*60*60_000]
const PASSOVER_LIMIT=PASSOVER_DELAYS_MS.length
const REOFFER_AFTER_MS=6*60*60_000
const FOLLOWUP_DELAY_MS=2*60_000
const LIFE_CUE_KINDS=['exploration-ready','friend-ready','todo-ready','public-ready','curiosity-ready','reflection-ready','experience-ready']
// Existing account-scoped event journal also holds opaque wake references for
// verified independent Life candidates. It NEVER stores candidate payloads or
// grants sending rights; a fresh canonical read is required before any action.
const TYPES=new Set(['quiet-window','video-round-ended','manual-wake','dm-received','comment-received','exploration-ready',
  'friend-ready','todo-ready','curiosity-ready','public-ready','reflection-ready','experience-ready'])
const SCOPE=/^[a-f0-9]{16}$/
const PLATFORM=/^[a-z][a-z0-9_-]{1,30}$/
const blank=()=>({version:1,events:[],videoStarts:[],videoRounds:[],timeline:[],cueCursor:0})
const ROUND_ID=/^[a-f0-9]{24}$/
const ROUND_SOURCES=new Set(['life-agent','manual'])
const ROUND_RESULTS=new Set(['started','completed','failed','interrupted'])
const COMMENT_GATES=new Set(['configured','master-disabled','auto-comment-disabled','dm-only','invalid-mode','round-quota-zero','daily-quota-zero','unknown'])
const COMMENT_REASONS=new Set(['life-declined-video-action','life-not-ready','life-context-unavailable','life-choice-in-progress','life-cross-channel-rest','life-admission-unavailable'])
const count=n=>Number.isSafeInteger(n)&&n>=0?Math.min(40,n):0
// A readable life journal is *not* a second memory or a platform receipt.
// All persisted values are bounded enums or opaque hashes; never persist model
// prose, conversation contents, UIDs, BVIDs or credentials in this journal.
const ACTIONS=new Set(['skip','consider_social','use_capability','begin_exploration','inspect_exploration',
  'inspect_creator_space','abandon_exploration','inspect_opportunity','review_public','defer','dismiss','reflect','execute_read','review_friend','reach_out_friend'])
const RESULT=/^[a-z][a-z0-9-]{0,54}$/
const OPTION_KEYS=['todos','cues','intentions','opportunities','social','video','reflection','affinity','relationship']
const READ_KINDS=new Set(['todo-read','video-metadata','public-evidence'])
// Only statuses already confirmed by the platform transaction / original
// executor enter this ledger. This is a Life attention cue, never an outbound
// permission or a substitute for the canonical platform receipt.
const VERIFIED_COMPLETION_KINDS=new Set(['dm_reply','comment_reply','share_video','video_like','video_collect',
  'video_follow','video_unfollow','video_folder_delete','video_comment','followup','owner_care','friend_outreach','dynamic_post'])
const COMPLETE_ACTION=/^[a-f0-9]{16}$/
const PLATFORM_READ_COMPLETIONS=new Set(['video_like','video_collect','video_follow','video_unfollow','video_comment','dynamic_post'])
const completionEvidence=kind=>PLATFORM_READ_COMPLETIONS.has(kind)?'platform-read-after-write':'platform-transaction-receipt'
const BLOCKERS=new Set(['video-capability-unavailable','video-daily-limit','video-launch-cooldown','video-agent-busy','no-verified-candidates'])
const hashId=value=>createHash('sha256').update('life-continuation\0'+value).digest('hex').slice(0,16)
// Stable, source-opaque reference for correlating one account's debug records.
export const lifeEventDebugRef=id=>ROUND_ID.test(String(id||''))?hashId(id):''

/** Only subprocess lifecycle + original picked-ledger counts, NEVER sensory evidence.
 * Input is already account-scoped by createLifeAgentEvents().status(); never
 * forward round IDs, platform titles or arbitrary ledger fields to the model.
 */
export function projectVideoRoundFeedback(rows,{at=Date.now(),limit=3}={}){
  if(!Array.isArray(rows)||!Number.isSafeInteger(at))return []
  const max=Math.max(0,Math.min(3,Number.isSafeInteger(limit)?limit:3))
  return rows.filter(r=>r&&['life-agent','manual'].includes(r.source)&&
    ['completed','failed','interrupted'].includes(r.state)&&
    Number.isSafeInteger(r.endedAt)&&r.endedAt>0&&r.endedAt<=at&&at-r.endedAt<=48*3600_000)
    .sort((a,b)=>b.endedAt-a.endedAt).slice(0,max).map(r=>({
      origin:r.source==='life-agent'?'self-selected-video-agent':'manual-video-agent',
      outcome:r.state==='completed'?'process-exited-zero':r.state==='failed'?'process-exited-error':'process-result-unknown',
      ageMinutes:Math.floor((at-r.endedAt)/60_000),
      // Missing picked evidence is unknown, not zero. Only subprocess success
      // may carry a count recorded from the separate canonical picked ledger.
      pickedCount:r.state==='completed'&&Number.isSafeInteger(r.pickedCount)&&r.pickedCount>=0&&r.pickedCount<=50?r.pickedCount:null,
      proof:'process-lifecycle-only-not-video-viewed-or-audio-heard'
    }))
}

export function createLifeAgentEvents({stateDir,getAccountTag,now=Date.now}={}){
  if(!stateDir||typeof getAccountTag!=='function')throw TypeError('Life event account boundary missing')
  const file=()=>{
    const tag=getAccountTag()
    if(!SCOPE.test(String(tag||'')))throw Error('Life Agent requires a verified account scope')
    return join(stateDir,'life-agent-events',tag+'.json')
  }
  const load=()=>{
    const folder=join(stateDir,'life-agent-events')
    if(existsSync(folder)){const st=lstatSync(folder);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Life Agent event folder unsafe')}
    const name=file()
    if(!existsSync(name))return blank()
    const st=lstatSync(name)
    if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw Error('Life Agent event ledger unsafe')
    const value=JSON.parse(readFileSync(name,'utf8'))
    if(value?.version!==1||!Array.isArray(value.events)||!Array.isArray(value.videoStarts))throw Error('Life Agent event version unsupported')
    // Keep v1 storage compatible. Old model-invalid wakes were incorrectly
    // consumed; they have no proven action and can safely re-enter a bounded
    // retry cycle (without inventing a new source key or platform event).
    const events=value.events.slice(-160).map(e=>e?.state==='considered'&&e.result==='invalid'?
      {...e,state:'retryable',result:'invalid-model-output',failures:1,retryAt:Number(e.at||0)+RETRY_BASE_MS}:e)
    return {version:1,events,cueCursor:Number.isSafeInteger(value.cueCursor)&&value.cueCursor>=0?value.cueCursor%LIFE_CUE_KINDS.length:0,videoStarts:value.videoStarts.slice(-600),
      videoRounds:Array.isArray(value.videoRounds)?value.videoRounds.slice(-160):[],
      timeline:Array.isArray(value.timeline)?value.timeline.slice(-50):[]}
  }
  const prune=value=>{
    const t=now()
    const valid=value.events.filter(e=>e&&Number.isSafeInteger(e.at)&&e.at<=t+60_000&&t-e.at<RETENTION&&TYPES.has(e.kind)&&PLATFORM.test(e.platform))
    // A busy comment/DM day must not evict every independent opportunity
    // before Life has had time to consider it. Preserve a small bounded head
    // of outstanding items per source, plus unknown-review entries. All other
    // journal events remain a capped, time-limited *attention* cache.
    const protectedRows=[...valid.filter(e=>e.state==='review').slice(-32)]
    for(const kind of LIFE_CUE_KINDS)protectedRows.push(...valid.filter(e=>e.kind===kind&&['pending','retryable'].includes(e.state)).slice(0,3))
    const preserved=new Map(protectedRows.map(e=>[e.id,e]))
    const rest=valid.filter(e=>!preserved.has(e.id)).slice(-(120-preserved.size))
    value.events=[...rest,...preserved.values()].sort((a,b)=>a.at-b.at)
    value.cueCursor=Number.isSafeInteger(value.cueCursor)&&value.cueCursor>=0?value.cueCursor%LIFE_CUE_KINDS.length:0
    value.videoStarts=value.videoStarts.filter(x=>Number.isSafeInteger(x)&&x<=t+60_000&&t-x<RETENTION).slice(-600)
    value.videoRounds=(Array.isArray(value.videoRounds)?value.videoRounds:[]).filter(r=>
      r&&ROUND_ID.test(String(r.id||''))&&ROUND_SOURCES.has(r.source)&&ROUND_RESULTS.has(r.state)&&
      Number.isSafeInteger(r.startedAt)&&r.startedAt<=t+60_000&&t-r.startedAt<RETENTION).slice(-160)
    value.timeline=(Array.isArray(value.timeline)?value.timeline:[]).filter(x=>x&&Number.isSafeInteger(x.at)&&x.at<=t+60_000&&t-x.at<RETENTION).slice(-40)
    return value
  }
  const save=value=>{
    const name=file(),folder=join(stateDir,'life-agent-events')
    mkdirSync(folder,{recursive:true})
    if(!lstatSync(folder).isDirectory()||lstatSync(folder).isSymbolicLink())throw Error('Life Agent events folder unsafe')
    if(existsSync(name)&&(!lstatSync(name).isFile()||lstatSync(name).isSymbolicLink()))throw Error('Life Agent events file unsafe')
    const tmp=name+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp'
    writeFileSync(tmp,JSON.stringify(prune(value))+'\n',{mode:0o600})
    renameSync(tmp,name)
  }
  const mutate=fn=>{
    const result=withLifeEventLedgerLock(stateDir,()=>fn(),{now})
    if(result.ok!==true)throw Error(result.reason||'life-event-ledger-unavailable')
    return result
  }
  const offer=({kind,platform='life',sourceKey}={})=>{
    if(!TYPES.has(kind)||!PLATFORM.test(platform)||typeof sourceKey!=='string'||!sourceKey||sourceKey.length>160)
      throw Error('Untrusted Life Agent event type/source')
    return mutate(()=>{
    const value=prune(load())
    // Never persist source keys, BVIDs, raw messages, contacts or private text.
    const id=createHash('sha256').update(kind+'\0'+platform+'\0'+sourceKey).digest('hex').slice(0,24)
    const existing=value.events.find(e=>e.id===id)
    if(existing){
      // A verified canonical source can present itself again after several
      // unselected turns. Do not resurrect explicit rest, failed model calls,
      // an unknown send or a reviewed decision. Reuse the same opaque ID.
      if(LIFE_CUE_KINDS.includes(kind)&&existing.result==='unselected-after-three-turns'&&
        existing.state==='considered'&&now()-Number(existing.closedAt||existing.at)>=REOFFER_AFTER_MS){
        existing.at=now();existing.state='pending';existing.result='';existing.retryAt=0;existing.passovers=0;existing.closedAt=0
        save(value)
        return {ok:true,created:false,reoffered:true,id}
      }
      return {ok:true,created:false,id}
    }
    if(kind==='manual-wake'){
      // Repeated button clicks replace only outstanding MANUAL wake requests.
      // Never discard real social/video events or a completed timeline entry.
      for(const e of value.events)if(e.kind==='manual-wake'&&['pending','retryable'].includes(e.state)){
        e.state='considered';e.result='considered'
      }
    }
    value.events.push({id,kind,platform,at:now(),state:'pending'})
    save(value)
    return {ok:true,created:true,id}
    })
  }
  const peek=(limit=4)=>{
    const value=prune(load()),t=now(),cap=Math.max(0,Math.min(8,Number(limit)||4))
    const pending=value.events.filter(e=>e.state==='pending'||e.state==='retryable'&&Number(e.retryAt||0)<=t)
    if(!cap)return []
    const manual=[...pending].reverse().find(e=>e.kind==='manual-wake')
    const social=pending.filter(e=>['dm-received','comment-received'].includes(e.kind))
    const video=pending.filter(e=>e.kind==='video-round-ended')
    // Cursor is advanced by a completed model decision, not by a read-only
    // management poll. This survives restarts and prevents one cue class from
    // always owning the four visible slots. Manual/social remain urgent.
    const order=[...LIFE_CUE_KINDS.slice(value.cueCursor),...LIFE_CUE_KINDS.slice(0,value.cueCursor)]
    const cues=order.flatMap(kind=>pending.filter(e=>e.kind===kind))
    const cueHeads=order.map(kind=>cues.find(e=>e.kind===kind)).filter(Boolean)
    const selected=[],seen=new Set()
    const add=e=>{if(e&&!seen.has(e.id)&&selected.length<cap){seen.add(e.id);selected.push(e)}}
    add(manual)
    // Reserve at least one slot for a due independent life cue and a completed
    // video round. Even hundreds of social notices must not erase the fish's
    // other possible life choices. This does NOT throttle the actual inbound
    // comment/DM responder, which runs in its separate production path.
    const reserve=(cues.length?1:0)+(video.length?1:0)
    const socialSlots=Math.max(0,cap-selected.length-reserve)
    for(const e of social.slice(0,socialSlots))add(e)
    add(cueHeads[0])
    add(video[0])
    for(const e of [...cueHeads.slice(1),...cues,...video.slice(1),...social,...pending])add(e)
    return selected.map(e=>({id:e.id,kind:e.kind,platform:e.platform,at:e.at}))
  }
  const settle=(ids,reason='considered')=>{
    const selected=new Set(Array.isArray(ids)?ids.filter(x=>/^[a-f0-9]{24}$/.test(String(x))):[])
    return mutate(()=>{
    const value=prune(load());let updated=0
    for(const e of value.events)if(selected.has(e.id)&&
      (e.state==='pending'||e.state==='retryable'&&Number(e.retryAt||0)<=now())){
      if(RETRY_REASONS.has(reason)){
        const failures=Math.min(RETRY_LIMIT,Math.max(0,Number(e.failures)||0)+1)
        e.failures=failures;e.result=reason==='invalid'?'invalid-model-output':reason==='preflight-error'?'preflight-check-failed':'model-call-failed'
        e.state=failures>=RETRY_LIMIT?'failed':'retryable'
        e.retryAt=e.state==='retryable'?now()+Math.min(RETRY_MAX_MS,RETRY_BASE_MS*2**(failures-1)):0
      }else if(reason==='not-selected'){
        const passovers=Math.min(PASSOVER_LIMIT,Math.max(0,Number(e.passovers)||0)+1)
        e.passovers=passovers
        e.state=passovers>=PASSOVER_LIMIT?'considered':'retryable'
        e.result=e.state==='considered'?'unselected-after-three-turns':'not-selected-this-turn'
        if(e.state==='considered')e.closedAt=now()
        e.retryAt=e.state==='retryable'?now()+PASSOVER_DELAYS_MS[passovers-1]:0
      }else if(reason==='execution-uncertain'){
        // A read or delegated capability may already have run. Never treat an
        // unknown receipt as a voluntary choice, and never re-drive it from
        // this anonymous inbox. Operator review is read-only and explicit.
        e.state='review';e.result='action-outcome-unknown';e.retryAt=0
      }else{
        e.state='considered';e.result=['considered','social-attended','social-passed-over'].includes(reason)?reason:'considered'
        e.retryAt=0
      }
      updated++
    }
    if(updated)save(value)
    return {ok:true,updated}
    })
  }
  const recordDecision=({eventIds=[],action='skip',result='',targetId='',mode='shadow',failed=false,options={},blocker='',sharedInterestRead=false,relationshipTaskDone=false,relationshipRankShift=false,verifiedReadKind='',priorVerifiedReadOffered=false,priorVerifiedReadReferenced=false,videoRoundFeedbackOffered=false}={})=>{
    if(!ACTIONS.has(action)||!['shadow','active'].includes(mode))throw Error('Invalid life journal decision')
    return mutate(()=>{
    const value=prune(load()),selected=new Set(Array.isArray(eventIds)?eventIds:[])
    const offeredEvents=value.events.filter(e=>selected.has(e.id))
    const kinds=[...new Set(offeredEvents.map(e=>e.kind))].slice(0,5)
    const attended=action==='consider_social'?offeredEvents.find(e=>e.id===targetId&&
      ['dm-received','comment-received'].includes(e.kind)):null
    // Computed from the authoritative event ledger AFTER settle(), not from
    // model prose. These are bounded anonymous counters, not contact details.
    const revisitable=offeredEvents.filter(e=>e.result==='not-selected-this-turn'&&e.state==='retryable').length
    const frozen=offeredEvents.filter(e=>e.state==='review').length
    const proof=RESULT.test(String(result))?result:(failed?'execution-failed':'no-action-receipt')
    const continuation=typeof targetId==='string'&&targetId.length>0&&targetId.length<=160?hashId(targetId):''
    const continued=continuation!==''&&value.timeline.some(x=>x.continuation===continuation)
    const verifiedAction=failed!==true&&mode==='active'&&(
      (verifiedReadKind==='todo-read'&&action==='execute_read'&&result==='done')||
      (verifiedReadKind==='video-metadata'&&['inspect_opportunity','begin_exploration','inspect_exploration'].includes(action)&&result==='verified-metadata')||
      (verifiedReadKind==='public-evidence'&&action==='review_public'&&result==='public-evidence-reviewed')||
      (action==='reflect'&&result==='completed'&&verifiedReadKind==='')||
      (action==='reach_out_friend'&&result==='friend-message-sent'&&verifiedReadKind===''))
    let followupQueued=false
    if(verifiedAction){
      // A successful canonical read may prompt another choice later. Never
      // turn it into an executable instruction or an automatic social send.
      // The opaque key deduplicates duplicate receipts in the same time window.
      const opaque=createHash('sha256').update('verified-next-step\0'+action+'\0'+targetId+'\0'+Math.floor(now()/1_200_000)).digest('hex').slice(0,24)
      if(!value.events.some(e=>e.id===opaque)){
        value.events.push({id:opaque,kind:'experience-ready',platform:'life',at:now(),state:'retryable',
          retryAt:now()+FOLLOWUP_DELAY_MS,result:'verified-read-followup'})
        followupQueued=true
      }
    }
    // Only verified completed decisions are included here, not model intent.
    value.timeline.push({at:now(),mode,kinds,action,result:proof,failed:failed===true,followupQueued,
      eventRefs:offeredEvents.slice(0,4).map(e=>lifeEventDebugRef(e.id)),
      selectedSocialKind:attended?.kind||'',notSelectedWaiting:Math.min(8,revisitable),reviewEvents:Math.min(8,frozen),
      // The same verified opportunity can be recognized across rounds, but its
      // raw identifier must stay in the authoritative intention store.
      continuation,continued,options:Object.fromEntries(OPTION_KEYS.map(k=>[k,Math.max(0,Math.min(9,Number.isSafeInteger(options?.[k])?options[k]:0))])),
      blocker:BLOCKERS.has(blocker)?blocker:'',
      // These booleans require a matching verified result from the existing planner.
      sharedInterestRead:sharedInterestRead===true,relationshipTaskDone:relationshipTaskDone===true,
      relationshipRankShift:relationshipRankShift===true,
      // Only the original planner may assert a verified read. This is a short-
      // lived, account-scoped decision cue, never memory or platform provenance.
      verifiedReadKind:failed!==true&&(
        (verifiedReadKind==='todo-read'&&action==='execute_read'&&result==='done')||
        (verifiedReadKind==='video-metadata'&&['inspect_opportunity','begin_exploration','inspect_exploration'].includes(action)&&result==='verified-metadata')||
        (verifiedReadKind==='public-evidence'&&action==='review_public'&&result==='public-evidence-reviewed'))?verifiedReadKind:'',
      // Offered means present in the bounded model prompt, NOT model adoption.
      // Keep the legacy referenced bit readable for old v1 timeline rows.
      priorVerifiedReadOffered:priorVerifiedReadOffered===true,
      priorVerifiedReadReferenced:priorVerifiedReadReferenced===true,
      videoRoundFeedbackOffered:videoRoundFeedbackOffered===true,
      verifiedActionKind:action==='reach_out_friend'&&result==='friend-message-sent'&&mode==='active'&&failed!==true?'friend_outreach':''})
    if(offeredEvents.some(e=>LIFE_CUE_KINDS.includes(e.kind)))
      value.cueCursor=(value.cueCursor+1)%LIFE_CUE_KINDS.length
    save(value)
    return {ok:true,followupQueued}
    })
  }
  // Source-ref is a short account-scoped hash produced by the Life arbiter.
  // Requiring this strict proof and the original verified result prevents an
  // arbitrary model response (or old unsent draft) from creating a wake.
  // Unique across processes and restarts: one confirmed source -> one cue.
  const recordVerifiedCompletion=({kind,sourceRef}={})=>{
    if(!VERIFIED_COMPLETION_KINDS.has(kind)||!COMPLETE_ACTION.test(String(sourceRef||'')))
      return {ok:false,reason:'unverified-completion-source'}
    return mutate(()=>{
      const value=prune(load())
      const opaque=createHash('sha256').update('verified-platform-completion\0'+kind+'\0'+sourceRef).digest('hex').slice(0,24)
      if(value.events.some(e=>e.id===opaque))return {ok:true,created:false,followupQueued:false}
      value.events.push({id:opaque,kind:'experience-ready',platform:'life',at:now(),state:'retryable',
        retryAt:now()+FOLLOWUP_DELAY_MS,result:'verified-action-followup'})
      // No raw recipient, sender, platform ID, text, or sourceRef is retained.
      value.timeline.push({at:now(),mode:'active',kinds:[],action:'verified_write',result:'verified-action',
        failed:false,followupQueued:true,verifiedActionKind:kind,
        verifiedEvidence:completionEvidence(kind),eventRefs:[],options:{}})
      save(value)
      return {ok:true,created:true,followupQueued:true}
    })
  }
  const recordVideoStart=()=>mutate(()=>{
    const value=prune(load());value.videoStarts.push(now());save(value)
    return {ok:true}
  })
  // An unknown execution outcome is NOT a delayed model prompt. A human
  // may close the opaque event after independently reviewing receipts, but
  // never requeue it here or claim platform success. This method is not
  // exposed through HTTP, the model, or the live management console.
  const inspectReviewOffline=()=>load().events.filter(e=>e.state==='review'&&
    /^[a-f0-9]{24}$/.test(e.id)).slice(-60).map(e=>({id:e.id,kind:e.kind,platform:e.platform,at:e.at,result:e.result}))
  const closeReviewOffline=(id,{confirmedAllStopped=false}={})=>{
    if(confirmedAllStopped!==true)return {ok:false,reason:'explicit-shutdown-confirmation-required'}
    if(!/^[a-f0-9]{24}$/.test(String(id||'')))return {ok:false,reason:'invalid-event-id'}
    const result=mutate(()=>{
      const data=load(),entry=data.events.find(e=>e.id===id&&e.state==='review')
      if(!entry)return {ok:true,closed:false,reason:'event-not-under-review'}
      entry.state='considered';entry.result='review-closed-no-replay';entry.retryAt=0
      save(data)
      return {ok:true,closed:true}
    })
    return result.closed?result:{ok:false,reason:result.reason}
  }
  // The video subprocess owns the *actual* lifetime of a delegated round.
  // This journal only stores anonymous lifecycle facts; a successful launch is
  // NOT a video-viewing receipt. The canonical picked BV records remain in the
  // existing watched ledger and are never copied here.
  const recordVideoRoundStart=({source='life-agent',commentGate='unknown'}={})=>{
    if(!ROUND_SOURCES.has(source))throw Error('Invalid video round source')
    return mutate(()=>{
      const value=prune(load()),id=randomBytes(12).toString('hex')
      value.videoRounds.push({id,source,state:'started',startedAt:now(),endedAt:0,pickedCount:null,
        commentGate:COMMENT_GATES.has(commentGate)?commentGate:'unknown'})
      save(value)
      return {ok:true,id}
    })
  }
  const recordVideoRoundFinish=(id,{exitCode=null,pickedCount=null,commentDiagnostics=null}={})=>{
    if(!ROUND_ID.test(String(id||'')))throw Error('Invalid video round id')
    return mutate(()=>{
      const value=prune(load()),round=value.videoRounds.find(r=>r.id===id)
      if(!round)return {ok:false,reason:'round-not-found'}
      if(round.state!=='started')return {ok:true,updated:false,state:round.state}
      // Exit 0 verifies only subprocess completion, NEVER a particular BV or
      // watching/sensory experience. Missing picked-ledger data stays unknown.
      round.state=exitCode===0?'completed':Number.isSafeInteger(exitCode)?'failed':'interrupted'
      round.endedAt=now()
      round.exitCode=Number.isSafeInteger(exitCode)&&exitCode>=-128&&exitCode<=255?exitCode:null
      round.pickedCount=round.state==='completed'&&Number.isSafeInteger(pickedCount)&&pickedCount>=0?
        Math.min(50,pickedCount):null
      // These numbers prove which host bridge steps were observed, not that
      // a model had the intention to comment or that Bilibili displayed it.
      if(commentDiagnostics&&typeof commentDiagnostics==='object'){
        round.commentDiagnostics=Object.fromEntries(['proposed','approved','declined','verified','unverified'].map(k=>[k,count(commentDiagnostics[k])]))
        round.commentDiagnostics.lastReason=COMMENT_REASONS.has(commentDiagnostics.lastReason)?commentDiagnostics.lastReason:''
      }
      save(value)
      return {ok:true,updated:true,state:round.state}
    })
  }
  const status=()=>{
    const value=prune(load()),t=now(),today=new Date(t).toLocaleDateString('en-CA')
    const recentVerifiedReads=value.timeline.filter(e=>READ_KINDS.has(e.verifiedReadKind)&&
      e.at<=t&&t-e.at<=48*3600_000).slice(-3).reverse().map(e=>({kind:e.verifiedReadKind,at:e.at}))
    const retryable=value.events.filter(e=>e.state==='retryable')
    const notSelected=retryable.filter(e=>e.result==='not-selected-this-turn')
    const due=e=>e.state==='pending'||e.state==='retryable'&&Number(e.retryAt||0)<=t
    const retryTimes=retryable.map(e=>Number(e.retryAt||0)).filter(x=>Number.isSafeInteger(x)&&x>0)
    const pendingVideoFollowup=value.events.filter(e=>e.kind==='video-round-ended'&&due(e)).length
    const recentVideoRounds=value.videoRounds.slice(-12).reverse().map(r=>({
      ref:r.id.slice(0,12),source:r.source,
      // After a crash/restart there may be no completion receipt. Do not
      // silently mark an old process successful or schedule a replay.
      state:r.state==='started'&&t-r.startedAt>8*3600_000?'unverified-interruption':r.state,
      startedAt:r.startedAt,endedAt:r.endedAt||0,
      exitCode:Number.isSafeInteger(r.exitCode)&&r.exitCode>=-128&&r.exitCode<=255?r.exitCode:null,
      pickedCount:r.state==='completed'&&Number.isSafeInteger(r.pickedCount)?r.pickedCount:null,
      commentGate:COMMENT_GATES.has(r.commentGate)?r.commentGate:'unknown',
      commentDiagnostics:r.commentDiagnostics?Object.fromEntries([...['proposed','approved','declined','verified','unverified'].map(k=>[k,count(r.commentDiagnostics[k])]),
        ['lastReason',COMMENT_REASONS.has(r.commentDiagnostics.lastReason)?r.commentDiagnostics.lastReason:'']]):null
    }))
    return {ok:true,recentVerifiedReads,recentVideoRounds,pendingVideoFollowup,
      pending:value.events.filter(e=>e.state==='pending').length,
      retryable:retryable.length,retryDue:retryable.filter(due).length,
      unselectedWaiting:notSelected.length,unselectedDue:notSelected.filter(due).length,
      nextRetryAt:retryTimes.length?Math.min(...retryTimes):0,
      failed:value.events.filter(e=>e.state==='failed').length,
      needsReview:value.events.filter(e=>e.state==='review').length,
      considered:value.events.filter(e=>e.state==='considered').length,
      pendingSocial:value.events.filter(e=>due(e)&&['dm-received','comment-received'].includes(e.kind)).length,
      pendingLifeCues:value.events.filter(e=>due(e)&&LIFE_CUE_KINDS.includes(e.kind)).length,
      waitingLifeCues:value.events.filter(e=>e.state==='retryable'&&LIFE_CUE_KINDS.includes(e.kind)).length,
      dueExperienceFollowup:value.events.some(e=>e.kind==='experience-ready'&&due(e)),
      nextExperienceFollowupAt:(() => {const times=value.events.filter(e=>e.kind==='experience-ready'&&e.state==='retryable'&&Number.isSafeInteger(e.retryAt)&&e.retryAt>0).map(e=>e.retryAt);return times.length?Math.min(...times):0})(),
      cueCursor:value.cueCursor,
      recentSocialKinds:value.events.filter(e=>['dm-received','comment-received'].includes(e.kind)).slice(-8).map(e=>e.kind),
      videoStartsToday:value.videoStarts.filter(x=>new Date(x).toLocaleDateString('en-CA')===today).length,
      lastVideoAt:value.videoStarts.at(-1)||0,
      recent:value.events.slice(-10).reverse().map(e=>({ref:lifeEventDebugRef(e.id),kind:e.kind,platform:e.platform,at:e.at,state:e.state,result:e.result||'',
        failures:Math.max(0,Math.min(RETRY_LIMIT,Number(e.failures)||0)),
        passovers:Math.max(0,Math.min(PASSOVER_LIMIT,Number(e.passovers)||0)),
        retryAt:e.state==='retryable'?Number(e.retryAt||0):0})),
      timeline:value.timeline.slice(-30).reverse().map(e=>({at:e.at,mode:e.mode,kinds:e.kinds,
        eventRefs:Array.isArray(e.eventRefs)?e.eventRefs.filter(ref=>/^[a-f0-9]{16}$/.test(ref)).slice(0,4):[],
        action:e.action,result:e.result,failed:e.failed,continued:e.continued,followupQueued:e.followupQueued===true,options:e.options||null,blocker:e.blocker||'',
        selectedSocialKind:['dm-received','comment-received'].includes(e.selectedSocialKind)?e.selectedSocialKind:'',
        notSelectedWaiting:Math.max(0,Math.min(8,Number(e.notSelectedWaiting)||0)),
        reviewEvents:Math.max(0,Math.min(8,Number(e.reviewEvents)||0)),
        sharedInterestRead:e.sharedInterestRead===true,relationshipTaskDone:e.relationshipTaskDone===true,
        relationshipRankShift:e.relationshipRankShift===true,verifiedReadKind:READ_KINDS.has(e.verifiedReadKind)?e.verifiedReadKind:'',
        verifiedActionKind:VERIFIED_COMPLETION_KINDS.has(e.verifiedActionKind)?e.verifiedActionKind:'',
        verifiedEvidence:e.action==='verified_write'&&VERIFIED_COMPLETION_KINDS.has(e.verifiedActionKind)
          ?completionEvidence(e.verifiedActionKind):'',
        priorVerifiedReadOffered:e.priorVerifiedReadOffered===true,
        priorVerifiedReadReferenced:e.priorVerifiedReadReferenced===true,
        videoRoundFeedbackOffered:e.videoRoundFeedbackOffered===true}))}
  }
  return {offer,peek,settle,recordDecision,recordVerifiedCompletion,recordVideoStart,recordVideoRoundStart,recordVideoRoundFinish,status,inspectReviewOffline,closeReviewOffline}
}
