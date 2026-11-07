/**
 * Read-only Phase 6/7/8 transition audit. No credential, UID, prompt, event
 * content or platform object is passed through. This is NOT a release switch.
 * Keep the result conservative: absent proof is 'unknown', never 'passed'.
 */
import {lifeDriverOwnership,lifeSettingsV2} from './life-settings-control.mjs'

const CHANNELS=['dm','comment']
const count=v=>Number.isSafeInteger(v)&&v>=0?v:0
const check=(id,status,detail)=>({id,status,detail})
export function lifeTransitionReadiness({config={},planner=null,handoff=null,transactions=null,shadow=null,accountReady=false,version='unknown'}={}){
  const settings=lifeSettingsV2(config)
  const ownership=lifeDriverOwnership(config)
  const lifeMode=settings.mode
  const active=config.masterEnabled===true&&config.autonomousPlannerEnabled===true&&['active','shadow'].includes(lifeMode)
  const eventHealth=planner?.lifeEvents?.ok===true?'passed':planner?.lifeEvents?.ok===false?'attention':'unknown'
  const fenceHealth=handoff?.ok===true&&handoff.accountReady===true?'passed':handoff?.ok===false?'attention':'unknown'
  const transactionHealth=transactions?.ok===true&&transactions.accountReady===true?'passed':transactions?.ok===false?'attention':'unknown'
  let inflight=0,needsReview=0,uncertain=0
  if(fenceHealth==='passed')for(const ch of CHANNELS){
    inflight+=count(handoff.channels?.[ch]?.inFlight)
    needsReview+=count(handoff.channels?.[ch]?.inFlightNeedsReview)
    if(handoff.channels?.[ch]?.held)needsReview++
  }
  if(transactionHealth==='passed')for(const ch of CHANNELS){
    const row=transactions.channels?.[ch]
    uncertain+=count(row?.attempted)+count(row?.uncertain)+count(row?.incomplete)
  }
  // Never imply that 'no pending writes' is a safe handoff when a ledger
  // could not be inspected. An uncertain result must NEVER be auto-retried.
  // A single ten-minute, process-local shadow window is never production
  // ownership proof. It can still reveal unpaired/contradictory decisions,
  // and give the maintainer concrete channel-specific sampling diagnostics.
  const shadowHealth=accountReady===true&&shadow?.enabled===true&&shadow?.mode==='read-only-shadow'
  const shadowComparison={}
  for(const ch of CHANNELS){
    const row=shadowHealth?shadow?.byChannel?.[ch]:null
    const paired=count(row?.paired),agreed=Math.min(paired,count(row?.agreed))
    shadowComparison[ch]={paired,agreed,disagreed:Math.min(paired,count(row?.disagreed)),
      missingLife:count(row?.awaitingLife),missingLegacy:count(row?.awaitingLegacy)}
  }
  const shadowSamples=CHANNELS.every(ch=>shadowComparison[ch].paired>=5)
  const shadowDisagreements=CHANNELS.reduce((sum,ch)=>sum+shadowComparison[ch].disagreed,0)
  const shadowPaired=CHANNELS.reduce((sum,ch)=>sum+shadowComparison[ch].paired,0)
  const shadowDiagnostic=!shadowHealth?'not-observed':!shadowSamples?'insufficient-samples':
    shadowDisagreements*5>shadowPaired?'high-disagreement':'short-window-observed'
  const status={accountReady:accountReady===true,lifeActive:active,
    legacyVideoRetired:ownership.legacyTimerRetired===true,
    oldSocialOwner:ownership.socialReplyOwner==='legacy'&&CHANNELS.some(ch=>handoff?.channels?.[ch]?.owner!=='life-agent'),
    socialOwnerByChannel:Object.fromEntries(CHANNELS.map(ch=>[ch,handoff?.channels?.[ch]?.owner==='life-agent'?'life-agent':'legacy'])),
    eventHealth,fenceHealth,transactionHealth,
    inFlight:inflight,needsReview,unknownSendResults:uncertain,
    socialShadow:{diagnostic:shadowDiagnostic,byChannel:shadowComparison,paired:shadowPaired,
      windowMinutes:10,productionHandoffProof:false}}
  const checks=[
    check('legacy-video-clock',status.legacyVideoRetired?'passed':'attention',
      '旧定时视频时钟已退役；旧视频资料和设置只读保留'),
    check('life-settings',!status.accountReady?'attention':active?'passed':'attention',
      !status.accountReady?'当前账号尚未核验':active?'统一生活设置已启用':'自主生活尚未启用／已暂停'),
    check('life-events',eventHealth,'账号隔离的生活事件账本'),
    check('legacy-social-owner',status.oldSocialOwner?'pending':'passed',
      status.oldSocialOwner?'私信／评论仍由旧处理器决定；不能宣称已接管':'社交决策归属已更新'),
    check('handoff-ledger',fenceHealth==='passed'&&inflight===0&&needsReview===0?'passed':fenceHealth==='passed'?'attention':'unknown',
      '交接预约／在途旧操作（异常残留不得自动清除）'),
    check('send-ledger',transactionHealth==='passed'&&uncertain===0?'passed':transactionHealth==='passed'?'attention':'unknown',
      '逐消息发送结果；不确定回执必须人工核实、不得自动重发'),
    check('social-shadow-sampling','pending',
      shadowDiagnostic==='not-observed'?'社交影子对照未授权或不可用：不能推断鱼鱼选择沉默':
      shadowDiagnostic==='insufficient-samples'?`仅十分钟内临时对照：私信配对 ${shadowComparison.dm.paired}、评论配对 ${shadowComparison.comment.paired}，缺少充分样本`:
      shadowDiagnostic==='high-disagreement'?`影子类别分歧较多（${shadowDisagreements}/${shadowPaired}）；需要排查，不可移交决策权`:
      `两渠道短时样本已出现（${shadowPaired} 次、分歧 ${shadowDisagreements} 次），仍需跨日、跨进程和真实渠道验收；不能由此自动接管`),
    check('causal-growth','pending','已有短期可信只读经历提示，但完整记忆／关系／人格跨日因果验收尚未完成'),
    check('legacy-social-retirement','pending','回访／自主分享／主人私信／Python 写入仍需逐入口迁移审计'),
    check('cold-backup-restore','pending','老用户冷备份、恢复、账号切换需实机核验'),
    check('natural-life-observation','pending','自然交流与自主探索尚缺跨日真实行为、沉默及打扰率证据'),
    check('windows-real-model-bilibili','pending','Windows run-tests、真实模型及受控 B站验收必须由维护者完成')
  ]
  // RC evidence levels are intentionally NOT a release vote. These thirteen
  // user-facing questions combine known code boundaries with unavailable
  // long-running proof. They contain no UID, private message or tool payload.
  // Do not mark a question passed just because a module can load or a model
  // prompt contains a word like "interest" or "personality".
  const rcQuestions=[
    {id:'connected-systems',title:'心情、兴趣、人格、记忆与待办是否需要一起更新？',status:'partial',
      detail:'原系统仍是唯一权威数据源，已有跨系统只读接线；需要核对情绪衰减、兴趣来源、反思投影和后续行为，不能仅凭服务连通就宣称自然成长。'},
    {id:'owner-natural-care',title:'能在合适的时间主动关心主人吗？',status:'partial',
      detail:'有真实待办回访和主 Session 经历同步；情绪驱动的主动问候目前暂停，尚无自主择时实测。'},
    {id:'natural-friend-dm',title:'能在合适的时间自然地与私信用户交流吗？',status:'partial',
      detail:'旧私信处理器支持入站回复、延迟补充和有条件的好友兴趣视频分享；统一 Life 尚不能正式决定并发送私信。'},
    {id:'recent-social-voice',title:'最近的交流会影响表达吗？',status:'partial',
      detail:'可信交流可影响模拟心情和分场景说话语境，回复时会读取有限记忆／关系；尚缺相同条件下的跨轮实际表达对照。'},
    {id:'interest-activities',title:'兴趣会影响日常探索吗？',status:'partial',
      detail:'当前筛选兴趣与可回忆的公开探索证据可进入生活选择；选中视频不等于看过画面或听过声音。'},
    {id:'interest-friendship',title:'兴趣能帮助自然结识朋友吗？',status:'partial',
      detail:'已核验的共同兴趣可影响只读探索和被授权好友的定向分享；不能因兴趣相同自动向陌生人发私信或建立好友关系。'},
    {id:'proposal-to-completion',title:'能自然接受提议并真正完成吗？',status:'partial',
      detail:'支持有来源的建议入账、延期／拒绝和受限只读执行；完成必须依赖工具事实与结果回执，端到端成功率未实测。'},
    {id:'reply-cadence',title:'能掌握自然的私信与评论节奏吗？',status:'partial',
      detail:'已有多消息分段、延时、冷却、每日上限及跨渠道约束；尚未用真实对话检验打扰率和对话节奏，不能称为人类水平。'},
    {id:'social-growth',title:'社交与探索是否真正改变人格及兴趣？',status:'unproven',
      detail:'核验经历能进入原记忆、兴趣和反思候选；尚无跨日证据链证明真实互动造成稳定人格改变。'},
    {id:'growth-feedback',title:'成长会反过来改变聊天和探索风格吗？',status:'unproven',
      detail:'人格线索进入 Life Voice 及既有私信／评论生成，兴趣进入普通探索；缺少同一来源回执到后续真实选择的因果验收。'},
    {id:'normal-ui',title:'普通设置是否清楚易懂？',status:'needs-review',
      detail:'已统一日常生活入口并隔离专家选项；仍需真实使用者完成首次启用、权限理解和回滚指引的可用性走查。'},
    {id:'whole-life-naturalness',title:'探索、沉默、拒绝、停止与回访是否整体自然？',status:'unproven',
      detail:'能选择休息、延期和拒绝，但跨渠道长期打扰率、重复行为、意外外发及资源消耗尚无真实观测，不能宣称全部自然。'},
    {id:'legacy-upgrade-memory',title:'旧用户升级时记忆、人格、待办和授权会保持安全吗？',status:'needs-review',
      detail:'支持历史设置识别、双层记忆备份和已遗忘记忆保护；还必须用真实旧版数据冷备份、升级、恢复和回滚验证，绝不自动恢复被遗忘的内容。'}
  ]
  const rc={releaseCandidate:false,questions:rcQuestions,
    complete:0,partial:rcQuestions.filter(x=>x.status==='partial').length,
    unproven:rcQuestions.filter(x=>x.status==='unproven').length,
    needsReview:rcQuestions.filter(x=>x.status==='needs-review').length,
    note:'静态代码审计和本地运行状态不能代替 Windows／真实 B站／跨日行为验收。'}
  const remaining=checks.filter(x=>x.status!=='passed').map(x=>x.id)
  return {
    ok:true,readOnly:true,schemaVersion:1,releaseReady:false,
    version:String(version||'unknown'),mode:lifeMode,pace:settings.pace,
    phase6:'integration-incomplete',phase7:'growth-validation-incomplete',phase8:'not-accepted',
    status,checks,remaining,rc,
    guidance:status.unknownSendResults>0||status.needsReview>0?
      '发现待核实的旧发送或在途记录：不要自动解锁或重试，应停机核对平台真实结果。':
      !status.accountReady?'先完成当前 B站账号核验；本检查不会恢复账号、开启任何授权。':
      !active?'可在本页按需启用自主生活；不会顺带开启独立社交发送权限。':
      status.oldSocialOwner?'旧视频定时器已退役；社交仍有旧处理器渠道。需完成唯一决策权切换、成长与真实环境验收。':
      '当前社交归属仅属于代码阶段性交接；真实平台、人格成长与长时间观察尚未完成 RC 验收。',
    note:'这只是当前代码与本账号匿名运行状态的只读检查，不运行模型、不发送、不修改配置，也不把离线测试当作真实 B站验收。'
  }
}
