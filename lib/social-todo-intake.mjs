/**
 * AI-led, provenance-checked bridge from an existing social reply model call
 * into the single accepted-TODO ledger. This module never classifies intent
 * with keywords and never calls a model. It only validates the model's
 * structured proposal against authenticated, current user messages.
 *
 * Only public read-only exploration is accepted here. External writes, private
 * reads, credentials, and model-invented identities are never TODO candidates.
 */
import {createHash} from 'node:crypto'
import {preserveSearchGoal} from './todo-search-context.mjs'

const UID=/^[1-9]\d{0,18}$/
const BV=/^BV[0-9A-Za-z]{10}$/
const clean=(v,n=180)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const normalize=s=>String(s??'').normalize('NFKC').replace(/[\s\u200b-\u200f\uFEFF]/g,'').replace(/[，,。！？!?、：:；;“”"'`（）()【】\[\]{}]/g,'')
const BAD=/(?:密码|验证码|密钥|隐私|私信|私人资料|个人信息|身份证|手机号|家庭住址|住址|银行卡|通知|登录|账号|帐号|cookie|token|accesskey|api.?key|系统提示|后台配置|https?:\/\/|www\.)/i

function evidenceIn(text,evidence){
 const e=normalize(evidence),t=normalize(text)
 return e.length>=2&&t.includes(e)
}
function topicSupported(topic,text){
 const t=normalize(topic),source=normalize(text)
 if(!t||!source)return false
 if(source.includes(t))return true
 // Semantic classification belongs to the model. This local check only asks
 // whether enough of the model's proposed subject is literally grounded in
 // the cited user text; it deliberately has no task/intent keyword dictionary.
 const cjk=t.match(/[\u3400-\u9fff]/g)||[]
 if(cjk.length>=2){
  const pairs=[]
  for(let i=0;i<cjk.length-1;i++)pairs.push(cjk[i]+cjk[i+1])
  const matched=pairs.filter(pair=>source.includes(pair)).length
  return matched>=Math.max(1,Math.ceil(pairs.length*0.5))
 }
 const tokens=t.match(/[a-z0-9]{2,}/ig)||[]
 return tokens.length>0&&tokens.some(token=>source.toLowerCase().includes(token.toLowerCase()))
}
// This is provenance matching, not intent detection: the model has already
// chosen accept and named a topic. A short new message may supply the song
// title while the same sender's recent message supplied the artist. Require
// a concrete overlapping span, not generic words like "歌" or "那个".
function hasConcreteCurrentAnchor(topic,current){
 const t=normalize(topic),c=normalize(current)
 for(let i=0;i+3<=t.length;i++){
  const span=t.slice(i,i+3)
  if(/[\u3400-\u9fff]{3}/.test(span)&&c.includes(span))return true
 }
 const tokens=t.match(/[a-z0-9]{4,}/ig)||[]
 return tokens.some(token=>c.toLowerCase().includes(token.toLowerCase()))
}
function currentText(messages){
 return (Array.isArray(messages)?messages:[]).map(x=>typeof x==='string'?x:x?.text).filter(Boolean).map(x=>String(x).slice(0,700)).slice(-12).join('\n').slice(-4000)
}
function priorUserText(history,uid,nowMs){
 return (Array.isArray(history)?history:[]).filter(x=>x?.role==='user'&&(!x.uid||String(x.uid)===String(uid))
   &&Number.isSafeInteger(Number(x.at))&&Number(x.at)<=nowMs+60_000&&nowMs-Number(x.at)<=24*3600_000)
  .slice(-12).map(x=>String(x.text||'').slice(0,500)).join('\n').slice(-4000)
}
function candidateFor(input,{current,prior,verifiedBvids}){
 if(!input||typeof input!=='object'||Array.isArray(input))return {ok:false,reason:'missing-ai-candidate'}
 const requestedType=String(input.type||'')
 // A search suggestion does not become an invalid watch task just because
 // the model incorrectly picked watch_video without a verifiable BV.
 const type=requestedType==='watch_video'&&!BV.test(clean(input.bvid,24))&&clean(input.topic,90)?'search_videos':requestedType
 const topic=type==='search_videos'?clean(input.topic,90):''
 let evidence=clean(input.evidence,180)
 let contextEvidence=clean(input.contextEvidence,180)
 // When the AI accepted a search but forgot to quote evidence, anchor it to
 // the actual authenticated current message. Never fabricate an AI decision.
 if(type==='search_videos'&&!evidence&&topicSupported(topic,current))
  evidence=clean(current.slice(-180),180)
 // Some models accidentally quote the previous message as current evidence.
 // Repair ONLY if it really was from this same UID within the 24h history,
 // and the current message concretely names part of that topic (e.g. song).
 if(type==='search_videos'&&evidence&&!evidenceIn(current,evidence)&&!contextEvidence
   &&evidenceIn(prior,evidence)&&hasConcreteCurrentAnchor(topic,current)){
  contextEvidence=evidence
  evidence=clean(current.split('\n').at(-1),180)
 }
 if(!evidenceIn(current,evidence))return {ok:false,reason:'evidence-not-in-current-user-message'}
 let evidencePool=current
 if(contextEvidence){
  if(!evidenceIn(prior,contextEvidence))return {ok:false,reason:'context-evidence-not-in-same-user-history'}
  evidencePool+='\n'+contextEvidence
 }
 if(type==='search_videos'){
  if(topic.length<2||topic.length>80||BAD.test(topic)||/[<>\\`{}\[\];；]/.test(topic))return {ok:false,reason:'unsafe-or-empty-topic'}
  // Partial cross-turn references are accepted only after the AI decided,
  // and only when a concrete part of its topic appears in the current text.
  if(!contextEvidence&&!topicSupported(topic,evidencePool)
    &&hasConcreteCurrentAnchor(topic,current)&&topicSupported(topic,current+'\n'+prior))
    evidencePool+='\n'+prior
  if(!topicSupported(topic,evidencePool))return {ok:false,reason:'topic-not-grounded-in-user-evidence'}
  const search=preserveSearchGoal({topic,evidence,contextEvidence,searchGoal:input.searchGoal})
  const title=clean(input.title,100)
  return {ok:true,task:{type,topic:search.topic,searchGoal:search.searchGoal,
    title:search.searchGoal==='music'&&(!title||!/(?:歌|音乐|曲|唱|music|song)/i.test(title))
      ?`鱼鱼想找找音乐：${search.topic}`:title||`鱼鱼想找找：${search.topic}`,
    evidence, ...(contextEvidence?{contextEvidence}:{})}}
 }
 if(type==='watch_video'){
  const bvid=clean(input.bvid,24)
  if(!BV.test(bvid)||!verifiedBvids.has(bvid))return {ok:false,reason:'video-id-not-grounded'}
  return {ok:true,task:{type,bvid,title:clean(input.title,100)||`鱼鱼有空看看：${bvid}`,evidence}}
 }
 return {ok:false,reason:'unsupported-task-type'}
}

/**
 * Accepts one proposal produced by the same AI call that generated the reply.
 * `decide` is the existing social willingness gate; it can deny but never
 * grant external write permissions. A task is created only after its allow.
 */
export function intakeAiReadProposal({row,channel,todoDisposition,suggestedTodo,currentMessages=[],history=[],recommendationContext='',decide,todos,now=Date.now}={}){
 const uid=String(row?.senderUid||''),messageId=String(row?.messageId||'').trim(),at=Number(row?.timestampMs)
 if(!UID.test(uid)||!messageId||messageId.length>150||!['comment','dm'].includes(channel)||row?.incoming!==true||!Number.isSafeInteger(at)||at>now()+60_000||now()-at>86400_000)
  return {ok:true,skipped:'unverified-event'}
 if(todoDisposition!=='accept')return {ok:true,skipped:({defer:'model-defer',refuse:'model-refuse',none:'no-proposal'})[todoDisposition]||'invalid-disposition'}
 if(typeof decide!=='function'||!todos?.add)return {ok:false,error:'统一意愿或待办接口不可用'}
 const current=currentText(currentMessages.length?currentMessages:[row.text])
 if(!current)return {ok:true,skipped:'empty-current-message'}
 const prior=priorUserText(history,uid,now())
 const recommendationBvids=new Set((String(recommendationContext).match(/BV[0-9A-Za-z]{10}/g)||[]).filter(x=>BV.test(x)))
 const verifiedBvids=new Set([...recommendationBvids,...(BV.test(String(row?.bvid||''))?[String(row.bvid)]:[]),...(current.match(/BV[0-9A-Za-z]{10}/g)||[])])
 const checked=candidateFor(suggestedTodo,{current,prior,verifiedBvids})
 if(!checked.ok)return {ok:true,accepted:false,skipped:checked.reason}
 const task=checked.task
 const messageIds=(Array.isArray(row?.messageIds)?row.messageIds:[messageId]).map(x=>String(x||'').trim()).filter(x=>x&&x.length<=150).slice(-12)
 const stableIds=[...new Set(messageIds.length?messageIds:[messageId])].sort()
 // One incoming event set may create at most one TODO even if a model retry
 // produces a different paraphrase/topic. The AI schema is intentionally one
 // candidate per event; separate messages can create separate candidates.
 const id=createHash('sha256').update(`${channel}|${uid}|${stableIds.join('|')}`).digest('hex').slice(0,36)
 let willingness
 try{willingness=decide({uid,messageId:`social-todo:${messageId}:${id}`,text:current,channel,intent:'explore',target:task.bvid||'',thread:String(row?.thread||'')})}
 catch{return {ok:false,skipped:'willingness-error'}}
 if(willingness?.decision!=='allow')return {ok:true,accepted:false,decision:willingness?.decision||'blocked',reason:willingness?.reason||'willingness-denied'}
 const result=todos.add({type:task.type,topic:task.topic||'',searchGoal:task.searchGoal||'general',bvid:task.bvid||'',title:task.title,
  sourceKey:`social-ai-read:${id}`,
  origin:{kind:channel==='comment'?'bilibili-comment':'bilibili-dm',uid,
   messageId,senderName:clean(row?.senderName,60),at,quotedText:'',
   commentBvid:channel==='comment'&&BV.test(String(row?.bvid||''))?String(row.bvid):'',
   commentRpid:channel==='comment'?row?.rpid:0,commentRoot:channel==='comment'?row?.root:0},
  acceptance:{kind:'ai-social-willingness'},
  note:'由本次社交 AI 对话理解并接受的公开只读探索建议；任务结果不代表已经观看或听过。'
 },{source:'recommendation'})
 return {ok:result.ok===true,accepted:result.ok===true,created:result.created===true,duplicate:result.duplicate===true,
  item:result.item||null,error:result.error||'',decision:'allow'}
}
