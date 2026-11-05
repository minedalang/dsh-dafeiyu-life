/** Phase 6 preparation: a READ-ONLY view of the existing config.
 * Never writes a migration, enables a permission or changes a scheduler.
 * "active" currently means video owner ONLY, not social reply ownership.
 */
const allowed=new Set(['off','shadow','active'])
const asInt=(v,fallback,min,max)=>Number.isSafeInteger(Number(v))?Math.min(max,Math.max(min,Number(v))):fallback
export function projectLifeSettings(config={}){
  const c=config&&typeof config==='object'?config:{}
  const mode=allowed.has(c.lifeAgentMode)?c.lifeAgentMode:'off'
  const master=c.masterEnabled===true
  const planner=c.autonomousPlannerEnabled===true
  const legacyVideo=c.peakValley===true&&mode!=='active'
  return Object.freeze({schemaVersion:1,readOnly:true,migrationApplied:false,
    life:{mode,enabled:master&&mode!=='off',videoOwner:master&&mode==='active'?'life-agent':'legacy-or-manual',
      legacyVideoScheduleActive:master&&legacyVideo,legacyPlannerActive:master&&planner},
    privacy:{socialExcerptPreviewEnabled:master&&mode!=='off'&&c.lifeAgentSocialContextOptIn===true,
      socialReplyOwner:'legacy',outboundPermissionsUnchanged:true},
    budget:{decisionsPerDay:asInt(c.autonomousPlannerDailyLimit,24,0,288),
      decisionIntervalMinutes:asInt(c.autonomousPlannerMinutes,30,5,1440)},
    warning:'只读映射；旧设置和驱动仍在运行。尚未迁移配置，也未新增任何平台权限。'})
}
