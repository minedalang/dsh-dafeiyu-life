/** Read-only projection of the ONE production config. No automatic migration. */
import {lifeDriverOwnership} from './life-settings-control.mjs'
const allowed=new Set(['off','shadow','active'])
const asInt=(v,fallback,min,max)=>Number.isSafeInteger(Number(v))?Math.min(max,Math.max(min,Number(v))):fallback
export function projectLifeSettings(config={}){
  const c=config&&typeof config==='object'?config:{}
  const mode=allowed.has(c.lifeAgentMode)?c.lifeAgentMode:'off'
  const master=c.masterEnabled===true,planner=c.autonomousPlannerEnabled===true
  const ownership=lifeDriverOwnership(c)
  return Object.freeze({schemaVersion:1,readOnly:true,migrationApplied:false,
    driverOwnership:ownership,life:{mode,enabled:master&&planner&&mode!=='off',
      videoOwner:master&&planner&&mode!=='off'?'life-agent':'none',
      legacyVideoScheduleActive:false,legacyTimerSuppressed:c.peakValley===true,
      legacyTimerRetired:true,legacyPlannerActive:master&&planner},
    privacy:{socialExcerptPreviewEnabled:master&&mode!=='off'&&c.lifeAgentSocialContextOptIn===true,
      socialReplyOwner:'life-agent',outboundPermissionsUnchanged:true},
    budget:{decisionsPerDay:asInt(c.autonomousPlannerDailyLimit,24,0,288),
      decisionIntervalMinutes:asInt(c.autonomousPlannerMinutes,30,5,1440)},
    warning:'旧谷时视频定时器已退役；旧存档仍保留。关闭生活 Agent 不关闭现有独立社交授权。'} )
}
