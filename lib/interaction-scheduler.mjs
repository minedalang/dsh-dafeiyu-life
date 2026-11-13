import {createNetworkPollBackoff} from './network-poll-backoff.mjs'
/**
 * 统一后台轮询：私信、收到的评论回复、被 @ 邀请。
 * 旧版近期视频热评巡查已完全停用。
 * 仅私信、评论通知、@ 三个间隔仍生效；评论来源在同一个 tick 内合并执行，以保留同一通知的去重能力。
 * 状态仅表示本次 DSH 宿主进程中的检查；不把轮询成功等同于成功发送评论。
 */
const MINUTE = 60_000;
const SCHEDULE_TICK_MS = 5_000; // lightweight local tick; no network without a due job
const definitions = Object.freeze({
  dm: {key:'dmWatch',minutes:'dmWatchMinutes',defaultMinutes:2},
  replies: {key:'commentWatchReplies',minutes:'commentReplyWatchMinutes',defaultMinutes:3},
  mentions: {key:'commentAtEnabled',minutes:'commentAtWatchMinutes',defaultMinutes:3},
  // Legacy top polling intentionally removed. Hot comments are read only for a specific reply.
});
const interval = (value,fallback) => Number.isFinite(Number(value)) && Number(value)>=1
  ? Math.max(1,Math.min(120,Math.floor(Number(value)))) : fallback;
