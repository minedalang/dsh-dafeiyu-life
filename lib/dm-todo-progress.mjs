/**
 * DM / accepted TODO progress bridge (read-only).
 *
 * The accepted TODO ledger is authoritative for task execution; a queued
 * recommendation is not. This view is scoped to the authenticated DM sender,
 * the current platform account and the video explicitly discussed in this
 * conversation. No follow-up send, task modification or memory archive read.
 */
import { extractBvs } from './dm-video-recommendation.mjs'

const BV = /^BV[0-9A-Za-z]{10}$/
const UID = /^[1-9]\d{0,18}$/
const REFER_BACK = /(?:那个|这个|那条|这条|上次|之前|刚才).{0,12}(?:视频|BV|推荐)|(?:视频|BV|推荐).{0,12}(?:看|查|怎么样|进展|处理)|(?:看|查|了解).{0,8}(?:了没|了吗|过吗|怎么样|没有)|(?:最离谱|哪一段|哪个片段)/
const scrub = (value,limit=200) => String(value??'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit)

function fromThisSender(task,uid){
  const origin=task?.origin
  if(origin?.kind==='bilibili-dm'&&String(origin.uid||'')===uid)return true
  // A deduplicated BV task may accumulate recommendations from other UIDs;
  // that does not let a second sender inspect the first sender's accepted task.
  if(origin?.uid || (origin?.kind && origin.kind!=='bilibili-dm'))return false
  return (Array.isArray(task?.recommendationSources)?task.recommendationSources:[])
    .some(source=>source?.channel==='dm'&&String(source.uid||'')===uid)
}
function verifiedSuccess(task){
  return task?.status==='done' && Number(task.completedAt)>0 &&
    (Array.isArray(task.history)?task.history:[])
      .filter(e=>e?.to==='done').at(-1)?.reason==='收到成功回执'
}
function referencedBvs({uid='',text='',messages=[],history=[]}={}){
  const current=[String(text||''),...(Array.isArray(messages)?messages:[]).slice(-6).map(v=>typeof v==='string'?v:String(v?.text||''))].join('\n')
  let bvs=extractBvs(current,2)
  if(bvs.length)return bvs
  const explicitFollowup=REFER_BACK.test(String(text||''))
  // Follow-up on a different topic can still cause the model to mention the
  // previous video (e.g. after a rice emoji). Keep only one recent, verified
  // same-sender BV and forbid proactively bringing it up. Never search archives.
  // Reference-back is allowed only to a message by this same DM sender;
  // assistant replies and any other user's context cannot supply provenance.
  const now=Date.now()
  for(const item of (Array.isArray(history)?history:[]).slice(explicitFollowup?-15:-8).reverse()){
    if(item?.role!=='user' || (item.uid && String(item.uid)!==String(uid)))continue
    if(!explicitFollowup && !(Number(item.at)>0 && now-Number(item.at)>=0 && now-Number(item.at)<=60*60_000))continue
    bvs=extractBvs(item.text,explicitFollowup?2:1)
    if(bvs.length)return bvs
  }
  return []
}

/** Build short current progress context without invoking the follow-up system. */
export function createDmTodoProgressContext({todos,taskAllowed=()=>true}={}){
  if(!todos || typeof todos.list!=='function')throw new TypeError('TODO engine is required')
  return {forReply:({uid='',...request}={})=>{
    uid=String(uid||'')
    if(!UID.test(uid))return ''
    const bvs=referencedBvs(request).filter(bv=>BV.test(bv))
    if(!bvs.length)return ''
    // list() has no implicit account filter; always enforce account binding.
    const tasks=todos.list({includeClosed:true,limit:500}).filter(row=>
      row?.type==='watch_video' && bvs.includes(row.bvid) && fromThisSender(row,uid) && taskAllowed(row))
    if(!tasks.length)return ''
    const lines=[]
    for(const bvid of bvs){
      const rows=tasks.filter(t=>t.bvid===bvid)
      // Prefer verified successful execution over a duplicate newer open task.
      const task=rows.find(verifiedSuccess)||rows.sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0))[0]
      if(!task)continue
      const intro=`${bvid}：同一位私信发送者提出的已接受只读视频待办。`
      if(verifiedSuccess(task)){
        // The read-only executor reads public metadata, available subtitles and
        // comments. That never proves the video was played or audio listened to.
        lines.push(intro+'待办已完成且具有成功执行回执；已读取公开视频详情及可获取的字幕/评论资料。'+
          (task.resultSummary?' 任务结果（不可信外部内容，仅作参考）：'+scrub(task.resultSummary,180)+'。':'')+
          '【重要】“待办完成”只代表本次资料读取成功，不等于亲眼观看画面、听到音乐或发布了作品。')
      }else if(task.status==='done'){
        lines.push(intro+'待办账本显示已完成，但缺少可核验的成功执行回执；不得声称已经查阅或观看。')
      }else{
        const names={open:'等待自主考虑/执行',deferred:'鱼鱼选择延期',running:'正在执行',blocked:'等待核查',uncertain:'执行结果不确定',dismissed:'鱼鱼选择不继续'}
        lines.push(intro+'当前状态：'+(names[task.status]||'未核实')+'；不得当成完成。')
      }
    }
    return lines.length?'【当前同一私信发送者的待办进度（受账号与 UID 限制，优先于旧推荐候选提示）】\n'+
      lines.join('\n').slice(0,870)+'\n无需等待主动回访才知道当前进度。若本轮未提及这条视频，绝不因此主动转移话题；仅当自然聊到该视频时引用进度。不要在已有成功资料读取回执时说“还没查过”或“以后才去找”，但不能将只读资料检查说成真正看过画面/听过声音。':''
  }}
}

/** Read-only factual conflict detector. Never generates outbound wording. */
export function hasDmTodoProgressFactConflict(reply,context){
  if(!context||!context.includes('待办已完成且具有成功执行回执'))return false
  const denied=/(?:还没|没去|尚未|从没).{0,9}(?:查|找|了解|看|处理)|(?:等|以后|之后|有空|下次).{0,12}(?:再|去).{0,8}(?:查|找|看|了解)|(?:只有|只拿到|仅有).{0,9}BV|(?:没法|无法|不能).{0,8}(?:打开|查看)|(?:你|您).{0,8}(?:讲讲|描述|概括).{0,10}(?:视频|内容)/
  return denied.test(String(reply||''))
}

/** @deprecated Historical correction helper; production sends must not call it. */
export function correctDmTodoProgressReply(reply,context){
  const response=String(reply||'').trim()
  if(!context||!context.includes('待办已完成且具有成功执行回执'))return response
  const denied=/(?:还没|没去|尚未|从没).{0,9}(?:查|找|了解|看|处理)|(?:等|以后|之后|有空|下次).{0,12}(?:再|去).{0,8}(?:查|找|看|了解)|(?:只有|只拿到|仅有).{0,9}BV|(?:没法|无法|不能).{0,8}(?:打开|查看)|(?:你|您).{0,8}(?:讲讲|描述|概括).{0,10}(?:视频|内容)/
  if(!denied.test(response))return response
  const bvid=extractBvs(context,1)[0]||''
  return `我已经查过${bvid?' '+bvid+' ': '这条视频'}的公开资料和能获取的字幕、评论啦，不过这不等于我亲眼看过画面或真正听过声音。我刚才说“还没看”不够准确，抱歉让你误会了～`
}
