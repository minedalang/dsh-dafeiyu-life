/**
 * dev.4 Phase 6h: durable cross-process PRE-HANDOFF social decision lane fence.
 *
 * This is not a sender, a new inbox, a model selector or a grant of handoff.
 * There is intentionally no Life Agent owner mode. A crash leaves an opaque
 * lane reserved until an operator verifies that no platform write was made.
 * Existing DM/comment delivery receipts remain their sole source of truth.
 */
import {createHash,randomUUID} from 'node:crypto'
import {lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync,rmSync,rmdirSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs'
import {join} from 'node:path'

const ACCOUNT=/^[a-f0-9]{16}$/
const HEX=/^[a-f0-9]{64}$/
const CHANNELS=new Set(['dm','comment'])
const ROOT='social-handoff-fence',VERSION=1
const hash=s=>createHash('sha256').update(s).digest('hex')
function readStat(p){
  try{return lstatSync(p)}catch(e){if(e?.code==='ENOENT')return null;throw e}
}
function checkDir(p){
  const stat=readStat(p)
  if(!stat)return false
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('社交决策隔离目录不安全')
  return true
}
function checkFile(p){
  const stat=readStat(p)
  if(!stat)return false
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2048)throw Error('社交决策隔离记录不安全')
  return true
}
const alive=pid=>{
  if(!Number.isSafeInteger(pid)||pid<1)return false
  try{process.kill(pid,0);return true}catch(e){return e?.code!=='ESRCH'}
}
const validChannel=channel=>CHANNELS.has(channel)
const hashedScope=s=>hash('social-handoff-scope-v1\0'+s).slice(0,20)
const laneId=(s,channel)=>hash('social-handoff-lane-v1\0'+s+'\0'+channel)
const sanitizeRow=(row,id,at)=>({id:id.slice(0,16),channel:validChannel(row?.channel)?row.channel:'unknown',
  state:row?.state==='reserved'?'reserved':'unreadable',at:Number.isSafeInteger(row?.at)?row.at:0,
  inProcess:alive(row?.pid),needsReview:!row||!alive(row.pid)||at-Number(row.at||0)>10*60_000})

