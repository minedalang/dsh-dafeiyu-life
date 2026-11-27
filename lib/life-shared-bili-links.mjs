/** Account-scoped, private index of Bilibili links shared by approved friends or the verified owner.
 * Stores only a validated link reference and bounded public read receipts;
 * never stores the original DM body, raw URL, message id or model prompt.
 */
import {createHash} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {extractBiliShareLinks} from './bili-share-link.mjs'
import {withLifeOpportunityLedgerLock} from './life-planner-atomic.mjs'

const DAY=86_400_000,MAX_BYTES=64_000,HEX=/^[a-f0-9]{16}$/,
  ID=/^[a-f0-9]{24}$/,UID=/^[1-9]\d{0,18}$/
const RELATION_TYPES=new Set(['reposted-original','embedded-video','author-profile'])
const PUBLIC_ORIGINS=new Set(['video-metadata','interest-search','home-discovery','creator-portfolio','public-person','commenter-portfolio'])
const EXPLORATION_GOALS=new Set(['read_link','observe_video'])
const deferredGoal=x=>EXPLORATION_GOALS.has(x?.deferredExploration?.goal)&&Number.isSafeInteger(x.deferredExploration.at)&&x.deferredExploration.at>=x.at?x.deferredExploration.goal:''
const clean=(value,max=180)=>String(value??'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
const validRef=row=>row&&(['short','dynamic','video','profile'].includes(row.kind))&&
  (row.kind==='short'?/^[A-Za-z0-9_-]{4,32}$/.test(String(row.code||'')):
   row.kind==='dynamic'?/^[1-9]\d{5,19}$/.test(String(row.dynamicId||'')):
   row.kind==='video'?(/^BV[0-9A-Za-z]{10}$/.test(String(row.bvid||''))||/^[1-9]\d{1,14}$/.test(String(row.aid||''))):
   UID.test(String(row.uid||'')))
function fileFor(dir,scope){
  if(!HEX.test(String(scope||'')))throw Error('好友分享链接账号范围不可用')
  const folder=join(dir,'life-shared-bili-links')
  if(existsSync(folder)){const st=lstatSync(folder);if(!st.isDirectory()||st.isSymbolicLink())throw Error('好友分享链接目录不安全')}
  return join(folder,scope+'.json')
}
function read(dir,scope){
  const file=fileFor(dir,scope)
  if(!existsSync(file))return {version:1,items:[]}
  const st=lstatSync(file)
  if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw Error('好友分享链接账本不安全')
  const raw=JSON.parse(readFileSync(file,'utf8'))
  if(raw?.version!==1||!Array.isArray(raw.items))throw Error('好友分享链接账本版本不兼容')
  return {version:1,items:raw.items.filter(x=>ID.test(String(x?.id||''))&&validRef(x?.ref)&&
    UID.test(String(x?.senderUid||''))&&Number.isSafeInteger(x.at)&&x.at>0&&
    ['pending','inspected','deferred','dismissed','interacted','uncertain','error'].includes(x.status))
    .slice(-40).map(x=>({...x,imageObservations:Array.isArray(x.imageObservations)?x.imageObservations.filter(s=>typeof s==='string').slice(0,3):[],
      interactions:Array.isArray(x.interactions)?x.interactions.slice(-4):[],
      parentId:ID.test(String(x.parentId||''))?x.parentId:'',depth:Math.max(0,Math.min(2,Number(x.depth)||0)),
      relation:RELATION_TYPES.has(x.relation)?x.relation:'',relatedCount:Math.max(0,Math.min(4,Number(x.relatedCount)||0))}))}
}
function write(dir,scope,data){
  const folder=join(dir,'life-shared-bili-links');mkdirSync(folder,{recursive:true,mode:0o700})
  const st=lstatSync(folder);if(!st.isDirectory()||st.isSymbolicLink())throw Error('好友分享链接目录不安全')
  const file=fileFor(dir,scope)
  if(existsSync(file)){const f=lstatSync(file);if(!f.isFile()||f.isSymbolicLink())throw Error('好友分享链接文件不安全')}
  const temp=file+'.'+process.pid+'.tmp'
  writeFileSync(temp,JSON.stringify({version:1,items:data.items.slice(-40)},null,2)+'\n',{mode:0o600})
  renameSync(temp,file)
}
const rowView=(x,now=Date.now())=>({id:x.id,source:x.parentId?'related-public-content':x.senderRole==='owner'?'owner-shared-bili-link':x.senderRole==='friend'?'friend-shared-bili-link':x.senderRole==='public'?'public-discovery-content':'contact-shared-bili-link',kind:x.resolvedKind||x.ref.kind,
  publicOrigin:PUBLIC_ORIGINS.has(x.publicOrigin)?x.publicOrigin:'',parentId:x.parentId||'',relation:x.relation||'',depth:Number(x.depth)||0,relatedCount:Number(x.relatedCount)||0,
  status:x.status,...(deferredGoal(x)&&['pending','deferred','error'].includes(x.status)?{deferredGoal:deferredGoal(x)}:{}),at:new Date(x.at).toISOString(),title:clean(x.title,100),summary:clean(x.summary,420),
  authorName:clean(x.authorName,50),authorVerified:UID.test(String(x.authorUid||'')),authorMatchesSharer:x.authorMatchesSharer===true,commentable:x.commentable===true,
  evidenceLevel:['dynamic-text','dynamic-text-image','video-metadata-only','profile-metadata-only'].includes(x.evidenceLevel)?x.evidenceLevel:'',
  imageObservations:x.imageObservations.slice(0,3),interactions:x.interactions.slice(-4).map(a=>({action:a.action,status:a.status,at:a.at})),failureCode:x.failureCode||'',eligible:['pending','inspected','error','deferred'].includes(x.status)&&Number(x.nextAt||0)<=now})
export function createLifeSharedBiliLinks({stateDir,getAccountTag,now=Date.now,onChange=()=>{}}={}){
  if(!stateDir||typeof getAccountTag!=='function')throw TypeError('好友分享链接依赖缺失')
  const scope=()=>String(getAccountTag()||'')
  const mutate=fn=>withLifeOpportunityLedgerLock(stateDir,fn,{now})
  const offerFromMessage=({uid,role,text,messageId,at=now()}={})=>{
    const key=scope()
    if(!HEX.test(key)||!['friend','owner','stranger','known'].includes(role)||!UID.test(String(uid||''))||!String(messageId||'').trim()||
      !Number.isSafeInteger(Number(at))||Number(at)<=0||Number(at)>now()+60_000)return {ok:true,created:0}
    const refs=extractBiliShareLinks(text,{limit:2})
    if(!refs.length)return {ok:true,created:0}
    return mutate(()=>{
      if(scope()!==key)return {ok:false,error:'账号切换，未记录好友分享链接'}
      const data=read(stateDir,key),seen=new Set(data.items.map(x=>x.id)),ids=[];let created=0
      for(const ref of refs){
        const identity=createHash('sha256').update([key,String(uid),String(messageId),JSON.stringify(ref)].join('\0')).digest('hex').slice(0,24)
        ids.push(identity)
        if(seen.has(identity))continue
        data.items.push({id:identity,senderUid:String(uid),senderRole:role,ref,at:Number(at),status:'pending',nextAt:0,
          resolvedKind:'',dynamicId:'',bvid:'',aid:'',profileUid:'',canonicalUrl:'',title:'',summary:'',
          authorName:'',authorUid:'',authorMatchesSharer:false,commentable:false,evidenceLevel:'',imageObservations:[],interactions:[],parentId:'',relation:'',depth:0,relatedCount:0})
        seen.add(identity);created++
      }
      if(created){write(stateDir,key,data);try{onChange()}catch{}}
      return {ok:true,created,ids:ids.filter(id=>data.items.some(x=>x.id===id))}
    })
  }
  // Trusted public reads from home / interest / creator / comment portfolios
  // become *read-only* optional Life opportunities, never automatic fetches.
  // Only pass platform-verified BVs from host callbacks; no model-provided IDs.
  const offerVerifiedPublicVideos=({videos=[],accountUid,origin='video-metadata',inspected=false}={})=>{
    const key=scope()
    if(!HEX.test(key)||!UID.test(String(accountUid||''))||!PUBLIC_ORIGINS.has(origin)||!Array.isArray(videos))
      return {ok:false,created:0}
    const items=videos.slice(0,3).filter(x=>/^BV[0-9A-Za-z]{10}$/.test(String(x?.bvid||''))&&clean(x.title,100))
    if(!items.length)return {ok:true,created:0}
    return mutate(()=>{
      if(scope()!==key)return {ok:false,created:0,error:'账号切换'}
      const data=read(stateDir,key);let created=0
      // The opportunity surface is limited to 14 days; prune only expired
      // entries so older passive public candidates cannot fill it forever.
      data.items=data.items.filter(x=>x.at>=now()-14*DAY)
      for(const item of items){
        const identity=createHash('sha256').update([key,'public-video',item.bvid].join('\0')).digest('hex').slice(0,24)
        if(data.items.some(x=>x.id===identity)||data.items.length>=40)continue
        const authorUid=UID.test(String(item.authorUid||''))?String(item.authorUid):''
        data.items.push({id:identity,senderUid:String(accountUid),senderRole:'public',publicOrigin:origin,
          ref:{kind:'video',bvid:item.bvid},at:now(),status:inspected?'inspected':'pending',nextAt:0,
          resolvedKind:inspected?'video':'',dynamicId:'',bvid:inspected?item.bvid:'',aid:'',profileUid:'',
          canonicalUrl:inspected?'https://www.bilibili.com/video/'+item.bvid:'',title:clean(item.title,100),
          summary:inspected?clean(item.description,420):'',authorName:'',authorUid:inspected?authorUid:'',
          authorMatchesSharer:false,commentable:false,evidenceLevel:'',imageObservations:[],interactions:[],parentId:'',relation:'',depth:0,relatedCount:0})
        created++
        // A newly read and verified author's space is a distinct voluntary action.
        if(inspected&&authorUid&&data.items.length<40){
          const childId=createHash('sha256').update([key,identity,JSON.stringify({kind:'profile',uid:authorUid})].join('\0')).digest('hex').slice(0,24)
          if(!data.items.some(x=>x.id===childId)){
            data.items.push({id:childId,senderUid:String(accountUid),senderRole:'public',publicOrigin:origin,
              ref:{kind:'profile',uid:authorUid},at:now(),status:'pending',nextAt:0,resolvedKind:'',
              dynamicId:'',bvid:'',aid:'',profileUid:'',canonicalUrl:'',title:'',summary:'',authorName:'',authorUid:'',
              authorMatchesSharer:false,commentable:false,evidenceLevel:'',imageObservations:[],interactions:[],
              parentId:identity,relation:'author-profile',depth:1,relatedCount:0})
            data.items[data.items.findIndex(x=>x.id===identity)].relatedCount=1
          }
        }
      }
      if(created){write(stateDir,key,data);try{onChange()}catch{}}
      return {ok:true,created}
    })
  }
  const list=({limit=6}={})=>{
    const key=scope();if(!HEX.test(key))return []
    const data=read(stateDir,key),cutoff=now()-14*DAY
    return data.items.filter(x=>x.at>=cutoff&&['pending','inspected','error','deferred'].includes(x.status)&&Number(x.nextAt||0)<=now())
      .sort((a,b)=>Math.max(b.inspectedAt||0,b.at)-Math.max(a.inspectedAt||0,a.at)).slice(0,Math.max(1,Math.min(20,limit))).map(x=>rowView(x,now()))
  }
  // Read-only recent history also includes dismissed and uncertain receipts.
  // This cannot reoffer a frozen action to the Life planner.
  const history=({limit=12}={})=>{
    const key=scope();if(!HEX.test(key))return []
    return read(stateDir,key).items.filter(x=>x.at>=now()-14*DAY)
      .sort((a,b)=>Math.max(b.lastDecisionAt||0,b.inspectedAt||0,b.at)-
        Math.max(a.lastDecisionAt||0,a.inspectedAt||0,a.at))
      .slice(0,Math.max(1,Math.min(20,Number(limit)||12))).map(x=>rowView(x,now()))
  }
  const get=(id,expectedScope='')=>{
    const key=scope();if(!HEX.test(key)||expectedScope!==key||!ID.test(String(id||'')))return null
    const row=read(stateDir,key).items.find(x=>x.id===id&&x.at>=now()-14*DAY)
    return row?{...row,ref:{...row.ref},imageObservations:[...row.imageObservations],interactions:[...row.interactions]}:null
  }
  // Return at most one platform-proven repost target for the SAME DM share.
  // No model-supplied URL/ID is accepted; this is not an independent DM search.
  const repostedOriginalForParent=(parentId,expectedScope='')=>{
    const key=scope()
    if(!HEX.test(key)||expectedScope!==key||!ID.test(String(parentId||'')))return null
    const data=read(stateDir,key),parent=data.items.find(x=>x.id===parentId&&
      !x.parentId&&x.status==='inspected'&&x.resolvedKind==='dynamic'&&x.at>=now()-14*DAY)
    if(!parent)return null
    const originals=data.items.filter(x=>x.parentId===parentId&&x.relation==='reposted-original'&&
      x.senderUid===parent.senderUid&&x.ref?.kind==='dynamic'&&validRef(x.ref)&&
      x.at>=now()-14*DAY&&Number(x.nextAt||0)<=now()&&
      ['pending','inspected','error','deferred'].includes(x.status))
    // Ambiguous original provenance is NOT a reason to guess which one to read.
    return originals.length===1?rowView(originals[0],now()):null
  }
  const recordRead=(id,proof,expectedScope='')=>mutate(()=>{
    const key=scope();if(!HEX.test(key)||expectedScope!==key)return {ok:false,error:'账号变化，拒绝记录链接读取'}
    const data=read(stateDir,key),row=data.items.find(x=>x.id===id&&x.at>=now()-14*DAY)
    if(!row||!['pending','error','deferred'].includes(row.status)||Number(row.nextAt||0)>now())return {ok:false,error:'分享链接已变化、过期或已读取'}
    if(proof?.ok!==true||!['dynamic','video','profile'].includes(proof.kind)||!clean(proof.title,100))return {ok:false,error:'链接读取没有可信的内容回执'}
    // Direct typed links must resolve to the same resource type and identifier.
    // Only an opaque B23 short link may legitimately resolve to another kind.
    if(row.ref.kind!=='short'&&row.ref.kind!==proof.kind)return {ok:false,error:'链接类型与平台回执不匹配'}
    if(proof.kind==='dynamic'&&(!/^[1-9]\d{5,19}$/.test(String(proof.dynamicId||''))||
       row.ref.kind==='dynamic'&&row.ref.dynamicId!==String(proof.dynamicId)))return {ok:false,error:'动态 ID 不匹配'}
    if(proof.kind==='video'&&(!(/^BV[0-9A-Za-z]{10}$/.test(String(proof.bvid||''))||/^[1-9]\d{1,14}$/.test(String(proof.aid||'')))||
       row.ref.kind==='video'&&(row.ref.bvid&&row.ref.bvid!==String(proof.bvid)||row.ref.aid&&String(row.ref.aid)!==String(proof.aid||''))))
      return {ok:false,error:'视频 ID 不匹配'}
    if(proof.kind==='profile'&&(!UID.test(String(proof.uid||''))||row.ref.kind==='profile'&&row.ref.uid!==String(proof.uid)))return {ok:false,error:'空间 UID 不匹配'}
    row.resolvedKind=proof.kind;row.dynamicId=proof.kind==='dynamic'?String(proof.dynamicId):''
    row.bvid=proof.kind==='video'?String(proof.bvid||''):'';row.aid=proof.kind==='video'?String(proof.aid||''):''
    row.profileUid=proof.kind==='profile'?String(proof.uid):''
    row.canonicalUrl=proof.kind==='dynamic'?'https://t.bilibili.com/'+row.dynamicId:
      proof.kind==='video'?(row.bvid?'https://www.bilibili.com/video/'+row.bvid:'https://www.bilibili.com/video/av'+row.aid):
      'https://space.bilibili.com/'+row.profileUid
    row.title=clean(proof.title,100);row.summary=clean(proof.summary,420)
    row.authorName=clean(proof.authorName,50);row.authorUid=UID.test(String(proof.authorUid||''))?String(proof.authorUid):''
    row.authorMatchesSharer=Boolean(row.authorUid&&row.authorUid===row.senderUid)
    row.commentable=proof.kind==='dynamic'&&proof.commentable===true
    row.evidenceLevel=proof.kind==='dynamic'?(Array.isArray(proof.imageObservations)&&proof.imageObservations.length?'dynamic-text-image':'dynamic-text'):
      proof.kind==='video'?'video-metadata-only':'profile-metadata-only'
    row.imageObservations=(Array.isArray(proof.imageObservations)?proof.imageObservations:[]).filter(x=>typeof x==='string').slice(0,3).map(x=>clean(x,100))
    row.status='inspected';row.inspectedAt=now();row.nextAt=0;row.failureCode=''
    if(deferredGoal(row)==='read_link')delete row.deferredExploration
    // One verified read can disclose bounded typed references. Persist only
    // references, never raw response, original message or picture URLs. Every
    // child needs a fresh, independent Life decision and Bilibili read proof.
    const depth=Number(row.depth)||0
    if(depth<2&&Array.isArray(proof.related)){
      const seen=new Set(data.items.map(x=>x.id));let added=0
      for(const item of proof.related.slice(0,4)){
        if(!item||!RELATION_TYPES.has(item.relation)||!validRef(item))continue
        if(item.kind==='dynamic'&&item.dynamicId===row.dynamicId||
          item.kind==='video'&&item.bvid&&item.bvid===row.bvid||
          item.kind==='profile'&&item.uid&&item.uid===row.profileUid)continue
        const ref=Object.fromEntries(['kind','dynamicId','bvid','aid','uid'].filter(k=>item[k]).map(k=>[k,item[k]]))
        const childId=createHash('sha256').update([key,row.id,JSON.stringify(ref)].join('\0')).digest('hex').slice(0,24)
        if(seen.has(childId)||data.items.length>=40)continue
        data.items.push({id:childId,senderUid:row.senderUid,senderRole:row.senderRole,ref,at:now(),status:'pending',nextAt:0,
          resolvedKind:'',dynamicId:'',bvid:'',aid:'',profileUid:'',canonicalUrl:'',title:'',summary:'',
          authorName:'',authorUid:'',authorMatchesSharer:false,commentable:false,evidenceLevel:'',imageObservations:[],interactions:[],
          parentId:row.id,depth:depth+1,relation:item.relation,relatedCount:0})
        seen.add(childId);added++
      }
      row.relatedCount=added
    }
    write(stateDir,key,data);try{onChange()}catch{}
    return {ok:true,id:row.id,kind:row.resolvedKind,evidenceLevel:row.evidenceLevel,authorMatchesSharer:row.authorMatchesSharer}
  })
  const decide=(id,action,{reason=''}={})=>mutate(()=>{
    const key=scope();if(!HEX.test(key)||!ID.test(String(id||''))||!['skip','defer','dismiss'].includes(action))return {ok:false,error:'生活契机动作不合法'}
    const data=read(stateDir,key),row=data.items.find(x=>x.id===id&&x.at>=now()-14*DAY)
    if(!row||!['pending','inspected','error','deferred'].includes(row.status))return {ok:false,error:'分享链接已结束或过期'}
    row.status=action==='dismiss'?'dismissed':action==='defer'?'deferred':'pending'
    row.nextAt=action==='dismiss'?0:now()+(action==='defer'?2*DAY:DAY)
    if(action==='dismiss')delete row.deferredExploration
    row.lastReason=clean(reason,100);row.lastDecisionAt=now()
    write(stateDir,key,data);try{onChange()}catch{}
    return {ok:true,id,status:row.status,nextAt:row.nextAt}
  })
  // Record the SAME Life model's voluntary interest on the original share cue.
  // This neither executes a tool nor creates an accepted TODO or contact grant.
  const recordExplorationIntent=(id,{uid,role,goal}={},expectedScope='')=>mutate(()=>{
    const key=scope();if(key!==expectedScope||!HEX.test(key))return {ok:false,reason:'account-changed'}
    const data=read(stateDir,key),row=data.items.find(x=>x.id===id&&x.at>=now()-14*DAY)
    if(!row||row.parentId||row.senderUid!==String(uid)||row.senderRole!==role||!['owner','friend','stranger','known'].includes(role)||!EXPLORATION_GOALS.has(goal))return {ok:false,reason:'source-not-current'}
    if(!['pending','error','deferred','inspected'].includes(row.status)||
       goal==='read_link'&&row.status==='inspected'||goal==='observe_video'&&(!['owner','friend'].includes(role)||(row.resolvedKind||row.ref.kind)!=='video'))return {ok:false,reason:'goal-not-available'}
    if(deferredGoal(row)===goal)return {ok:true,id,goal,duplicate:true}
    row.deferredExploration={goal,at:Math.max(now(),row.at)}
    write(stateDir,key,data);try{onChange()}catch{}
    return {ok:true,id,goal,duplicate:false}
  })
  const recordDeferral=(id,{nextAt=0,reason='read-budget-blocked'}={},expectedScope='')=>mutate(()=>{
    const key=scope();if(key!==expectedScope||!HEX.test(key))return {ok:false,error:'账号变化'}
    const data=read(stateDir,key),row=data.items.find(x=>x.id===id&&x.at>=now()-14*DAY)
    if(!row||!['pending','error','deferred'].includes(row.status))return {ok:false,error:'分享链接已变化'}
    const requested=Number(nextAt),minimum=now()+30_000,maximum=now()+6*60*60_000
    row.status='deferred';row.nextAt=Number.isFinite(requested)&&requested>now()?Math.min(maximum,Math.max(minimum,requested)):now()+15*60_000
    row.failureCode='';row.lastReason=clean(reason,100)||'read-deferred';row.lastFailureAt=0
    write(stateDir,key,data);try{onChange()}catch{}
    return {ok:true,id,status:row.status,nextAt:row.nextAt}
  })
  const recordFailure=(id,code,expectedScope='')=>mutate(()=>{
    const key=scope();if(key!==expectedScope||!HEX.test(key))return {ok:false,error:'账号变化'}
    const data=read(stateDir,key),row=data.items.find(x=>x.id===id&&x.at>=now()-14*DAY)
    if(!row||!['pending','error','deferred'].includes(row.status))return {ok:false,error:'分享链接已变化'}
    row.status='error';row.failureCode=/^(?:invalid-link-ref|invalid-short-link|offsite-redirect-blocked|short-link-network-error|short-link-http-error|short-link-not-resolved|redirect-location-missing|redirect-location-invalid|redirect-hop-limit|unsupported-bilibili-link|dynamic-read-failed|video-read-failed|profile-read-failed|account-changed)$/.test(String(code))?code:'link-read-failed'
    row.nextAt=now()+30*60_000;row.lastFailureAt=now();write(stateDir,key,data);try{onChange()}catch{}
    return {ok:true,status:row.status,failureCode:row.failureCode}
  })
  const recordInteraction=(id,action,status,expectedScope='')=>mutate(()=>{
    const key=scope();if(key!==expectedScope||!HEX.test(key))return {ok:false,error:'账号变化'}
    if(!['like_shared_dynamic','comment_shared_dynamic'].includes(action)||!['verified','accepted-unverified','uncertain','not-sent'].includes(status))return {ok:false,error:'互动回执不合法'}
    const data=read(stateDir,key),row=data.items.find(x=>x.id===id&&x.status==='inspected'&&x.resolvedKind==='dynamic')
    if(!row||!UID.test(String(row.authorUid||'')))return {ok:false,error:'动态作者尚未独立核验'}
    if(row.interactions.some(x=>x.action===action&&['verified','accepted-unverified','uncertain'].includes(x.status)))
      return {ok:false,error:'已互动或发送结果未知，禁止重复'}
    row.interactions=[...row.interactions,{action,status,at:now()}].slice(-4)
    // A confirmed like must not hide a separately authorized comment choice.
    row.status=status==='not-sent'?'deferred':status==='uncertain'?'uncertain':'inspected'
    row.nextAt=status==='not-sent'?now()+6*60*60_000:0;write(stateDir,key,data);try{onChange()}catch{}
    return {ok:true,status:row.status}
  })
  // Private cross-turn continuity: only an already authenticated sender in the
  // SAME account can recover a prior link reference. Nothing is fetched here.
  const recentForContact=({uid,limit=2,maxAgeMs=3*DAY}={})=>{
    const key=scope();if(!HEX.test(key)||!UID.test(String(uid||'')))return []
    return read(stateDir,key).items.filter(x=>!x.parentId&&x.senderUid===String(uid)&&
      x.at>=now()-Math.min(7*DAY,Math.max(0,Number(maxAgeMs)||0))&&
      ['pending','error','deferred','inspected'].includes(x.status))
      .sort((a,b)=>b.at-a.at).slice(0,Math.min(3,Math.max(1,Number(limit)||1)))
      .map(x=>rowView(x,now()))
  }
  const status=()=>({ok:true,pending:list({limit:20}).filter(x=>x.status==='pending').length,
    inspected:list({limit:20}).filter(x=>x.status==='inspected').length,
    note:'仅保存当前账号获准处理的联系人的 B站安全链接引用与公开内容回执，不保存私信正文、原始 URL 或模型提示词。'})
  return {offerFromMessage,offerVerifiedPublicVideos,list,history,get,repostedOriginalForParent,recordRead,decide,recordExplorationIntent,recordDeferral,recordFailure,recordInteraction,recentForContact,status}
}
