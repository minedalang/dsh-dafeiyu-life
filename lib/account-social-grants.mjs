/** Account-scoped outgoing social permission overlays.
 * Historic global settings are a legacy migration input ONLY on generation 1.
 * A verified new UID starts with no trusted roster or outreach opt-in; updating
 * a visible management setting creates its own per-UID permission snapshot.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
const UID=/^[1-9]\d{0,18}$/
const KEYS=Object.freeze([
 'friendDirectory','mentionTargets','mentionProfiles','dmWhitelist','commentAtWhitelist',
 'lifeProactiveFriendDmEnabled','lifeNaturalDmOutreachEnabled','dmStrangerAutonomyEnabled',
 'dmStrangerOnce','commentAtEnabled','friendAtFeedbackEnabled',
 'socialVideoRecommendationsAuthorizedV2','socialOutreachEnabled','socialLifeIntentEnabled',
 'lifePublicInteractionEnabled','socialAutoSend'])
const DEFAULTS=Object.freeze({friendDirectory:'[]',mentionTargets:'',mentionProfiles:'[]',
 dmWhitelist:'',commentAtWhitelist:'',
 lifeProactiveFriendDmEnabled:false,lifeNaturalDmOutreachEnabled:false,
 dmStrangerAutonomyEnabled:false,dmStrangerOnce:false,commentAtEnabled:false,
 friendAtFeedbackEnabled:false,socialVideoRecommendationsAuthorizedV2:false,
 socialOutreachEnabled:false,socialLifeIntentEnabled:false,lifePublicInteractionEnabled:false,
 socialAutoSend:false})
const extract=raw=>Object.fromEntries(KEYS.map(k=>[k,raw?.[k]??DEFAULTS[k]]))
function safe(path,dir=false){
 if(!existsSync(path))return false
 const st=lstatSync(path)
 if(st.isSymbolicLink()||(dir?!st.isDirectory():!st.isFile()))throw Error('账号社交授权文件不是安全的常规路径')
 return true
}
function atomic(path,obj){
 safe(path)
 const tmp=path+'.'+process.pid+'.'+randomUUID()+'.tmp'
 try{writeFileSync(tmp,JSON.stringify(obj,null,2)+'\n',{flag:'wx',mode:0o600});renameSync(tmp,path)}
 finally{if(existsSync(tmp))unlinkSync(tmp)}
}
export function createAccountSocialGrants({dataDir,accountBinding}={}){
 if(!dataDir||!accountBinding)throw TypeError('账号社交授权需要现有绑定账本')
 const location=()=>{
  const status=accountBinding.status(),uid=String(status.activeUid||'')
  if(status.blocked||!UID.test(uid))return null
  const root=join(dataDir,'accounts'),dir=join(root,uid)
  safe(root,true);safe(dir,true)
  return {status,uid,root,dir,file:join(dir,'social-grants.json')}
 }
 const read=loc=>{
  if(!safe(loc.file))return null
  if(lstatSync(loc.file).size>48_000)throw Error('账号社交授权文件超出容量')
  let data;try{data=JSON.parse(readFileSync(loc.file,'utf8'))}catch{throw Error('账号社交授权文件损坏')}
  if(data?.version!==1||data.uid!==loc.uid||!data.values||typeof data.values!=='object'||Array.isArray(data.values))
   throw Error('账号社交授权文件归属不匹配')
  return extract(data.values)
 }
 const write=(loc,values)=>{
  mkdirSync(loc.dir,{recursive:true,mode:0o700})
  safe(loc.root,true);safe(loc.dir,true)
  atomic(loc.file,{version:1,uid:loc.uid,values:extract(values)})
 }
 // Always return an effective override; an invalid/unverified account cannot
 // inherit the previous account's unreviewed outgoing grants.
 const effective=raw=>{
  const loc=location()
  if(!loc){
   // First-time users may preconfigure the UI before logging in. Such values
   // are only an UNBOUND draft: the account gate cannot send, and they must
   // never turn into the first verified UID's permissions without fresh Save.
   const status=accountBinding.status()
   if(!status.activeUid&&status.reason==='unbound')return {...raw}
   return {...raw,...DEFAULTS}
  }
  let values=read(loc)
  if(!values&&accountBinding.legacyOriginalAccount?.()===true){
   // One-time upgrade: the original account retains its existing grants.
   write(loc,extract(raw));values=read(loc)
  }
  return {...raw,...(values||DEFAULTS)}
 }
 const saveExplicit=patch=>{
  if(!KEYS.some(k=>Object.hasOwn(patch||{},k)))return false
  const loc=location()
  if(!loc){
   const status=accountBinding.status()
   if(!status.activeUid&&status.reason==='unbound')return false // draft, not a grant
   throw Error('当前 B站账号未核验或仍冻结，不得更新社交联系人授权')
  }
  const before=read(loc)||DEFAULTS
  write(loc,{...before,...Object.fromEntries(KEYS.filter(k=>Object.hasOwn(patch,k)).map(k=>[k,patch[k]]))})
  return true
 }
 const canApplyInitialRecommendations=()=>{
  const loc=location()
  return Boolean(loc&&loc.status.generation===1&&loc.status.boundAccounts?.length===1&&
    accountBinding.initialRecommendationAccount?.()===true&&!safe(loc.file))
 }
 const applyInitialRecommendations=()=>{
  if(!canApplyInitialRecommendations())throw Error('初次推荐授权不可用，保留现有权限')
  const loc=location()
  write(loc,{...DEFAULTS,commentAtEnabled:true,lifeProactiveFriendDmEnabled:true,
    lifeNaturalDmOutreachEnabled:true,lifePublicInteractionEnabled:true,
    socialVideoRecommendationsAuthorizedV2:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,socialAutoSend:true})
  return true
 }
 return {effective,saveExplicit,canApplyInitialRecommendations,applyInitialRecommendations}
}
