/** Shared classification policy for private Life Memory evidence and insights.
 * Raw DMs, arbitrary chat excerpts, and sensitive personal data never enter
 * archive, reflection candidates, or a model prompt. */
import {createHash} from 'node:crypto'
const UID=/^[1-9]\d{0,18}$/
const clean=(x,n=260)=>String(x??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const digest=x=>createHash('sha256').update(String(x)).digest('hex').slice(0,20)
const SENSITIVE=/(?:密码|验证码|密钥|token|cookie|api.?key|身份证|银行卡|信用卡|住址|家庭地址|手机号|电话(?:号码)?|邮箱|邮件地址|病历|诊断|医疗记录|自伤|自杀|私密照片|成人内容|性经历|账号凭证|微信号|qq号|系统提示词|忽略.{0,8}指令)/i
const IDENTIFIER=/(?:1[3-9]\d{9}|\b\d{7,}\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|https?:\/\/\S+)/i
const INSTRUCTION=/(?:忽略.{0,10}(?:规则|指令)|系统消息|开发者消息|请执行命令|执行以下代码|将.*发送给|泄露)/i
export const privateScope=(source,role,uid)=>{
 const actor=String(uid||'')
 if(!['owner-session','owner-dm','friend-dm'].includes(source))return null
 if(source==='owner-session'&&role==='owner')return {visibility:'owner-private',subjectUid:'owner'}
 if(source==='owner-dm'&&role==='owner'&&UID.test(actor))return {visibility:'owner-private',subjectUid:'owner'}
 if(source==='friend-dm'&&role==='friend'&&UID.test(actor))return {visibility:'friend-private',subjectUid:actor}
 return null
}
/** Deterministic, deliberately sparse evidence; never persist incoming text. */
export function preparePrivateLifeEvent({source,role,uid='',eventId='',text='',at=Date.now(),validated=false}={}){
 const scope=privateScope(source,role,uid),raw=clean(text,1000),id=clean(eventId,200)
 if(!scope||!id||!raw||SENSITIVE.test(raw)||IDENTIFIER.test(raw)||INSTRUCTION.test(raw))return null
 let summary=''
 if(/(?:别|不要|不想|减少|请勿).{0,15}(?:主动|私信|联系|打扰|催|回复)/.test(raw))summary='对方明确表达了减少主动联系或打扰的边界；我应该尊重这项请求'
 else if(/(?:累了|疲惫|工作.*累|想.*轻松|不想.*分析|别.*分析)/.test(raw))summary='对方表示当下希望更轻松的交流方式；我需要尊重实际表达而非猜测情绪'
 else if(/(?:谢谢|感谢|抱歉|对不起|误会|解释清楚)/.test(raw))summary='这次交流出现了明确的感谢、道歉或误会澄清；可以反思如何更礼貌地交流'
 else if(/(?:喜欢|讨厌|更希望|更喜欢|偏好|约定|答应|习惯)/.test(raw))summary='对方明确表达了一项偏好、习惯或约定；具体事实应只通过其受限长期记忆入口核验'
 else if(validated&&source==='owner-session'&&/(?:共同|经历|计划|目标|项目|承诺|认识)/.test(raw))summary='主人在主 Session 确认了一项有持续意义的交流事实；应尊重既有约定和事实边界'
 if(!summary)return null
 const t=Number(at)
 if(!Number.isFinite(t)||t<=0)return null
 return {kind:'private-social',key:`private:${source}:${digest(scope.subjectUid+':'+id)}`,source,
   visibility:scope.visibility,subjectUid:scope.subjectUid,sensitivity:'low',text:summary,
   at:t,privacyReviewed:true}
}
export function canReadPrivate({visibility='',subjectUid='',domain='',role='',actorUid=''}={}){
 if(visibility==='owner-private')return role==='owner'&&(domain==='main-session'||domain==='bili-dm')
 if(visibility==='friend-private')return domain==='bili-dm'&&role==='friend'&&UID.test(String(actorUid||''))&&String(actorUid)===String(subjectUid)
 return false
}
export function privateInsightSafe(text){
 const value=clean(text,480)
 // Reflection output can contain hallucinated quotes or identifiers. Fail closed.
 return value.length>=12&&!SENSITIVE.test(value)&&!IDENTIFIER.test(value)&&!INSTRUCTION.test(value)
   &&!/(?:他的|她的|那个人|别人).{0,8}(?:私信|秘密|隐私)/.test(value)
}
export const __test={digest,SENSITIVE,IDENTIFIER}
