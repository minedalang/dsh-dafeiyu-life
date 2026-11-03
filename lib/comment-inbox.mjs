import {resolveCommentCoordinates} from './comment-root-resolver.mjs';
/** 只把能够明确定位到视频和评论 ID 的 B站通知/热门评论交给互动引擎。 */
export const validId = v => /^\d{1,20}$/.test(String(v ?? '')) && BigInt(String(v)) > 0n ? String(v) : '';
export const validBv = v => /^BV[0-9A-Za-z]{10}$/.test(String(v || '')) ? String(v) : '';
import {avToBv,bvToAv} from './bv-to-av.mjs';
import {validDynamicId} from './bili-content-ref.mjs';

// Notification fields supplied by the platform are routing hints, not permission to send.
// An oid is not necessarily a public dynamic ID; it must be resolved against a
// locally published dynamic and its verified B站 detail before any reply.
export function dynamicIdFromNotification(entry={}) {
  for (const raw of [entry.uri,entry.native_uri]) {
    if (typeof raw!=='string' || raw.length>1500) continue;
    try {
      const u=new URL(raw);
      const host=u.hostname.toLowerCase();
      let match;
      if (u.protocol==='https:' && (host==='t.bilibili.com'||host==='m.bilibili.com'||host==='www.bilibili.com'||host==='bilibili.com')) {
        match=u.pathname.match(/^\/(?:opus\/|dynamic\/)?([1-9][0-9]{5,19})(?:\/|$)/);
      } else if (u.protocol==='bilibili:' && ['following','opus'].includes(host)) {
        match=u.pathname.match(/^\/(?:detail\/)?([1-9][0-9]{5,19})(?:\/|$)/);
      }
      if (match && validDynamicId(match[1])) return match[1];
    }catch{}
  }
  return '';
}
export const dynamicBusiness=entry=>[11,17].includes(Number(entry?.business_id)) ||
  (entry?.business_id==null && /^(?:动态|图文动态|文字动态)$/.test(String(entry?.business||'').trim()));

/** Prefer comment coordinates carried by B站's own notification URI or explicit root_id.
 * target_id is often the immediate parent, NOT necessarily the thread root. */
export function notificationCommentLocation(item, rpid) {
  let uriRoot='';
  for (const raw of [item?.uri, item?.native_uri]) {
    if (typeof raw!=='string' || raw.length>1500 || !raw.includes('comment_root_id')) continue;
    try {
      const u=new URL(raw);
      const allowed=(u.protocol==='https:' && (u.hostname==='bilibili.com'||u.hostname.endsWith('.bilibili.com')))
        || (u.protocol==='bilibili:' && u.hostname==='video');
      if (!allowed) continue;
      uriRoot=validId(u.searchParams.get('comment_root_id'));
      if (uriRoot) break;
    } catch { /* malformed or unsupported notification URI */ }
  }
  const explicitRoot=validId(item?.root_id);
  const root=uriRoot||explicitRoot;
  // If B站 says root_id=0, it is a top-level comment; source_id is the root.
  const top=String(item?.root_id??'')==='0' && !uriRoot && !validId(item?.target_id);
  return {locationRoot:root||(top?validId(rpid):''),locationSource:uriRoot?'bili-uri':explicitRoot?'root-id':top?'top':'unknown'};
}


