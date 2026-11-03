/**
 * 2.6.1 account boundary: the character belongs to DSH, never to a Bilibili UID.
 * This ledger contains NO chat content and NO raw credentials. Old per-account
 * transport state is separated from the character's fading life memory.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { hardenPerms } from './login.mjs'
const UID=/^[1-9]\d{0,18}$/
const FILE='account-binding.json'
const TRANSPORT_FILES=Object.freeze([
  'dm-autoreply-state.json','owner-dm-agent.json','owner-dm-actions.json',
  'owner-todo-followups.json','owner-comment-agent.json','comment-interact-state.json'
])
const uidOf=v=>UID.test(String(v||''))?String(v):''
// A damaged existing identity/pending file is NOT a fresh install. Never silently
// recreate the identity or forget a staged switch just because JSON was truncated.
const read=(p,fallback=null)=>{
  if(!existsSync(p))return fallback
  safeFile(p)
  try{return JSON.parse(readFileSync(p,'utf8'))}
  catch{throw Error('账号或角色身份文件损坏，已停止运行以避免跨账号操作：'+p.split(/[\\/]/).at(-1))}
}
function safeFile(path){if(existsSync(path)){const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink())throw Error('账号文件不是常规文件') }}
function atomic(path,value){
  mkdirSync(dirname(path),{recursive:true,mode:0o700});safeFile(path)
  const tmp=path+'.'+process.pid+'.'+randomUUID()+'.tmp'
  try{writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(tmp,path);try{chmodSync(path,0o600)}catch{}}
  finally{if(existsSync(tmp))unlinkSync(tmp)}
}
function safeCredential(c){const uid=uidOf(c?.dedeuserid);if(!uid||typeof c?.sessdata!=='string'||!c.sessdata.trim()||typeof c?.bili_jct!=='string'||!c.bili_jct.trim())throw Error('扫码凭证缺少必要字段或账号 UID');return {sessdata:c.sessdata,bili_jct:c.bili_jct,buvid3:String(c.buvid3||''),dedeuserid:uid}}
/** Verify through the actual account-nav endpoint; never trust the UID in a cookie. */
export async function verifyBiliCredential(credential,{fetchImpl=fetch}={}){
  const cred=safeCredential(credential)
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);timer.unref?.()
  try{
    const response=await fetchImpl('https://api.bilibili.com/x/web-interface/nav',{
      headers:{Cookie:`SESSDATA=${cred.sessdata}; DedeUserID=${cred.dedeuserid}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`,'User-Agent':'Mozilla/5.0'},signal:controller.signal
    })
    if(!response.ok)throw Error('B站登录核验 HTTP '+response.status)
    const body=await response.json(),realUid=uidOf(body?.data?.mid)
    if(body?.code!==0||body?.data?.isLogin!==true||!realUid)throw Error('B站没有确认有效登录')
    if(realUid!==cred.dedeuserid)throw Error('B站核验 UID 与扫码凭证不一致')
    return {uid:realUid,username:String(body?.data?.uname||'').slice(0,70)}
  }finally{clearTimeout(timer)}
}
export function createAccountBinding({dataDir,now=Date.now,verifier=verifyBiliCredential}={}){
  if(!dataDir)throw TypeError('account binding dataDir missing')
  const ledgerFile=join(dataDir,FILE),credFile=join(dataDir,'bili_credential.json'),pendingFile=join(dataDir,'account-login-pending.json')
  const accountRoot=join(dataDir,'accounts')
  const characterFile=join(dataDir,'character-identity.json')
  const current=()=>read(credFile)
  let db=read(ledgerFile)
  let character=read(characterFile)
  const validId=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||''))
  if(character!==null&&(!character||character.version!==1||!validId(character.id)))throw Error('角色身份文件损坏，禁止自动重建身份')
  // Validate the ledger BEFORE creating any new file. A corrupt ledger must not
  // be made to look valid by a newly generated character UUID.
  if(db!==null&&(!db||db.version!==1||!validId(db.characterId)||
    !Number.isSafeInteger(db.generation)||db.generation<0||
    (!UID.test(String(db.activeUid||''))&&!(!db.activeUid&&db.generation===0))||
    !Array.isArray(db.accounts)||db.accounts.length>100||
    db.accounts.some(x=>!uidOf(x?.uid))||
    (db.legacyUid&&!uidOf(db.legacyUid))||
    typeof db.reviewRequired!=='boolean'||typeof db.restartRequired!=='boolean'))
    throw Error('账号身份账本格式异常，停止自动操作以防串号')
  if(db&&character&&db.characterId!==character.id)throw Error('角色身份与账号绑定账本不一致，禁止默默覆盖人生身份')
  if(!character){character={version:1,id:db?.characterId||randomUUID(),createdAt:db?.createdAt||now()};atomic(characterFile,character)}
  if(!db){
    // A disappeared ledger on a machine that already has account runtimes is
    // evidence of damage, not permission to re-bind historic data to a new UID.
    if(existsSync(accountRoot)||existsSync(pendingFile))
      throw Error('账号绑定账本缺失，但存在历史账号或待确认登录；拒绝将旧数据重新绑定')
    const original=uidOf(current()?.dedeuserid)
    db={version:1,characterId:character.id,createdAt:character.createdAt,activeUid:original,generation:original?1:0,cutoverAt:0,
      accounts:original?[{uid:original,boundAt:now(),kind:'legacy-import'}]:[],reviewRequired:false,restartRequired:false,
      lastSwitchAt:0,legacyUid:original}
    atomic(ledgerFile,db)
  }
  const save=()=>atomic(ledgerFile,db)
  let activeOperations=0
  const enterPlatformOperation=()=>{
    assertReady()
    activeOperations++
    let released=false
    return ()=>{if(!released){released=true;activeOperations--}}
  }
  const assertIdle=()=>{if(activeOperations)throw Error('旧账号仍有 '+activeOperations+' 项平台操作尚未结束，请稍后重试确认，不会强制换号')}
  const credentialUid=()=>uidOf(current()?.dedeuserid)
  const pending=()=>read(pendingFile)
  const status=()=>{
    const onDisk=credentialUid(),p=pending(),match=db.activeUid&&onDisk===db.activeUid
    if(p!==null&&(!p||!uidOf(p.dedeuserid)))throw Error('待确认登录凭证结构异常，禁止继续运行')
    const unbound=!db.activeUid&&!onDisk&&!p
    // Unbound installations must never process imported legacy TODOs.
    const blocked=!match||Boolean(db.reviewRequired)||Boolean(db.restartRequired)||Boolean(p)
    const reason=unbound?'unbound':!onDisk?'credential-missing':!match?'uid-mismatch':p?'login-staged':db.restartRequired?'restart-required':db.reviewRequired?'review-required':'ready'
    return {characterId:db.characterId,activeUid:db.activeUid,credentialUid:onDisk,generation:db.generation,
      boundAccounts:db.accounts.map(x=>({uid:x.uid,boundAt:x.boundAt,lastUsedAt:x.lastUsedAt||0})),
      pendingUid:uidOf(p?.dedeuserid),reviewRequired:!!db.reviewRequired,restartRequired:!!db.restartRequired,
      blocked,reason,cutoverAt:db.cutoverAt,activeOperations}
  }
  const assertReady=()=>{const s=status();if(s.blocked)throw Error('B站账号已冻结（'+s.reason+'）：请在管理中心核验/确认换号，重启后完成账号权限复核');return s}
  // Migrate transport-only state on the *first startup* of this version. Character
  // memory, learned interests, relationships and accepted TODOs stay in the root.
  const runtimeDir=()=>{
    const uid=db.activeUid||''
    if(!uid)return join(accountRoot,'unbound','runtime')
    const dest=join(accountRoot,uid,'runtime');mkdirSync(dest,{recursive:true,mode:0o700})
    if(db.generation===1&&db.legacyUid===uid){
      for(const name of TRANSPORT_FILES){
        const from=join(dataDir,name),to=join(dest,name)
        if(!existsSync(from))continue
        safeFile(from);safeFile(to)
        if(!existsSync(to))renameSync(from,to)
        // If already copied on an interrupted migration, do not overwrite it.
        // Keep the root leftover untrusted instead of reimporting into new UID.
      }
    }
    return dest
  }
  const stage=credential=>{
    const clean=safeCredential(credential)
    atomic(pendingFile,clean);hardenPerms(pendingFile)
    return {ok:true,pendingUid:clean.dedeuserid,activeUid:db.activeUid,requiresConfirmation:clean.dedeuserid!==db.activeUid}
  }
  const cancel=()=>{safeFile(pendingFile);if(existsSync(pendingFile))unlinkSync(pendingFile);return {ok:true}}
  const activate=async({expectedUid}={})=>{
    assertIdle()
    const staged=pending(),uid=uidOf(staged?.dedeuserid)
    if(!uid||uid!==uidOf(expectedUid))throw Error('请核对待切换 UID，当前没有匹配的待确认登录')
    const before=JSON.stringify(staged)
    const proof=await verifier(staged)
    if(uidOf(proof?.uid)!==uid)throw Error('在线登录身份未通过核验，旧账号保持不变')
    if(JSON.stringify(pending())!==before)throw Error('扫码凭证在核验期间已变化，请重新确认')
    assertIdle()
    // Write sealed per-UID credential first, then atomically replace the current
    // MCP credential. The old UID and character memory are retained.
    const sealed=join(accountRoot,uid,'credential.json')
    const previous=current()
    if(db.activeUid&&uidOf(previous?.dedeuserid)===db.activeUid)
      {const oldSeal=join(accountRoot,db.activeUid,'credential.json');atomic(oldSeal,safeCredential(previous));hardenPerms(oldSeal)}
    atomic(sealed,safeCredential(staged));hardenPerms(sealed)
    atomic(credFile,safeCredential(staged));hardenPerms(credFile)
    const changed=uid!==db.activeUid
    if(changed){
      db.activeUid=uid;db.generation+=1;db.cutoverAt=now();db.lastSwitchAt=now();
      db.reviewRequired=true;db.restartRequired=true
      const existing=db.accounts.find(x=>x.uid===uid)
      if(existing)existing.lastUsedAt=now()
      else db.accounts.push({uid,boundAt:now(),lastUsedAt:now(),kind:'verified-switch'})
    }
    save();cancel()
    return {ok:true,verifiedUid:uid,username:proof.username||'',characterId:db.characterId,changed,
      restartRequired:changed,reviewRequired:changed,warning:changed?'新账号已验证，但自动活动被冻结。必须重启 DSH 并确认新账号授权；旧账号待办不得在新账号自动重发。':''}
  }
  const acknowledgeRestart=()=>{
    if(db.restartRequired&&credentialUid()===db.activeUid){db.restartRequired=false;save()}
    return status()
  }
  const resume=({expectedUid}={})=>{
    if(uidOf(expectedUid)!==db.activeUid||!db.activeUid||credentialUid()!==db.activeUid)throw Error('账号 UID 不一致，拒绝复开')
    if(db.restartRequired||pending())throw Error('必须先重启宿主并完成待确认扫码流程')
    db.reviewRequired=false;save();return status()
  }
  const taskAllowed=t=>{
    const s=status();if(s.blocked||!t)return false
    if(!db.activeUid)return false
    if(t.accountUid)return String(t.accountUid)===db.activeUid
    // Tasks created before the first account cutover were bound to that account.
    // They must never become candidates on the new account, even on a return trip.
    return db.generation===1&&db.legacyUid===db.activeUid
  }
  return {status,assertReady,stage,cancel,activate,acknowledgeRestart,resume,runtimeDir,taskAllowed,enterPlatformOperation,
    accountUid:()=>db.activeUid,characterId:()=>db.characterId,generation:()=>db.generation}
}
