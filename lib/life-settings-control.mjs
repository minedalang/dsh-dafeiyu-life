/** Unified Life Agent settings, backed by the original DSH config.
 * Video scheduling is now exclusively owned by AutonomousPlanner; old video
 * schedule fields are preserved for backups but are NEVER executable timers.
 * No preset changes model identity, account scope or outbound permissions.
 */
import {createHash} from 'node:crypto'

const PACE=Object.freeze({
  quiet:Object.freeze({minutes:120,dailyLimit:12}),
  natural:Object.freeze({minutes:30,dailyLimit:40}),
  lively:Object.freeze({minutes:10,dailyLimit:100})
})
// Previously saved presets are preserved until the owner explicitly selects a new preset.
const LEGACY_PACE=Object.freeze({
  'legacy-quiet':Object.freeze({minutes:180,dailyLimit:4}),
  'legacy-natural':Object.freeze({minutes:60,dailyLimit:12}),
  'legacy-lively':Object.freeze({minutes:30,dailyLimit:20})
})
const MODES=new Set(['off','shadow','active','legacy']) // legacy is a paused-only request alias
const FIELDS=['masterEnabled','lifeAgentMode','peakValley','autonomousPlannerEnabled','autonomousPlannerMinutes',
  'autonomousPlannerDailyLimit','autonomousPlannerStartHour','autonomousPlannerEndHour','videoAgentMinIntervalMinutes',
  'videoAgentReadTargetPerRound','videoAgentPickTargetPerRound']
const toInt=(v,fall)=>Number.isSafeInteger(Number(v))?Number(v):fall
const videoIntervalFrom=c=>{const n=toInt(c?.videoAgentMinIntervalMinutes,20);return n>=1&&n<=1440?n:20}
const snapshot=c=>Object.fromEntries(FIELDS.map(k=>[k,c?.[k]??null]))
const revision=c=>createHash('sha256').update(JSON.stringify(snapshot(c))).digest('hex').slice(0,16)
const modeFrom=c=>c?.lifeAgentMode==='active'?'active':c?.lifeAgentMode==='shadow'?'shadow':'off'

