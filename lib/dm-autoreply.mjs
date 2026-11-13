/**
 * dsh-dafeiyu-life: AI-led DM autonomy with explicit stranger-send consent and optional strict approval.
 * Transport/LLM neutral: callers MUST supply authenticated Bilibili fetch/send
 * adapters and a DSH-backed generateReply adapter.
 *
 * fetchIncoming() -> [{ senderUid, messageId, timestampMs, text, incoming:true }]
 * - Return only private, user-to-account chat messages (not system notifications).
 * - messageId must be stable across polls; timestampMs must be an epoch ms integer.
 * send({uid, text}) -> {ok:true, receiptId?} or true (throws or {ok:false} on failure).
 * generateReply(...) -> legacy string or SocialAutonomyDecisionContract proposal.
 */
import { mkdir, open, readFile, rename, writeFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {verifyLifeOutbound} from './verified-life-facts.mjs';
import {createSocialContinuityLedger} from './social-continuity-ledger.mjs';
import {validateSocialReplyText} from './social-autonomy-contract.mjs';
import {pruneDmContext, dmOlderContextText, DM_CONTEXT_DAYS, DM_OLDER_CONTEXT_DAYS} from './dm-context-retention.mjs'
import {normalizeMessageBurst,deliverMessageBurst} from './message-burst.mjs'
import {createNaturalExpressionOpportunity} from './natural-expression-opportunity.mjs';
import {normalizeDmContinuation} from './dm-progressive-expression.mjs';
import {normalizeTopicState,mayUnpromptedContinue} from './conversation-topic-state.mjs';

const clamp = (n, lo, hi, fallback) => Number.isFinite(+n) ? Math.max(lo, Math.min(hi, Math.round(+n))) : fallback;
const cleanUid = (uid) => { const s = String(uid ?? '').trim(); return /^[1-9]\d{0,18}$/.test(s) ? s : ''; };
const cleanString = (value, max) => String(value ?? '').slice(0, max);
function resolveOptions(config = {}) {
  const rawList = Array.isArray(config.whitelist) ? config.whitelist : String(config.whitelist || '').split(/[\s,，;；]+/);
  const whitelist = new Set(rawList.map(cleanUid).filter(Boolean));
  return {
    enabled: config.enabled === true,
    strangerEnabled: config.strangerEnabled === true,
    legacyStrangerOnce: config.legacyStrangerOnce === true,
    p6Enabled: config.p6Enabled !== false,
    p6MaxBubbles:clamp(config.p6MaxBubbles,1,3,3),
    delayMinMinutes:clamp(config.delayMinMinutes,5,360,5),delayMaxMinutes:clamp(config.delayMaxMinutes,5,360,360),
    strangerMaxReplies: clamp(config.strangerMaxReplies, 1, 20, 1),
    whitelist,
    approvalEnabled: config.approvalEnabled === true,
    approvalPhrase: cleanString(config.approvalPhrase || '白饭🍚',60).trim(),
    approvedTotalLimit: clamp(config.approvedTotalLimit, 1, 10000, 50),
    approvedDailyLimit: clamp(config.approvedDailyLimit, 1, 1000, 10),
    intervalMs: clamp(config.intervalMinutes, 1, 120, 1) * 60_000,
    maxPerPoll: clamp(config.maxPerPoll, 1, 20, 3),
    maxPerHour: clamp(config.maxPerHour, 1, 120, 60),
    maxPerDay: clamp(config.maxPerDay, 0, 1000, 0),
    whitelistCooldownMs: clamp(config.whitelistCooldownSeconds, 0, 600, 20) * 1000,
    historyLimit: clamp(config.historyLimit, 0, 80, 40),
  };
}
const fresh = () => ({ version: 1, initialized: false, people: {}, sentAt: [] });
const validIncoming = (row, me) => {
  if (!row || row.incoming !== true || row.system === true) return null;
  const uid = cleanUid(row.senderUid);
  if (!uid || uid === me) return null;
  const id = cleanString(row.messageId, 150);
  const time = Number(row.timestampMs);
  if (!id || !Number.isSafeInteger(time) || time <= 0) return null;
  return { uid, id, time, ...(row.imageUrl ? {imageUrl:String(row.imageUrl).slice(0,1500)} : {}), text: cleanString(row.text, 4000), nickname:cleanString(row.senderName||'',60).replace(/[<>\r\n]/g,'') };
};
const personOf = (db, uid) => (db.people[uid] ??= {seen:[], history:[], olderContext:[], lastRepliedAt:0, stranger:null});
const contactBoundary=(person,accountUid)=>person.dmContactBoundaries?.[accountUid]||
  (person.dmContactBoundary?.accountUid===accountUid?person.dmContactBoundary:null);
const setContactBoundary=(person,accountUid,status,msg)=>{
  const rows=person.dmContactBoundaries??={};
  rows[accountUid]={status,at:msg.time,sourceMessageId:msg.id};
  delete person.dmContactBoundary; // older development snapshots
};
/** Negative DM contact consent is not a relationship score or a learned portrait.
 * Only an authenticated inbound private message can change this account/UID fact.
 * Keep it in the existing DM transaction/state so an opted-out user is safe
 * across restarts even when nobody qualifies for a portrait.
 */
export function dmContactInstruction(text){
 const s=String(text||'').trim().slice(0,400)
 if(/^(?:现在|以后|从现在起)?(?:你)?(?:可以|允许)(?:再|继续|重新)?(?:给我发私信|私信我)(?:了|啦|吧)?[。!！\s]*$/u.test(s)||
   /^(?:我)?(?:同意|允许)(?:你)?(?:再|继续)?(?:给我发私信|私信我)(?:了|啦)?[。!！\s]*$/u.test(s)||
   /^(?:现在|以后)?(?:可以|允许)(?:重新|再|继续)?联系我(?:了|啦|吧)?[。!！\s]*$/u.test(s))return 'resume'
 if(/(?:不要|别|请勿|停止|禁止)(?:再|继续)?(?:.{0,12})?(?:给我发私信|私信我|发私信给我)/u.test(s)||
   /(?:不想再|不愿再)(?:收到|接收)(?:你|你的)?(?:私信|消息)/u.test(s)||
   /(?:不要|别|停止|请勿)(?:再|继续)?(?:给我发消息|发消息给我|联系我|再来联系我)/u.test(s)){
   // A quote or third person's request is not verified first-person consent.
   if(/(?:别人|朋友|他说|她说|有人说|引用|举例|比如)/u.test(s))return ''
   return 'stop'
 }
 return ''
}
export function dmConversationPhase(text){
 const s=String(text||'').trim()
 return /(?:^|[，,。！!\s])(?:再见|拜拜|不聊了|到此为止|不用再回复|别再回复|不用继续聊|话题结束)(?:[啦了啊哦呀哈~～。！!\s]*$)/u.test(s)?'closed':'ongoing'
}

const todayOf = (ms) => { const d=new Date(ms);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const normalizeApplication = value => String(value||'').replace(/[\s\uFE0F]/g,'').trim();
// 申请暗号仍由用户配置；仅当暗号明确是米饭🍚时，兼容一次或多次投喂。
// 不能用 includes('🍚')：普通闲聊提到米饭也不代表申请，更不能绕过自定义暗号。
export function isDmApprovalBait(text, phrase) {
  const incoming = normalizeApplication(text);
  const expected = normalizeApplication(phrase);
  if (!incoming || !expected) return false;
  if (incoming === expected) return true;
  if (expected === '白饭🍚' && ['白饭','白饭🍙'].includes(incoming)) return true;
  if (expected !== '白饭🍚' && expected !== '🍚') return false;
  // 允许连续投喂，但只接受独立的暗号消息，避免把普通对话误认为授权申请。
  // 限制数量以避免大量重复表情意外触发和无界输入。
  const bait = incoming.replace(/[!！。~～]+$/u, '');
  return /^🍚{1,12}$/u.test(bait) || /^白饭🍚{1,12}$/u.test(bait);
}
// 只过滤「要求再次投喂才能聊天／帮忙」的语句；普通聊吃饭、白饭玩梗不受影响。
function repeatedInvite(sentence, phrase) {
  const text=String(sentence||'');
  const bait=/🍚|白饭|米饭|暗号|饭饭|投喂/.test(text) || (phrase && text.includes(phrase));
  return !!(bait && (
    /(?:先|再|还要|记得|继续|给|要不要|麻烦).{0,16}(?:投喂|喂|送|来).{0,12}(?:🍚|米饭|白饭|一口|一碗|饭)/.test(text) ||
    /(?:投喂|喂|送).{0,12}(?:🍚|米饭|白饭|一口|一碗|饭).{0,20}(?:才能|就|再|继续|嘛|一下|吧|呗|试试)/.test(text) ||
    /(?:还要|重新|再来|再发).{0,10}(?:申请暗号|🍚|白饭|米饭)/.test(text)
  ));
}
export function removeRepeatedApprovalInvitation(reply, phrase) {
  const text=String(reply||'').trim();
  // 分句去掉强制续聊暗号邀请，不把模型内部状态暴露给对方。
  const chunks=text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*/g)||[text];
  const kept=chunks.filter(x=>!repeatedInvite(x,phrase)).join('').trim();
  // 如果整条都是索要暗号，选择不发，而非另造一句回复。
  return kept || 'SKIP';
}
/** Historical DM excerpts are short-lived raw context, not stable knowledge. */
function retainHistory(person, limit, atNow) {
  return pruneDmContext(person,{atNow,historyLimit:limit});
}

function normalizeGeneratedDecision(raw) {
  if (typeof raw === 'string') {
    const text=raw.trim();
    return text==='SKIP'?{action:'skip',messages:[]}:{action:'reply',messages:text?[text]:[]};
  }
  if (!raw || typeof raw!=='object') return {action:'invalid',messages:[]};
  const action=String(raw.action||'').toLowerCase();
  const messages=Array.isArray(raw.messages)?raw.messages.map(x=>String(x??'').trim()).filter(Boolean):[];
  return {action,messages,notBefore:Number(raw.notBefore)||0,followUpMinutes:Number(raw.followUpMinutes)||0,
    idleReconsiderMinutes:Number(raw.idleReconsiderMinutes)||0,
    idleReconsiderReason:String(raw.idleReconsiderReason||'').slice(0,40),
    continuation:normalizeDmContinuation(raw.continuation),topicState:normalizeTopicState(raw.topicState),
    reason:String(raw.reason||'').slice(0,80),nextAction:raw.nextAction&&typeof raw.nextAction==='object'?raw.nextAction:null,socialOwnerProof:raw.socialOwnerProof,lifeWillingnessProof:raw.lifeWillingnessProof};
}

function markSeen(person, msg) {
  if (!person.seen.includes(msg.id)) person.seen.push(msg.id);
  if (person.seen.length > 500) person.seen.splice(0, person.seen.length - 500);
}

export function createDmAutoReply({ dataDir, fetchIncoming, send, generateReply, generateContinuation=null, canSendDm=null, canContinue=()=>true, lookupNickname, onIncoming, onScanSettled, fetchApprovalHistory, getConfig, selfUid = '', getVerifiedFacts=()=>[], getRelationshipStage=()=> 'new', reconsiderRandom=Math.random, onVerifiedReply=null, onPendingAction=()=>{}, logger = console, now = Date.now }) {
  if (!dataDir || typeof fetchIncoming !== 'function' || typeof send !== 'function' || typeof getConfig !== 'function') {
    throw new TypeError('dataDir, fetchIncoming, send, getConfig are required');
  }
  const file = join(dataDir, 'dm-autoreply-state.json');
  const lockFile = join(dataDir, 'dm-autoreply.lock');
  let polling = false;
  let stopped = true;
  let timer;
  let lastError = '';
  let lastPollAt = 0;
  let lock = null;
  const activeSessions=new Map() // process-local, never raw chat history
  let lastFastAt=0,fastChecks=0
  const activeWindow=()=>Math.max(60,Math.min(600,Number(getConfig()?.dmActiveWindowSeconds)||180))*1000
  const fastInterval=()=>Math.max(10,Math.min(60,Number(getConfig()?.dmActivePollSeconds)||10))*1000
  const noteActive=uid=>{
    uid=cleanUid(uid);if(!uid)return
    const account=cleanUid(typeof selfUid==='function'?selfUid():selfUid)
    if(!account||account===uid)return
    if(activeAccountUid&&activeAccountUid!==account)activeSessions.clear()
    activeAccountUid=account
    // A just-confirmed outgoing bubble already proves the conversation is
    // current. Do not spend another HTTP request until the configured gap.
    activeSessions.set(uid,{at:now(),checkedAt:now(),cooldownUntil:0})
    if(activeSessions.size>2){const oldest=[...activeSessions].sort((a,b)=>a[1].at-b[1].at)[0];if(oldest)activeSessions.delete(oldest[0])}
  }
  const nextFastUid=()=>{
    const cfg=getConfig()||{}
    if(cfg.dmActivePollEnabled===false||cfg.enabled===false||polling)return ''
    const account=cleanUid(typeof selfUid==='function'?selfUid():selfUid)
    if(!account||account!==activeAccountUid){activeSessions.clear();return ''}
    for(const [id,v] of activeSessions)if(now()-v.at>=activeWindow())activeSessions.delete(id)
    const ready=[...activeSessions].filter(([,v])=>now()-v.checkedAt>=fastInterval()&&now()>=(v.cooldownUntil||0))
      .sort((a,b)=>a[1].checkedAt-b[1].checkedAt)
    return ready[0]?.[0]||''
  }
  const nicknameNextCheck = new Map();
  let continuityOwner='',continuityLedger=null,activeAccountUid='';
  const naturalThought = createNaturalExpressionOpportunity({dataDir,now,random:reconsiderRandom,getPolicy:()=>getConfig()});
  let p6LastTurn=null,p6LastAccountUid=''; // no UID, text or message IDs in diagnostics
  const ledgerFor=uid=>{
    if(!continuityLedger||continuityOwner!==uid){
      continuityLedger=createSocialContinuityLedger({dataDir,accountUid:uid,now});
      continuityOwner=uid;
    }
    return continuityLedger;
  };
  const appendIncomingHistory=(person,messages,limit)=>{
    person.history.push(...messages.filter(m=>!m.approvalResume).map(m=>({role:'user',text:m.text,at:m.time})));
    retainHistory(person,limit,now());
  };
  const markMessagesSeen=(person,messages)=>{for(const msg of messages)if(!msg.approvalResume)markSeen(person,msg);};
  const hasUnseenIncoming=(raw,uid,me,person,excludeIds=[])=>{
    if(!Array.isArray(raw))return false;
    const excluded=new Set(excludeIds.map(String));
    return raw.map(x=>validIncoming(x,me)).some(x=>x&&x.uid===uid&&!person.seen.includes(x.id)&&!excluded.has(x.id));
  };
  const journalPending=(uid,pending,state)=>{
    if(!pending||pending.intentProtocol!==2||pending.action!=='follow_dm_contact'||
      !String(pending.sourceMessageId||'').trim())return
    try{onPendingAction({decisionId:'dm-follow:'+uid+':'+pending.sourceMessageId,
      kind:'dm_follow',state,source:'authenticated-incoming-dm'})}catch{}
  };
  const scheduleContinuity=(ledger,{uid,sourceEventId,purpose,minutes})=>{
    const cfg=resolveOptions(getConfig()),delay=Math.round(Number(minutes));
    if(!cfg.p6Enabled)return {ok:false,reason:'dm-p6-disabled'};
    try{if(canContinue(uid,'dm')!==true)return {ok:false,reason:'friend-no-followup-boundary'}}
    catch{return {ok:false,reason:'portrait-boundary-unavailable'}}
    if(!Number.isSafeInteger(delay)||delay<cfg.delayMinMinutes||delay>cfg.delayMaxMinutes)return {ok:false,reason:'p6-delay-outside-configured-range'};
    const notBefore=now()+delay*60_000;
    return ledger.schedule({uid,channel:'dm',threadKey:`dm:${uid}`,sourceEventId,purpose,notBefore,expiresAt:notBefore+24*3600_000});
  };
  const dmPermission=(uid,person,opts,{checkUnresolved=true,strangerRepliesOverride=null}={})=>{
    const trusted=opts.whitelist.has(uid),approved=person.approval?.status==='approved';
    const count=Number.isSafeInteger(strangerRepliesOverride)?strangerRepliesOverride:
      (Number.isInteger(person.stranger?.count)?person.stranger.count:(person.stranger?1:0));
    const unresolved=!trusted&&!approved&&person.stranger&&['pending','uncertain'].includes(person.stranger.status);
    if(contactBoundary(person,activeAccountUid)?.status==='stop')
      return {allowed:false,reason:'recipient-opted-out',trusted,approved,count};
    if(!opts.enabled)return {allowed:false,reason:'dm-disabled',trusted,approved,count};
    let gate;
    if(typeof canSendDm==='function'){
      try{gate=canSendDm({uid,trusted,approved,strangerEnabled:opts.strangerEnabled,approvalEnabled:opts.approvalEnabled,
        approvalPending:person.approval?.status==='pending',contactOptedOut:contactBoundary(person,activeAccountUid)?.status==='stop',strangerReplies:count,strangerMaxReplies:opts.strangerMaxReplies,
        legacyStrangerOnce:opts.legacyStrangerOnce===true})}
      catch{return {allowed:false,reason:'policy-gate-error',trusted,approved,count};}
    }else{
      const pending=opts.approvalEnabled&&person.approval?.status==='pending';
      const limit=(opts.approvalEnabled||opts.legacyStrangerOnce)&&count>=opts.strangerMaxReplies;
      gate={allowed:trusted||approved||(!pending&&!limit&&opts.strangerEnabled),reason:'local-compatibility-gate'};
    }
    return {allowed:gate?.allowed===true&&!(checkUnresolved&&unresolved),reason:unresolved?'previous-send-unresolved':String(gate?.reason||'policy-denied'),
      trusted,approved,count,role:String(gate?.role||'')};
  };

  const persist = async (db) => {
    const tmp = join(dataDir, `dm-autoreply-state.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 });
      await rename(tmp, file);
    } catch (err) { await unlink(tmp).catch(() => {}); throw err; }
  };
  const load = async () => {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      if (parsed?.version === 1 && parsed.people && Array.isArray(parsed.sentAt)) {
        // dev.5: 历史临时视频心愿永久归档，保留原记录供备份和审计；不得重新激活旧的公开 @ 路径。
        let migrated=false;
        for (const person of Object.values(parsed.people)) {
          for (const wish of Array.isArray(person?.videoWishes)?person.videoWishes:[]) {
            if (['active','pending_review','rejected'].includes(wish.status)) {
              wish.status='legacy_archived';
              wish.archiveReason='dev.5 已移除旧临时视频心愿的公开 @ 执行路径';
              migrated=true;
            }
          }
        }
        if (migrated) await persist(parsed);
        return parsed;
      }
      throw new Error('unknown state format');
    } catch (e) {
      if (e.code === 'ENOENT') return fresh();
      throw e; // never reset on corruption: could cause duplicate stranger replies
    }
  };
  const pruneAllConversationContext=(db,opt)=>{
    const atNow=now();let historyRemoved=0,olderRemoved=0,changed=false;
    for(const person of Object.values(db.people||{})){
      if(!person || typeof person!=='object')continue;
      const r=pruneDmContext(person,{atNow,historyLimit:opt.historyLimit});
      changed ||= r.changed;historyRemoved+=r.historyRemoved;olderRemoved+=r.olderRemoved;
    }
    return {changed,historyRemoved,olderRemoved};
  };
  const enterLock = async () => {
    try { lock = await open(lockFile, 'wx', 0o600); await lock.writeFile(`${process.pid}\n`); return true; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Recover only *clearly stale* locks. Never remove a live process' lock:
      // otherwise two DSH instances could send the same first reply.
      const age = await stat(lockFile).then(s => now() - s.mtimeMs).catch(() => 0);
      const pid = Number((await readFile(lockFile, 'utf8').catch(() => '')).trim());
      let alive = true;
      if (Number.isInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); } catch (err) { alive = err?.code !== 'ESRCH'; }
      }
      if (age > 10 * 60_000 && Number.isInteger(pid) && pid > 0 && !alive) {
        logger.warn?.('DM stale lock from exited process detected, retrying ownership');
        // Guard against another process having already replaced the lock.
        const check = Number((await readFile(lockFile, 'utf8').catch(() => '')).trim());
        if (check === pid) {
          await unlink(lockFile).catch(() => {});
          return enterLock();
        }
      }
      logger.warn?.(`DM poll skipped: lock exists (${Math.round(age / 1000)}s old): ${lockFile}`);
      return false;
    }
  };
  const leaveLock = async () => {
    try { await lock?.close(); } finally { lock = null; await unlink(lockFile).catch(() => {}); }
  };

  async function poll({fastUid=''}={}) {
    fastUid=cleanUid(fastUid)
    if(fastUid&&!activeSessions.has(fastUid))return {skipped:'inactive-session'}
    if (polling) return { skipped: 'busy' };
    const opt = resolveOptions(getConfig());
    if (!opt.enabled) return { skipped: 'disabled' };
    polling = true;
    try {
      await mkdir(dataDir, { recursive: true });
      if (!await enterLock()) return { skipped: 'locked' };
      try {
        const db = await load();
        // Under the existing DM lock: erase expired raw text before generating
        // any reply. Keep deduplication, no-contact and approval facts intact.
        const retention = pruneAllConversationContext(db,opt);
        if(retention.changed) await persist(db);
        const me = cleanUid(typeof selfUid === 'function' ? await selfUid() : selfUid);
        if (!me) throw new Error('未能确认 B站登录账号 UID，停止回复以避免回复自己');
        // A targeted poll belongs to the account that opened the active
        // conversation. Switching B站 accounts must invalidate the lane.
        if(activeAccountUid&&activeAccountUid!==me){
          activeSessions.clear();activeAccountUid=me;
          return {skipped:'active-account-changed'};
        }
        activeAccountUid=me;
        p6LastAccountUid=me;p6LastTurn=db.p6LastTurn||null;
        const continuity=ledgerFor(me);
        if(fastUid){const row=activeSessions.get(fastUid);if(row){row.checkedAt=now();lastFastAt=now();fastChecks++}}
        const raw = await fetchIncoming(fastUid?{fastUid}:{});
        if (!Array.isArray(raw)) throw new TypeError('fetchIncoming must return an array');
        // Only messages already retrieved by an authenticated inbox adapter are processed.
        const rows = raw.map(x => validIncoming(x, me)).filter(Boolean)
          .sort((a,b) => a.time - b.time || a.id.localeCompare(b.id));
        lastPollAt = now();
        if (!db.initialized) {
          // Baseline existing inbox without replying. Avoid accidental mass replies on first startup.
          for (const msg of rows) {
            const person=personOf(db,msg.uid)
            const instruction=dmContactInstruction(msg.text)
            // A pre-existing stop request is still a negative consent fact;
            // baselining means no reply, not forgetting the person's boundary.
            if(instruction)setContactBoundary(person,me,instruction==='stop'?'stop':'resumed',msg)
            markSeen(person,msg)
          }
          db.initialized = true;
          await persist(db);
          if(!fastUid&&typeof onScanSettled==='function')await onScanSettled();
          lastError = '';
          return { initialized: true, baselined: rows.length, sent: 0 };
        }
        // Keep a 24h sliding window for the legacy daily cap, and a 1h subset for rate limiting.
        db.sentAt = db.sentAt.filter(t => Number.isFinite(t) && t > now() - 86400_000);
        const unprocessed = new Map();
        for (const msg of rows) {
          const person = personOf(db, msg.uid);
          if (!person.seen.includes(msg.id)) {
            if (!unprocessed.has(msg.uid)) unprocessed.set(msg.uid, []);
            unprocessed.get(msg.uid).push(msg);
          }
        }
        // A fresh incoming message supersedes any older delayed reply/reconsideration
        // for the same DM thread. The new message will be judged in its own turn.
        for(const uid of unprocessed.keys()){
          try{continuity.cancelForIncoming({uid,channel:'dm',threadKey:`dm:${uid}`})}
          catch(e){logger.warn?.('私信续聊预约取消失败：'+String(e?.message||e).slice(0,100))}
        }
        // 审核通过时，对方的投喂消息通常已经进入 seen。把审批队列当作一条
        // 待处理的已验证来信，与本轮新消息合并；不依赖对方再次发言或接口重新返回旧消息。
        for (const [uid, person] of Object.entries(db.people)) {
          const reply = person?.approval?.reply;
          if (!cleanUid(uid) || person.approval?.status !== 'approved' || reply?.status !== 'queued') continue;
          const queuedMessage = {
            uid, id: cleanString(reply.sourceMessageId || `approval:${person.approval.requestedAt || 'legacy'}`, 150),
            time: Number(reply.queuedAt) || now(), text: cleanString(reply.text || opt.approvalPhrase || '🍚', 100),
            approvalResume: true,
          };
          unprocessed.set(uid, [queuedMessage, ...(unprocessed.get(uid) || [])]);
        }
        let sent = 0, failed = 0, ignored = 0, deferred = 0;
        for (const [uid, messages] of unprocessed) {
          const person = personOf(db, uid);
          const latestName=messages.findLast(x=>x.nickname)?.nickname || '';
          if(latestName)person.nickname=latestName;
          if(!person.nickname && typeof lookupNickname==='function' && (nicknameNextCheck.get(uid)||0)<=now()) {
            nicknameNextCheck.set(uid,now()+10*60_000); // absent names retry in 10 minutes, not 6h
            try {const name=cleanString(await lookupNickname(uid),60).replace(/[<>\r\n]/g,'');if(name){person.nickname=name;nicknameNextCheck.set(uid,now()+6*3600_000);}}catch{}
          }
          // An explicit request to stop DM contact wins before model generation,
          // approval resumes or sending. Mark seen and persist before continuing.
          // Later authenticated opt-in only clears the negative boundary; it
          // never grants any new stranger/whitelist write permission.
          let contactChanged=false;
          for(const msg of messages){
            if(msg.approvalResume)continue;
            const instruction=dmContactInstruction(msg.text);
            if(!instruction)continue;
            setContactBoundary(person,me,instruction==='stop'?'stop':'resumed',msg);
            contactChanged=true;
          }
          if(contactChanged){
            await persist(db);
            if(contactBoundary(person,me)?.status==='stop'){
              for(const msg of messages)markSeen(person,msg);
              appendIncomingHistory(person,messages,opt.historyLimit);
              await persist(db);
              ignored+=messages.length;
              continue;
            }
          }
          // Capture only verified, newly incoming messages; no assistant reply / old inbox baseline.
          if(typeof onIncoming==='function')for(const msg of messages){
            if(msg.approvalResume)continue
            try{await onIncoming({uid,text:msg.text,messageId:msg.id,time:msg.time})}
            catch(e){logger.warn?.('白名单好友爱好观察失败：'+String(e?.message||e).slice(0,100))}
          }
          const trusted = opt.whitelist.has(uid);
          const isApproved = person.approval?.status === 'approved';
          const approved = !trusted && isApproved;
          const stranger = !trusted && !isApproved;
          const identityAllowed = trusted || isApproved;
          const approvalQueued = isApproved && person.approval.reply?.status === 'queued';
          // 兼容旧记录：没有 count 时，曾经存在 stranger 记录视为至少回复过一次。
          const count = Number.isInteger(person.stranger?.count) ? person.stranger.count : (person.stranger ? 1 : 0);
          // 申请属于单独的入站事件：应在陌生人首回/剩余额度判断之前识别。
          // 这样用户提前投喂或一次发四碗🍚，都能进入审核，而不是被 AI 当普通聊天消费。
          const trigger = !identityAllowed && opt.approvalEnabled && person.approval?.status !== 'pending'
            ? messages.findLast(m => !m.approvalResume && isDmApprovalBait(m.text,opt.approvalPhrase)) : null;
          if (trigger) {
            person.approval = {status:'pending',requestedAt:now(),lastText:cleanString(trigger.text,100),lastMessageId:trigger.id};
            for (const msg of messages) markSeen(person, msg);
            ignored += messages.length;
            await persist(db);
            continue;
          }
          // 唯一 SocialPolicyGate 裁决 DM 写权限；关系阶段/人格意愿不能授予发送权。
          // 未确认的上一条发送由 DM 状态本身额外阻断，防止丢回执后自动重发。
          const permission=dmPermission(uid,person,opt);
          const allowed=permission.allowed;
          if (!allowed) {
            for (const msg of messages) markSeen(person, msg);
            ignored += messages.length;
            await persist(db);
            continue;
          }
          if (approved) {
            const u = person.approvedUsage ??= {total:0, day:'', daily:0};
            const day=todayOf(now());
            if (u.day!==day){u.day=day;u.daily=0;}
            if (u.total>=opt.approvedTotalLimit || u.daily>=opt.approvedDailyLimit) {
              // 审核后第一条回复必须保留到额度重置/增加后继续发送。
              // 普通已批准用户的历史额度行为保持不变。
              if (approvalQueued) deferred += messages.length;
              else {
                for(const msg of messages) markSeen(person,msg);
                ignored += messages.length;
                await persist(db);
              }
              continue;
            }
          }
          // Limit global sends; do not consume message IDs while deferred.
          // 兼容旧白名单语义：全局自动私信限额只约束普通/获批用户；
          // 信任白名单仍不受此配额影响，但照常遵守发送冷却。
          if (sent >= opt.maxPerPoll || (!trusted && (db.sentAt.filter(t => t > now() - 3600_000).length >= opt.maxPerHour
            || (opt.maxPerDay > 0 && db.sentAt.length >= opt.maxPerDay)))) { deferred += messages.length; continue; }
          if (now() - person.lastRepliedAt < opt.whitelistCooldownMs) { deferred += messages.length; continue; }
          const latest = messages[messages.length - 1];
          const history = opt.historyLimit ? person.history.slice(-opt.historyLimit) : [];
          const olderContext = opt.historyLimit ? dmOlderContextText(person) : '';
          let generated;
          // Every authorized DM turn uses the same AI decision call. It also returns any read-only
          // TODO proposal; there is no second intent-extraction model request.
          if (typeof generateReply !== 'function') { failed++; logger.warn?.('DM AI adapter is not configured'); continue; }
          try { generated = await generateReply({ uid, messageId:latest.id, text: latest.text, ...(latest.imageUrl?{imageUrl:latest.imageUrl}:{}), imageUrls:[...new Set(messages.map(m=>m.imageUrl).filter(Boolean))].slice(0,3), messages: messages.map(m => m.text),
            messageIds:messages.map(m=>m.id),timestampMs:latest.time,senderName:person.nickname,history,olderContext,stranger,
            canSkip:!approvalQueued,authorization:isApproved?'approved':(trusted?'trusted':'stranger'),
            socialAutonomy:true,threadKey:`dm:${uid}`,trigger:'incoming',continuity:{phase:dmConversationPhase(latest.text)},
            ...(approvalQueued ? {mode:'approval-resume',context:'对方之前投喂了聊天暗号，现在可以自然接话；幽默感谢投喂，绝不提内部审核或后台流程。'} : {}) }); }
          catch (e) {
            // Failed provider requests are technical failures, NEVER a voluntary
            // social skip. Preserve unread incoming IDs for safe later polling.
            p6LastTurn={at:now(),status:'technical-failure',proposed:0,planned:0,confirmed:0,reason:'model-unavailable'}
            db.p6LastTurn=p6LastTurn;await persist(db)
            failed++;logger.warn?.(`DM AI generation failed (technical, not skipped) for uid=${uid}: ${String(e?.message || e)}`);continue;
          }
          let decision=normalizeGeneratedDecision(generated);
          if(opt.p6Enabled===false){
            if(decision.action==='defer')decision={action:'skip',messages:[]};
            if(decision.action==='reply')decision={...decision,messages:decision.messages.slice(0,1),followUpMinutes:0,idleReconsiderMinutes:0};
          }
          if(decision.action==='invalid'){
            p6LastTurn={at:now(),status:'invalid',proposed:0,planned:0,confirmed:0,reason:'model-decision-invalid'};
            db.p6LastTurn=p6LastTurn;await persist(db);
            failed++;logger.warn?.(`DM AI returned an invalid autonomy decision for uid=${uid}`);continue;
          }
          if (decision.action === 'skip'||decision.action==='close') {
            if (approvalQueued) {
              // 已承诺的首次接话不允许跳过，保留待回复任务供下一轮处理。
              failed++;
              logger.warn?.(`DM approval-resume cannot be silently skipped for uid=${uid}`);
              continue;
            }
            // 真正静默：仅确认已读并保留同一用户的上下文；不占发送次数、冷却或陌生人配额。
            if(decision.action==='close')person.lastTopicState='settled';
            p6LastTurn={at:now(),status:'skipped',proposed:0,planned:0,confirmed:0,reason:'model-chose-'+decision.action};db.p6LastTurn=p6LastTurn;
            markMessagesSeen(person,messages);
            appendIncomingHistory(person,messages,opt.historyLimit);
            // A Life choice to remain silent does not cancel a separately
            // chosen action. Never treat an unverified/legacy proposal as a
            // write authorization; the later original tool verifies again.
            if(decision.nextAction&&typeof onVerifiedReply==='function'){
              person.pendingLifeAction={action:decision.nextAction.action,
                reason:String(decision.nextAction.reason||'').slice(0,160),
                sourceMessageId:String(latest.id).slice(0,150),intentProtocol:2,
                dueAt:now()+75_000,expiresAt:now()+24*3600_000,
                attempts:0,status:'pending',expressed:false};
            }
            await persist(db);
            journalPending(uid,person.pendingLifeAction,'queued');
            ignored += messages.length;
            continue;
          }
          if(decision.action==='defer'){
            if(stranger&&opt.legacyStrangerOnce){
              // Old consent allowed a bounded reply to an incoming message, never an unsolicited wakeup.
              markMessagesSeen(person,messages);appendIncomingHistory(person,messages,opt.historyLimit);await persist(db);ignored+=messages.length;continue;
            }
            if(approvalQueued){failed++;logger.warn?.(`DM approval-resume cannot be deferred for uid=${uid}`);continue;}
            const minutes=Math.round((decision.notBefore-now())/60_000);
            let scheduled;
            try{scheduled=scheduleContinuity(continuity,{uid,sourceEventId:latest.id,purpose:'silence-reconsideration',minutes})}
            catch(e){scheduled={ok:false,reason:String(e?.message||e).slice(0,100)}}
            p6LastTurn={at:now(),status:scheduled.ok?'deferred':'defer-unavailable',
              proposed:0,planned:0,confirmed:0,reconsideration:scheduled.ok?'scheduled':'not-scheduled',
              reason:scheduled.ok?'model-chose-defer':String(scheduled.reason||'schedule-unavailable').slice(0,70)};
            db.p6LastTurn=p6LastTurn;
            if(!scheduled.ok){
              failed++;logger.warn?.(`DM defer scheduling failed for uid=${uid}: ${scheduled.reason}; consume this turn as silence to avoid repeated generation`);
              markMessagesSeen(person,messages);appendIncomingHistory(person,messages,opt.historyLimit);await persist(db);ignored+=messages.length;continue;
            }
            markMessagesSeen(person,messages);
            appendIncomingHistory(person,messages,opt.historyLimit);
            if(decision.nextAction&&typeof onVerifiedReply==='function'){
              person.pendingLifeAction={action:decision.nextAction.action,
                reason:String(decision.nextAction.reason||'').slice(0,160),
                sourceMessageId:String(latest.id).slice(0,150),intentProtocol:2,
                dueAt:now()+75_000,expiresAt:now()+24*3600_000,
                attempts:0,status:'pending',expressed:false};
            }
            await persist(db);
            journalPending(uid,person.pendingLifeAction,'queued');
            deferred+=messages.length;
            continue;
          }
          if(decision.action!=='reply'||!decision.messages.length||decision.messages.length>3){failed++;logger.warn?.(`DM AI returned an invalid reply-bubble count for uid=${uid}`);continue;}
          let replyMessages=normalizeMessageBurst(decision.messages,{maxMessages:opt.p6Enabled?opt.p6MaxBubbles:1,maxChars:450,minMessages:1});
          // Legacy stranger consent was a single response per incoming turn, not a burst.
          if(stranger&&opt.legacyStrangerOnce)replyMessages=replyMessages.slice(0,1);
          p6LastTurn={at:now(),status:'prepared',proposed:decision.messages.length,planned:replyMessages.length,confirmed:0,
            reason:opt.p6Enabled===false?'p6-disabled':stranger&&opt.legacyStrangerOnce?'legacy-single-reply':decision.messages.length>replyMessages.length?'configured-cap':'model-chosen-count'};
          db.p6LastTurn=p6LastTurn;
          // 发送前最后一道授权状态保护，避免模型模仿历史话术反复索要申请暗号。
          if (isApproved) {
            replyMessages=replyMessages.filter(text=>!repeatedInvite(text,opt.approvalPhrase));
            if(!replyMessages.length){markMessagesSeen(person,messages);appendIncomingHistory(person,messages,opt.historyLimit);await persist(db);ignored+=messages.length;continue;}
          }
          // No programmatic appending of invitations/catchphrases to model text.
          // Shared per-recipient factual claims gate, BEFORE reserving a send.
          // A rejected draft is not an attempted platform send and never changes
          // the inbox cursor into an uncertain remote receipt.
          let factualFailure='';
          for(const reply of replyMessages){
            if(reply.length>450||!validateSocialReplyText(reply).ok){factualFailure='回复超过长度限制或包含未经授权的主动@';break;}
            const factual=verifyLifeOutbound(reply,{channel:'dm',uid,
              events:getVerifiedFacts({uid,channel:'dm'}),ownerText:messages.map(m=>m.text).join(' '),at:now()});
            if(!factual.ok){factualFailure=factual.reason;break;}
          }
          if(factualFailure){
            p6LastTurn={...p6LastTurn,status:'error',reason:'factual-or-safety-gate'};db.p6LastTurn=p6LastTurn;await persist(db);
            failed++;logger.warn?.('DM 回复未通过发送前核验：'+factualFailure);continue;
          }
          // The model may take several seconds. If a newer message arrived
          // while it was thinking, leave this turn unseen and let the next
          // poll reconsider the combined conversation instead of sending stale text.
          try{
            const freshRaw=await fetchIncoming({probeOnly:true,forceUid:uid});
            if(hasUnseenIncoming(freshRaw,uid,me,person,messages.map(m=>m.id))){deferred+=messages.length;continue;}
          }catch(e){failed++;logger.warn?.('DM 发送前无法复核最新来信，本轮不发送：'+String(e?.message||e).slice(0,100));continue;}
          // Mark each inbound message before sending. A crash after remote success
          // must never trigger a duplicate automated message on process restart.
          person.lastTopicState=decision.topicState;
          const previousStrangerState=person.stranger?{...person.stranger}:null;
          const previousApprovalReplyStatus=person.approval?.reply?.status||'';
          if (stranger) person.stranger = { status: 'pending', count: count + 1, reservedAt: now(), sourceMessageId: latest.id };
          // 远端可能已发送成功但回执丢失：发送前持久化占位，避免重启后重复私信。
          if (approvalQueued) { person.approval.reply.status = 'reserved'; person.approval.reply.reservedAt = now(); }
          markMessagesSeen(person,messages);
          appendIncomingHistory(person,messages,opt.historyLimit);
          await persist(db);
          let remoteAttempted=false,sentThisTurn=0,deliveryPartial=false;
          let postSendStage='not-eligible'; // privacy-safe phase only; no text or UID
          try {
            const eventBase=messages.map(m=>String(m.id||'').slice(0,80)).join('|');
            const delivery=await deliverMessageBurst({messages:replyMessages,
              // A minority of eligible, confirmed turns may receive ONE extra
              // reflection call; relation cooldown is durable and shared.
              nextMessage:mayUnpromptedContinue(decision.topicState)&&opt.p6Enabled&&replyMessages.length<opt.p6MaxBubbles&&
                typeof generateContinuation==='function'&&!(stranger&&opt.legacyStrangerOnce)
                ?async({previous})=>{
                  const freshRaw=await fetchIncoming({probeOnly:true,forceUid:uid});
                  if(hasUnseenIncoming(freshRaw,uid,me,person)){postSendStage='cancelled-new-incoming';return '';}
                  const currentAccount=cleanUid(typeof selfUid==='function'?selfUid():selfUid);
                  if(!currentAccount||currentAccount!==me)return '';
                  const ticket=naturalThought.tryAcquire({account:currentAccount,peer:uid,stage:getRelationshipStage(uid)});
                  if(!ticket.ok){postSendStage=ticket.reason;return '';}
                  postSendStage='after-last-confirmed-reconsidered';
                  const extra=await generateContinuation({uid,first:previous,thoughtCue:decision.continuation.thoughtCue,
                    recent:latest.text,history:person.history.slice(-8),socialOwnerProof:decision.socialOwnerProof,
                    lifeWillingnessProof:decision.lifeWillingnessProof});
                  if(!extra||!validateSocialReplyText(extra).ok){postSendStage='stopped-or-invalid';return '';}
                  const factual=verifyLifeOutbound(extra,{channel:'dm',uid,
                    events:getVerifiedFacts({uid,channel:'dm'}),ownerText:messages.map(m=>m.text).join(' '),at:now()});
                  postSendStage=factual.ok?'after-first-confirmed-generated':'blocked-by-factual-gate';
                  return factual.ok?extra:'';
                }:undefined,
              beforeSend:async({index})=>{
                const currentOpt=resolveOptions(getConfig());
                if(index>0&&(!currentOpt.p6Enabled||index>=currentOpt.p6MaxBubbles))return {ok:false,reason:'new-message-or-config-changed'};
                const currentPermission=dmPermission(uid,person,currentOpt,{checkUnresolved:false,strangerRepliesOverride:count});
                const currentTrusted=currentPermission.trusted;
                if(!currentPermission.allowed)return {ok:false,reason:'发送前权限已变化，停止剩余气泡'};
                if(sent>=currentOpt.maxPerPoll||(!currentTrusted&&(db.sentAt.filter(t=>t>now()-3600_000).length>=currentOpt.maxPerHour
                  ||(currentOpt.maxPerDay>0&&db.sentAt.length>=currentOpt.maxPerDay))))return {ok:false,reason:'发送额度已达到，停止剩余气泡'};
                if(index===0&&now()-person.lastRepliedAt<currentOpt.whitelistCooldownMs)return {ok:false,reason:'收件人冷却时间尚未结束'};
                if(index>0){
                  const freshRaw=await fetchIncoming({probeOnly:true,forceUid:uid});
                  if(hasUnseenIncoming(freshRaw,uid,me,person))return {ok:false,reason:'new-message-or-config-changed'};
                }
                return {ok:true};
              },
              send:async({text,index})=>{
                remoteAttempted=true;
                return send({uid,text,eventId:`${eventBase}:bubble:${index+1}`,socialOwnerProof:decision.socialOwnerProof,lifeWillingnessProof:decision.lifeWillingnessProof});
              },
              onConfirmed:async({text})=>{
                person.history.push({role:'assistant',text,at:now()});
                retainHistory(person,opt.historyLimit,now());
                person.lastRepliedAt=now();db.sentAt.push(now());sent++;sentThisTurn++;
                noteActive(uid);
                if(sentThisTurn>=2&&postSendStage==='after-first-confirmed-generated')postSendStage='post-send-confirmed';
                p6LastTurn={...p6LastTurn,confirmed:sentThisTurn,postSendStage};db.p6LastTurn=p6LastTurn;
                await persist(db);
              }});
            sentThisTurn=delivery.confirmed;
            const interrupted=delivery.status==='partial';deliveryPartial=interrupted;
            if(['unknown','partial-unknown'].includes(delivery.status))throw new Error(delivery.stopReason||'send outcome unknown');
            if(['blocked','failed'].includes(delivery.status))throw new Error(delivery.stopReason||'preflight failed');
            p6LastTurn={...p6LastTurn,status:delivery.status==='confirmed'?'confirmed':'partial',
              reason:delivery.stopReason||p6LastTurn.reason,confirmed:delivery.confirmed,planned:delivery.planned,postSendStage};db.p6LastTurn=p6LastTurn;
            if (stranger&&sentThisTurn>0) person.stranger.status = 'sent';
            if (approvalQueued&&sentThisTurn>0) { person.approval.reply.status = 'sent'; person.approval.reply.sentAt = now(); }
            if(approved&&sentThisTurn>0){
              const u=person.approvedUsage;
              u.total++;u.daily++;
            }
            await persist(db);
            // P6-B: after an actual reply, a separate *model-initiated* idle
            // reconsideration may be reserved for an unfinished conversation.
            // This is not triggered simply by the recipient being silent.
            // The one-shot ledger purpose ensures no followup loop on wakeup.
            const currentP6=resolveOptions(getConfig());
            const idleRequested=decision.idleReconsiderMinutes>0 &&
              ['open-conversation','explicit-check-back'].includes(decision.idleReconsiderReason);
            const followMinutes=decision.followUpMinutes|| (idleRequested?decision.idleReconsiderMinutes:0);
            if(followMinutes){
              const eligible=mayUnpromptedContinue(decision.topicState)&&dmConversationPhase(latest.text)!=='closed'&&!deliveryPartial&&
                !(stranger&&currentP6.legacyStrangerOnce)&&currentP6.p6Enabled
              const purpose=decision.followUpMinutes?'delayed-supplement':'silence-reconsideration'
              let result={ok:false,reason:'p6-not-eligible'}
              if(eligible)try{result=scheduleContinuity(continuity,{uid,
                sourceEventId:`${latest.id}:${purpose}`,purpose,minutes:followMinutes})}
              catch(e){logger.warn?.('DM P6 预约账本不可用：'+String(e?.message||e).slice(0,80))}
              p6LastTurn={...p6LastTurn,reconsideration:result.ok?'scheduled':'not-scheduled',
                reason:result.ok?'model-chose-'+purpose:String(result.reason||'schedule-unavailable').slice(0,70)}
              db.p6LastTurn=p6LastTurn;await persist(db)
              if(!result.ok)logger.warn?.(`DM P6 ${purpose} not scheduled: ${result.reason||'schedule-unavailable'}`)
            }else{
              p6LastTurn={...p6LastTurn,reconsideration:'not-requested'}
              db.p6LastTurn=p6LastTurn;await persist(db)
            }
            // The trusted reply model has already chosen the nextAction.
            // Only NEW dev.6 proposals are marked as confirmed single-intent;
            // legacy pending proposals were merely suggestions for a later AI
            // vote, and MUST NOT be upgraded into automatic platform actions.
            if(sentThisTurn>0&&!deliveryPartial&&decision.nextAction&&typeof onVerifiedReply==='function'){
              // Keep a bounded follow-on intention in ORIGINAL private DM state.
              // Reevaluate only after the separate Life cross-action cooldown.
              person.pendingLifeAction={action:decision.nextAction.action,
                reason:String(decision.nextAction.reason||'').slice(0,160),
                sourceMessageId:String(latest.id).slice(0,150),intentProtocol:2,dueAt:now()+75_000,
                expiresAt:now()+24*3600_000,attempts:0,status:'pending'};
              await persist(db);
              journalPending(uid,person.pendingLifeAction,'queued');
            }
          } catch (e) {
            // If the server accepted a DM but the response was lost, retrying would duplicate it.
            p6LastTurn={...p6LastTurn,status:'error',reason:remoteAttempted?'send-unverified-or-gated':'preflight-failed',confirmed:sentThisTurn};db.p6LastTurn=p6LastTurn;
            if (stranger&&remoteAttempted) person.stranger.status = 'uncertain';
            else if(stranger&&!remoteAttempted){if(previousStrangerState)person.stranger=previousStrangerState;else delete person.stranger;}
            if (approvalQueued) person.approval.reply.status = remoteAttempted?'uncertain':(previousApprovalReplyStatus||'queued');
            if(approved&&sentThisTurn>0){const u=person.approvedUsage;u.total++;u.daily++;}
            await persist(db);
            failed++;
            logger.warn?.(`DM send uncertain/failed for uid=${uid}: ${String(e?.message || e)}`);
          }
        }
        // P6-A/B: delayed supplements and silence reconsiderations are only
        // intentions. A due item is claimed once, then the current inbox,
        // Life Voice, relationship, consent and quotas are checked again.
        let dueEntries=[];
        try{dueEntries=continuity.due({limit:10,channels:['dm']})}catch(e){logger.warn?.('私信续聊账本暂不可读，本轮不执行延迟发送：'+String(e?.message||e).slice(0,100))}
        for(const entry of (resolveOptions(getConfig()).p6Enabled===false?[]:dueEntries)){
          let claim;
          try{claim=continuity.claim(entry.id)}catch(e){logger.warn?.('私信续聊预约领取失败：'+String(e?.message||e).slice(0,100));continue;}
          if(!claim.ok)continue;
          const uid=entry.uid,person=db.people[uid];
          // Recheck revocable conversation boundary on every delayed wakeup.
          try{if(canContinue(uid,'dm')!==true){continuity.settle(entry.id,{outcome:'cancelled'});continue}}
          catch{try{continuity.settle(entry.id,{outcome:'cancelled'})}catch{}continue}
          const settle=(outcome,receiptId='')=>{try{return continuity.settle(entry.id,{outcome,receiptId})}catch(e){logger.warn?.('私信续聊结果写回失败：'+String(e?.message||e).slice(0,100));return {ok:false}}};
          // A failed *read-only* inbox recheck is not evidence that the
          // conversation ended. Retry a bounded number of times, before any
          // attempted send. Unknown remote sends never enter this branch.
          const retryInboxProbe=()=>{
            try{if(continuity.retryPreflight(entry.id,{delayMs:5*60000}).ok)return true}
            catch(e){logger.warn?.('私信续聊安全重试入账失败：'+String(e?.message||e).slice(0,100))}
            settle('cancelled');return false;
          };
          if(!person){settle('skipped');continue;}
          const currentOpt=resolveOptions(getConfig());
          const permission=dmPermission(uid,person,currentOpt);
          const trusted=permission.trusted,isApproved=permission.approved,allowed=permission.allowed,count=permission.count;
          const stranger=!trusted&&!isApproved;
          if(stranger&&currentOpt.legacyStrangerOnce){settle('cancelled');continue;}
          if(!allowed){settle('cancelled');continue;}
          const lastUser=[...(person.history||[])].reverse().find(x=>x?.role==='user'&&String(x.text||'').trim());
          if(!lastUser){settle('skipped');continue;}
          // Pending legacy appointments cannot reopen a conversation the model
          // explicitly settled in the originating reply.
          if(person.lastTopicState==='settled'||person.lastTopicState==='waiting'){settle('cancelled');continue;}
          try{
            const freshRaw=await fetchIncoming({probeOnly:true,forceUid:uid});
            if(hasUnseenIncoming(freshRaw,uid,me,person)){settle('cancelled');continue;}
          }catch(e){const retry=retryInboxProbe();logger.warn?.(`延迟私信复核未能读取最新收件箱，${retry?'安全延期重试':'重试已达上限，取消'}：`+String(e?.message||e).slice(0,100));continue;}
          if(sent>=currentOpt.maxPerPoll||(!trusted&&(db.sentAt.filter(t=>t>now()-3600_000).length>=currentOpt.maxPerHour
            ||(currentOpt.maxPerDay>0&&db.sentAt.length>=currentOpt.maxPerDay)))
            ||now()-person.lastRepliedAt<currentOpt.whitelistCooldownMs){settle('cancelled');continue;}
          if(typeof generateReply!=='function'){settle('skipped');continue;}
          const history=entry.purpose==='silence-reconsideration'&&person.history.at(-1)?.role==='user'
            ?person.history.slice(0,-1):(currentOpt.historyLimit ? person.history.slice(-currentOpt.historyLimit) : []);
          let generated;
          try{
            generated=await generateReply({uid,messageId:`continuity:${entry.id}`,text:lastUser.text,messages:[lastUser.text],
              timestampMs:Number(lastUser.at)||now(),senderName:person.nickname,history,olderContext:dmOlderContextText(person),
              stranger,canSkip:true,authorization:isApproved?'approved':(trusted?'trusted':'stranger'),
              socialAutonomy:true,threadKey:`dm:${uid}`,trigger:'scheduled',continuity:{phase:dmConversationPhase(lastUser.text)},scheduledPurpose:entry.purpose,allowTodoIntake:false});
          }catch(e){
            // A provider 429/5xx or other model exception is NOT Life choosing silence.
            // No platform send has been attempted: keep a bounded retry in the
            // original account-scoped intention, never clear DM seen or replay it.
            let retry=false;
            try{retry=continuity.retryPreflight(entry.id,{
              delayMs:/(?:\b429\b|\b50[234]\b|rate.?limit|saturat|provider|timeout|ETIMEDOUT|ENOTFOUND)/i.test(String(e?.message||e))?15*60000:5*60000,
              reason:'model-unavailable'}).ok}
            catch(error){logger.warn?.('延迟私信模型故障重试账本不可用：'+String(error?.message||error).slice(0,100))}
            if(!retry)settle('failed');
            failed++;
            logger.warn?.(`延迟私信自主复核模型失败（未发送），${retry?'已安排有界重试':'重试次数或时效到达上限，标记 failed 待诊断'}：`+String(e?.message||e).slice(0,120));
            continue;
          }
          const decision=normalizeGeneratedDecision(generated);
          if(decision.action==='skip'||decision.action==='close'||decision.action==='defer'||decision.action!=='reply'){
            p6LastTurn={at:now(),status:'reconsidered',proposed:0,planned:0,confirmed:0,
              reconsideration:'model-chose-'+decision.action,reason:'scheduled-model-decision'}
            db.p6LastTurn=p6LastTurn;await persist(db)
            settle(decision.action==='close'?'cancelled':'skipped');
            continue;
          }
          if(!decision.messages.length||decision.messages.length>3){settle('skipped');continue;}
          const replyMessages=normalizeMessageBurst(decision.messages,{maxMessages:currentOpt.p6Enabled?currentOpt.p6MaxBubbles:1,maxChars:450,minMessages:1});
          let invalid='';
          for(const reply of replyMessages){
            if(reply.length>450||!validateSocialReplyText(reply).ok){invalid='reply-text-invalid';break;}
            const factual=verifyLifeOutbound(reply,{channel:'dm',uid,events:getVerifiedFacts({uid,channel:'dm'}),ownerText:lastUser.text,at:now()});
            if(!factual.ok){invalid=factual.reason;break;}
          }
          if(invalid){settle('skipped');continue;}
          try{
            const freshRaw=await fetchIncoming({probeOnly:true,forceUid:uid});
            if(hasUnseenIncoming(freshRaw,uid,me,person)){settle('cancelled');continue;}
          }catch(e){const retry=retryInboxProbe();logger.warn?.(`延迟私信生成后复核失败，${retry?'安全延期重试':'重试已达上限，取消'}：`+String(e?.message||e).slice(0,100));continue;}
          // Recheck permission after model generation, immediately before reservation.
          const sendOpt=resolveOptions(getConfig()),sendTrusted=sendOpt.whitelist.has(uid),sendApproved=person.approval?.status==='approved';
          const sendPermission=dmPermission(uid,person,sendOpt,{strangerRepliesOverride:count});
          if(!sendPermission.allowed){settle('cancelled');continue;}
          if(sendApproved){
            const usage=person.approvedUsage??={total:0,day:todayOf(now()),daily:0};
            if(usage.day!==todayOf(now())){usage.day=todayOf(now());usage.daily=0;}
            if(usage.total>=sendOpt.approvedTotalLimit||usage.daily>=sendOpt.approvedDailyLimit){settle('cancelled');continue;}
          }
          const sendStranger=!sendTrusted&&!sendApproved;
          const previousStrangerState=person.stranger?{...person.stranger}:null;
          if(sendStranger)person.stranger={status:'pending',count:count+1,reservedAt:now(),sourceMessageId:`continuity:${entry.id}`};
          await persist(db);
          const receipts=[];let sentThisTurn=0,remoteAttempted=false,interrupted=false,alreadySettled=false;
          try{
            const delivery=await deliverMessageBurst({messages:replyMessages,
              // A minority of eligible, confirmed turns may receive ONE extra
              // reflection call; relation cooldown is durable and shared.
              nextMessage:mayUnpromptedContinue(decision.topicState)&&opt.p6Enabled&&replyMessages.length<opt.p6MaxBubbles&&
                typeof generateContinuation==='function'&&!(stranger&&opt.legacyStrangerOnce)
                ?async({previous})=>{
                  const freshRaw=await fetchIncoming({probeOnly:true,forceUid:uid});
                  if(hasUnseenIncoming(freshRaw,uid,me,person))return '';
                  const currentAccount=cleanUid(typeof selfUid==='function'?selfUid():selfUid);
                  if(!currentAccount||currentAccount!==me)return '';
                  if(!naturalThought.tryAcquire({account:currentAccount,peer:uid,stage:getRelationshipStage(uid)}).ok)return '';
                  const extra=await generateContinuation({uid,first:previous,thoughtCue:decision.continuation.thoughtCue,
                    recent:latest.text,history:person.history.slice(-8),socialOwnerProof:decision.socialOwnerProof,
                    lifeWillingnessProof:decision.lifeWillingnessProof});
                  if(!extra||!validateSocialReplyText(extra).ok)return '';
                  const factual=verifyLifeOutbound(extra,{channel:'dm',uid,
                    events:getVerifiedFacts({uid,channel:'dm'}),ownerText:messages.map(m=>m.text).join(' '),at:now()});
                  return factual.ok?extra:'';
                }:undefined,
              beforeSend:async({index})=>{
                const latestOpt=resolveOptions(getConfig());
                const latestPermission=dmPermission(uid,person,latestOpt,{checkUnresolved:false,strangerRepliesOverride:count});
                const latestTrusted=latestPermission.trusted;
                if(!latestPermission.allowed){
                  if(receipts.length){interrupted=true;return {ok:false,reason:'delayed-permission-revoked'}}
                  settle('cancelled');alreadySettled=true;return {ok:false,reason:'延迟发送前权限发生变化'}
                }
                if(sent>=latestOpt.maxPerPoll||(!latestTrusted&&(db.sentAt.filter(t=>t>now()-3600_000).length>=latestOpt.maxPerHour
                  ||(latestOpt.maxPerDay>0&&db.sentAt.length>=latestOpt.maxPerDay)))){
                  if(receipts.length){interrupted=true;return {ok:false,reason:'delayed-quota-reached'}}
                  settle('cancelled');alreadySettled=true;return {ok:false,reason:'延迟发送额度已达到'}
                }
                if(index>0){
                  const freshRaw=await fetchIncoming({probeOnly:true,forceUid:uid});
                  if(hasUnseenIncoming(freshRaw,uid,me,person)){interrupted=true;return {ok:false,reason:'new-message-arrived'}}
                }
                return {ok:true}
              },
              send:async({text,index})=>{
                remoteAttempted=true
                const result=await send({uid,text,eventId:`continuity:${entry.id}:bubble:${index+1}`,socialOwnerProof:decision.socialOwnerProof,lifeWillingnessProof:decision.lifeWillingnessProof})
                if(result!==true&&result?.ok!==true)return result
                const receipt=String(result?.receiptId||'')
                if(!receipt)return {ok:false,error:'远端成功响应缺少可核实投递回执'}
                return {...(result===true?{ok:true}:result),receiptId:receipt}
              },
              onConfirmed:async({text,result})=>{
                receipts.push(String(result?.receiptId||''))
                person.history.push({role:'assistant',text,at:now()})
                retainHistory(person,currentOpt.historyLimit,now())
                person.lastRepliedAt=now();db.sentAt.push(now());sent++;sentThisTurn++
                await persist(db)
              }})
            sentThisTurn=delivery.confirmed
            if(['unknown','partial-unknown'].includes(delivery.status))throw Error(delivery.stopReason||'delayed send outcome unknown')
            if(delivery.status==='blocked'||delivery.status==='failed'){
              if(!alreadySettled)settle('cancelled')
              continue
            }
            if(delivery.status==='partial')interrupted=true
            if(sendStranger&&sentThisTurn>0)person.stranger.status='sent'
            if(sendApproved&&sentThisTurn>0){const usage=person.approvedUsage??={total:0,day:todayOf(now()),daily:0};if(usage.day!==todayOf(now())){usage.day=todayOf(now());usage.daily=0;}usage.total++;usage.daily++;}
            await persist(db)
            p6LastTurn={at:now(),status:'reconsidered',proposed:decision.messages.length,
              planned:replyMessages.length,confirmed:sentThisTurn,
              reconsideration:'model-chose-reply',reason:delivery.status}
            db.p6LastTurn=p6LastTurn;await persist(db)
            settle('sent',receipts.join('|'))
          }catch(e){
            if(sendStranger&&remoteAttempted)person.stranger.status='uncertain'
            else if(sendStranger&&!remoteAttempted){if(previousStrangerState)person.stranger=previousStrangerState;else delete person.stranger}
            if(sendApproved&&sentThisTurn>0){const usage=person.approvedUsage??={total:0,day:todayOf(now()),daily:0};usage.total++;usage.daily++;}
            await persist(db)
            if(remoteAttempted)settle('uncertain')
            else if(!alreadySettled)settle('cancelled')
            failed++
            logger.warn?.(`延迟私信发送状态不确定 uid=${uid}: ${String(e?.message||e).slice(0,120)}`)
          }
        }
        // Cross-poll continuation is scoped to THIS verified sender. Never
        // replay an ambiguous follow after a process crash (reserved=terminal).
        if(typeof onVerifiedReply==='function')for(const [uid,person] of Object.entries(db.people)){
          const pending=person?.pendingLifeAction,t=now();
          if(!pending||pending.status!=='pending'||!Number.isSafeInteger(pending.dueAt))continue;
          if(pending.expiresAt<=t||pending.action!=='follow_dm_contact'||contactBoundary(person,me)?.status==='stop'){
            pending.status='cancelled';await persist(db);continue;
          }
          // An old pending nextAction was a proposal, NOT a final willingness.
          // It must never gain stronger platform authority simply by upgrading.
          if(pending.intentProtocol!==2){pending.status='cancelled';await persist(db);continue;}
          if(t<pending.dueAt||unprocessed.has(uid))continue;
          const permission=dmPermission(uid,person,resolveOptions(getConfig()),{checkUnresolved:true});
          // Do not turn the ordinary stranger DM reply quota into a follow
          // eligibility rule. Still honor revocation, stop-contact boundary,
          // previous uncertain DM delivery and the dedicated follow consent.
          if(!resolveOptions(getConfig()).enabled||
            contactBoundary(person,me)?.status==='stop'||
            permission.reason==='previous-send-unresolved'||
            (typeof canContinue==='function'&&canContinue(uid,'dm')!==true)){
            pending.status='cancelled';await persist(db);continue;
          }
          pending.status='reserved';await persist(db);
          let outcome;
          try{outcome=await onVerifiedReply({uid,messageId:pending.sourceMessageId,
            nextAction:{action:pending.action,reason:pending.reason},singleIntentVerified:pending.intentProtocol===2,
            history:person.history.slice(-80),optedOut:false,trusted:true,approved:permission.approved});}
          catch(e){outcome={ok:false,reason:'unknown'};logger.warn?.('私信 Episode 后续动作冻结：'+String(e?.message||e).slice(0,100));}
          if(outcome?.ok===true)pending.status='verified';
          else if(['life-cross-channel-rest','life-choice-in-progress'].includes(outcome?.reason)&&pending.attempts<2){
            pending.status='pending';pending.attempts++;pending.dueAt=t+90_000;
          }else pending.status=['platform-uncertain','unknown'].includes(outcome?.reason)?'unknown':'declined';
          await persist(db);
          journalPending(uid,pending,pending.status==='verified'?'verified':pending.status==='unknown'?'uncertain':
            pending.status==='pending'?'system_deferred':'blocked');
        }
        if(!fastUid&&typeof onScanSettled==='function')await onScanSettled();
        // A transient model failure during active conversation must not cause
        // a fresh full-model attempt every ten seconds. Keep inbound messages
        // unprocessed for a later safe retry, without classifying as silence.
        if(fastUid&&failed>0){const row=activeSessions.get(fastUid);if(row)
          row.cooldownUntil=Math.max(row.cooldownUntil||0,now()+60_000)}
        lastError = '';
        return { sent, failed, ignored, deferred, conversations: unprocessed.size };
      } finally { await leaveLock(); }
    } catch (e) {
      lastError = String(e?.message || e);
      if(fastUid){const row=activeSessions.get(fastUid);if(row)
        row.cooldownUntil=Math.max(row.cooldownUntil||0,now()+60_000)}
      logger.error?.(`DM poll failed: ${lastError}`);
      return { error: lastError };
    } finally { polling = false; }
  }

  const schedule = async () => {
    if (stopped) return;
    try { await poll(); }
    catch (e) { lastError = String(e?.message || e); logger.error?.(`DM scheduler error: ${lastError}`); }
    finally {
      if (!stopped) {
        let delay = 60_000;
        try { delay = resolveOptions(getConfig()).intervalMs; } catch (e) {
          lastError = String(e?.message || e);
        }
        timer = setTimeout(() => { void schedule(); }, delay);
        timer.unref?.(); // 后台轮询不能阻止 DSH 宿主正常退出
      }
    }
  };
  function start() {
    if (!stopped) return;
    stopped = false;
    // Start immediately to establish baseline, then poll per config.
    void schedule();
  }
  function stop() { stopped = true; if (timer) clearTimeout(timer); timer = undefined; }
  const status = () => {
    let p6={ok:false,reason:'account-not-verified'};
    try{
      const uid=cleanUid(typeof selfUid === 'function' ? selfUid() : selfUid);
      if(uid)p6=ledgerFor(uid).status({channels:['dm']});
    }catch(e){p6={ok:false,reason:'ledger-unavailable'};}
    return { enabled:resolveOptions(getConfig()).enabled, p6Enabled:resolveOptions(getConfig()).p6Enabled,
      fast:{activeCount:activeSessions.size,lastFastAt,checks:fastChecks,enabled:getConfig()?.dmActivePollEnabled!==false},
      running:!stopped, polling, lastPollAt, lastError, p6,
      p6LastTurn:p6LastAccountUid===cleanUid(typeof selfUid==='function'?selfUid():selfUid)?p6LastTurn:null };
  };
  // Read-only counters from the same send ledger as the actual DM limits.
  // This is the local calendar day, NOT the rolling 24h throttle window.
  async function quotaUsage() {
    try {
      const db=await load();const day=todayOf(now());
      const todayStart=new Date(day+'T00:00:00').getTime();
      const sentToday=(db.sentAt||[]).filter(t=>Number.isFinite(t)&&t>=todayStart&&t<=now()).length;
      const sent24h=(db.sentAt||[]).filter(t=>Number.isFinite(t)&&t>now()-86400_000&&t<=now()).length;
      const approvedPeople=Object.values(db.people||{}).filter(p=>p?.approval?.status==='approved');
      const perUser=approvedPeople.map(p=>({used:p?.approvedUsage?.day===day?Math.max(0,Number(p.approvedUsage.daily)||0):0}));
      return {ok:true,day,sentToday,sent24h,approvedPeople:approvedPeople.length,
        approvedDailyMaxUsed:Math.max(0,...perUser.map(p=>p.used)),
        approvedDailyTotalUsed:perUser.reduce((n,p)=>n+p.used,0)};
    }catch{return {ok:false,error:'私信本地发送账本暂不可读'}}
  }
  // Historical recovery is strictly an opt-in, read-only platform recheck plus
  // a single pending-application repair. It never replays old chats or advances
  // the ordinary inbox cursor. The caller supplies authenticated B站 rows.
  const recoveryAgeMs = 72 * 60 * 60_000;
  const recoveryMessages = async (uid = '') => {
    if (typeof fetchApprovalHistory !== 'function') throw new Error('当前版本缺少历史私信读取适配器');
    const raw = await fetchApprovalHistory(uid);
    if (!Array.isArray(raw)) throw new Error('历史私信接口未返回有效消息');
    const me=cleanUid(typeof selfUid === 'function' ? await selfUid() : selfUid);
    if (!me) throw new Error('未能核验当前 B站账号，拒绝补录');
    const current=now();
    return raw.map(x=>validIncoming(x,me)).filter(x=>x && (!uid || x.uid===uid)
      && x.id.startsWith(x.uid+':') && x.time<=current+60_000 && current-x.time>=0 && current-x.time<=recoveryAgeMs);
  };
  async function previewHistoricalApprovals(uid='') {
    uid=String(uid||'').trim();
    if (uid && !cleanUid(uid)) return {ok:false,error:'UID 不合法'};
    const opt=resolveOptions(getConfig());
    if (!opt.enabled || !opt.approvalEnabled) return {ok:false,error:'请先启用后台私信监听与陌生人聊天申请'};
    const db=await load();
    const rows=await recoveryMessages(uid);
    const candidates=new Map();
    for (const msg of rows) {
      if (opt.whitelist.has(msg.uid) || db.people[msg.uid]?.approval || !isDmApprovalBait(msg.text,opt.approvalPhrase)) continue;
      const old=candidates.get(msg.uid);
      if(!old || msg.time>old.time)candidates.set(msg.uid,msg);
    }
    return {ok:true,candidates:[...candidates.values()].sort((a,b)=>b.time-a.time).slice(0,30)
      .map(x=>({uid:x.uid,nickname:x.nickname,id:x.id,text:cleanString(x.text,100),time:x.time})),
      scannedMessages:rows.length,windowHours:72};
  }
  async function recoverHistoricalApproval(uid,messageId) {
    uid=cleanUid(uid);messageId=cleanString(messageId,150);
    if (!uid || !messageId.startsWith(uid+':')) return {ok:false,error:'UID 或原消息 ID 不合法'};
    const opt=resolveOptions(getConfig());
    if (!opt.enabled || !opt.approvalEnabled || opt.whitelist.has(uid))
      return {ok:false,error:'申请功能未启用，或此 UID 已有可信身份'};
    await mkdir(dataDir,{recursive:true});
    if (!await enterLock()) return {ok:false,error:'后台正在处理私信，请稍后再试'};
    try {
      const db=await load();
      if(db.people[uid]?.approval) return {ok:false,error:'该 UID 已有审核记录，不可覆盖原有审核结论'};
      // Re-fetch the exact message before writing; never trust the browser's
      // preview, a cached plaintext, or old locally archived conversations.
      const rows=await recoveryMessages(uid);
      const msg=rows.find(x=>x.id===messageId && x.uid===uid && isDmApprovalBait(x.text,opt.approvalPhrase));
      if (!msg) return {ok:false,error:'B站近期消息中未能重新核实这条投喂；不能凭历史缓存补录'};
      const person=personOf(db,uid);
      person.approval={status:'pending',requestedAt:now(),lastText:cleanString(msg.text,100),
        lastMessageId:msg.id,recoveredFrom:'verified-history',originalMessageAt:msg.time};
      if(msg.nickname)person.nickname=msg.nickname;
      markSeen(person,msg);
      await persist(db);
      return {ok:true,uid,status:'pending',message:'已补录为待审批；尚未授权、未自动回复'};
    } finally { await leaveLock(); }
  }
  async function listApprovals() {
    const db=await load();
    return Object.entries(db.people).filter(([uid,p])=>cleanUid(uid)&&p?.approval)
      .map(([uid,p])=>({uid,nickname:String(p?.nickname||'').slice(0,60),status:p.approval.status,requestedAt:p.approval.requestedAt||0,
        approvedAt:p.approval.approvedAt||0,lastText:cleanString(p.approval.lastText||'',100),
        autoReplyStatus:String(p.approval.reply?.status||''),autoReplyAt:Number(p.approval.reply?.sentAt||0),
        canResume:p.approval.status==='approved' && !p.approval.reply && !!p.approval.lastText
          && !(Number(p.approval.approvedAt)>0 && Number(p.lastRepliedAt)>=Number(p.approval.approvedAt)),
        total:Number(p.approvedUsage?.total||0),daily:Number(p.approvedUsage?.daily||0),day:p.approvedUsage?.day||''}))
      .sort((a,b)=>(b.requestedAt||0)-(a.requestedAt||0));
  }
  /** 只读身份查询的本地补齐：每次最多查少量公开资料，失败缓存6小时，不影响私信投递。 */
  async function fillNicknames(limit=2) {
    if(typeof lookupNickname!=='function')return {updated:0,skipped:true};
    await mkdir(dataDir,{recursive:true});
    if(!await enterLock())return {updated:0,skipped:true};
    try {
      const db=await load();let queried=0,updated=0;
      const people=Object.entries(db.people||{}).filter(([uid,p])=>cleanUid(uid)&&!p.nickname)
        .sort((a,b)=>Number(b[1].lastRepliedAt||0)-Number(a[1].lastRepliedAt||0));
      for(const [uid,p] of people){
        if(queried>=Math.max(1,Math.min(3,Number(limit)||2)))break;
        if((nicknameNextCheck.get(uid)||0)>now())continue;
        nicknameNextCheck.set(uid,now()+10*60_000);queried++;
        try {const name=cleanString(await lookupNickname(uid),60).replace(/[<>\r\n]/g,'');
          if(name){p.nickname=name;updated++;nicknameNextCheck.set(uid,now()+6*3600_000);}
        } catch{}
      }
      if(updated)await persist(db);
      return {updated,queried};
    }finally{await leaveLock();}
  }
  async function listRecentConversations(limit=30) {
    const db=await load(),config=getConfig(),opts=resolveOptions(config);
    const max=clamp(limit,1,50,30);
    return Object.entries(db.people||{}).map(([uid,original])=>{
      const p={...original,history:original?.history,olderContext:original?.olderContext};
      const context=pruneDmContext(p,{atNow:now(),historyLimit:opts.historyLimit});
      const history=p.history;
      const recent=history.slice(-6).map(x=>({role:x?.role==='assistant'?'assistant':'user',text:cleanString(x?.text,240)}));
      const allowance=(opts.approvalEnabled||opts.legacyStrangerOnce)?opts.strangerMaxReplies:null;
      const uidRole=cleanUid(uid)===cleanUid(config.ownerUid)?'owner':opts.whitelist.has(cleanUid(uid))?'trusted':p?.approval?.status==='approved'?'approved':'stranger';
      const used=Number.isInteger(p?.stranger?.count)?p.stranger.count:(p?.stranger?1:0);
      return {uid:cleanUid(uid),nickname:String(p?.nickname||'').slice(0,60),lastRepliedAt:Number(p?.lastRepliedAt||0),
        strangerStatus:String(p?.stranger?.status||''),approvalStatus:String(p?.approval?.status||''),approvalModeEnabled:opts.approvalEnabled,
        dmRole:uidRole,strangerRepliesUsed:used,strangerRepliesLimit:allowance,strangerRepliesRemaining:allowance==null?null:Math.max(0,allowance-used),
        seenCount:Array.isArray(p?.seen)?p.seen.length:0,
        contextEntries:context.historyCount,olderContextEntries:context.olderCount,
        staleContextEntries:context.historyRemoved+context.olderRemoved,recent};
    }).filter(x=>x.uid && (x.recent.length || x.approvalStatus))
      .sort((a,b)=>b.lastRepliedAt-a.lastRepliedAt).slice(0,max);
  }
  /** On-demand administrative cleanup. Never removes message deduplication,
   * authorization, opt-outs or outbound receipts. Does not call the model/B站. */
  async function pruneExpiredContext(){
    await mkdir(dataDir,{recursive:true});
    if(!await enterLock())return {ok:false,error:'后台私信正在运行，请稍后重试'};
    try{
      const db=await load(),summary=pruneAllConversationContext(db,resolveOptions(getConfig()));
      if(summary.changed)await persist(db);
      return {ok:true,...summary,contextDays:DM_CONTEXT_DAYS,olderDays:DM_OLDER_CONTEXT_DAYS};
    }finally{await leaveLock();}
  }
  async function contextGovernance(){
    const db=await load(),opt=resolveOptions(getConfig());
    let conversations=0,historyCount=0,olderCount=0,staleCount=0;
    for(const original of Object.values(db.people||{})){
      if(!original || typeof original!=='object')continue;
      const p={history:original.history,olderContext:original.olderContext};
      const r=pruneDmContext(p,{atNow:now(),historyLimit:opt.historyLimit});
      if(r.historyCount || r.olderCount || r.historyRemoved || r.olderRemoved)conversations++;
      historyCount+=r.historyCount;olderCount+=r.olderCount;staleCount+=r.historyRemoved+r.olderRemoved;
    }
    return {ok:true,scope:'background-dm-only',contextDays:DM_CONTEXT_DAYS,olderDays:DM_OLDER_CONTEXT_DAYS,
      conversations,historyCount,olderCount,staleCount,historyLimit:opt.historyLimit};
  }
  async function reviewApproval(uid,action) {
    uid=cleanUid(uid);
    if(!uid || !['approve','reject','revoke','resume'].includes(action)) return {ok:false,error:'UID 或操作不合法'};
    await mkdir(dataDir,{recursive:true});
    if(!await enterLock()) return {ok:false,error:'后台正在处理私信，请稍后再试'};
    try {
      const db=await load();const p=db.people[uid];
      if(!p?.approval) return {ok:false,error:'未找到申请记录'};
      if(action==='approve' && p.approval.status!=='pending') return {ok:false,error:'只能通过待审批申请'};
      if(action==='revoke' && p.approval.status!=='approved') return {ok:false,error:'只能撤销已通过的权限'};
      if(action==='resume') {
        // 已使用旧版本批准的用户没有排队字段，不可擅自批量给他们发私信。
        // 主人明确操作后才能补发，并拒绝重复排队或已有自动回复的申请。
        if(p.approval.status!=='approved' || p.approval.reply) return {ok:false,error:'只支持旧版本尚未生成首次回复的已批准申请'};
        if(Number(p.approval.approvedAt)>0 && Number(p.lastRepliedAt)>=Number(p.approval.approvedAt))
          return {ok:false,error:'批准后已有自动回复记录，不能补发'};
      } else p.approval.status=action==='approve'?'approved':'rejected';
      if(action==='approve') {
        p.approval.approvedAt=now();p.approvedUsage={total:0,day:'',daily:0};
        // 申请暗号早已被 seen 消费，必须在批准时重新建立一条持久化的待回复任务。
        // 兼容旧版没有 lastMessageId 的 pending 申请，不要求对方再发消息。
        p.approval.reply={status:'queued',text:cleanString(p.approval.lastText||resolveOptions(getConfig()).approvalPhrase||'🍚',100),
          sourceMessageId:cleanString(p.approval.lastMessageId||'',150),queuedAt:now()};
      } else if (action==='resume') {
        p.approval.reply={status:'queued',text:cleanString(p.approval.lastText||resolveOptions(getConfig()).approvalPhrase||'🍚',100),
          sourceMessageId:cleanString(p.approval.lastMessageId||'',150),queuedAt:now()};
      } else if (p.approval.reply?.status==='queued') {
        p.approval.reply.status='cancelled';
      }
      await persist(db);
      return {ok:true,uid,status:p.approval.status,autoReplyStatus:p.approval.reply?.status||''};
    }finally{await leaveLock();}
  }
  return { poll, nextFastUid, noteActive, start, stop, status, quotaUsage, listApprovals, listRecentConversations, contextGovernance, pruneExpiredContext, fillNicknames, reviewApproval, previewHistoricalApprovals, recoverHistoricalApproval, stateFile: file };
}
