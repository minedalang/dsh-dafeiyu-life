/**
 * dev.4 A/B: platform-neutral, account-scoped life wake inbox. Only anonymous
 * event classes are persisted here; it is NOT a second memory, relationship
 * database, permission store or authoritative platform receipt.
 */
import {createHash,randomBytes} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {withLifeEventLedgerLock} from './life-planner-atomic.mjs'

const MAX_BYTES=96_000,RETENTION=7*86_400_000
const RETRY_LIMIT=3,RETRY_BASE_MS=5*60_000,RETRY_MAX_MS=60*60_000
const RETRY_REASONS=new Set(['invalid','model-error','preflight-error'])
// A valid choice about another topic is not evidence that the fish rejected
// every incoming life signal. Leave unselected signals for a bounded later
// chance without converting them into model failures or permanent tasks.
const PASSOVER_DELAYS_MS=[30*60_000,2*60*60_000,6*60*60_000]
const PASSOVER_LIMIT=PASSOVER_DELAYS_MS.length
const TYPES=new Set(['quiet-window','video-round-ended','manual-wake','dm-received','comment-received','exploration-ready'])
const SCOPE=/^[a-f0-9]{16}$/
const PLATFORM=/^[a-z][a-z0-9_-]{1,30}$/
const blank=()=>({version:1,events:[],videoStarts:[],videoRounds:[],timeline:[]})
const ROUND_ID=/^[a-f0-9]{24}$/
const ROUND_SOURCES=new Set(['life-agent','manual'])
const ROUND_RESULTS=new Set(['started','completed','failed','interrupted'])
// A readable life journal is *not* a second memory or a platform receipt.
// All persisted values are bounded enums or opaque hashes; never persist model
// prose, conversation contents, UIDs, BVIDs or credentials in this journal.
const ACTIONS=new Set(['skip','consider_social','use_capability','begin_exploration','inspect_exploration',
  'inspect_creator_space','abandon_exploration','inspect_opportunity','review_public','defer','dismiss','reflect','execute_read'])
