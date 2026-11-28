/**
 * 2.8.0 shared Life action contract. An observation offers an opportunity, a
 * model decision owns intention, and a sealed one-shot proof only permits the
 * ORIGINAL sender to attempt the exact action. Neither observing nor owning a
 * proof asserts delivery. Do not expose identities or public text in traces.
 */
import {createHash} from 'node:crypto'

export const VIDEO_ACTION_KIND=Object.freeze({
  like_video:'video_like',collect_video:'video_collect',
  follow_creator:'video_follow',comment_video:'video_comment'
})
export const LIFE_ACTION_OUTCOMES=Object.freeze([
  'not_offered','declined','deferred','blocked','executing','verified','uncertain'
])
const BV=/^BV[0-9A-Za-z]{10}$/
const CONTROL=/[\u0000-\u001f\u007f]/
const SOURCES=new Set(['life-opportunity','life-todo','life-search-child','social-read-now','owner-dm-read','comment-reply-receipt','video-agent'])

/** All video entrypoints use one evidence shape; an observation is never a write permission. */
export function verifiedVideoObservation({source,sourceId,bvid,title,at=Date.now(),accountTag}={}){
  if(!SOURCES.has(source)||typeof sourceId!=='string'||sourceId.length<1||sourceId.length>200||CONTROL.test(sourceId)||
    !BV.test(String(bvid||''))||typeof title!=='string'||!title.trim()||title.length>200||CONTROL.test(title)||
    !/^[a-f0-9]{16}$/.test(String(accountTag||''))||!Number.isSafeInteger(at)||at<=0)
    return {ok:false,code:'observation-unverified'}
  return {ok:true,source,sourceId,bvid,title:title.trim().slice(0,100),at,accountTag,
    evidenceLevel:'verified-public-metadata',watched:false}
}

export function exactDynamicAction({kind,target,commentText=''}={}){
  if(!['dynamic_like','dynamic_comment'].includes(kind)||!/^[1-9]\d{5,19}$/.test(String(target||'')))return null
  if(kind==='dynamic_comment'){
    if(typeof commentText!=='string'||!commentText.trim()||commentText.length>180||
      CONTROL.test(commentText)||/@/.test(commentText)||/https?:\/\/|www\./i.test(commentText))return null
  }else if(commentText!=='')return null
  return {kind,target:String(target),commentText:kind==='dynamic_comment'?commentText:''}
}

export function exactVideoAction({kind,target,commentText=''}={}){
  if(!Object.values(VIDEO_ACTION_KIND).includes(kind)||!BV.test(String(target||'')))return null
  if(kind==='video_comment'){
    if(typeof commentText!=='string'||!commentText.trim()||commentText.length>180||
      CONTROL.test(commentText)||/@/.test(commentText)||/https?:\/\/|www\./i.test(commentText))return null
  }else if(commentText!=='')return null
  return {kind,target,commentText:kind==='video_comment'?commentText:''}
}

export function lifeActionOutcome({offered=true,decision='',gate='',delivery=''}={}){
  if(!offered)return 'not_offered'
  if(gate)return 'blocked'
  if(decision==='skip'||decision==='refuse')return 'declined'
  if(decision==='defer')return 'deferred'
  if(delivery==='verified')return 'verified'
  if(['uncertain','accepted-unverified','unconfirmed','failed'].includes(delivery))return 'uncertain'
  return 'executing'
}

/** A tool's claimed outer success does not establish video metadata. The
 * exact BV and a nonempty verified info title must agree. */
export function observedVideoFromRead({source,sourceId,expectedBvid,read,accountTag,at=Date.now()}={}){
  if(read?.ok!==true||read?.bvid!==expectedBvid)return {ok:false,code:'read-not-verified'}
  let info=read.info
  if(typeof info==='string'){try{info=JSON.parse(info)}catch{return {ok:false,code:'info-invalid'}}}
  if(info?.data&&typeof info.data==='object')info=info.data
  if(info?.bvid!==expectedBvid)return {ok:false,code:'info-target-mismatch'}
  return verifiedVideoObservation({source,sourceId,bvid:expectedBvid,title:info.title,accountTag,at})
}

