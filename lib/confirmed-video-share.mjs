/** dev.29: a sent Life video DM is a recipient-scoped conversation fact.
 * This reads the existing social-intentions ledger; it is NOT a second memory.
 * Never recover an untagged legacy item through an inferred account identity.
 */
import {existsSync,lstatSync,readFileSync} from 'node:fs'
import {join} from 'node:path'

const BV=/^BV[0-9A-Za-z]{10}$/
const UID=/^[1-9]\d{0,18}$/
const TAG=/^[a-f0-9]{16}$/
const DAY=86_400_000
const clean=(x,n=120)=>String(x??'').replace(/[\x00-\x1f\x7f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const requestLink=text=>/(?:链接|网址|地址|BV号|发(?:给|我|下|一下)|给我.{0,8}看看|怎么(?:打开|看)|分享.{0,6}那(?:条|个))/.test(String(text||''))
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
export function confirmedRecentVideoShare(dataDir,{uid='',accountTag='',text='',now=Date.now(),maxAgeMs=3*DAY}={}){
 if(!UID.test(String(uid))||!TAG.test(String(accountTag))||!requestLink(text))return null
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
 const selected=explicit.length?rows.filter(x=>explicit.includes(x.bvid)):rows
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
 return '【本账号已确认向当前收件人发出的最近一次公开视频推荐，仅供本次回答】'+JSON.stringify({bvid:share.bvid,title:share.title,url:share.url})+'。对方现在要链接时可以直接给出此标准 URL；这证明曾分享并确认发送，不证明已经完整观看或了解视频内容。不要搜索或猜测其他视频。'
}