const RESULT=/^[a-z][a-z0-9-]{0,54}$/
const OPTION_KEYS=['todos','cues','intentions','opportunities','social','video','reflection','affinity','relationship']
const READ_KINDS=new Set(['todo-read','video-metadata','public-evidence'])
const BLOCKERS=new Set(['video-capability-unavailable','video-daily-limit','video-launch-cooldown','no-verified-candidates'])
const hashId=value=>createHash('sha256').update('life-continuation\0'+value).digest('hex').slice(0,16)

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
    const events=value.events.slice(-100).map(e=>e?.state==='considered'&&e.result==='invalid'?
      {...e,state:'retryable',result:'invalid-model-output',failures:1,retryAt:Number(e.at||0)+RETRY_BASE_MS}:e)
    return {version:1,events,videoStarts:value.videoStarts.slice(-50),
      videoRounds:Array.isArray(value.videoRounds)?value.videoRounds.slice(-32):[],
      timeline:Array.isArray(value.timeline)?value.timeline.slice(-50):[]}
  }
  const prune=value=>{
    const t=now()
    value.events=value.events.filter(e=>e&&Number.isSafeInteger(e.at)&&e.at<=t+60_000&&t-e.at<RETENTION&&TYPES.has(e.kind)&&PLATFORM.test(e.platform)).slice(-60)
    value.videoStarts=value.videoStarts.filter(x=>Number.isSafeInteger(x)&&x<=t+60_000&&t-x<RETENTION).slice(-30)
    value.videoRounds=(Array.isArray(value.videoRounds)?value.videoRounds:[]).filter(r=>
      r&&ROUND_ID.test(String(r.id||''))&&ROUND_SOURCES.has(r.source)&&ROUND_RESULTS.has(r.state)&&
      Number.isSafeInteger(r.startedAt)&&r.startedAt<=t+60_000&&t-r.startedAt<RETENTION).slice(-24)
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
    if(value.events.some(e=>e.id===id))return {ok:true,created:false,id}
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
    const pending=prune(load()).events.filter(e=>e.state==='pending'||e.state==='retryable'&&Number(e.retryAt||0)<=now())
    // An explicit, recent human wake must be visible this turn even if the
    // account has a backlog. Preserve FIFO for genuine social/video events.
    const manual=[...pending].reverse().find(e=>e.kind==='manual-wake')
    // The later exploration choice must not be buried behind repeated quiet
    // wakes. Manual and social signals retain their higher priority.
    const prioritized=[...(manual?[manual]:[]),...pending.filter(e=>e.id!==manual?.id&&['dm-received','comment-received'].includes(e.kind)),
      ...pending.filter(e=>e.id!==manual?.id&&e.kind==='exploration-ready'),
      ...pending.filter(e=>e.id!==manual?.id&&!['dm-received','comment-received','exploration-ready'].includes(e.kind))]
    return prioritized.slice(0,Math.max(0,Math.min(8,Number(limit)||4)))
      .map(e=>({id:e.id,kind:e.kind,platform:e.platform,at:e.at}))
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
  const recordDecision=({eventIds=[],action='skip',result='',targetId='',mode='shadow',failed=false,options={},blocker='',sharedInterestRead=false,relationshipTaskDone=false,relationshipRankShift=false,verifiedReadKind='',priorVerifiedReadOffered=false,priorVerifiedReadReferenced=false}={})=>{
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
    value.timeline.push({at:now(),mode,kinds,action,result:proof,failed:failed===true,
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
      priorVerifiedReadReferenced:priorVerifiedReadReferenced===true})
    save(value)
    return {ok:true}
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
  const recordVideoRoundStart=({source='life-agent'}={})=>{
    if(!ROUND_SOURCES.has(source))throw Error('Invalid video round source')
    return mutate(()=>{
      const value=prune(load()),id=randomBytes(12).toString('hex')
      value.videoRounds.push({id,source,state:'started',startedAt:now(),endedAt:0,pickedCount:null})
      save(value)
      return {ok:true,id}
    })
  }
  const recordVideoRoundFinish=(id,{exitCode=null,pickedCount=null}={})=>{
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
    const recentVideoRounds=value.videoRounds.slice(-12).reverse().map(r=>({
      ref:r.id.slice(0,12),source:r.source,
      // After a crash/restart there may be no completion receipt. Do not
      // silently mark an old process successful or schedule a replay.
      state:r.state==='started'&&t-r.startedAt>8*3600_000?'unverified-interruption':r.state,
      startedAt:r.startedAt,endedAt:r.endedAt||0,
      exitCode:Number.isSafeInteger(r.exitCode)&&r.exitCode>=-128&&r.exitCode<=255?r.exitCode:null,
      pickedCount:r.state==='completed'&&Number.isSafeInteger(r.pickedCount)?r.pickedCount:null
    }))
    return {ok:true,recentVerifiedReads,recentVideoRounds,pending:value.events.filter(e=>e.state==='pending').length,
      retryable:retryable.length,retryDue:retryable.filter(due).length,
      unselectedWaiting:notSelected.length,unselectedDue:notSelected.filter(due).length,
      nextRetryAt:retryTimes.length?Math.min(...retryTimes):0,
      failed:value.events.filter(e=>e.state==='failed').length,
      needsReview:value.events.filter(e=>e.state==='review').length,
      considered:value.events.filter(e=>e.state==='considered').length,
      pendingSocial:value.events.filter(e=>due(e)&&['dm-received','comment-received'].includes(e.kind)).length,
      recentSocialKinds:value.events.filter(e=>['dm-received','comment-received'].includes(e.kind)).slice(-8).map(e=>e.kind),
      videoStartsToday:value.videoStarts.filter(x=>new Date(x).toLocaleDateString('en-CA')===today).length,
      lastVideoAt:value.videoStarts.at(-1)||0,
      recent:value.events.slice(-10).reverse().map(e=>({kind:e.kind,platform:e.platform,at:e.at,state:e.state,result:e.result||'',
        failures:Math.max(0,Math.min(RETRY_LIMIT,Number(e.failures)||0)),
        passovers:Math.max(0,Math.min(PASSOVER_LIMIT,Number(e.passovers)||0)),
        retryAt:e.state==='retryable'?Number(e.retryAt||0):0})),
      timeline:value.timeline.slice(-30).reverse().map(e=>({at:e.at,mode:e.mode,kinds:e.kinds,
        action:e.action,result:e.result,failed:e.failed,continued:e.continued,options:e.options||null,blocker:e.blocker||'',
        selectedSocialKind:['dm-received','comment-received'].includes(e.selectedSocialKind)?e.selectedSocialKind:'',
        notSelectedWaiting:Math.max(0,Math.min(8,Number(e.notSelectedWaiting)||0)),
        reviewEvents:Math.max(0,Math.min(8,Number(e.reviewEvents)||0)),
        sharedInterestRead:e.sharedInterestRead===true,relationshipTaskDone:e.relationshipTaskDone===true,
        relationshipRankShift:e.relationshipRankShift===true,verifiedReadKind:READ_KINDS.has(e.verifiedReadKind)?e.verifiedReadKind:'',
        priorVerifiedReadOffered:e.priorVerifiedReadOffered===true,
        priorVerifiedReadReferenced:e.priorVerifiedReadReferenced===true}))}
  }
  return {offer,peek,settle,recordDecision,recordVideoStart,recordVideoRoundStart,recordVideoRoundFinish,status,inspectReviewOffline,closeReviewOffline}
}
