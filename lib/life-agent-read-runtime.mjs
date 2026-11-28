import {privateDiagnosticFacts} from './interaction-privacy.mjs'
import {randomUUID} from 'node:crypto'
import {executeChosenLifeRead} from './life-willingness.mjs'
import {normalizeRecallRequest} from './recall-request.mjs'
import {normalizeVisualDetailSelection} from './active-recall-contract.mjs'
import {VIDEO_ACTION_KIND,isPrivateSessionRead,exactSessionPrivateRead} from './life-action-protocol.mjs'
/** Shared turn-local read tool contract. Host capabilities are the authority;
 * the model chooses the order. No permission, scheduling or external writes
 * originate here. Only memory has a verified parameter contract for rereads. */
// Shared decision handoff, not another Agent, scheduler, prompt or budget.
// The caller owns the original scene/identity and model reservation. A model
// result is usable only while that exact authority is current on both sides.
// A stale result is not an error from the provider or a voluntary stop.
export async function executeLifeDecision({isCurrent,invoke}={}){
  const current=()=>{try{return typeof isCurrent==='function'&&isCurrent()===true}catch{return false}}
  if(!current()||typeof invoke!=='function')return {ok:false,reason:'life-decision-scope-changed',started:false}
  let value
  try{value=await invoke()}catch(error){
    if(!current())return {ok:false,reason:'life-decision-scope-changed',started:true}
    throw error
  }
  if(!current())return {ok:false,reason:'life-decision-scope-changed',started:true}
  return {ok:true,value,started:true}
}
export const LIFE_READ_LIMITS=Object.freeze({rounds:6,total:8,perRequest:4,memory:3})
const descriptors=Object.freeze({
  todo:'读取当前联系人相关的既有待办回执',recommendation:'读取已核验推荐入账',
  memory:'按自主 recallQueries 检索当前允许域的活体记忆，可附时间或细节范围；不同参数可再次检索',
  portrait:'读取当前联系人获准画像线索',meme:'核对当前话题的本地梗知识',
  video:'展开本评论来源的真实视频上下文',history:'展开当前会话历史',
  public_person:'查看当前真实评论者的获准公开投稿',hot_comments:'查看当前真实 BV 的公开热评',
  shared_link:'核验当前已提供的分享候选，多个候选须选择准确 ID',
  shared_original:'读取已核验分享的唯一原动态',shared_video:'观察获准分享视频的代表性画面或语音',
  recent_observations:'主人专属：查看当前账号现有观察清单',
  observation_detail:'主人专属：从已核验清单选择精确分镜，核验字节和旧描述',
  owner_todos:'主人专属：查看当前账号开放待办状态'
})
// One registry of the actual read routes, not a permission source. An alias
// identifies a host adapter, not interchangeable access to its target/domain.
const episodeDescriptors=Object.freeze({
  search_public_topic:{kind:'public_search',description:'自主构思公开主题并搜索真实公开视频；仅公开隔离上下文生成参数'},
  recall_public_experience:{kind:'memory',description:'检索当前账号活体公开旧观察，不是新观看'},
  inspect_exploration:{kind:'video',description:'核验当前 Episode 提供的准确 BV 元数据'},
  inspect_creator_space:{kind:'public_person',description:'查看当前已核验作品作者的公开投稿'},
  browse_home_more:{kind:'home_feed',description:'读取当前 Episode 获准的真实首页推荐'},
  inspect_commenter_works:{kind:'public_person',description:'查看当前菜单内具备独立证据的评论者公开投稿'},
  inspect_video_discussion:{kind:'hot_comments',description:'查看当前已核验 BV 的真实公开讨论'},
  observe_video:{kind:'shared_video',description:'自主观察当前 Episode 已核验 BV 的全局代表画面，原视觉预算和证据门禁仍有效'},
  focus_video:{kind:'video_focus',description:'仅依据本次可信全局观察候选选择片段，原窗口、帧与网络预算仍有效'}
})
// Main Session uses the host's own Agent loop. Only actual read adapters
// belong here; attachment delivery, association confirmation and writes retain
// their distinct original transaction paths.
const mainDescriptors=Object.freeze({
  bili_read_dm:'指定联系人的近期私信正文',bili_whoami:'当前登录身份',bili_dm_contact_lookup:'真实已有私信联系人核验',
  bili_growth_recall:'角色成长规则',bili_experience_recall:'当前允许域的真实经历',
  bili_search:'公开视频搜索',bili_home_recommendations:'当前账号首页推荐',
  bili_subtitle:'真实字幕',bili_comments:'公开评论',bili_status:'插件运行状态',
  bili_video_info:'真实视频资料',bili_comment_thread:'公开楼中楼',bili_danmaku:'弹幕文本',
  bili_video_zones:'视频分区',bili_hot_videos:'热门视频',bili_hot_buzzwords:'热门话题',
  bili_weekly_hot:'每周必看',bili_rank:'排行榜',bili_user_info:'公开用户资料',
  bili_creator_relation_status:'当前账号创作者关系回执',bili_user_videos:'公开投稿',
  bili_favorite_lists:'收藏夹列表',bili_favorite_content:'收藏夹内容',
  bili_unread_messages:'未读消息数',bili_received_replies:'回复通知',
  bili_dynamic_comment_context:'动态公开评论上下文',bili_received_at_and_likes:'收到的@和点赞',
  dafeiyu_memory_recall:'长期记忆检索',dafeiyu_life_recall:'活体经历回忆（不含联想确认写入）',
  dafeiyu_todo_list:'当前账号待办清单',dafeiyu_recent_observations:'最近真实观察清单',
  dafeiyu_observation_detail:'准确分镜原图字节与已有描述核验'
})
// Shared capability identity is descriptive, never an alias-based dispatch or
// scope grant. E.g. memory and public_person still use their original adapters.
const mainCapabilities=Object.freeze({
  bili_search:'public_search',bili_video_info:'video',bili_comments:'hot_comments',bili_user_videos:'public_person',
  bili_home_recommendations:'home_feed',dafeiyu_memory_recall:'memory',dafeiyu_life_recall:'memory',
  dafeiyu_recent_observations:'recent_observations',dafeiyu_observation_detail:'observation_detail',
  dafeiyu_todo_list:'owner_todos'
})
// Only already-connected Episode writes are registered. Host manual actions
// and social sends are NOT interchangeable with these autonomous capabilities.
const episodeWrites=Object.freeze({
  like_video:Object.freeze({kind:VIDEO_ACTION_KIND.like_video,executorTool:'bili_video_like',permissionFlag:'autoVideoLike',description:'点赞当前已核验视频'}),
  collect_video:Object.freeze({kind:VIDEO_ACTION_KIND.collect_video,executorTool:'bili_video_collect',permissionFlag:'autoVideoCollect',description:'收藏当前已核验视频'}),
  follow_creator:Object.freeze({kind:VIDEO_ACTION_KIND.follow_creator,executorTool:'bili_follow_creator',permissionFlag:'agentFollowEnabled',description:'关注当前已核验视频作者'}),
  comment_video:Object.freeze({kind:VIDEO_ACTION_KIND.comment_video,executorTool:'bili_reply',permissionFlag:'autoComment',description:'向当前已核验视频发表原创评论'})
})
export function registeredLifeWrite(scene,action){
  return scene==='episode'&&typeof action==='string'&&Object.hasOwn(episodeWrites,action)?
    {action,...episodeWrites[action],risk:'write',capability:episodeWrites[action].kind}:null
}
export function registeredLifeWrites(scene){
  return scene==='episode'?Object.keys(episodeWrites).map(action=>registeredLifeWrite(scene,action)):[]
}
export function registeredLifeTool(scene,action){
  const read=registeredLifeRead(scene,action)
  return read?{...read,risk:'read',...(scene==='main-session'&&isPrivateSessionRead(action)?{disclosure:'private'}:{}),capability:scene==='main-session'?(mainCapabilities[action]||read.kind):read.kind}:
    registeredLifeWrite(scene,action)
}
export function registeredLifeTools(scene){
  return [...registeredLifeReads(scene).map(row=>registeredLifeTool(scene,row.action)),...registeredLifeWrites(scene)]
}
// A write cannot use the read gateway's post-I/O rejection: after dispatch
// the original sender must settle the real receipt, even if permissions change.
// Only the trusted adapter supplies the guard and the already sealed operation.
export async function executeRegisteredLifeWrite({scene,action,isCurrent,write}={}){
  if(!registeredLifeWrite(scene,action))return {ok:false,status:'blocked',code:'life-write-not-registered',attempted:false}
  let current=false
  try{current=typeof isCurrent==='function'&&isCurrent()===true}catch{}
  if(!current||typeof write!=='function')return {ok:false,status:'blocked',code:'authorization-changed-after-queue',attempted:false}
  return write()
}
/** Static inventory for inspection; never use it as a permission grant. */
export function registeredLifeReads(scene){
  const actions=scene==='social'?Object.keys(descriptors).map(k=>'read_'+k):
    scene==='episode'?Object.keys(episodeDescriptors):scene==='main-session'?Object.keys(mainDescriptors):[]
  return actions.map(action=>registeredLifeRead(scene,action))
}
/** The social model has already made its read choice. This is a deterministic
 * source/permission check, not a second intention model or a write credential.
 * Its inputs come from the authenticated host, never model-supplied UID/BV. */
