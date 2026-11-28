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

// 2.8.3 -> 2.9.x: resolve a human reference to a platform target, NOT a
// disclosure grant. Sources must already have a UID anchor. No persistent
// alias table, no semantic guessing, no platform requests or body delivery.
const exactUid=value=>typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value)&&Number.isSafeInteger(Number(value))
const normalizeName=value=>safeName(value).normalize('NFKC').toLocaleLowerCase('zh-CN')
// Identity resolution is not interpretation of the owner's utterance. The
// original Life decision must independently confirm the semantic target and
// scope before any disclosure. Explicit numeric selectors retain their
// original literal provenance requirement; no model-invented UID is trusted.
export function resolveSessionDmTarget({request='',contact='',talkerUid='',ownerUid='',accountUid='',runtimeDir='',roster=[]}={}){
  const text=String(request||''),ref=typeof contact==='string'?contact.trim():'',uid=typeof talkerUid==='string'?talkerUid.trim():''
  if(!exactUid(accountUid)||typeof runtimeDir!=='string'||!runtimeDir)return deny('account-not-ready')
  const valid=id=>exactUid(id)&&id!==accountUid
  if(!text||text.length>=2000)return deny('owner-turn-target-required')
  if(ref&&uid)return deny('conflicting-contact-selectors')
  if(uid)return valid(uid)&&text.match(/\d+/g)?.includes(uid)?{ok:true,uid,basis:'explicit-uid'}:deny('owner-turn-target-required')
  if(ref==='owner')return valid(ownerUid)?{ok:true,uid:ownerUid,basis:'bound-owner'}:deny('owner-contact-unavailable')
  if(!ref||ref.length>60||safeName(ref)!==ref)return deny('owner-turn-target-required')
  const anchors=[]
  const add=(id,name,basis)=>{if(valid(id)&&safeName(name))anchors.push({uid:id,name:safeName(name),basis})}
  for(const row of (Array.isArray(roster)?roster:[]).slice(0,120))add(String(row?.uid||''),row?.name,'configured-name')
  try{
    const path=join(runtimeDir,'dm-autoreply-state.json'),st=lstatSync(path)
    if(!st.isFile()||st.isSymbolicLink()||st.size>5_000_000)return deny('contact-index-unavailable')
    const people=JSON.parse(readFileSync(path,'utf8'))?.people
    if(!people||typeof people!=='object'||Array.isArray(people))return deny('contact-index-unavailable')
    for(const [id,p] of Object.entries(people))if(Array.isArray(p?.seen)&&p.seen.length>0)add(id,p.nickname,'account-inbound-name')
  }catch(e){if(e?.code!=='ENOENT')return deny('contact-index-unavailable')}
  return resolveAnchoredPerson(ref,anchors)
}

/** Pure, reusable 2.9.x adapter. Accept only host-anchored names; future
 * cognition can supply verified, live aliases here, not model-created UIDs. */
export function resolveAnchoredPerson(reference,anchors=[]){
  const key=normalizeName(reference),exact=new Map()
  if(!key)return deny('contact-needs-clarification')
  for(const row of anchors){
    if(!exactUid(row?.uid)||!['configured-name','account-inbound-name'].includes(row.basis))continue
    if(normalizeName(row.name)===key)exact.set(row.uid,{ok:true,uid:row.uid,basis:row.basis})
  }
  if(exact.size===1)return [...exact.values()][0]
  return deny(exact.size>1?'contact-ambiguous':'contact-needs-clarification')
}
