/** Owner-facing timeline built only from public watched-video/comment records and coarse internal state changes. */
import {createHash} from 'node:crypto'
const clean=(v,n=180)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const validBv=x=>/^BV[0-9A-Za-z]{10}$/.test(String(x||''))
const validUid=x=>/^[1-9]\d{0,18}$/.test(String(x||''))
const timelineEvidenceNear=(rows,at,actions,windowMs=5*60_000)=>{
 const allowed=new Set(Array.isArray(actions)?actions:[actions]);return (rows||[]).filter(x=>allowed.has(x?.action)&&Math.abs(Number(x.at)-Number(at))<=windowMs)
  .sort((a,b)=>Math.abs(Number(a.at)-Number(at))-Math.abs(Number(b.at)-Number(at)))[0]||null
}
const evidenceFields=x=>{
 if(!x)return {};const bvid=validBv(x.bvid)?x.bvid:'',uid=validUid(x.creatorUid)?String(x.creatorUid):''
 return {...(bvid?{bvid,url:'https://www.bilibili.com/video/'+bvid}:{}),
  ...(uid?{creatorUid:uid,creatorUrl:'https://space.bilibili.com/'+uid}:{}),
  ...(Array.isArray(x.relatedVideos)&&x.relatedVideos.length?{relatedVideos:x.relatedVideos.filter(v=>validBv(v?.bvid)).slice(0,5).map(v=>({bvid:v.bvid,title:clean(v.title,85),url:'https://www.bilibili.com/video/'+v.bvid}))}:{})}
}
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
// Life user diary uses only the existing event/receipt ledger. The original
// trace retains technical IDs; this projection never copies private content.
const safeCount=n=>Number.isSafeInteger(n)&&n>0?Math.min(99,n):0
const socialKinds=x=>{
 const kinds=new Set(Array.isArray(x?.kinds)?x.kinds:[])
 if(kinds.has('dm-received')&&kinds.has('comment-received'))return '私信与评论提醒'
 if(kinds.has('dm-received'))return '私信提醒'
 if(kinds.has('comment-received'))return '评论提醒'
 return '社交提醒'
}
const visualDecisionReasonLabels=Object.freeze({
 'fish-chose-rest':'Life 选择先休息',
 'fish-chose-to-stop':'Life 选择暂不继续探索（没有提供具体原因）',
 'model-unavailable':'继续观察时模型不可用',
 'no-new-public-evidence':'已有公开资料没有带来新的可靠线索',
 'no-new-exploration-option':'本轮没有合适的进一步探索选项',
 'episode-step-limit':'本次探索已达到步骤上限',
 'focus-no-new-sampled-evidence':'局部观察没有取得新采样证据',
 'step-verified':'Life 继续了其他已核验探索步骤',
 'fish-chose-rest-pause-failed':'Life 选择休息，但暂停回执未核实',
 'fish-chose-stop-pause-failed':'Life 选择停止，但暂停回执未核实',
 'fish-chose-enough-evidence':'Life 认为现有资料已足够本轮目的',
 'fish-chose-prefer-text':'Life 想先阅读文字或讨论，没有选择画面观察',
 'fish-chose-not-interested':'Life 当前没有继续观察画面的兴趣',
 'fish-chose-later':'Life 决定以后再考虑画面观察',
 'fish-chose-other-action':'Life 此刻更想先做其他探索动作',
 'target-not-offered':'模型选择了本轮没有提供或目标不匹配的动作，已被系统拒绝；这不是 Life 拒绝观看',
 'video-depth-or-target-not-offered':'模型请求的观看深度或视频目标不在允许范围内，系统未执行',
 'invalid-focus-target':'模型请求的局部画面位置不合法，系统未执行',
 'model-stop-reason-missing':'Life 选择结束，但模型没有按要求返回具体的原因类别',
 'model-nonvisual-reason-missing':'Life 选择了其他动作，但模型没有按要求返回不看画面的原因类别',
 'continuation-not-started':'这轮只完成了资料核验，未进入后续画面观察选择',
 'continuation-unavailable':'后续探索没有正常启动，无法确认 Life 是否想看画面',
 'no-eligible-action':'本轮没有符合条件的继续探索动作',
 'authorization-changed':'继续探索前授权或运行状态已变化',
 'model-quota':'当日 Life 模型决策额度已用尽',
 'model-global-quota':'当日 Life 模型总体预算已用尽',
 'invalid-model-output':'模型未返回有效的继续探索选择',
 'invalid-stop-reason':'模型给出的停止原因类别无效',
 'unexpected-stop-reason':'模型的停止原因出现在不允许的位置',
 'candidate-changed':'候选行动在决策期间发生变化，为避免误操作而停止',
 'account-changed':'执行前账号发生变化，已停止本轮操作',
 'receipt-unavailable':'本轮后续行动没有取得可核实的完成记录',
 'not-eligible':'本轮未满足继续探索的运行条件',
 'no-current-intention':'此前的探索目标已不在当前有效候选中',
 'discussion-read-unverified':'本次评论区读取没有取得可确认的内容',
 'video-already-observed':'本轮已有可复用的画面观察，不重复取帧',
 'focus-budget-exhausted':'局部画面观察已达到本轮预算',
})
// A verified metadata read is not automatically a refusal to watch. State
// comes from the same account's planner outcome; the code adds an explanation.
// Legacy rows carry only a code, so avoid claiming later actions were executed.
const continuationDiaryDetail=x=>{
 const code=String(x?.continuationResultCode||''),reason=visualDecisionReasonLabels[code]||''
 const stage=x?.continuationState
 if(stage==='completed')return '已完成本轮探索，后续遇到新机会时可重新考虑。'
 if(stage==='life-ended')return 'Life 选择暂时结束探索：'+(reason?reason.replace(/^Life\s*/,''):'没有记录具体原因')+'。'
 if(stage==='continued')return '核验资料后，Life 继续探索了其他内容'+(reason&&code!=='step-verified'?'；'+reason:'')+'。'
 if(stage==='not-started')return '本轮未进入后续行动选择：'+(reason||'没有记录具体阻断原因')+'。'
 if(stage==='blocked')return '本轮后续行动未能执行：'+(reason||'没有记录具体阻断原因')+'。'
 // Old rows cannot prove the newer execution state: use their bounded reason
 // only where it is unambiguous, otherwise say explicitly what is unknown.
 if(code==='episode-step-limit')return '已完成本轮探索，后续遇到新机会时可重新考虑。'
 if(code==='step-verified')return '核验资料后，Life 继续了其他已核实的探索动作。'
 if(code.startsWith('fish-chose-')&&code!=='fish-chose-other-action')
   return 'Life 选择暂时结束探索：'+(reason?reason.replace(/^Life\s*/,''):'没有记录具体原因')+'。'
 if(code==='model-stop-reason-missing')return 'Life 选择暂时结束探索：模型没有按要求返回具体原因。'
 if(code==='continuation-not-started'||code==='no-eligible-action'||code==='no-new-exploration-option'||code==='model-quota'||code==='model-global-quota')
   return '本轮未进入后续行动选择：'+reason+'。'
 if(reason)return '本轮后续行动状态：'+reason+'；旧记录未保存完整执行结果。'
 return '旧记录没有保存本轮后续行动的选择状态。'
}
const visualEpisodeRef=v=>/^[a-f0-9]{16}$/.test(String(v||''))?String(v):''
const validVideoEpisodeEvidence=(x,act)=>x?.action===act&&validBv(x.bvid)&&visualEpisodeRef(x.episodeRef)
const visualSourceDetail=x=>x.visualSource==='low-resolution-preview'?
 `查看了 ${x.frameCount} 个 B站低清预览采样画面，视觉模型已返回描述。`:
 `取得 ${x.frameCount} 个公开视频离线解码采样时刻的视觉回执。`