export function authorizeRegisteredCommentReads({row,readKinds,enabled=false,accountTag='',accountUid=''}={}){
  if(enabled!==true||row?.kind!=='comment'||row.verifiedCommentSource!==true||row.privacyGuard===true||
    !/^[a-f0-9]{16}$/.test(String(accountTag))||!/^[1-9]\d{0,18}$/.test(String(accountUid))||
    !/^BV[0-9A-Za-z]{10}$/.test(String(row.bvid||''))||!/^[1-9]\d{0,19}$/.test(String(row.incomingRpid||row.rpid||''))||
    !Array.isArray(readKinds))return {ok:false,allowedReadKinds:[],reason:'not-offered'}
  const allowedReadKinds=[...new Set(readKinds)].filter(k=>k==='hot_comments'||k==='public_person'&&
    /^[1-9]\d{0,18}$/.test(String(row.uid||''))&&Number.isSafeInteger(Number(row.uid))&&String(row.uid)!==String(accountUid))
  return {ok:allowedReadKinds.length>0,allowedReadKinds,reason:allowedReadKinds.length?'life-selected':'not-offered'}
}
export function registeredLifeRead(scene,action){
  if(typeof action!=='string')return null
  if(scene==='social'&&action.startsWith('read_')){
    const kind=action.slice(5)
    return Object.hasOwn(descriptors,kind)?{action,kind,description:descriptors[kind]}:null
  }
  if(scene==='main-session'&&Object.hasOwn(mainDescriptors,action))return {action,kind:action,description:mainDescriptors[action]}
  return scene==='episode'&&Object.hasOwn(episodeDescriptors,action)?{action,...episodeDescriptors[action]}:null
}
/** Only host-validated actions reach this gateway. Registration is not a
 * capability grant; the original adapter still owns permissions and receipts.
 * Scope is checked on both sides of I/O by the existing willingness helper. */
