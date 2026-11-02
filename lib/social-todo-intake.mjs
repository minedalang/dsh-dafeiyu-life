/**
 * dev.3 narrow social request bridge into the existing accepted-TODO ledger.
 * The event identity comes from Bilibili adapters; message text is data only.
 * Accept only an explicit bounded PUBLIC video search, never private reads/writes.
 * No independent AI model or new willingness score is created here.
 */
import {createHash} from 'node:crypto'
const UID=/^[1-9]\d{0,18}$/
const strip=s=>String(s||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim()
const NEGATIVE=/(?:别|不要|不必|不用|先不|取消|不用你|不想).{0,18}(?:搜|找|查|搜索)|(?:不需要|不许).{0,18}(?:搜|找|查)/
export function parsePublicReadProposal(input){
 const text=String(input||'').trim()
 if(!text||text.length>160||/[\r\n]/.test(text)||NEGATIVE.test(text))return null
 if(/(?:https?:\/\/|BV[0-9A-Za-z]{10}|口令|密码|验证码|私信|通知|收藏|点赞|关注|发布|忽略规则|绕过限制)/i.test(text))return null
 // Strict affirmative standalone request. Incidental quoted/external content is not a task.
 const match=text.match(/^(?:(?:@?大肥鱼|@?鱼鱼)[，,:：!！\s]*)?(?:(?:请|麻烦你|有空|能不能|可以|帮我|替我|给我|去)[，,\s]*){0,3}(?:搜索|搜一下|搜搜|找找|找一下|查找)(?:一下|下|有关|关于)?[：:\s]*(.{2,64}?)(?:[。！!？?])?$/)
 if(!match)return null
 const topic=strip(match[1]).replace(/(?:的视频|的内容|的视频吧|吧|呀|呢)$/,'').trim()
 if(topic.length<2||topic.length>48||/[<>\\`{}\[\];；]/.test(topic))return null
 return {type:'search_videos',topic}
}
export function intakePublicReadProposal({row,channel,decide,todos,now=Date.now()}={}){
 const uid=String(row?.senderUid||''),messageId=String(row?.messageId||'').trim(),at=Number(row?.timestampMs)
 if(!UID.test(uid)||!messageId||messageId.length>150||!['comment','dm'].includes(channel)||row?.incoming!==true||!Number.isFinite(at)||at>now+60_000||now-at>86400_000)return {ok:true,skipped:'unverified-event'}
 const proposal=parsePublicReadProposal(row?.text)
 if(!proposal)return {ok:true,skipped:'not-a-public-search'}
 if(typeof decide!=='function'||!todos?.add)return {ok:false,error:'统一意愿或待办接口不可用'}
 const id=createHash('sha256').update(`${channel}|${uid}|${messageId}|${proposal.type}|${proposal.topic}`).digest('hex').slice(0,36)
 let decision
 try{decision=decide({uid,messageId:`social-task:${messageId}:${id}`,text:row.text,channel,intent:'explore',target:''})}
 catch{return {ok:false,skipped:'willingness-error'}}
 if(decision?.decision!=='allow')return {ok:true,accepted:false,decision:decision?.decision||'blocked'}
 const result=todos.add({type:proposal.type,topic:proposal.topic,title:`鱼鱼想找找：${proposal.topic}`,sourceKey:`social-read:${id}`,origin:{kind:channel==='comment'?'bilibili-comment':'bilibili-dm',uid,messageId,at,quotedText:''},acceptance:{kind:'social-willingness'},note:'公开 B站视频主题搜索：已经过生活域意愿判断，搜索结果不等于观看或听过。'},{source:'recommendation'})
 return {ok:result.ok===true,accepted:result.ok===true,created:result.created===true,error:result.error||''}
}
