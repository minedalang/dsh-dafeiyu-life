/** Owner-facing timeline built only from public watched-video/comment records and coarse internal state changes. */
import {classifyVideoCommentRound} from './video-comment-readiness.mjs'
const clean=(v,n=180)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const validBv=x=>/^BV[0-9A-Za-z]{10}$/.test(String(x||''))
const localDay=at=>{const d=new Date(at);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
const dayAnchor=day=>Date.parse(`${day}T00:00:00Z`)
const eventTime=value=>typeof value==='number'?value:Date.parse(String(value||''))
const sortRows=(a,b)=>{
 const dayA=String(a.day||localDay(eventTime(a.at))),dayB=String(b.day||localDay(eventTime(b.at)))
 const byDay=dayB.localeCompare(dayA);if(byDay)return byDay
 // Exact timestamps are ordered first. Date-only video records follow them
 // within the same calendar day instead of pretending they happened at noon.
 if(Boolean(a.dateOnly)!==Boolean(b.dateOnly))return a.dateOnly?1:-1
 if(a.dateOnly)return String(a.id).localeCompare(String(b.id))
 // Rows are built with epoch milliseconds. Date.parse(milliseconds) returns NaN,
 // silently disabling chronological sorting and leaving events grouped by type.
 return eventTime(b.at)-eventTime(a.at)||String(a.id).localeCompare(String(b.id))
}
export function buildLifeTimeline({watched=[],videoRounds=[],lifeDecisions=[],comments=[],emotionHistory=[],relationshipRows=[],episodes=[],days=30,limit=100,now=Date.now()}={}){
 const span=Math.max(1,Math.min(90,Number(days)||30))*86400000,cutoff=now-span,cutoffDay=localDay(cutoff),latestDay=localDay(now+86400000),rows=[]
 for(const x of watched||[]){
  // Ledger rows only carry a calendar date. Keep that precision honest: no
  // synthetic noon time is used for display or relative ordering.
  if(!validBv(x?.bvid)||!/^\d{4}-\d{2}-\d{2}$/.test(String(x.day||'')))continue
  if(x.day<cutoffDay||x.day>latestDay)continue
  const at=dayAnchor(x.day);if(!Number.isFinite(at))continue
  const status=clean(x.tier||x.status,60)
  const ownerWatch=/主\s*Session\s*指定观看|主人指定观看/.test(status)
  const skipped=/跳过|未选|没挑|不收|无字幕/.test(status)
  const label=ownerWatch?'主人指定查看视频':x.picked===true?'入选视频':skipped?'探索视频 · 未入选':'视频探索记录 · 未标记入选'
  rows.push({id:'watch:'+x.bvid+':'+x.day,at,day:x.day,dateOnly:true,type:'video',label,title:clean(x.title||x.bvid,140),detail:status,bvid:x.bvid,url:'https://www.bilibili.com/video/'+x.bvid})
 }
 // Video subprocess completion is a real life activity, but not evidence
 // that any particular BV was watched or listened to. Keep it separate from
 // the canonical per-video picked ledger and from mere model launch intent.
 for(const round of videoRounds||[]){
  if(!['life-agent','manual'].includes(round?.source)||!/^([a-f0-9]{12})$/.test(String(round.ref||'')))continue
  const startedAt=Number(round.startedAt)
  if(Number.isSafeInteger(startedAt)&&startedAt>=cutoff&&startedAt<=now){
    rows.push({id:'video-round-start:'+round.ref+':'+startedAt,type:'video-round-start',at:startedAt,
      day:localDay(startedAt),label:'视频 Agent 开始',title:'已启动一轮视频探索',detail:'进程启动已确认；不代表视频已经观看'})
  }
  if(!['completed','failed','interrupted','unverified-interruption'].includes(round.state))continue
  const at=Number(round.endedAt)||Number(round.startedAt)
  if(!Number.isSafeInteger(at)||at<cutoff||at>now)continue
  const completed=round.state==='completed',count=Number.isSafeInteger(round.pickedCount)&&round.pickedCount>=0?round.pickedCount:null
  const label=completed?'一次视频探索':round.state==='failed'?'视频探索没有完成':'视频探索中断了'
  const homeCount=Number.isSafeInteger(round.homePickedCount)&&round.homePickedCount>=0&&round.homePickedCount<=12?round.homePickedCount:null
  const title=completed?(count===null?'探索了一轮视频':count===0?'这一轮没有挑中视频':`这一轮挑中了 ${Math.min(count,50)} 条视频`):
    round.state==='unverified-interruption'?'这轮视频探索没有收到结束回执':'这轮视频探索没能完成'
  const displayTitle=completed&&round.homeRead==='candidates'&&homeCount!==null
    ?`${title}，其中首页推荐 ${homeCount} 条`:title
  // Display the decision/result of the round *alongside* its completion.
  // These are anonymous counters, not per-BV public comment evidence. Never
  // claim a specific video was commented on merely from aggregate counts.
  let commentDetail=''
  if(round.commentDiagnostics&&typeof round.commentDiagnostics==='object'){
    const c=classifyVideoCommentRound({gate:round.commentGate||'unknown',pickedCount:count,
      review:round.commentDiagnostics,exitCode:completed?0:round.state==='failed'?1:null})
    const messages={
      'platform-verified':`本轮有 ${c.verified} 条原创评论通过平台独立核验`,
      'platform-unverified':'主评论已被提出或提交，但平台结果尚未确认，不能当作已发布',
      'comment-technically-blocked':'肥鱼提出过主评论，但执行或 Life 审批被阻断，没有已核验发送',
      'life-declined':'肥鱼提出过主评论，但 Life 没有批准外发',
      'proposed-not-approved':'肥鱼提出过主评论，但没有获得外发批准',
      'wanted-but-not-proposed':'肥鱼考虑发表主评论，但本轮未观察到发送工具调用',
      'comment-review-rejected':'本轮主评论意愿登记被拒绝，不能当作肥鱼不想说',
      'model-chose-not-comment':'肥鱼考虑过，决定不发表主评论',
      'insufficient-evidence':'肥鱼考虑过，但认为证据不足，决定不评论',
      'model-review-not-observed':'本轮没有记录到明确的主评论考虑结果',
      'comment-config-blocked':'当前轮次没有原创主评论授权',
      'life-bridge-not-ready':'Life 原创主评论审批服务当时未就绪',
      'no-publish-after-review':'本轮有过主评论考虑，但没有已核验的公开发送'
    }
    commentDetail=messages[c.code]||''
  }
  rows.push({id:'video-round:'+round.ref+':'+at,type:'video-round',at,day:localDay(at),label,title:displayTitle,detail:commentDetail})
 }
 // A confirmed local read is a genuine Life step. Show only recorded
 // canonical receipts, never mere decisions, model claims or unverified media
 // experiences. Private identifiers and prompt content stay out of the feed.
 const localReadLabels={
  'todo-read':['了解待办','查看了待办的相关资料'],
  'video-metadata':['了解视频','查看了一条视频的公开信息'],
  'public-evidence':['看看公开讨论','回顾了公开交流的线索']
 }
 for(const x of lifeDecisions||[]){
  const at=Number(x?.at),entry=localReadLabels[x?.verifiedReadKind]
  if(!entry||x.mode!=='active'||x.failed===true||!Number.isSafeInteger(at)||at<cutoff||at>now)continue
  const valid=(x.verifiedReadKind==='todo-read'&&x.action==='execute_read'&&x.result==='done')||
    (x.verifiedReadKind==='video-metadata'&&['inspect_opportunity','begin_exploration','inspect_exploration'].includes(x.action)&&x.result==='verified-metadata')||
    (x.verifiedReadKind==='public-evidence'&&x.action==='review_public'&&x.result==='public-evidence-reviewed')
  if(!valid)continue
  const ref=Array.isArray(x.eventRefs)?x.eventRefs.find(v=>/^[a-f0-9]{16}$/.test(v)):null
  rows.push({id:'life-read:'+at+':'+(ref||x.action),at,day:localDay(at),type:'life-read',
    label:entry[0],title:entry[1],detail:''})
 }
 // This is a life diary, not a receipt log. The original Life decision
 // ledger retains verification evidence for diagnostics and safe continuation.
 // Prefer a detailed public comment to an anonymous confirmation of the very
 // same comment, while keeping a human-readable fallback if the public comment
 // ledger is temporarily unavailable. Never infer a send from model intent.
 // A voluntary rest is a real Life decision, but not an external action.
 // Show it explicitly so the diary explains why no activity followed; never
 // label it as a completed task or platform operation.
 for(const x of lifeDecisions||[]){
  const at=Number(x?.at)
  if(x?.mode!=='active'||x.action!=='skip'||x.result!=='voluntary-rest'||x.failed===true||
     !Number.isSafeInteger(at)||at<cutoff||at>now)continue
  const ref=Array.isArray(x.eventRefs)?x.eventRefs.find(v=>/^[a-f0-9]{16}$/.test(v)):null
  rows.push({id:'life-rest:'+at+':'+(ref||'turn'),at,day:localDay(at),type:'life-rest',
    label:'自主休息',title:'考虑了当前机会，决定暂时休息',detail:'本轮没有执行外部动作'})
 }
 const writeLabels={
  dm_reply:['私信互动','回复了一条私信'],
  comment_reply:['评论互动','回复了别人的评论'],
  share_video:['分享视频','把喜欢的视频分享给了朋友'],
  video_comment:['评论互动','在视频下留了言'],
  video_like:['视频互动','给一条视频点了赞'],
  video_collect:['视频互动','收藏了一条视频'],
  dynamic_post:['生活动态','发布了一条动态'],
  video_follow:['视频互动','关注了一位创作者'],
  video_unfollow:['视频互动','取消了一次关注'],
  video_folder_delete:['整理收藏','整理了收藏夹'],
  followup:['社交互动','与朋友继续聊了聊'],
  owner_care:['社交互动','向朋友表达了关心'],
  friend_outreach:['社交互动','主动找熟人聊了天']
 }
 const publicComments=(comments||[]).filter(x=>{
  const at=Date.parse(x?.time||'')
  return Number.isFinite(at)&&at>=cutoff&&at<=now+86400000&&validBv(x?.bvid)
 })
 const alreadyShownAsComment=(kind,at)=>{
  if(!['comment_reply','video_comment'].includes(kind))return false
  const expected=kind==='comment_reply'?'reply':'top'
  // Platform read-back may lag the original comment timestamp. Use a bounded
  // window; a receipt alone cannot reveal or reconstruct public comment text.
  return publicComments.some(x=>x.kind===expected&&Math.abs(Date.parse(x.time)-at)<=180000)
 }
 for(const x of lifeDecisions||[]){
  const at=Number(x?.at),entry=writeLabels[x?.verifiedActionKind]
  if(!entry||x.mode!=='active'||x.action!=='verified_write'||x.result!=='verified-action'||x.failed===true||
    !Number.isSafeInteger(at)||at<cutoff||at>now)continue
  if(alreadyShownAsComment(x.verifiedActionKind,at))continue
  rows.push({id:'life-write:'+x.verifiedActionKind+':'+at,type:'life-write',at,day:localDay(at),
    label:entry[0],title:entry[1],detail:''})
 }
 // Verified Episode receipts are the canonical fallback for Life actions
 // whose specialized producer does not also write a legacy timeline row.
 // Only coarse labels are exposed; private DM/comment text and hashed targets
 // never enter the owner-facing diary.
 const episodeLabels={
  dm_reply:['私信互动','回复了一条私信'],comment_reply:['评论互动','回复了一条评论'],
  dynamic_post:['生活动态','发布了一条动态'],video_comment:['视频互动','在视频下发表了主评论'],
  video_like:['视频互动','给一条视频点了赞'],video_collect:['视频互动','收藏了一条视频'],
  video_follow:['视频互动','关注了一位创作者'],video_unfollow:['视频互动','取消了一次关注'],
  followup:['社交互动','与朋友继续聊了聊'],owner_care:['社交互动','向朋友表达了关心'],
  friend_outreach:['社交互动','主动找熟人聊了天']
 }
 const seenEpisodeEvents=new Set()
 for(const episode of episodes||[])for(const step of episode?.history||[]){
  if(step?.outcome!=='verified'||!episodeLabels[step.action]||!Number.isSafeInteger(step.at)||
     step.at<cutoff||step.at>now)continue
  const key=String(episode.id||'episode')+'|'+step.at+'|'+step.action
  if(seenEpisodeEvents.has(key))continue;seenEpisodeEvents.add(key)
  const [label,title]=episodeLabels[step.action]
  if(['comment_reply','video_comment'].includes(step.action)&&alreadyShownAsComment(step.action,step.at))continue
  rows.push({id:'episode-action:'+key,type:'life-action',at:step.at,day:localDay(step.at),label,title,detail:''})
 }
 // Internal reflection has no public write, but a confirmed local result can
 // still be represented without claiming outside activity or personality growth.
 for(const x of lifeDecisions||[]){
  const at=Number(x?.at)
  if(x?.mode!=='active'||x.action!=='reflect'||x.result!=='completed'||x.failed===true||
     !Number.isSafeInteger(at)||at<cutoff||at>now)continue
  rows.push({id:'life-reflection:'+at,type:'life-reflection',at,day:localDay(at),label:'自主反思',
    title:'梳理了一次自己的想法',detail:''})
 }
 for(const x of comments||[]){const at=Date.parse(x.time||'');if(!Number.isFinite(at)||at<cutoff||at>now+86400000||!validBv(x.bvid))continue;rows.push({id:'comment:'+x.bvid+':'+String(x.rpid||x.time),at,day:localDay(at),type:'comment',label:x.kind==='reply'?'回复评论':'发了评论',title:clean(x.snippet||'公开评论记录',140),detail:clean(x.recipientName?`回复对象：${x.recipientName}`:'',80),bvid:x.bvid,url:x.url||'https://www.bilibili.com/video/'+x.bvid})}
 for(const x of emotionHistory||[]){const at=typeof x.at==='number'?x.at:Date.parse(x.at||'');if(!Number.isFinite(at)||at<cutoff||at>now)continue;rows.push({id:'emotion:'+at+':'+x.mood,at,day:localDay(at),type:'emotion',label:'心情变化',title:`心情转为${clean(x.label||x.mood,24)}`,detail:''})}
 for(const friend of relationshipRows||[])for(const x of friend.history||[]){const at=Number(x.at);if(!Number.isFinite(at)||at<cutoff||at>now)continue;const label={known:'逐渐熟悉',familiar:'互动渐多',regular:'经常互动',new:'刚认识'}[x.stage]||x.stage;rows.push({id:'relationship:'+friend.uid+':'+at,type:'relationship',at,day:localDay(at),label:'关系阶段变化',title:`与${clean(friend.name||'一位白名单好友',36)}：${label}`,detail:''})}
 const unique=new Map();for(const x of rows)if(!unique.has(x.id))unique.set(x.id,x)
 const sorted=[...unique.values()].sort(sortRows)
 const cap=Math.max(1,Math.min(200,Number(limit)||100))
 // Comments have exact timestamps, while video-ledger entries usually only
 // have dates. Reserve some room for video events so a busy comment day does
 // not push every video off the owner-facing timeline.
 const videoRows=sorted.filter(x=>x.type==='video').slice(0,Math.max(1,Math.floor(cap/4)))
 const selected=[...videoRows],seenIds=new Set(selected.map(x=>x.id))
 for(const x of sorted){if(selected.length>=cap)break;if(!seenIds.has(x.id)){selected.push(x);seenIds.add(x.id)}}
 return selected.sort(sortRows).map(x=>({...x,at:new Date(x.at).toISOString()}))
}