export async function executeRegisteredLifeRead({scene,actions,isCurrent,read}={}){
  if(!Array.isArray(actions)||!actions.length||new Set(actions).size!==actions.length||
    actions.some(action=>!registeredLifeRead(scene,action))||scene!=='social'&&actions.length!==1)
    return {ok:false,reason:'life-read-not-registered'}
  return executeChosenLifeRead({chosen:true,isCurrent,read})
}
/** Private disclosure requires a separate, scoped decision by the existing Life
 * willingness engine. No private body is read before that decision. The host
 * supplies the real owner-turn guard and a single-use claim, never tool args. */
export async function executeMainSessionPrivateRead({willingness,isCurrent,claim,request,uid,limit,tool='bili_read_dm',args,settleClaim,ownerTurn,boundOwnerUid,dmSemanticContext,read}={}){
  const current=()=>{try{return isCurrent?.()===true}catch{return false}}
  const unavailable=()=>({ok:false,reason:'life-private-read-unavailable',lifeAction:'blocked'})
  if(!current()||typeof claim!=='function'||typeof read!=='function'||!willingness?.decide||!willingness?.verify||!willingness?.receipt)return unavailable()
  const target=exactSessionPrivateRead(tool==='bili_read_dm'?{tool,uid,limit}:{tool,args:args??{}})
  if(!target||!registeredLifeRead('main-session',tool))return unavailable()
  if(claim(target)!==true)return {ok:false,reason:'life-private-read-already-considered',lifeAction:'blocked'}
  let delivered=false
  try{
  // Explicit work delegation is a host-owned, one-turn exception, not a Life
  // vote or a general private-read grant. The same claim and read adapter apply.
  if(ownerTurn?.workDmLimit!=null){
    if(typeof ownerTurn!=='function'||ownerTurn.mode!=='work'||!ownerTurn()||tool!=='bili_read_dm'||target.uid!==boundOwnerUid||target.limit!==ownerTurn.workDmLimit)
      return {ok:false,reason:'owner-work-scope-mismatch'}
    try{
      const execution=await executeRegisteredLifeRead({scene:'main-session',actions:[tool],isCurrent:()=>current()&&ownerTurn()===true,read:()=>read(target.args)})
      if(!execution.ok||!current()||!ownerTurn()||execution.value==null)return unavailable()
      const result=execution.value
      delivered=result?.ok===true
      return {...result,authorization:'owner-work-explicit'}
    }catch{return unavailable()}
  }
  let choice
  try{choice=await willingness.decide({scene:'main',trigger:'main-session-private-read',sourceKey:'main-private-read:'+randomUUID(),isCurrent:current,
    candidates:[{id:'private-read',kind:'session_private_read',label:'同意向当前主人披露：'+registeredLifeRead('main-session',tool).description}],
    evidence:{sessionPrivateRead:{...target,request:String(request||'').slice(0,2000),...(tool==='bili_read_dm'&&dmSemanticContext?{dmSemanticContext}: {})}}},{queueIfBusy:true})}catch{return unavailable()}
  if(choice?.ok!==true){
    // System competition is not a voluntary refusal. Do not echo model reasons,
    // which may contain private material; the original Session can respond naturally.
    if(!current())return {ok:false,reason:'session-or-account-not-current'}
    if(choice?.reason==='owner-turn-target-required')return {ok:false,reason:choice.reason}
    const action=choice?.voluntary===true&&['skip','defer'].includes(choice.action)?choice.action:'blocked'
    return {ok:false,reason:action==='skip'?'life-private-read-declined':action==='defer'?'life-private-read-deferred':'life-private-read-unavailable',lifeAction:action,message:action==='skip'?'鱼鱼本次不愿披露所请求的私人资料，未读取私密内容；请尊重其选择，不要在本轮改用其他工具获取。':action==='defer'?'鱼鱼本次选择延期，未读取私密内容。':'本次未获得有效 Life 意愿批准，未读取私密内容。'}
  }
  let settled=false
  try{
    if(!current()||choice.candidateId!=='private-read'||willingness.verify(choice.proof,'session_private_read',target)?.ok!==true)return unavailable()
    if(!current())return unavailable()
    const execution=await executeRegisteredLifeRead({scene:'main-session',actions:[tool],isCurrent:current,read:()=>read(target.args)})
    if(!execution.ok)return unavailable()
    const result=execution.value
    if(!current())return {ok:false,reason:'session-or-account-not-current'}
    if(result===undefined||result===null)return unavailable()
    // The caller must not receive private content if the original claim could
    // not be settled, even when the network returned a valid response.
    // Verified here means scoped disclosure delivery, not a platform success.
    // Preserve original adapter errors/status and never create a Life action.
    settled=willingness.receipt(choice.proof,{status:'verified'})?.ok===true
    const authorized=settled&&current()
    delivered=authorized&&result?.ok!==false
    return authorized?result:unavailable()
  }catch{return unavailable()}
  finally{if(!settled)try{willingness.receipt(choice.proof,{status:'not-sent'})}catch{}}
  }finally{try{settleClaim?.(delivered)}catch{}}
}
export const isLifeReadKind=kind=>typeof kind==='string'&&Object.hasOwn(descriptors,kind)
export const lifeReadDescription=kind=>isLifeReadKind(kind)?registeredLifeRead('social','read_'+kind).description:''
export function lifeReadKinds(value){return Array.isArray(value)?[...new Set(value.filter(isLifeReadKind))]:[]}
export function validateLifeReadRequest(requested,menu){
  if(!Array.isArray(requested)||!Array.isArray(menu)||requested.length>LIFE_READ_LIMITS.perRequest)return null
  const offered=new Set(menu.filter(x=>x.risk==='read').map(x=>x.action))
  if(requested.some(kind=>!isLifeReadKind(kind)||!offered.has('read_'+kind)))return null
  return lifeReadKinds(requested)
}
/** Project unused current capabilities, not static workflows. Budget is per
 * conversation item; the existing host still checks shared platform budgets. */
