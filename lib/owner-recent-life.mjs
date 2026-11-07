/** Current owner-only public-life recall for conversational questions, not an
 * action planner, archive search, or proof of full audio/video playback.
 * Callers must independently verify account binding before supplying rows.
 */
const BV=/^BV[0-9A-Za-z]{10}$/
const clean=(s,n=150)=>String(s??'').replace(/[\x00-\x1f\x7f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const day=t=>{const d=new Date(t);return Number.isFinite(d.getTime())?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:''}
export function isOwnerActivityQuestion(text='',history=[]){
  const q=clean(text,260)
  const focus=/(?:鱼鱼|大肥鱼|你|自己|今天|昨天|刚刚|最近|以前|曾经|妙评|发过|看过|选过|挑过|写过|发的)/
  const activity=/(?:评论|妙评|秒评|神评|热评|回复|视频|看过|看了|选过|挑过|发过|发的|作品|投稿|经历|干了什么)/
  if(focus.test(q)&&activity.test(q))return true
  // Consecutive tiny owner clarifications may refer to an already asked
  // personal-experience question; generic platform search alone is not one.
  if(/^(?:有吗|有\s*(?:妙|秒|神)评(?:吗)?|(?:妙|秒|神)评|有吗\s*有\s*(?:妙|秒|神)评(?:吗)?|你(?:的|发的|看过的)|我说的是你(?:的|看过的|发过的))\s*[？?。.]*$/.test(q))
    return (history||[]).slice(-4).some(x=>x.role==='user'&&focus.test(String(x.text||''))&&activity.test(String(x.text||'')))
  return false
}
export function ownerRecentLifeSnapshot({watched=[],comments=[],accountVerified=false,now=Date.now(),maxDays=3,oldestAt=0}={}){
  if(accountVerified!==true)return {available:false,reason:'account-not-verified'}
  const today=day(now),start=day(now-Math.max(1,Math.min(maxDays,7))*86400_000)
  // Global historical tables are not reliably UID-scoped. After a B站 account
  // switch, a day-only video row on the cutover day cannot be attributed to
  // either account. Discard such rows; precise comment rows must be newer.
  const cut=Number(oldestAt)>0&&Number.isFinite(Number(oldestAt))?Number(oldestAt):0
  const cutDay=cut?day(cut):''
  const videos=(Array.isArray(watched)?watched:[]).filter(x=>x?.picked===true&&BV.test(String(x.bvid))&&
    /^20\d\d-\d\d-\d\d$/.test(String(x.day||''))&&x.day>=start&&x.day<=today&&(!cut||x.day>cutDay))
    .sort((a,b)=>String(b.day).localeCompare(String(a.day)))
    .slice(0,5).map(x=>({day:x.day,bvid:x.bvid,title:clean(x.title||'',90),
      meaning:'视频入选记录；不证明看完、听过或自己发布'}))
  const replies=(Array.isArray(comments)?comments:[]).filter(x=>x?.hasReceipt===true&&
    BV.test(String(x.bvid||''))&&['top','reply'].includes(x.kind)&&
    /^20\d\d-\d\d-\d\d/.test(String(x.time||''))&&String(x.time).slice(0,10)>=start&&String(x.time).slice(0,10)<=today&&(!cut||Number.isFinite(Date.parse(x.time))&&Date.parse(x.time)>=cut))
    .sort((a,b)=>String(b.time).localeCompare(String(a.time))).slice(0,5)
    .map(x=>({time:clean(x.time,32),bvid:x.bvid,kind:x.kind==='top'?'原创顶层评论':'回复别人',
      text:clean(x.snippet,160),meaning:'本地真实发送回执；未在本轮回查平台可见性'}))
  return {available:true,day:today,videos,comments:replies,source:'当前已核验 B站账号的本地公开视频与评论账本'}
}
