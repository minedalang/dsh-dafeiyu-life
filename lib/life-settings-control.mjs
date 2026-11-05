/** Phase 6: opt-in, versioned facade over the existing *single* DSH config.
 * This is deliberately NOT a second state store or a new authority to send.
 */
import {createHash} from 'node:crypto'

const PACE=Object.freeze({
  quiet:Object.freeze({minutes:180,dailyLimit:4}),
  natural:Object.freeze({minutes:60,dailyLimit:12}),
  lively:Object.freeze({minutes:30,dailyLimit:20})
})
const MODES=new Set(['legacy','shadow','active'])
const FIELDS=['masterEnabled','lifeAgentMode','peakValley','autonomousPlannerEnabled','autonomousPlannerMinutes',
  'autonomousPlannerDailyLimit','autonomousPlannerStartHour','autonomousPlannerEndHour']
const toInt=(v,fall)=>Number.isSafeInteger(Number(v))?Number(v):fall
const snapshot=c=>Object.fromEntries(FIELDS.map(k=>[k,c?.[k]??null]))
const revision=c=>createHash('sha256').update(JSON.stringify(snapshot(c))).digest('hex').slice(0,16)
const modeFrom=c=>c?.lifeAgentMode==='active'?'active':c?.lifeAgentMode==='shadow'?'shadow':'legacy'
// Runtime and management projection must agree, including old installations
// whose saved `peakValley=true` predates the unified settings panel.
// This is an execution gate, not a configuration migration.
export const legacyVideoTimerAllowed=c=>c?.masterEnabled===true&&c?.peakValley===true&&
  c?.lifeAgentMode!=='shadow'&&c?.lifeAgentMode!=='active'
// A legacy config editor must not recreate a competing timer. Existing
// conflicting saved values are tolerated but suppressed at execution.
export function assertLegacyVideoPatchCompatible(current={},patch={}){
  const mode=Object.hasOwn(patch,'lifeAgentMode')?patch.lifeAgentMode:current.lifeAgentMode
  if(patch.peakValley===true&&['shadow','active'].includes(mode))
    throw Error('影子／自主生活模式不能重新开启旧视频定时器；请在统一生活设置中选择传统模式后再配置旧时段')
  return true
}
// Phase 6c: the generic legacy settings endpoint may keep unrelated
// settings current, but it must not steal the new life-control ownership.
// Checking DIFFERENCES preserves old whole-form saves with unchanged values.
export function assertLegacyLifeSettingsPatchCompatible(current={},patch={}){
  if(Object.hasOwn(patch,'lifeAgentMode')&&patch.lifeAgentMode!==current.lifeAgentMode)
    throw Error('生活模式已由统一生活设置管理，请使用预览／确认入口')
  const mode=current.lifeAgentMode
  if(['shadow','active'].includes(mode))for(const field of
    ['autonomousPlannerEnabled','autonomousPlannerMinutes','autonomousPlannerDailyLimit']){
    if(Object.hasOwn(patch,field)&&patch[field]!==current[field])
      throw Error('Life Agent 的调度额度已由统一生活设置管理：'+field)
  }
  return true
}
const paceFrom=c=>{
  const minutes=toInt(c?.autonomousPlannerMinutes,30),dailyLimit=toInt(c?.autonomousPlannerDailyLimit,24)
  return Object.entries(PACE).find(([,v])=>v.minutes===minutes&&v.dailyLimit===dailyLimit)?.[0]||'custom'
}
export function lifeSettingsV2(config={}){
  const c=config&&typeof config==='object'?config:{}
  const mode=modeFrom(c)
  return {schemaVersion:2,revision:revision(c),readOnly:false,mode,pace:paceFrom(c),
    masterEnabled:c.masterEnabled===true,plannerEnabled:c.autonomousPlannerEnabled===true,
    legacyVideoTimerEnabled:legacyVideoTimerAllowed(c),legacyVideoTimerSuppressed:c.peakValley===true&&!legacyVideoTimerAllowed(c)&&mode!=='legacy',
    socialReplyOwner:'legacy',socialContextConsentUnchanged:true,legacyManagedFields:mode==='legacy'?[]:['lifeAgentMode','autonomousPlannerEnabled','autonomousPlannerMinutes','autonomousPlannerDailyLimit'],
    budget:{minutes:toInt(c.autonomousPlannerMinutes,30),dailyLimit:toInt(c.autonomousPlannerDailyLimit,24),
      startHour:toInt(c.autonomousPlannerStartHour,9),endHour:toInt(c.autonomousPlannerEndHour,23)},
    note:'仅同步原配置；模型和社交外发权限独立，旧用户在明确保存前不会迁移。'}
}
export function planLifeSettingsV2(config={},input={}){
  if(!input||input.schemaVersion!==2||!MODES.has(input.mode)||
    (input.mode!=='legacy'&&!Object.hasOwn(PACE,input.pace)))throw Error('生活设置版本、模式或活跃度不支持')
  if(typeof input.revision!=='string'||input.revision!==revision(config))throw Error('旧设置已变化，请刷新后重新查看差异')
  const preview=input.previewOnly===true
  if(!preview&&input.confirm!=='APPLY_LIFE_SETTINGS_V2')throw Error('修改生活驱动需要明确确认')
  if(input.mode!=='legacy'&&config.masterEnabled!==true)throw Error('总开关未开启；不能启用 Life Agent')
  const patch={}
  if(input.mode==='legacy'){
    patch.lifeAgentMode='off'
    // Never re-enable an old timer or a planner implicitly on rollback.
  }else{
    patch.lifeAgentMode=input.mode
    patch.peakValley=false // no second autonomous video scheduler
    patch.autonomousPlannerEnabled=true
    patch.autonomousPlannerMinutes=PACE[input.pace].minutes
    patch.autonomousPlannerDailyLimit=PACE[input.pace].dailyLimit
  }
  const changed=Object.fromEntries(Object.entries(patch).filter(([k,v])=>config[k]!==v)
    .map(([k,v])=>[k,{before:config[k]??null,after:v}]))
  return {schemaVersion:2,preview,patch:Object.fromEntries(Object.entries(changed).map(([k,v])=>[k,v.after])),changed,
    after:lifeSettingsV2({...config,...patch}),note:'未更改总开关、时段、账号、社交外发权限、个人记忆或已接受待办。'}
}
export const __test={PACE,FIELDS}
