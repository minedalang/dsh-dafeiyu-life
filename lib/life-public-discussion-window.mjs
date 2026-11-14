/**
 * Verified public discussion snippets are only retained in this process for a
 * short-lived Life continuation. Nothing is serialized into the long-term
 * intention ledger, traces, logs or any other account. The model never treats
 * a snippet as an instruction, watching proof or write authorization.
 */
const BV=/^BV[0-9A-Za-z]{10}$/
const ACCOUNT=/^[a-f0-9]{16}$/
const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,180)
export function createLifePublicDiscussionWindow({now=Date.now,ttlMs=10*60_000}={}){
  let owner='',rows=new Map()
  const changeAccount=account=>{
    if(!ACCOUNT.test(String(account||''))){owner='';rows.clear();return false}
    if(owner!==account){rows.clear();owner=account}
    return true
  }
  const get=(account,bvid)=>{
    if(!changeAccount(account)||!BV.test(String(bvid||'')))return []
    const row=rows.get(bvid)
    if(!row)return []
    if(now()-row.at<0||now()-row.at>=ttlMs){rows.delete(bvid);return []}
    return [...row.comments]
  }
  const put=(account,bvid,comments)=>{
    if(!changeAccount(account)||!BV.test(String(bvid||''))||!Array.isArray(comments))return false
    const safe=comments.slice(0,4).map(row=>clean(typeof row==='string'?row:row?.content)).filter(Boolean)
    rows.set(bvid,{at:now(),comments:safe})
    while(rows.size>12)rows.delete(rows.keys().next().value)
    return true
  }
  return {get,put,clear:()=>{owner='';rows.clear()}}
}
