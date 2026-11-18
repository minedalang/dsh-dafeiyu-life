import {createNetworkPollBackoff,classifyPollFailure} from './network-poll-backoff.mjs'
import {createNotificationSentinelState} from './notification-sentinel-state.mjs'

/**
 * Unified Bilibili notification scheduler.
 * Two counter-only sentinels discover new private messages and social notices.
 * Full inbox/detail reads are demand-driven, with a 30-minute reconciliation
 * safety net. Active DM conversations retain their targeted adaptive lane.
 */
const MINUTE=60_000
const SENTINEL_INTERVAL_MS=5*MINUTE
const SCHEDULE_TICK_MS=5_000
const SENTINEL_STAGGER_MS=15_000
const runRow=()=>({lastStartedAt:0,lastFinishedAt:0,lastResult:'',lastError:'',lastDetails:null,lastHttpRequests:null,polling:false})
const countReads=readBudget=>{
  const rows=readBudget?.status?.()?.byKind||[]
  return Object.fromEntries(rows.filter(x=>typeof x?.kind==='string').map(x=>[x.kind,Number(x.hour)||0]))
}
const readDelta=(before,after)=>Object.fromEntries(Object.keys(after).map(kind=>[kind,Math.max(0,after[kind]-(before[kind]||0))]).filter(([,n])=>n>0))
const sum=object=>Object.values(object||{}).reduce((a,b)=>a+(Number(b)||0),0)
const isDeferred=value=>value?.skipped==='platform-read-protected'||value?.skipped==='read-budget-deferred'
const isSuccessful=value=>!!value&&typeof value==='object'&&!value.error&&!value.skipped

