/**
 * Human-readable identity of a follow-up, derived from the accepted TODO ledger,
 * never from the model's own prose. This view does not resurrect faded memories:
 * it only identifies the request being answered, not what the fish remembers of
 * video content. No other recipient's private request is made visible.
 */
import {todoParentId} from './todo-lineage.mjs'
const BV=/\bBV[0-9A-Za-z]{10}\b/g
const clean=(v,n=100)=>String(v??'').replace(/[\x00-\x1f\x7f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const vague=/^(?:已汇总\s*\d+\s*项相关视频资料|已完成|公开视频|视频资料|几个视频|那个视频|查看视频|搜索视频|考虑看看别人推荐的视频|看看视频|查看资料)$/
const useful=v=>{const s=clean(v,85);return s.length>=3&&!vague.test(s)?s:''}
const sameOrigin=(task,row)=>String(task?.origin?.uid||'')===String(row?.uid||'')&&
  String(task?.origin?.messageId||'')===String(row?.originalMessageId||'')
export function resolveTodoFollowupContext(row={},tasks=[]){
  const all=Array.isArray(tasks)?tasks:[]
  const root=String(row.groupRoot||'')
  const task=all.find(t=>String(t.id)===String(row.taskId||''))
  const parent=root?all.find(t=>String(t.id)===root):task
  const siblings=root?all.filter(t=>todoParentId(t)===root):[]
  // A known parent with a different requester is not safe to quote or contact.
  if(parent?.origin?.uid&&(!sameOrigin(parent,row)))return {ok:false,reason:'父待办原请求者与回访收件人不一致'}
  if(root&&siblings.length&&siblings.some(t=>!sameOrigin(t,row)))return {ok:false,reason:'子待办来源与原始请求不一致'}
  // A legacy group with no parent is allowed only if the children still verify
  // the same original requester; generic group counts are NOT a subject.
  const subject=useful(parent?.title)||useful(parent?.topic)||useful(row.topic)||
    (!root?useful(task?.title)||useful(row.title):'')||
    (siblings.length?useful(siblings[0]?.topic):'')||''
  const videos=[...new Set((root?siblings:[task]).filter(Boolean).map(t=>clean(t.bvid,18)).filter(v=>/^BV[0-9A-Za-z]{10}$/.test(v)))]
  const fallback=!root&&/^BV[0-9A-Za-z]{10}$/.test(String(row.bvid||''))?String(row.bvid):''
  const resolved=subject||(videos[0]||fallback)
  if(!resolved)return {ok:false,reason:'缺少能识别原请求的待办主题，禁止发送模糊回访'}
  return {ok:true,subject:resolved,taskId:String(row.taskId||''),groupRoot:root,videos,
    completed:Number(row.groupDone)||0,total:Number(row.groupTotal)||0,
    originalMessageId:String(row.originalMessageId||'')}
}
export function anchorTodoFollowupText(text,context,{maxLength=400}={}){
  if(!context?.ok)return {ok:false,reason:context?.reason||'未找到可信原请求'}
  const body=clean(text,Math.max(400,maxLength))
  if(!body)return {ok:false,reason:'回访正文为空'}
  const mentioned=[...body.matchAll(BV)].map(m=>m[0])
  if(mentioned.length&&!mentioned.every(bv=>context.videos.includes(bv)||context.subject.includes(bv)))
    return {ok:false,reason:'回访文字提到与原请求无关的 BV'}
  const subject=clean(context.subject,75)
  // The natural reply is kept whenever it already gives the recipient a
  // recognizable subject. Otherwise add one short, factual orientation clause.
  const keywords=subject.replace(/[：:「」【】（）()·]/g,' ').split(/\s+/).filter(s=>s.length>=4)
  const grounded=body.includes(subject)||keywords.some(s=>body.includes(s))||
    (context.videos.length&&context.videos.some(bv=>body.includes(bv)))
  const prefix=grounded?'':`说起你之前提的「${subject}」——`
  if(prefix.length>=maxLength)return {ok:false,reason:'待办主题过长，无法安全补足背景'}
  const safe=(prefix+body).slice(0,maxLength).trim()
  return {ok:true,text:safe,anchored:!!prefix,subject}
}
