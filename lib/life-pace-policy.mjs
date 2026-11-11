/**
 * Life pace affects voluntary *consideration*, not the video tool's daily
 * allowance or any chat reply quota. The video Agent used to explore roughly
 * every 20 minutes; dev.10 must not replace that with 1/2/4 rounds per day.
 * A single concurrent video child, source validation and platform permissions
 * are still enforced by the original adapter and send transactions.
 */
export const MIN_VIDEO_AGENT_INTERVAL_MINUTES=1
export const MAX_VIDEO_AGENT_INTERVAL_MINUTES=1440
const configuredVideoInterval=config=>{
  const n=Number(config?.videoAgentMinIntervalMinutes)
  return Number.isSafeInteger(n)&&n>=MIN_VIDEO_AGENT_INTERVAL_MINUTES&&n<=MAX_VIDEO_AGENT_INTERVAL_MINUTES
    ?n:20
}
const PROFILES=Object.freeze({
  quiet:Object.freeze({pace:'quiet',videoStartsPerDay:null,videoCooldownMinutes:20,spontaneousWindowMinutes:80,description:'较少主动发起新的探索，但不会额外限制视频工具次数'}),
  natural:Object.freeze({pace:'natural',videoStartsPerDay:null,videoCooldownMinutes:20,spontaneousWindowMinutes:30,description:'顺着兴趣自然考虑新探索，不额外限制视频工具次数'}),
  lively:Object.freeze({pace:'lively',videoStartsPerDay:null,videoCooldownMinutes:20,spontaneousWindowMinutes:10,description:'更频繁地考虑探索机会，仍由鱼鱼决定是否行动或休息'}),
})
export function lifePacePolicy(config={}){
  const minutes=Number(config?.autonomousPlannerMinutes)
  const limit=Number(config?.autonomousPlannerDailyLimit)
  const videoCooldownMinutes=configuredVideoInterval(config)
  if(minutes===80&&limit===50)return {...PROFILES.quiet,videoCooldownMinutes}
  if(minutes===30&&limit===100)return {...PROFILES.natural,videoCooldownMinutes}
  if(minutes===10&&limit===200)return {...PROFILES.lively,videoCooldownMinutes}
  // Never invent a second video quota for saved custom/legacy settings.
  // Their saved planner interval is used for candidate generation only.
  const customWindow=Number.isSafeInteger(minutes)&&minutes>=5&&minutes<=1440?minutes:30
  return {pace:'legacy-or-custom',videoStartsPerDay:null,
    videoCooldownMinutes,spontaneousWindowMinutes:customWindow,
    description:'保留已保存的生活考虑间隔；视频启动最短间隔单独配置'}
}
export function lifeVideoGate(config={},budget={},at=Date.now()){
  const policy=lifePacePolicy(config)
  const started=Number.isFinite(Number(budget?.videoStartsToday))?Math.max(0,Number(budget.videoStartsToday)):0
  // Include actual account-scoped subprocess launches (including manual rounds),
  // without charging them against the Life planner's separate start counter.
  // A started round is not evidence of watching, but is enough to avoid two
  // overlapping/near-immediate automatic video launches. Ignore malformed and
  // future timestamps rather than allowing ledger data to invent a cooldown.
  const recent=Array.isArray(budget?.recentVideoRounds)?budget.recentVideoRounds:[]
  const roundStart=recent.slice(0,12).reduce((last,row)=>{
    const stamp=Number(row?.startedAt)
    return ['started','completed','failed','interrupted'].includes(row?.state)&&
      Number.isSafeInteger(stamp)&&stamp>0&&stamp<=at?Math.max(last,stamp):last
  },0)
  const countedLast=Number.isFinite(Number(budget?.lastVideoAt))?Math.max(0,Number(budget.lastVideoAt)):0
  const last=Math.max(countedLast,roundStart)
  const cooldownUntil=last>0?last+policy.videoCooldownMinutes*60_000:0
  const cooling=last>0&&at<cooldownUntil
  return {...policy,videoStartsToday:started,limitReached:false,cooling,cooldownUntil,
    eligible:!cooling,reason:cooling?'video-launch-cooldown':''}
}
