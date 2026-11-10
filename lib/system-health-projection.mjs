/** Derive owner-visible technical health from existing LOCAL status only.
 * No network checks, secret strings or speculative assertion of offline state.
 */
const asTime=n=>Number.isFinite(Number(n))&&Number(n)>0?Math.floor(Number(n)):0
const ISSUE_SEVERITY={model:'warning',read:'warning',network:'warning',scheduler:'critical',send:'critical'}
export function systemHealthSnapshot({planner={},scheduler={},send={},schedulerExpected=true,now=Date.now()}={}){
  const issues=[]
  const t=asTime(now),pulse=planner.schedulerPulse||planner.pulse||{}
  const modelRetryAt=asTime(planner.modelRetryAt||planner.modelBackoffUntil)
  const failCode=String(planner.modelFailureCode||pulse.lastErrorCode||'')
  if((modelRetryAt>t||/provider-unavailable|timeout|model-call|model-error/i.test(failCode))&&failCode){
    issues.push({id:'model',severity:'warning',title:'Life 模型暂不可用',
      detail:/timeout/i.test(failCode)?'本轮模型调用曾超时；技术失败不是鱼鱼选择休息。':'模型调用曾失败；技术失败不是自主沉默。',
      retryAt:modelRetryAt,at:asTime(pulse.lastErrorAt),code:/timeout/i.test(failCode)?'model-timeout':'model-unavailable'})
  }
  const read=scheduler.readBudget||{}
  if(read.blocked===true&&asTime(read.retryAt)>t){
    issues.push({id:'read',severity:'warning',title:'B站读取已暂停',detail:read.reason==='platform-cooldown'
      ?'B站返回限流或风控信号，已共用读取冷却；不代表用户收到了私信。':'后台只读请求预算暂时用尽，已停止继续读取。',
      retryAt:asTime(read.retryAt),at:asTime(read.lastErrorAt),code:read.reason||'read-budget'})
  }
  const backoff=scheduler.networkBackoff||{}
  const entries=Array.isArray(backoff.channels)?backoff.channels:Object.values(backoff.channels||backoff.tasks||backoff)
  const blocked=entries.filter(x=>asTime(x?.nextAt||x?.blockedUntil)>t&&(Number(x?.streak||x?.failures||x?.consecutiveFailures||0)>0||x?.category==='network'))
  if(blocked.length){
    issues.push({id:'network',severity:'warning',title:'后台监听正在退避',
      detail:`${blocked.length} 个轮询渠道最近发生网络失败；下次尝试时间来自调度器，不表示网络已被确认断开。`,
      retryAt:Math.min(...blocked.map(x=>asTime(x.nextAt||x.blockedUntil))),code:'network-backoff'})
  }
  if(schedulerExpected&&scheduler.running===false){issues.push({id:'scheduler',severity:'critical',title:'社交后台调度未运行',
    detail:'请核对插件开关和首次启动条件。',retryAt:0,code:'scheduler-stopped'})}
  if(Number(send.uncertain||send.unknown||0)>0){issues.push({id:'send',severity:'critical',title:'存在回执不确定的发送',
    detail:'请先到原平台核实；未知结果不自动重试。',retryAt:0,code:'send-unknown'})}
  issues.sort((a,b)=>(ISSUE_SEVERITY[b.id]==='critical'?1:0)-(ISSUE_SEVERITY[a.id]==='critical'?1:0))
  return {ok:true,state:issues.length?'degraded':'no-current-alert',issues:issues.slice(0,8),
    checkedAt:t,note:'仅显示本地已有的可靠状态；没有额外网络探测，未发现告警也不等于已确认网络连通。'}
}