/** Normalize the effective recall parameters, never a model-supplied scope.
 * Order/case changes alone cannot manufacture a new search. */
export function lifeMemoryReadKey(queries,recall={},now=Date.now()){
  const extra=recall&&typeof recall==='object'&&!Array.isArray(recall)?recall:{}
  const normalized=normalizeRecallRequest({queries,intent:extra.intent,time:extra.time,kinds:extra.kinds},{now})
  const detail=normalizeVisualDetailSelection(extra.detail)
  if(!normalized||detail===false||detail&&(normalized.time||normalized.kinds.length||normalized.intent!=='topic_recall'))return null
  return JSON.stringify({queries:normalized.queries.map(q=>q.toLowerCase()).sort(),intent:normalized.intent,
    kinds:[...normalized.kinds].sort(),time:normalized.time?{fromDay:normalized.time.fromDay,toDay:normalized.time.toDay}:null,detail})
}
export function remainingLifeReads(offered,used=[],rounds=0,{total=new Set(used).size,memoryCount=0,allowMemoryRepeat=false}={}){
  const consumed=new Set(used)
  if(rounds>=LIFE_READ_LIMITS.rounds||total>=LIFE_READ_LIMITS.total)return []
  return lifeReadKinds(offered).filter(kind=>!consumed.has(kind)||kind==='memory'&&allowMemoryRepeat&&memoryCount<LIFE_READ_LIMITS.memory)
}
export function createLifeReadRuntime({allowMemoryRepeat=false}={}){
  const used=new Set(),memoryKeys=new Set();let rounds=0,total=0
  return {
    get used(){return [...used]},get rounds(){return rounds},get total(){return total},get memoryCount(){return memoryKeys.size},
    available:offered=>remainingLifeReads(offered,used,rounds,{total,memoryCount:memoryKeys.size,allowMemoryRepeat}),
    validate(requested,menu,{memoryKey=null}={}){
      const kinds=validateLifeReadRequest(requested,menu)
      if(!kinds?.length||rounds>=LIFE_READ_LIMITS.rounds||total+kinds.length>LIFE_READ_LIMITS.total||kinds.some(k=>used.has(k)&&k!=='memory'))return null
      if(kinds.includes('memory')&&(!memoryKey||used.has('memory')&&(!allowMemoryRepeat||memoryKeys.has(memoryKey)||memoryKeys.size>=LIFE_READ_LIMITS.memory)))return null
      return kinds
    },
    record(kinds,{memoryKey=null}={}){for(const k of kinds)used.add(k);if(kinds.includes('memory'))memoryKeys.add(memoryKey);total+=kinds.length;rounds++}
  }
}

