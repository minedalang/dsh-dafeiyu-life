/** dev.29: a sent Life video DM is a recipient-scoped conversation fact.
 * This reads the existing social-intentions ledger; it is NOT a second memory.
 * Never recover an untagged legacy item through an inferred account identity.
 */
import {existsSync,lstatSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {verifiedLifeActionEvent} from './life-action-memory.mjs'

const BV=/^BV[0-9A-Za-z]{10}$/
const UID=/^[1-9]\d{0,18}$/
const TAG=/^[a-f0-9]{16}$/
const DAY=86_400_000
const clean=(x,n=120)=>String(x??'').replace(/[\x00-\x1f\x7f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const requestLink=text=>/(?:链接|网址|地址|BV号|发(?:给|我|下|一下)|给我.{0,8}看看|怎么(?:打开|看)|分享.{0,6}那(?:条|个))/.test(String(text||''))
// A natural reference to a previous recommendation is also recall intent;
// it must not be limited to an immediately following “give me the link”.
const requestPastShare=text=>/(?:上次|之前|以前|前几天|那次|你曾|你给我|鱼鱼给我).{0,35}(?:推荐|分享).{0,26}(?:视频|那条|那部|那个|BV|链接|看的|作品|$)|(?:推荐|分享).{0,24}(?:给我|我的|过的).{0,18}(?:视频|那条|那个|$)/i.test(String(text||''))
const STOP=/上次|之前|以前|前几天|那次|你曾|你给我|鱼鱼给我|推荐|分享|过的|那个|这条|那条|这部|那部|视频|链接|网址|给我|看看|看下|一下|记得|还记得|是什么|叫什么|我想|想看|找到|可以|能不能|发来|发我|发给我|的|了|吗|呀|呢|啊|不/g
const titleTerms=text=>{const t=String(text||'').normalize('NFKC').toLowerCase().replace(STOP,' ').replace(/BV[A-Za-z0-9]{10}/g,' ')
 return [...new Set((t.match(/[a-z0-9]{3,}|[\u3400-\u9fff]{2,}/g)||[]).filter(x=>x.length>=2))].slice(0,10)}
export const verifiedBiliVideoUrl=bvid=>BV.test(String(bvid||''))?'https://www.bilibili.com/video/'+bvid:''
export function attachVerifiedBiliVideoUrl(text,bvid,{limit=230}={}){
 const url=verifiedBiliVideoUrl(bvid)
 if(!url)throw Error('不能给没有核验 BV 的推荐补链接')
 const value=clean(text,Math.max(1,limit))
 // A model-provided different video URL must never survive a trusted-link attachment.
 const links=[...value.matchAll(/(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/gi)]
 if(links.some(m=>m[1]!==bvid))throw Error('推荐草稿中的视频链接与真实 BV 不一致')
 if(value.includes(url))return value
 // No model controls the link bytes; trim only the prose to fit the DM limit.
 const allowance=Math.max(0,limit-url.length-1)
 return value.slice(0,allowance).trimEnd()+'\n'+url
}
function readLedger(dir){
 const path=join(dir,'social-intentions.json')
 if(!existsSync(path))return null
 const stat=lstatSync(path)
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>400_000)return null
 const body=JSON.parse(readFileSync(path,'utf8'))
 return body?.version===1&&Array.isArray(body.items)&&Array.isArray(body.sent)?body:null
}
/** Scope is the *authenticated sender account*, uid is the actual recipient.
 * Ambiguous recent recommendations are never silently resolved by title similarity.
 */
export function confirmedRecentVideoShare(dataDir,{uid='',accountTag='',text='',now=Date.now(),maxAgeMs=180*DAY}={}){
 if(!UID.test(String(uid))||!TAG.test(String(accountTag))||!(requestLink(text)||requestPastShare(text)))return null
 let doc
 try{doc=readLedger(dataDir)}catch{return null}
 if(!doc)return null
 const explicit=[...new Set(String(text).match(/BV[0-9A-Za-z]{10}/g)||[])]
 const rows=doc.items.filter(x=>x&&x.status==='sent'&&x.type==='interest-share'&&
   x.uid===String(uid)&&x.accountTag===accountTag&&BV.test(String(x.bvid||''))&&
   Number.isSafeInteger(x.sentAt)&&now>=x.sentAt&&now-x.sentAt<=maxAgeMs&&
   doc.sent.some(s=>s.id===x.id&&s.uid===uid&&s.accountTag===accountTag))
  .sort((a,b)=>b.sentAt-a.sentAt)
 if(!rows.length)return null
 const terms=requestPastShare(text)?titleTerms(text):[]
 // A named topic must actually occur in the original verified title. Do not
 // guess by cosine similarity and do not silently choose an unrelated share.
 const titleMatches=terms.length?rows.map(row=>({row,hits:terms.filter(term=>
   String(row.title||'').normalize('NFKC').toLowerCase().includes(term)).length}))
   .filter(x=>x.hits>0).sort((a,b)=>b.hits-a.hits):[]
 const top=titleMatches[0]?.hits||0
 const selected=explicit.length?rows.filter(x=>explicit.includes(x.bvid)):
   top>0?titleMatches.filter(x=>x.hits===top).map(x=>x.row):terms.length?[]:rows
 if(!selected.length||explicit.length>1)return null
 if(selected.length>1&&!explicit.length){
   // If multiple recommendations are plausible, surface candidates as an
   // ambiguity, not as a fake single answer.
   return {ambiguous:true,items:selected.slice(0,3).map(x=>({bvid:x.bvid,title:clean(x.title,100),url:verifiedBiliVideoUrl(x.bvid),at:x.sentAt}))}
 }
 const x=selected[0]
 return {bvid:x.bvid,title:clean(x.title,100),url:verifiedBiliVideoUrl(x.bvid),at:x.sentAt,sourceId:x.id,ambiguous:false}
}
export const confirmedShareNeedsLink=requestLink
export function confirmedShareReplyMatches(reply,share){
 if(!share||share.ambiguous)return true
 const links=[...String(reply||'').matchAll(/(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/gi)]
 return links.some(m=>m[1]===share.bvid)&&links.every(m=>m[1]===share.bvid)
}
export function confirmedSharePromptContext(share){
 if(!share)return ''
 if(share.ambiguous)return '【本账号已确认向这位收件人发过多条视频推荐，所问链接不唯一】'+JSON.stringify(share.items)+'。不要猜其中一条；自然询问对方指哪一条，或分别给出带标题的链接。'
 return '【本账号向当前收件人发出的已核验历史公开视频推荐，仅供本次回答】'+JSON.stringify({bvid:share.bvid,title:share.title,url:share.url})+'。对方现在要链接时可以直接给出此标准 URL；这证明曾分享并确认发送，不证明已经完整观看或了解视频内容。不要搜索或猜测其他视频。'
}

/** Backfill only independently confirmed, account-scoped past sends. No
 * model-generated draft or unscoped legacy item becomes a historical action.
 * The Life gateway's archiveKeys ensures faded/forgotten episodes do not revive.
 */
export function verifiedShareMemoryEvents(dataDir,{accountTag='',now=Date.now(),maxAgeMs=90*DAY,limit=80}={}){
 if(!TAG.test(String(accountTag)))return []
 let doc;try{doc=readLedger(dataDir)}catch{return []}
 if(!doc)return []
 const sent=new Set(doc.sent.filter(s=>s&&s.accountTag===accountTag&&UID.test(String(s.uid||'')))
   .map(s=>String(s.id)+'\0'+String(s.uid)))
 return doc.items.filter(x=>x&&x.type==='interest-share'&&x.status==='sent'&&
   x.accountTag===accountTag&&UID.test(String(x.uid||''))&&BV.test(String(x.bvid||''))&&
   Number.isSafeInteger(x.sentAt)&&x.sentAt<=now&&now-x.sentAt<=maxAgeMs&&
   sent.has(String(x.id)+'\0'+String(x.uid))).slice(-Math.max(0,Math.min(80,limit)))
  .map(x=>verifiedLifeActionEvent({action:'share_video',accountTag,sourceId:'social-intent:'+x.id,
    bvid:x.bvid,title:x.title,recipientUid:x.uid,at:x.sentAt,verified:true})).filter(Boolean)
}