// 仅使用接口返回的明确 Unix 时间戳；不存在时间字段时不做首次启动的旧通知补发。
function notificationTime(row, item) {
  for (const value of [item?.source_time,item?.reply_time,item?.ctime,item?.timestamp,row?.reply_time,row?.timestamp,row?.ctime]) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) continue;
    const ms = n < 1e11 ? n * 1000 : n;
    if (ms > 1500000000000 && ms < 4102444800000) return ms;
  }
  return 0;
}
export function normalizeReplyNotifications(raw, selfUid = '', {onIgnored=()=>{}} = {}) {
  if (raw?.error || (raw?.code != null && Number(raw.code) !== 0)) throw new Error('回复通知接口失败：' + String(raw.error || raw.message));
  const items = Array.isArray(raw) ? raw : (raw?.data?.items ?? raw?.items);
  if (!Array.isArray(items)) throw new Error('回复通知未返回 items，无法安全判重');
  return items.flatMap((x) => {
    const entry = x?.item || {};
    const uid = validId(x?.user?.mid) || validId(x?.user?.uid);
    const rpid = validId(entry.source_id);
    const aid=validId(entry.subject_id||entry.aid);
    const name=String(x?.user?.uname||x?.user?.name||x?.user?.nickname||'').trim().slice(0,60);
    const ignore=reason=>{onIgnored({id:'comment:'+(rpid||validId(x?.id)||'unknown'),uid,name,aid,rpid,reason});return [];};
    const uri=[entry.uri,entry.native_uri,entry.bvid].map(v=>String(v||'')).join(' ');
    const business=String(entry.business||'').trim();
    const hasVideoLink=/BV[0-9A-Za-z]{10}|(?:\bav|\/video\/av)[1-9]\d{0,19}/i.test(uri);
    const isDynamic=dynamicBusiness(entry)&&!hasVideoLink;
    if(!isDynamic&&business&&!['视频','评论'].includes(business))return ignore('not_video_comment');
    if(!isDynamic&&entry.business_id!=null&&Number(entry.business_id)!==1&&
       !(business==='评论'&&hasVideoLink&&![11,17].includes(Number(entry.business_id))))return ignore('not_video_comment');
    if(!uid||uid===String(selfUid))return ignore('sender_missing_or_self');
    const dynamicId=isDynamic?dynamicIdFromNotification(entry):'';
    if(isDynamic&&!dynamicId&&!validDynamicId(aid))return ignore('dynamic_reference_unverified');
    if((!aid&&!dynamicId)||!rpid)return ignore('comment_reference_missing');
    const text=stripAccountMentions(entry.source_content||entry.message,entry.at_details,selfUid);
    if(!text)return ignore('comment_text_missing');
    const bvid=isDynamic?'':validBv(uri.match(/BV[0-9A-Za-z]{10}/)?.[0])||avToBv(aid);
    const coordinates=resolveCommentCoordinates(entry,rpid,{kind:'notice'});
    return [{id:isDynamic?`comment:dynamic:${aid||dynamicId}:${rpid}`:`comment:${rpid}`,
      aid:aid||dynamicId,bvid,...(isDynamic?{contentType:'dynamic',dynamicId}:{}),rpid,...coordinates,
      root:coordinates.sendRoot,targetId:coordinates.targetId,uid,name,text:text.slice(0,800),kind:'notice',
      timestampMs:notificationTime(x,entry),
      context:stripAccountMentions(entry.target_reply_content||entry.root_reply_content,entry.at_details,selfUid).slice(0,700)}];
  });
}

export function normalizeTopComments(raw, bvid, selfUid = '') {
  if (raw?.error || (raw?.code != null && Number(raw.code) !== 0)) throw new Error('热门评论接口失败：' + String(raw.error || raw.message));
  if (!Array.isArray(raw?.comments)) throw new Error('热门评论接口未返回 comments');
  return raw.comments.flatMap(c => {
    const uid = validId(c.mid) || validId(c?.member?.mid);
    const rpid = validId(c.rpid);
    const text = String(c.content || '').trim();
    if (!uid || uid === String(selfUid) || !rpid || !text) return [];
    const rawTime=Number(c.ctime??c.time??0),timestampMs=Number.isFinite(rawTime)&&rawTime>0?(rawTime<1e11?rawTime*1000:rawTime):0;
    return [{ id:`comment:${rpid}`, uid, bvid, aid: '', rpid, root:rpid,
      name:String(c?.member?.uname||c?.uname||c?.username||c?.user?.uname||(typeof c?.user==='string'?c.user:'')||'').trim().slice(0,60), text: text.slice(0, 800), kind:'top', context: '',timestampMs }];
  });
}

