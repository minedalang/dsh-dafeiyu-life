/**
 * Life resource coordination. This is an in-process, account-fenced resource
 * admission layer, NOT an outbound authorization mechanism or a durable job
 * queue. DM and social transaction journals retain all retry/write ownership.
 * No messages, model prompts, identifiers or provider credentials are stored.
 */
const LANES=Object.freeze(['social','continuation','exploration','background'])
const DEFAULT_LIMITS=Object.freeze({model:1,biliRead:1,video:1,vision:1})
const WEIGHTS=Object.freeze({social:4,continuation:3,exploration:2,background:1})
const clamp=(n,lo,hi,fallback)=>Number.isFinite(n)?Math.max(lo,Math.min(hi,Math.trunc(n))):fallback
const validScope=s=>typeof s==='string'&&/^[a-f0-9]{16}$/.test(s)

// A rejected admission guarantees the work callback was never invoked.
// Consumers may safely roll back an unstarted model-call reservation, but
// must never do so for errors thrown by the actual model/provider.
export class LifeResourceAdmissionError extends Error {
  constructor(code){super(code);this.name='LifeResourceAdmissionError';this.code=code;this.workNotStarted=true}
}
export const isLifeResourceAdmissionError=error=>error instanceof LifeResourceAdmissionError&&error.workNotStarted===true


export function createLifeResourceScheduler({getAccountTag=()=>'',now=Date.now,limits={},maxPending=64,maxSocialBurst=2}={}){
  const capacities=Object.fromEntries(Object.entries(DEFAULT_LIMITS).map(([key,value])=>[key,clamp(limits[key],1,4,value)]))
  const used=Object.fromEntries(Object.keys(capacities).map(key=>[key,0]))
  const pending=[]
  const history={completed:0,failed:0,deferred:0,accountRejected:0}
  let serial=0,socialBurst=0,closed=false,draining=false
  const normalize=resources=>{
    if(!resources||typeof resources!=='object'||Array.isArray(resources))throw TypeError('Invalid Life resource request')
    const requested={}
    for(const [key,count] of Object.entries(resources)){
      if(!Object.hasOwn(capacities,key)||!Number.isSafeInteger(count)||count<0||count>capacities[key])
        throw TypeError('Invalid Life resource requirement')
      if(count>0)requested[key]=count
    }
    return requested
  }
  const fits=resources=>Object.entries(resources).every(([key,count])=>used[key]+count<=capacities[key])
  const choose=()=>{
    const available=pending.filter(row=>fits(row.resources))
    if(!available.length)return null
    const others=available.filter(row=>row.lane!=='social')
    // Two urgent social admissions must eventually let a queued non-social
    // request proceed. Never pre-empt an already-running model/DSH process.
    const pool=socialBurst>=maxSocialBurst&&others.length?others:available
    const t=now()
    return pool.sort((a,b)=>{
      const score=row=>WEIGHTS[row.lane]+Math.min(12,Math.floor(Math.max(0,t-row.createdAt)/15_000))
      return score(b)-score(a)||a.createdAt-b.createdAt||a.seq-b.seq
    })[0]
  }
  const drain=()=>{
    if(draining)return
    draining=true
    try{
      while(!closed){
        const row=choose();if(!row)break
        pending.splice(pending.indexOf(row),1);clearTimeout(row.timer)
        if(!validScope(getAccountTag())||getAccountTag()!==row.scope){
          history.accountRejected++;row.reject(new LifeResourceAdmissionError('life-resource-account-changed'));continue
        }
        for(const [key,count] of Object.entries(row.resources))used[key]+=count
        socialBurst=row.lane==='social'?socialBurst+1:0
        let released=false
        const release=()=>{
          if(released)return
          released=true
          for(const [key,count] of Object.entries(row.resources))used[key]-=count
          drain()
        }
        row.resolve(release)
      }
    }finally{draining=false}
  }
  const acquire=({lane='exploration',resources={model:1},waitMs=25_000}={})=>{
    if(!LANES.includes(lane))throw TypeError('Invalid Life queue lane')
    const request=normalize(resources),scope=getAccountTag()
    if(!validScope(scope))return Promise.reject(new LifeResourceAdmissionError('life-resource-account-not-ready'))
    if(closed)return Promise.reject(new LifeResourceAdmissionError('life-resource-closed'))
    if(pending.length>=maxPending)return Promise.reject(new LifeResourceAdmissionError('life-resource-queue-full'))
    return new Promise((resolve,reject)=>{
      const row={seq:serial++,lane,scope,resources:request,createdAt:now(),resolve,reject,timer:null}
      pending.push(row)
      row.timer=setTimeout(()=>{
        const idx=pending.indexOf(row)
        if(idx<0)return
        pending.splice(idx,1);history.deferred++
        reject(new LifeResourceAdmissionError('life-resource-wait-timeout'))
        drain()
      },clamp(waitMs,100,120_000,25_000))
      drain()
    })
  }
  // Non-waiting reservation for a long-running video child: never queue a
  // second video process behind another child's unbounded lifecycle. A Life
  // choice may be safely deferred by its existing canonical event ledger.
  const tryAcquire=({lane='exploration',resources={video:1}}={})=>{
    if(!LANES.includes(lane))throw TypeError('Invalid Life queue lane')
    const request=normalize(resources),scope=getAccountTag()
    if(closed||!validScope(scope)||!fits(request)||pending.some(row=>row.lane==='social'&&lane!=='social'))return null
    for(const [key,count] of Object.entries(request))used[key]+=count
    let released=false
    return ()=>{
      if(released)return
      released=true
      for(const [key,count] of Object.entries(request))used[key]-=count
      drain()
    }
  }
  const run=async({lane='exploration',resources={model:1},waitMs=25_000}={},task)=>{
    if(typeof task!=='function')throw TypeError('Life resource work missing')
    const release=await acquire({lane,resources,waitMs})
    try{const result=await task();history.completed++;return result}
    catch(error){history.failed++;throw error}
    finally{release()}
  }
  const status=()=>({ok:!closed,capacity:{...capacities},active:{...used},
    pending:Object.fromEntries(LANES.map(lane=>[lane,pending.filter(row=>row.lane===lane).length])),
    oldestWaitMs:pending.length?Math.max(0,now()-Math.min(...pending.map(row=>row.createdAt))):0,
    completed:history.completed,failed:history.failed,deferred:history.deferred,
    accountRejected:history.accountRejected,scopeReady:validScope(getAccountTag())})
  const close=()=>{
    closed=true
    for(const row of pending.splice(0)){clearTimeout(row.timer);row.reject(new LifeResourceAdmissionError('life-resource-closed'))}
  }
  return {acquire,tryAcquire,run,status,close}
}
