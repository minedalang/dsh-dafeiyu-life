/**
 * Narrow read-only suggestions from an authenticated owner DM. Natural conversation
 * may span turns, but a new request must be present in the CURRENT owner message;
 * recent owner-only words may supply a referent, never an independent authorization.
 */
import {preserveSearchGoal} from './todo-search-context.mjs'
const BV=/^BV[0-9A-Za-z]{10}$/
const clean=(v,n=120)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const REFUSE=/(?:不要|别|不必|不用|取消|不推荐|不建议|别再|停止|无需|没必要|先别|先不)/
const FUTURE=/(?:推荐|建议|有空|有时候|改天|记得|想让|希望你|以后|抽空|试试|可以|要不要|能不能|帮我|请你|麻烦|去听|听听|去看|看看|找找|了解一下|研究一下|查一下|搜索|搜一下)/
const QUOTED=/(?:转发|引用|据说|别人说|他(?:说|让我)|她(?:说|让我)|假如|比如.*说)/
const REFERENT=/(?:这(?:个|些|件|首|几)|那(?:个|些|件|首|几)|刚才|上面|之前|它|他们|她们|那个话题|那首歌)/
const BAD_TOPIC=/(?:密码|验证码|密钥|隐私|我的通知|个人信息|私信|帐号|账号|cookie|token)/i
export function validateOwnerAiTodo(input,ownerMessage,{priorOwnerMessages=[]}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))return null
  const raw=clean(ownerMessage,600),evidence=clean(input.evidence,160),type=String(input.type||'')
  if(evidence.length<4||!raw.includes(evidence)||REFUSE.test(evidence)||!FUTURE.test(evidence)||QUOTED.test(raw.slice(0,80)))return null
  const prefix=raw.slice(Math.max(0,raw.indexOf(evidence)-12),raw.indexOf(evidence))
  if(/(?:不|别|不要|取消|无需|不必|先不)\s*$/.test(prefix))return null
  if(type==='search_videos'){
    const topic=clean(input.topic,80)
    if(topic.length<2||topic.length>70||BAD_TOPIC.test(topic)||/(?:https?:\/\/|[<>\\`{}\[\];；])/.test(topic))return null
    const subject=topic.replace(/\s+/g,'').replace(/(?:歌曲|视频|合集|现场|演唱会|的歌|音乐)+$/g,'').trim()
    if(subject.length<2||/^(?:这个|那个|一些|任何|随便|歌曲|视频|音乐|他|她|他们|你|我|别人)$/.test(subject))return null
    let contextEvidence=''
    if(!evidence.replace(/\s+/g,'').includes(subject)){
      contextEvidence=clean(input.contextEvidence,160)
      const prior=(Array.isArray(priorOwnerMessages)?priorOwnerMessages:[]).map(s=>clean(s,600))
      // The current request must explicitly refer back, not silently authorize a
      // topic extracted from an old chat, a model response or somebody else's DM.
      if(!REFERENT.test(evidence)||!contextEvidence||!contextEvidence.includes(subject)||
        !prior.some(s=>s.includes(contextEvidence))||QUOTED.test(contextEvidence)||REFUSE.test(contextEvidence))return null
    }
    const search=preserveSearchGoal({topic,evidence,contextEvidence,searchGoal:input.searchGoal})
    const title=clean(input.title,95)
    return {type,topic:search.topic,searchGoal:search.searchGoal,
      title:search.searchGoal==='music'&&(!title||!/(?:歌|音乐|曲|唱|music|song)/i.test(title))
        ?`有空找找音乐「${search.topic}」`:title||`有空了解「${search.topic}」`,
      evidence,...(contextEvidence?{contextEvidence}:{})}
  }
  if(type==='watch_video'){
    const bvid=clean(input.bvid,24)
    if(!BV.test(bvid)||!evidence.includes(bvid))return null
    return {type,bvid,title:clean(input.title,95)||`有空看看 ${bvid}`,evidence}
  }
  return null
}
