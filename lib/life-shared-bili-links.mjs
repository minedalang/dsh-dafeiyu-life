/** Account-scoped, private index of Bilibili links shared by approved friends.
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
      interactions:Array.isArray(x.interactions)?x.interactions.slice(-4):[]}))}
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
const rowView=(x,now=Date.now())=>({id:x.id,source:'friend-shared-bili-link',kind:x.resolvedKind||x.ref.kind,
  status:x.status,at:new Date(x.at).toISOString(),title:clean(x.title,100),summary:clean(x.summary,420),
  authorName:clean(x.authorName,50),authorMatchesSharer:x.authorMatchesSharer===true,commentable:x.commentable===true,
  imageObservations:x.imageObservations.slice(0,3),eligible:['pending','inspected','error','deferred'].includes(x.status)&&Number(x.nextAt||0)<=now})
export function createLifeSharedBiliLinks({stateDir,getAccountTag,now=Date.now,onChange=()=>{}}={}){
  if(!stateDir||typeof getAccountTag!=='function')throw TypeError('好友分享链接依赖缺失')
  const scope=()=>String(getAccountTag()||'')
  const mutate=fn=>withLifeOpportunityLedgerLock(stateDir,fn,{now})
  const offerFromMessage=({uid,role,text,messageId,at=now()}={})=>{
    const key=scope()
    if(!HEX.test(key)||role!=='friend'||!UID.test(String(uid||''))||!String(messageId||'').trim()||
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
        data.items.push({id:identity,senderUid:String(uid),ref,at:Number(at),status:'pending',nextAt:0,
          resolvedKind:'',dynamicId:'',bvid:'',aid:'',profileUid:'',canonicalUrl:'',title:'',summary:'',
          authorName:'',authorUid:'',authorMatchesSharer:false,commentable:false,imageObservations:[],interactions:[]})
        seen.add(identity);created++
      }
      if(created){write(stateDir,key,data);try{onChange()}catch{}}
      return {ok:true,created,ids:ids.filter(id=>data.items.some(x=>x.id===id))}
    })
  }
  const list=({limit=6}={})=>{
    const key=scope();if(!HEX.test(key))return []
    const data=read(stateDir,key),cutoff=now()-14*DAY
    return data.items.filter(x=>x.at>=cutoff&&['pending','inspected','error','deferred'].includes(x.status)&&Number(x.nextAt||0)<=now())
      .sort((a,b)=>b.at-a.at).slice(0,Math.max(1,Math.min(20,limit))).map(x=>rowView(x,now()))
  }
  const get=(id,expectedScope='')=>{
    const key=scope();if(!HEX.test(key)||expectedScope!==key||!ID.test(String(id||'')))return null
    const row=read(stateDir,key).items.find(x=>x.id===id&&x.at>=now()-14*DAY)
    return row?{...row,ref:{...row.ref},imageObservations:[...row.imageObservations],interactions:[...row.interactions]}:null
  }
  const recordRead=(id,proof,expectedScope='')=>mutate(()=>{
    const key=scope();if(!HEX.test(key)||expectedScope!==key)return {ok:false,error:'账号变化，拒绝记录链接读取'}
    const data=read(stateDir,key),row=data.items.find(x=>x.id===id&&x.at>=now()-14*DAY)
    if(!row||!['pending','error','deferred'].includes(row.status)||Number(row.nextAt||0)>now())return {ok:false,error:'分享链接已变化、过期或已读取'}
    if(proof?.ok!==true||!['dynamic','video','profile'].includes(proof.kind)||!clean(proof.title,100))return {ok:false,error:'链接读取没有可信的内容回执'}
    if(proof.kind==='dynamic'&&!/^[1-9]\d{5,19}$/.test(String(proof.dynamicId||'')))return {ok:false,error:'动态 ID 不匹配'}
    if(proof.kind==='video'&&!(/^BV[0-9A-Za-z]{10}$/.test(String(proof.bvid||''))||/^[1-9]\d{1,14}$/.test(String(proof.aid||''))))return {ok:false,error:'视频 ID 不匹配'}
    if(proof.kind==='profile'&&!UID.test(String(proof.uid||'')))return {ok:false,error:'空间 UID 不匹配'}
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
    row.imageObservations=(Array.isArray(proof.imageObservations)?proof.imageObservations:[]).filter(x=>typeof x==='string').slice(0,3).map(x=>clean(x,100))
    row.status='inspected';row.inspectedAt=now();row.nextAt=0;row.failureCode=''
    write(stateDir,key,data);try{onChange()}catch{}
    return {ok:true,id:row.id,kind:row.resolvedKind,authorMatchesSharer:row.authorMatchesSharer}
  })
  const decide=(id,action,{reason=''}={})=>mutate(()=>{
    const key=scope();if(!HEX.test(key)||!ID.test(String(id||''))||!['skip','defer','dismiss'].includes(action))return {ok:false,error:'生活契机动作不合法'}
    const data=read(stateDir,key),row=data.items.find(x=>x.id===id&&x.at>=now()-14*DAY)
    if(!row||!['pending','inspected','error','deferred'].includes(row.status))return {ok:false,error:'分享链接已结束或过期'}
    row.status=action==='dismiss'?'dismissed':action==='defer'?'deferred':'pending'
    row.nextAt=action==='dismiss'?0:now()+(action==='defer'?2*DAY:DAY)
    row.lastReason=clean(reason,100);row.lastDecisionAt=now()
    write(stateDir,key,data);try{onChange()}catch{}
    return {ok:true,id,status:row.status,nextAt:row.nextAt}
  })
  const recordFailure=(id,code,expectedScope='')=>mutate(()=>{
    const key=scope();if(key!==expectedScope||!HEX.test(key))return {ok:false,error:'账号变化'}
    const data=read(stateDir,key),row=data.items.find(x=>x.id===id&&x.at>=now()-14*DAY)
    if(!row||!['pending','error','deferred'].includes(row.status))return {ok:false,error:'分享链接已变化'}
    row.status='error';row.failureCode=/^(?:invalid-link-ref|invalid-short-link|offsite-redirect-blocked|short-link-network-error|short-link-http-error|short-link-not-resolved|redirect-location-missing|redirect-location-invalid|redirect-hop-limit|unsupported-bilibili-link|dynamic-read-failed|video-read-failed|profile-read-failed|account-changed|read-budget-blocked)$/.test(String(code))?code:'link-read-failed'
    row.nextAt=now()+30*60_000;row.lastFailureAt=now();write(stateDir,key,data);try{onChange()}catch{}
    return {ok:true,status:row.status,failureCode:row.failureCode}
  })
  const recordInteraction=(id,action,status,expectedScope='')=>mutate(()=>{
    const key=scope();if(key!==expectedScope||!HEX.test(key))return {ok:false,error:'账号变化'}
    if(!['like_shared_dynamic','comment_shared_dynamic'].includes(action)||!['verified','accepted-unverified','uncertain','not-sent'].includes(status))return {ok:false,error:'互动回执不合法'}
    const data=read(stateDir,key),row=data.items.find(x=>x.id===id&&x.status==='inspected'&&x.resolvedKind==='dynamic')
    if(!row)return {ok:false,error:'动态已变化或已结束'}
    row.interactions=[...row.interactions,{action,status,at:now()}].slice(-4)
    row.status=status==='not-sent'?'deferred':status==='verified'?'interacted':'uncertain'
    row.nextAt=status==='not-sent'?now()+6*60*60_000:0;write(stateDir,key,data);try{onChange()}catch{}
    return {ok:true,status:row.status}
  })
  const status=()=>({ok:true,pending:list({limit:20}).filter(x=>x.status==='pending').length,
    inspected:list({limit:20}).filter(x=>x.status==='inspected').length,
    note:'仅保存好友分享的已验证 B站链接引用与公开内容回执，不保存私信正文、原始 URL 或模型提示词。'})
  return {offerFromMessage,list,get,recordRead,decide,recordFailure,recordInteraction,status}
}