const restReasonLabels=Object.freeze({
 'need-rest':'想先休息一会儿',
 'not-now':'现在暂时不想行动',
 'not-interested':'这一轮的机会没有让她产生行动兴趣',
 'need-evidence':'觉得当前证据还不够',
 'avoid-disturb':'暂时不想打扰别人',
 'no-priority':'目前没有特别想优先做的事'
})
const offeredSummary=x=>{
 const opts=x?.options||{}
 const social=safeCount(opts.social)
 const others=[['todos','项待办'],['cues','条生活线索'],['intentions','段已有探索'],
   ['opportunities','个具体机会'],['video','个视频能力候选'],['reflection','个反思机会']]
   .map(([key,label])=>[safeCount(opts[key]),label]).filter(([n])=>n>0)
 return {social,otherText:others.map(([n,label])=>`${n}${label}`).join('、')}
}
const restCard=x=>{
 const {social,otherText}=offeredSummary(x)
 const fromSocial=x.decisionOrigin==='social'||social>0
 const title=fromSocial&&social>0
  ?'留意到新消息，决定先歇一会儿'
  :otherText?'看过眼前的生活机会，决定暂时休息':'鱼鱼决定歇一会儿'
 const reason=restReasonLabels[x.restReasonCode]
 const context=fromSocial&&social>0?`留意到 ${social} 个${socialKinds(x)}`:
  otherText?`看到了${otherText}`:''
 return {label:'自主休息',title,detail:[context,reason].filter(Boolean).join('，')+(context||reason?'。':'')}
}
// Only source-backed result codes are projected as actions. For example a
// chosen `consider_social` is local attention, never a completed DM reply.
const localLifeActionCard=x=>{
 const {social}=offeredSummary(x)
 // This local attention is not a read or send receipt. Keep it in the
 // original Life trace, but do not add a second owner-facing diary card
 // next to the actual social reply. Independent unresponded notifications
 // are still visible in the inbox and diagnostics, not as completed life.
 if(x.action==='consider_social'&&
    (x.result==='social-signal-considered'||String(x.result||'').startsWith('social-shadow-')))return null
 if(['inspect_shared_link','inspect_related_content'].includes(x.action)&&x.result==='shared-link-inspected')
   return {label:'公开分享',title:'查看了分享链接的公开资料',detail:'只确认公开资料读取，不等于观看视频。'}
 if(x.action==='observe_video'&&x.result==='shared-video-visual-observed')
   return {label:'视频观察',title:'自主观察了分享视频的采样画面',detail:'有可信视觉采样回执，不代表完整播放。'}
 if(x.action==='observe_video'&&x.result==='shared-video-cached-observation')
   return {label:'视频回顾',title:'复用了分享视频的已有观察',detail:'使用已有可信画面回执，没有声明新采样。'}
 if(x.action==='observe_video'&&x.result==='shared-video-speech-read')
   return {label:'视频文字',title:'读取了分享视频的语音文字',detail:'有字幕或转写证据，未核验画面。'}
 if(x.action==='review_friend'&&x.result==='friend-considered-no-send')
   return {label:'关系关注',title:'想起了一位熟悉的人',detail:'本轮只考虑了这段关系，没有主动发送私信。'}
 if(x.action==='review_video_feedback'&&x.result==='video-feedback-considered')
   return {label:'回顾经历',title:'回顾了最近一次视频探索',detail:'想了想上一轮视频探索的情况。'}
 if(x.action==='talk_to_owner'){
   if(x.result==='owner-chat-confirmed')return {label:'主动交流',title:'把一次探索分享给主人',detail:'原主人私信收到平台确认回执；不是自动待办汇报。'}
   if(x.result==='owner-chat-queued')return {label:'主动交流',title:'想和主人聊聊',
     detail:'交流契机已交给原主 Session；是否真正显示消息或送达尚未确认。'}
   if(x.result==='owner-chat-blocked')return {label:'交流未开始',title:'想联系主人，但这次未能开始',
     detail:'当轮联系条件未通过，没有确认发送新消息。'}
   if(x.result==='owner-chat-unknown')return {label:'交流待核实',title:'尝试联系主人，结果尚不明确',
     detail:'这次请求的结果未知，不会据此自动重复发送。'}
 }
 if(x.action==='defer'&&x.result==='opportunity-recorded')
   return {label:'调整安排',title:'把一项生活机会留到以后',detail:'鱼鱼本轮选择了延期，没有执行该机会的外部行为。'}
 if(x.action==='dismiss'&&x.result==='opportunity-recorded')
   return {label:'调整安排',title:'决定放下这次生活机会',detail:'这项机会已在原生活记录中登记为放下，没有执行外部动作。'}
 if(x.action==='resume_episode'&&x.result==='episode-paused')
   return {label:'探索停歇',title:'想了想之前的探索，决定暂时放下',detail:'没有把已有探索强行推进下一步。'}
 if(x.action==='resume_episode'&&x.result==='episode-considered')
   return {label:'探索回顾',title:'重新考虑了一段未完成的探索',detail:'本轮没有取得新的可确认行动结果。'}
 if(x.action==='begin_exploration'&&x.result==='verified-search-results')
   return {label:'自主探索',title:'按自己的好奇心查找了公开资料',detail:'取得了可信搜索结果，但不等于已看完视频。'}
 if(x.action==='inspect_creator_space'&&x.result==='verified-creator-videos')
   return {label:'自主探索',title:'了解了视频创作者的其他公开投稿',detail:'只读取并核验了公开视频信息，没有因此关注或私信对方。'}
 if(x.action==='abandon_exploration'&&['exploration-abandoned','abandoned'].includes(x.result))
   return {label:'结束探索',title:'决定结束一段已有的探索',detail:'原有意愿已更新，没有因此发出外部消息。'}
 return null
}
export function buildLifeTimeline({watched=[],videoRounds=[],lifeDecisions=[],comments=[],emotionHistory=[],relationshipRows=[],episodes=[],explorationEvidence=[],days=30,limit=100,now=Date.now()}={}){
 const span=Math.max(1,Math.min(90,Number(days)||30))*86400000,cutoff=now-span,cutoffDay=localDay(cutoff),latestDay=localDay(now+86400000),rows=[]
 // The selection ledger stores a full 24-hex round ID; life event views only
 // expose its first 12 hex characters. Link ONLY an exact persisted prefix
 // from this account's selection, never same-day or same-BV guesses.
 const liveRounds=new Set((videoRounds||[]).filter(r=>
  ['life-agent','manual'].includes(r?.source)&&/^[a-f0-9]{12}$/.test(String(r.ref||'')))
  .map(r=>r.ref))
 for(const x of watched||[]){
  // Ledger rows only carry a calendar date. Keep that precision honest: no
  // synthetic noon time is used for display or relative ordering.
  if(!validBv(x?.bvid)||!/^\d{4}-\d{2}-\d{2}$/.test(String(x.day||'')))continue
  if(x.day<cutoffDay||x.day>latestDay)continue
  const recordedAt=Number(x.observedAt)
  const precise=Number.isSafeInteger(recordedAt)&&recordedAt>=cutoff&&recordedAt<=now&&
    localDay(recordedAt)===x.day
  const at=precise?recordedAt:dayAnchor(x.day);if(!Number.isFinite(at))continue
  const status=clean(x.tier||x.status,60)
  const ownerWatch=/主\s*Session\s*指定观看|主人指定观看/.test(status)
  const skipped=/跳过|未选|没挑|不收|无字幕/.test(status)
  const label=ownerWatch?'主人指定查看视频':x.picked===true?'入选视频':skipped?'探索视频 · 未入选':'视频探索记录 · 未标记入选'
  const roundRef=x.picked===true&&/^[a-f0-9]{24}$/.test(String(x.roundId||''))?
    String(x.roundId).slice(0,12):''
  const continuity=roundRef&&liveRounds.has(roundRef)?
    {kind:'video-round',key:roundRef,evidence:'同一账号的真实视频轮次入选记录'}:null
  rows.push({id:'watch:'+x.bvid+':'+x.day,at,day:x.day,dateOnly:!precise,type:'video',label,
    title:clean(x.title,140).includes('\uFFFD')?'标题编码异常 · 请打开视频核实':clean(x.title||x.bvid,140),detail:status,bvid:x.bvid,url:'https://www.bilibili.com/video/'+x.bvid,
    ...(continuity?{continuity}:{})})
 }
 // Video subprocess completion is a real life activity, but not evidence
 // that any particular BV was watched or listened to. Keep it separate from
 // the canonical per-video picked ledger and from mere model launch intent.
 for(const round of videoRounds||[]){
  if(!['life-agent','manual'].includes(round?.source)||!/^([a-f0-9]{12})$/.test(String(round.ref||'')))continue
  const startedAt=Number(round.startedAt)
  if(Number.isSafeInteger(startedAt)&&startedAt>=cutoff&&startedAt<=now){
    rows.push({id:'video-round-start:'+round.ref+':'+startedAt,type:'video-round-start',at:startedAt,
      day:localDay(startedAt),label:'开始探索',title:'准备看看有什么值得探索的视频',detail:'开始了一轮视频探索，还没有挑中内容。',
      continuity:{kind:'video-round',key:round.ref,evidence:'同一轮探索'}})
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
  // Technical comment decisions remain in the original video receipts and
  // decision logs. The owner's diary shows only what actually happened.
  const visualTotal=Number.isSafeInteger(round.funnel?.visualAttempted)?Math.max(0,round.funnel.visualAttempted):0
  const visualVerified=Number.isSafeInteger(round.funnel?.visualVerified)?Math.min(visualTotal,Math.max(0,round.funnel.visualVerified)):0
  // Round-level counts are not per-BV Life viewing receipts. Never invent
  // individual observation cards from a subprocess total.
  const visualDetail=visualTotal?`本轮对 ${visualTotal} 条视频尝试画面观察，其中 ${visualVerified} 条取得采样画面描述回执；不代表完整播放。`:''
  rows.push({id:'video-round:'+round.ref+':'+at,type:'video-round',at,day:localDay(at),label,title:displayTitle,detail:visualDetail,
    continuity:{kind:'video-round',key:round.ref,evidence:'同一轮探索'}})
 }
 // A confirmed local read is a genuine Life step. Show only recorded
 // canonical receipts, never mere decisions, model claims or unverified media
 // experiences. Private identifiers and prompt content stay out of the feed.
 const localReadLabels={
  'todo-read':['了解待办','查看了待办的相关资料'],
  'video-metadata':['核验视频资料','核对了视频标题等公开资料'],
  'public-evidence':['看看公开讨论','回顾了公开交流的线索']
 }
 for(const x of lifeDecisions||[]){
  const at=Number(x?.at),entry=localReadLabels[x?.verifiedReadKind]
  if(!entry||x.mode!=='active'||x.failed===true||!Number.isSafeInteger(at)||at<cutoff||at>now)continue
  const valid=(x.verifiedReadKind==='todo-read'&&x.action==='execute_read'&&x.result==='done')||
    (x.verifiedReadKind==='video-metadata'&&['inspect_opportunity','begin_exploration','inspect_exploration'].includes(x.action)&&x.result==='verified-metadata')||
    (x.verifiedReadKind==='public-evidence'&&(['review_public','inspect_public_person'].includes(x.action))&&
      ['public-evidence-reviewed','verified-public-portfolio'].includes(x.result))
  if(!valid)continue
  const ref=Array.isArray(x.eventRefs)?x.eventRefs.find(v=>/^[a-f0-9]{16}$/.test(v)):null
  // A comment/selection-origin begin_exploration has a verified video
  // metadata read, not a generic search. Correlate ONLY the opaque hashed
  // original cue ID, never a nearby BV or a guessed match by timestamp.
  const metadataEpisode=x.action==='begin_exploration'&&x.verifiedReadKind==='video-metadata'
  const exactEpisode=x.action==='inspect_exploration'&&x.verifiedReadKind==='video-metadata'
  const evidenceAction=metadataEpisode?'inspect-video':
    {inspect_opportunity:'inspect-opportunity',begin_exploration:'search',inspect_exploration:'inspect-video',inspect_public_person:'inspect-public-person'}[x.action]
  const matches=metadataEpisode&&/^[a-f0-9]{16}$/.test(String(x.continuation||''))?(explorationEvidence||[]).filter(e=>
    e?.action==='inspect-video'&&e.cueRef===x.continuation&&validBv(e.bvid)&&
    Number.isSafeInteger(Number(e.at))&&Number(e.at)<=at&&at-Number(e.at)<=5*60_000):[]
  // A Life read decision carries only a source-opaque join key. Bind a BV
  // only to its original verified receipt; never to a nearby unrelated video.
  const opportunityMatches=x.action==='inspect_opportunity'&&visualEpisodeRef(x.continuation)?(explorationEvidence||[]).filter(e=>
    e?.action==='inspect-opportunity'&&e.cueRef===x.continuation&&validBv(e.bvid)&&
    Number.isSafeInteger(Number(e.at))&&Number(e.at)<=at&&at-Number(e.at)<=5*60_000):[]
  const exactMatches=exactEpisode&&visualEpisodeRef(x.continuation)?(explorationEvidence||[]).filter(e=>
    validVideoEpisodeEvidence(e,'inspect-video')&&e.episodeRef===x.continuation&&
    Number.isSafeInteger(Number(e.at))&&Number(e.at)<=at&&at-Number(e.at)<=5*60_000)
    .sort((a,b)=>Number(b.at)-Number(a.at)):[]
  // An episode may inspect more than one video. Use the latest preceding
  // verified read, and reject same-millisecond ambiguity instead of guessing.
  const exactVideo=exactMatches[0]&&(!exactMatches[1]||Number(exactMatches[1].at)<Number(exactMatches[0].at))?exactMatches[0]:null
  const evidence=metadataEpisode?(matches.length===1?matches[0]:null):
    exactEpisode?exactVideo:
    x.action==='inspect_opportunity'?(opportunityMatches.length===1?opportunityMatches[0]:null):
    timelineEvidenceNear(explorationEvidence,at,evidenceAction)
  // Old decision ledgers may have the successful read but not its target link.
  // Such records remain in diagnostics, not as anonymous "video" diary cards.
  if(x.verifiedReadKind==='video-metadata'&&!validBv(evidence?.bvid))continue
  const episodeRef=visualEpisodeRef(evidence?.episodeRef)
  const video=x.verifiedReadKind==='video-metadata'&&episodeRef&&validBv(evidence.bvid)?
    (explorationEvidence||[]).filter(v=>validVideoEpisodeEvidence(v,'observe-video')&&
      v.episodeRef===episodeRef&&v.bvid===evidence.bvid&&Number(v.at)>=Number(evidence.at)&&
      Number.isSafeInteger(Number(v.frameCount))&&Number(v.frameCount)>0&&Number(v.frameCount)<=48)
      .sort((a,b)=>Number(b.at)-Number(a.at))[0]:null
  const merged=Boolean(video)
  rows.push({id:'life-read:'+at+':'+(ref||x.action),at:merged?Number(video.at):at,
    day:localDay(merged?Number(video.at):at),type:'life-read',
    label:merged?'核验视频资料、并观看了视频画面':entry[0],title:clean(evidence?.title,140)||(validBv(evidence?.bvid)?'视频 '+evidence.bvid+'（标题未记录）':entry[1]),
    detail:merged?'核验了视频公开资料；'+visualSourceDetail(video):
      x.verifiedReadKind==='video-metadata'?continuationDiaryDetail(x):'',
    ...(merged?{mergedVisualAt:Number(video.at)}:{}),...evidenceFields(evidence)})
 }
 // A verified visual observation may be joined with an exact same-episode metadata
 // receipt above. Never merge merely by BV/title/timestamp. Display canonical verified visual
 // read receipts, not the number of candidate/imagined frames.
 for(const x of explorationEvidence||[]){
   const at=Number(x?.at),frames=Number(x?.frameCount)
   if(x?.action!=='observe-video'||!Number.isSafeInteger(at)||at<cutoff||at>now||
      !validBv(x.bvid)||!Number.isSafeInteger(frames)||frames<1||frames>48)continue
   if(rows.some(row=>row.mergedVisualAt===at&&row.bvid===x.bvid))continue
   rows.push({id:'life-visual:'+at+':'+x.bvid,type:'life-visual',at,day:localDay(at),
     label:'观察视频画面',title:clean(x.title,85)||'视频 '+x.bvid+'（标题未记录）',
     detail:visualSourceDetail(x),
     ...evidenceFields(x)})
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
  const card=restCard(x)
  rows.push({id:'life-rest:'+at+':'+(ref||'turn'),at,day:localDay(at),type:'life-rest',...card})
 }
 // One readable entry for actual, safe Life choices that are NOT already
 // represented by a verified read, video round or independent send receipt.
 for(const x of lifeDecisions||[]){
  const at=Number(x?.at)
  if(x?.mode!=='active'||x.failed===true||!Number.isSafeInteger(at)||at<cutoff||at>now)continue
  const card=localLifeActionCard(x)
  if(!card)continue
  const evidenceAction=x.action==='inspect_creator_space'?'inspect-creator-space':x.action==='inspect_public_person'?'inspect-public-person':x.action==='inspect_video_discussion'?'inspect-video-discussion':x.action==='begin_exploration'?'search':''
  // Public interest curiosity is attributed only when the original cue ID
  // matches the verified search receipt. A nearby search is not enough to
  // infer why this Life decision was made.
  const exactSearch=x.action==='begin_exploration'&&/^[a-f0-9]{16}$/.test(String(x.continuation||''))?
    (explorationEvidence||[]).find(e=>e.action==='search'&&e.cueRef===x.continuation&&
      Number.isSafeInteger(e.at)&&Math.abs(e.at-at)<=5*60_000):null
  const evidence=exactSearch||(x.action==='begin_exploration'?null:
    evidenceAction?timelineEvidenceNear(explorationEvidence,at,evidenceAction):null)
  const interest=['interest-milestone','selection-curiosity'].includes(exactSearch?.sourceKind)?
    clean(exactSearch.sourceTopic,40):''
  const fromMilestone=exactSearch?.sourceKind==='interest-milestone'
  const ownerCard=interest?{...card,
    title:fromMilestone?`因对「${interest}」的兴趣查找了公开视频`:`因好奇「${interest}」查找了公开视频`,
    detail:fromMilestone?
      '来源：经过多次真实选片积累的兴趣线索；已取得公开搜索回执，未证实已看完视频。':
      '来源：此前一次真实选片产生的好奇线索；不等于长期兴趣，也不代表已经看完视频。'}:card
  const ref=Array.isArray(x.eventRefs)?x.eventRefs.find(v=>/^[a-f0-9]{16}$/.test(v)):null
  rows.push({id:'life-consider:'+at+':'+(ref||x.action),at,day:localDay(at),type:'life-consider',...ownerCard,...evidenceFields(evidence)})
 }
 // No-actionable-options is a scheduler diagnostic, not a life event. Keep
 // it in the original per-account decision ledger and the diagnostics tab;
 // do not flood the owner's diary with repeated empty polling turns.
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
  // Legacy Life write receipts and verified Episode steps can describe the
  // same send. Prefer the source-linked Episode card, using a one-to-one
  // bounded timestamp match; never merge unrelated sends just by day/kind.
  const fallback=writeLabels[step.action]
  if(fallback){
   const matches=rows.map((r,i)=>({r,i})).filter(({r})=>r.type==='life-write'&&
     r.title===fallback[1]&&Math.abs(r.at-step.at)<=1500)
     .sort((a,b)=>Math.abs(a.r.at-step.at)-Math.abs(b.r.at-step.at))
   if(matches.length)rows.splice(matches[0].i,1)
  }
  // Episode steps link only by the same verified, account-scoped series.
  // A homepage round edge is allowed only when its original opaque receipt
  // explicitly matches this round, never because timestamps are close.
  const actualRound=(episode.history||[]).find(s=>s.action==='browse_home'&&s.outcome==='verified'&&
    /^[a-f0-9]{12}$/.test(String(s.roundRef||''))&&videoRounds.some(r=>r.ref===s.roundRef))?.roundRef
  const series=/^[a-f0-9]{24}$/.test(String(episode.seriesId||''))?episode.seriesId:episode.id
  const continuity=actualRound?{kind:'video-round',key:actualRound,evidence:'同一次探索的后续行动'}:
    /^[a-f0-9]{24}$/.test(String(series||''))?{kind:'episode',key:createHash('sha256').update('life-owner-continuity:'+series).digest('hex').slice(0,16),evidence:'同一段连续经历'}:null
  rows.push({id:'episode-action:'+key,type:'life-action',at:step.at,day:localDay(step.at),label,title,detail:'',
    ...(continuity?{continuity}:{})})
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
 for(const x of comments||[]){const at=Date.parse(x.time||'');if(!Number.isFinite(at)||at<cutoff||at>now+86400000||!validBv(x.bvid))continue;const uid=x.kind==='reply'&&validUid(x.recipientUid)?String(x.recipientUid):'';rows.push({id:'comment:'+x.bvid+':'+String(x.rpid||x.time),at,day:localDay(at),type:'comment',label:x.kind==='reply'?'回复评论':'发表原创主评论',title:clean(x.snippet||'公开评论记录',140),detail:clean(x.kind==='reply'?(x.recipientName?`回复对象：${x.recipientName}`:''):'这是新发表的顶层评论，不是对旧楼层的回复；如果想知道为何选择此视频，请结合本时段的 Life 决策记录核对，单条公开评论回执没有完整的触发原因。',148),bvid:x.bvid,url:x.url||'https://www.bilibili.com/video/'+x.bvid,...(uid?{uid,profileUrl:'https://space.bilibili.com/'+uid}:{})})}
 // Keep true changes only. Repeated events with the same mood are not
 // separate owner-facing changes; the raw events remain in emotion history.
 const emotions=[...(emotionHistory||[])].map(x=>({...x,moment:typeof x.at==='number'?x.at:Date.parse(x.at||'')}))
   .filter(x=>Number.isFinite(x.moment)&&x.moment<=now).sort((a,b)=>a.moment-b.moment)
 let lastMood=''
 for(const x of emotions){const mood=String(x.mood||'').trim();if(!mood)continue
   if(mood===lastMood)continue
   lastMood=mood
   if(x.moment<cutoff)continue
   rows.push({id:'emotion:'+x.moment+':'+mood,at:x.moment,day:localDay(x.moment),type:'emotion',label:'心情变化',title:`心情转为${clean(x.label||mood,24)}`,detail:''})
 }
 for(const friend of relationshipRows||[])for(const x of friend.history||[]){const at=Number(x.at);if(!Number.isFinite(at)||at<cutoff||at>now)continue;const label={known:'逐渐熟悉',familiar:'互动渐多',regular:'经常互动',new:'刚认识'}[x.stage]||x.stage;rows.push({id:'relationship:'+friend.uid+':'+at,type:'relationship',at,day:localDay(at),label:'关系阶段变化',title:`与${clean(friend.name||'一位白名单好友',36)}：${label}`,detail:'',...(validUid(friend.uid)?{uid:String(friend.uid),profileUrl:'https://space.bilibili.com/'+friend.uid}:{})})}
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

/**
 * Read-only owner visualization. A chain exists ONLY when upstream producers
 * exposed a matching verified round reference or Episode series. Unlinked
 * actions remain independent even when they share a day, BV or nearby time.
 * The grouping is visual, not a receipt, memory, permission or causality inferer.
 */
export function groupLifeTimeline(rows=[]){
 const chains=new Map(),independent=[]
 for(const row of Array.isArray(rows)?rows:[]){
  const key=row?.continuity?.key,kind=row?.continuity?.kind
  if(!(['video-round','episode'].includes(kind)&&
       (kind==='video-round'?/^[a-f0-9]{12}$/:/^[a-f0-9]{16}$/).test(String(key||'')))){
    independent.push(row);continue
  }
  const id=kind+':'+key
  if(!chains.has(id))chains.set(id,{id,kind,evidence:row.continuity.evidence,rows:[]})
  chains.get(id).rows.push(row)
 }
 return {chains:[...chains.values()].map(c=>({...c,
   rows:c.rows.sort((a,b)=>Boolean(a.dateOnly)-Boolean(b.dateOnly)||eventTime(a.at)-eventTime(b.at))}))
   .sort((a,b)=>eventTime(b.rows.at(-1)?.at||0)-eventTime(a.rows.at(-1)?.at||0)),
   independent}
}
