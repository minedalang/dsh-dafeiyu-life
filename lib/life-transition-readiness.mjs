/**
 * Read-only Phase 6/7/8 transition audit. No credential, UID, prompt, event
 * content or platform object is passed through. This is NOT a release switch.
 * Keep the result conservative: absent proof is 'unknown', never 'passed'.
 */
import {lifeDriverOwnership,lifeSettingsV2} from './life-settings-control.mjs'

const CHANNELS=['dm','comment']
const count=v=>Number.isSafeInteger(v)&&v>=0?v:0
const check=(id,status,detail)=>({id,status,detail})
export function lifeTransitionReadiness({config={},planner=null,handoff=null,transactions=null,accountReady=false}={}){
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
  const status={accountReady:accountReady===true,lifeActive:active,
    legacyVideoRetired:ownership.legacyTimerRetired===true,
    oldSocialOwner:ownership.socialReplyOwner==='legacy',
    eventHealth,fenceHealth,transactionHealth,
    inFlight:inflight,needsReview,unknownSendResults:uncertain}
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
    check('causal-growth','pending','已有短期可信只读经历提示，但完整记忆／关系／人格跨日因果验收尚未完成'),
    check('legacy-social-retirement','pending','回访／自主分享／主人私信／Python 写入仍需逐入口迁移审计'),
    check('cold-backup-restore','pending','老用户冷备份、恢复、账号切换需实机核验'),
    check('windows-real-model-bilibili','pending','Windows run-tests、真实模型及受控 B站验收必须由维护者完成')
  ]
  const remaining=checks.filter(x=>x.status!=='passed').map(x=>x.id)
  return {
    ok:true,readOnly:true,schemaVersion:1,releaseReady:false,
    version:'2.7.1-dev.4',mode:lifeMode,pace:settings.pace,
    phase6:'integration-incomplete',phase7:'growth-validation-incomplete',phase8:'not-accepted',
    status,checks,remaining,
    guidance:status.unknownSendResults>0||status.needsReview>0?
      '发现待核实的旧发送或在途记录：不要自动解锁或重试，应停机核对平台真实结果。':
      !status.accountReady?'先完成当前 B站账号核验；本检查不会恢复账号、开启任何授权。':
      !active?'可在本页按需启用自主生活；不会顺带开启独立社交发送权限。':
      '旧视频定时器已退役；社交仍由旧处理器负责。需完成唯一决策权切换、成长与真实环境验收。',
    note:'这只是当前代码与本账号匿名运行状态的只读检查，不运行模型、不发送、不修改配置，也不把离线测试当作真实 B站验收。'
  }
}
