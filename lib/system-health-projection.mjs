import {modelFailureExplanation} from './model-failure-diagnostics.mjs'
/** Derive owner-visible technical health from existing LOCAL status only.
 * No network checks, secret strings or speculative assertion of offline state.
 */
const asTime=n=>Number.isFinite(Number(n))&&Number(n)>0?Math.floor(Number(n)):0
const ISSUE_SEVERITY={model:'warning',read:'warning',network:'warning',scheduler:'critical','life-scheduler':'critical',send:'critical'}
export function systemHealthSnapshot({planner={},scheduler={},send={},vision={},schedulerExpected=true,lifeExpected=false,now=Date.now()}={}){
  const issues=[]
  const t=asTime(now),pulse=planner.schedulerPulse||planner.pulse||{}
  const modelRetryAt=asTime(planner.modelRetryAt||planner.modelBackoffUntil)
  const failCode=String(planner.modelFailureCode||'')
  // A failure in the past is not a current outage or active timer.
  if(modelRetryAt>t){
    const evidence=planner.modelFailureEvidence||{}
    const reason={category:failCode||'provider-unavailable',httpStatus:Number(evidence.httpStatus)||0}
    const count=Math.max(0,Math.min(99,Number(planner.modelFailureStreak)||0))
    const occurredAt=asTime(planner.modelFailureAt||pulse.lastErrorAt)
    const details=[modelFailureExplanation(reason),`连续失败 ${count} 次`,
      `正在自动退避；下次允许尝试：${new Date(modelRetryAt).toLocaleString('zh-CN')}`,
      reason.httpStatus?`HTTP ${reason.httpStatus}`:'',
      evidence.providerErrorType?`错误类型 ${String(evidence.providerErrorType).slice(0,60)}`:'',
      evidence.transportCode?`传输错误 ${String(evidence.transportCode).slice(0,25)}`:'',
      evidence.requestId?`请求 ID ${String(evidence.requestId).slice(0,64)}`:''].filter(Boolean)
    issues.push({id:'model',severity:'warning',title:'Life 模型失败 · 正在自动退避',
      detail:details.join('；')+'。取消退避不会验证中转站恢复，也不会立即调用模型。',
      retryAt:modelRetryAt,at:occurredAt,streak:count,category:failCode,code:/timeout/i.test(failCode)?'model-timeout':
        failCode==='upstream-gateway'?'model-upstream-gateway':'model-unavailable',
      technicalEvidence:{httpStatus:reason.httpStatus,providerErrorType:String(evidence.providerErrorType||'').slice(0,60),
        transportCode:String(evidence.transportCode||'').slice(0,25),requestId:String(evidence.requestId||'').slice(0,64)},
      inBackoff:true,canClear:true})
  }
  const read=scheduler.readBudget||{}
  const readRetryAt=asTime(read.retryAt)
  const dmReadThrottle=read.blocked===true&&read.reason==='platform-cooldown'&&
    /^dm-(?:list|messages)$/.test(String(read.lastRateLimitKind||''))
  const backoff=scheduler.networkBackoff||{}
  const dmBackoff=backoff.dm||{}
  const dmBackoffAt=asTime(dmBackoff.nextAt||dmBackoff.blockedUntil)
  const dmReadRetryAt=read.blocked===true?readRetryAt:0
  // Both guards must have expired before another DM request is allowed.
  const dmRetryAt=Math.max(dmBackoffAt,dmReadRetryAt)
  if(read.blocked===true&&readRetryAt>t&&!dmReadThrottle){
    issues.push({id:'read',severity:'warning',title:'B站读取已暂停',detail:read.reason==='platform-cooldown'
      ?'B站返回限流或风控信号，已共用读取冷却；不代表用户收到了私信。':'后台只读请求预算暂时用尽，已停止继续读取。',
      retryAt:readRetryAt,at:asTime(read.lastErrorAt),code:read.reason||'read-budget'})
  }
  const safeNames={dm:'私信监听与快通道',replies:'评论回复',mentions:'被 @ 提及'}
  const named=Array.isArray(backoff.channels)
    ?backoff.channels.map((entry,i)=>[String(entry?.name||entry?.key||'').slice(0,30),entry])
    :Object.entries(backoff.channels||backoff.tasks||backoff)
  const channels=named.filter(([name,entry])=>name!=='dm'&&Object.hasOwn(safeNames,name)
    &&asTime(entry?.nextAt||entry?.blockedUntil)>t
    &&(Number(entry?.streak||entry?.failures||entry?.consecutiveFailures||0)>0||['network','rate-limit'].includes(entry?.category)))
    .map(([name,entry])=>({
      id:name,label:safeNames[name],reason:entry.category==='rate-limit'?'B站限流':entry.category==='network'?'网络请求失败':'轮询暂缓',
      streak:Math.min(99,Math.max(0,Number(entry.streak||entry.failures||entry.consecutiveFailures)||0)),
      retryAt:asTime(entry.nextAt||entry.blockedUntil),
      category:String(entry.category||''),
      canClear:entry.category==='network'}))
  if(dmRetryAt>t){
    const detail=[]
    if(dmBackoffAt>t)detail.push(`私信专属${dmBackoff.category==='rate-limit'?'限流':'网络'}保护至 ${new Date(dmBackoffAt).toLocaleString('zh-CN')}`)
    if(dmReadRetryAt>t)detail.push(`${dmReadThrottle?'私信接口触发的共享限流':'共享 B 站读取预算'}至 ${new Date(dmReadRetryAt).toLocaleString('zh-CN')}`)
    channels.unshift({id:'dm',label:safeNames.dm,
      reason:dmReadThrottle||dmBackoff.category==='rate-limit'?'B站限流':dmReadRetryAt>t?'读取预算暂停':'网络请求失败',
      streak:Math.min(99,Math.max(0,Number(dmBackoff.streak)||0)),retryAt:dmRetryAt,
      category:String(dmBackoff.category||'rate-limit'),canClear:dmBackoff.category==='network'&&!read.blocked,
      detail:(detail.length?detail.join('；')+'；所有有效保护都结束后才会恢复私信读取。':'私信读取保护中')})
  }
  if(channels.length){
    issues.push({id:'network',severity:'warning',title:'后台监听正在退避',
      detail:`${channels.length} 个已识别渠道进入冷却；私信监听与快通道共用同一条保护状态，不是两次独立失败；不表示网络已确认断开，也不是消息发送失败。`,
      channels,retryAt:Math.min(...channels.map(x=>x.retryAt)),code:'network-backoff'})
  }
  // An idle Life round is not a fault. Only a stopped *expected* timer,
  // or a known stale local heartbeat, can justify a scheduler alert.
  if(lifeExpected){
    if(planner.running===false)issues.push({id:'life-scheduler',severity:'critical',title:'Life 自动调度未运行',
      detail:'自主生活已授权开启，但本地模型决策调度器没有运行。并非鱼鱼选择了休息。',retryAt:0,code:'life-scheduler-stopped'})
    else if(planner.running===true&&pulse.stale===true)issues.push({id:'life-scheduler',severity:'critical',title:'Life 调度心跳可能停滞',
      detail:'最近一次本地调度检查已超过 150 秒；请检查插件进程和重连状态。没有新模型决策本身不构成此告警。',
      at:asTime(pulse.lastCheckAt),retryAt:0,code:'life-scheduler-stale'})
  }
  if(schedulerExpected&&scheduler.running===false){issues.push({id:'scheduler',severity:'critical',title:'社交后台调度未运行',
    detail:'请核对插件开关和首次启动条件。',retryAt:0,code:'scheduler-stopped'})}
  if(Number(send.uncertain||send.unknown||0)>0){issues.push({id:'send',severity:'critical',title:'存在回执不确定的发送',
    detail:'请先到原平台核实；未知结果不自动重试。',retryAt:0,code:'send-unknown'})}
  issues.sort((a,b)=>(ISSUE_SEVERITY[b.id]==='critical'?1:0)-(ISSUE_SEVERITY[a.id]==='critical'?1:0))
  // Passive labels: last observed work, not a new connection test. An idle or
  // skipped scheduler tick is NOT proof of network health.
  const laneNames={dm:'私信监听与快通道',replies:'评论回复',mentions:'被 @ 提及'}
  const checks=scheduler.checks||{}
  const activeBackoff=scheduler.networkBackoff||{}
  const lanes=Object.entries(laneNames).map(([id,label])=>{
    const row=checks[id]||{},back=activeBackoff[id]||{}
    const retryAt=id==='dm'?dmRetryAt:asTime(back.nextAt||back.blockedUntil)
    const blocked=retryAt>t
    let state='unknown',detail='尚无真实轮询结果；未执行联网自检'
    if(row.enabled===false){state='disabled';detail='当前配置未开启'}
    else if(scheduler.running===false){state='failed';detail='后台监听调度未运行'}
    else if(blocked){state='backoff';detail=id==='dm'
      ?(channels.find(x=>x.id==='dm')?.detail||'私信监听和快通道共用保护，等待所有冷却结束')
      :back.category==='rate-limit'?'B站限流，等待保护期结束':'网络失败，等待只读恢复尝试'}
    else if(row.polling===true){state='running';detail='轮询进行中'}
    else if(row.lastResult==='error'){state='failed';detail='上次真实轮询失败'}
    else if(row.lastResult==='completed'){state='ok';detail='上次轮询完成（不等于此刻网络已探测通）'}
    else if(row.lastResult==='skipped'){detail='上次跳过，未证明网络连通'}
    const lastAt=asTime(row.lastFinishedAt||row.lastStartedAt)
    if(state==='ok'&&(!lastAt||t-lastAt>6*60*60*1000)){state='unknown';detail='上次成功记录已过六小时，无法确认当前状态'}
    return {id,label,state,lastAt,retryAt:blocked?retryAt:0,
      detail,streak:Math.min(99,Math.max(0,Number(back.streak)||0)),
      category:blocked?String(back.category||''):''}
  })
  const visionConfigured=vision.configured===true
  const lastVisionAt=asTime(vision.at)
  const visionRecent=lastVisionAt>0&&t-lastVisionAt<=6*60*60*1000
  const visionState=!visionConfigured?'disabled':!visionRecent?'unknown':vision.ok===true?'ok':'failed'
  const visionChannel={id:'video-vision',label:'视频视觉理解',state:visionState,
    lastAt:lastVisionAt,detail:!visionConfigured?'视觉能力未启用或未配置':!visionRecent?'尚无近六小时的生产观察回执（不额外识图）':
      vision.ok===true?'最近一次视频视觉模型返回可信采样观察':'最近一次视频视觉模型调用失败',
    model:String(vision.model||'').slice(0,90)}
  return {ok:true,state:issues.length?'degraded':'no-current-alert',issues:issues.slice(0,8),
    channels:[visionChannel,...lanes],
    checkedAt:t,note:'仅显示本地已有的可靠状态；没有额外网络探测，未发现告警也不等于已确认网络连通。'}
}
