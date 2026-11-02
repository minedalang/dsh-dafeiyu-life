/** Received Bilibili BV links are optional candidates, never instructions to the Agent. */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BV=/\bBV[0-9A-Za-z]{10}\b/g
const MAX_FILE=160_000
const DAY=7*86400_000
function quoteUntrustedDm(text){
  // Preserve the *actual* incoming wording for the owner's provenance screen.
  // Never insert this quote into the autonomous planner's prompt or treat it as an instruction.
  // Strip only ASCII control bytes so source text remains safe to display as textContent.
  return String(text||'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,700)
}
function fileOf(home){return join(home,'video-recommendations.json')}
// A plain shared BV remains a short-lived selection lead. Only a real video
// invitation may enter the accepted TODO queue after the existing willingness
// engine agrees. Negations/quotes cannot turn into an affirmative invitation.
export function isVideoInvitation(text){
 const t=String(text||'').slice(0,700).trim()
 if(!t||/(?:别|不要|不必|不用|先别|别再).{0,24}(?:看|推荐|视频)|(?:不想|不需要).{0,16}(?:看|推荐)|(?:取消|撤回).{0,16}(?:推荐|视频)/.test(t))return false
 return /(?:有空|空了|以后|回头|抽空|看看|看一下|看下|推荐|分享|给你看|可以看|值得看|去看|想让你看|你会喜欢|来看看)/.test(t)
}
function read(home){
  const file=fileOf(home)
  try{if(!existsSync(file)||lstatSync(file).isSymbolicLink()||lstatSync(file).size>MAX_FILE)return []
    const result=JSON.parse(readFileSync(file,'utf8'));return Array.isArray(result?.entries)?result.entries:[]
  }catch{return []}
}
export function receiveRecommendations(home,rows,{now=Date.now(),decide=null}={}){
  const base=read(home).filter(e=>typeof e.bvid==='string'&&/^BV[0-9A-Za-z]{10}$/.test(e.bvid)&&now-Number(e.at)<DAY)
  const known=new Set(base.map(e=>e.bvid+':'+String(e.uid||'')))
  let added=0,updated=0,accepted=0,declined=0
  for(const row of Array.isArray(rows)?rows.slice(0,100):[]){
    const age=Number(row?.timestampMs)
    if(row?.incoming!==true||!Number.isFinite(age)||age<now-86400_000||age>now+60000)continue
    const text=String(row.text||'').slice(0,4000)
    // Only explicit BV video recommendations / Bilibili sharing cards; no freeform instructions.
    if(!/BV[0-9A-Za-z]{10}/.test(text))continue
    const bvids=[...new Set(text.match(BV)||[])].slice(0,3)
    const uid=/^[1-9]\d{0,18}$/.test(String(row.senderUid||''))?String(row.senderUid):''
    for(const bvid of bvids){
      const key=bvid+':'+uid
      // The same person can ask again on a DIFFERENT real message; a previous
      // refusal must not become a permanent ban on accepting this BV. Never
      // re-evaluate an identical polled event, nor overwrite accepted tasks.
      if(known.has(key)){
        const old=base.find(x=>x.bvid===bvid&&String(x.uid||'')===uid)
        const msgId=String(row.messageId||'').slice(0,150)
        if(typeof decide==='function'&&old&&old.accepted!==true&&uid&&msgId&&msgId!==old.messageId&&isVideoInvitation(text)){
          try{
            const result=decide({uid,messageId:msgId,bvid,text,channel:row.source==='B站评论分享'?'comment':'dm',at:age})
            const decision=['allow','defer','refuse','blocked'].includes(result?.decision)?result.decision:'blocked'
            old.decision=decision;old.accepted=decision==='allow';old.messageId=msgId;old.at=age;old.commentBvid=row?.source==='B站评论分享'?String(row?.bvid||''):'';old.commentRpid=row?.source==='B站评论分享'?Number(row?.rpid||0):0;old.commentRoot=row?.source==='B站评论分享'?Number(row?.root||0):0
            if(old.accepted)accepted++;else declined++
            updated++
          }catch{declined++}
        }
        continue
      }
      // Prevent one external sender from flooding optional exploration tasks.
      if(uid&&base.filter(e=>e.uid===uid&&now-Number(e.at)<86400_000).length>=5)continue
      // UID is from the authenticated B站 DM inbox adapter, not text supplied by the sender.
      let acceptedTodo=false,decision='candidate'
      if(typeof decide==='function'){
        // Never trust the message body for UID, ID or timestamp evidence.
        const msgId=String(row.messageId||'').slice(0,150)
        if(uid&&msgId&&isVideoInvitation(text)){
          try{const result=decide({uid,messageId:msgId,bvid,text,channel:row.source==='B站评论分享'?'comment':'dm',at:age})
            decision=['allow','defer','refuse','blocked'].includes(result?.decision)?result.decision:'blocked'
            acceptedTodo=decision==='allow'
          }catch{decision='blocked'}
        }
        if(acceptedTodo)accepted++;else declined++
      }
      base.push({bvid,at:age,source:row.source==='B站评论分享'?'B站评论分享':'B站私信分享',senderName:String(row.senderName||'').replace(/[\x00-\x1f]/g,' ').slice(0,60),messageId:String(row.messageId||'').slice(0,150),commentBvid:row.source==='B站评论分享'?String(row.bvid||''):'',commentRpid:row.source==='B站评论分享'?Number(row.rpid||0):0,commentRoot:row.source==='B站评论分享'?Number(row.root||0):0,sourceText:typeof decide==='function'?'':quoteUntrustedDm(text.replace(/[\x00-\x1f]/g,' ')),...(uid?{uid}:{}),...(typeof decide==='function'?{accepted:acceptedTodo,decision}: {})});known.add(key);added++
    }
  }
  if(added||updated){
    const entries=base.slice(-50);mkdirSync(home,{recursive:true})
    const file=fileOf(home);if(existsSync(file)&&lstatSync(file).isSymbolicLink())return {added:0,accepted:0,declined:0,entries:read(home),acceptedEntries:read(home).filter(x=>x.accepted===true)}
    const temp=file+'.'+process.pid+'.tmp'
    writeFileSync(temp,JSON.stringify({version:1,entries},null,2),{encoding:'utf8',mode:0o600});renameSync(temp,file)
  }
  const entries=base.slice(-50)
  return {added,updated,accepted,declined,entries,acceptedEntries:entries.filter(e=>e.accepted===true)}
}
export function listRecommendationCandidates(home,{now=Date.now(),limit=6}={}){
  return read(home).filter(e=>/^BV[0-9A-Za-z]{10}$/.test(e?.bvid||'')
      &&now-Number(e.at)<(e?.accepted===true?DAY:2*86400_000))
    .slice(-Math.min(10,Math.max(1,limit))).reverse().map(e=>({bvid:e.bvid,source:'B站私信分享'}))
}

/** Check the complete 50-item recent queue, not just the six video-Agent suggestions. */
export function hasReceivedRecommendation(home,bvid,{now=Date.now()}={}){
  if(!/^BV[0-9A-Za-z]{10}$/.test(String(bvid||'')))return false
  return read(home).some(e=>e.bvid===bvid&&Number.isFinite(Number(e.at))&&Number(e.at)<=now+60_000&&now-Number(e.at)<DAY)
}
