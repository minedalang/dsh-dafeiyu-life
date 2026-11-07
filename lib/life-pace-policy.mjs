/**
 * Life pace affects voluntary *consideration*, not the video tool's daily
 * allowance or any chat reply quota. The video Agent used to explore roughly
 * every 20 minutes; dev.10 must not replace that with 1/2/4 rounds per day.
 * A single concurrent video child, source validation and platform permissions
 * are still enforced by the original adapter and send transactions.
 */
const MIN_VIDEO_SPACING_MINUTES=20
const PROFILES=Object.freeze({
  quiet:Object.freeze({pace:'quiet',videoStartsPerDay:null,videoCooldownMinutes:MIN_VIDEO_SPACING_MINUTES,spontaneousWindowMinutes:120,description:'较少主动发起新的探索，但不会额外限制视频工具次数'}),
  natural:Object.freeze({pace:'natural',videoStartsPerDay:null,videoCooldownMinutes:MIN_VIDEO_SPACING_MINUTES,spontaneousWindowMinutes:30,description:'顺着兴趣自然考虑新探索，不额外限制视频工具次数'}),
  lively:Object.freeze({pace:'lively',videoStartsPerDay:null,videoCooldownMinutes:MIN_VIDEO_SPACING_MINUTES,spontaneousWindowMinutes:10,description:'更频繁地考虑探索机会，仍由鱼鱼决定是否行动或休息'}),
})
export function lifePacePolicy(config={}){
  const minutes=Number(config?.autonomousPlannerMinutes)
  const limit=Number(config?.autonomousPlannerDailyLimit)
  if(minutes===120&&limit===12)return PROFILES.quiet
  if(minutes===30&&limit===40)return PROFILES.natural
  if(minutes===10&&limit===100)return PROFILES.lively
  // Never invent a second video quota for saved custom/legacy settings.
  // Their saved planner interval is used for candidate generation only.
  const customWindow=Number.isSafeInteger(minutes)&&minutes>=5&&minutes<=1440?minutes:30
  return {pace:'legacy-or-custom',videoStartsPerDay:null,
    videoCooldownMinutes:MIN_VIDEO_SPACING_MINUTES,spontaneousWindowMinutes:customWindow,
    description:'保留已保存的生活考虑间隔；视频工具不设额外每日轮数限制'}
}
export function lifeVideoGate(config={},budget={},at=Date.now()){
  const policy=lifePacePolicy(config)
  const started=Number.isFinite(Number(budget?.videoStartsToday))?Math.max(0,Number(budget.videoStartsToday)):0
  const last=Number.isFinite(Number(budget?.lastVideoAt))?Math.max(0,Number(budget.lastVideoAt)):0
  const cooldownUntil=last>0?last+policy.videoCooldownMinutes*60_000:0
  const cooling=last>0&&at<cooldownUntil
  return {...policy,videoStartsToday:started,limitReached:false,cooling,cooldownUntil,
    eligible:!cooling,reason:cooling?'video-launch-cooldown':''}
}
