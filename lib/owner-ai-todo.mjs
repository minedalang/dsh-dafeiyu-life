/**
 * Narrow read-only suggestions from an authenticated owner DM. Natural conversation
 * may span turns, but a new request must be present in the CURRENT owner message;
 * recent owner-only words may supply a referent, never an independent authorization.
 */
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
    return {type,topic,title:clean(input.title,95)||`有空了解「${topic}」`,evidence,...(contextEvidence?{contextEvidence}:{})}
  }
  if(type==='watch_video'){
    const bvid=clean(input.bvid,24)
    if(!BV.test(bvid)||!evidence.includes(bvid))return null
    return {type,bvid,title:clean(input.title,95)||`有空看看 ${bvid}`,evidence}
  }
  return null
}
/** High-precision fallback only when the model itself expressly accepts a TODO.
 * This never selects willingness and never expands task privileges. */
export function parseExplicitOwnerReadSuggestion(message){
  const raw=clean(message,600)
  if(!raw||QUOTED.test(raw.slice(0,80))||REFUSE.test(raw)||BAD_TOPIC.test(raw))return null
  const match=raw.match(/(?:^|[，。！!\s])(?:你|肥鱼|鱼鱼|大肥鱼)?[，,:：\s]*(?:(?:等?有空(?:的?时候|时)?|以后|改天|抽空|哪天|方便的话|我建议你|推荐你|我希望你|希望你|能不能|请你|帮我|你可以|可以|想让你|要不要|试试|有时候)[，,\s]*){1,3}(?:去|来|先)?\s*(?:搜索|搜一下|搜搜|找找|找一下|听听|听一下|看看|看一下|了解一下|了解|研究一下|研究|学习一下)\s*(.{2,90})$/)
  if(!match)return null
  const target=clean(match[1],90).split(/(?:[，,。！？!]|\s+(?=好听|挺好|不错|我觉得|真的很|好听的))/,1)[0].replace(/[。？！!？～~]+$/,'').replace(/(?:吧|呀|呢|好吗|好不好|可以吗)$/,'').trim().replace(/的喝\s*歌$/,'的歌')
  if(!target||/https?:\/\//i.test(target))return null
  const evidence=raw.slice(match.index).trim()
  const bv=target.match(/BV[0-9A-Za-z]{10}/)?.[0]
  if(bv&&target.replace(bv,'').replace(/(?:这个|那条|视频|看看|一下|的)/g,'').trim()==='')
    return validateOwnerAiTodo({type:'watch_video',bvid:bv,evidence},raw)
  return validateOwnerAiTodo({type:'search_videos',topic:target,title:`有空了解「${target}」`,evidence},raw)
}

/** Only recover an unmistakable first-person future commitment from the SAME
 * model's own reply when an older model omitted todoDisposition. The owner
 * message must still independently pass the read-only proposal validator. */
export function modelCommittedToFutureRead(reply){
  const s=clean(reply,400)
  if(/(?:不想|不会|不打算|先不|不能|还没决定|不确定|先别).{0,18}(?:找|搜|听|看|了解|研究|安排)/.test(s))return false
  return /(?:^|[。！!，,])\s*(?:(?:好呀|好啊|可以呀|可以啊|没问题|行呀|行啊)[，,！!\s]*)?(?:等?有空|改天|以后|之后|下次)?\s*我(?:会|打算|准备|想)?(?:再|去)?(?:找找|找一下|找|搜索|搜一下|看看|看一下|听听|听一下|了解一下|研究一下|查一下)/.test(s)&&
    /(?:好呀|好啊|可以呀|可以啊|没问题|行呀|行啊|我会|我打算|我准备|我想)/.test(s)
}
