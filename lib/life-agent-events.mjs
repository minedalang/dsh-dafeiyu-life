/**
 * dev.4 A/B: platform-neutral, account-scoped life wake inbox. Only anonymous
 * event classes are persisted here; it is NOT a second memory, relationship
 * database, permission store or authoritative platform receipt.
 */
import {createHash} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

const MAX_BYTES=96_000,RETENTION=7*86_400_000
const TYPES=new Set(['quiet-window','video-round-ended','manual-wake','dm-received','comment-received'])
const SCOPE=/^[a-f0-9]{16}$/
const PLATFORM=/^[a-z][a-z0-9_-]{1,30}$/
const blank=()=>({version:1,events:[],videoStarts:[],timeline:[]})
// A readable life journal is *not* a second memory or a platform receipt.
// All persisted values are bounded enums or opaque hashes; never persist model
// prose, conversation contents, UIDs, BVIDs or credentials in this journal.
const ACTIONS=new Set(['skip','consider_social','use_capability','begin_exploration','inspect_exploration',
  'inspect_creator_space','abandon_exploration','inspect_opportunity','review_public','defer','dismiss','reflect','execute_read'])
const RESULT=/^[a-z][a-z0-9-]{0,54}$/
const OPTION_KEYS=['todos','cues','intentions','opportunities','social','video','reflection']
const BLOCKERS=new Set(['video-capability-unavailable','video-daily-limit','video-launch-cooldown','no-verified-candidates'])
const hashId=value=>createHash('sha256').update('life-continuation\0'+value).digest('hex').slice(0,16)

