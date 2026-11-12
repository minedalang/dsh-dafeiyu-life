/**
 * 2.7.1-dev.3: bounded read-only life cues and fish-elected intentions. A provisional reaction
 * remains a SUBJECTIVE observation, not a fact, preference or accepted TODO.
 * Reuse the existing autonomous-planner's model budget; no new timer, no send.
 */
import {createHash} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {discussionAccountTag,readVideoDiscussionDiagnostics} from './video-discussion-diagnostics.mjs'
import {withLifeOpportunityLedgerLock} from './life-planner-atomic.mjs'
import {verifiedVideoObservation} from './life-action-protocol.mjs'

const DAY=86_400_000,MAX=96_000,VALID_BV=/^BV[0-9A-Za-z]{10}$/
const EPISODE_MAX_STEPS=5,EPISODE_MAX_VIDEOS=5
const ERROR_CODES=new Set(['search-api-error','metadata-api-error','metadata-timeout','metadata-read-busy','metadata-rate-limited','metadata-account-unavailable','metadata-response-invalid','metadata-bvid-mismatch','metadata-title-missing'])
const ERROR_RETRY_MS=[15*60_000,60*60_000,6*60*60_000]
const ACTIONS=new Set(['inspect','review','defer','dismiss','skip','error'])
// Cue failures are independent of opportunity completion: a previously
// inspected public observation may still inspire an optional new exploration.
// Never overwrite its verified read/closed decision with an exploration error.
const CUE_RETRY_LIMIT=3
const unsafePublicTopic=x=>/(?:\d{8,}|\b(?:token|cookie|api.?key|password)\b|私信|聊天记录|手机号|身份证|家庭住址|验证码|密码|邮箱)/i.test(String(x||''))
const clean=(x,n=100)=>String(x??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const validUid=x=>/^[1-9]\d{0,18}$/.test(String(x||''))
const boundedTime=x=>{const ms=Date.parse(String(x||''));return Number.isFinite(ms)?ms:0}
export const validLifeExplorationGoal=x=>{const s=clean(x,120);return s.length>=4&&!/(?:https?:\/\/|www\.|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\d{8,}|私信|聊天记录|手机号|家庭住址|身份证|cookie|token|api.?key|验证码|密码)/i.test(s)}
function pathFor(dir,account){
  if(!/^[a-f0-9]{16}$/.test(account))throw Error('无法确定当前 B站账号的生活契机隔离键')
  const folder=join(dir,'life-opportunities')
  if(existsSync(folder)){const st=lstatSync(folder);if(!st.isDirectory()||st.isSymbolicLink())throw Error('生活契机目录不安全')}
  return join(folder,account+'.json')
}
function read(dir,account){
  const file=pathFor(dir,account)
  if(!existsSync(file))return {version:1,decisions:[],intentions:[],cueFailures:[]}
  const stat=lstatSync(file)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX)throw Error('生活契机账本不安全或过大')
  const raw=JSON.parse(readFileSync(file,'utf8'))
  if(raw?.version!==1||!Array.isArray(raw.decisions))throw Error('生活契机账本格式不兼容')
  return {version:1,decisions:raw.decisions.slice(-100).map(d=>d?.action==='defer'&&d?.result==='metadata-read-failed'?
    {...d,action:'error',failureCode:'metadata-api-error',failures:1,nextAt:Math.min(Number(d.nextAt||Infinity),Number(d.at||0)+ERROR_RETRY_MS[0])}:d),intentions:Array.isArray(raw.intentions)?raw.intentions.filter(x=>x&&typeof x==='object'&&!Array.isArray(x))
      .map(x=>x.status==='paused'&&Number(x.metadataFailures)>=3&&ERROR_CODES.has(String(x.metadataFailureCode||''))&&
        Number.isFinite(Number(x.nextAt))?{...x,status:'ready'}:x).slice(-20):[],
    cueFailures:Array.isArray(raw.cueFailures)?raw.cueFailures.filter(x=>/^[a-f0-9]{24}$/.test(String(x?.id||''))&&Number.isSafeInteger(x.failures)&&x.failures>=1&&x.failures<=CUE_RETRY_LIMIT&&Number.isSafeInteger(x.nextAt)).slice(-40):[]}
}
function write(dir,account,record){
  const folder=join(dir,'life-opportunities');mkdirSync(folder,{recursive:true})
  if(!lstatSync(folder).isDirectory()||lstatSync(folder).isSymbolicLink())throw Error('生活契机目录不安全')
  const file=pathFor(dir,account)
  if(existsSync(file)&&(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()))throw Error('生活契机账本不是普通文件')
  const temp=file+'.'+process.pid+'.'+Math.random().toString(36).slice(2)+'.tmp'
  writeFileSync(temp,JSON.stringify({version:1,decisions:record.decisions.slice(-100),intentions:(record.intentions||[]).slice(-20),cueFailures:(record.cueFailures||[]).slice(-40)},null,2)+'\n',{mode:0o600})
  renameSync(temp,file)
}
const ident=(bvid,at)=>createHash('sha256').update('discussion:'+bvid+':'+at).digest('hex').slice(0,24)
/** Distill actual read receipts only; do not import the provisional text as a fact. */
export function deriveDiscussionOpportunities(events=[],now=Date.now()){
  const valid=Array.isArray(events)?events:[]
  const sorted=[...valid].sort((a,b)=>boundedTime(a.at)-boundedTime(b.at))
  const reads=new Map(),rows=[]
  for(const event of sorted){
    const at=boundedTime(event?.at),bv=String(event?.bvid||'')
    if(!VALID_BV.test(bv)||!at||at>now+60_000||now-at>7*DAY)continue
    if(event.kind==='comment_list_read'&&event.status==='read'&&event.verified===true&&Number(event.count)>0){
      reads.set(bv,at);continue
    }
    if(event.kind!=='provisional_fish_reaction'||event.subjective!==true||!reads.has(bv)||reads.get(bv)>at||at-reads.get(bv)>60*60_000)continue
    if(!['curious','amused','skeptical','neutral','none'].includes(event.reaction)||event.reaction==='none')continue
    // The initial observation was generated by a tool after verified reading;
    // never claim that the model's subjective question is a verified fact.
    rows.push({id:ident(bv,event.at),bvid:bv,at:event.at,source:'discussion-read',
      reaction:event.reaction,question:clean(event.question,80),verifiedRead:true,subjective:true})
  }
  return rows.slice(-24).reverse()
}
export function createLifeOpportunities({stateDir,getCredential,getInterestEvidence=()=>[],getPublicPersonEvidence=()=>[],now=Date.now,onChange=()=>{}}={}){
  if(!stateDir||typeof getCredential!=='function')throw TypeError('生活契机依赖缺失')
  const account=()=>discussionAccountTag(getCredential())
  let sourceWarnings=[]
  // All writes below are synchronized on the SAME v1 ledger. A collision
  // returns an explicit technical failure; it is not a voluntary defer or a
  // successful platform read. The caller may retry only after checking state.
  const mutate=fn=>{
    const result=withLifeOpportunityLedgerLock(stateDir,fn,{now})
    return result?.ok===false&&typeof result.reason==='string'
      ?{ok:false,error:result.reason}:result
  }
  const sourceRows=(getter,key,label)=>{
    try{const rows=getter(key);if(!Array.isArray(rows))throw Error('not-an-array');return rows}
    catch{sourceWarnings.push(label+' 资料不可用');return []}
  }
  const observations=()=>{
    sourceWarnings=[]
    const key=account();if(!key)return []
    const r=readVideoDiscussionDiagnostics({stateDir,credential:getCredential(),now:new Date(now()),limit:100,days:7})
    // The diagnostic reader returns only verified, account-filtered metadata.
    if(!r.accountReady)return []
    const discussion=deriveDiscussionOpportunities(r.events,now())
    const sourcedInterests=sourceRows(getInterestEvidence,key,'兴趣')
    const interest=sourcedInterests.filter(x=>x?.source==='interest-milestone'&&
      /^[\p{L}\p{N}／ _-]{2,36}$/u.test(String(x.topic||''))&&!unsafePublicTopic(x.topic)&&VALID_BV.test(x.bvid)&&
      ['emerging','growing','stable'].includes(x.stage)&&Number(x.evidenceCount)>=3&&Number(x.evidenceDays)>=2&&
      boundedTime(x.at)>now()-14*DAY&&boundedTime(x.at)<=now()).slice(0,8)
      .map(x=>({id:createHash('sha256').update('interest:'+x.topic+':'+x.stage).digest('hex').slice(0,24),
        source:x.source,topic:x.topic,stage:x.stage,at:x.at,bvid:x.bvid,evidenceCount:x.evidenceCount,
        evidenceDays:x.evidenceDays,verifiedRead:false,subjective:false}))
    const curiosity=sourcedInterests.filter(x=>x?.source==='selection-curiosity'&&
      /^[\p{L}\p{N}／ _-]{3,40}$/u.test(String(x.topic||''))&&!unsafePublicTopic(x.topic)&&
      VALID_BV.test(x.bvid)&&x.stage==='curious'&&
      boundedTime(x.at)>now()-14*DAY&&boundedTime(x.at)<=now()).slice(0,8)
      .map(x=>({id:createHash('sha256').update('curiosity:'+x.bvid+':'+x.at).digest('hex').slice(0,24),
        source:'selection-curiosity',topic:x.topic,at:x.at,bvid:x.bvid,
        verifiedRead:false,subjective:true}))
    const people=sourceRows(getPublicPersonEvidence,key,'公开交流').filter(x=>x?.source==='public-person-observation'&&
      /^[a-f0-9]{24}$/.test(String(x.personKey||''))&&Number(x.evidenceCount)>=2&&Number(x.evidenceDays)>=2&&
      Number.isFinite(x.at)&&x.at>now()-14*DAY&&x.at<=now()).slice(0,6)
      .map(x=>({id:createHash('sha256').update('person:'+x.personKey).digest('hex').slice(0,24),
        personKey:x.personKey,source:x.source,at:new Date(x.at).toISOString(),bvid:'',
        evidenceCount:x.evidenceCount,evidenceDays:x.evidenceDays,verifiedRead:false,subjective:false}))
    return [...discussion,...interest,...curiosity,...people].sort((a,b)=>boundedTime(b.at)-boundedTime(a.at)).slice(0,30)
  }
  const list=({includeClosed=false,limit=6}={})=>{
    const key=account();if(!key)return []
    const prior=read(stateDir,key)
    const last=new Map(prior.decisions.map(d=>[d.id,d]))
    const out=observations().map(o=>{
      const d=last.get(o.id),nextAt=Number(d?.nextAt)||0
      return {...o,status:d?.action||'pending',result:d?.result||'',reason:d?.reason||'',
        title:d?.title||'',lastAt:d?.at||0,nextAt,failures:d?.failures||0,failureCode:d?.failureCode||'',
        eligible:!d||((d.action==='skip'||d.action==='defer'||d.action==='error')&&nextAt<=now())}
    })
    return (includeClosed?out:out.filter(x=>x.eligible)).slice(0,Math.max(1,Math.min(30,limit)))
  }
  const decide=(id,action,{reason='',result='',title='',failureCode=''}={})=>mutate(()=>{
    const key=account()
    if(!key)return {ok:false,error:'当前账号未就绪'}
    if(!ACTIONS.has(action))return {ok:false,error:'无效的生活契机动作'}
    const current=observations().find(x=>x.id===id)
    if(!current)return {ok:false,error:'生活契机不存在或证据已过期'}
    const prior=read(stateDir,key),before=prior.decisions.find(x=>x.id===id)
    if(before&&['inspect','review','dismiss'].includes(before.action))return {ok:false,error:'该生活契机已经结束'}
    if(before&&Number(before.nextAt)>now())return {ok:false,error:'尚未到下一次考虑时间'}
    const failures=action==='error'?Math.min(3,Math.max(0,Number(before?.failures)||0)+1):0
    const delay=action==='error'?ERROR_RETRY_MS[failures-1]:action==='defer'?2*DAY:action==='skip'?DAY:0
    const row={id,source:current.source,bvid:current.bvid,topic:current.topic||'',at:now(),action,result:clean(result,36),
      reason:clean(reason,100),title:clean(title,100),nextAt:delay?now()+delay:0,
      ...(action==='error'?{failures,failureCode:ERROR_CODES.has(failureCode)?failureCode:'metadata-api-error'}:{})}
    prior.decisions=[...prior.decisions.filter(x=>x.id!==id),row].slice(-100)
    write(stateDir,key,prior);try{onChange()}catch{}
    return {ok:true,...row}
  })
  const recentReads=({limit=3}={})=>{
    const key=account();if(!key)return []
    const cutoff=now()-7*DAY,ledger=read(stateDir,key)
    const observed=ledger.decisions.filter(x=>x.action==='inspect'&&x.result==='verified-metadata'&&
      x.at>=cutoff&&VALID_BV.test(x.bvid)&&x.title)
      .map(x=>({bvid:x.bvid,title:x.title,topic:x.topic||'',at:x.at,source:x.source,scope:'video-metadata-only'}))
    const explored=ledger.intentions.filter(x=>
      Number(x.metadataAt||((x.status==='inspected'&&x.receipt==='verified-metadata')?x.lastAt:0))>=cutoff&&
      VALID_BV.test(x.selectedBvid)&&x.selectedTitle)
      .map(x=>({bvid:x.selectedBvid,title:x.selectedTitle,topic:x.topic,
        at:Number(x.metadataAt||x.lastAt),source:'fish-life-intent',scope:'video-metadata-only'}))
    return [...observed,...explored].sort((a,b)=>b.at-a.at).slice(0,Math.max(1,Math.min(3,limit)))
  }
  // Interest evidence is a source of information, not a pre-assigned task.
  // A dismissed source stays dismissed; a recently explored source cools down.
  const explorationCues=({limit=4}={})=>{
    const key=account();if(!key)return []
    const ledger=read(stateDir,key),dismissed=new Set(ledger.decisions.filter(x=>x.action==='dismiss').map(x=>x.id))
    const blockedErrors=new Set(ledger.decisions.filter(x=>
      (x.action==='error'&&Number(x.nextAt)>now())||
      (['defer','skip'].includes(x.action)&&Number(x.nextAt)>now())).map(x=>x.id))
    const cooledCues=new Set(ledger.cueFailures.filter(x=>Number(x.nextAt)>now()).map(x=>x.id))
    const recent=new Set(ledger.intentions.filter(x=>Number(x.at)>now()-3*DAY).map(x=>x.sourceId))
    return observations().filter(x=>!dismissed.has(x.id)&&!blockedErrors.has(x.id)&&!cooledCues.has(x.id)&&!recent.has(x.id)&&
      (x.source==='interest-milestone'||x.source==='selection-curiosity'||(x.source==='discussion-read'&&
      ['curious','skeptical'].includes(x.reaction)&&x.question?.length>=4)))
      .slice(0,Math.max(1,Math.min(6,limit))).map(x=>({id:x.id,source:x.source,topic:x.topic||'',
        bvid:['discussion-read','selection-curiosity'].includes(x.source)?x.bvid:'',reaction:x.reaction||'',stage:x.stage,
        evidenceCount:x.evidenceCount,evidenceDays:x.evidenceDays}))
  }
  // One account-scoped continuation ledger for model-elected public exploration.
  // It is NOT a TODO, a friendship record or permission to send anything.
  const episodeView=x=>({...x,creatorUid:undefined,
    episodeSteps:Math.max(1,Math.min(EPISODE_MAX_STEPS,Number.isSafeInteger(x.episodeSteps)?x.episodeSteps:1)),
    episodeMaxSteps:EPISODE_MAX_STEPS,
    // Every action is source-backed; these are bounded receipts, never arbitrary chat text.
    episodeHistory:(Array.isArray(x.episodeHistory)?x.episodeHistory:[]).filter(y=>
      y&&['browse-home','search','inspect-public-person','inspect-video','inspect-creator-space','inspect-video-discussion','browse-home-more','life-write-verified'].includes(y.action)&&
      Number.isFinite(Number(y.at))&&Number(y.at)>0).slice(-EPISODE_MAX_STEPS).map(y=>({action:y.action,at:Number(y.at),
        ...(VALID_BV.test(String(y.bvid||''))?{bvid:y.bvid}:{}),...(typeof y.writeAction==='string'&&
        ['like_video','collect_video','follow_creator','comment_video'].includes(y.writeAction)?{writeAction:y.writeAction}:{})})),
    homeRefreshCount:Number.isSafeInteger(x.homeRefreshCount)?Math.min(1,Math.max(0,x.homeRefreshCount)):0,
    writeAftercare:['read-or-rest','resting','read-verified'].includes(x.writeAftercare)?x.writeAftercare:'none',
    writeNextEligibleAt:Number.isFinite(Number(x.writeNextEligibleAt))?Math.max(0,Number(x.writeNextEligibleAt)):0,
    visitedBvids:[...new Set((Array.isArray(x.visitedBvids)?x.visitedBvids:[]).filter(v=>VALID_BV.test(String(v||''))))].slice(0,EPISODE_MAX_VIDEOS),
    discussionReadBvids:[...new Set((Array.isArray(x.discussionReadBvids)?x.discussionReadBvids:[]).filter(v=>VALID_BV.test(String(v||''))))].slice(0,EPISODE_MAX_VIDEOS),
    creatorExploredBvids:[...new Set((Array.isArray(x.creatorExploredBvids)?x.creatorExploredBvids:[]).filter(v=>VALID_BV.test(String(v||''))))].slice(0,EPISODE_MAX_VIDEOS),
    videos:(x.videos||[]).map(v=>({...v})),creatorVideos:(x.creatorVideos||[]).map(v=>({...v}))})
  const intentions=({includeClosed=false,limit=6}={})=>{
    const key=account();if(!key)return []
    const data=read(stateDir,key)
    return data.intentions.filter(x=>Number(x.expiresAt)>now()&&
      (includeClosed||(['ready','inspected'].includes(x.status)&&Number(x.nextAt||0)<=now()&&
        Number(x.episodeSteps||1)<Number(x.episodeMaxSteps||EPISODE_MAX_STEPS)))).sort((a,b)=>b.at-a.at)
      .slice(0,Math.max(1,Math.min(20,limit))).map(episodeView)
  }
  // A verified video does not end the possibility of exploring its creator.
  // The model may ignore it; the UID is never surfaced to the model or UI.
  const continuations=({limit=6}={})=>{
    const key=account();if(!key)return []
    // Revoking a person's public evidence also removes any downstream Life
    // exploration from the active menu, without resurrecting their UID.
    const activePublicSources=new Set(observations().filter(x=>x.source==='public-person-observation').map(x=>x.id))
    return read(stateDir,key).intentions.filter(x=>
      (x.source!=='public-person-observation'||activePublicSources.has(x.sourceId))&&
      Number(x.expiresAt)>now()&&Number(x.nextAt||0)<=now()&&
      ['ready','inspected'].includes(x.status)&&
      Number(x.episodeSteps||1)<Number(x.episodeMaxSteps||EPISODE_MAX_STEPS))
      .sort((a,b)=>b.at-a.at).slice(0,Math.max(1,Math.min(20,limit)))
      .map(x=>({...episodeView(x),
        // Never disclose a stored creator identifier to the planning model.
        creatorUid:undefined}))
  }
  const inAccount=expected=>!expected||expected===account()
  const sourceCooling=(store,sourceId)=>store.intentions.some(x=>x.sourceId===sourceId&&Number(x.at)>now()-3*DAY)
  const videoRows=rows=>[...new Map((Array.isArray(rows)?rows:[]).filter(x=>VALID_BV.test(x?.bvid)&&clean(x?.title,85))
    .slice(0,10).map(x=>[x.bvid,{bvid:x.bvid,title:clean(x.title,85)}])).values()].slice(0,5)
  const initializeEpisode=(entry,{steps=1,visited=[]}={})=>{
    entry.episodeSteps=Math.max(1,Math.min(EPISODE_MAX_STEPS,Number(steps)||1))
    entry.episodeMaxSteps=EPISODE_MAX_STEPS
    entry.episodeStatus='active'
    entry.episodeStartedAt=Number(entry.at)||now()
    entry.episodeLastAt=Number(entry.lastAt)||now()
    entry.visitedBvids=[...new Set(visited.filter(v=>VALID_BV.test(String(v||''))))].slice(0,EPISODE_MAX_VIDEOS)
    entry.creatorExploredBvids=[]
    entry.discussionReadBvids=[]
    entry.homeRefreshCount=0
    entry.writeAftercare='none'
    entry.writeNextEligibleAt=0
    entry.episodeHistory=[{action:entry.lastAction||'browse-home',at:now(),
      ...(VALID_BV.test(String(entry.selectedBvid||''))?{bvid:entry.selectedBvid}:{}),
      ...(clean(entry.selectedTitle,85)?{title:clean(entry.selectedTitle,85)}:{})}]
    return entry
  }
  const addEpisodeStep=(entry,action,{bvid='',title='',creatorUid='',writeAction=''}={})=>{
    entry.episodeHistory=[...(Array.isArray(entry.episodeHistory)?entry.episodeHistory:[]),{action,at:now(),
      ...(VALID_BV.test(String(bvid||''))?{bvid}:{}),
      ...(clean(title,85)?{title:clean(title,85)}:{}),
      ...(validUid(creatorUid)?{creatorUid:String(creatorUid)}:{}),
      ...(['like_video','collect_video','follow_creator','comment_video'].includes(writeAction)?{writeAction}:{})}].slice(-EPISODE_MAX_STEPS)
    // A VERIFIED read is the only same-Episode way to regain future write
    // eligibility without a separately recorded, time-bounded voluntary rest.
    if(entry.writeAftercare==='read-or-rest'&&['inspect-video','inspect-creator-space','inspect-video-discussion','browse-home-more'].includes(action))
      entry.writeAftercare='read-verified'
    entry.episodeSteps=Math.min(EPISODE_MAX_STEPS,Math.max(1,Number(entry.episodeSteps)||1)+1)
    entry.episodeLastAt=now();entry.lastAt=now();entry.lastAction=action
    if(entry.episodeSteps>=EPISODE_MAX_STEPS){entry.status='completed';entry.episodeStatus='completed';entry.receipt='episode-step-limit'}
  }
  // Comment reactions remain subjective; only the same already-read BV's public
  // metadata may supply facts. This does not turn a question into a task.
  const beginVideoExploration=(sourceId,goal,verified,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const source=explorationCues({limit:6}).find(x=>x.id===sourceId&&['discussion-read','selection-curiosity'].includes(x.source))
    if(!source||!validLifeExplorationGoal(goal))return {ok:false,error:'评论来源或自主意愿不合规'}
    if(verified?.ok!==true||verified.bvid!==source.bvid||!clean(verified.title,85))return {ok:false,error:'未核实同 BV 公开资料'}
    const store=read(stateDir,key)
    if(sourceCooling(store,source.id))return {ok:false,error:'相同评论线索仍在冷却'}
    const at=now(),id=createHash('sha256').update('fish-comment-exploration:'+source.id+':'+at).digest('hex').slice(0,24)
    const entry=initializeEpisode({id,sourceId:source.id,source:source.source,topic:source.source==='selection-curiosity'?source.topic:'',goal:clean(goal,100),status:'ready',at,nextAt:at,
      expiresAt:at+14*DAY,videos:[{bvid:source.bvid,title:clean(verified.title,85)}],receipt:'verified-metadata',
      lastAction:'inspect-video',lastAt:at,metadataAt:at,selectedBvid:source.bvid,selectedTitle:clean(verified.title,85),
      creatorExplored:false,creatorVideos:[]},{steps:1,visited:[source.bvid]})
    store.intentions=[...store.intentions,entry].slice(-20)
    store.cueFailures=store.cueFailures.filter(x=>x.id!==sourceId)
    write(stateDir,key,store);try{onChange()}catch{}
    return {ok:true,id,receipt:entry.receipt,videoCount:1}
  })
  // All video-entry producers share this exact account-bound Episode writer.
  // Source-specific authenticated receipts are validated BEFORE reaching it.
  function registerVideoEpisode(store,key,{source,sourceId,bvid,title,goal,idSalt}){
    const observation=verifiedVideoObservation({source:source==='inspected-opportunity'?'life-opportunity':
      source==='completed-video-todo'?'life-todo':source,
      sourceId,bvid,title,accountTag:key,at:now()})
    if(!observation.ok)return {ok:false,error:'视频观察证据不合规'}
    const existing=store.intentions.find(x=>x.source===source&&x.sourceId===sourceId)
    if(existing)return {ok:true,id:existing.id,created:false,receipt:existing.receipt}
    const at=now(),id=createHash('sha256').update(idSalt+key+':'+sourceId).digest('hex').slice(0,24)
    const entry=initializeEpisode({id,sourceId,source,topic:'',goal,status:'ready',at,nextAt:at,
      expiresAt:at+14*DAY,videos:[{bvid,title:clean(title,85)}],receipt:'verified-metadata',
      lastAction:'inspect-video',lastAt:at,metadataAt:at,selectedBvid:bvid,
      selectedTitle:clean(title,85),creatorExplored:false,creatorVideos:[]},
      {steps:1,visited:[bvid]})
    store.intentions=[...store.intentions,entry].slice(-20)
    write(stateDir,key,store);try{onChange()}catch{}
    return {ok:true,id,created:true,receipt:entry.receipt}
  }
  // A first-model choice to read a specific video outside the generic TODO
  // entrypoint is equally eligible, but only after the actual read is proven.
  const beginVideoObservation=(observation,expectedAccount='')=>mutate(()=>{
    const key=account()
    if(!key||!inAccount(expectedAccount)||observation?.accountTag!==key||
      !['social-read-now','owner-dm-read'].includes(observation?.source)||
      observation?.ok!==true||now()-observation.at>10*60_000||observation.at>now()+60_000)
      return {ok:false,error:'视频读取来源、账号或时间未核验'}
    return registerVideoEpisode(read(stateDir,key),key,{source:observation.source,
      sourceId:createHash('sha256').update('verified-video:'+key+':'+observation.source+':'+observation.sourceId).digest('hex').slice(0,24),
      bvid:observation.bvid,title:observation.title,
      goal:'接着刚才自主选择了解的公开视频继续考虑',idSalt:'fish-unified-observation:'})
  })
  // A Life-elected inspection is not merely a wake signal: its canonical
  // VERIFIED opportunity decision can seed the existing optional continuation
  // menu. No further external action occurs without another Life model choice.
  const beginInspectedOpportunity=(sourceId,proof,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const source=observations().find(x=>x.id===sourceId&&x.source!=='public-person-observation')
    const store=read(stateDir,key),decision=store.decisions.find(x=>x.id===sourceId)
    if(!source||decision?.action!=='inspect'||decision.result!=='verified-metadata'||
      !VALID_BV.test(String(source.bvid||''))||decision.bvid!==source.bvid||
      proof?.ok!==true||proof.bvid!==source.bvid||!clean(proof.title,85)||
      clean(proof.title,85)!==clean(decision.title,85)||
      !Number.isSafeInteger(decision.at)||decision.at<=0||
      decision.at>now()+60_000||now()-decision.at>10*60_000)return {ok:false,error:'缺少同账号本次公开资料核验回执'}
    return registerVideoEpisode(store,key,{source:'inspected-opportunity',sourceId,
      bvid:source.bvid,title:proof.title,goal:'沿着本轮主动核实的公开视频继续了解',
      idSalt:'fish-inspected-opportunity:'})
  })
  // Only a completed LIFE-CHOSEN read-only watch TODO with an exact video
  // receipt may offer a further decision. TODO success alone (or merely a BV
  // in the task) is not evidence of a video read.
  const beginCompletedVideoTodo=(todo,proof,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    if(!todo||todo.type!=='watch_video'||typeof todo.id!=='string'||
      !/^[0-9a-f-]{36}$/i.test(todo.id)||!VALID_BV.test(String(todo.bvid||''))||
      proof?.ok!==true||proof.bvid!==todo.bvid||!clean(proof.title,85)||
      !Number.isSafeInteger(proof.completedAt)||proof.completedAt<=0||
      proof.completedAt>now()+60_000||now()-proof.completedAt>10*60_000)
      return {ok:false,error:'没有同待办的可信视频完成与读取回执'}
    const store=read(stateDir,key)
    const sourceId=createHash('sha256').update('fish-life-todo:'+key+':'+todo.id).digest('hex').slice(0,24)
    return registerVideoEpisode(store,key,{source:'completed-video-todo',sourceId,
      bvid:proof.bvid,title:proof.title,goal:'接着本轮自主完成的视频了解继续考虑',
      idSalt:'fish-completed-video-todo:'})
  })
  // A failed metadata read during a *new voluntary exploration* is not
  // the result of the earlier opportunity inspection. The two decisions have
  // separate lifecycles in the SAME account-scoped v1 ledger. This is important
  // for previously inspected observations that are still valid life cues.
  const failExplorationCueRead=(sourceId,failureCode,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const source=observations().find(x=>x.id===sourceId&&
      (x.source==='interest-milestone'||x.source==='selection-curiosity'||x.source==='discussion-read'&&
      ['curious','skeptical'].includes(x.reaction)&&x.question?.length>=4))
    if(!source)return {ok:false,error:'原评论证据已经过期，不登记新的错误'}
    const store=read(stateDir,key),prior=store.cueFailures.find(x=>x.id===sourceId)
    if(prior&&Number(prior.nextAt)>now())
      return {ok:false,error:'这条探索来源尚在读取冷却期'}
    if(sourceCooling(store,sourceId))return {ok:false,error:'已有同来源自主探索，不重复读取'}
    const failures=Math.min(CUE_RETRY_LIMIT,(prior?.failures||0)+1)
    const row={id:sourceId,at:now(),failures,
      nextAt:now()+ERROR_RETRY_MS[failures-1],
      failureCode:ERROR_CODES.has(failureCode)?failureCode:'metadata-api-error'}
    store.cueFailures=[...store.cueFailures.filter(x=>x.id!==sourceId),row].slice(-40)
    write(stateDir,key,store);try{onChange()}catch{}
    return {ok:true,failures,nextAt:row.nextAt,paused:false,code:row.failureCode}
  })
  // Only an existing, account-proven interest topic may be used as a public
  // search keyword. The model supplies its *purpose*, never an untrusted query.
  const beginExploration=(sourceId,goal,searchResult,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const source=explorationCues({limit:6}).find(x=>x.id===sourceId&&x.source==='interest-milestone')
    if(!source)return {ok:false,error:'缺少当前账号可信兴趣证据'}
    const purpose=clean(goal,100)
    if(!validLifeExplorationGoal(purpose))return {ok:false,error:'探索意愿含敏感内容或不完整'}
    if(searchResult?.ok!==true||searchResult.topic!==source.topic)return {ok:false,error:'搜索无匹配的真实回执'}
    const videos=(Array.isArray(searchResult.videos)?searchResult.videos:[]).filter(x=>VALID_BV.test(x?.bvid))
      .slice(0,5).map(x=>({bvid:x.bvid,title:clean(x.title,85)}))
    if(!videos.length)return {ok:false,error:'公开搜索没有可信 BV 结果'}
    const store=read(stateDir,key)
    if(store.intentions.some(x=>x.topic===source.topic&&x.source==='interest-milestone'&&['ready','inspected'].includes(x.status)&&x.expiresAt>now()))return {ok:false,error:'同一线索已有未完成的自主探索'}
    const at=now(),id=createHash('sha256').update('fish-exploration:'+sourceId+':'+at).digest('hex').slice(0,24)
    const entry=initializeEpisode({id,sourceId,source:source.source,topic:source.topic,goal:purpose,status:'ready',
      at,nextAt:at,expiresAt:at+14*DAY,videos,receipt:'verified-search-results',
      lastAction:'search',lastAt:at,selectedBvid:'',selectedTitle:''})
    store.intentions=[...store.intentions,entry].slice(-20);write(stateDir,key,store);try{onChange()}catch{}
    return {ok:true,id,receipt:entry.receipt,videoCount:videos.length}
  })
  // A completed Life-owned home-browse round can seed the SAME intention
  // ledger. The input must come from the host's new picked rows; each BV is
  // re-read from the platform before any deeper action. Picked != watched.
  const beginHomeExploration=(roundId,pickedVideos,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    if(!/^[a-f0-9]{24}$/.test(String(roundId||''))||!Array.isArray(pickedVideos))return {ok:false,error:'首页轮次或候选格式无效'}
    const videos=videoRows(pickedVideos.filter(x=>x?.picked===true))
    if(!videos.length)return {ok:false,error:'本轮没有真实入选的视频'}
    const store=read(stateDir,key),existing=store.intentions.find(x=>x.source==='home-browse'&&x.sourceId===roundId)
    if(existing)return {ok:true,id:existing.id,created:false,receipt:existing.receipt,videoCount:existing.videos?.length||0}
    const at=now(),id=createHash('sha256').update('fish-home-episode:'+roundId).digest('hex').slice(0,24)
    const entry=initializeEpisode({id,sourceId:roundId,source:'home-browse',topic:'',goal:'沿着刚才首页偶然刷到的作品继续了解',
      status:'ready',at,nextAt:at,expiresAt:at+14*DAY,videos,receipt:'verified-home-picks',
      lastAction:'browse-home',lastAt:at,selectedBvid:'',selectedTitle:'',creatorExplored:false,creatorVideos:[]})
    store.intentions=[...store.intentions,entry].slice(-20);write(stateDir,key,store);try{onChange()}catch{}
    return {ok:true,id,created:true,receipt:entry.receipt,videoCount:videos.length,episodeSteps:entry.episodeSteps,episodeMaxSteps:entry.episodeMaxSteps}
  })
  // Reuse this account's existing intentions and opportunity decisions.
  // No second person graph, no stored UID, and no implied right to contact.
  const beginPublicPersonExploration=(sourceId,portfolio,expectedAccount='',reason='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const source=observations().find(x=>x.id===sourceId&&x.source==='public-person-observation')
    if(!source||portfolio?.ok!==true||portfolio.personKey!==source.personKey)
      return {ok:false,error:'公开人物契机或身份核验已失效'}
    const videos=videoRows(portfolio.videos)
    if(!videos.length)return {ok:false,error:'人物公开投稿没有可信 BV'}
    const store=read(stateDir,key),prior=store.decisions.find(x=>x.id===sourceId)
    if(prior&&(['inspect','review','dismiss'].includes(prior.action)||Number(prior.nextAt)>now()))
      return {ok:false,error:'契机已处理或仍在冷却'}
    if(sourceCooling(store,sourceId))return {ok:false,error:'同一公开人物契机已经在探索'}
    const at=now(),id=createHash('sha256').update('fish-public-person:'+sourceId+':'+at).digest('hex').slice(0,24)
    const entry=initializeEpisode({id,sourceId,source:'public-person-observation',topic:'',
      goal:'了解真实公开互动中遇到的人的公开作品',status:'ready',at,nextAt:at,
      expiresAt:at+14*DAY,videos,receipt:'verified-public-portfolio',lastAction:'inspect-public-person',
      lastAt:at,selectedBvid:'',selectedTitle:'',creatorExplored:false,creatorVideos:[]})
    store.intentions=[...store.intentions,entry].slice(-20)
    store.decisions=[...store.decisions.filter(x=>x.id!==sourceId),
      {id:sourceId,source:source.source,bvid:'',topic:'',at,action:'inspect',
       result:'verified-public-portfolio',reason:clean(reason,100),title:'',nextAt:0}].slice(-100)
    write(stateDir,key,store);try{onChange()}catch{}
    return {ok:true,id,receipt:entry.receipt,videoCount:videos.length}
  })
  const completeExploration=(id,bvid,result,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const store=read(stateDir,key),entry=store.intentions.find(x=>x.id===id&&['ready','inspected'].includes(x.status)&&x.expiresAt>now())
    const visited=new Set(Array.isArray(entry?.visitedBvids)?entry.visitedBvids:[])
    if(!entry||entry.episodeStatus==='review'||Number(entry.episodeSteps||1)>=EPISODE_MAX_STEPS||
      entry.source==='public-person-observation'&&!observations().some(x=>x.id===entry.sourceId&&x.source==='public-person-observation')||
      ![...(entry.videos||[]),...(entry.creatorVideos||[])].some(x=>x.bvid===bvid)||visited.has(bvid))
      return {ok:false,error:'自主探索的候选证据不存在、已读或公开人物证据已撤销'}
    if(result?.ok!==true||result.bvid!==bvid||!clean(result.title,100))return {ok:false,error:'没有取得同一 BV 的真实核实回执'}
    entry.selectedBvid=bvid;entry.selectedTitle=clean(result.title,100);entry.metadataAt=now()
    entry.visitedBvids=[...visited,bvid].slice(-EPISODE_MAX_VIDEOS)
    entry.creatorExplored=Array.isArray(entry.creatorExploredBvids)&&entry.creatorExploredBvids.includes(bvid)
    addEpisodeStep(entry,'inspect-video',{bvid,title:entry.selectedTitle});entry.receipt=entry.episodeStatus==='completed'?'episode-step-limit':'verified-metadata'
    if(entry.status!=='completed')entry.status='inspected'
    write(stateDir,key,store);try{onChange()}catch{}
    return {ok:true,id,receipt:entry.receipt}
  })
  const failExplorationRead=(id,bvid,expectedAccount='',failureCode='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const store=read(stateDir,key),entry=store.intentions.find(x=>x.id===id&&['ready','inspected'].includes(x.status)&&x.expiresAt>now())
    if(!entry||![...(entry.videos||[]),...(entry.creatorVideos||[])].some(x=>x.bvid===bvid))return {ok:false,error:'意愿或视频证据不存在'}
    entry.receipt='metadata-read-failed';entry.lastAction='inspect-failed';entry.lastAt=now()
    entry.metadataFailures=Math.min(3,Math.max(0,Number(entry.metadataFailures)||0)+1)
    entry.metadataFailureCode=ERROR_CODES.has(failureCode)?failureCode:'metadata-api-error'
    entry.nextAt=now()+ERROR_RETRY_MS[entry.metadataFailures-1]
    // The third failed read is a six-hour cooling period, never a terminal
    // state. A healthy platform may recover without a manual ledger edit.
    write(stateDir,key,store);try{onChange()}catch{}
    return {ok:true,id,receipt:entry.receipt}
  })
  const abandonExploration=(id,reason='',expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const store=read(stateDir,key),entry=store.intentions.find(x=>x.id===id&&['ready','inspected'].includes(x.status)&&x.expiresAt>now())
    if(!entry)return {ok:false,error:'自主探索不存在或已结束'}
    entry.status='abandoned';entry.episodeStatus='completed';entry.receipt='fish-chose-to-stop';entry.lastAction='abandon';entry.lastAt=now();entry.episodeLastAt=now();entry.reason=clean(reason,100)
    write(stateDir,key,store);try{onChange()}catch{};return {ok:true,id,receipt:entry.receipt}
  })
  const pauseExploration=(id,delayMs=60*60_000,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const store=read(stateDir,key),entry=store.intentions.find(x=>x.id===id&&['ready','inspected'].includes(x.status)&&x.expiresAt>now())
    if(!entry)return {ok:false,error:'自主探索不存在或已结束'}
    const delay=Math.max(15*60_000,Math.min(6*60*60_000,Number(delayMs)||60*60_000))
    entry.nextAt=now()+delay;entry.lastAt=now();entry.episodeLastAt=now();entry.lastAction='episode-rest';entry.receipt='fish-chose-rest'
    if(entry.writeAftercare==='read-or-rest'){
      // Rest is explicit and durable, not an implicit permission to post.
      entry.writeAftercare='resting'
      entry.writeNextEligibleAt=Math.max(Number(entry.writeNextEligibleAt||0),entry.nextAt)
    }
    write(stateDir,key,store);try{onChange()}catch{};return {ok:true,id,nextAt:entry.nextAt}
  })
  const inspectCreatorSpace=(id,proof,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const store=read(stateDir,key),entry=store.intentions.find(x=>x.id===id&&
      ['ready','inspected'].includes(x.status)&&x.expiresAt>now()&&x.selectedBvid&&
      !(Array.isArray(x.creatorExploredBvids)?x.creatorExploredBvids:[]).includes(x.selectedBvid)&&
      Number(x.episodeSteps||1)<EPISODE_MAX_STEPS&&Number(x.nextAt||0)<=now())
    if(!entry)return {ok:false,error:'没有可继续了解的已核实视频'}
    const uid=String(proof?.creatorUid||'')
    if(proof?.ok!==true||proof.bvid!==entry.selectedBvid||!(/^[1-9]\d{0,18}$/.test(uid))||
       String(proof.accountUid)!==String(getCredential()?.dedeuserid||''))return {ok:false,error:'公开作者归属核验不一致'}
    const videos=videoRows(proof.videos)
    if(!videos.length)return {ok:false,error:'没有获得可信的公开投稿 BV'}
    entry.creatorExploredBvids=[...new Set([...(Array.isArray(entry.creatorExploredBvids)?entry.creatorExploredBvids:[]),entry.selectedBvid])].slice(-EPISODE_MAX_VIDEOS)
    entry.creatorExplored=true;entry.creatorUid=uid;entry.creatorVideos=[...new Map([...(entry.creatorVideos||[]),...videos].map(v=>[v.bvid,v])).values()].slice(0,EPISODE_MAX_VIDEOS)
    addEpisodeStep(entry,'inspect-creator-space',{bvid:entry.selectedBvid,title:entry.selectedTitle,creatorUid:uid});if(entry.status!=='completed')entry.status='ready';entry.nextAt=now()
    entry.receipt=entry.episodeStatus==='completed'?'episode-step-limit':'verified-creator-videos'
    // UID is stored only for the owner's local diary; model-facing episodeView strips it.
    // Never use it to grant DM or follow authorization.
    write(stateDir,key,store);try{onChange()}catch{}
    return {ok:true,id,receipt:entry.receipt,videoCount:videos.length}
  })
  // Persist only action class + verified/uncertain status in the existing
  // account-bound intention ledger. Platform proof and dedup stay in their
  // original Python/host stores; never store comment text, UID or model prose.
  const recordExplorationWrite=(id,action,bvid,status,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    if(!['like_video','collect_video','follow_creator','comment_video'].includes(action)||
       !VALID_BV.test(String(bvid||''))||!['verified','uncertain'].includes(status))
      return {ok:false,error:'外部动作回执无效'}
    const store=read(stateDir,key),entry=store.intentions.find(x=>x.id===id&&
      ['ready','inspected'].includes(x.status)&&x.expiresAt>now()&&x.selectedBvid===bvid)
    if(!entry||entry.episodeStatus==='review'||Number(entry.episodeSteps||1)>=EPISODE_MAX_STEPS||
      Number(entry.nextAt||0)>now())return {ok:false,error:'意愿已失效或当前需要休息'}
    if(!['read-verified','resting','none'].includes(entry.writeAftercare||'none')||
      now()<Number(entry.writeNextEligibleAt||0))return {ok:false,error:'上次已核验写入后需先只读探索或实际休息，并满足原跨渠道冷却'}
    if(!Array.isArray(entry.writeOutcomes))entry.writeOutcomes=[]
    if(entry.writeOutcomes.some(x=>x.action===action&&x.bvid===bvid))return {ok:false,error:'同一动作已有回执或结果未知'}
    entry.writeOutcomes=[...entry.writeOutcomes,{action,bvid,status,at:now()}].slice(-8)
    if(status==='uncertain'){
      entry.status='review';entry.episodeStatus='review';entry.receipt='write-unverified';entry.lastAt=now();entry.lastAction='life-write-uncertain'
    }else{
      addEpisodeStep(entry,'life-write-verified',{bvid,writeAction:action})
      // One successful write is a step, NOT the end of a whole Life Episode.
      // Another write requires a new voluntary read OR an elapsed real rest,
      // and can never follow immediately in the same planner turn.
      entry.writeAftercare='read-or-rest'
      entry.writeNextEligibleAt=now()+30_000
      entry.receipt=entry.episodeStatus==='completed'?'episode-step-limit':'verified-platform-write'
      if(entry.status!=='completed')entry.status='inspected'
    }
    write(stateDir,key,store);try{onChange()}catch{}
    return {ok:true,id,receipt:status==='verified'?'verified-platform-write':'write-unverified'}
  })
  // Reading a verified BV's public discussion is a valid Life step even
  // without an intention to publish. Persist only BV and count, never texts,
  // authors, rpid or inferred attitudes. Failure/partial response does not
  // manufacture a completed read and cannot unlock a second write.
  const inspectVideoDiscussion=(id,receipt,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const store=read(stateDir,key),entry=store.intentions.find(x=>x.id===id&&
      ['ready','inspected'].includes(x.status)&&x.expiresAt>now()&&
      entryCanReadDiscussion(x,now()))
    if(!entry)return {ok:false,error:'没有可核实的未读视频评论区'}
    if(receipt?.ok!==true||receipt?.verified!==true||receipt.bvid!==entry.selectedBvid||
      !Number.isSafeInteger(receipt.count)||receipt.count<0||receipt.count>10)
      return {ok:false,error:'评论区真实读取回执不完整'}
    const bv=entry.selectedBvid
    entry.discussionReadBvids=[...(Array.isArray(entry.discussionReadBvids)?entry.discussionReadBvids:[]),bv].slice(-EPISODE_MAX_VIDEOS)
    addEpisodeStep(entry,'inspect-video-discussion',{bvid:bv,title:entry.selectedTitle})
    entry.receipt=entry.episodeStatus==='completed'?'episode-step-limit':'verified-discussion-read'
    if(entry.status!=='completed')entry.status='inspected'
    write(stateDir,key,store);try{onChange()}catch{}
    return {ok:true,id,receipt:entry.receipt,count:receipt.count}
  })
  const entryCanReadDiscussion=(entry,time)=>VALID_BV.test(String(entry.selectedBvid||''))&&
    Number(entry.metadataAt||0)>0&&time>=Number(entry.metadataAt)&&time-Number(entry.metadataAt)<24*3600_000&&
    !(Array.isArray(entry.discussionReadBvids)?entry.discussionReadBvids:[]).includes(entry.selectedBvid)&&
    Number(entry.episodeSteps||1)<EPISODE_MAX_STEPS&&Number(entry.nextAt||0)<=time&&entry.episodeStatus!=='review'
  // At most ONE extra real homepage read per home-origin Episode. This is
  // distinct from the original video Agent's one-read-per-round cap: it is a
  // separately model-chosen READ-only step, never a new video selection or
  // a write/communication grant. Unknown/failure never creates new candidates.
  const browseHomeMore=(id,result,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const store=read(stateDir,key),entry=store.intentions.find(x=>x.id===id&&
      x.source==='home-browse'&&['ready','inspected'].includes(x.status)&&
      Number(x.episodeSteps||1)<EPISODE_MAX_STEPS&&Number(x.homeRefreshCount||0)<1&&
      entryAgeValid(x,now()))
    if(!entry)return {ok:false,error:'首页补充候选不在当前有效 Episode 中'}
    // Store a consumed read attempt even if the platform failed. This avoids
    // silent auto retry/looping; the user can browse in a future real round.
    entry.homeRefreshCount=1
    const existing=new Set([...(entry.videos||[]),...(entry.creatorVideos||[])].map(x=>x.bvid))
    const room=Math.max(0,EPISODE_MAX_VIDEOS-(entry.videos||[]).length)
    const fresh=result?.ok===true&&result?.verified===true?
      videoRows(result.videos).filter(x=>!existing.has(x.bvid)).slice(0,room):[]
    if(!fresh.length){
      entry.lastAt=now();entry.lastAction='browse-home-more-unavailable';entry.receipt='home-more-no-new-candidates'
      entry.nextAt=now()+30*60_000
      write(stateDir,key,store);try{onChange()}catch{};return {ok:true,id,receipt:entry.receipt,added:0}
    }
    entry.videos=[...new Map([...(entry.videos||[]),...fresh].map(v=>[v.bvid,v])).values()].slice(-EPISODE_MAX_VIDEOS)
    addEpisodeStep(entry,'browse-home-more')
    entry.receipt=entry.episodeStatus==='completed'?'episode-step-limit':'verified-home-more'
    if(entry.status!=='completed')entry.status='ready'
    write(stateDir,key,store);try{onChange()}catch{};return {ok:true,id,receipt:entry.receipt,added:fresh.length}
  })
  const entryAgeValid=(x,time)=>x.expiresAt>time&&Number(x.nextAt||0)<=time&&x.episodeStatus!=='review'
  const failCreatorRead=(id,expectedAccount='')=>mutate(()=>{
    const key=account();if(!key||!inAccount(expectedAccount))return {ok:false,error:'账号已变化或未就绪'}
    const store=read(stateDir,key),entry=store.intentions.find(x=>x.id===id&&
      ['ready','inspected'].includes(x.status)&&x.selectedBvid&&
      !(Array.isArray(x.creatorExploredBvids)?x.creatorExploredBvids.includes(x.selectedBvid):x.creatorExplored===true)&&x.expiresAt>now())
    if(!entry)return {ok:false,error:'自主意愿无法核实'}
    entry.lastAction='creator-read-failed';entry.receipt='creator-read-failed';entry.lastAt=now();entry.nextAt=now()+DAY
    write(stateDir,key,store);try{onChange()}catch{};return {ok:true,id,receipt:entry.receipt}
  })
  // Owner-only evidence projection; keep UID out of episodeView()/continuations().
  const timelineEvidence=({limit=160,days=90}={})=>{
    const key=account();if(!key)return []
    const span=Math.max(1,Math.min(90,Number(days)||90))*DAY,cutoff=now()-span,rows=[]
    const store=read(stateDir,key),verifiedCreatorByBvid=new Map(),conflicts=new Set()
    for(const entry of store.intentions||[]){
      const uid=validUid(entry?.creatorUid)?String(entry.creatorUid):''
      if(!uid)continue
      for(const value of [entry.selectedBvid,...videoRows(entry.creatorVideos).map(v=>v.bvid)]){
        const bv=String(value||'');if(!VALID_BV.test(bv)||conflicts.has(bv))continue
        const prior=verifiedCreatorByBvid.get(bv)
        if(prior&&prior!==uid){verifiedCreatorByBvid.delete(bv);conflicts.add(bv)}
        else verifiedCreatorByBvid.set(bv,uid)
      }
    }
    for(const decision of store.decisions||[]){
      const at=Number(decision?.at),bvid=VALID_BV.test(String(decision?.bvid||''))?String(decision.bvid):''
      if(decision?.action!=='inspect'||decision?.result!=='verified-metadata'||!bvid||!Number.isSafeInteger(at)||at<cutoff||at>now())continue
      const uid=verifiedCreatorByBvid.get(bvid)||''
      rows.push({at,action:'inspect-opportunity',bvid,title:clean(decision.title,85),url:'https://www.bilibili.com/video/'+bvid,
        ...(uid?{creatorUid:uid,creatorUrl:'https://space.bilibili.com/'+uid}:{})})
    }
    for(const entry of store.intentions||[]){
      const candidateVideos=videoRows(entry.videos),creatorVideos=videoRows(entry.creatorVideos)
      for(const step of Array.isArray(entry.episodeHistory)?entry.episodeHistory:[]){
        const at=Number(step?.at),action=String(step?.action||'')
        if(!Number.isSafeInteger(at)||at<cutoff||at>now()||
           !['search','browse-home','inspect-public-person','inspect-video','inspect-creator-space','inspect-video-discussion','life-write-verified','browse-home-more'].includes(action))continue
        const bvid=VALID_BV.test(String(step.bvid||''))?String(step.bvid):''
        const uid=bvid?(verifiedCreatorByBvid.get(bvid)||''):''
        const relatedVideos=action==='inspect-creator-space'?creatorVideos:
          ['search','browse-home','inspect-public-person','browse-home-more'].includes(action)?candidateVideos:[]
        rows.push({at,action,...(bvid?{bvid,url:'https://www.bilibili.com/video/'+bvid}:{}),
          ...(clean(step.title,85)?{title:clean(step.title,85)}:bvid===entry.selectedBvid&&clean(entry.selectedTitle,85)?{title:clean(entry.selectedTitle,85)}:{}),
          ...(uid?{creatorUid:uid,creatorUrl:'https://space.bilibili.com/'+uid}:{}),
          ...(relatedVideos.length?{relatedVideos:relatedVideos.map(v=>({bvid:v.bvid,title:v.title,url:'https://www.bilibili.com/video/'+v.bvid}))}:{})})
      }
    }
    return rows.sort((a,b)=>a.at-b.at).slice(-Math.max(1,Math.min(300,Number(limit)||160)))
  }
  const status=()=>{
    const opportunities=list({includeClosed:true,limit:20})
    return {ok:true,accountReady:!!account(),opportunities,intentions:intentions({includeClosed:true,limit:12}).map(x=>({...x,creatorUid:undefined})),sourceWarnings:[...sourceWarnings],
    recentReadMetadata:recentReads({limit:3}),
    explorationReadFailures:(account()?read(stateDir,account()).cueFailures:[]).slice(-12).map(x=>({
      failures:x.failures,nextAt:x.nextAt,failureCode:x.failureCode,paused:false})),
    note:'来源：本账号评论区真实阅读、账号归属明确的多日自主选片兴趣，以及当前账号公开评论中的跨日明确交流偏好。仅允许只读核实或内部复核，不代表已观看/喜爱、关系亲密或外发许可。旧版缺少账号证据的兴趣不参与。'}
  }
  return {list,decide,recentReads,status,timelineEvidence,explorationCues,intentions,continuations,failExplorationCueRead,beginExploration,beginVideoExploration,beginInspectedOpportunity,beginCompletedVideoTodo,beginVideoObservation,beginHomeExploration,beginPublicPersonExploration,completeExploration,failExplorationRead,inspectCreatorSpace,inspectVideoDiscussion,browseHomeMore,failCreatorRead,pauseExploration,abandonExploration,recordExplorationWrite}
}
export const __test={read,pathFor,ident}