/** The host calls this only with the raw, claimed owner message. This mode
 * affects presentation, not authority. Explicit work delegation is separately
 * parsed and bound to the same host claim. */
export function ownerTurnMode(raw){return typeof raw==='string'&&/^work:[ \t]*\S/u.test(raw)?'work':'life'}
// Only a deliberately bounded command grammar is executable authority. Raw
// owner text is parsed at host claim time, never from model arguments/history.
export function ownerWorkDmLimit(raw){
  if(typeof raw!=='string'||/[\r\n]/u.test(raw))return null
  const m=/^work:[ \t]*(?:读取|查看|获取)(?:我和你|你和我|我们|咱们)的(?:[bB]站)?私信(?:[ \t]*最近([1-9]|1[0-9]|20)条)?[。！]?[ \t]*$/u.exec(raw)
  return m?Number(m[1]||10):null
}
// The same role-facing vocabulary applies to every channel. These are
// semantic instructions to the original Life voice, not canned replies.
export {ROLE_DISCLOSURE_EXPRESSION} from './life-voice-context.mjs'
export function roleDisclosureChoice(choice){
  const facts={
    'prefer-not-to-share':'这是你自己的选择：不分享本次私人资料。',
    'not-now':'这是你自己的选择：此刻不分享。',
    'not-authorized':'这些资料不属于当前交流可分享的范围。',
    'not-confirmed':'本次没有形成分享决定；不交付私人资料，也不替你假定主动拒绝。',
    'unavailable':'本次无法取得或交付所请求的资料；不是你主动拒绝。'
  }
  const key=Object.hasOwn(facts,choice)?choice:'unavailable'
  return {ok:false,choice:key,fact:facts[key]}
}
/** A work presentation is valid only while the ORIGINAL host turn is current.
 * Never infer it from an incoming Bilibili message or tool parameter. */
