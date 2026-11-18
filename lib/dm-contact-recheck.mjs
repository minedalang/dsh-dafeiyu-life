/** Read-only, bounded reconciliation of one Bilibili DM contact with the local ledger.
 * No decision is made from platform unread counts alone: an unread badge can
 * remain after the plugin recorded an incoming message and chose silence.
 * Private contents remain in the trusted caller; HTTP summaries must omit them.
 */
import {verifiedBiliImageUrl} from './incoming-image-vision.mjs';
const uidOf=x=>/^[1-9]\d{0,18}$/.test(String(x||''))?String(x):'';
const epochMs=x=>{const n=Number(x);return Number.isSafeInteger(n)&&n>0?(n<1e11?n*1000:n):0};
const detail={
  invalid:'联系人或登录账号无效',unknown:'尚无这位联系人的本地处理记录',
  'no-incoming':'平台近期消息中没有可确认的新来信',
  'unsupported-latest':'最新来信类型或图片回执暂不可确认，不能重播前一条消息',
  'out-of-window':'该消息超出72小时安全复核窗口，未自动重播',
  'platform-replied':'B站近期会话已存在更新的己方消息，避免重复回复',
  'local-replied':'本地已有该来信之后的确认发送记录，避免重复回复',
  'outcome-unknown':'存在未知发送结果或未完成的历史事务，需要人工核对',
  'already-reviewed':'这条消息已经被手动重新考虑，不能重复触发',
  'opted-out':'联系人曾要求停止私信，不能重新联系',
  'approval-pending':'联系人申请回复仍在排队或结果不确定',
  'disabled':'私信监听或总开关已关闭',
  'permission-denied':'当前私信发送授权不允许',
  eligible:'已找到近期未确认回复的来信，可以请求鱼鱼自主重新考虑',
};
export const dmContactRecheckMessage=(code)=>detail[code]||'核对未通过，未发起回复';

export function assessDmContactRecheck({uid,accountUid,person,rawMessages,now=Date.now(),enabled=true,permissionAllowed=true,maxAgeMs=72*3600_000}={}) {
  uid=uidOf(uid);accountUid=uidOf(accountUid);
  const base={ok:true,state:'',message:'',candidate:null,alreadySeen:false,checkedAt:now};
  const stop=state=>({...base,state,message:dmContactRecheckMessage(state)});
  if(!uid||!accountUid||uid===accountUid)return stop('invalid');
  if(!person||typeof person!=='object')return stop('unknown');
  if(!Array.isArray(rawMessages))return stop('invalid');
  // This adapter is authenticated and account-bound by the caller. Never
  // accept fabricated 'read status' from Bilibili's unread counter.
  const recent=rawMessages.map(m=>({...m,at:epochMs(m?.ts)}))
    .filter(m=>m.at>0&&m.at<=now+60_000);
  const incoming=recent.filter(m=>m.fromMe===false && m.key && [1,2,7,13,14].includes(Number(m.kind)||1)
      && String(m.text||'').trim() && m.text!=='[非文字消息]'&&m.text!=='[无法读取的图片消息]')
    .sort((a,b)=>a.at-b.at||String(a.key).localeCompare(String(b.key)));
  const latest=incoming.at(-1);
  if(!latest)return stop('no-incoming');
  if(Number(latest.kind)===2&&!verifiedBiliImageUrl(latest.imageUrl))return stop('unsupported-latest');
  const lastInbound=recent.filter(m=>m.fromMe===false&&m.key)
    .sort((a,b)=>a.at-b.at||String(a.key).localeCompare(String(b.key))).at(-1);
  if(lastInbound&&lastInbound.key!==latest.key)return stop('unsupported-latest');
  const candidate={uid,id:uid+':'+String(latest.key).slice(0,100),time:latest.at,
    text:String(latest.text).slice(0,4000),...(verifiedBiliImageUrl(latest.imageUrl)?{imageUrl:verifiedBiliImageUrl(latest.imageUrl)}:{})};
  const response={...base,candidate,alreadySeen:Array.isArray(person.seen)&&person.seen.includes(candidate.id),latestAt:candidate.time};
  const denied=state=>({...response,state,message:dmContactRecheckMessage(state),candidate:null});
  if(now-candidate.time>maxAgeMs)return denied('out-of-window');
  if(recent.some(m=>m.fromMe===true&&m.at>=candidate.time))return denied('platform-replied');
  if(Number(person.lastRepliedAt)>=candidate.time)return denied('local-replied');
  if(['pending','uncertain'].includes(person.stranger?.status)
     ||['reserved','uncertain'].includes(person.approval?.reply?.status)
     ||person.lastInboundOutcome?.status==='send-unknown' && Number(person.lastInboundOutcome?.inboundAt)>=candidate.time)
    return denied('outcome-unknown');
  const manual=person.manualRecheck;
  if(manual?.accountUid===accountUid&&manual?.sourceMessageId===candidate.id)
    return denied('already-reviewed');
  const boundary=person.dmContactBoundaries?.[accountUid]||person.dmContactBoundary;
  if(boundary?.status==='stop'&&(!boundary.accountUid||boundary.accountUid===accountUid))return denied('opted-out');
  if(person.approval?.reply?.status==='queued')return denied('approval-pending');
  if(!enabled)return denied('disabled');
  if(!permissionAllowed)return denied('permission-denied');
  return {...response,state:'eligible',message:dmContactRecheckMessage('eligible')};
}
