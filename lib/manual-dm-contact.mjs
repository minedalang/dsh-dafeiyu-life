/**
 * Main-Session-only read of an authenticated inbound DM contact.
 * This is NOT an autonomous DM allowlist and never changes friend permissions.
 * Only minimal metadata is returned; private message text stays on disk.
 */
import {lstatSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
const UID=/^[1-9][0-9]{0,18}$/
const safeName=value=>String(value||'').trim().replace(/[\r\n\0<>]/g,'').slice(0,60)
const deny=reason=>({ok:false,reason})
export function resolveExistingDmContact({runtimeDir,accountUid,receiverUid='',receiverName=''}={}){
  if(!UID.test(String(accountUid||''))||typeof runtimeDir!=='string'||!runtimeDir)
    return deny('account-not-ready')
  const uid=String(receiverUid||'').trim(),name=safeName(receiverName)
  if(uid&&!UID.test(uid))return deny('invalid-recipient-uid')
  // Require the owner to specify a known nickname, not merely an arbitrary UID.
  if(!name||name!==String(receiverName||'').trim())return deny('recipient-name-required')
  let people
  try{
    const path=join(runtimeDir,'dm-autoreply-state.json'),st=lstatSync(path)
    if(!st.isFile()||st.isSymbolicLink()||st.size>5_000_000)return deny('dm-contact-state-unavailable')
    people=JSON.parse(readFileSync(path,'utf8'))?.people
    if(!people||typeof people!=='object'||Array.isArray(people))return deny('dm-contact-state-unavailable')
  }catch{return deny('dm-contact-state-unavailable')}
  const matches=Object.entries(people).filter(([id,p])=>UID.test(id)&&id!==String(accountUid)&&
    (!uid||uid===id)&&safeName(p?.nickname)===name&&Array.isArray(p?.seen)&&p.seen.length>0)
  if(matches.length!==1)return deny(matches.length>1?'recipient-name-ambiguous':'verified-incoming-dm-not-found')
  const [contactUid,person]=matches[0]
  const boundary=person.dmContactBoundaries?.[String(accountUid)]||
    (person.dmContactBoundary?.accountUid===String(accountUid)?person.dmContactBoundary:null)
  if(boundary?.status==='stop')return deny('recipient-requested-no-contact')
  // A current, actual inbound conversation is required. A cached nickname or a
  // baseline-only seen marker must not authorize arbitrary unsolicited messages.
  const lastIncoming=(Array.isArray(person.history)?person.history:[])
    .filter(x=>x?.role==='user'&&Number.isFinite(Number(x.at))&&Number(x.at)>0)
    .sort((a,b)=>Number(b.at)-Number(a.at))[0]
  if(!lastIncoming)return deny('incoming-context-unavailable')
  const at=Number(lastIncoming.at)
  if(Number(person.lastRepliedAt||0)>=at)return deny('incoming-already-replied')
  const lastSeen=person.seen.findLast(x=>typeof x==='string'&&x.length>0&&x.length<=150)
  if(!lastSeen)return deny('verified-incoming-dm-not-found')
  return {ok:true,uid:contactUid,nickname:name,sourceMessageId:lastSeen,incomingAt:at}
}
