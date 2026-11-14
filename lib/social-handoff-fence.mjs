/**
 * dev.7 RC: durable cross-process social decision ownership and handoff fence.
 *
 * This is not a sender, inbox, model selector or outbound permission grant.
 * Old accounts migrate to Life behind BOTH durable channel reservations.
 * The previous decision owner is never an allowed runtime fallback.
 * A crash leaves an opaque lane reserved until an operator verifies no send.
 * Existing DM/comment delivery receipts remain their sole source of truth.
 */
import {createHash,randomUUID} from 'node:crypto'
import {lstatSync,mkdirSync,readdirSync,readFileSync,rmSync,rmdirSync,openSync,writeSync,fsyncSync,closeSync,renameSync} from 'node:fs'
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
  const home=join(dataDir,ROOT),lanes=join(home,'lanes'),activeRoot=join(home,'inflight'),owners=join(home,'owners')
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
  // Durable owner facts live with the existing handoff fence, not in a new
  // permissions or chat ledger. Absence means the historical legacy owner.
  // Corruption must NEVER silently restore legacy sending privileges.
  const readOwner=(s,channel)=>{
    if(!checkDir(home)||!checkDir(owners))return {owner:'legacy',generation:'initial'}
    const file=join(owners,laneId(s,channel)+'.json')
    if(!checkFile(file))return {owner:'legacy',generation:'initial'}
    const row=JSON.parse(readFileSync(file,'utf8'))
    if(row?.version!==2||row.scopeHash!==hashedScope(s)||row.channel!==channel||
      !['legacy','life-agent'].includes(row.owner)||!/^[0-9a-f-]{36}$/.test(String(row.generation||''))||
      !Number.isSafeInteger(row.at)||row.at<1)throw Error('social-owner-state-corrupt')
    return {owner:row.owner,generation:row.generation}
  }
  const ensure=()=>{
    checkDir(dataDir)
    if(!checkDir(home))mkdirSync(home,{mode:0o700})
    if(!checkDir(lanes))mkdirSync(lanes,{mode:0o700})
    if(!checkDir(owners))mkdirSync(owners,{mode:0o700})
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
  const beginSocialOperation=({channel,expectedScope,phase='decision',requester='legacy',expectedGeneration}={})=>{
    if(!validChannel(channel)||!['decision','send'].includes(phase)||!['legacy','life-agent'].includes(requester))return {ok:false,reason:'invalid-social-operation'}
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
      const checked=check({channel,expectedScope:scopeId,requester,expectedGeneration})
      if(!checked.ok){
        const ended=endLegacyOperation({token})
        return {ok:false,reason:ended.ok?checked.reason:'legacy-operation-review-required'}
      }
      return {ok:true,token,scope:scopeId,channel,phase,owner:checked.owner,generation:checked.generation}
    }catch{return {ok:false,reason:'legacy-operation-storage-unsafe'}}
  }
  const beginLegacyOperation=args=>beginSocialOperation({...args,requester:'legacy'})
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
  const check=({channel,expectedScope,requester='legacy',expectedGeneration}={})=>{
    if(!validChannel(channel))return {ok:false,reason:'unsupported-social-channel'}
    if(!['legacy','life-agent'].includes(requester))return {ok:false,reason:'unsupported-social-owner'}
    const bound=validateScope(expectedScope)
    if(!bound.ok)return bound
    try{
      const found=read(bound.s,channel)
      if(found.held)return {ok:false,reason:'handoff-fence-held',lane:found.row}
      const current=readOwner(bound.s,channel)
      if(current.owner!==requester)return {ok:false,reason:'social-owner-mismatch'}
      if(expectedGeneration!==undefined&&current.generation!==expectedGeneration)
        return {ok:false,reason:'social-owner-generation-changed'}
      return {ok:true,owner:current.owner,generation:current.generation,scope:bound.s}
    }catch{return {ok:false,reason:'handoff-fence-storage-unsafe'}}
  }
  const currentOwner=({channel,expectedScope}={})=>{
    if(!validChannel(channel))return {ok:false,reason:'unsupported-social-channel'}
    const bound=validateScope(expectedScope)
    if(!bound.ok)return bound
    try{
      const locked=read(bound.s,channel)
      if(locked.held)return {ok:false,reason:'handoff-fence-held'}
      return {ok:true,scope:bound.s,...readOwner(bound.s,channel)}
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
      // Durably publish the claim before we call any user supplied inspection.
      // A crash before the claim is complete still leaves the directory held.
      try{
        let fd
        try{fd=openSync(file,'wx',0o600);writeSync(fd,JSON.stringify(row)+'\n');fsyncSync(fd)}
        finally{if(fd!==undefined)closeSync(fd)}
      }catch{return {ok:false,reason:'handoff-fence-incomplete',held:true}}
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
  // Operator-only switch while the same per-account/channel lane is held.
  // The old owner is drained BEFORE committing the new owner. A crash leaves
  // the lane held, not a second active sender. No model or UI value is trusted.
  const switchOwner=({token,channel,expectedScope,targetOwner,confirmation,masterDisabled=false,
    lifeReady=false,migrationQuiesced=false,inspectSendTransactions}={})=>{
    const session=sessions.get(token)
    if(!session||session.channel!==channel)return {ok:false,reason:'reservation-not-owned-by-process'}
    if(!['life-agent','legacy'].includes(targetOwner)||
      confirmation!=='我已停机核实社交归属切换不会造成重复发送')
      return {ok:false,reason:'explicit-owner-switch-confirmation-required'}
    if((masterDisabled!==true&&migrationQuiesced!==true)||lifeReady!==true)return {ok:false,reason:'owner-switch-safety-preconditions-failed'}
    const bound=validateScope(expectedScope??session.scope)
    if(!bound.ok||bound.s!==session.scope)return {ok:false,reason:'account-changed'}
    try{
      const {id,dir,file}=paths(bound.s,channel)
      if(!checkDir(dir)||!checkFile(file))return {ok:false,reason:'handoff-fence-incomplete'}
      const claim=JSON.parse(readFileSync(file,'utf8'))
      if(claim.token!==token||claim.pid!==process.pid||claim.id!==id||claim.phase!=='preflight-decision-only')
        return {ok:false,reason:'handoff-fence-mismatch'}
      const active=listActive(bound.s,channel)
      if(active.count!==0||active.needsReview!==0)return {ok:false,reason:'social-operations-not-drained'}
      const tx=typeof inspectSendTransactions==='function'?inspectSendTransactions():null
      const counts=tx?.channels?.[channel]
      if(tx?.ok!==true||tx.accountReady!==true||!counts||
        !['confirmed','attempted','uncertain','incomplete'].every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0))
        return {ok:false,reason:'send-transaction-inspection-unavailable'}
      if(counts.attempted||counts.uncertain||counts.incomplete)return {ok:false,reason:'send-transaction-review-required'}
      if(!checkDir(owners))mkdirSync(owners,{mode:0o700})
      const previous=readOwner(bound.s,channel)
      if(previous.owner===targetOwner)return {ok:false,reason:'social-owner-already-selected'}
      const generation=randomUUID()
      const target=join(owners,id+'.json'),tmp=target+'.tmp-'+generation
      let fd
      try{
        fd=openSync(tmp,'wx',0o600)
        writeSync(fd,JSON.stringify({version:2,scopeHash:hashedScope(bound.s),channel,
          owner:targetOwner,generation,at:now()})+'\n')
        fsyncSync(fd)
      }finally{if(fd!==undefined)closeSync(fd)}
      renameSync(tmp,target)
      return {ok:true,owner:targetOwner,previousOwner:previous.owner,generation,
        requiresRelease:true}
    }catch{return {ok:false,reason:'social-owner-state-write-unsafe'}}
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
        const owner=readOwner(bound.s,channel)
        channels[channel]={held:state.held,owner:owner.owner,generation:owner.generation,...(state.row||{}),inFlight:active.count,
          inFlightNeedsReview:active.needsReview,quiescent:active.count===0}}
      return {ok:true,accountReady:true,mode:'operator-controlled-cutover',channels,handoffEnabled:Object.values(channels).some(x=>x.owner==='life-agent'),
        needsReview:Object.values(channels).filter(x=>(x.held&&x.needsReview)||x.inFlightNeedsReview>0).length,
        orphanedInFlight:Object.values(channels).reduce((n,x)=>n+x.inFlightNeedsReview,0),
        note:'新老用户共用 Life 社交归属；旧归属仅供历史核查，异常预约不自动解锁；不代表平台发送成功'}
    }catch{return {ok:false,reason:'handoff-fence-storage-unsafe',handoffEnabled:false}}
  }
  // Upgrade both social channels as ONE fail-closed migration. The old responders
  // are not a fallback: callers must block until BOTH owners are Life. Two held
  // lanes prevent old writers from racing through during the multi-file update.
  // A crash after the first owner write intentionally leaves BOTH lanes held.
  const migrateAllToLife=({expectedScope,lifeReady=false,inspectSendTransactions}={})=>{
    const bound=validateScope(expectedScope)
    if(!bound.ok)return bound
    if(lifeReady!==true||typeof inspectSendTransactions!=='function')
      return {ok:false,reason:'life-migration-prerequisites-unavailable'}
    const channels=['dm','comment'],booked=[]
    let committed=0,complete=false,reason='life-migration-incomplete'
    try{
      const initial=channels.map(channel=>currentOwner({channel,expectedScope:bound.s}))
      if(initial.some(x=>!x.ok))return {ok:false,reason:'life-owner-ledger-unavailable'}
      if(initial.every(x=>x.owner==='life-agent'))return {ok:true,alreadyMigrated:true,channels}
      for(const channel of channels){
        const held=reserve({channel,expectedScope:bound.s,requester:'legacy'})
        if(!held.ok){reason=held.reason;return {ok:false,reason,held:held.held===true}}
        booked.push(held)
        if(!held.quiescent||held.needsReview){reason='social-operations-not-drained';return {ok:false,reason}}
      }
      const tx=inspectSendTransactions()
      if(scope()!==bound.s){reason='account-changed';return {ok:false,reason}}
      if(tx?.ok!==true||tx.accountReady!==true||channels.some(ch=>{
        const row=tx.channels?.[ch]
        return !row||!['confirmed','attempted','uncertain','incomplete'].every(k=>Number.isSafeInteger(row[k])&&row[k]>=0)
      })){reason='send-transaction-inspection-unavailable';return {ok:false,reason}}
      if(channels.some(ch=>['attempted','uncertain','incomplete'].some(k=>tx.channels[ch][k]>0))){
        reason='send-transaction-review-required';return {ok:false,reason}
      }
      for(const channel of channels){
        // Read the owner record while our two migration reservations are held.
        const owner=readOwner(bound.s,channel)
        if(owner.owner==='life-agent')continue
        const claim=booked.find(x=>x.channel===channel)
        const result=switchOwner({token:claim.token,channel,expectedScope:bound.s,
          targetOwner:'life-agent',confirmation:'我已停机核实社交归属切换不会造成重复发送',
          migrationQuiesced:true,lifeReady:true,inspectSendTransactions:()=>tx})
        if(!result.ok){reason=result.reason;return {ok:false,reason,held:committed>0}}
        committed++
      }
      complete=true
      return {ok:true,migrated:true,channels,permissionsChanged:false}
    }catch{return {ok:false,reason:'life-migration-storage-unsafe',held:committed>0}}
    finally{
      // Interrupted partial migration is frozen for offline review, not undone
      // by clearing a lock while the account is half switched.
      if(complete||committed===0){
        let releaseFailed=false
        for(const claim of [...booked].reverse()){
          const released=releaseDecisionOnly({token:claim.token,expectedScope:bound.s})
          if(!released.ok)releaseFailed=true
        }
        // A locked lane is never a successful migration, even if both
        // owner files were already written successfully.
        if(releaseFailed)return {ok:false,reason:'life-migration-reservation-review-required',held:true}
      }
    }
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
  // A strict, decision-only rehearsal of the channel cutover protocol. This
  // uses the SAME durable reservation and draining rules as production legacy
  // operations, but does not promote a Life owner, run a model, or send anything.
  // Never auto-release an interrupted rehearsal: its reservation stays held.
  const rehearse=({channel,expectedScope,inspectSendTransactions}={})=>{
    const booked=reserve({channel,expectedScope,requester:'legacy'})
    if(!booked.ok)return {ok:false,reason:booked.reason,held:booked.held===true}
    let report={ok:false,reason:'rehearsal-incomplete'}
    try{
      if(!booked.quiescent)report={ok:false,reason:booked.needsReview?'legacy-inflight-review-required':'legacy-operations-in-flight',
        inFlight:booked.inFlight,needsReview:booked.needsReview}
      else if(typeof inspectSendTransactions!=='function')report={ok:false,reason:'send-transaction-inspector-required'}
      else{
        const inspection=inspectSendTransactions()
        const counts=inspection?.channels?.[channel]
        if(inspection?.ok!==true||inspection.accountReady!==true||!counts||
           !['confirmed','attempted','uncertain','incomplete'].every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0))
          report={ok:false,reason:'send-transaction-inspection-unavailable'}
        else if(counts.attempted||counts.uncertain||counts.incomplete)
          report={ok:false,reason:'send-transaction-review-required',
            attempted:counts.attempted,uncertain:counts.uncertain,incomplete:counts.incomplete}
        else report={ok:true,reason:'decision-only-dry-run-passed',quiescent:true,
          confirmedHistoricalSends:counts.confirmed}
      }
      if(scope()!==booked.scope)report={ok:false,reason:'account-changed'}
    }catch{report={ok:false,reason:'rehearsal-inspection-failed'}}
    // Release is allowed only because NO platform adapter was entered; never
    // use this method to "recover" an actual attempted send.
    const released=releaseDecisionOnly({token:booked.token,expectedScope:booked.scope})
    if(!released.ok)return {ok:false,reason:'rehearsal-reservation-review-required',held:true}
    return {...report,held:false,socialHandoffEnabled:false}
  }
  return {check,currentOwner,reserve,switchOwner,migrateAllToLife,releaseDecisionOnly,rehearse,inspect,reviewNoSend,beginSocialOperation,beginLegacyOperation,endLegacyOperation}
}