/** Compatibility adapter for a verified owner request with no independent
 * model-planned intention yet. The SAME Life willingness arbiter makes ONE
 * decision; no emotion score or second social agent can override it.
 * This is an opportunity disposition, not a grant to bypass the original
 * sender. Legacy tool permissions, identity and post-write checks remain.
 */
export async function unifiedLegacySocialChoice({lifeWillingness,source,uid,messageId,intent='explore',target='',thread='',hint=''}={}){
  if(!['bili-dm','bili-comment'].includes(source)||!/^[1-9]\d{0,18}$/.test(String(uid||''))||
    !String(messageId||'').trim()||!lifeWillingness||typeof lifeWillingness.decide!=='function')
    return {decision:'blocked',reason:'life-intent-unavailable'}
  const mapped={explore:'social_read',chat:'reflect',like:'video_like',collect:'video_collect',
    follow:'video_follow',unfollow:'video_unfollow',publish:'write_dynamic'}[intent]
  if(!mapped)return {decision:'blocked',reason:'unsupported-life-action'}
  const identity=[source,uid,messageId,intent,target,thread].map(String).join('\0')
  // The namespace is stable, but no identifiers or untrusted text appear in
  // the anonymous willingness trace or persist as the source key.
  const key=createHash('sha256').update(identity).digest('hex')
  const candidate={id:'legacy_social',kind:mapped,label:({
    explore:'自主决定是否了解这条经核验的社会推荐',chat:'自主决定是否回应这条社交邀请',
    like:'自主决定是否点赞已确定目标',collect:'自主决定是否收藏已确定目标',
    follow:'自主决定是否关注已确定目标',unfollow:'自主决定是否取关已确定目标',
    publish:'自主决定是否处理已经明确授权的发布请求'})[intent]}
  let choice
  try{choice=await lifeWillingness.decide({scene:source==='bili-dm'?'dm':'comment',
    trigger:'legacy-verified-social-request',sourceKey:'legacy-social:'+key,
    uid:String(uid),candidates:[candidate],hint:String(hint||'').slice(0,200)},
    {queueIfBusy:true})}
  catch{return {decision:'blocked',reason:'life-intent-unavailable'}}
  if(choice?.ok!==true)return {decision:choice?.action==='defer'?'defer':choice?.action==='skip'?'refuse':'blocked',
    reason:choice?.reason||'life-intent-not-authorized'}
  // Consume exact kind of the single model selection before the existing
  // source-specific guarded executor. Delegation never means platform sent.
  const used=lifeWillingness.verify(choice.proof,mapped)
  if(used?.ok!==true){lifeWillingness.receipt(choice.proof,{status:'not-sent'});
    return {decision:'blocked',reason:'life-intent-proof-invalid'}}
  lifeWillingness.receipt(choice.proof,{status:'delegated'})
  return {decision:'allow',reason:'life-model-chose',score:null,mode:'life',newDecision:true}
}