export function createSocialHandoffFence({dataDir,getAccountTag,now=Date.now}={}){
  if(typeof dataDir!=='string'||!dataDir||typeof getAccountTag!=='function')throw TypeError('社交交接排他门禁缺少根目录或账号绑定')
  const home=join(dataDir,ROOT),lanes=join(home,'lanes'),activeRoot=join(home,'inflight')
  // No on-disk keys, UIDs, chat text or event IDs are stored. Only opaque lanes.
  const sessions=new Map(),legacySessions=new Map()
  const scope=()=>String(getAccountTag()||'')
  const validateScope=(expectedScope)=>{
    const s=scope()
    if(!ACCOUNT.test(s))return {ok:false,reason:'account-scope-unavailable'}
    if(expectedScope!==undefined&&s!==expectedScope)return {ok:false,reason:'account-changed'}
    return {ok:true,s}
  }
  const paths=(s,channel)=>{
    const id=laneId(s,channel),dir=join(lanes,id)
    return {id,dir,file:join(dir,'claim.json')}
  }
  const ensure=()=>{
    checkDir(dataDir)
    if(!checkDir(home))mkdirSync(home,{mode:0o700})
    if(!checkDir(lanes))mkdirSync(lanes,{mode:0o700})
  }
  // Each old decision/send registers before checking the handoff fence. The
  // handoff reservation first closes the lane, then checks in-flight entries.
  // This two-sided handshake closes the check-before-await race without making
  // an LLM decision or a platform send into a new authorization source.
  const activePath=(s,channel)=>join(activeRoot,laneId(s,channel))
  const listActive=(s,channel)=>{
    if(!checkDir(home)||!checkDir(activeRoot))return {count:0,needsReview:0}
    const base=activePath(s,channel)
    if(!checkDir(base))return {count:0,needsReview:0}
    const entries=readdirSync(base)
    let needsReview=0
    for(const name of entries){
      try{
        if(!/^[0-9a-f-]{36}$/.test(name))throw Error('invalid operation identifier')
        const dir=join(base,name)
        if(!checkDir(dir)||!checkFile(join(dir,'claim.json')))throw Error('incomplete operation')
        const row=JSON.parse(readFileSync(join(dir,'claim.json'),'utf8'))
        if(row.version!==1||row.token!==name||row.pid<=0||!Number.isSafeInteger(row.pid)||
          row.channel!==channel||row.scopeHash!==hashedScope(s)||
          !['decision','send'].includes(row.phase)||!Number.isSafeInteger(row.at)||row.at<=0)throw Error('bad operation')
        if(!alive(row.pid))needsReview++
      }catch{needsReview++}
    }
    return {count:entries.length,needsReview}
  }
  const beginLegacyOperation=({channel,expectedScope,phase='decision'}={})=>{
    if(!validChannel(channel)||!['decision','send'].includes(phase))return {ok:false,reason:'invalid-legacy-operation'}
    const bound=validateScope(expectedScope)
    if(!bound.ok)return bound
    const token=randomUUID(),scopeId=bound.s,base=activePath(scopeId,channel),dir=join(base,token)
    try{
      ensure()
      if(!checkDir(activeRoot))mkdirSync(activeRoot,{mode:0o700})
      if(!checkDir(base))mkdirSync(base,{mode:0o700})
      mkdirSync(dir,{mode:0o700})
      const file=join(dir,'claim.json')
      let fd
      try{
        fd=openSync(file,'wx',0o600)
        writeSync(fd,JSON.stringify({version:1,token,channel,phase,scopeHash:hashedScope(scopeId),
          at:now(),pid:process.pid})+'\n')
        fsyncSync(fd)
      }finally{if(fd!==undefined)closeSync(fd)}
      legacySessions.set(token,{scope:scopeId,channel,phase,dir})
      // A concurrent cutover must be observed AFTER our claim is durable.
      const checked=check({channel,expectedScope:scopeId})
      if(!checked.ok){
        const ended=endLegacyOperation({token})
        return {ok:false,reason:ended.ok?checked.reason:'legacy-operation-review-required'}
      }
      return {ok:true,token,scope:scopeId,channel,phase}
    }catch{return {ok:false,reason:'legacy-operation-storage-unsafe'}}
  }
  const endLegacyOperation=({token}={})=>{
    const session=legacySessions.get(token)
    if(!session)return {ok:false,reason:'legacy-operation-not-owned'}
    try{
      if(!checkDir(session.dir)||!checkFile(join(session.dir,'claim.json')))
        return {ok:false,reason:'legacy-operation-incomplete'}
      const row=JSON.parse(readFileSync(join(session.dir,'claim.json'),'utf8'))
      if(row.token!==token||row.pid!==process.pid||row.channel!==session.channel||
        row.phase!==session.phase||row.scopeHash!==hashedScope(session.scope))
        return {ok:false,reason:'legacy-operation-mismatch'}
      rmSync(join(session.dir,'claim.json'))
      rmdirSync(session.dir)
      legacySessions.delete(token)
      return {ok:true,released:true}
    }catch{return {ok:false,reason:'legacy-operation-review-required'}}
  }
  const read=(s,channel)=>{
    checkDir(dataDir)
    if(!checkDir(home)||!checkDir(lanes))return {ok:true,held:false}
    const {id,dir,file}=paths(s,channel)
    if(!checkDir(dir))return {ok:true,held:false}
    // An interrupted mkdir before claim.json is still a permanent lock.
    if(!checkFile(file))return {ok:true,held:true,row:sanitizeRow(null,id,now())}
    try{
      const item=JSON.parse(readFileSync(file,'utf8'))
      if(item?.version!==VERSION||item.id!==id||item.channel!==channel||item.scopeHash!==hashedScope(s)||
         !/^[0-9a-f-]{36}$/.test(String(item.token||''))||item.state!=='reserved'||item.phase!=='preflight-decision-only'||!Number.isSafeInteger(item.pid)||item.pid<=0||!Number.isSafeInteger(item.at)||item.at<=0)throw Error('invalid')
      return {ok:true,held:true,row:sanitizeRow(item,id,now())}
    }catch{return {ok:true,held:true,row:sanitizeRow(null,id,now())}}
  }
  const check=({channel,expectedScope}={})=>{
    if(!validChannel(channel))return {ok:false,reason:'unsupported-social-channel'}
    const bound=validateScope(expectedScope)
    if(!bound.ok)return bound
    try{
      const found=read(bound.s,channel)
      return found.held?{ok:false,reason:'handoff-fence-held',lane:found.row}:
        {ok:true,owner:'legacy',scope:bound.s}
    }catch{return {ok:false,reason:'handoff-fence-storage-unsafe'}}
  }
  // This narrow reservation API is for explicit pre-handoff tests/maintenance.
  // It is never called by an LLM, and cannot promote an owner to Life Agent.
  const reserve=({channel,expectedScope,requester='legacy'}={})=>{
    if(requester!=='legacy')return {ok:false,reason:'social-handoff-not-enabled'}
    if(!validChannel(channel))return {ok:false,reason:'unsupported-social-channel'}
    const bound=validateScope(expectedScope)
    if(!bound.ok)return bound
    try{
      ensure()
      const {id,dir,file}=paths(bound.s,channel)
      try{mkdirSync(dir,{mode:0o700})}
      catch(e){if(e?.code==='EEXIST')return {ok:false,reason:'handoff-fence-held'};throw e}
      const token=randomUUID(),stamp=now()
      // A crash between mkdir and write leaves an intentionally held lane.
      const row={version:VERSION,id,scopeHash:hashedScope(bound.s),channel,token,
        state:'reserved',phase:'preflight-decision-only',pid:process.pid,at:stamp}
      try{writeFileSync(file,JSON.stringify(row)+'\n',{flag:'wx',mode:0o600})}
      catch{return {ok:false,reason:'handoff-fence-incomplete',held:true}}
      sessions.set(token,{id,scope:bound.s,channel})
      // Lane is now closed. Older operations that passed an earlier check have
      // claims, and new operations must see the held fence before proceeding.
      // Never consider a handoff safe while any operation (or incomplete claim)
      // remains. Reserving DOES NOT grant Life Agent ownership.
      const inflight=listActive(bound.s,channel)
      return {ok:true,token,channel,scope:bound.s,quiescent:inflight.count===0,
        inFlight:inflight.count,needsReview:inflight.needsReview}
    }catch{return {ok:false,reason:'handoff-fence-storage-unsafe'}}
  }
  const releaseDecisionOnly=({token,expectedScope}={})=>{
    const session=sessions.get(token)
    if(!session)return {ok:false,reason:'reservation-not-owned-by-process'}
    const bound=validateScope(expectedScope??session.scope)
    if(!bound.ok||bound.s!==session.scope)return {ok:false,reason:'account-changed'}
    try{
      const {id,dir,file}=paths(session.scope,session.channel)
      if(!checkDir(dir)||!checkFile(file))return {ok:false,reason:'reservation-incomplete'}
      const r=JSON.parse(readFileSync(file,'utf8'))
      if(r.id!==id||r.token!==token||r.pid!==process.pid||r.phase!=='preflight-decision-only'||r.state!=='reserved')return {ok:false,reason:'reservation-mismatch'}
      // A decision-only lease may be released ONLY before any platform write.
      // Callers must not use this to acknowledge an outbound send.
      rmSync(file);rmdirSync(dir);sessions.delete(token)
      return {ok:true,released:true,reason:'decision-only-no-platform-send'}
    }catch{return {ok:false,reason:'reservation-review-required'}}
  }
  const inspect=()=>{
    const bound=validateScope()
    if(!bound.ok)return {ok:true,accountReady:false,mode:'pre-handoff-only',channels:{dm:{held:false},comment:{held:false}},handoffEnabled:false}
    const channels={}
    try{
      for(const channel of CHANNELS){const state=read(bound.s,channel),active=listActive(bound.s,channel)
        channels[channel]={held:state.held,...(state.row||{}),inFlight:active.count,
          inFlightNeedsReview:active.needsReview,quiescent:active.count===0}}
      return {ok:true,accountReady:true,mode:'pre-handoff-only',channels,handoffEnabled:false,
        needsReview:Object.values(channels).filter(x=>x.held&&x.needsReview).length,
        note:'只读匿名跨进程预约；异常遗留不会自动过期或解锁；此阶段不接管社交，不代表平台回执'}
    }catch{return {ok:false,reason:'handoff-fence-storage-unsafe',handoffEnabled:false}}
  }
  // The only recovery path requires an explicit offline operator confirmation.
  // The stored claim must never be silently removed based on PID/elapsed time.
  const reviewNoSend=({channel,expectedScope,confirmation}={})=>{
    if(confirmation!=='我已确认该预约从未触发平台发送')return {ok:false,reason:'explicit-no-send-confirmation-required'}
    if(!validChannel(channel))return {ok:false,reason:'unsupported-social-channel'}
    const bound=validateScope(expectedScope)
    if(!bound.ok)return bound
    try{
      const {dir,file}=paths(bound.s,channel)
      if(!checkDir(dir))return {ok:false,reason:'no-held-reservation'}
      // Unreadable or incomplete records are held for separate manual filesystem
      // investigation, not blindly removed by this helper.
      if(!checkFile(file))return {ok:false,reason:'reservation-incomplete'}
      const entry=JSON.parse(readFileSync(file,'utf8'))
      if(entry.id!==laneId(bound.s,channel)||entry.channel!==channel||entry.scopeHash!==hashedScope(bound.s)||
         entry.version!==VERSION||entry.state!=='reserved'||entry.phase!=='preflight-decision-only'||!Number.isSafeInteger(entry.pid)||entry.pid<1||!Number.isSafeInteger(entry.at)||entry.at<=0||!/^[0-9a-f-]{36}$/.test(String(entry.token||'')))
        return {ok:false,reason:'reservation-unreadable'}
      if(alive(entry.pid))return {ok:false,reason:'reservation-process-still-alive'}
      rmSync(file);rmdirSync(dir);return {ok:true,released:true,reason:'operator-verified-no-platform-send'}
    }catch{return {ok:false,reason:'reservation-review-required'}}
  }
  return {check,reserve,releaseDecisionOnly,inspect,reviewNoSend,beginLegacyOperation,endLegacyOperation}
}
