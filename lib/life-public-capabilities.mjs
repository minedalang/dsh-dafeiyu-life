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