// Kept as an explicit migration guard for older plugins/settings/read-only UI.
// A stale peakValley=true can no longer schedule ANY automatic video round.
export const legacyVideoTimerAllowed=()=>false
export function lifeDriverOwnership(config={}){
  const mode=modeFrom(config)
  const agent=config?.masterEnabled===true&&config?.autonomousPlannerEnabled===true&&mode!=='off'
  return Object.freeze({mode,videoWakeOwner:agent?'life-agent':'none',
    lifeAgentDecisionEnabled:agent,legacyTimerMayRun:false,
    legacyTimerSuppressed:config?.peakValley===true,legacyTimerRetired:true,
    socialReplyOwner:'life-agent',outboundPermissionsUnchanged:true})
}
// Legacy whole-form saves may echo an unchanged, retired value; they cannot
// turn it on anew, even if Life Agent is paused. The runtime always ignores it.
export function assertLegacyVideoPatchCompatible(current={},patch={}){
  if(patch.peakValley===true&&current.peakValley!==true)
    throw Error('旧视频定时驱动已退役，无法重新开启；请使用统一生活设置')
  return true
}
export function assertLegacyLifeSettingsPatchCompatible(current={},patch={}){
  if(Object.hasOwn(patch,'videoAgentMinIntervalMinutes')&&patch.videoAgentMinIntervalMinutes!==current.videoAgentMinIntervalMinutes)
    throw Error('视频 Agent 启动间隔已由统一生活设置管理，请使用 Life 自主生活设置页预览并保存')
  for(const field of ['videoAgentReadTargetPerRound','videoAgentPickTargetPerRound'])
    if(Object.hasOwn(patch,field)&&patch[field]!==current[field])
      throw Error('视频 Agent 每轮参考数量已由统一生活设置管理：'+field)
  if(Object.hasOwn(patch,'lifeAgentMode')&&patch.lifeAgentMode!==current.lifeAgentMode)
    throw Error('生活模式已由统一生活设置管理，请使用预览／确认入口')
  if(['shadow','active'].includes(current.lifeAgentMode))for(const field of
    ['autonomousPlannerEnabled','autonomousPlannerMinutes','autonomousPlannerDailyLimit',
      'autonomousPlannerStartHour','autonomousPlannerEndHour']){
    if(Object.hasOwn(patch,field)&&patch[field]!==current[field])
      throw Error('Life Agent 的调度参数已由统一生活设置管理：'+field)
  }
  return true
}
const paceFrom=c=>{
  const minutes=toInt(c?.autonomousPlannerMinutes,30),dailyLimit=toInt(c?.autonomousPlannerDailyLimit,24)
  return Object.entries(PACE).find(([,v])=>v.minutes===minutes&&v.dailyLimit===dailyLimit)?.[0]||
    Object.entries(LEGACY_PACE).find(([,v])=>v.minutes===minutes&&v.dailyLimit===dailyLimit)?.[0]||'custom'
}
export function lifeSettingsV2(config={}){
  const c=config&&typeof config==='object'?config:{},mode=modeFrom(c),ownership=lifeDriverOwnership(c)
  return {schemaVersion:2,revision:revision(c),readOnly:false,mode,pace:paceFrom(c),
    masterEnabled:c.masterEnabled===true,plannerEnabled:c.autonomousPlannerEnabled===true,
    legacyVideoTimerEnabled:false,legacyVideoTimerSuppressed:c.peakValley===true,
    legacyVideoTimerRetired:true,driverOwnership:ownership,socialReplyOwner:'life-agent',
    // This is the target architecture; runtime ownership must be read from SocialHandoffFence.
    socialContextConsentUnchanged:true,legacyManagedFields:['lifeAgentMode','autonomousPlannerEnabled',
      'autonomousPlannerMinutes','autonomousPlannerDailyLimit','autonomousPlannerStartHour','autonomousPlannerEndHour'],
    budget:{minutes:toInt(c.autonomousPlannerMinutes,30),dailyLimit:toInt(c.autonomousPlannerDailyLimit,24),
      startHour:toInt(c.autonomousPlannerStartHour,9),endHour:toInt(c.autonomousPlannerEndHour,23),
      videoAgentMinIntervalMinutes:videoIntervalFrom(c),
      videoAgentReadTargetPerRound:toInt(c.videoAgentReadTargetPerRound,8),
      videoAgentPickTargetPerRound:toInt(c.videoAgentPickTargetPerRound,4)},
    note:'旧视频定时驱动已退役；旧数据保留但不再自动启动。只有明确保存后才改变 Life Agent 状态和节奏；不会授予平台外发权限。'}
}
const safeInt=(n,min,max,label)=>{
  if(typeof n!=='number'||!Number.isSafeInteger(n)||n<min||n>max)
    throw Error('高级设置「'+label+'」必须为 '+min+'～'+max+' 的整数')
  return n
}
export function planLifeSettingsV2(config={},input={}){
  if(!input||input.schemaVersion!==2||!MODES.has(input.mode)||
    !['quiet','natural','lively','custom',...Object.keys(LEGACY_PACE)].includes(input.pace))throw Error('生活设置版本、模式或活跃度不支持')
  if(typeof input.revision!=='string'||input.revision!==revision(config))throw Error('旧设置已变化，请刷新后重新查看差异')
  const preview=input.previewOnly===true
  if(!preview&&input.confirm!=='APPLY_LIFE_SETTINGS_V2')throw Error('修改生活驱动需要明确确认')
  const mode=input.mode==='legacy'?'off':input.mode
  if(mode!=='off'&&config.masterEnabled!==true)throw Error('总开关未开启；不能启用 Life Agent')
  const patch={lifeAgentMode:mode,peakValley:false,autonomousPlannerEnabled:mode!=='off'}
  if(input.videoAgentMinIntervalMinutes!==undefined)
    patch.videoAgentMinIntervalMinutes=safeInt(input.videoAgentMinIntervalMinutes,1,1440,'视频 Agent 最短启动间隔')
  if(input.videoAgentReadTargetPerRound!==undefined)
    patch.videoAgentReadTargetPerRound=safeInt(input.videoAgentReadTargetPerRound,1,30,'每轮期望深入阅读视频数')
  if(input.videoAgentPickTargetPerRound!==undefined)
    patch.videoAgentPickTargetPerRound=safeInt(input.videoAgentPickTargetPerRound,0,12,'每轮期望挑选视频数')
  if(mode!=='off'){
    if(input.pace==='custom'){
      if(!input.advanced||typeof input.advanced!=='object'||Array.isArray(input.advanced))throw Error('自定义活跃度需要完整高级设置')
      patch.autonomousPlannerMinutes=safeInt(input.advanced.minutes,5,1440,'考虑间隔')
      patch.autonomousPlannerDailyLimit=safeInt(input.advanced.dailyLimit,1,288,'每日模型额度')
      patch.autonomousPlannerStartHour=safeInt(input.advanced.startHour,0,23,'开始时间')
      patch.autonomousPlannerEndHour=safeInt(input.advanced.endHour,1,24,'结束时间')
    }else{
      const chosen=PACE[input.pace]||LEGACY_PACE[input.pace]
      // The old preset is an explicit keep-existing choice, never a way to
      // silently migrate to the new (more expensive) model quota.
      if(LEGACY_PACE[input.pace]&&paceFrom(config)!==input.pace)
        throw Error('旧版活跃度只允许保留当前已保存的旧设置；请选择新版档位或自定义')
      patch.autonomousPlannerMinutes=chosen.minutes
      patch.autonomousPlannerDailyLimit=chosen.dailyLimit
    }
  }
  const changed=Object.fromEntries(Object.entries(patch).filter(([k,v])=>config[k]!==v)
    .map(([k,v])=>[k,{before:config[k]??null,after:v}]))
  return {schemaVersion:2,preview,patch:Object.fromEntries(Object.entries(changed).map(([k,v])=>[k,v.after])),changed,
    after:lifeSettingsV2({...config,...patch}),
    note:'统一生活调度；保留旧历史设置和原视频工具。停止只会暂停新自主调度；不会授予、撤销任何既有社交发送权限，也不会清空数据。'}
}
export const __test={PACE,LEGACY_PACE,FIELDS}
