/** Owner-facing timeline built only from public watched-video/comment records and coarse internal state changes. */
const clean=(v,n=180)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const validBv=x=>/^BV[0-9A-Za-z]{10}$/.test(String(x||''))
const localDay=at=>{const d=new Date(at);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
const dayAnchor=day=>Date.parse(`${day}T00:00:00Z`)
const sortRows=(a,b)=>{
 const dayA=String(a.day||localDay(Date.parse(a.at))),dayB=String(b.day||localDay(Date.parse(b.at)))
 const byDay=dayB.localeCompare(dayA);if(byDay)return byDay
 // Exact timestamps are ordered first. Date-only video records follow them
 // within the same calendar day instead of pretending they happened at noon.
 if(Boolean(a.dateOnly)!==Boolean(b.dateOnly))return a.dateOnly?1:-1
 if(a.dateOnly)return String(a.id).localeCompare(String(b.id))
 return Date.parse(b.at)-Date.parse(a.at)
}
export function buildLifeTimeline({watched=[],videoRounds=[],lifeDecisions=[],comments=[],emotionHistory=[],relationshipRows=[],days=30,limit=100,now=Date.now()}={}){
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
  if(!['completed','failed','interrupted'].includes(round?.state)||
    !['life-agent','manual'].includes(round.source)||!/^([a-f0-9]{12})$/.test(String(round.ref||'')))continue
  const at=Number(round.endedAt)
  if(!Number.isSafeInteger(at)||at<cutoff||at>now)continue
  const completed=round.state==='completed',count=Number.isSafeInteger(round.pickedCount)&&round.pickedCount>=0?round.pickedCount:null
  const label=completed?'视频探索轮次结束':round.state==='failed'?'视频探索轮次失败':'视频探索轮次中断'
  const title=completed?(count===null?'视频 Agent 结束，入选数未核实':count===0?'视频 Agent 结束，本轮未入选作品':`视频 Agent 结束，本轮入选 ${Math.min(count,50)} 条`):
    '视频 Agent 未正常完成，不能视为观看经历'
  rows.push({id:'video-round:'+round.ref+':'+at,type:'video-round',at,day:localDay(at),label,title,
    detail:(round.source==='life-agent'?'由鱼鱼自主选择启动':'由手动请求启动')+
      (round.state==='failed'&&Number.isSafeInteger(round.exitCode)?`；退出码 ${round.exitCode}`:'')+
      '；入选数量只来自原视频账本，进程结束本身不能证明看完或听过视频'})
 }
 // A confirmed local read is a genuine Life step. Show only recorded
 // canonical receipts, never mere decisions, model claims or unverified media
 // experiences. Private identifiers and prompt content stay out of the feed.
 const localReadLabels={
  'todo-read':['完成一次只读待办','完成了已核验的资料读取'],
  'video-metadata':['核实公开视频资料','读取了公开视频元数据'],
  'public-evidence':['复核公开互动线索','复核了已核验的公开线索']
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
    label:entry[0],title:entry[1],detail:'已核验的本地只读执行回执；不代表看完视频、听到音频、发布作品或向他人发送消息'})
 }
 // Verified outbound actions are independently persisted from the original
 // B站 send transaction (or tool receipt), not from a model choice. Dynamic
 // API-accepted-unverified results are intentionally excluded.
 const writeLabels={dm_reply:'回复了私信',comment_reply:'回复了评论',share_video:'自主分享了视频',
  video_comment:'发表了视频评论',video_like:'点赞了视频',video_collect:'收藏了视频',
  dynamic_post:'发布了生活动态',video_follow:'关注了用户',video_unfollow:'取消关注',video_folder_delete:'整理了收藏夹',
  followup:'完成了社交回访',owner_care:'完成了一次关怀交流',friend_outreach:'主动联系了一位熟人'}
 for(const x of lifeDecisions||[]){
  const at=Number(x?.at),label=writeLabels[x?.verifiedActionKind]
  if(!label||x.mode!=='active'||x.action!=='verified_write'||x.result!=='verified-action'||x.failed===true||
    !Number.isSafeInteger(at)||at<cutoff||at>now)continue
  rows.push({id:'life-write:'+x.verifiedActionKind+':'+at,type:'life-write',at,day:localDay(at),label,
    title:x.verifiedEvidence==='platform-read-after-write'?'独立平台只读回查已核验':'平台发送事务回执已核验',
    detail:(x.verifiedEvidence==='platform-read-after-write'
      ?'已按目标与当前账号回查平台状态；不代表对方收到通知或之后状态不会变化'
      :'原发送事务已结算；不代表对方已阅读或关系发生变化')+
      '；只触发下一次自主考虑，绝不自动重发'})
 }
 // Internal reflection has no public write, but a confirmed local result can
 // still be represented without claiming outside activity or personality growth.
 for(const x of lifeDecisions||[]){
  const at=Number(x?.at)
  if(x?.mode!=='active'||x.action!=='reflect'||x.result!=='completed'||x.failed===true||
     !Number.isSafeInteger(at)||at<cutoff||at>now)continue
  rows.push({id:'life-reflection:'+at,type:'life-reflection',at,day:localDay(at),label:'完成了一次自主反思',
    title:'内部反思已结算',detail:'不代表人格已发生变化；成长仍以可信记忆及后续行为验证为准'})
 }
 for(const x of comments||[]){const at=Date.parse(x.time||'');if(!Number.isFinite(at)||at<cutoff||at>now+86400000||!validBv(x.bvid))continue;rows.push({id:'comment:'+x.bvid+':'+String(x.rpid||x.time),at,day:localDay(at),type:'comment',label:x.kind==='reply'?'回复评论':'发了评论',title:clean(x.snippet||'公开评论记录',140),detail:clean(x.recipientName?`回复对象：${x.recipientName}`:'',80),bvid:x.bvid,url:x.url||'https://www.bilibili.com/video/'+x.bvid})}
 for(const x of emotionHistory||[]){const at=typeof x.at==='number'?x.at:Date.parse(x.at||'');if(!Number.isFinite(at)||at<cutoff||at>now)continue;rows.push({id:'emotion:'+at+':'+x.mood,at,day:localDay(at),type:'emotion',label:'心情变化',title:`心情转为${clean(x.label||x.mood,24)}`,detail:'仅保存情绪类别，不保存触发它的私信或评论内容'})}
 for(const friend of relationshipRows||[])for(const x of friend.history||[]){const at=Number(x.at);if(!Number.isFinite(at)||at<cutoff||at>now)continue;const label={known:'逐渐熟悉',familiar:'互动渐多',regular:'经常互动',new:'刚认识'}[x.stage]||x.stage;rows.push({id:'relationship:'+friend.uid+':'+at,type:'relationship',at,day:localDay(at),label:'关系阶段变化',title:`与${clean(friend.name||'一位白名单好友',36)}：${label}`,detail:'根据跨日、双向互动元数据形成的保守估计'})}
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