export function createInteractionScheduler({dm,comments,readPrivateUnread,readSocialUnread,getConfig,readBudget=null,dmCursor=null,
  dataDir='',getAccountTag=()=>'',logger=console,now=Date.now}){
  let stopped=true,timer,working=false,lastSentinelDispatchAt=0,sentinelStateError=''
  let fastLaneReason='not-evaluated',fastLaneCheckedAt=0
  const networkBackoff=dataDir?createNetworkPollBackoff({dataDir,getAccountTag,now}):null
  const sentinelState=dataDir?createNotificationSentinelState({dataDir,getAccountTag,now}):null
  const runKeys=['dmSentinel','socialSentinel','dm','replies','mentions','dmFast','dmContinuation']
  const runs=Object.fromEntries(runKeys.map(k=>[k,runRow()]))

  const enabledFor=cfg=>({
    dm:cfg.masterEnabled!==false&&cfg.dmWatch===true,
    replies:cfg.masterEnabled!==false&&(cfg.commentWatchReplies===true||cfg.ownerCommentAgentEnabled===true),
    mentions:cfg.masterEnabled!==false&&(cfg.commentAtEnabled===true||cfg.friendAtFeedbackEnabled===true||cfg.ownerCommentAgentEnabled===true),
  })
  const maxAt=(...values)=>Math.max(0,...values.map(x=>Number(x)||0))
  const budgetStatus=()=>readBudget?.status?.()||{}
  const networkStatus=()=>networkBackoff?.status?.()||{}
  const socialBackoffAllowed=()=>!networkBackoff||
    (networkBackoff.check('replies').allowed===true&&networkBackoff.check('mentions').allowed===true)
  const nextDmSentinelAt=(state,budget)=>maxAt(
    state.dm.lastCheckedAt?state.dm.lastCheckedAt+SENTINEL_INTERVAL_MS:0,
    budget.lastReadAtByKind?.['dm-unread']?budget.lastReadAtByKind['dm-unread']+(Number(budget.dmListIntervalMinutes)||5)*MINUTE:0,
    budget.dmUnreadNextAt,budget.retryAt,networkBackoff?.check('dm')?.nextAt)
  const nextSocialSentinelAt=(state,budget)=>maxAt(
    state.social.lastCheckedAt?state.social.lastCheckedAt+SENTINEL_INTERVAL_MS:0,
    budget.lastReadAtByKind?.['social-unread']?budget.lastReadAtByKind['social-unread']+5*MINUTE:0,
    budget.socialUnreadNextAt,budget.retryAt,networkBackoff?.check('replies')?.nextAt,networkBackoff?.check('mentions')?.nextAt)
  const dueSentinel=(lane,enabled,state,budget,at)=>{
    if(!enabled||budget.blocked)return false
    if(lane==='dm'&&(!readPrivateUnread||!networkBackoff?.check('dm')?.allowed&&networkBackoff))return false
    if(lane==='social'&&(!readSocialUnread||!socialBackoffAllowed()))return false
    return at>=(lane==='dm'?nextDmSentinelAt(state,budget):nextSocialSentinelAt(state,budget))
  }

  async function execute(keys,task,{backoffKey=''}={}){
    const started=now(),before=countReads(readBudget)
    for(const key of keys){runs[key].lastStartedAt=started;runs[key].polling=true}
    let value,error=''
    try{value=await task();if(value?.error)error=String(value.error)}
    catch(e){error=String(e?.message||e);if(!/BiliReadDeferredError|B站后台读取已暂停/.test(error))logger.error?.('后台通知调度执行错误：'+error)}
    const finished=now(),after=countReads(readBudget),delta=readDelta(before,after)
    const budgetDeferred=/BiliReadDeferredError|B站后台读取已暂停/.test(error)||isDeferred(value)
    const attempted=sum(delta)>0
    if(networkBackoff&&backoffKey&&!budgetDeferred){
      const confirmed=backoffKey==='dm'
        ?sum({'dm-unread':delta['dm-unread']||0,'dm-list':delta['dm-list']||0,'dm-messages':delta['dm-messages']||0})>0
        :sum({'social-unread':delta['social-unread']||0,'replies':delta['mcp:bili_received_replies']||0,'mentions':delta['mcp:bili_received_at_and_likes']||0})>0
      if(error&&classifyPollFailure(error)&&attempted)try{networkBackoff.settle(backoffKey,error)}catch(e){logger.error?.('网络退避状态保存失败：'+String(e?.message||e).slice(0,100))}
      else if(!error&&confirmed)try{networkBackoff.settle(backoffKey,'')}catch(e){logger.error?.('网络恢复观察保存失败：'+String(e?.message||e).slice(0,100))}
    }
    const details=value&&typeof value==='object'?{
      sent:Number(value.sent)||0,failed:Number(value.failed)||0,ignored:Number(value.ignored)||0,
      skipped:String(value.skipped||'').slice(0,80),
      changedCategories:Array.isArray(value.changedCategories)?value.changedCategories.slice(0,2):undefined,
    }:null
    for(const key of keys){Object.assign(runs[key],{
      lastFinishedAt:finished,polling:false,lastResult:error?'error':value?.skipped?'skipped':'completed',
      lastError:error,lastHttpRequests:{estimatedTotal:sum(delta),dmUnread:delta['dm-unread']||0,
        socialUnread:delta['social-unread']||0,dmList:delta['dm-list']||0,dmMessages:delta['dm-messages']||0,
        replies:delta['mcp:bili_received_replies']||0,mentions:delta['mcp:bili_received_at_and_likes']||0},
      lastDetails:details,
    })}
    return {value,error,budgetDeferred,attempted,delta}
  }

  async function readDmSentinel(){
    const result=await execute(['dmSentinel'],readPrivateUnread,{backoffKey:'dm'})
    if(!result.error&&!result.value?.skipped){
      try{sentinelState.recordDm(result.value)}catch(e){logger.error?.('私信未读计数快照未能安全保存，保持待核对：'+String(e?.message||e).slice(0,100))}
    }
    return result
  }
  async function readSocialSentinel(){
    const result=await execute(['socialSentinel'],readSocialUnread,{backoffKey:'replies'})
    if(!result.error&&!result.value?.skipped){
      try{sentinelState.recordSocial(result.value)}catch(e){logger.error?.('互动未读计数快照未能安全保存，保持待核对：'+String(e?.message||e).slice(0,100))}
    }
    return result
  }
  async function processDmDetails(state,budget,enabled){
    if(!enabled.dm||budget.blocked||!networkBackoff?.check('dm')?.allowed&&networkBackoff)return false
    const continuationDue=typeof dm.hasDueContinuation==='function'&&dm.hasDueContinuation()
    const needsBootstrap=state.dm.snapshot&&(state.dm.pending||continuationDue)&&typeof dm.needsBootstrap==='function'?await dm.needsBootstrap():false
    if(needsBootstrap){
      if(budget.dmListNextAt>now())return true // keep the bootstrap pending until its persisted list floor expires
      const result=await execute(['dm'],()=>dm.poll(),{backoffKey:'dm'})
      if(isSuccessful(result.value))try{sentinelState.markDmDetailSuccess()}catch(e){logger.error?.('私信基线完成状态未能保存：'+String(e?.message||e).slice(0,100))}
      return true
    }
    if(state.dm.pending&&!(budget.dmListNextAt>now())){
      const result=await execute(['dm'],()=>dm.poll(),{backoffKey:'dm'})
      if(isSuccessful(result.value))try{sentinelState.markDmDetailSuccess()}catch(e){logger.error?.('私信核对完成状态未能保存：'+String(e?.message||e).slice(0,100))}
      return true // a full-scan attempt was dispatched; do not stack another DM lane this tick
    }
    if(continuationDue){
      const result=await execute(['dmContinuation'],()=>dm.poll({continuationOnly:true}),{backoffKey:'dm'})
      return isSuccessful(result.value)
    }
    return false
  }
  async function processSocialDetails(state,budget,enabled){
    if(budget.blocked||!socialBackoffAllowed())return false
    const categories=sentinelState.pendingSocialCategories({repliesEnabled:enabled.replies,mentionsEnabled:enabled.mentions})
    if(!categories.length)return false
    const keys=categories
    const result=await execute(keys,()=>comments.poll({notifications:categories.includes('replies'),
      mentions:categories.includes('mentions'),top:false}),{backoffKey:'replies'})
    if(!result.error&&(isSuccessful(result.value)||result.value?.observedFeedback===true)){
      try{sentinelState.markSocialDetailSuccess(categories);return true}
      catch(e){logger.error?.('互动通知核对完成状态未能保存：'+String(e?.message||e).slice(0,100))}
    }
    return false
  }

  async function tick(){
    if(stopped||working)return
    working=true
    try{
      const cfg=getConfig();if(cfg.masterEnabled===false)return
      if(!sentinelState){const message='B站通知哨兵缺少持久化目录，已暂停后台读取';if(sentinelStateError!==message){logger.error?.(message);sentinelStateError=message}return}
      let accountScope='';try{accountScope=String(getAccountTag()||'')}catch{}
      if(!/^[a-f0-9]{16}$/.test(accountScope))return // No bound Bilibili account: wait silently.
      const enabled=enabledFor(cfg),at=now(),budget=budgetStatus()
      let state
      try{state=sentinelState.status()}catch(e){const message=String(e?.message||e).slice(0,120);if(sentinelStateError!==message){logger.error?.('B站通知哨兵账本不可用，已暂停自动读取：'+message);sentinelStateError=message}return}
      try{
        const reconcileMs=sentinelState.reconcileIntervalMs||30*MINUTE
        const t=now()
        const dmReconcile=enabled.dm&&state.dm.snapshot&&!state.dm.pending&&
          (!state.dm.bootstrapped||!state.dm.lastDetailAt||t-state.dm.lastDetailAt>=reconcileMs)
        const socialReconcile=['replies','mentions'].some(category=>
          enabled[category]&&state.social.snapshot&&!state.social.pendingCategories.includes(category)&&
          (!state.social.bootstrapped[category]||!state.social.lastDetailAt[category]||t-state.social.lastDetailAt[category]>=reconcileMs))
        if(dmReconcile||socialReconcile){
          sentinelState.requestReconciliation({dmEnabled:enabled.dm,repliesEnabled:enabled.replies,mentionsEnabled:enabled.mentions})
          state=sentinelState.status()
        }
        sentinelStateError=''
      }catch(e){const message=String(e?.message||e).slice(0,100);if(sentinelStateError!==message){logger.error?.('通知一致性核对状态不可用，已暂停自动读取：'+message);sentinelStateError=message}return}

      // Keep the two counter probes apart so a cold start does not burst both APIs.
      if(dueSentinel('dm',enabled.dm,state,budget,at)){
        await readDmSentinel();lastSentinelDispatchAt=now()
      }
      const refreshedBudget=budgetStatus()
      state=sentinelState.status()
      if(!lastSentinelDispatchAt||now()-lastSentinelDispatchAt>=SENTINEL_STAGGER_MS){
        if(dueSentinel('social',enabled.replies||enabled.mentions,state,refreshedBudget,now())){
          await readSocialSentinel();lastSentinelDispatchAt=now()
        }
      }

      const currentBudget=budgetStatus(),currentState=sentinelState.status()
      // A due DM full scan only follows a counter increase, one-time baseline,
      // or 30-minute reconciliation. Local Life continuation remains a
      // separate targeted path and never forces get_sessions.
      const fullDmDone=await processDmDetails(currentState,currentBudget,enabled)
      if(!fullDmDone&&enabled.dm&&!currentBudget.blocked&&
        (!networkBackoff||networkBackoff.check('dm').allowed)&&
        cfg.dmActivePollEnabled!==false&&typeof dm.nextFastUid==='function'){
        fastLaneCheckedAt=now();fastLaneReason='not-eligible'
        const active=dm.nextFastUid()
        if(active){fastLaneReason='fast-polled';await execute(['dmFast'],()=>dm.poll({fastUid:active}),{backoffKey:'dm'})}
        else fastLaneReason='no-eligible-active-session'
      }else{
        fastLaneCheckedAt=now()
        fastLaneReason=!enabled.dm||cfg.dmActivePollEnabled===false?'disabled':currentBudget.blocked?'read-budget-blocked':
          networkBackoff&&!networkBackoff.check('dm').allowed?'network-backoff':fullDmDone?'regular-dm-processed':'no-eligible-active-session'
      }
      await processSocialDetails(sentinelState.status(),budgetStatus(),enabled)
    }catch(e){logger.error?.('后台通知哨兵调度错误：'+String(e?.message||e))}
    finally{working=false}
  }
  function start(){if(!stopped)return;stopped=false;void tick();timer=setInterval(()=>{void tick()},SCHEDULE_TICK_MS);timer.unref?.()}
  function stop(){stopped=true;clearInterval(timer);timer=undefined}
  const nextAt=(key,enabled,current,budget)=>{
    if(!enabled||stopped)return null
    const back=key==='dm'?networkBackoff?.check('dm')?.nextAt:maxAt(networkBackoff?.check('replies')?.nextAt,networkBackoff?.check('mentions')?.nextAt)
    const due=key==='dm'?nextDmSentinelAt(current,budget):nextSocialSentinelAt(current,budget)
    return Math.max(due,Number(back)||0,Number(budget.retryAt)||0)
  }
  function status(){
    const cfg=getConfig(),current=now(),budget=budgetStatus(),state=(()=>{try{return sentinelState.status()}catch{return null}})()
    const enabled=enabledFor(cfg),back=networkStatus(),fast=dm.status?.().fast||null
    const dmNext=state?nextAt('dm',enabled.dm,state,budget):null
    const socialNext=state?nextAt('social',enabled.replies||enabled.mentions,state,budget):null
    const dmRow={enabled:enabled.dm,intervalMinutes:5,configuredIntervalMinutes:5,...runs.dmSentinel,
      nextAt:dmNext,lastDetails:{...(runs.dmSentinel.lastDetails||{}),pending:state?.dm.pending===true,
        bootstrapped:state?.dm.bootstrapped===true,lastDetailAt:state?.dm.lastDetailAt||0}}
    const socialBase={enabled:enabled.replies||enabled.mentions,intervalMinutes:5,configuredIntervalMinutes:5,...runs.socialSentinel,
      nextAt:socialNext,lastDetails:{...(runs.socialSentinel.lastDetails||{}),pendingCategories:state?.social.pendingCategories||[],
        lastDetailAt:state?.social.lastDetailAt||{replies:0,mentions:0}}}
    const checks={
      dm:dmRow,
      dmDetails:{enabled:enabled.dm,...runs.dm},
      replies:{...socialBase,enabled:enabled.replies,lastDetails:{...socialBase.lastDetails,category:'replies'}},
      mentions:{...socialBase,enabled:enabled.mentions,lastDetails:{...socialBase.lastDetails,category:'mentions'}},
      dmFast:{enabled:enabled.dm&&cfg.dmActivePollEnabled!==false,
        intervalSeconds:Math.max(10,Math.min(180,Number(fast?.nextIntervalSeconds)||Number(cfg.dmActivePollSeconds)||60)),
        baseIntervalSeconds:Math.max(10,Math.min(60,Number(cfg.dmActivePollSeconds)||60)),adaptive:fast?.adaptive===true,
        ...runs.dmFast,nextAt:null},
      dmContinuation:{enabled:enabled.dm,...runs.dmContinuation,nextAt:null},
    }
    return {running:!stopped,working,checkedAt:current,
      dmAdaptive:{sentinelIntervalMinutes:5,reconciliationMinutes:30},
      fastLane:{checkedAt:fastLaneCheckedAt,reason:fastLaneReason},activeDm:fast,
      sentinels:state?{private:{enabled:enabled.dm,intervalMinutes:5,lastCheckedAt:state.dm.lastCheckedAt,
        lastDetailAt:state.dm.lastDetailAt,pending:state.dm.pending,bootstrapped:state.dm.bootstrapped,
        unread:state.dm.snapshot?['followUnread','unfollowUnread','dustbinUnread'].reduce((n,k)=>n+(Number(state.dm.snapshot[k])||0),0):null,nextAt:dmNext},
        interaction:{enabled:enabled.replies||enabled.mentions,intervalMinutes:5,lastCheckedAt:state.social.lastCheckedAt,
          lastDetailAt:state.social.lastDetailAt,pendingCategories:state.social.pendingCategories,
          bootstrapped:state.social.bootstrapped,snapshot:state.social.snapshot,nextAt:socialNext},
        reconciliationMinutes:30}:null,
      readBudget:readBudget?budget:null,dmCursor:dmCursor?.status?.()||null,
      networkBackoff:back,checks}
  }
  const checkNow=async()=>{
    if(stopped)return {ok:false,error:'通知哨兵调度尚未启动',sentinels:status().sentinels}
    if(!working)await tick()
    return {ok:true,skipped:working?'scheduler-busy':'',sentinels:status().sentinels,checks:status().checks}
  }
  const recoveryReadGate=()=>{
    try{const lane=networkBackoff?.check('dm'),budget=budgetStatus()
      return {allowed:(lane?lane.allowed===true:true)&&budget.blocked!==true,
        retryAt:maxAt(lane?.nextAt,budget.retryAt)}
    }catch{return {allowed:false,retryAt:0}}
  }
  const clearNetworkBackoff=({expected}={})=>networkBackoff?networkBackoff.clearNetwork(expected):{ok:false,reason:'unavailable'}
  return {start,stop,tick,status,checkNow,recoveryReadGate,clearNetworkBackoff}
}
