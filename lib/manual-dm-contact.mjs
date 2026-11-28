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
const ownerReference=/(?:我和你|你和我|我跟你|你跟我|我与你|你与我|我们(?:俩|两个)?|咱们(?:俩)?|你和主人|主人和你|你与主人|主人与你|主人|我)(?:之间|以前|之前|过去|最近|曾经)?(?:的)?(?:[bB]站)?(?:私信|私聊|站内信|聊天记录)/u
export function resolveSessionDmTarget({request='',contact='',talkerUid='',ownerUid='',accountUid='',runtimeDir='',roster=[]}={}){
  const text=String(request||''),ref=typeof contact==='string'?contact.trim():'',uid=typeof talkerUid==='string'?talkerUid.trim():''
  if(!exactUid(accountUid)||typeof runtimeDir!=='string'||!runtimeDir)return deny('account-not-ready')
  const valid=id=>exactUid(id)&&id!==accountUid
  // Current raw owner request must name a DM target. A tool argument or
  // inferred identity from a previous model message is not an authorization.
  if(!text||text.length>=2000||!/(?:私信|私聊|站内信|聊天记录)/u.test(text))return deny('owner-turn-target-required')
  if(ref&&uid)return deny('conflicting-contact-selectors')
  if(uid)return valid(uid)&&text.match(/\d+/g)?.includes(uid)?{ok:true,uid,basis:'explicit-uid'}:deny('owner-turn-target-required')
  if(ref==='owner')return valid(ownerUid)&&ownerReference.test(text)?{ok:true,uid:ownerUid,basis:'bound-owner'}:deny('owner-contact-unavailable')
  if(!ref||ref.length>60||safeName(ref)!==ref||!text.normalize('NFKC').toLocaleLowerCase('zh-CN').includes(normalizeName(ref)))return deny('owner-turn-target-required')
  const anchors=[]
  const add=(id,name,basis)=>{if(valid(id)&&safeName(name))anchors.push({uid:id,name:safeName(name),basis})}
  for(const row of (Array.isArray(roster)?roster:[]).slice(0,120))add(String(row?.uid||''),row?.name,'configured-name')
  // Use existing per-account inbound state only; do not return history or
  // names of nonmatching people. Reply eligibility/opt-outs remain separate.
  try{
    const path=join(runtimeDir,'dm-autoreply-state.json'),st=lstatSync(path)
    if(!st.isFile()||st.isSymbolicLink()||st.size>5_000_000)return deny('contact-index-unavailable')
    const people=JSON.parse(readFileSync(path,'utf8'))?.people
    if(!people||typeof people!=='object'||Array.isArray(people))return deny('contact-index-unavailable')
    for(const [id,p] of Object.entries(people))if(Array.isArray(p?.seen)&&p.seen.length>0)add(id,p.nickname,'account-inbound-name')
  }catch(e){if(e?.code!=='ENOENT')return deny('contact-index-unavailable')}
  // Do not accept a shortened selector embedded in another known name
  // mentioned in the same request. Ask the owner to disambiguate.
  const normalizedText=text.normalize('NFKC').toLocaleLowerCase('zh-CN'),key=normalizeName(ref)
  if(anchors.some(row=>{const name=normalizeName(row.name);return name!==key&&name.includes(key)&&normalizedText.includes(name)}))return deny('contact-ambiguous')
  return resolveAnchoredPerson(ref,anchors)
}

/** Pure, reusable 2.9.x adapter. Accept only host-anchored names; future
 * cognition can supply verified, live aliases here, not model-created UIDs. */
export function resolveAnchoredPerson(reference,anchors=[]){
  const key=normalizeName(reference),exact=new Map(),near=new Map()
  if(!key)return deny('contact-needs-clarification')
  for(const row of anchors){
    if(!exactUid(row?.uid)||!['configured-name','account-inbound-name'].includes(row.basis))continue
    const name=normalizeName(row.name)
    if(name===key)exact.set(row.uid,{ok:true,uid:row.uid,basis:row.basis})
    // Only a configured label can be offered back as a clarification. Never
    // disclose an unapproved private inbox name or silently select fuzzy hits.
    if(row.basis==='configured-name'&&key.length>=2&&name.length>=2&&(name.includes(key)||key.includes(name)||key.length>=3&&name.length>=3&&oneEditApart(key,name)))near.set(row.uid,safeName(row.name))
  }
  if(exact.size===1)return [...exact.values()][0]
  if(exact.size>1)return deny('contact-ambiguous')
  return near.size===1?{ok:false,reason:'contact-needs-clarification',suggestedName:[...near.values()][0]}:deny('contact-needs-clarification')
}

function oneEditApart(a,b){
  const x=Array.from(a),y=Array.from(b)
  if(Math.abs(x.length-y.length)>1)return false
  if(x.length>y.length)return oneEditApart(b,a)
  let i=0,j=0,changes=0
  while(i<x.length&&j<y.length){if(x[i]===y[j]){i++;j++;continue}if(++changes>1)return false;if(x.length===y.length)i++;j++}
  return changes+(y.length-j)+(x.length-i)<=1
}
