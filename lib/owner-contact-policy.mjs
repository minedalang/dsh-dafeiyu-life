/** Shared owner contact window + quota policy. This is permission to consider
 * talking, not a command to express a particular personality or to send. */
export const OWNER_CONTACT_PRESETS=Object.freeze({
  quiet: Object.freeze({startHour:10,endHour:20,cooldownMinutes:480,dailyLimit:1,silenceMinutes:120}),
  natural: Object.freeze({startHour:9,endHour:22,cooldownMinutes:240,dailyLimit:2,silenceMinutes:45}),
  lively: Object.freeze({startHour:8,endHour:23,cooldownMinutes:120,dailyLimit:4,silenceMinutes:20}),
})
export const OWNER_CONTACT_CHOICES=Object.freeze([...Object.keys(OWNER_CONTACT_PRESETS),'custom'])
const int=(value,min,max,fallback)=>Number.isSafeInteger(Number(value))&&Number(value)>=min&&Number(value)<=max?Number(value):fallback
export function ownerContactPolicy(config={}){
  const preset=OWNER_CONTACT_CHOICES.includes(config.ownerContactPreset)?config.ownerContactPreset:'natural'
  const base=OWNER_CONTACT_PRESETS[preset]||OWNER_CONTACT_PRESETS.natural
  const values=preset!=='custom'?base:{
    startHour:int(config.ownerContactStartHour,0,23,9),
    endHour:int(config.ownerContactEndHour,0,24,22),
    cooldownMinutes:int(config.ownerContactCooldownMinutes,30,10080,240),
    dailyLimit:int(config.ownerContactDailyLimit,1,24,2),
    silenceMinutes:int(config.ownerContactSilenceMinutes,5,1440,45),
  }
  return {preset,...values}
}
const localDay=t=>{const d=new Date(t),two=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}`}
export function checkOwnerContact({config={},now=Date.now(),attempts=[],sourceKey='',permission=true}={}){
  const policy=ownerContactPolicy(config)
  if(!permission)return {eligible:false,reason:'not-authorized',policy}
  const h=new Date(now).getHours()
  const inside=policy.startHour===policy.endHour?false:policy.startHour<policy.endHour
    ?h>=policy.startHour&&h<policy.endHour:h>=policy.startHour||h<policy.endHour
  if(!inside)return {eligible:false,reason:'quiet-hours',policy}
  if(sourceKey&&attempts.some(row=>row.sourceKey===sourceKey))return {eligible:false,reason:'source-used',policy}
  if(attempts.some(row=>now>=row.at&&now-row.at<policy.cooldownMinutes*60_000))return {eligible:false,reason:'cooldown',policy}
  if(attempts.filter(row=>localDay(row.at)===localDay(now)).length>=policy.dailyLimit)return {eligible:false,reason:'daily-limit',policy}
  return {eligible:true,reason:'life-may-decide',policy}
}
