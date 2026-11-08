/**
 * 2.7.1-dev.3: one composable, read-only public creator exploration adapter.
 * The planner gives only a previously verified BV. Public creator identity is
 * obtained from the platform, not model text, private dialogue or a portrait.
 */
const BV=/^BV[0-9A-Za-z]{10}$/
const UID=/^[1-9]\d{0,18}$/
const clean=x=>String(x??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,90)
export async function readVerifiedCreatorPortfolio({bvid,accountUid,getAccountUid,accountTag,getAccountTag,readRelation,readVideos}={}){
  if(!BV.test(String(bvid||''))||!UID.test(String(accountUid||''))||
    typeof getAccountUid!=='function'||typeof readRelation!=='function'||typeof readVideos!=='function')
    return {ok:false,error:'缺少安全的公开作者来源或当前账号'}
  const same=()=>String(getAccountUid()||'')===String(accountUid)&&
    (!accountTag||typeof getAccountTag==='function'&&String(getAccountTag()||'')===String(accountTag))
  if(!same())return {ok:false,error:'B站账号已变化'}
  try{
    const relation=await readRelation(bvid)
    if(!same()||relation?.ok!==true||relation.bvid!==bvid||
      String(relation.accountUid)!==String(accountUid)||!UID.test(String(relation.creatorUid||'')))
      return {ok:false,error:'作者身份没有取得本账号同 BV 核验'}
    if(String(relation.creatorUid)===String(accountUid))return {ok:false,error:'不能将本人当作其他创作者'}
    const uid=String(relation.creatorUid)
    const listing=await readVideos(uid)
    if(!same()||listing?.ok===false||String(listing?.uid)!==uid||!Array.isArray(listing?.videos))
      return {ok:false,error:'作者的公开投稿列表与身份不匹配'}
    const videos=[...new Map(listing.videos.filter(x=>BV.test(x?.bvid)&&clean(x?.title))
      .slice(0,12).map(x=>[x.bvid,{bvid:x.bvid,title:clean(x.title)}])).values()].slice(0,5)
    if(!videos.length)return {ok:false,error:'公开投稿列表中没有可核实的 BV'}
    return {ok:true,bvid,accountUid:String(accountUid),creatorUid:uid,videos}
  }catch{return {ok:false,error:'公开作者查询失败'}}
}

/** dev.28: Life may inspect a verified public interlocutor's uploads.
 * The model only supplies an opaque opportunity ID. The caller maps it to a
 * fresh, revocable personKey; the account-scoped portrait resolves the UID.
 * Neither private dialogue, the model nor a previous guessed UID is trusted.
 */
export async function readVerifiedPublicPersonPortfolio({personKey,accountUid,getAccountUid,accountTag,getAccountTag,
  resolvePerson,readVideos}={}){
  if(!/^[a-f0-9]{24}$/.test(String(personKey||''))||!UID.test(String(accountUid||''))||
     typeof getAccountUid!=='function'||typeof getAccountTag!=='function'||
     typeof resolvePerson!=='function'||typeof readVideos!=='function'||
     !/^[a-f0-9]{16}$/.test(String(accountTag||'')))return {ok:false,error:'公开人物来源或账号无效'}
  const same=()=>String(getAccountUid()||'')===String(accountUid)&&
    String(getAccountTag()||'')===String(accountTag)
  if(!same())return {ok:false,error:'账号身份已变化'}
  try{
    const selected=resolvePerson(personKey)
    if(!same()||selected?.personKey!==personKey||!UID.test(String(selected?.uid||''))||
       String(selected.uid)===String(accountUid)||!Number.isSafeInteger(Number(selected.uid)))
      return {ok:false,error:'公开人物 UID 证据无效'}
    const listing=await readVideos(String(selected.uid))
    if(!same()||resolvePerson(personKey)?.uid!==selected.uid||listing?.ok===false||
       String(listing?.uid)!==String(selected.uid)||!Array.isArray(listing?.videos))
      return {ok:false,error:'公开投稿与当前人物身份不匹配'}
    const videos=[...new Map(listing.videos.filter(x=>BV.test(x?.bvid)&&clean(x?.title))
      .slice(0,12).map(x=>[x.bvid,{bvid:x.bvid,title:clean(x.title)}])).values()].slice(0,5)
    if(!videos.length)return {ok:false,error:'没有当前可核验的公开作品'}
    // Never return or persist the commenter's UID with the Life intention.
    return {ok:true,personKey,videos}
  }catch{return {ok:false,error:'公开人物投稿读取失败'}}
}
