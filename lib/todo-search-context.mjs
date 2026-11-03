/**
 * A search TODO is a *goal*, not just a string match.  Keep an authenticated
 * request's media constraint after the model has independently decided to
 * accept.  This never decides willingness or creates a TODO on its own.
 *
 * Search result titles are untrusted, incomplete metadata.  For music
 * requests we prefer no child over an unrelated tutorial presented as a song.
 */
const clean=(s,n=120)=>String(s??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const squish=s=>clean(s,180).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'')
const MUSIC_OBJECT=/(?:歌曲|的歌|音乐|歌手|乐队|专辑|翻唱|唱歌|演唱|歌词|曲子|单曲|主题曲|音乐作品|\b(?:music|song|songs|album|cover)\b)/i
const LISTENING=/(?:听听|听一下|听一听|听|欣赏|推荐)/
const ACTUAL_LISTENING=/(?:听听|听一下|听一听|听|欣赏)/
const MUSIC_TOPIC=/(?:歌曲|的歌|音乐|歌手|乐队|专辑|翻唱|演唱|歌词|曲子|单曲|主题曲|\b(?:music|song|songs|album|cover)\b)/i
const MUSIC_TITLE=/(?:歌|曲|音乐|唱|伴奏|原声|专辑|翻唱|演奏|歌词|MV|电台|声乐|\b(?:music|song|songs|album|cover|vocal|lyrics|audio|singing)\b)/i
const TUTORIAL=/(?:教程|教学|零基础|怎么做|如何做|教你|手把手|安装|部署|配置|接入|训练模型|搭建|\b(?:tutorial|how\s*to|setup|install|guide)\b)/i

export function preserveSearchGoal({topic='',evidence='',contextEvidence='',searchGoal=''}={}){
  const original=clean(topic,90)
  const basis=clean([evidence,contextEvidence].filter(Boolean).join(' '),400)
  // A hard, literal guard against dropping an explicit song/music qualifier.
  // The model can also specify music, but only when the cited request has
  // actual listening/music evidence; never infer an artist or song title.
  const music=(MUSIC_OBJECT.test(basis)&&LISTENING.test(basis))||
    (searchGoal==='music'&&(MUSIC_OBJECT.test(basis)||ACTUAL_LISTENING.test(basis)))
  if(!music)return {topic:original,searchGoal:'general',changed:false}
  const topicHasConstraint=MUSIC_TOPIC.test(original)
  const next=topicHasConstraint?original:clean(`${original} 歌曲`,90)
  return {topic:next,searchGoal:'music',changed:next!==original}
}

export function musicSearchSubject(topic=''){
  const raw=clean(topic,120).replace(/(?:的歌|歌曲|音乐|歌手|乐队|专辑|翻唱|演唱|歌词|曲子|单曲|主题曲|\b(?:music|songs?|album|cover)\b)/ig,' ')
  return squish(raw)
}

export function relevantSearchVideo(video,{topic='',searchGoal='general'}={}){
  if(searchGoal!=='music')return true
  const title=clean(video?.title,180),category=clean(video?.category,90)
  const author=clean(video?.author,90),description=clean(video?.description,180)
  const subject=musicSearchSubject(topic)
  // "听某某的歌" cannot turn a software tutorial mentioning "某某" into
  // a watch task.  A music-looking topic in a non-music title is not enough.
  if(!subject||!title||TUTORIAL.test(title)||/(?:无关|并非|不涉及|不是(?:.*?)(?:歌|曲|音乐))/.test(title))return false
  if(!MUSIC_TITLE.test(title)&&!MUSIC_TITLE.test(category))return false
  const visible=squish(`${title} ${author} ${description}`)
  return visible.includes(subject)
}

export function selectRelevantSearchVideos(videos,search,{limit=3}={}){
  return (Array.isArray(videos)?videos:[])
    .filter(v=>/^BV[0-9A-Za-z]{10}$/.test(String(v?.bvid||''))&&relevantSearchVideo(v,search))
    .slice(0,Math.max(0,Math.min(3,limit)))
}
