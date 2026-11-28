/** Existing owner action ledger and permission flags. No text-to-action dispatch. */
import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const clamp=(v,n=200)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n)
export const OWNER_DM_ACTION_FLAGS=Object.freeze({
  like:'ownerDmLikeEnabled',collect:'ownerDmCollectEnabled',follow:'ownerDmFollowEnabled',unfollow:'ownerDmFollowEnabled',
  comment_draft:'ownerDmCommentDraftEnabled',comment_publish:'ownerDmCommentPublishEnabled',comment_publish_draft:'ownerDmCommentPublishEnabled',
  dynamic_draft:'ownerDmDynamicDraftEnabled',dynamic_publish:'ownerDmDynamicPublishEnabled',message:'ownerDmFriendMessageEnabled',
})
const maxSize=300_000
function diskRead(file){
  if(!existsSync(file))return {version:1,items:[],drafts:[]}
  const st=lstatSync(file)
  if(!st.isFile()||st.isSymbolicLink()||st.size>maxSize)throw Error('主人私信操作账本不安全')
  const d=JSON.parse(readFileSync(file,'utf8'))
  if(d.version!==1||!Array.isArray(d.items)||!Array.isArray(d.drafts))throw Error('主人私信操作账本版本不兼容')
  return d
}
function diskWrite(file,d){
  mkdirSync(join(file,'..'),{recursive:true})
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('主人私信操作账本是符号链接')
  d.items=d.items.slice(-300);d.drafts=d.drafts.slice(-100)
  const temp=file+'.'+process.pid+'.tmp'
  writeFileSync(temp,JSON.stringify(d,null,2)+'\n',{encoding:'utf8',mode:0o600})
  renameSync(temp,file)
}
export function createOwnerDmActionLedger({dataDir,now=Date.now}={}){
  const file=join(dataDir,'owner-dm-actions.json')
  const claim=({uid,messageId,timestampMs,action,enabled})=>{
    const uidText=String(uid),id=clamp(messageId,120),time=Number(timestampMs)
    if(!enabled||!/^[1-9]\d{0,18}$/.test(uidText)||!id||!action||!OWNER_DM_ACTION_FLAGS[action.type])return {ok:false,reason:'not-allowed'}
    // Never execute old inbox history or future-dated messages as fresh commands.
    if(!Number.isSafeInteger(time)||time>now()+60_000||now()-time>15*60_000)return {ok:false,reason:'stale-message'}
    const d=diskRead(file),key=uidText+':'+id
    if(d.items.some(x=>x.key===key))return {ok:false,reason:'duplicate'}
    const row={key,type:action.type,at:now(),status:'started'}
    d.items.push(row);diskWrite(file,d) // Persist BEFORE externally visible action; crash => no blind retry.
    return {ok:true,key}
  }
  const finish=(key,result)=>{
    const d=diskRead(file),r=d.items.find(x=>x.key===key)
    if(r){r.status=result?.ok===true?'done':result?.uncertain===true?'uncertain':'failed';r.finishedAt=now();r.reason=clamp(result?.error||result?.summary||'',160);diskWrite(file,d)}
  }
  const addDraft=({bvid,text})=>{
    const d=diskRead(file),row={id:randomUUID(),bvid:String(bvid),text:clamp(text,1000),status:'draft',at:now()}
    d.drafts.push(row);diskWrite(file,d);return row
  }
  const getDraft=(id)=>diskRead(file).drafts.find(d=>d.id===id&&d.status==='draft')||null
  const lockDraft=(id)=>{
    const d=diskRead(file),row=d.drafts.find(d=>d.id===id&&d.status==='draft')
    if(!row)return null
    row.status='attempted';row.attemptedAt=now();diskWrite(file,d)
    return {...row}
  }
  return {claim,finish,addDraft,getDraft,lockDraft,stats:()=>{const d=diskRead(file);return {recent:d.items.slice(-20).map(x=>({type:x.type,status:x.status,at:x.at,reason:x.reason||''})),drafts:d.drafts.filter(x=>x.status==='draft').map(x=>({id:x.id,bvid:x.bvid,at:x.at}))}}}
}