/** Resolve video reference from platform notification IDs and official navigation links,
 * never from user-written body/title (those may name an unrelated BV). */
export function atNoticeVideoReference(row={}) {
  const item=row?.item||{};
  const suppliedAid=validId(item.subject_id||item.aid);
  const urls=[item.uri,item.native_uri,row?.uri,row?.native_uri].filter(v=>typeof v==='string'&&v.length<=1500);
  let hintedBvid='',hintedAid='';
  for(const raw of urls){
    try{
      const u=new URL(raw),host=u.hostname.toLowerCase();
      const officialWeb=u.protocol==='https:'&&(host==='bilibili.com'||host==='www.bilibili.com'||host==='m.bilibili.com');
      const officialApp=u.protocol==='bilibili:'&&host==='video';
      if(!officialWeb&&!officialApp)continue;
      const p=u.pathname;
      hintedBvid=validBv(p.match(/\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1])||
        (officialApp?validBv(p.match(/^\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1]):'')||hintedBvid;
      hintedAid=validId(p.match(/\/video\/av([1-9]\d{0,19})(?:\/|$)/i)?.[1])||
        (officialApp?validId(p.match(/^\/(?:av)?([1-9]\d{0,19})(?:\/|$)/i)?.[1]):'')||hintedAid;
    }catch{}
  }
  const bvid=hintedBvid||validBv(item.bvid||item.bv_id)||avToBv(suppliedAid||hintedAid);
  return {bvid,aid:suppliedAid||hintedAid||(!bvid?'':bvToAv(bvid))};
}

// Text left after removing an @ token may consist only of punctuation;
// it does not prove the sender wrote no message (a nickname may join the text).
export const hasMeaningfulMentionText = text => /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(String(text||''));

export const isFishBait = text => /(大肥鱼|大米饭|鲸鱼|🐳|投喂|喂饭|来吃饭|吃米饭|鱼鱼|本鱼)/i.test(String(text || ''));

/** B站把 @对象的昵称拼进 source_content；它不是发送者的陈述。
 * 有可信 UID 名称时只删除指向本账号的 @；如果平台没有给出昵称边界，
 * 将连写的 @token 整体视为不可信提及，绝不截成“@大肥鱼”后把后半段当情绪。
 * 不猜测昵称，也不据此分析被提及者的情绪或行为。 */
export function stripAccountMentions(text,details=[],selfUid='') {
  let result=String(text||'');
  const self=validId(selfUid);
  const known=Array.isArray(details)?details.filter(d=>validId(d?.mid)===self)
    .map(d=>String(d?.uname||d?.name||d?.nickname||'').trim()).filter(n=>n&&n.length<=60):[];
  // Only remove a known @name when the token truly ends there. B站 may
  // concatenate a longer nickname after a short alias without any delimiter;
  // stripping just @大肥鱼 would turn '怒了但不说话' into fake mood evidence.
  for (const name of known) {
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    result=result.replace(new RegExp('@'+escaped+'(?=$|[\\s,，:：。!！?？;；、])','gu'),' ');
  }
  // A continuous @token with unknown boundaries is entirely untrusted.
  result=result.replace(/@[\p{L}\p{N}_\-·・]+/gu,' ');
  return result.replace(/[ \t]+/g,' ').trim();
}