export function projectBoundPrivateReadForRole(result,turn){
  let current=false;try{current=typeof turn==='function'&&turn()===true}catch{}
  const view=projectPrivateReadForRole(turn&&!current?{ok:false,reason:'session-or-account-not-current'}:result,current&&turn.mode==='work'?'work':'life')
  // A current authenticated owner may ask for technical facts without work:.
  // Keep arbitrary adapter prose, secret fields and rejected bodies out.
  const diagnostic=current&&turn.mode!=='work'?privateDiagnosticFacts(result):null
  return diagnostic?{...view,ownerDiagnostic:diagnostic}:view
}
/** Keep the internal result unchanged; project only at the model boundary.
 * Do not supply fixed emotional reasons or turn technical failure into refusal. */
export function projectPrivateReadForRole(result,mode='life'){
  if(mode==='work'||!result||result.ok!==false)return result
  const reason=String(result.reason||'')
  // Preserve typed selection/pagination failures needed for the original recall
  // and association protocols, not an invitation to retry a privacy refusal.
  if(/^(?:invalid-detail-|detail-|association-|invalid-memory-kind|budget-too-small)/.test(reason))return result
  if(reason==='life-private-read-declined'&&result.lifeAction==='skip')return {...roleDisclosureChoice('prefer-not-to-share'),fact:'你选择不分享；没有读取正文或交付所请求的私人资料。'}
  if(reason==='life-private-read-deferred'&&result.lifeAction==='defer')return {...roleDisclosureChoice('not-now'),fact:'你选择此刻不分享；没有读取正文或交付所请求的私人资料。'}
  if(reason==='life-private-read-already-considered')return {ok:false,choice:'already-settled',fact:'本轮不再尝试披露。'}
  if(reason==='owner-contact-unavailable')return {ok:false,choice:'unavailable',fact:'还没有可用的已绑定主人 B站身份；请检查主人账号绑定，没有读取正文。'}
  if(['owner-turn-target-required','contact-ambiguous','contact-needs-clarification','conflicting-contact-selectors'].includes(reason))return {ok:false,choice:'clarify-person',fact:'还不能确定要查看谁的私信；没有读取正文。',...(typeof result.suggestedName==='string'?{suggestedName:result.suggestedName}:{})}
  return roleDisclosureChoice('unavailable')
}
