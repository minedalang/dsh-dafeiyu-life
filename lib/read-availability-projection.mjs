/**
 * Read-only management projection over the EXISTING account-scoped budget and
 * notification network backoff. Not a gate, a scheduler, a permission or a
 * proof that the next platform request will succeed.
 *
 * Never read raw error messages, account identifiers, targets or contents.
 * Deliberately keeps simultaneous blockers instead of guessing one cause.
 */
const MAX_TIME=8_640_000_000_000_000
const safeAt=v=>Number.isSafeInteger(v)&&v>0&&v<MAX_TIME?v:0
const future=(value,now)=>{const t=safeAt(value);return t>now?t:0}
const GLOBAL_CODES=new Set(['platform-cooldown','minute-budget','hour-budget'])
const NETWORK_CATEGORIES=new Set(['rate-limit','network'])
const LANE_SPECS={
  dmUnread:{enabled:'dm',network:['dm'],interval:'dmUnreadNextAt',intervalCode:'dm-unread-interval'},
  dmList:{enabled:'dm',network:['dm'],interval:'dmListNextAt',intervalCode:'dm-list-interval'},
  dmMessages:{enabled:'dm',network:['dm']},
  socialUnread:{enabled:'social',network:['replies','mentions'],interval:'socialUnreadNextAt',intervalCode:'social-unread-interval'},
  replies:{enabled:'replies',network:['replies'],endpoint:'mcp:bili_received_replies'},
  mentions:{enabled:'mentions',network:['mentions'],endpoint:'mcp:bili_received_at_and_likes'},
}
const blocker=(code,source,retryAt)=>({code,source,retryAt})
export function projectReadAvailability({budget={},networkBackoff={},running=true,enabled={},accountReady=true,now=Date.now()}={}){
  const time=safeAt(now)||Date.now()
  const available=typeof budget?.blocked==='boolean'&&Number.isFinite(budget?.minuteLimit)
  const global=[]
  if(available&&budget.blocked){
    const actual=Array.isArray(budget.activeBlocks)&&budget.activeBlocks.length?budget.activeBlocks:null
    if(actual){
      for(const item of actual.slice(0,3)){
        const code=item?.code==='account-auth'?'account-auth':GLOBAL_CODES.has(item?.code)?item.code:'read-budget-unknown'
        global.push(blocker(code,'shared-read-budget',future(item?.retryAt,time)))
      }
    }else{
      const code=budget.reason==='platform-cooldown'&&budget.lastReason==='B站登录态需要检查'
        ?'account-auth':GLOBAL_CODES.has(budget.reason)?budget.reason:'read-budget-unknown'
      global.push(blocker(code,'shared-read-budget',future(budget.retryAt,time)))
    }
  }
  const lanes={}
  for(const [name,spec] of Object.entries(LANE_SPECS)){
    const active=spec.enabled==='social'?enabled.replies===true||enabled.mentions===true:enabled[spec.enabled]===true
    if(!accountReady){lanes[name]={state:'unavailable',reason:'account-unavailable',retryAt:0,blockers:[]};continue}
    if(!running){lanes[name]={state:'unavailable',reason:'scheduler-stopped',retryAt:0,blockers:[]};continue}
    if(!active){lanes[name]={state:'unavailable',reason:'not-enabled',retryAt:0,blockers:[]};continue}
    if(!available){lanes[name]={state:'unknown',reason:'read-budget-unavailable',retryAt:0,blockers:[]};continue}
    const causes=[...global]
    const interval=spec.interval?future(budget[spec.interval],time):spec.endpoint?future(budget.socialEndpoints?.[spec.endpoint],time):0
    if(interval)causes.push(blocker(spec.intervalCode||'social-rate-protection','endpoint-read-budget',interval))
    for(const key of spec.network){
      const lane=networkBackoff?.[key]
      const next=future(lane?.nextAt,time)
      if(next){
        const category=NETWORK_CATEGORIES.has(lane?.category)?lane.category:'unknown'
        causes.push(blocker(category==='rate-limit'?'platform-recovery':category==='network'?'network-retry':'network-unknown',
          `network-${key}`,next))
      }
    }
    // A known fixed pause may coexist with a separate transport outage; only
    // report the latest KNOWN time, not a promise of success or permission.
    const retryAt=Math.max(0,...causes.map(x=>x.retryAt))
    const reason=causes.length?(causes.find(x=>x.retryAt===retryAt)||causes[0]).code:'ready'
    lanes[name]={state:causes.length?'deferred':'ready',reason,retryAt,blockers:causes}
  }
  const globalRetryAt=Math.max(0,...global.map(x=>x.retryAt))
  return {schema:'bili-read-availability/v1',at:time,global:available?{
    state:global.length?'deferred':'ready',reason:(global.find(x=>x.retryAt===globalRetryAt)||{}).code||'ready',
    retryAt:globalRetryAt,blockers:global
  }:{state:'unknown',reason:'read-budget-unavailable',retryAt:0,blockers:[]},lanes,
    note:'仅说明已接入的本地读预算、通知网络退避及启用状态；不代表B站官方配额、平台可用性或任何写入许可'}
}
