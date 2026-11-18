/**
 * Account-scoped, metadata-only snapshots for Bilibili unread notification sentinels.
 * Stores counts and timestamps only; never stores message IDs, UIDs, text or credentials.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,openSync,closeSync,statSync} from 'node:fs'
import {join} from 'node:path'

const MAX_BYTES=12_000
const RECONCILE_MS=30*60_000
const validCount=value=>Number.isSafeInteger(value)&&value>=0&&value<=10_000_000
const empty=scope=>({version:1,scope,dm:{snapshot:null,lastCheckedAt:0,lastDetailAt:0,pending:false,bootstrapped:false},
  social:{snapshot:null,lastCheckedAt:0,lastDetailAt:{replies:0,mentions:0},bootstrapped:{replies:false,mentions:false},pendingCategories:[]}})
const cleanSocialCategories=values=>[...new Set((Array.isArray(values)?values:[]).filter(x=>x==='replies'||x==='mentions'))]
const safeSnapshot=(value,kind)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error(`${kind} 未读计数格式无效`)
  if(kind==='dm'){
    const keys=['followUnread','unfollowUnread','dustbinUnread','unfollowPushUnread','dustbinPushUnread','bizFollowUnread','bizUnfollowUnread','customUnread']
    if(!['followUnread','unfollowUnread','dustbinUnread'].every(k=>validCount(value[k])))throw Error('私信未读计数缺少必要分类字段')
    return Object.fromEntries(keys.map(k=>[k,validCount(value[k])?value[k]:0]))
  }
  const mode=value.mode==='split'?'split':'combined'
  const out={mode,replyCount:validCount(value.replyCount)?value.replyCount:null,
    atCount:validCount(value.atCount)?value.atCount:null,
    replyAtTotal:validCount(value.replyAtTotal)?value.replyAtTotal:null,
    likeCount:validCount(value.likeCount)?value.likeCount:null}
  if(out.replyCount===null&&out.atCount===null&&out.replyAtTotal===null&&out.likeCount===null)
    throw Error('互动通知未读计数缺少有效字段')
  return out
}
function parseState(raw,scope){
  if(!raw)return empty(scope)
  if(raw.version!==1||raw.scope!==scope||!raw.dm||!raw.social||
    ![raw.dm.lastCheckedAt,raw.dm.lastDetailAt,raw.social.lastCheckedAt,
      raw.social.lastDetailAt?.replies,raw.social.lastDetailAt?.mentions].every(x=>Number.isSafeInteger(x)&&x>=0)||
    typeof raw.dm.pending!=='boolean'||typeof raw.dm.bootstrapped!=='boolean'||
    typeof raw.social.bootstrapped?.replies!=='boolean'||typeof raw.social.bootstrapped?.mentions!=='boolean'||
    !Array.isArray(raw.social.pendingCategories))throw Error('B站通知哨兵账本格式异常，已暂停自动读取；原文件未清除')
  const dmSnapshot=raw.dm.snapshot===null?null:safeSnapshot(raw.dm.snapshot,'dm')
  const socialSnapshot=raw.social.snapshot===null?null:safeSnapshot(raw.social.snapshot,'social')
  return {version:1,scope,dm:{snapshot:dmSnapshot,lastCheckedAt:raw.dm.lastCheckedAt,
      lastDetailAt:raw.dm.lastDetailAt,pending:raw.dm.pending,bootstrapped:raw.dm.bootstrapped},
    social:{snapshot:socialSnapshot,lastCheckedAt:raw.social.lastCheckedAt,
      lastDetailAt:{replies:raw.social.lastDetailAt.replies,mentions:raw.social.lastDetailAt.mentions},
      bootstrapped:{replies:raw.social.bootstrapped.replies,mentions:raw.social.bootstrapped.mentions},
      pendingCategories:cleanSocialCategories(raw.social.pendingCategories)}}
}
function dmIncreased(before,after){
  if(!before)return true
  return Object.keys(after).some(k=>after[k]>Number(before[k]||0))
}
function socialIncreased(before,after){
  if(!before)return ['replies','mentions']
  const pending=[]
  if(before.mode!==after.mode){pending.push('replies','mentions')}
  else if(after.mode==='split'){
    if(after.replyCount!==null&&after.replyCount>Number(before.replyCount||0))pending.push('replies')
    if(after.atCount!==null&&after.atCount>Number(before.atCount||0))pending.push('mentions')
  }else if(after.replyAtTotal!==null&&after.replyAtTotal>Number(before.replyAtTotal||0)){
    // recv_reply is an aggregate of replies and @ notifications on newer API shapes.
    pending.push('replies','mentions')
  }
  if(after.likeCount!==null&&after.likeCount>Number(before.likeCount||0))pending.push('mentions')
  return pending
}

export function createNotificationSentinelState({dataDir,getAccountTag=()=>'',now=Date.now}={}){
  if(!dataDir)throw TypeError('notification sentinel dataDir required')
  const scope=()=>String(getAccountTag()||'').match(/^[a-f0-9]{16}$/)?.[0]||''
  const paths=()=>{const tag=scope();if(!tag)throw Error('当前 B站账号尚未完成绑定，通知哨兵保持暂停')
    const file=join(dataDir,`bili-notification-sentinels-${tag}.json`);return {file,lock:file+'.lock',tag}}
  const load=({missingOk=true}={})=>{
    const {file,tag}=paths()
    try{
      const st=lstatSync(file)
      if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw Error('B站通知哨兵账本不安全，已暂停读取')
      let raw
      try{raw=JSON.parse(readFileSync(file,'utf8'))}catch{throw Error('B站通知哨兵账本格式异常，已暂停自动读取；原文件未清除')}
      return parseState(raw,tag)
    }catch(e){if(e?.code==='ENOENT'&&missingOk)return empty(tag);throw e}
  }
  const save=(file,db)=>{
    mkdirSync(dataDir,{recursive:true,mode:0o700})
    const tmp=file+'.'+process.pid+'.'+now()+'.tmp'
    try{writeFileSync(tmp,JSON.stringify(db)+'\n',{encoding:'utf8',mode:0o600});renameSync(tmp,file)}
    finally{try{unlinkSync(tmp)}catch{}}
  }
  const mutate=fn=>{
    const {file,lock,tag}=paths();mkdirSync(dataDir,{recursive:true,mode:0o700})
    let fd
    try{fd=openSync(lock,'wx',0o600)}catch(e){
      if(e?.code!=='EEXIST')throw e
      let stale=false;try{stale=now()-statSync(lock).mtimeMs>30_000}catch{}
      if(stale)try{unlinkSync(lock)}catch{}
      try{fd=openSync(lock,'wx',0o600)}catch(e2){if(e2?.code==='EEXIST')throw Error('通知哨兵账本正在由另一个宿主更新');throw e2}
    }
    try{const db=load(),before=JSON.stringify(db);const result=fn(db);if(JSON.stringify(db)!==before)save(file,db);return result}
    finally{try{closeSync(fd)}finally{try{unlinkSync(lock)}catch{}}}
  }
  const status=()=>load()
  const recordDm=snapshot=>mutate(db=>{
    const next=safeSnapshot(snapshot,'dm'),before=db.dm.snapshot
    const first=!before,increased=dmIncreased(before,next)
    db.dm.snapshot=next;db.dm.lastCheckedAt=now()
    if(first||increased)db.dm.pending=true
    return {first,increased,pending:db.dm.pending,snapshot:next}
  })
  const recordSocial=snapshot=>mutate(db=>{
    const next=safeSnapshot(snapshot,'social'),before=db.social.snapshot
    const first=!before,changed=first?['replies','mentions']:socialIncreased(before,next)
    db.social.snapshot=next;db.social.lastCheckedAt=now()
    for(const category of changed)if(!db.social.pendingCategories.includes(category))db.social.pendingCategories.push(category)
    return {first,changed,pendingCategories:[...db.social.pendingCategories],snapshot:next}
  })
  const requestReconciliation=({dmEnabled=false,repliesEnabled=false,mentionsEnabled=false}={})=>mutate(db=>{
    const t=now();let changed=false
    if(dmEnabled&&db.dm.snapshot&&(!db.dm.bootstrapped||!db.dm.lastDetailAt||t-db.dm.lastDetailAt>=RECONCILE_MS)&&!db.dm.pending){db.dm.pending=true;changed=true}
    const enabled={replies:repliesEnabled,mentions:mentionsEnabled}
    for(const category of ['replies','mentions'])if(enabled[category]&&db.social.snapshot&&
      (!db.social.bootstrapped[category]||!db.social.lastDetailAt[category]||t-db.social.lastDetailAt[category]>=RECONCILE_MS)&&
      !db.social.pendingCategories.includes(category)){db.social.pendingCategories.push(category);changed=true}
    return {changed,dmPending:db.dm.pending,socialPending:[...db.social.pendingCategories]}
  })
  const markDmDetailSuccess=()=>mutate(db=>{db.dm.pending=false;db.dm.bootstrapped=true;db.dm.lastDetailAt=now();return true})
  const markSocialDetailSuccess=categories=>mutate(db=>{
    for(const category of cleanSocialCategories(categories)){
      db.social.bootstrapped[category]=true;db.social.lastDetailAt[category]=now()
      db.social.pendingCategories=db.social.pendingCategories.filter(x=>x!==category)
    }
    return [...db.social.pendingCategories]
  })
  const pendingSocialCategories=({repliesEnabled=false,mentionsEnabled=false}={})=>{
    const s=load().social,enabled={replies:repliesEnabled,mentions:mentionsEnabled}
    return s.pendingCategories.filter(x=>enabled[x])
  }
  return {status,recordDm,recordSocial,requestReconciliation,markDmDetailSuccess,markSocialDetailSuccess,pendingSocialCategories,
    fileForCurrentAccount:()=>paths().file,reconcileIntervalMs:RECONCILE_MS}
}
