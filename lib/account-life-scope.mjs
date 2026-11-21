/** Stable Life provenance for a verified Bilibili UID across Cookie rotation.
 * Keep the first trusted HMAC tag for compatibility with existing Life ledgers.
 * This is NOT a new identity, login proof or memory database. The binding
 * ledger remains authoritative; a damaged scope file must fail closed.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,unlinkSync,linkSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {discussionAccountTag} from './video-discussion-diagnostics.mjs'
const UID=/^[1-9]\d{0,18}$/
const TAG=/^[a-f0-9]{16}$/
function safe(path,folder=false){
 if(!existsSync(path))return false
 const st=lstatSync(path)
 if(st.isSymbolicLink()||(folder?!st.isDirectory():!st.isFile()))throw Error('Life 账号来源路径不安全')
 return true
}
export function currentLifeAccountScope({dataDir,accountBinding,credential}={}){
 const status=accountBinding?.status?.()
 const uid=String(status?.activeUid||'')
 const firstTag=discussionAccountTag(credential)
 if(status?.blocked||!UID.test(uid)||String(credential?.dedeuserid||'')!==uid||!TAG.test(firstTag))return ''
 if(!dataDir)throw Error('Life 账号来源目录不可用')
 const root=join(dataDir,'accounts'),folder=join(root,uid),file=join(folder,'life-account-scope.json')
 safe(root,true);safe(folder,true)
 const read=()=>{
  if(!safe(file))return null
  const st=lstatSync(file)
  if(st.size>2048)throw Error('Life 账号来源文件过大')
  let data
  try{data=JSON.parse(readFileSync(file,'utf8'))}catch{throw Error('Life 账号来源文件损坏')}
  if(data?.version!==1||data.uid!==uid||!TAG.test(data.tag))throw Error('Life 账号来源文件不匹配')
  return data.tag
 }
 const stored=read();if(stored)return stored
 // Only bind the current credential's legacy tag on first trusted use. Do not
 // re-label any old account record, including already faded/forgotten memory.
 mkdirSync(folder,{recursive:true,mode:0o700})
 safe(root,true);safe(folder,true)
 const tmp=file+'.'+process.pid+'.'+randomUUID()+'.tmp'
 try{
  writeFileSync(tmp,JSON.stringify({version:1,uid,tag:firstTag})+'\n',{flag:'wx',mode:0o600})
  // If another instance finished first, never overwrite its established tag.
  const raced=read();if(raced)return raced
  // Use an exclusive link to prevent overwriting a concurrently created file.
  // linkSync fails closed when another process already owns the destination.
  linkSync(tmp,file)
 }catch(e){
  // EEXIST is a normal racing creation, but must verify the winner.
  if(e?.code!=='EEXIST')throw e
 }finally{try{unlinkSync(tmp)}catch{}}
 return read()||''
}