// These host-facing reads can disclose a role's private information. Public
// reads and direct management/status remain on their original contracts.
const PRIVATE_SESSION_READS=Object.freeze([
  'bili_read_dm','bili_dm_contact_lookup','bili_experience_recall',
  'bili_home_recommendations','bili_creator_relation_status','bili_favorite_lists','bili_favorite_content',
  'bili_unread_messages','bili_received_replies','bili_received_at_and_likes',
  'dafeiyu_memory_recall','dafeiyu_life_recall','dafeiyu_todo_list','dafeiyu_recent_observations','dafeiyu_observation_detail'
])
export const isPrivateSessionRead=tool=>PRIVATE_SESSION_READS.includes(tool)
export function exactSessionPrivateRead(value){
  if(!isPrivateSessionRead(value?.tool))return null
  if(value.tool==='bili_read_dm')return typeof value.uid==='string'&&/^[1-9]\d{0,15}$/.test(value.uid)&&Number.isSafeInteger(Number(value.uid))&&Number.isSafeInteger(value.limit)&&value.limit>=1&&value.limit<=20?{tool:value.tool,uid:value.uid,limit:value.limit}:null
  const args=value.args
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length>24)return null
  const pairs=Object.entries(args).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))
  if(pairs.some(([k,v])=>!/^[a-z][a-z0-9_]{0,63}$/.test(k)||!(typeof v==='string'&&v.length<=1000||typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'||v===null)))return null
  const target={tool:value.tool,args:Object.fromEntries(pairs)}
  return JSON.stringify(target).length<=1800?target:null
}

// The exact effective MCP payload of existing manual senders. These are NOT
// arbitrary model tool names, and the autonomous sender routes stay separate.
const OWNER_WRITE_FIELDS=Object.freeze({
  bili_video_like_manual:['bvid','reason'],
  bili_video_collect_manual:['bvid','folder_title','create_folder','reason','confirm'],
  bili_follow_creator_manual:['bvid','reason','confirm'],
  bili_unfollow_creator_manual:['uid','reason','confirm'],
  bili_reply_manual:['bvid','text','rpid','root','confirm'],
  bili_dynamic_comment_manual:['dynamic_id','target_rpid','root','text','confirm'],
  bili_send_message_manual:['receiver_uid','text','confirm'],
  bili_reply_existing_dm_manual:['receiver_uid','receiver_name','source_message_id','text','confirm']
})
export function exactSessionOwnerWrite(value){
  const tool=value?.tool,args=value?.args
  if(typeof tool!=='string'||!Object.hasOwn(OWNER_WRITE_FIELDS,tool)||!args||typeof args!=='object'||Array.isArray(args))return null
  const fields=OWNER_WRITE_FIELDS[tool]
  if(Object.keys(args).length!==fields.length||fields.some(k=>!Object.hasOwn(args,k)))return null
  if(fields.some(k=>!(typeof args[k]==='string'&&args[k].length<=2000||typeof args[k]==='number'&&Number.isSafeInteger(args[k])||typeof args[k]==='boolean')))return null
  if(fields.includes('confirm')&&args.confirm!==true)return null
  if(fields.includes('bvid')&&(typeof args.bvid!=='string'||!BV.test(args.bvid)))return null
  if(fields.includes('text')&&(typeof args.text!=='string'||!args.text.trim()||args.text!==args.text.trim()||args.text.length>(tool.includes('dm_')||tool==='bili_send_message_manual'?450:2000)))return null
  if(fields.includes('reason')&&(typeof args.reason!=='string'||args.reason.length>100))return null
  if(fields.includes('folder_title')&&(typeof args.folder_title!=='string'||!args.folder_title||args.folder_title!==args.folder_title.trim()||args.folder_title.length>40||typeof args.create_folder!=='boolean'))return null
  const positiveUid=v=>Number.isSafeInteger(v)&&v>0
  const decimal=v=>typeof v==='string'&&/^[1-9][0-9]{0,29}$/.test(v)
  if(fields.includes('uid')&&!positiveUid(args.uid))return null
  if(tool==='bili_reply_existing_dm_manual'){
    if(!decimal(args.receiver_uid)||args.receiver_uid.length>19||typeof args.receiver_name!=='string'||!args.receiver_name.trim()||args.receiver_name.length>60||typeof args.source_message_id!=='string'||!args.source_message_id||args.source_message_id.length>150)return null
  }else if(fields.includes('receiver_uid')&&!positiveUid(args.receiver_uid))return null
  if(tool==='bili_reply_manual'&&(!Number.isSafeInteger(args.rpid)||args.rpid<0||!Number.isSafeInteger(args.root)||args.root<0||!args.rpid&&args.root))return null
  if(tool==='bili_dynamic_comment_manual'&&(!decimal(args.dynamic_id)||!(args.target_rpid===''||decimal(args.target_rpid))||!(args.root===''||decimal(args.root))||!args.target_rpid&&args.root))return null
  return {tool,args:Object.fromEntries(fields.map(k=>[k,args[k]]))}
}
// Ignore diagnostic reasons and confirmation flags for duplicate detection;
// these can never make an otherwise identical write a new operation.
export function sessionOwnerWriteKey(value){
  const exact=exactSessionOwnerWrite(value)
  if(!exact)return ''
  const {reason,confirm,...effect}=exact.args
  return createHash('sha256').update(JSON.stringify({tool:exact.tool,args:effect})).digest('hex')
}