export function createLifeAgentEvents({stateDir,getAccountTag,now=Date.now}={}){
  if(!stateDir||typeof getAccountTag!=='function')throw TypeError('Life event account boundary missing')
  const file=()=>{
    const tag=getAccountTag()
    if(!SCOPE.test(String(tag||'')))throw Error('Life Agent requires a verified account scope')
    return join(stateDir,'life-agent-events',tag+'.json')
  }
  const load=()=>{
    const name=file()
    if(!existsSync(name))return blank()
    const st=lstatSync(name)
    if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw Error('Life Agent event ledger unsafe')
    const value=JSON.parse(readFileSync(name,'utf8'))
    if(value?.version!==1||!Array.isArray(value.events)||!Array.isArray(value.videoStarts))throw Error('Life Agent event version unsupported')
    // Version-one ledgers from phase1/2 have no timeline. Upgrade lazily when
    // a new journal entry is written; never discard old pending events.
    return {version:1,events:value.events.slice(-100),videoStarts:value.videoStarts.slice(-50),
      timeline:Array.isArray(value.timeline)?value.timeline.slice(-50):[]}
  }
  const prune=value=>{
    const t=now()
    value.events=value.events.filter(e=>e&&Number.isSafeInteger(e.at)&&e.at<=t+60_000&&t-e.at<RETENTION&&TYPES.has(e.kind)&&PLATFORM.test(e.platform)).slice(-60)
    value.videoStarts=value.videoStarts.filter(x=>Number.isSafeInteger(x)&&x<=t+60_000&&t-x<RETENTION).slice(-30)
    value.timeline=(Array.isArray(value.timeline)?value.timeline:[]).filter(x=>x&&Number.isSafeInteger(x.at)&&x.at<=t+60_000&&t-x.at<RETENTION).slice(-40)
    return value
  }
  const save=value=>{
    const name=file(),folder=join(stateDir,'life-agent-events')
    mkdirSync(folder,{recursive:true})
    if(!lstatSync(folder).isDirectory()||lstatSync(folder).isSymbolicLink())throw Error('Life Agent events folder unsafe')
    if(existsSync(name)&&(!lstatSync(name).isFile()||lstatSync(name).isSymbolicLink()))throw Error('Life Agent events file unsafe')
    const tmp=name+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp'
    writeFileSync(tmp,JSON.stringify(prune(value))+'\n',{mode:0o600})
    renameSync(tmp,name)
  }
  const offer=({kind,platform='life',sourceKey}={})=>{
    if(!TYPES.has(kind)||!PLATFORM.test(platform)||typeof sourceKey!=='string'||!sourceKey||sourceKey.length>160)
      throw Error('Untrusted Life Agent event type/source')
    const value=prune(load())
    // Never persist source keys, BVIDs, raw messages, contacts or private text.
    const id=createHash('sha256').update(kind+'\0'+platform+'\0'+sourceKey).digest('hex').slice(0,24)
    if(value.events.some(e=>e.id===id))return {ok:true,created:false,id}
    if(kind==='manual-wake'){
      // Repeated button clicks replace only outstanding MANUAL wake requests.
      // Never discard real social/video events or a completed timeline entry.
      for(const e of value.events)if(e.kind==='manual-wake'&&e.state==='pending'){
        e.state='considered';e.result='considered'
      }
    }
    value.events.push({id,kind,platform,at:now(),state:'pending'})
    save(value)
    return {ok:true,created:true,id}
  }
  const peek=(limit=4)=>{
    const pending=prune(load()).events.filter(e=>e.state==='pending')
    // An explicit, recent human wake must be visible this turn even if the
    // account has a backlog. Preserve FIFO for genuine social/video events.
    const manual=[...pending].reverse().find(e=>e.kind==='manual-wake')
    const prioritized=manual?[manual,...pending.filter(e=>e.kind!=='manual-wake')]:pending
    return prioritized.slice(0,Math.max(0,Math.min(8,Number(limit)||4)))
      .map(e=>({id:e.id,kind:e.kind,platform:e.platform,at:e.at}))
  }
  const settle=(ids,reason='considered')=>{
    const selected=new Set(Array.isArray(ids)?ids.filter(x=>/^[a-f0-9]{24}$/.test(String(x))):[])
    const value=prune(load());let updated=0
    for(const e of value.events)if(selected.has(e.id)&&e.state==='pending'){
      e.state='considered';e.result=['considered','model-error','invalid','social-attended','social-passed-over'].includes(reason)?reason:'considered';updated++
    }
    if(updated)save(value)
    return {ok:true,updated}
  }
  const recordDecision=({eventIds=[],action='skip',result='',targetId='',mode='shadow',failed=false,options={},blocker=''}={})=>{
    if(!ACTIONS.has(action)||!['shadow','active'].includes(mode))throw Error('Invalid life journal decision')
    const value=prune(load()),selected=new Set(Array.isArray(eventIds)?eventIds:[])
    const kinds=[...new Set(value.events.filter(e=>selected.has(e.id)).map(e=>e.kind))].slice(0,5)
    const proof=RESULT.test(String(result))?result:(failed?'execution-failed':'no-action-receipt')
    const continuation=typeof targetId==='string'&&targetId.length>0&&targetId.length<=160?hashId(targetId):''
    const continued=continuation!==''&&value.timeline.some(x=>x.continuation===continuation)
    value.timeline.push({at:now(),mode,kinds,action,result:proof,failed:failed===true,
      // The same verified opportunity can be recognized across rounds, but its
      // raw identifier must stay in the authoritative intention store.
      continuation,continued,options:Object.fromEntries(OPTION_KEYS.map(k=>[k,Math.max(0,Math.min(9,Number.isSafeInteger(options?.[k])?options[k]:0))])),
      blocker:BLOCKERS.has(blocker)?blocker:''})
    save(value)
    return {ok:true}
  }
  const recordVideoStart=()=>{
    const value=prune(load());value.videoStarts.push(now());save(value)
    return {ok:true}
  }
  const status=()=>{
    const value=prune(load()),t=now(),today=new Date(t).toLocaleDateString('en-CA')
    return {ok:true,pending:value.events.filter(e=>e.state==='pending').length,
      considered:value.events.filter(e=>e.state==='considered').length,
      pendingSocial:value.events.filter(e=>e.state==='pending'&&['dm-received','comment-received'].includes(e.kind)).length,
      recentSocialKinds:value.events.filter(e=>['dm-received','comment-received'].includes(e.kind)).slice(-8).map(e=>e.kind),
      videoStartsToday:value.videoStarts.filter(x=>new Date(x).toLocaleDateString('en-CA')===today).length,
      lastVideoAt:value.videoStarts.at(-1)||0,
      recent:value.events.slice(-10).reverse().map(e=>({kind:e.kind,platform:e.platform,at:e.at,state:e.state,result:e.result||''})),
      timeline:value.timeline.slice(-30).reverse().map(e=>({at:e.at,mode:e.mode,kinds:e.kinds,
        action:e.action,result:e.result,failed:e.failed,continued:e.continued,options:e.options||null,blocker:e.blocker||''}))}
  }
  return {offer,peek,settle,recordDecision,recordVideoStart,status}
}
