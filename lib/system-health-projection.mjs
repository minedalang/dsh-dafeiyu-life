import {modelFailureExplanation} from './model-failure-diagnostics.mjs'
/** Derive owner-visible technical health from existing LOCAL status only.
 * No network checks, secret strings or speculative assertion of offline state.
 */
const asTime=n=>Number.isFinite(Number(n))&&Number(n)>0?Math.floor(Number(n)):0
const ISSUE_SEVERITY={model:'warning',read:'warning',network:'warning',scheduler:'critical','life-scheduler':'critical',send:'critical',vision:'warning'}
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
    /^dm-(?:list|messages|unread)$/.test(String(read.lastRateLimitKind||''))
  const backoff=scheduler.networkBackoff||{}
  const dmBackoff=backoff.dm||{}
  const dmBackoffAt=asTime(dmBackoff.nextAt||dmBackoff.blockedUntil)
  const dmReadRetryAt=read.blocked===true?readRetryAt:0
  const dmAdaptiveRetryAt=Number(read.dmListRateLevel)>0?asTime(read.dmUnreadNextAt):0
  // Both guards and any persisted adaptive sentinel floor must expire before another DM read.
  const dmRetryAt=Math.max(dmBackoffAt,dmReadRetryAt,dmAdaptiveRetryAt)
  if(read.blocked===true&&readRetryAt>t&&!dmReadThrottle){
    issues.push({id:'read',severity:'warning',title:read.reason==='platform-cooldown'?'B站限流保护中':'B站读取已暂停',detail:read.reason==='platform-cooldown'
      ?'B站返回限流或风控信号，已共用读取冷却；不代表用户收到了私信。':'后台只读请求预算暂时用尽，已停止继续读取。',
      retryAt:readRetryAt,at:asTime(read.lastErrorAt),code:read.reason||'read-budget'})
  }
  // A DM -509 lowers comment/@ notification frequency independently of the
  // shorter global read cooldown. This is deliberate protection, not a fresh
  // comment API failure or proof of an unsent response.
  const socialProtectionAt=asTime(read.socialProtectionUntil)
  if(socialProtectionAt>t&&!dmReadThrottle&&!issues.some(x=>x.id==='read'))issues.push({id:'read',severity:'warning',
    title:'B站限流保护中',detail:'评论回复和 @ 通知暂缓读取；私信按独立退避恢复。本地 Life 思考不受影响。',
    retryAt:socialProtectionAt,at:asTime(read.lastErrorAt),code:'social-rate-protection'})
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
    if(dmBackoffAt>t)detail.push(dmBackoff.recoverySuccesses>0?`私信限流恢复观察（${dmBackoff.recoverySuccesses}/3 次成功），慢速探测至 ${new Date(dmBackoffAt).toLocaleString('zh-CN')}`:`私信专属${dmBackoff.category==='rate-limit'?'限流':'网络'}保护至 ${new Date(dmBackoffAt).toLocaleString('zh-CN')}`)
    if(dmReadRetryAt>t)detail.push(`${dmReadThrottle?'私信接口触发的共享限流':'共享 B 站读取预算'}至 ${new Date(dmReadRetryAt).toLocaleString('zh-CN')}`)
    if(dmAdaptiveRetryAt>t&&dmAdaptiveRetryAt>dmReadRetryAt)detail.push(`私信未读哨兵自适应间隔至 ${new Date(dmAdaptiveRetryAt).toLocaleString('zh-CN')}`)
    channels.unshift({id:'dm',label:safeNames.dm,
      reason:dmReadThrottle||dmBackoff.category==='rate-limit'||dmAdaptiveRetryAt>t?'B站限流保护':dmReadRetryAt>t?'读取预算暂停':'网络请求失败',
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
    const socialKind=id==='replies'?'mcp:bili_received_replies':id==='mentions'?'mcp:bili_received_at_and_likes':''
    const socialRetryAt=Math.max(socialKind?asTime(read.socialEndpoints?.[socialKind]):0,asTime(read.socialSafeUntil)>t?asTime(read.socialUnreadNextAt):0)
    const retryAt=id==='dm'?dmRetryAt:Math.max(asTime(back.nextAt||back.blockedUntil),socialRetryAt)
    const blocked=retryAt>t
    let state='unknown',detail='尚无真实轮询结果；未执行联网自检'
    if(row.enabled===false){state='disabled';detail='对应后台监听或处理功能当前未开启（不是尚未收到或回复过消息）；请检查总开关、自主能力与该项互动设置。'}
    else if(scheduler.running===false){state='failed';detail='后台监听调度未运行'}
    else if(blocked){state='backoff';detail=id==='dm'
      ?(channels.find(x=>x.id==='dm')?.detail||'私信监听和快通道共用保护，等待所有冷却结束')
      :socialRetryAt>t?'B站限流保护中，互动通知哨兵与详情读取正在低频观察（非评论接口新报错）':back.category==='rate-limit'?'B站限流，等待保护期结束':'网络失败，等待只读恢复尝试'}
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
  // Never assign an old DSH visual attempt to the NEW local Ollama selection.
  // Ordinary Life/interaction model invocations do not prove visual observation.
  const attemptMode=vision.lastAttempt?.provider==='llama.cpp'?'independent_native':vision.lastAttempt?.mode
  const routeChanged=Boolean(attemptMode&&vision.mode&&attemptMode!==vision.mode)
  const modelChanged=Boolean(!routeChanged&&['independent_local','independent_native'].includes(vision.mode)&&vision.backendModel&&
    attemptMode===vision.mode&&vision.lastAttempt?.model&&
    vision.lastAttempt.model!==vision.backendModel)
  const visionRecent=!(routeChanged||modelChanged)&&lastVisionAt>0&&t-lastVisionAt<=6*60*60*1000
  const visionState=!visionConfigured?'disabled':!visionRecent?'unknown':vision.ok===true?'ok':'failed'
  const visionFailures={ollama_service_offline:'本地 Ollama 服务未启动',ollama_model_missing:'所选 Ollama 模型未安装',
    ollama_http_error:'Ollama 返回错误',ollama_request_timeout:'Ollama 识图超时',
    ollama_connection_failed:'Ollama 连接失败',vision_board_deadline:'分镜识图超时',
    vision_board_time_mismatch:'分镜时间码校验未通过',vision_board_grid_mismatch:'分镜格号校验未通过',
    vision_board_truncated:'模型回答被截断',vision_board_empty_answer:'模型没有有效画面回答',
    vision_board_unsegmented:'分镜回答未按图分段',vision_board_unclassified:'视觉分镜识别失败'}
  const nativeFailures={ollama_service_offline:'内置视觉运行时不可用',ollama_model_missing:'内置视觉服务未找到所选模型',
    ollama_http_error:'内置视觉服务返回错误',ollama_request_timeout:'内置视觉识图超时',ollama_connection_failed:'内置视觉服务连接失败'}
  const visionReason=(attemptMode==='independent_native'?nativeFailures[vision.lastAttempt?.errorCode]:null)||visionFailures[vision.lastAttempt?.errorCode]
  const probe=visionConfigured&&vision.mode==='independent_local'?vision.localProbe:null
  const probeAt=asTime(probe?.at),probeRecent=probeAt>0&&probeAt<=t&&t-probeAt<=60_000
  const probeState=probeRecent&&['ready','unavailable','model-missing','unverified','port-conflict'].includes(probe?.state)?probe.state:''
  const probeIssues={'port-conflict':['Ollama 端口存在多个监听进程','检测到多个进程监听 11434（可能是 IPv4 / IPv6 两个实例）。请等待推理结束，退出重复服务，仅保留一个 Ollama 后刷新；不会自动结束进程或切换地址。','ollama-port-conflict'],unavailable:['Ollama 本地服务不可用','无法读取本机 Ollama 模型清单。请在开始菜单启动 Ollama，然后使用「检查 Ollama 服务」。不会自动改用其他模型，也不代表鱼鱼已观看。','ollama-service-unavailable'],
    'model-missing':['Ollama 视觉模型未安装','Ollama 已响应，但当前所选视觉模型不在模型清单中；请到 AI 模型页检查并验收。','ollama-model-missing'],
    unverified:['Ollama 视觉模型待核验','本机服务已响应，当前模型缺少有效的人工视觉验收；请到 AI 模型页核验。','ollama-model-unverified']}
  if(probeIssues[probeState]){
    const [title,detail,code]=probeIssues[probeState]
    issues.push({id:'vision',severity:'warning',title,detail,code,at:probeAt,retryAt:0,canRestoreOllama:false,canCheckOllama:probeState==='unavailable'})
  }else if(visionConfigured&&vision.mode==='independent_native'&&vision.nativeProbe&&vision.nativeProbe.ready!==true){
    issues.push({id:'vision',severity:'warning',title:'内置视觉资源未就绪',detail:'所选模型文件或运行时未就绪；请到 AI 模型页检查。不会自动切换后端。',code:'native-assets-not-ready',at:0,retryAt:0,canRestoreOllama:false})
  }else if(visionConfigured&&vision.mode==='independent_dsh'&&vision.remoteProbe&&vision.remoteProbe.verified!==true){
    issues.push({id:'vision',severity:'warning',title:'DSH 视觉待验收',detail:'当前远程路由尚未取得有效图片验收；请到 AI 模型页检查。',code:'dsh-vision-unverified',at:0,retryAt:0,canRestoreOllama:false})
  }else if(visionState==='failed'){
    const failureCode=vision.lastAttempt?.errorCode
    // A current ready service supersedes a historical offline/missing-model warning,
    // but is never a new successful image inference receipt.
    if(!(probeState==='ready'&&['ollama_service_offline','ollama_connection_failed','ollama_model_missing'].includes(failureCode)))
      issues.push({id:'vision',severity:'warning',title:'最近一次视频视觉未完成',detail:'最近一次视觉调用未通过核验'+(visionReason?'：'+visionReason:'')+'。未计为已观看；请检查 AI 模型或运行诊断。',code:visionReason?failureCode:'vision-attempt-failed',at:lastVisionAt,retryAt:0,canRestoreOllama:false})
  }
  const visionChannel={id:'video-vision',label:'视频视觉理解',state:visionState,
    lastAt:routeChanged||modelChanged?0:lastVisionAt,detail:!visionConfigured?'视觉能力未启用或未配置':routeChanged?
      '当前视觉路由已切换；上次识图属于旧模式，不能作为现有模型结果':modelChanged?
      '当前本地视觉模型已更换；上一次模型的结果不能作为这次选定模型的验收':!visionRecent?
      '尚无近六小时的当前视觉路由生产回执（不额外识图）':
      vision.ok===true?'最近一次视频视觉模型返回可信采样观察':
        '最近一次视频视觉模型调用失败'+(visionReason?'：'+visionReason:'（可导出视觉故障码进一步检查）'),
    model:String(vision.model||'').slice(0,90)}
  const serviceChannel=vision.mode==='independent_native'?{id:'native-vision-service',label:'内置视觉模型',state:!visionConfigured?'disabled':vision.nativeProbe?.ready?'ok':vision.nativeProbe?'failed':'unknown',lastAt:0,detail:!visionConfigured?'未启用内置视觉':vision.nativeProbe?.ready?'模型文件与运行时存在；实际识图以生产回执为准。':vision.nativeProbe?'所选模型或运行时未就绪，请到 AI 模型页检查。':'尚未读取资源状态'}:vision.mode==='independent_dsh'?{id:'dsh-vision-service',label:'DSH 视觉模型',state:!visionConfigured?'disabled':vision.remoteProbe?.verified?'ok':'unknown',lastAt:0,detail:!visionConfigured?'未启用 DSH 视觉':vision.remoteProbe?.verified?'当前路由图片验收已认可；不代表新请求成功。':'当前远程路由尚未取得有效图片验收，请到 AI 模型页检查。'}:probeState?{id:'ollama-service',label:'Ollama 本地服务',state:probeState==='ready'?'ok':'failed',lastAt:probeAt,
    detail:probeState==='ready'?'本机模型清单已响应、所选模型已验收；不代表已完成新的视觉观察。':probeIssues[probeState][1]}:null
  issues.sort((a,b)=>(ISSUE_SEVERITY[b.id]==='critical'?1:0)-(ISSUE_SEVERITY[a.id]==='critical'?1:0))
  return {ok:true,state:issues.length?'degraded':'no-current-alert',issues:issues.slice(0,8),
    channels:[visionChannel,...(serviceChannel?[serviceChannel]:[]),...lanes],
    checkedAt:t,note:'本地记录、内置资源状态、DSH 验收记录及低频本机 Ollama 模型清单检查；不调用识图模型、不探测 B站，未发现告警也不等于已确认网络连通。'}
}
