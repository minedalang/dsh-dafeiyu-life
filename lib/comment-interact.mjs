/**
 * B站后台公开评论互动。只对经本地发送账本证实归属我的评论启用优先回复。
 * 顶层评论/楼中楼各自按 UID 近24小时可调限额；满额时等待恢复，不将未发送的通知永久作废。
 * 回复前持久化 pending；网络结果未知时不自动重发。
 */
import {mkdir,open,stat,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {normalizeReplyNotifications,normalizeAtNotifications,normalizeTopComments,isFishBait,validBv,stripAccountMentions,hasMeaningfulMentionText} from './comment-inbox.mjs';
import {validDynamicId} from './bili-content-ref.mjs';
import {recordConfirmedRecipient} from './confirmed-comment-recipients.mjs';
import {lifeFactFromReceipt,verifyLifeOutbound} from './verified-life-facts.mjs';
import {commentEngagementContext} from './comment-engagement-context.mjs';
import {validateSocialReplyText} from './social-autonomy-contract.mjs';
import {normalizeMessageBurst} from './message-burst.mjs';
const cap=(n,lo,hi,def)=>Number.isFinite(Number(n))?Math.max(lo,Math.min(hi,Math.floor(Number(n)))):def;
const validId=v=>/^\d{1,30}$/.test(String(v||''))?String(v):'';
const WINDOW=86400_000;
const fresh=()=>({version:1,notificationBootstrapped:false,replyParserVersion:2,atBootstrapped:false,atParserVersion:3,atContextRetries:{},atDiagnostics:[],atLastFetch:null,replyDiagnostics:[],replyLastFetch:null,seen:{},sent:[],replyRecords:[],replyLabels:{},sendAttempts:[],sendAttemptHistoryStartedAt:0,manualVerifiedRetries:{},globalQuotaBlocked:null,ownReplies:{},threadHistory:{},lifeSelectedQueue:[],preflightDefers:{}});
// A previous @ recovery fallback was accidentally treated as viewer speech.
// Older bounded thread/recipient records may contain it: do not show that
// parser annotation to any later model or manual-reply generation.
const LEGACY_AT_WARNING='对方原评论（含@昵称，昵称边界不明确，不能把昵称当正文）：';
const safeMentionHistory=value=>String(value||'').includes(LEGACY_AT_WARNING)
  ?'[已核验@提及，但独立留言正文无法确认]':String(value||'');
const localDayKey=ms=>{const d=new Date(ms);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const hardQuotaError=message=>/(?:已达到硬上限|每日硬上限禁用|额度已满|达到全局评论上限)/i.test(String(message||''));
const quotaStoreError=message=>/(?:配额记录不可用|database is locked|sqlite|数据库.*(?:锁|不可用))/i.test(String(message||''));
// Only keep a bounded, credential-scrubbed error for the local diagnostics UI.
const safeErrorDetail=value=>String(value?.message||value||'')
  .replace(/(?:SESSDATA|bili_jct|DedeUserID__ckMd5|access[_-]?token|api[_-]?key)\s*[=:]\s*[^\s&;]+/gi,'[凭证已隐藏]')
  .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi,'Bearer [凭证已隐藏]')
  .replace(/[\r\n\t]+/g,' ').slice(0,320);
const protectedSendState=value=>/^(?:sent|manual-sent|pending|manual-pending|uncertain|manual-uncertain|send_)/.test(String(value||''));
const terminalSendReason=reason=>/^(?:sent|send_failed|send_uncertain|manual_send_failed|manual_send_uncertain)$/.test(String(reason||''));
const failedSendReason=reason=>/^(?:send_failed|send_uncertain|manual_send_failed|manual_send_uncertain)$/.test(String(reason||''));
const definiteSendState=value=>/^(?:sent|manual-sent|pending|manual-pending)$/.test(String(value||''));
const VERIFIED_RETRY_LIMIT=3; // Human-confirmed retries per original comment in a rolling 24h window.
// Verification reads never publish. A transient B站/API failure is not an
// outbound receipt and must not turn into a permanent "seen" after 3 tries.
export const dynamicVerificationRetryDelay=attempts=>Math.min(30,5*2**Math.min(Math.max(0,Number(attempts||1)-1),3))*60_000;
const sourceKeyFor=entry=>entry.dynamicId&&entry.rpid?'source:dynamic:'+entry.dynamicId+':'+entry.rpid:entry.aid&&entry.rpid?'source:'+entry.aid+':'+entry.rpid:'';
const verificationKeyFor=entry=>sourceKeyFor(entry)||String(entry.id||'');
function verifiedRetryInfo(db,entry,timestamp){
  const byId=String(db.seen[entry.id]||''),sourceKey=sourceKeyFor(entry),bySource=String(sourceKey?db.seen[sourceKey]||'':'');
  const prior=db.manualVerifiedRetries?.[verificationKeyFor(entry)];
  const history=(Array.isArray(prior)?prior:[]).filter(t=>Number(t)>timestamp-WINDOW);
  const remaining=Math.max(0,VERIFIED_RETRY_LIMIT-history.length);
  const successOrInFlight=entry.reason==='sent'||definiteSendState(byId)||definiteSendState(bySource);
  // A verified retry may fail before it even reaches B站 (context / AI failure).
  // Keep the recheck action available if the durable ledger still says the
  // previous publish was uncertain; those failures must not erase that history.
  const previouslyUncertain=/^(?:uncertain|manual-uncertain)$/.test(byId)||/^(?:uncertain|manual-uncertain)$/.test(bySource);
  const failed=failedSendReason(entry.reason)||(previouslyUncertain&&/^(?:manual_context_unavailable|manual_ai_generation_error|manual_ai_skipped)$/.test(String(entry.reason||'')));
  return {allowed:failed&&!successOrInFlight&&remaining>0,remaining,successOrInFlight,failed};
}

const annotateDiagnostic=(rows,db,timestamp=Date.now())=>rows.slice(-30).reverse().map(entry=>{
  const sourceKey=sourceKeyFor(entry);
  const byId=String(db.seen[entry.id]||''),bySource=String(sourceKey?db.seen[sourceKey]||'':'');
  const sendState=protectedSendState(byId)?byId:protectedSendState(bySource)?bySource:byId||bySource;
  const retry=verifiedRetryInfo(db,entry,timestamp);
  return {...entry,sendState,retryBlocked:protectedSendState(byId)||protectedSendState(bySource)||terminalSendReason(entry.reason),
    manualRetryAllowed:retry.allowed,manualRetryRemaining:retry.remaining,
    preflightRetryAt:Number(db.preflightDefers?.[entry.id])||0};
});
// Older releases saved a fixed two-considerations-per-stranger delay. Retire
// only delays whose exact deadline proves that legacy rule created them;
// keep model deferrals, send cooldowns, terminal seen receipts and stale notices.
const releaseLegacyStrangerHold=(db,x,timestamp)=>{
  const due=Number(db.preflightDefers?.[x.id]);
  if(!due||db.seen?.[x.id]||!Number.isFinite(x.timestampMs)||
     x.timestampMs<=timestamp-WINDOW||x.timestampMs>timestamp+60_000)return false;
  const attempts=(db.strangerAttempts?.[x.uid]||[]).map(Number).filter(t=>
    Number.isFinite(t)&&t>x.timestampMs-WINDOW&&t<=timestamp);
  if(attempts.length<2||Math.abs(due-(Math.min(...attempts)+WINDOW+1000))>1500)return false;
  delete db.preflightDefers[x.id];
  return true;
};
const errorClass=message=>{
  const s=String(message||'');
  if(hardQuotaError(s))return 'blocked_quota';
  if(quotaStoreError(s))return 'blocked_quota_store';
  if(/评论配额|评论额度|评论上限|额度.*(?:禁用|已满)|配额.*(?:不可用|已满)/i.test(s))return 'blocked_quota_store';
  if(/后台评论回复已关闭|总开关已关闭|插件已暂停|发送已暂停|开关关闭/i.test(s))return 'blocked';
  if(/结果不确定|超时|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|网络|连接重置|回执未包含|未收到成功回执|fetch failed/i.test(s))return 'uncertain';
  return 'failed';
};
function scopeOf(row,owned,ownReplies){
  if(row.kind==='at')return 'at';
  if(validDynamicId(row.dynamicId))return row.verifiedOwnDynamic===true?'self-dynamic':row.verifiedReplyToSelf===true?'self-nested':'notice';
  if(row.kind!=='notice')return 'top';
  const target=validId(row.targetId),root=validId(row.root);
  // 直接回复我的楼中楼 A，走独立额度；在我顶层评论下直接留言则走主评论额度。
  if(target&&(owned.nested.has(target)||ownReplies[target]))return 'self-nested';
  if((root&&owned.top.has(root))||(target&&owned.top.has(target)))return 'self-top';
  return 'notice'; // 归属不能确认时沿用普通通知的可跳过回复，不冒充强制回复
}
export function createCommentInteract({dataDir,getConfig,selfUid,getNotifications,getAtNotifications=async()=>({at:{data:{items:[]}}}),getAtSource=async()=>({ok:false,reason:'source_lookup_unavailable'}),getVideoContext=async()=>({text:'',usable:false}),onConfirmedVideoReply=async()=>{},getDynamicContext=async()=>({usable:false}),getVideos,getComments,getOwnComments=()=>({top:new Set(),nested:new Set()}),onIncoming=async()=>{},onDeliberateSilence=async()=>{},decideSocial=()=>({decision:'allow'}),socialTier=()=> 'stranger',canContinue=()=>true,generateReply,send,getVerifiedFacts=()=>[],getEmotion=()=>null,logger=console,now=Date.now}){
  const stateFile=join(dataDir,'comment-interact-state.json');
  const lockPath=join(dataDir,'comment-interact.lock');
  // The owner/friend Agent and ordinary comment interactions must share the
  // same receipt-keyed identity index. Historical comment-interact-state.json
  // remains readable, but newly confirmed replies write both paths. Never
  // turn metadata persistence failures into a second public send attempt.
  function rememberConfirmedRecipient(entry, outgoingRpid) {
    const bvid=validBv(entry?.bvid),rpid=validId(outgoingRpid),uid=validId(entry?.uid)
    if(!bvid||!rpid||!uid)return
    try {recordConfirmedRecipient(dataDir,{bvid,rpid,uid,
      name:String(entry?.name||'').slice(0,60),comment:String(entry?.text||'').slice(0,420),at:now()})}
    catch(e){logger.warn?.('公开评论身份索引写入失败（不影响已确认发送，不自动重发）：'+safeErrorDetail(e).slice(0,140))}
  }
  let busy=false,lastError='',lastPollAt=0;
  const p6On=(cfg,kind)=>kind==='at'?cfg.p6At===true:cfg.p6Comment===true;
  async function load(){try{const x=JSON.parse(await readFile(stateFile,'utf8'));if(x?.version===1&&x.seen&&Array.isArray(x.sent)){
    x.replyRecords=Array.isArray(x.replyRecords)?x.replyRecords:[];
    x.replyLabels=x.replyLabels&&typeof x.replyLabels==='object'&&!Array.isArray(x.replyLabels)?x.replyLabels:{};
    // 升级已有状态时，保留24小时窗口内能找到的历史昵称与 UID。
    for(const record of x.replyRecords){
      const bv=validBv(record?.bvid),rpid=validId(record?.outboundRpid);
      if(bv&&rpid){
        const key=bv+':'+rpid;
        if(!x.replyLabels[key])x.replyLabels[key]={recipientName:String(record?.recipientName||'').slice(0,60),
          recipientUid:validId(record?.recipientUid||record?.uid),at:Number(record?.at)||0};
      }
    }
    if(!Array.isArray(x.sendAttempts)){
      x.sendAttempts=[];
      x.sendAttemptHistoryStartedAt=now();
    }else if(!Number.isFinite(Number(x.sendAttemptHistoryStartedAt))||Number(x.sendAttemptHistoryStartedAt)<=0){
      x.sendAttemptHistoryStartedAt=Number(x.sendAttempts[0]?.at)||now();
    }
    x.manualVerifiedRetries=x.manualVerifiedRetries&&typeof x.manualVerifiedRetries==='object'&&!Array.isArray(x.manualVerifiedRetries)?x.manualVerifiedRetries:{};
    x.globalQuotaBlocked=x.globalQuotaBlocked&&typeof x.globalQuotaBlocked==='object'?x.globalQuotaBlocked:null;
    x.ownReplies=x.ownReplies&&typeof x.ownReplies==='object'?x.ownReplies:{};
    x.threadHistory=x.threadHistory&&typeof x.threadHistory==='object'?x.threadHistory:{};
    // Non-archival, bounded caches: correct only the injected parser artifact,
    // preserving the actual confirmed send and recipient identity receipts.
    for(const row of x.replyRecords)if(row&&typeof row==='object')row.recipientComment=safeMentionHistory(row.recipientComment);
    for(const row of Object.values(x.replyLabels))if(row&&typeof row==='object')row.recipientComment=safeMentionHistory(row.recipientComment);
    for(const rows of Object.values(x.threadHistory))if(Array.isArray(rows))for(const row of rows)
      if(row&&typeof row==='object'&&row.role==='user')row.text=safeMentionHistory(row.text);
    for(const diag of [...(Array.isArray(x.atDiagnostics)?x.atDiagnostics:[]),...(Array.isArray(x.replyDiagnostics)?x.replyDiagnostics:[])])
      if(diag&&typeof diag==='object')diag.text=safeMentionHistory(diag.text);
    // Retired P6 appointments are discarded on read; never replay old intents.
    delete x.p6Intents;
    x.preflightDefers=x.preflightDefers&&typeof x.preflightDefers==='object'&&!Array.isArray(x.preflightDefers)?x.preflightDefers:{};
    // Legacy sideHotQueue was created by an independent toggle and must never be replayed.
    delete x.sideHotQueue;
    x.lifeSelectedQueue=Array.isArray(x.lifeSelectedQueue)?x.lifeSelectedQueue.filter(v=>v?.lifeSelectedHot===true&&validBv(v.bvid)&&validId(v.uid)&&validId(v.rpid)&&validId(v.accountUid)).slice(-24):[];
    x.atContextRetries=x.atContextRetries&&typeof x.atContextRetries==='object'?x.atContextRetries:{};
    x.atDiagnostics=Array.isArray(x.atDiagnostics)?x.atDiagnostics:[];
    x.replyDiagnostics=Array.isArray(x.replyDiagnostics)?x.replyDiagnostics:[];
    return x;
  }throw Error('invalid comment state');}catch(e){if(e.code==='ENOENT'){const x=fresh();x.sendAttemptHistoryStartedAt=now();return x;}throw e;}}
  async function save(db){const tmp=stateFile+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(db,null,2)+'\n',{mode:0o600});await rename(tmp,stateFile);}
  async function lock(){
    try{const handle=await open(lockPath,'wx',0o600);await handle.writeFile(String(process.pid));return handle;}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      const age=await stat(lockPath).then(x=>now()-x.mtimeMs).catch(()=>0);
      const pid=Number(await readFile(lockPath,'utf8').catch(()=>'0'));
      let alive=true;if(pid>0)try{process.kill(pid,0)}catch(err){alive=err.code!=='ESRCH'}
      if(age>600_000&&pid>0&&!alive){await unlink(lockPath).catch(()=>{});return lock();}
      return null;
    }
  }
  const atNote=(db,x,reason)=>{
    if(getConfig().diagAtInviteEnabled===false)return;
    db.atDiagnostics??=[];
    const key=String(x.id||'unknown'),entry={id:key,uid:validId(x.uid),name:String(x.name||'').slice(0,60),
      aid:validId(x.aid),bvid:validBv(x.bvid),contentType:x.contentType==='dynamic'?'dynamic':'video',dynamicId:String(x.dynamicId||''),rpid:validId(x.rpid),root:validId(x.root),targetId:validId(x.targetId),
      locationRoot:validId(x.locationRoot),locationSource:String(x.locationSource||'').slice(0,20),
      text:String(x.text||'').trim().slice(0,800),context:String(x.context||'').trim().slice(0,700),contextSummary:String(x.contextSummary||'').slice(0,300),
      rootPreview:String(x.rootPreview||'').slice(0,600),threadPreview:String(x.threadPreview||'').slice(0,900),contextCounts:x.contextCounts||{},
      timestampMs:Number(x.timestampMs)||0,reason,retryAt:Number(x.retryAt)||0,
      sourceRawMissing:x.sourceRawMissing===true,mentionOnly:x.mentionOnly===true,forced:x.forced===true,
      chatWillingness:['allow','defer','refuse','blocked'].includes(x.chatWillingness)?x.chatWillingness:'not-evaluated',
      replyDecision:x.replyDecision&&typeof x.replyDecision==='object'?x.replyDecision:null,
      generatedReply:String(x.generatedReply||'').slice(0,130),errorDetail:safeErrorDetail(x.errorDetail||'').slice(0,320),at:now()};
    const old=db.atDiagnostics.findIndex(r=>r.id===key);
    // Re-polling a malformed/unsupported old notice must not make its diagnosis
    // look like a newly received mention every few minutes.
    if(old>=0 && db.atDiagnostics[old]?.reason===reason &&
      Number(db.atDiagnostics[old]?.timestampMs||0)===entry.timestampMs &&
      !entry.forced && !entry.errorDetail && !entry.contextSummary)return;
    if(old>=0)db.atDiagnostics.splice(old,1);
    db.atDiagnostics.push(entry);
    if(db.atDiagnostics.length>100)db.atDiagnostics=db.atDiagnostics.slice(-100);
  };
  const replyNote=(db,x,reason)=>{
    if(getConfig().diagReplyInboxEnabled===false)return;
    db.replyDiagnostics??=[];
    const key=String(x.id||'unknown'),entry={id:key,uid:validId(x.uid),name:String(x.name||'').slice(0,60),
      aid:validId(x.aid),bvid:validBv(x.bvid),contentType:x.contentType==='dynamic'?'dynamic':'video',dynamicId:String(x.dynamicId||''),rpid:validId(x.rpid),root:validId(x.root),scope:String(x.scope||''),targetId:validId(x.targetId),
      locationRoot:validId(x.locationRoot),locationSource:String(x.locationSource||'').slice(0,20),
      text:String(x.text||'').trim().slice(0,800),context:String(x.context||'').trim().slice(0,700),contextSummary:String(x.contextSummary||'').slice(0,300),
      rootPreview:String(x.rootPreview||'').slice(0,600),threadPreview:String(x.threadPreview||'').slice(0,900),contextCounts:x.contextCounts||{},
      timestampMs:Number(x.timestampMs)||0,reason,retryAt:Number(x.retryAt)||0,
      sourceRawMissing:x.sourceRawMissing===true,mentionOnly:x.mentionOnly===true,forced:x.forced===true,
      chatWillingness:['allow','defer','refuse','blocked'].includes(x.chatWillingness)?x.chatWillingness:'not-evaluated',
      replyDecision:x.replyDecision&&typeof x.replyDecision==='object'?x.replyDecision:null,
      generatedReply:String(x.generatedReply||'').slice(0,130),errorDetail:safeErrorDetail(x.errorDetail||'').slice(0,320),at:now()};
    const old=db.replyDiagnostics.findIndex(v=>v.id===key);
    if(old>=0)db.replyDiagnostics.splice(old,1);
    db.replyDiagnostics.push(entry);
    if(db.replyDiagnostics.length>100)db.replyDiagnostics=db.replyDiagnostics.slice(-100);
  };
  const interactionNote=(db,x,reason)=>{
    if(x.kind==='at')atNote(db,x,reason);
    else if(x.kind==='notice')replyNote(db,x,reason);
  };
  const windowRecords=db=>(db.replyRecords||[]).filter(r=>Number(r.at)>now()-WINDOW);
  function status(){
    let sentLast24Hours=0,sentOnOwnTop24h=0,sentOnOwnNested24h=0;
    let sendAttemptHistoryAvailable=false,sendAttemptHistoryStartedAt=0,sendFailedLast24Hours=0,sendUncertainLast24Hours=0,
      sendBlockedByGlobalQuotaLast24Hours=0,sendBlockedOtherLast24Hours=0,sendPendingLast24Hours=0;
    let globalQuotaBlocked=null,atDiagnostics=[],atLastFetch=null,replyDiagnostics=[],replyLastFetch=null,lifeSelectedHotPending=0;
    let legacyStrangerBudgetCount=0;
    try{
      const db=JSON.parse(readFileSync(stateFile,'utf8'));
      const since=now()-WINDOW;
      sentLast24Hours=(db.sent||[]).filter(t=>Number(t)>since).length;
      sendAttemptHistoryAvailable=Array.isArray(db.sendAttempts);
      sendAttemptHistoryStartedAt=Number(db.sendAttemptHistoryStartedAt)||0;
      const attempts=(db.sendAttempts||[]).filter(a=>Number(a.at)>since);
      sendFailedLast24Hours=attempts.filter(a=>a.outcome==='failed').length;
      sendUncertainLast24Hours=attempts.filter(a=>a.outcome==='uncertain').length;
      sendBlockedByGlobalQuotaLast24Hours=attempts.filter(a=>a.outcome==='blocked_quota').length;
      sendBlockedByGlobalQuotaLast24Hours+=attempts.filter(a=>a.outcome==='blocked_quota_store').length;
      sendBlockedOtherLast24Hours=attempts.filter(a=>a.outcome==='blocked').length;
      sendPendingLast24Hours=attempts.filter(a=>a.outcome==='pending').length;
      globalQuotaBlocked=db.globalQuotaBlocked&&typeof db.globalQuotaBlocked==='object'?db.globalQuotaBlocked:null;
      atDiagnostics=annotateDiagnostic(db.atDiagnostics||[],db,now());atLastFetch=db.atLastFetch||null;
      replyDiagnostics=annotateDiagnostic(db.replyDiagnostics||[],db,now());replyLastFetch=db.replyLastFetch||null;
      lifeSelectedHotPending=(db.lifeSelectedQueue||[]).filter(x=>x.at>now()-WINDOW&&!db.seen[x.id]).length;
      legacyStrangerBudgetCount=Object.values(db.seen||{}).filter(v=>v==='stranger-budget').length;
      for(const x of db.replyRecords||[]){if(Number(x.at)<=since)continue;
        if(x.scope==='self-top')sentOnOwnTop24h++;
        if(x.scope==='self-nested')sentOnOwnNested24h++;
      }
    }catch{/* 首次安装时暂无统计文件 */}
    const c=getConfig();
    const quotaBlockMatches=!!(globalQuotaBlocked&&globalQuotaBlocked.day===localDayKey(now())&&Number(globalQuotaBlocked.limit)===cap(c.globalDailyLimit,0,1000,1000));
    const quotaBlockActive=quotaBlockMatches&&(globalQuotaBlocked.reason!=='store-error'||Number(globalQuotaBlocked.retryAfter)>now());
    return {busy,lastError,lastPollAt,atDiagnostics,atLastFetch,replyDiagnostics,replyLastFetch,lifeSelectedHotPending,
      legacyStrangerBudgetCount,sentLast24Hours,sentOnOwnTop24h,sentOnOwnNested24h,
      sendAttemptHistoryAvailable,
      sendAttemptHistoryStartedAt,
      sendAttemptsLast24Hours:sentLast24Hours+sendFailedLast24Hours+sendUncertainLast24Hours+sendBlockedByGlobalQuotaLast24Hours+sendBlockedOtherLast24Hours+sendPendingLast24Hours,
      sendFailedLast24Hours,sendUncertainLast24Hours,sendBlockedByGlobalQuotaLast24Hours,sendBlockedOtherLast24Hours,sendPendingLast24Hours,
      globalQuotaBlocked:!!quotaBlockActive,
      globalQuotaBlockReason:quotaBlockActive?String(globalQuotaBlocked.reason||'limit'):'',
      watchAt:!!c.watchAt,replyAt:c.replyAt!==false,atEligibility:'all-verified-incoming',replyPerDay:cap(c.replyPerDay,1,1000,1000),ownTopPerUser:cap(c.ownTopPerUser,1,1000,5),ownNestedPerUser:cap(c.ownNestedPerUser,1,1000,3)};
  }

  async function forceReply({id,confirmedMissing=false}={}){
    const forcedId=String(id||'').trim();
    if(!/^(?:at|comment):[A-Za-z0-9_-]{1,40}$/.test(forcedId))throw Error('无效的诊断记录编号');
    if(busy)throw Error('后台评论回复正在运行，请稍后再试');
    busy=true;let handle;
    try{
      await mkdir(dataDir,{recursive:true});handle=await lock();if(!handle)throw Error('后台评论回复正忙，请稍后重试');
      const db=await load();
      const self=String(await selfUid());if(!/^[1-9]\d*$/.test(self))throw Error('没有登录 UID，无法手动回复');
      const list=forcedId.startsWith('at:')?(db.atDiagnostics||[]):(db.replyDiagnostics||[]);
      const saved=list.find(x=>x&&x.id===forcedId)||null;
      let inboxVersion=null;
      try{
        inboxVersion=forcedId.startsWith('at:')
          ? (normalizeAtNotifications(await getAtNotifications(),self,{}).find(x=>x.id===forcedId)||null)
          : (normalizeReplyNotifications(await getNotifications(),self,{}).find(x=>x.id===forcedId)||null);
      }catch{}
      if(!saved && !inboxVersion)throw Error('未找到这条诊断记录，可能已被清理');
      const base={...(saved||{}),...(inboxVersion||{})};
      const x={id:forcedId,kind:forcedId.startsWith('at:')?'at':'notice',uid:validId(base.uid),name:String(base.name||'').trim().slice(0,60),
        aid:validId(base.aid),bvid:validBv(base.bvid),...(validDynamicId(base.dynamicId)?{contentType:'dynamic',dynamicId:base.dynamicId}:{}),rpid:validId(base.rpid),root:validId(base.root),targetId:validId(base.targetId),
        locationRoot:validId(base.locationRoot),locationSource:String(base.locationSource||''),
        text:String(base.text||'').trim().slice(0,800),context:String(base.context||'').trim().slice(0,700),timestampMs:Number(base.timestampMs)||0,scope:String(base.scope||'')};
      if(!x.uid||x.uid===self)throw Error('评论来自本账号或缺少有效 UID');
      if(validDynamicId(x.dynamicId))throw Error('动态通知不支持诊断页手动强制补发；请在 B站核对后从主 Session 明确确认回复');
      // Human verification is required for *each* retry of a previously failed/uncertain send.
      // Never allow a known success or in-flight attempt, even with confirmation.
      const sourceKey=sourceKeyFor(x);
      const previouslyAttempted=protectedSendState(db.seen[x.id])||protectedSendState(db.seen[sourceKey])||terminalSendReason(saved?.reason);
      const eligibility=verifiedRetryInfo(db,{...x,reason:saved?.reason},now());
      if(eligibility.successOrInFlight)throw Error('该评论已发送（有成功回执）或正在发送中，不能再次发送');
      if(confirmedMissing===true){
        if(!eligibility.failed)throw Error('只有发送失败或结果不确定的诊断记录才能执行人工核对后重发');
        if(!eligibility.allowed)throw Error('这条评论24小时内人工核对重试次数已达到'+VERIFIED_RETRY_LIMIT+'次，请稍后再试');
      }else if(previouslyAttempted){
        throw Error('该评论已发送或曾尝试发送（结果可能不确定），请先在 B站核对；确认未公开后使用人工核对重发按钮');
      }
      const verifiedRetry=confirmedMissing===true;
      const cfg=getConfig();
      const sent24=(db.sent||[]).filter(t=>Number(t)>now()-WINDOW);
      if(sent24.length>=cap(cfg.replyPerDay,1,1000,1000))throw Error('后台评论近24小时回复额度已满');
      const today=localDayKey(now()),globalLimit=cap(cfg.globalDailyLimit,0,1000,1000);
      if(globalLimit===0||(db.globalQuotaBlocked?.day===today&&db.globalQuotaBlocked?.reason==='limit'&&Number(db.globalQuotaBlocked?.limit)===globalLimit))throw Error('公开评论每日硬上限已满，不能手动绕过');
      if(!x.uid||(!x.bvid&&!validDynamicId(x.dynamicId))||!x.rpid||!x.text)throw Error('这条记录缺少可信内容 ID、评论正文或评论 ID');
      // An old diagnostic card is never permission to complete an ambiguous
      // @-only text. A human must first verify the real comment independently.
      if(x.kind==='at'&&(String(x.text).includes(LEGACY_AT_WARNING)||
          !hasMeaningfulMentionText(stripAccountMentions(x.text))))
        throw Error('原@留言的昵称与正文边界无法确认，不能根据旧诊断生成或发送回复');
      const ownedRaw=await getOwnComments();
      const owned={top:new Set(ownedRaw?.top||[]),nested:new Set(ownedRaw?.nested||[])};
      if(x.kind==='notice')x.scope=scopeOf(x,owned,db.ownReplies);
      if(!x.scope)x.scope=x.kind==='at'?'at':'notice';
      const ownUserCap=x.scope==='self-top'?cap(cfg.ownTopPerUser,1,1000,5):x.scope==='self-nested'?cap(cfg.ownNestedPerUser,1,1000,3):0;
      if(ownUserCap&&windowRecords(db).filter(r=>r.uid===x.uid&&r.scope===x.scope).length>=ownUserCap)
        throw Error('这位观众在该评论类型的近24小时回复次数已达到上限');
      const root=validId(x.contextRoot)||validId(x.locationRoot)||validId(x.root)||validId(x.rpid);
      const threadKey=`${validDynamicId(x.dynamicId)?'dynamic:'+x.dynamicId:validId(x.aid)||x.bvid||'unknown'}:${root}`;
      const contextHistory=(db.threadHistory?.[threadKey]||[]).slice(-20);
      const history=contextHistory.map(h=>({role:h.role,uid:h.uid,at:Number(h.at)||0,text:String(h.text||'').slice(0,350)}));
      // Retry an existing draft unchanged; no extra AI or video-context fetching.
      // Older failures have no draft and must regenerate from fresh real context.
      const draft=verifiedRetry?String(saved?.generatedReply||'').trim().slice(0,130):'';
      let videoContext={text:'',usable:false};
      if(!draft){
        try{videoContext=await getVideoContext(x.bvid,{aid:x.aid,root:x.root,rpid:x.rpid,targetId:x.targetId,text:x.text,context:x.context,kind:x.kind});}
        catch(e){logger.warn?.('强制回复时读取视频上下文失败：'+String(e.message||e).slice(0,140));}
      }
      x.contextSummary=draft?String(saved?.contextSummary||'').slice(0,300):String(videoContext?.summary||'').slice(0,300);
      x.rootPreview=draft?String(saved?.rootPreview||''):String(videoContext?.rootPreview||'');
      x.threadPreview=draft?String(saved?.threadPreview||''):String(videoContext?.threadPreview||'');
      if(!draft&&!videoContext?.usable){interactionNote(db,{...x,forced:true},'manual_context_unavailable');await save(db);throw Error('视频与评论上下文不可用，不能在不了解内容的情况下强制回复；可查看卡片中的上下文诊断后再试');}
      const parentContext=x.context&&!String(videoContext?.text||'').includes(String(x.context))?'被回复的内容：'+String(x.context).slice(0,320):'';
      // Manual replies may consult the same recipient/thread send receipts, but
      // current mood/personality still enters through the shared Life Voice only.
      const engagement=commentEngagementContext({uid:x.uid,dynamicId:x.dynamicId||'',threadKey,
        replyRecords:db.replyRecords,nowMs:now()});
      const context=[videoContext?.text||'',parentContext,engagement.text,history.length?(x.dynamicId?'当前动态同一评论串的近况：':'当前视频同一评论串的近况：')+history.map(h=>(h.role==='assistant'?'大肥鱼':'观众')+'：'+h.text).join('；'):''].filter(Boolean).join('\n').slice(0,10000);
      let result=draft;
      if(!draft){
        try{result=await generateReply({kind:'comment',mode:x.scope,text:x.text,uid:x.uid,memeSourceText:x.context,context,history,bvid:x.bvid,mustReply:true,canSkip:false,forceReply:true});}
        catch(e){x.errorDetail=safeErrorDetail(e);interactionNote(db,{...x,forced:true},'manual_ai_generation_error');await save(db);throw Error('AI 生成失败：'+x.errorDetail.slice(0,120));}
      }
      const reply=String(result||'').trim().slice(0,130);
      if(!reply||reply==='SKIP'){interactionNote(db,{...x,forced:true},'manual_ai_skipped');await save(db);throw Error('AI 这次仍然没有给出可发送的回复；诊断已记录，可以稍后重试');}
      if(!validateSocialReplyText(reply).ok){interactionNote(db,{...x,forced:true},'proactive_at_blocked');await save(db);throw Error('草稿包含未经授权的主动 @，未发送；请让 AI 改成不带 @ 昵称的自然回复');}
      x.generatedReply=reply;
      db.seen[x.id]='manual-pending';if(sourceKey)db.seen[sourceKey]='manual-pending';
      const attempt={at:now(),outcome:'pending',scope:x.scope,bvid:validBv(x.bvid)?x.bvid:'',
        id:x.id,sourceKey,forced:true,verifiedMissing:verifiedRetry,reusedDraft:!!draft,generatedReply:reply};
      if(verifiedRetry){
        const key=verificationKeyFor(x);
        db.manualVerifiedRetries??={};
        for(const [k,stamps] of Object.entries(db.manualVerifiedRetries)){
          const recent=(Array.isArray(stamps)?stamps:[]).filter(t=>Number(t)>now()-WINDOW);
          if(recent.length)db.manualVerifiedRetries[k]=recent;
          else delete db.manualVerifiedRetries[k];
        }
        db.manualVerifiedRetries[key]=[...(db.manualVerifiedRetries[key]||[]),now()];
      }
      db.sendAttempts.push(attempt);
      db.sendAttempts=db.sendAttempts.filter(a=>Number(a.at)>now()-7*WINDOW).slice(-10000);
      await save(db);
      try{
        const ack=await send({bvid:x.bvid,aid:x.aid,rpid:x.rpid,root:x.root,uid:x.uid,text:reply,manual:true,manualVerifiedRetry:verifiedRetry&&!!draft,reusedDraft:!!draft,replyPurpose:'manual',replyIndex:0});
        if(ack?.notAttempted===true){
          attempt.outcome='deferred-before-send';attempt.completedAt=now();
          db.seen[x.id]='uncertain';if(sourceKey)db.seen[sourceKey]='uncertain';
          if(verifiedRetry){const key=verificationKeyFor(x);db.manualVerifiedRetries[key]?.pop();}
          await save(db);throw Error('发送前权限或节奏检查未通过，没有请求 B站：'+String(ack.reason||ack.error||'blocked'));
        }
        if(ack!==true&&ack?.ok!==true)throw Error(ack?.error||'评论未收到成功回执');
        attempt.outcome='success';attempt.completedAt=now();
        db.seen[x.id]='manual-sent';if(sourceKey)db.seen[sourceKey]='manual-sent';interactionNote(db,{...x,forced:true},'sent');db.sent.push(now());
        db.replyRecords=windowRecords(db);
        db.replyRecords.push({at:now(),uid:x.uid,scope:x.scope,threadKey,bvid:validBv(x.bvid)?x.bvid:'',aid:validId(x.aid),
          outboundRpid:validId(ack?.rpid||ack?.rpid_str),recipientName:String(x.name||'').trim().slice(0,60),recipientUid:validId(x.uid),
          recipientComment:String(x.text||'').trim().slice(0,420)});
        const outboundId=validId(ack?.rpid||ack?.rpid_str);
        rememberConfirmedRecipient(x,outboundId);
        if(outboundId&&validBv(x.bvid)){
          db.replyLabels??={};
          db.replyLabels[x.bvid+':'+outboundId]={recipientName:String(x.name||'').trim().slice(0,60),recipientUid:validId(x.uid),recipientComment:String(x.text||'').trim().slice(0,420),at:now()};
          const keys=Object.keys(db.replyLabels);if(keys.length>30000)for(const k of keys.slice(0,keys.length-30000))delete db.replyLabels[k];
        }
        if(outboundId)db.ownReplies[outboundId]={at:now(),root,aid:validId(x.aid),bvid:x.bvid||'',...(validDynamicId(x.dynamicId)?{dynamicId:x.dynamicId}:{})};
        const h=db.threadHistory?.[threadKey]??[];
        h.push({role:'user',uid:x.uid,at:now(),text:String(x.text).slice(0,350)},{role:'assistant',uid:self,at:now(),text:reply});
        if(h.length>24)h.splice(0,h.length-24);
        db.threadHistory[threadKey]=h;
        const keys=Object.keys(db.seen);if(keys.length>5000)for(const k of keys.slice(0,keys.length-5000))delete db.seen[k];
        await save(db);
        return {ok:true,reply,rpid:validId(ack?.rpid||ack?.rpid_str),id:x.id,contextSummary:x.contextSummary,verifiedRetry,reusedDraft:!!draft};
      }catch(e){
        x.errorDetail=safeErrorDetail(e);
        if(attempt.outcome==='deferred-before-send')throw e;
        const outcome=errorClass(x.errorDetail);attempt.outcome=outcome;attempt.completedAt=now();
        attempt.errorDetail=x.errorDetail;
        if(outcome==='blocked_quota'||outcome==='blocked_quota_store'){
          const today=localDayKey(now()),globalLimit=cap(getConfig().globalDailyLimit,0,1000,10);
          db.seen[x.id]=`quota-blocked:${today}:${globalLimit}`;if(sourceKey)db.seen[sourceKey]=db.seen[x.id];
          const storeError=outcome==='blocked_quota_store';
          db.globalQuotaBlocked={day:today,limit:globalLimit,at:now(),reason:storeError?'store-error':'limit',retryAfter:storeError?now()+300_000:0};
          interactionNote(db,{...x,forced:true},storeError?'quota_store_blocked':'quota_exhausted');
        }else{
          db.seen[x.id]='manual-uncertain';if(sourceKey)db.seen[sourceKey]='manual-uncertain';interactionNote(db,{...x,forced:true},outcome==='uncertain'?'manual_send_uncertain':outcome==='failed'?'manual_send_failed':'send_'+outcome);
        }
        await save(db);
        if(outcome==='uncertain')throw Error('发送结果不确定，为防止重复回复已禁止再次自动发送：'+String(e?.message||e).slice(0,120));
        throw Error('发送失败：'+String(e?.message||e).slice(0,140));
      }
    }finally{busy=false;if(handle){await handle.close().catch(()=>{});await unlink(lockPath).catch(()=>{});}}
  }

  async function poll({notifications=true,top=true,mentions=true}={}){
    if(busy)return {skipped:'busy'};
    const cfg=getConfig();if(!cfg.watchReplies&&!cfg.watchTop&&!cfg.watchAt)return {skipped:'disabled'};
    busy=true;let handle;
    try{
      await mkdir(dataDir,{recursive:true});handle=await lock();if(!handle)return {skipped:'locked'};
      const db=await load();
      const today=localDayKey(now()),globalLimit=cap(cfg.globalDailyLimit,0,1000,1000);
      // 全局公开评论额度已经耗尽时，整轮停止，不让每分钟的后台轮询反复生成回复、反复调用 MCP。
      // 新自然日或用户修改全局上限后会重新检查；旧通知不会被永久标成已回复。
      const sameQuotaBlock=!!(db.globalQuotaBlocked&&db.globalQuotaBlocked.day===today&&Number(db.globalQuotaBlocked.limit)===globalLimit);
      const feedbackOnly=globalLimit===0||(sameQuotaBlock&&db.globalQuotaBlocked.reason!=='store-error');
      // Keep accepting authenticated, recent feedback even after public-comment quota
      // exhaustion; do not make any AI or public-send calls in this mode.
      if(sameQuotaBlock&&db.globalQuotaBlocked.reason==='store-error'&&Number(db.globalQuotaBlocked.retryAfter)>now()){
        lastPollAt=now();lastError='';return {sent:0,failed:0,ignored:0,limitSkipped:0,quotaBlocked:0,skipped:'quota-store-cooldown'};
      }
      if(db.globalQuotaBlocked&&!feedbackOnly){
        const retryingStoreError=db.globalQuotaBlocked.reason==='store-error';
        db.globalQuotaBlocked=null;
        for(const [id,value] of Object.entries(db.seen)){
          if(typeof value==='string'&&value.startsWith('quota-blocked:')){
            const [,blockedDay,blockedLimit]=value.split(':');
            if(retryingStoreError||blockedDay!==today||Number(blockedLimit)!==globalLimit)delete db.seen[id];
          }
        }
        await save(db);
      }
      const self=String(await selfUid());if(!/^\d+$/.test(self)||self==='0')throw Error('没有登录 UID，停止评论回复');
      const ownedRaw=await getOwnComments();
      const owned={top:new Set(ownedRaw?.top||[]),nested:new Set(ownedRaw?.nested||[])};
      const candidates=[];let baselined=0;
      if(cfg.watchReplies&&notifications){
        const dropped=[];
        const received=normalizeReplyNotifications(await getNotifications(),self,{onIgnored:x=>dropped.push(x)});
        db.replyLastFetch={at:now(),rawCount:received.length+dropped.length,recognized:received.length,invalid:dropped.length};
        for(const x of dropped)replyNote(db,x,x.reason);
        if(db.notificationBootstrapped && db.replyParserVersion!==2){
          // 升级解析器后不补发旧版本漏识别的陈年评论通知；后续真正新消息照常处理。
          for(const x of received)if(!db.seen[x.id]){
            db.seen[x.id]='reply-parser-upgrade-baseline';replyNote(db,x,'parser_upgrade_baseline');
          }
          db.replyParserVersion=2;await save(db);
        }
        if(!db.notificationBootstrapped){
          // 首次启动仅恢复有明确近24小时日期且能证明回复了我自己的评论的通知。
          // 无时间/无归属的不补发，避免重装插件后对陈年通知群发回复。
          for(const x of received) {
            const scope=scopeOf(x,owned,db.ownReplies);
            if((scope==='self-top'||scope==='self-nested') &&
              x.timestampMs>now()-WINDOW && x.timestampMs<=now()+60_000) candidates.push(x);
            else { db.seen[x.id]='baseline';replyNote(db,x,'first_poll_baseline');baselined++; }
          }
          db.notificationBootstrapped=true;db.replyParserVersion=2;await save(db);
        }else{
          // Repeat fetches must not overwrite a specific diagnostic with
          // the generic "received" status on every polling cycle.
          for(const x of received)if(!db.seen[x.id]&&
            !(db.replyDiagnostics||[]).some(row=>row.id===x.id&&row.reason!=='received'))replyNote(db,x,'received');
          candidates.push(...received);
        }
      }
      if(cfg.watchAt&&mentions){
        const dropped=[];
        const received=normalizeAtNotifications(await getAtNotifications(),self,{onIgnored:x=>dropped.push(x)});
        const mentionNow=now();
        const inWindow=x=>Number(x.timestampMs)>mentionNow-WINDOW&&Number(x.timestampMs)<=mentionNow+60_000;
        const ignoredReasons={};
        for(const x of dropped)ignoredReasons[x.reason]=Math.min(999,(ignoredReasons[x.reason]||0)+1);
        db.atLastFetch={at:mentionNow,rawCount:received.length+dropped.length,recognized:received.length,invalid:dropped.length,
          recent24h:received.filter(inWindow).length,
          stale:received.filter(x=>x.timestampMs>0&&!inWindow(x)).length,
          unknownTime:received.filter(x=>!x.timestampMs).length,
          newlySeenRecent:received.filter(x=>inWindow(x)&&!db.seen[x.id]).length,
          newestNoticeAt:Math.max(0,...received.map(x=>Number(x.timestampMs)||0)),
          ignoredReasons};
        for(const x of dropped)atNote(db,x,x.reason);
        // 首次开启只对已有通知作历史基线；此后的新 @ 会正常进入判断。
        if(db.atBootstrapped && db.atParserVersion!==3){
          // 旧版本因解析器缺陷未能识别的通知，不在更新后突然批量补发。
          for(const x of received){
            if(!db.seen[x.id]){db.seen[x.id]='at-parser-upgrade-baseline';atNote(db,x,'parser_upgrade_baseline');}
          }
          db.atParserVersion=3;await save(db);
        }
        if(!db.atBootstrapped){
          for(const x of received){db.seen[x.id]='at-baseline';atNote(db,x,'first_poll_baseline');}
          db.atBootstrapped=true;await save(db);
        }else{
          for(const x of received)if(!db.seen[x.id])atNote(db,x,'received');
          candidates.push(...received);
        }
      }
      // This queue is populated ONLY after Life independently elects to read a
      // specific verified public discussion. A successful reply never browses
      // or queues extra threads on its own. Historical side-hot rows are retired.
      db.lifeSelectedQueue=(db.lifeSelectedQueue||[]).filter(row=>row.lifeSelectedHot===true&&
        row.accountUid===self&&row.at>now()-WINDOW&&!db.seen[row.id]).slice(-24)
      if(cfg.watchReplies===true&&cfg.allowGeneralReplies!==false){
        candidates.push(...db.lifeSelectedQueue.map(row=>({...row,kind:'top'})))
      }
      if(cfg.watchTop&&top){
        const videos=(await getVideos()).filter(validBv).slice(0,cap(cfg.topVideoCount,1,6,3));
        for(const bv of videos){try{
          const comments=normalizeTopComments(await getComments(bv,cap(cfg.topCount,1,20,5)),bv,self);
          candidates.push(...comments.sort((a,b)=>Number(isFishBait(b.text))-Number(isFishBait(a.text))));
        }catch(e){logger.warn?.(`读取 ${bv} 评论失败：${String(e.message||e)}`);}}
      }
      const since=now()-WINDOW;
      db.sent=db.sent.filter(t=>Number(t)>since);
      db.replyRecords=windowRecords(db);
      const maxPoll=cap(cfg.replyPerPoll,1,1000,1),maxDay=cap(cfg.replyPerDay,1,1000,1000);
      const topCap=cap(cfg.ownTopPerUser,1,1000,5),nestedCap=cap(cfg.ownNestedPerUser,1,1000,3);
      let sent=0,ignored=0,failed=0,limitSkipped=0,quotaBlocked=0;
      const unique=new Set();
      const tagged=candidates.map(x=>({...x,scope:scopeOf(x,owned,db.ownReplies)}));
      // dev.69 and older converted three failed *reads* to permanent dedupe.
      // That was never a send; revive only still-fresh incoming dynamic notices.
      for(const x of tagged)if(x.contentType==='dynamic'&&
        db.seen[x.id]==='dynamic-context-unavailable'&&
        x.timestampMs>now()-WINDOW&&x.timestampMs<=now()+60_000){
        delete db.seen[x.id];delete db.atContextRetries[x.id];
        interactionNote(db,x,'dynamic_verification_resumed');
      }
      // Dynamic notice is only a routing hint. Independently verify the dynamic,
      // target author, and either actual post ownership or the direct parent
      // belonging to this signed-in account. Local draft receipts are not authoritative.
      for(const x of tagged){
        if(x.contentType!=='dynamic'||!['notice','at'].includes(x.kind)||db.seen[x.id]||
           !x.timestampMs||x.timestampMs<=now()-WINDOW||x.timestampMs>now()+60000)continue;
        if(Number(db.atContextRetries?.[x.id]?.nextAt)>now())continue;
        let ctx;
        try{ctx=await getDynamicContext(x)}catch(e){logger.warn?.('动态通知真实性核验失败：'+safeErrorDetail(e))}
        x.dynamicContextResult=ctx;
        if(ctx?.usable===true&&validDynamicId(ctx.dynamicId)&&(!x.dynamicId||ctx.dynamicId===x.dynamicId)&&validId(ctx.targetUid)===x.uid&&
           ((String(ctx.authorUid||'')===self)||(validId(ctx.replyToUid)===self)||x.kind==='at')){
          x.dynamicId=ctx.dynamicId;x.dynamicVerified=true;
          x.verifiedOwnDynamic=String(ctx.authorUid||'')===self;
          x.verifiedReplyToSelf=validId(ctx.replyToUid)===self;
          x.scope=scopeOf(x,owned,db.ownReplies);
          x.verifiedCommentText=String(ctx.verifiedCommentText||'').slice(0,320);
          x.contextSummary=String(ctx.summary||'').slice(0,250);
          x.contextRoot=validId(ctx.root)||x.contextRoot;
          x.root=validId(ctx.root)||x.root;
        }else if(ctx?.usable===true&&validDynamicId(ctx.dynamicId)&&(!x.dynamicId||ctx.dynamicId===x.dynamicId)&&validId(ctx.targetUid)===x.uid){
          x.dynamicRejected=true;db.seen[x.id]='unrelated-dynamic';interactionNote(db,x,'unrelated_dynamic');
        }
      }
      // Resolve missing @ bodies before any social AI / TODO intake. A notice
      // missing source_content may still be a real, nonempty comment. The source
      // lookup must verify video + exact rpid + sender UID and must never send.
      for(const x of tagged){
        if(x.kind!=='at'||x.sourceTextMissing!==true||db.seen[x.id]||
           !x.timestampMs||x.timestampMs<=now()-WINDOW||x.timestampMs>now()+60_000)continue;
        if(Number(db.atContextRetries?.[x.id]?.nextAt)>now())continue;
        // Incoming @ from any verified UID is eligible for read-only source recovery.
        // Actual sending still requires the independent public reply toggle.
        if(cfg.replyAt===false)continue;
        let source=null;
        try{source=await getAtSource(x);}catch(e){x.errorDetail=safeErrorDetail(e);}
        const authenticated=source?.ok===true&&validId(source.uid)===x.uid&&
          validId(source.rpid)===x.rpid&&validBv(source.bvid)===x.bvid&&
          String(source.text||'').trim().length>0;
        if(!authenticated){
          const identityMismatch=source?.ok===true&&(
            validId(source.uid)!==x.uid||validId(source.rpid)!==x.rpid||validBv(source.bvid)!==x.bvid);
          const attempt=db.atContextRetries[x.id]??{attempts:0};
          attempt.attempts=Math.min(100,Number(attempt.attempts||0)+1);
          x.errorDetail=x.errorDetail||safeErrorDetail(source?.reason||'源评论尚未取得或未通过核验');
          if(identityMismatch){
            // A verified author or rpid mismatch is definitive: never send.
            db.seen[x.id]='at-source-unverified';delete db.atContextRetries[x.id];
            atNote(db,x,'mention_source_unverified');
          }else{
            // Network/rate-limit and missing pages may recover later. Keep a
            // bounded retry schedule while the original 24h window is valid.
            attempt.nextAt=now()+Math.min(30,5*2**Math.min(attempt.attempts-1,3))*60_000;
            db.atContextRetries[x.id]=attempt;
            x.retryAt=attempt.nextAt;
            atNote(db,x,'waiting_for_mention_source');
          }
          continue;
        }
        const original=String(source.text).trim(),cleaned=stripAccountMentions(original);
        // A verified rpid/author proves that an @ occurred, not where its
        // nickname ends or what the sender meant. In particular a contiguous
        // '@大肥鱼怒了看看' cannot become a statement that fish is angry.
        // Never feed the raw @ token or an internal diagnostic sentence to
        // the reply AI, social cognition, interest extraction or Life Memory.
        const unambiguous=hasMeaningfulMentionText(cleaned);
        if(!unambiguous){
          db.seen[x.id]='mention-body-ambiguous';
          delete db.atContextRetries[x.id];
          atNote(db,x,'mention_body_ambiguous');
          continue;
        }
        x.text=cleaned.slice(0,800);
        x.mentionOnly=false;
        x.sourceTextMissing=false;x.errorDetail='';
        if(source.topLevel===true){
          x.topLevel=true;x.unresolvedNested=false;x.contextRoot=x.rpid;
          x.locationRoot=x.rpid;x.root='';x.locationSource='verified-top';
        }
        delete db.atContextRetries[x.id];
        atNote(db,x,'mention_text_recovered');
      }
      // Trust-scoped recommendation feedback must not depend on AI deciding to reply.
      // Read-only observation happens even when per-user/public reply quotas are full.
      // owner/@/reply and friend observations are routed before reply quotas.
      // Persist the handled receipt in this SAME dedupe ledger so a generic
      // reply cannot race or repeat the owner-agent response.
      for(const x of tagged){
        if(!['notice','at'].includes(x.kind)||db.seen[x.id]||(sourceKeyFor(x)&&db.seen[sourceKeyFor(x)]))continue;
        if(x.kind==='at'&&x.sourceTextMissing===true)continue; // never pass unverified empty @ into social AI
        if(validDynamicId(x.dynamicId)&&x.dynamicVerified!==true)continue;
        if(!x.timestampMs||x.timestampMs<=now()-WINDOW||x.timestampMs>now()+60_000)continue;
        try{
          const result=await onIncoming(x)
          if(result?.consumed===true){
            db.seen[x.id]='owner-comment-agent';
            const sourceKey=sourceKeyFor(x);if(sourceKey)db.seen[sourceKey]='owner-comment-agent';
            interactionNote(db,x,result.reason||'owner_social_agent');
            await save(db);
          }
        }catch(e){logger.warn?.('评论社交入口异常：'+String(e?.message||e).slice(0,110))}
      }
      if(feedbackOnly){
        await save(db);lastPollAt=now();lastError='';
        return {sent:0,failed:0,ignored:0,limitSkipped:0,quotaBlocked:0,skipped:'global-quota-exhausted',observedFeedback:true};
      }
      // 我的顶层评论下 > 我的楼中楼回复下 > 其他回复通知 > 热门评论
      const order={'self-top':0,'self-nested':1,'self-dynamic':2,'at':3,'notice':4,'top':5};
      tagged.sort((a,b)=>order[a.scope]-order[b.scope]||(a.kind==='top'?Number(isFishBait(b.text))-Number(isFishBait(a.text)):0));
      for(const x of tagged){
        const sourceKey=x.kind==='at'||x.kind==='notice'?sourceKeyFor(x):'';
        if(releaseLegacyStrangerHold(db,x,now()))interactionNote(db,x,'legacy_stranger_hold_released');
        // A local pre-send cooldown is not a platform attempt. Do not burn the
        // incoming event or repeat model decisions until its bounded retry time.
        if(Number(db.preflightDefers?.[x.id])>now())continue;
        if(db.preflightDefers?.[x.id])delete db.preflightDefers[x.id];
        if(unique.has(x.id)||(sourceKey&&(unique.has(sourceKey)||db.seen[sourceKey]))){
          if(!db.seen[x.id]){db.seen[x.id]='source-already-processed';interactionNote(db,x,'source_already_processed');}
          continue;
        }
        const prior=db.seen[x.id];
        if(x.kind==='at'){
          // Listening for trusted friends' preferences is NOT permission to publish.
          if(cfg.replyAt===false){db.seen[x.id]='at-feedback-only';atNote(db,x,'feedback_only');continue;}
          if(!cfg.watchAt){db.seen[x.id]='at-disabled';atNote(db,x,'disabled');continue;}
          // Any verified incoming @ can reach fish's autonomous reply choice.
          // This does not authorize an outbound send and does not replay old notices.
          if(!x.timestampMs || x.timestampMs<=now()-WINDOW || x.timestampMs>now()+60_000){
            db.seen[x.id]='at-out-of-window';atNote(db,x,'out_of_window');ignored++;continue;
          }
        }
        if(typeof prior==='string'&&prior.startsWith('quota-blocked:')){
          const [,blockedDay,blockedLimit]=prior.split(':');
          if(blockedDay===today&&Number(blockedLimit)===globalLimit)continue;
          delete db.seen[x.id];
        }
        // Old versions marked a *never sent* per-user quota rejection as a
        // permanent dedupe receipt. Reconsider only a fresh verified notice.
        if(db.seen[x.id]==='per-user-limit'&&Number(x.timestampMs)>now()-WINDOW)
          delete db.seen[x.id];
        if(db.seen[x.id])continue;
        // Upstream verified-source step records retry diagnostics; never pass
        // missing/ambiguous unverified source text to reply generation.
        if(x.kind==='at'&&x.sourceTextMissing===true){ignored++;continue;}
        if(x.unresolvedNested===true && !validDynamicId(x.dynamicId)){db.seen[x.id]='unverified-thread-root';interactionNote(db,x,'unverified_thread_root');ignored++;continue;}
        if(x.kind==='notice'&&cfg.allowGeneralReplies===false)continue;
        if(validDynamicId(x.dynamicId) && Number(db.atContextRetries?.[x.id]?.nextAt)>now())continue;
        if(x.kind==='at' && Number(db.atContextRetries?.[x.id]?.nextAt)>now())continue;
        unique.add(x.id);if(sourceKey)unique.add(sourceKey);
        if(sent>=maxPoll||db.sent.length>=maxDay){interactionNote(db,x,'reply_limit');break;}
        if(x.lifeSelectedHot===true){
          const live=getConfig()
          if(!live.watchReplies||live.allowGeneralReplies===false||x.accountUid!==self){
            db.lifeSelectedQueue=db.lifeSelectedQueue.filter(row=>row.id!==x.id);continue}
          try{
            const fresh=normalizeTopComments(await getComments(x.bvid,Math.min(30,cap(cfg.topCount,1,30,12))),x.bvid,self)
            const verified=fresh.find(row=>row.rpid===x.rpid&&row.uid===x.uid&&row.text===x.text)
            if(!verified){db.seen[x.id]='life-hot-target-changed';interactionNote(db,x,'life_hot_target_changed');continue}
          }catch(e){interactionNote(db,x,'life_hot_recheck_failed');continue}
        }
        if(x.kind==='top'&&!x.lifeSelectedHot&&!cfg.allowGeneralTop&&!isFishBait(x.text)){db.seen[x.id]='irrelevant';ignored++;continue;}
        let dynamicContext=null;
        if(x.contentType==='dynamic'){
          try{dynamicContext=x.dynamicContextResult??await getDynamicContext(x);}catch(e){
            x.errorDetail=safeErrorDetail(e);logger.warn?.('动态评论上下文读取失败：'+x.errorDetail);
          }
          const verified=dynamicContext?.usable===true && validId(dynamicContext?.targetUid)===x.uid && dynamicContext?.dynamicId===x.dynamicId;
          if(!verified){
            if(dynamicContext?.terminal===true){
              db.seen[x.id]='dynamic-source-mismatch';delete db.atContextRetries[x.id];
              x.errorDetail=safeErrorDetail(dynamicContext.reason||'已核验评论源身份与通知不一致');
              interactionNote(db,x,'dynamic_source_mismatch');ignored++;continue;
            }
            const attempt=db.atContextRetries[x.id]??{attempts:0};
            attempt.attempts=Math.min(100,Number(attempt.attempts||0)+1);
            attempt.nextAt=now()+dynamicVerificationRetryDelay(attempt.attempts);
            db.atContextRetries[x.id]=attempt;x.retryAt=attempt.nextAt;
            x.errorDetail=safeErrorDetail(dynamicContext?.reason||x.errorDetail||'动态来源读取未获得足够核验证据');
            interactionNote(db,x,'waiting_for_dynamic_context');
            ignored++;continue;
          }
          delete db.atContextRetries[x.id];
          x.verifiedOwnDynamic=String(dynamicContext.authorUid||'')===self;
          x.verifiedReplyToSelf=validId(dynamicContext.replyToUid)===self;
          if(!x.verifiedOwnDynamic&&!x.verifiedReplyToSelf&&x.kind!=='at'){db.seen[x.id]='unrelated-dynamic';interactionNote(db,x,'unrelated_dynamic');ignored++;continue;}
          if(x.kind==='notice')x.scope=x.verifiedOwnDynamic?'self-dynamic':'self-nested';
          x.contextRoot=validId(dynamicContext.root)||x.contextRoot;
          x.root=validId(dynamicContext.root)||x.root;
          x.verifiedCommentText=String(dynamicContext.verifiedCommentText||'').slice(0,320);
          // Only a live-verified self dynamic may provide its own published text.
          x.dynamicText=x.verifiedOwnDynamic&&dynamicContext.ownedLocal===true
            ?String(dynamicContext.ownDynamicText||'').slice(0,650):'';
        }
        const capFor=['self-top','self-dynamic'].includes(x.scope)?topCap:x.scope==='self-nested'?nestedCap:0;
        const recentForPerson=capFor?windowRecords(db).filter(r=>r.uid===x.uid&&r.scope===x.scope).sort((a,b)=>Number(a.at)-Number(b.at)):[];
        if(capFor&&recentForPerson.length>=capFor){
          const nextAt=Number(recentForPerson[recentForPerson.length-capFor]?.at)+WINDOW+1000;
          db.preflightDefers[x.id]=Math.max(now()+60_000,nextAt);
          interactionNote(db,{...x,retryAt:db.preflightDefers[x.id]},'per_user_limit');limitSkipped++;continue;
        }
        const root=validId(x.contextRoot)||validId(x.locationRoot)||validId(x.root)||validId(x.rpid);
        const threadKey=`${x.contentType==='dynamic'?'dynamic:':''}${validId(x.aid)||x.bvid||'unknown'}:${root}`;
        const p6Enabled=p6On(cfg,x.kind);
        const tier=socialTier(x.uid);
        // No unconfigurable per-stranger AI consideration quota. All users
        // remain subject to source verification, autonomous choice, public
        // send permissions, explicit quotas, platform pacing and deduplication.
        let chatCanReply=true
        if(tier==='friend'){
          // Do not skip the existing AI call when chat willingness is low:
          // the same call may still understand a separate read-only TODO.
          // canReply suppresses only the outgoing chat reply after TODO intake.
          let willingness
          try{willingness=decideSocial({uid:x.uid,id:x.id,kind:x.kind,scope:x.scope,text:x.text,bvid:x.bvid,thread:(x.dynamicId?'dynamic:'+x.dynamicId:x.bvid)+':'+root})}
          catch(e){willingness={decision:'blocked'};logger.warn?.('社交聊天意愿暂不可用，仍继续 AI 只读待办理解：'+safeErrorDetail(e))}
          chatCanReply=willingness?.decision==='allow'
          x.chatWillingness=String(willingness?.decision||'blocked')
        }
        const contextHistory=(db.threadHistory[threadKey]||[]).slice(-20);
        const history=contextHistory.map(h=>({role:h.role,uid:h.uid,at:Number(h.at)||0,text:String(h.text||'').slice(0,350)}));
        let emotion=null;try{emotion=getEmotion()}catch(e){logger.warn?.('当前模拟心情读取失败，降级处理：'+safeErrorDetail(e).slice(0,90))}
        const engagement=commentEngagementContext({uid:x.uid,dynamicId:x.contentType==='dynamic'?x.dynamicId:'',threadKey,
          replyRecords:db.replyRecords,emotion,nowMs:now()});
        x.replyDecision={recent30m:engagement.recent30m,recent2h:engagement.recent2h,
          mood:engagement.mood,moodIntensity:engagement.moodIntensity,energy:engagement.energy,
          sociality:engagement.sociality,moodEnabled:engagement.moodEnabled};
        let videoContext={text:'',usable:false};
        try{videoContext=x.contentType==='dynamic'
          ?{usable:true,text:[`B站${x.verifiedOwnDynamic?'本人发布的':'公开视频中的'}独立动态：https://t.bilibili.com/${x.dynamicId}`,x.dynamicText?'动态内容：'+x.dynamicText:'',
             '已核验目标评论：'+x.verifiedCommentText].filter(Boolean).join('\n'),summary:x.contextSummary||'动态评论已核验'}
          :await getVideoContext(x.bvid,{aid:x.aid,root:x.contextRoot||x.locationRoot||x.root,rpid:x.rpid,uid:x.uid,targetId:x.targetId,unresolvedNested:x.unresolvedNested===true,topLevel:x.topLevel===true,text:x.text,context:x.context,kind:x.kind,includeHot:x.kind==='at'});}
        catch(e){logger.warn?.('视频评论上下文不可用：'+String(e.message||e).slice(0,140));}
        x.contextSummary=String(videoContext?.summary||'').slice(0,300);
        x.rootPreview=String(videoContext?.rootPreview||'');
        x.threadPreview=String(videoContext?.threadPreview||'');x.contextCounts=videoContext?.counts||{};
        if(x.kind==='at'&&!videoContext?.usable){
          const retry=db.atContextRetries[x.id]??{attempts:0};
          retry.attempts++;
          // Network / API failures are not proof the invitation is irrelevant.
          if(retry.attempts>=3){db.seen[x.id]='at-no-video-context';delete db.atContextRetries[x.id];atNote(db,x,'video_context_unavailable');}
          else {retry.nextAt=now()+5*60_000;db.atContextRetries[x.id]=retry;atNote(db,x,'waiting_for_video_context');}
          ignored++;continue;
        }
        if(x.kind==='at')delete db.atContextRetries[x.id];
        if(x.kind==='notice'&&!videoContext?.usable)replyNote(db,x,'video_context_partial');
        const parentContext=x.context&&!String(videoContext?.text||'').includes(String(x.context))?'被回复的内容：'+String(x.context).slice(0,320):'';
      const context=[videoContext?.text||'',parentContext,history.length?(x.dynamicId?'当前动态同一评论串的近况：':'当前视频同一评论串的近况：')+history.map(h=>(h.role==='assistant'?'大肥鱼':'观众')+'：'+h.text).join('；'):''].filter(Boolean).join('\n').slice(0,10000);
        let result;
        try{result=await generateReply({kind:'comment',mode:x.scope,text:x.text,uid:x.uid,messageId:x.id,timestampMs:x.timestampMs,
          senderName:x.name||'',rpid:x.rpid,root:x.root||0,thread:threadKey,...((x.imageUrl||videoContext?.imageUrl)?{imageUrl:x.imageUrl||videoContext.imageUrl}:{}),memeSourceText:x.context,context,history,bvid:x.bvid,
          dynamicId:x.dynamicId||'',contentType:x.dynamicId?'dynamic':'video',
          engagementContext:engagement.text,mustReply:['self-top','self-nested','self-dynamic'].includes(x.scope),canSkip:true,canReply:chatCanReply,todoIntake:true,
          socialAutonomy:p6Enabled,socialChannel:x.kind==='at'?'at':'comment',threadKey,trigger:'incoming'});}
        catch(e){
          x.errorDetail=safeErrorDetail(e);
          // Keep model failures distinct from Life authorization / expression
          // failures. A completed model call can still be blocked while sealing
          // its one-time proof; that is not "AI generation failed".
          const needsOfflineReview=/life-choice-review-required/.test(x.errorDetail)
          const expressionInvalid=/(?:life-social-expression-|life-speech-(?:invalid|required)|life-expression-invalid)/.test(x.errorDetail)
          const lifeAuthorization=/Life (?:评论|私信)表达授权不可用|life-(?:choice|admission|willingness)-/i.test(x.errorDetail)
          const diagnosticReason=needsOfflineReview?'life_authorization_review_required':
            expressionInvalid?'life_expression_validation_failed':
            lifeAuthorization?'life_authorization_blocked':'ai_generation_error'
          // A failed model/auth attempt is neither a completed Life choice nor
          // an outgoing send. Review-required claims need a longer bounded wait;
          // other provider failures use their existing bounded backoff.
          const retryMs=needsOfflineReview?15*60_000:
            /(?:\b429\b|\b50[234]\b|rate.?limit|saturat|provider|timeout|ETIMEDOUT|ENOTFOUND)/i.test(x.errorDetail)?15*60_000:5*60_000
          x.retryAt=now()+retryMs
          db.preflightDefers[x.id]=x.retryAt
          logger.warn?.((needsOfflineReview?'Life 授权账本需要复核，暂缓评论并保留原通知：':
            lifeAuthorization?'Life 评论授权暂不可用，保留原通知并稍后重试：':
            expressionInvalid?'Life 评论表达校验未通过，保留原通知并稍后重试：':
            '生成评论失败，待模型恢复后有界重试：')+x.errorDetail)
          interactionNote(db,x,diagnosticReason);failed++;continue;
        }
        let socialOwnerProof=result&&typeof result==='object'?result.socialOwnerProof:null;
        let lifeWillingnessProof=result&&typeof result==='object'?result.lifeWillingnessProof:null;
        const p6Proposal=result&&typeof result==='object'?result:null;
        if(p6Proposal?.action==='defer'){
          // Model chose to defer. Do not create a legacy timer or replay this
          // identical notification without a new incoming event.
          db.seen[x.id]='life-deferred-no-appointment';
          interactionNote(db,x,'life_deferred');await save(db);ignored++;continue;
        }
        const bubbles=p6Proposal?.action==='reply'&&Array.isArray(p6Proposal.messages)?normalizeMessageBurst(p6Proposal.messages,{maxMessages:cap(cfg.p6MaxBubbles,1,3,2),maxChars:130,minMessages:1}):[];
        let reply=(p6Proposal?(bubbles[0]||''):typeof result==='object'?
          result?.action==='reply'?String(result?.messages?.[0]||result?.reply||''):result?.action==='skip'?'SKIP':'':
          String(result||'')).trim().slice(0,130);
        // No second model round after Life has approved the draft. A re-generated
        // reply would require a NEW willingness proof, and a failed enrichment
        // must not erase or masquerade as the valid original decision.
        if(!reply||reply==='SKIP'){
          db.seen[x.id]='skipped';if(sourceKey)db.seen[sourceKey]='skipped';interactionNote(db,x,'ai_skipped');ignored++;
          if(reply==='SKIP'){
            try{await onDeliberateSilence(x)}catch(e){logger.warn?.('记录自主沉默失败：'+safeErrorDetail(e))}
            // 记下对方的收尾消息；以后同一评论串重新开始话题时仍能理解前情。
            const h=db.threadHistory[threadKey]??=[];
            h.push({role:'user',uid:x.uid,at:now(),text:String(x.text).slice(0,350)});
            if(h.length>24)h.splice(0,h.length-24);
          }
          continue;
        }
        // Content policy executes BEFORE reserving an outbound attempt. A
        // rejected draft is a local SKIP, never a possibly-sent remote request.
        if(!validateSocialReplyText(reply).ok||bubbles.some(t=>String(t).length>130||!validateSocialReplyText(t).ok)){
          db.seen[x.id]='proactive-at-blocked';if(sourceKey)db.seen[sourceKey]='proactive-at-blocked';
          interactionNote(db,x,'proactive_at_blocked');ignored++;continue;
        }
        const currentVideoFact=videoContext?.usable===true&&validBv(x.bvid)
          ?lifeFactFromReceipt({type:'video_metadata_read',operation:'public-video-metadata',ok:true,
             bvid:x.bvid,at:now(),scope:'public',sourceId:'comment-context:'+x.bvid+':'+x.id,channel:'comment'}):null
        const factual=verifyLifeOutbound(reply,{channel:'comment',uid:x.uid,
          events:[...getVerifiedFacts({uid:x.uid,channel:'comment'}),...(currentVideoFact?[currentVideoFact]:[])],
          ownerText:x.text,at:now()});
        const bubblesSafe=bubbles.every(t=>verifyLifeOutbound(t,{channel:'comment',uid:x.uid,
          events:[...getVerifiedFacts({uid:x.uid,channel:'comment'}),...(currentVideoFact?[currentVideoFact]:[])],ownerText:x.text,at:now()}).ok);
        if(!factual.ok||!bubblesSafe){db.seen[x.id]='fact-unverified';interactionNote(db,x,'fact_unverified');ignored++;
          logger.warn?.('评论草稿事实未经核验，未发送：'+factual.reason);continue}
        if(x.lifeSelectedHot===true&&(!getConfig().watchReplies||getConfig().allowGeneralReplies===false||
          (await selfUid())!==x.accountUid)){
          interactionNote(db,x,'life_hot_permission_revoked');db.lifeSelectedQueue=db.lifeSelectedQueue.filter(row=>row.id!==x.id);continue;
        }
        x.generatedReply=reply;
        db.seen[x.id]='pending';if(sourceKey)db.seen[sourceKey]='pending';
        const attempt={at:now(),outcome:'pending',scope:x.scope,bvid:validBv(x.bvid)?x.bvid:'',dynamicId:x.dynamicId||'',generatedReply:reply};
        db.sendAttempts.push(attempt);
        db.sendAttempts=db.sendAttempts.filter(a=>Number(a.at)>now()-7*WINDOW).slice(-10000);
        await save(db);
        try{
          const ack=await send({kind:x.kind,contentType:x.contentType||'video',dynamicId:x.dynamicId||'',bvid:x.bvid,aid:x.aid,rpid:x.rpid,root:x.root,uid:x.uid,text:reply,replyIndex:0,socialOwnerProof,lifeWillingnessProof});
          // A local preflight rejection is NOT a failed/uncertain platform send.
          // Release the event for a fresh Life decision only after a bounded wait.
          if(ack?.notAttempted===true){
            attempt.outcome='deferred-before-send';attempt.completedAt=now();
            db.preflightDefers??={};db.preflightDefers[x.id]=Math.min(now()+24*60*60_000,Math.max(now()+60_000,Number(ack.retryAt)||now()+15*60_000));
            if(Object.keys(db.preflightDefers).length>1000)for(const key of Object.keys(db.preflightDefers).slice(0,-1000))delete db.preflightDefers[key];
            delete db.seen[x.id];if(sourceKey)delete db.seen[sourceKey];
            interactionNote(db,x,'send_preflight_deferred');await save(db);continue;
          }
          if(ack!==true&&ack?.ok!==true)throw Error(ack?.error||'评论未收到成功回执');
          if(p6Enabled&&!validId(ack?.rpid||ack?.rpid_str))throw Error('公开 P6 发送成功但缺少真实 rpid 回执，停止续发');
          attempt.outcome='success';attempt.completedAt=now();
          db.seen[x.id]='sent';if(sourceKey)db.seen[sourceKey]='sent';interactionNote(db,x,'sent');db.sent.push(now());sent++;
          if(x.lifeSelectedHot===true)db.lifeSelectedQueue=db.lifeSelectedQueue.filter(row=>row.id!==x.id)

          db.replyRecords.push({at:now(),uid:x.uid,scope:x.scope,threadKey,
            bvid:validBv(x.bvid)?x.bvid:'',dynamicId:x.dynamicId||'',aid:validId(x.aid),
            outboundRpid:validId(ack?.rpid||ack?.rpid_str),
            recipientName:String(x.name||'').trim().slice(0,60),recipientUid:validId(x.uid),
            recipientComment:String(x.text||'').trim().slice(0,420)});
          const outboundId=validId(ack?.rpid||ack?.rpid_str);
          rememberConfirmedRecipient(x,outboundId);
          if(outboundId&&['notice','at'].includes(x.kind)&&validBv(x.bvid)&&
             videoContext?.verifiedVideo?.bvid===x.bvid&&
             String(videoContext.verifiedVideo.title||'').trim()){
            // Notification reply != Life election to read unrelated threads.
            // This only registers a verified public-video Episode; no read/send.
            try{await save(db);await onConfirmedVideoReply({bvid:x.bvid,
              title:videoContext.verifiedVideo.title,receiptId:outboundId,sourceId:x.id,accountUid:self})}
            catch(e){logger.warn?.('Life 视频回复线索登记失败（不影响已确认发送）：'+safeErrorDetail(e))}
          }
          if(outboundId&&validBv(x.bvid)){
            db.replyLabels??={};
            db.replyLabels[x.bvid+':'+outboundId]={recipientName:String(x.name||'').trim().slice(0,60),
              recipientUid:validId(x.uid),recipientComment:String(x.text||'').trim().slice(0,420),at:now()};
            // 有界存储，防止长期聊天造成状态文件无限增大。
            const keys=Object.keys(db.replyLabels);
            if(keys.length>30000)for(const k of keys.slice(0,keys.length-30000))delete db.replyLabels[k];
          }
          if(outboundId)db.ownReplies[outboundId]={at:now(),root,aid:validId(x.aid),bvid:x.bvid||'',dynamicId:x.dynamicId||''};
          const h=db.threadHistory[threadKey]??=[];
          h.push({role:'user',uid:x.uid,at:now(),text:String(x.text).slice(0,350)}, {role:'assistant',uid:self,at:now(),text:reply});
          if(h.length>24)h.splice(0,h.length-24);
          // The first reply is already confirmed. Save its receipt before any
          // next bubble; an uncertain later bubble never rewrites the first as unsent.
          if(p6Enabled){
            await save(db);
            let interrupted=false;
            for(const [i,extra] of bubbles.slice(1).entries()){
              const live=getConfig();
              if(i+1>=cap(live.p6MaxBubbles,1,3,2)||!p6On(live,x.kind)||!(x.kind==='at'?live.replyAt:live.watchReplies)
                ||sent>=maxPoll||db.sent.length>=maxDay){interrupted=true;break}
              const capNow=x.scope==='self-top'?topCap:x.scope==='self-nested'?nestedCap:0;
              if(capNow&&db.replyRecords.filter(r=>r.uid===x.uid&&r.scope===x.scope).length>=capNow){interrupted=true;break}
              try{if(await hasNewerPublicReply(x,self)){interrupted=true;break}}
              catch(e){logger.warn?.('公开 P6 连发前未能重读通知，停止后续气泡：'+safeErrorDetail(e));interrupted=true;break}
              const extraAttempt={at:now(),outcome:'pending',scope:x.scope,p6:true,sourceId:x.id};
              db.sendAttempts.push(extraAttempt);await save(db);
              try{
                const extraAck=await send({kind:x.kind,contentType:x.contentType||'video',dynamicId:x.dynamicId||'',
                  bvid:x.bvid,aid:x.aid,rpid:x.rpid,root:x.root,uid:x.uid,text:extra,replyIndex:i+1,socialOwnerProof,lifeWillingnessProof});
                if(extraAck?.ok!==true||!validId(extraAck.rpid||extraAck.rpid_str))throw Error(extraAck?.error||'公开 P6 续发没有可信 rpid');
                extraAttempt.outcome='success';extraAttempt.completedAt=now();
                db.sent.push(now());sent++;
                const extraId=validId(extraAck.rpid||extraAck.rpid_str);
                db.replyRecords.push({at:now(),uid:x.uid,scope:x.scope,threadKey,bvid:validBv(x.bvid)?x.bvid:'',
                  dynamicId:x.dynamicId||'',aid:validId(x.aid),outboundRpid:extraId,
                  recipientName:String(x.name||'').slice(0,60),recipientUid:x.uid,recipientComment:String(x.text||'').slice(0,420)});
                rememberConfirmedRecipient(x,extraId);
                if(extraId)db.ownReplies[extraId]={at:now(),root,aid:validId(x.aid),bvid:x.bvid||'',dynamicId:x.dynamicId||''};
                h.push({role:'assistant',uid:self,at:now(),text:String(extra).slice(0,130)});
                if(h.length>24)h.splice(0,h.length-24);
                await save(db);
              }catch(e){extraAttempt.outcome='uncertain';extraAttempt.errorDetail=safeErrorDetail(e);extraAttempt.completedAt=now();
                failed++;interrupted=true;await save(db);logger.warn?.('公开 P6 续发结果不确定，不重复发送：'+extraAttempt.errorDetail);break}
            }

          }
        }catch(e){
          const message=safeErrorDetail(e),outcome=errorClass(message);
          x.errorDetail=message;attempt.outcome=outcome;attempt.completedAt=now();attempt.errorDetail=message;
          if(outcome==='blocked_quota'||outcome==='blocked_quota_store'){
            // 明确知道未发起公开发布：硬上限耗尽时暂停到次日/改设置；账本暂不可用时冷却5分钟后再试。
            db.seen[x.id]=`quota-blocked:${today}:${globalLimit}`;if(sourceKey)db.seen[sourceKey]=db.seen[x.id];
            const storeError=outcome==='blocked_quota_store';
            db.globalQuotaBlocked={day:today,limit:globalLimit,at:now(),reason:storeError?'store-error':'limit',retryAfter:storeError?now()+300_000:0};quotaBlocked++;
            interactionNote(db,x,storeError?'quota_store_blocked':'quota_exhausted');
            logger.warn?.(storeError?'公开评论额度账本不可用，本轮停止并冷却5分钟':'公开评论全局额度已阻止发送，本轮停止并暂停后续重复调用');
          }else{
            db.seen[x.id]='uncertain';if(sourceKey)db.seen[sourceKey]='uncertain';interactionNote(db,x,'send_'+outcome);failed++;
            logger.warn?.('评论发送未确认，不自动重试：'+outcome);
          }
        }
        await save(db);
        if(quotaBlocked)break;
      }
      if(db.strangerAttempts){for(const [uid,rows] of Object.entries(db.strangerAttempts)){const fresh=rows.filter(t=>t>now()-WINDOW);if(fresh.length)db.strangerAttempts[uid]=fresh;else delete db.strangerAttempts[uid]}}
      const keys=Object.keys(db.seen);if(keys.length>5000)for(const k of keys.slice(0,keys.length-5000))delete db.seen[k];
      // 避免长期增长：自发评论 ID 保留90天，评论串最多500条。
      for(const [id,r] of Object.entries(db.ownReplies))if(Number(r.at)<now()-90*WINDOW)delete db.ownReplies[id];
      const retryKeys=Object.keys(db.atContextRetries||{});if(retryKeys.length>500)for(const k of retryKeys.slice(0,retryKeys.length-500))delete db.atContextRetries[k];
      const threads=Object.keys(db.threadHistory);if(threads.length>500)for(const k of threads.slice(0,threads.length-500))delete db.threadHistory[k];
      await save(db);lastPollAt=now();lastError='';
      return {sent,failed,ignored,limitSkipped,baselined,quotaBlocked};
    }catch(e){lastError=String(e.message||e);logger.error?.('评论监听失败：'+lastError);return {error:lastError};}
    finally{busy=false;if(handle){await handle.close().catch(()=>{});await unlink(lockPath).catch(()=>{});}}
  }
  // The ONLY producer of cross-thread suggestions after dev.11. Life has
  // independently selected an existing video's discussion and the trusted
  // host has validated the read's exact BV. This is not a send permission.
  async function offerLifeSelectedDiscussion({bvid,comments,accountUid,sourceId}={}){
    if(!validBv(bvid)||!validId(accountUid)||
       !/^intention:[a-f0-9]{24}:discussion$/.test(String(sourceId||''))||
       !Array.isArray(comments)||comments.length>10||(await selfUid())!==accountUid)
      return {ok:false,reason:'life-discussion-source-invalid'}
    const cfg=getConfig()
    if(cfg.watchReplies!==true||cfg.allowGeneralReplies===false)
      return {ok:false,reason:'ordinary-comment-reply-not-authorized'}
    let rows
    try{rows=normalizeTopComments({comments},bvid,accountUid).slice(0,3)}
    catch{return {ok:false,reason:'life-discussion-comments-invalid'}}
    if(!rows.length)return {ok:true,queued:0}
    const handle=await lock()
    if(!handle)return {ok:false,reason:'comment-ledger-busy'}
    try{
      if((await selfUid())!==accountUid)return {ok:false,reason:'account-changed'}
      const db=await load()
      db.lifeSelectedQueue=(db.lifeSelectedQueue||[]).filter(row=>row?.lifeSelectedHot===true&&
        row.accountUid===accountUid&&row.at>now()-WINDOW&&!db.seen[row.id]).slice(-24)
      let queued=0
      for(const row of rows){
        if(db.seen[row.id]||db.lifeSelectedQueue.some(v=>v.id===row.id))continue
        db.lifeSelectedQueue.push({...row,lifeSelectedHot:true,accountUid,sourceId,at:now()})
        queued++
      }
      db.lifeSelectedQueue=db.lifeSelectedQueue.slice(-24)
      await save(db)
      return {ok:true,queued}
    }catch(e){return {ok:false,reason:'life-discussion-ledger-unavailable',detail:safeErrorDetail(e).slice(0,80)}}
    finally{await handle.close().catch(()=>{});await unlink(lockPath).catch(()=>{})}
  }
  return {poll,status,stateFile,forceReply,offerLifeSelectedDiscussion};
}