export function createInteractionScheduler({dm,comments,getConfig,readBudget=null,dmCursor=null,dataDir='',getAccountTag=()=>'',logger=console,now=Date.now}) {
  let stopped=true,timer,working=false;
  // No UID or message content: record why the fast DM check was not dispatched.
  let fastLaneReason='not-evaluated',fastLaneCheckedAt=0;
  const networkBackoff=dataDir?createNetworkPollBackoff({dataDir,getAccountTag,now}):null;
  const runs=Object.fromEntries([...Object.keys(definitions),'dmFast'].map(k=>[k,{
    lastStartedAt:0,lastFinishedAt:0,lastResult:'',lastError:'',lastDetails:null,lastHttpRequests:null,polling:false,
  }]));
  const configFor=(cfg,key)=>{
    const d=definitions[key];return {
      enabled:cfg.masterEnabled!==false && (cfg[d.key]===true || (key==='mentions'&&(cfg.friendAtFeedbackEnabled===true||cfg.ownerCommentAgentEnabled===true))),
      intervalMinutes:interval(cfg[d.minutes],d.defaultMinutes),
    };
  };
  const countReads=()=>{
    const rows=readBudget?.status?.()?.byKind||[]
    return Object.fromEntries(rows.filter(x=>typeof x?.kind==='string')
      .map(x=>[x.kind,Number(x.hour)||0]))
  }
  async function execute(keys,task) {
    const started=now(),readBefore=countReads();
    for (const key of keys){runs[key].lastStartedAt=started;runs[key].polling=true;}
    let value,error='';
    try {value=await task();if(value?.error)error=String(value.error);}
    catch(e){error=String(e?.message||e);logger.error?.('后台轮询执行错误：'+error);}
    const finished=now(),readAfter=countReads();
    // A poll may issue one list request plus multiple detail requests.
    // These counts are locally observed dispatch attempts (not B站 receipts).
    // Shared guards may also serve other tasks concurrently, so show them
    // as approximate per-poll counts rather than absolute exclusive ownership.
    const readDelta=Object.fromEntries(Object.keys(readAfter)
      .map(kind=>[kind,Math.max(0,readAfter[kind]-(readBefore[kind]||0))])
      .filter(([,n])=>n>0));
    if(networkBackoff)for(const key of keys){try{networkBackoff.settle(key==='dmFast'?'dm':key,error)}catch(e){logger.error?.('网络退避状态保存失败：'+String(e?.message||e).slice(0,100))}}
    for(const key of keys){
      Object.assign(runs[key],{lastFinishedAt:finished,polling:false,
        lastResult:error?'error':value?.skipped?'skipped':'completed',lastError:error,
        lastHttpRequests:{estimatedTotal:Object.values(readDelta).reduce((a,b)=>a+b,0),
          dmList:readDelta['dm-list']||0,dmMessages:readDelta['dm-messages']||0},
        lastDetails:value&&typeof value==='object'?{
          sent:Number(value.sent)||0,failed:Number(value.failed)||0,ignored:Number(value.ignored)||0,
          skipped:String(value.skipped||'').slice(0,80),
        }:null,
      });
    }
  }
  async function tick(){
    if(stopped||working)return;working=true;
    try{
      const cfg=getConfig();if(cfg.masterEnabled===false)return;
      const nowMs=now();
      const pause=readBudget?.status?.()||{};
      const due=(key)=>{const opts=configFor(cfg,key),last=runs[key].lastStartedAt;
        return opts.enabled&&!runs[key].polling&&!pause.blocked&&(!networkBackoff||networkBackoff.check(key).allowed)&&(!last||nowMs>=last+opts.intervalMinutes*MINUTE);
      };
      const dmDue=due('dm');
      const commentKeys=['replies','mentions'].filter(due);
      const jobs=[];
      // Fast-lane eligibility is observable without revealing conversation IDs.
      // This does not call the DM model or alter the existing scheduler policy.
      fastLaneCheckedAt=nowMs
      fastLaneReason='not-eligible'
      if(dmDue){
        fastLaneReason='regular-dm-due'
        jobs.push(execute(['dm'],()=>dm.poll()))
      }
      // Fast lane is only a targeted fetch of a RECENTLY confirmed conversation;
      // it never calls get_sessions and shares the same read budget/backoff.
      else if(cfg.dmWatch!==true||cfg.dmActivePollEnabled===false)fastLaneReason='disabled'
      else if(runs.dm.polling||runs.dmFast.polling)fastLaneReason='poll-in-progress'
      else if(pause.blocked)fastLaneReason='read-budget-blocked'
      else if(networkBackoff&&!networkBackoff.check('dm').allowed)fastLaneReason='network-backoff'
      else if(typeof dm.nextFastUid!=='function')fastLaneReason='adapter-unavailable'
      else{
        const active=dm.nextFastUid()
        if(active){fastLaneReason='fast-polled';jobs.push(execute(['dmFast'],()=>dm.poll({fastUid:active})))}
        else fastLaneReason='no-eligible-active-session'
      }
      if(commentKeys.length)jobs.push(execute(commentKeys,()=>comments.poll({
        notifications:commentKeys.includes('replies'),mentions:commentKeys.includes('mentions'),top:false,
      })));
      await Promise.allSettled(jobs);
    }catch(e){logger.error?.('后台互动调度错误：'+String(e?.message||e));}
    finally{working=false;}
  }
  function start(){if(!stopped)return;stopped=false;void tick();timer=setInterval(()=>{void tick()},SCHEDULE_TICK_MS);timer.unref?.();}
  function stop(){stopped=true;clearInterval(timer);timer=undefined;}
  function status(){
    const cfg=getConfig(),current=now();
    return {running:!stopped,working,checkedAt:current,fastLane:{checkedAt:fastLaneCheckedAt,reason:fastLaneReason},activeDm:dm.status?.().fast||null,readBudget:readBudget?.status?.()||null,dmCursor:dmCursor?.status?.()||null,networkBackoff:networkBackoff?.status()||null,checks:Object.fromEntries(
      [...Object.keys(definitions),'dmFast'].map(key=>{
        const r=runs[key];
        if(key==='dmFast')return [key,{enabled:cfg.masterEnabled!==false&&cfg.dmWatch===true&&cfg.dmActivePollEnabled!==false,
          intervalSeconds:Math.max(10,Math.min(60,Number(cfg.dmActivePollSeconds)||10)),
          ...r,nextAt:null}];
        const opts=configFor(cfg,key);
        return [key,{...opts,...r,nextAt:!stopped&&opts.enabled
          ? r.polling?null:Math.max(networkBackoff?.check(key).nextAt||0,readBudget?.status?.()?.retryAt||0,r.lastStartedAt?Math.max(current,r.lastStartedAt+opts.intervalMinutes*MINUTE):current)
          :null}];
      })
    )};
  }
  return {start,stop,tick,status};
}
