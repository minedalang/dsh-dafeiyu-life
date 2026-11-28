/** Owner-private, read-only recall vocabulary and evidence formatting.
 * This module never reads archives, grants actions, or accepts model-authored UIDs.
 */
const clean=(value,n=180)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
export function ownerRecallEvidence(rows=[],{maxItems=5,maxChars=1400}={}){
 const items=[];let used=0
 for(const row of Array.isArray(rows)?rows:[]){
   const item={id:clean(row?.id,100),kind:clean(row?.kind||row?.type,28),at:clean(row?.at,32),summary:clean(row?.summary||row?.text,290),source:clean(row?.source,38)}
   if(!item.id||!item.summary||used+item.summary.length>maxChars)continue
   items.push(item);used+=item.summary.length
   if(items.length>=maxItems)break
 }
 return items
}
export function groundedOwnerAnswer({activity={},memories=[]}={}){
 const comment=(activity?.available===true?activity.comments:[])?.find(c=>c?.text)
 if(comment)return `我翻到一条自己${comment.kind==='原创顶层评论'?'发过的评论':'回复过的话'}：“${clean(comment.text,145)}”。你说的妙评是这一类吗？`
 const memory=(Array.isArray(memories)?memories:[]).find(x=>x.summary)
 if(memory?.kind==='public-top-comment'||memory?.kind==='public-reply')return `我翻到这条已有发送回执的公开评论：“${clean(memory.summary,145)}”。但不能据此保证它现在还可见。`
 if(memory)return `我想起一条相关的记忆：${clean(memory.summary,150)}。我能确认的是这条记录，其他细节还得再找找。`
 return '我现在没找到可靠的相关记忆。你再给我一点线索，我想接着找。'
}