/** Handle verified video or independent dynamic comment @ notices; never likes or self. */
export function normalizeAtNotifications(raw, selfUid = '', {onIgnored=()=>{}} = {}) {
  if (raw?.at_error) throw new Error('@通知接口失败：' + String(raw.at_error).slice(0,160));
  let body=raw?.at??raw;
  // 支持单次接口结果及某些 MCP 包装器产生的单元素数组。
  if (Array.isArray(body) && body.length===1 && body[0]?.data?.items)body=body[0];
  if (body?.error || (body?.code != null && Number(body.code)!==0))
    throw new Error('@通知失败：'+String(body.error||body.message));
  const items=Array.isArray(body)?body:(body?.data?.items??body?.items);
  if (!Array.isArray(items)) throw new Error('@通知未返回 items，不能安全处理');
  const self=validId(selfUid);
  return items.flatMap(x=>{
    const item=x?.item||{},uid=validId(x?.user?.mid)||validId(x?.user?.uid),noticeId=validId(x?.id);
    const reject=reason=>{
      const {bvid:hintBv,aid:hintAid}=atNoticeVideoReference(x);
      const hintRpid=validId(item.source_id);
      const location=resolveCommentCoordinates(item,hintRpid,{kind:'at'});
      onIgnored({id:'at:'+(noticeId||hintRpid||'unknown'),uid,
        name:String(x?.user?.nickname||x?.user?.uname||x?.user?.name||'').slice(0,60),
        aid:hintAid,bvid:hintBv,rpid:hintRpid,
        text:stripAccountMentions(item.source_content||item.message,item.at_details,self).slice(0,240),
        sourceRawMissing:!String(item.source_content||item.message||'').trim(),
        ...location,root:location.sendRoot,targetId:location.targetId,
        timestampMs:notificationTime(x,{...item,source_time:x?.at_time??item.source_time}),reason});return [];
    };
    if(!self)return reject('account_uid_missing');
    if(!uid||uid===self)return reject('sender_missing_or_self');
    const {bvid:videoBvid,aid:videoAid}=atNoticeVideoReference(x);
    const hasVideoLink=!!videoBvid;
    const isDynamic=dynamicBusiness(item)&&!videoBvid;
    if(!isDynamic&&item.business_id!=null&&Number(item.business_id)!==1&&
       !(String(item.business||'')==='评论'&&hasVideoLink&&![11,17].includes(Number(item.business_id))))return reject('not_video_comment');
    if(!isDynamic&&item.business&&!['视频','评论'].includes(String(item.business)))return reject('not_video_comment');
    if(Array.isArray(item.at_details)&&item.at_details.length&&
       !item.at_details.some(a=>validId(a?.mid)===self))return reject('mention_not_for_account');
    const dynamicId=isDynamic?dynamicIdFromNotification(item):'';
    if(isDynamic&&!dynamicId&&!validDynamicId(item.subject_id||item.aid))return reject('dynamic_reference_unverified');
    const bvid=isDynamic?'':videoBvid;
    const aid=videoAid||(isDynamic?dynamicId:'');
    if(!aid||(!isDynamic&&!bvid))return reject(isDynamic?'dynamic_reference_missing':'video_reference_missing');
    const rpid=validId(item.source_id);
    if (!rpid) return reject('comment_id_missing');
    const original=String(item.source_content||item.message||'').trim();
    const text=stripAccountMentions(original,item.at_details,self);
    // An @-only notification is an invitation signal, not a sentence. Never
    // invent its contents; resolve the real source comment + author before AI.
    // If B站 omits source_content entirely the same verification is required.
    const timestampMs=notificationTime(x,{...item,source_time:x?.at_time??item.source_time});
    const coords=resolveCommentCoordinates(item,rpid,{kind:'at'});
    return [{id:'at:'+(noticeId||rpid),kind:'at',uid,...coords,
      name:String(x?.user?.nickname||x?.user?.uname||x?.user?.name||'').slice(0,60),
      aid,bvid,...(isDynamic?{contentType:'dynamic',dynamicId}:{}),rpid,root:coords.sendRoot,targetId:coords.targetId,
      timestampMs,text:text.slice(0,800),sourceTextMissing:!hasMeaningfulMentionText(text),
      sourceRawMissing:!original,
      context:stripAccountMentions(item.target_reply_content||item.root_reply_content,item.at_details,self).slice(0,700)}];
  });
}
