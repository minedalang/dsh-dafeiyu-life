/** Owner-private, read-only recall vocabulary and evidence formatting.
 * This module never reads archives, grants actions, or accepts model-authored UIDs.
 */
const clean=(value,n=180)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const QUESTION=/(?:记得|记不记得|想起|回忆|之前|以前|曾经|上次|刚才|那句|这句|说过|聊过|夸过|妙评|秒评|神评|评论|回复|看过|发过|经历|发生过|记忆|你自己|你发的|你以前)/
const ACTION=/(?:妙评|秒评|神评|评论|回复|发过|夸过|赞过|视频|看过|挑过|选过|投稿|自己的经历|那句|这句)/
const NEGATIVE=/(?:请搜索全站|热门排行|今天的热搜|平台热门)/
export function ownerRecallQuestion(text='',history=[]){
 const q=clean(text,280)
 if(NEGATIVE.test(q))return false
 if(QUESTION.test(q))return true
 return /^(?:有吗|哪个|哪条|那句呢|这句呢|还有吗|妙评|秒评|神评|然后呢)[？?。！!\s]*$/.test(q)&&
   (history||[]).slice(-5).some(h=>h.role==='user'&&QUESTION.test(String(h.text||'')))
}
export function expandOwnerRecallQueries(text='',history=[]){
 let q=clean(text,160)
 if(/^(?:有吗|哪个|哪条|那句呢|这句呢|还有吗|妙评|秒评|神评)[？?。！!\s]*$/.test(q)){
   const prior=(history||[]).slice(-5).reverse().find(h=>h.role==='user'&&QUESTION.test(h.text||''))
   if(prior)q=clean(prior.text+' '+q,200)
 }
 const terms=[q]
 // A natural retrospective question may contain many generic tokens but one
 // exact title anchor ("上次给我推荐的那个 Deepseek 视频"). Give that anchor
 // its own lexical/embedding search route; never infer a BV from it alone.
 if(/(?:推荐|分享)/.test(q)){
   const anchor=q.slice(Math.max(q.lastIndexOf('推荐'),q.lastIndexOf('分享'))+2)
     .replace(/^(?:给我|过|的|给我的|给我过的)?(?:那个|这个|那条|这条|那部|这部)?\s*/,'')
     .replace(/(?:视频|作品|链接|网址|那条|那个)(?:[？?！!。\s].*)?$/,'').trim()
   if(anchor.length>=2&&anchor.length<=50&&!/^(?:上次|之前|以前|给我|我的|那个|那条)$/.test(anchor))terms.push(anchor)
 }
 if(/(?:妙评|秒评|神评|夸过|赞过|评论|回复|那句|这句)/.test(q))terms.push('评论 回复 评价 夸奖 赞美 互动 自己发过的话')
 if(/(?:视频|看过|挑过|选过|观看)/.test(q))terms.push('视频 入选 观看 探索 兴趣')
 if(/(?:朋友|认识|关系|一起聊)/.test(q))terms.push('社交 关系 好友 相处 交谈')
 return [...new Set(terms)].slice(0,3)
}
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
export function groundedOwnerAnswer({activity={},memories=[],question=''}={}){
 const comment=(activity?.available===true?activity.comments:[])?.find(c=>c?.text)
 if(comment)return `我翻到一条自己${comment.kind==='原创顶层评论'?'发过的评论':'回复过的话'}：“${clean(comment.text,145)}”。你说的妙评是这一类吗？`
 const memory=(Array.isArray(memories)?memories:[]).find(x=>x.summary)
 if(memory?.kind==='public-top-comment'||memory?.kind==='public-reply')return `我翻到这条已有发送回执的公开评论：“${clean(memory.summary,145)}”。但不能据此保证它现在还可见。`
 if(memory)return `我想起一条相关的记忆：${clean(memory.summary,150)}。我能确认的是这条记录，其他细节还得再找找。`
 if(ACTION.test(question))return '我翻了下自己的记录，暂时没找到能确定的那句评论。可能是更早的聊天，你记得里面有哪个词吗？'
 return '我现在没找到可靠的相关记忆。你再给我一点线索，我想接着找。'
}
