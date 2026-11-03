/** Authenticated Bilibili video links are short-lived context candidates only.
 * They never become accepted TODOs here: the existing social AI call must
 * decide whether the fish actually wants to explore one.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
const BV=/\bBV[0-9A-Za-z]{10}\b/g
const UID=/^[1-9]\d{0,18}$/
const MAX_FILE=160_000,DAY=86400_000
function fileOf(home){return join(home,'video-recommendations.json')}
function read(home){
 const file=fileOf(home)
 try{if(!existsSync(file)||lstatSync(file).isSymbolicLink()||lstatSync(file).size>MAX_FILE)return []
  const result=JSON.parse(readFileSync(file,'utf8'));return Array.isArray(result?.entries)?result.entries:[]
 }catch{return []}
}
function write(home,entries){
 mkdirSync(home,{recursive:true});const file=fileOf(home)
 if(existsSync(file)&&lstatSync(file).isSymbolicLink())return false
 const temp=file+'.'+process.pid+'.tmp'
 writeFileSync(temp,JSON.stringify({version:1,entries:entries.slice(-50)},null,2),{encoding:'utf8',mode:0o600})
 renameSync(temp,file);return true
}
/** Extract only verified event identity and BV links; no task intent is inferred. */
export function receiveRecommendations(home,rows,{now=Date.now()}={}){
 const base=read(home).filter(e=>/^BV[0-9A-Za-z]{10}$/.test(e?.bvid||'')&&Number.isFinite(Number(e.at))&&now-Number(e.at)<(e?.accepted===true?7*DAY:2*DAY))
 const known=new Set(base.map(e=>e.bvid+':'+String(e.uid||'')))
 let added=0
 for(const row of Array.isArray(rows)?rows.slice(0,100):[]){
  const at=Number(row?.timestampMs),uid=String(row?.senderUid||''),messageId=String(row?.messageId||'').slice(0,150)
  if(row?.incoming!==true||!Number.isSafeInteger(at)||at<=now-2*DAY||at>now+60_000||!UID.test(uid)||!messageId)continue
  const text=String(row.text||'').slice(0,4000),bvids=[...new Set(text.match(BV)||[])].slice(0,3)
  for(const bvid of bvids){
   const key=bvid+':'+uid
   if(known.has(key))continue
   // Bounded candidate cache: at most five new video leads per sender/day.
   if(base.filter(e=>e.uid===uid&&now-Number(e.at)<DAY).length>=5)continue
   base.push({bvid,at,source:row.source==='B站评论分享'?'B站评论分享':'B站私信分享',
    senderName:String(row.senderName||'').replace(/[\x00-\x1f]/g,' ').slice(0,60),messageId,
    commentBvid:row.source==='B站评论分享'&&/^BV[0-9A-Za-z]{10}$/.test(String(row.bvid||''))?String(row.bvid):'',
    commentRpid:row.source==='B站评论分享'?Number(row.rpid||0):0,
    commentRoot:row.source==='B站评论分享'?Number(row.root||0):0,
    uid,accepted:false,decision:'candidate'})
   known.add(key);added++
  }
 }
 if(added&&!write(home,base))return {added:0,entries:read(home),acceptedEntries:[] ,error:'候选文件不可安全写入'}
 const entries=base.slice(-50)
 return {added,accepted:0,declined:0,entries,acceptedEntries:[]}
}
export function listRecommendationCandidates(home,{now=Date.now(),limit=6}={}){
 return read(home).filter(e=>/^BV[0-9A-Za-z]{10}$/.test(e?.bvid||'')&&Number.isFinite(Number(e.at))
   &&now-Number(e.at)<(e?.accepted===true?7*DAY:2*DAY))
  .slice(-Math.min(10,Math.max(1,limit))).reverse().map(e=>({bvid:e.bvid,source:e.source==='B站评论分享'?'B站评论分享':'B站私信分享'}))
}
/** A recent authenticated candidate may be referenced in the same user's DM. */
export function hasReceivedRecommendation(home,bvid,{uid='',now=Date.now()}={}){
 if(!/^BV[0-9A-Za-z]{10}$/.test(String(bvid||'')))return false
 const sender=String(uid||'')
 return read(home).some(e=>e.bvid===bvid&&(!sender||String(e.uid||'')===sender)&&Number.isFinite(Number(e.at))&&Number(e.at)<=now+60_000&&now-Number(e.at)<2*DAY)
}
