/**
 * Life 1.1 · relationship-originated opportunities, independent of video picks.
 * The account-scoped ledger stores opaque hashes + decision state, NEVER a
 * friend's UID, a message, a prompt or another account's private observations.
 * Model choices do not grant DM permission; the platform adapter rechecks it.
 */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {normalizeFriendDirectory} from './friend-directory.mjs'
import {withLifeOpportunityLedgerLock} from './life-planner-atomic.mjs'

const DAY=86_400_000,ACCOUNT=/^[a-f0-9]{16}$/,ID=/^[a-f0-9]{24}$/
const stages=new Set(['known','familiar','regular','friend'])
const digest=x=>createHash('sha256').update(x).digest('hex')
const validUid=x=>/^[1-9]\d{0,18}$/.test(String(x||''))
export const friendInitiativePace=cfg=>{
  const minutes=Number(cfg?.autonomousPlannerMinutes)
  const limit=Number(cfg?.autonomousPlannerDailyLimit)
  if(minutes===10&&(limit===200||limit===100))return {pace:'lively',considerAgainAfterHours:12}
  if((minutes===80&&limit===50)||(minutes===120&&limit===12))return {pace:'quiet',considerAgainAfterHours:72}
  return {pace:'natural-or-custom',considerAgainAfterHours:24}
}
export function createLifeFriendInitiatives({dataDir,getAccountTag,getConfig,getRelationships,getDmBoundary=()=>false,now=Date.now}={}){
  if(!dataDir||typeof getAccountTag!=='function'||typeof getConfig!=='function'||typeof getRelationships!=='function')throw TypeError('Life friend initiative dependencies missing')
  const scope=()=>{const tag=String(getAccountTag()||'');if(!ACCOUNT.test(tag))throw Error('life-friend-account-unverified');return tag}
  const file=()=>join(dataDir,'life-friend-initiatives',scope()+'.json')
  const empty=()=>({version:1,entries:[]})
  const read=()=>{
    const name=file(),folder=join(dataDir,'life-friend-initiatives')
    if(existsSync(folder)&&(!lstatSync(folder).isDirectory()||lstatSync(folder).isSymbolicLink()))throw Error('unsafe-friend-initiative-dir')
    if(!existsSync(name))return empty()
    const s=lstatSync(name);if(!s.isFile()||s.isSymbolicLink()||s.size>150_000)throw Error('unsafe-friend-initiative-ledger')
    const d=JSON.parse(readFileSync(name,'utf8'))
    if(d?.version!==1||!Array.isArray(d.entries)||d.entries.length>300)throw Error('friend-initiative-version-unknown')
    return d
  }
  const write=d=>{
    const folder=join(dataDir,'life-friend-initiatives');mkdirSync(folder,{recursive:true,mode:0o700})
    if(lstatSync(folder).isSymbolicLink()||!lstatSync(folder).isDirectory())throw Error('unsafe-friend-initiative-dir')
    const name=file();if(existsSync(name)&&(!lstatSync(name).isFile()||lstatSync(name).isSymbolicLink()))throw Error('unsafe-friend-initiative-ledger')
    d.entries=d.entries.filter(x=>Number(x.at)>now()-45*DAY).slice(-240)
    const tmp=name+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(d)+'\n',{mode:0o600,flag:'wx'});renameSync(tmp,name)
  }
  const eligible=()=>{
    const account=scope(),cfg=getConfig(),at=now(),delay=friendInitiativePace(cfg).considerAgainAfterHours*3600_000
    if(cfg.masterEnabled!==true||cfg.autonomousPlannerEnabled!==true||!['active','shadow'].includes(cfg.lifeAgentMode))return []
    const roster=JSON.parse(normalizeFriendDirectory(cfg.friendDirectory||'[]'))
    const whitelistDm=new Set(roster.filter(x=>x.dm===true).map(x=>x.uid))
    const relationships=getRelationships()
    if(!Array.isArray(relationships))throw Error('friend-relationship-source-unavailable')
    const past=read().entries
    const out=[]
    for(const r of relationships){
      const uid=String(r?.uid||''),last=Number(r?.lastAt)
      if(!validUid(uid)||uid===String(cfg.dmOwnerUid||'')||
        !stages.has(r?.stage)||Number(r?.incoming)<1||Number(r?.outgoing)<1||Number(r?.count)<4||
        !Number.isSafeInteger(last)||last<=0||last>at||at-last<delay||at-last>45*DAY)continue
      const personKey=digest('friend-person-v1\0'+account+'\0'+uid).slice(0,24)
      // One stable candidate per relationship phase; automatic deferrals do not
      // invent new events every 10 minutes or mutate the source relationship.
      const id=digest('friend-proposal-v1\0'+account+'\0'+uid+'\0'+Math.floor(last/DAY)).slice(0,24)
      const previous=past.filter(x=>x.personKey===personKey).sort((a,b)=>b.at-a.at)[0]
      if(previous&&(previous.state==='reserved'||previous.state==='uncertain'||previous.state==='sent'||
        Number(previous.nextAt)>at))continue
      const privateEstablished=r.dmOpenness?.state==='established'&&r.dmOpenness.eligible===true
      const explicitlyAuthorized=(cfg.lifeProactiveFriendDmEnabled===true&&whitelistDm.has(uid))||
        cfg.lifeNaturalDmOutreachEnabled===true
      const outboundEnabled=privateEstablished&&explicitlyAuthorized&&cfg.dmWatch===true&&
        cfg.lifeAgentMode==='active'&&getDmBoundary(uid)!==true
      out.push({id,personKey,source:'relationship-metadata',stage:r.stage,ageHours:Math.floor((at-last)/3600_000),
        activeDays:Number(r.activeDays)||0,conversationDirections:'verified-bidirectional',
        dmOpenness:r.dmOpenness?.state||'unknown',outboundEnabled,eligible:true})
    }
    return out.sort((a,b)=>b.ageHours-a.ageHours).slice(0,4)
  }
  const lookup=(id,{allowReserved=false}={})=>{
    if(!ID.test(String(id||'')))return null
    const account=scope(),cfg=getConfig(),at=now()
    if(cfg.masterEnabled!==true||cfg.autonomousPlannerEnabled!==true||!['active','shadow'].includes(cfg.lifeAgentMode))return null
    const whitelistDm=new Set(JSON.parse(normalizeFriendDirectory(cfg.friendDirectory||'[]')).filter(x=>x.dm===true).map(x=>x.uid))
    const row=getRelationships().find(r=>{
      const uid=String(r.uid||'');return uid!==String(cfg.dmOwnerUid||'')&&stages.has(r.stage)&&
        Number(r.incoming)>=1&&Number(r.outgoing)>=1&&Number(r.count)>=4&&
        Number(r.lastAt)<=at&&at-Number(r.lastAt)<45*DAY&&
        digest('friend-proposal-v1\0'+account+'\0'+uid+'\0'+Math.floor(Number(r.lastAt)/DAY)).slice(0,24)===id
    })
    if(!row)return null
    const personKey=digest('friend-person-v1\0'+account+'\0'+row.uid).slice(0,24)
    const latest=read().entries.find(x=>x.id===id)
    if(allowReserved&&latest?.state!=='reserved')return null
    if(!allowReserved&&!eligible().some(x=>x.id===id))return null
    const authorized=(cfg.lifeProactiveFriendDmEnabled===true&&whitelistDm.has(String(row.uid)))||
      cfg.lifeNaturalDmOutreachEnabled===true
    return {id,personKey,uid:String(row.uid),lastAt:Number(row.lastAt),stage:row.stage,
      dmOpenness:row.dmOpenness?.state||'unknown',
      outboundEnabled:row.dmOpenness?.state==='established'&&row.dmOpenness?.eligible===true&&
        authorized&&cfg.dmWatch===true&&cfg.lifeAgentMode==='active'&&getDmBoundary(String(row.uid))!==true}
  }
  // A chosen outgoing action is reserved DURABLY before the first model or
  // network call; unknown outcomes are never automatically retried.
  const mark=(id,{action='review',result=''}={})=>{
    if(!['review','defer','reserve','sent','uncertain','abort'].includes(action))return {ok:false,reason:'invalid-action'}
    const resultLock=withLifeOpportunityLedgerLock(dataDir,()=>{
      const account=scope(),d=read(),at=now(),personKey=ID.test(id)?lookup(id)?.personKey:null
      // Finishing a reservation is allowed after eligibility disappeared.
      const old=d.entries.find(x=>x.id===id)
      if(action==='sent'||action==='uncertain'||action==='abort'){
        if(!old||old.state!=='reserved')return {ok:false,reason:'no-matching-reservation'}
        old.state=action==='abort'?'deferred':action;old.at=at
        old.nextAt=action==='abort'?at+DAY:0;old.result=String(result||'').slice(0,42)
      }else{
        if(!personKey)return {ok:false,reason:'proposal-no-longer-eligible'}
        if(action==='reserve'&&lookup(id)?.outboundEnabled!==true)return {ok:false,reason:'private-contact-not-open'}
        if(old&&['reserved','sent','uncertain'].includes(old.state))return {ok:false,reason:'proposal-already-handled'}
        if(old&&old.nextAt>at)return {ok:false,reason:'proposal-still-cooled'}
        const row={id,personKey,at,state:action==='reserve'?'reserved':'deferred',
          nextAt:action==='review'?at+12*3600_000:action==='defer'?at+DAY:0,result:String(result||'').slice(0,42)}
        if(old)Object.assign(old,row);else d.entries.push(row)
      }
      write(d);return {ok:true,state:action}
    },{now})
    return resultLock?.ok===false?{ok:false,reason:resultLock.reason}:resultLock
  }
  const status=()=>{const db=read(),rows=eligible();return {available:rows.length,reviewed:db.entries.filter(x=>x.state==='deferred').length,
    reserved:db.entries.filter(x=>x.state==='reserved').length,uncertain:db.entries.filter(x=>x.state==='uncertain').length}}
  return {eligible,lookup,mark,status}
}
