/** Read-only TODO proposals extracted by the *existing* authenticated owner-DM model turn.
 * Model text is untrusted: accept only a supported read action, an exact owner quote,
 * and a topic/BV anchored in that quote. Never accept public write permissions here.
 */
const BV=/^BV[0-9A-Za-z]{10}$/
const clean=(v,n=120)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const REFUSE=/(?:不要|别|不必|不用|取消|不推荐|不建议|别再|停止|无需|没必要)/
const FUTURE=/(?:推荐|建议|有空|有时候|改天|记得|想让|以后|抽空|试试|可以|要不要|去听|去看|找找|了解一下)/
const QUOTED=/(?:转发|引用|据说|别人说|他(?:说|让我)|她(?:说|让我)|假如|比如.*说)/
export function validateOwnerAiTodo(input, ownerMessage){
  if(!input||typeof input!=='object'||Array.isArray(input))return null
  const raw=clean(ownerMessage,600),evidence=clean(input.evidence,140),type=String(input.type||'')
  if(evidence.length<5||!raw.includes(evidence)||REFUSE.test(evidence)||!FUTURE.test(evidence)||QUOTED.test(raw.slice(0,80)))return null
  const prefix=raw.slice(Math.max(0,raw.indexOf(evidence)-12),raw.indexOf(evidence))
  if(/(?:不|别|不要|取消|无需|不必)\s*$/.test(prefix))return null
  if(type==='search_videos'){
    const topic=clean(input.topic,80)
    if(topic.length<2||topic.length>70)return null
    // Search hints such as “歌曲/视频” may be appended, but the named subject
    // must be present verbatim in the verified owner's actual message.
    const subject=topic.replace(/\s+/g,'').replace(/(?:歌曲|视频|合集|现场|演唱会|的歌|音乐)+$/g,'').trim()
    if(subject.length<2||!evidence.includes(subject)||/^(?:这个|那个|一些|任何|随便|歌曲|视频|音乐|他|她|他们|你|我|别人)$/.test(subject))return null
    return {type,topic,title:clean(input.title,95)||`有空了解「${topic}」`,evidence}
  }
  if(type==='watch_video'){
    const bv=clean(input.bvid,24)
    if(!BV.test(bv)||!evidence.includes(bv))return null
    return {type,bvid:bv,title:clean(input.title,95)||`有空看看 ${bv}`,evidence}
  }
  return null
}
