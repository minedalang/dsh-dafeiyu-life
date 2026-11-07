import {relevantSearchVideo} from './todo-search-context.mjs'
/**
 * Outbound links must be attributable to THIS received owner message or to a
 * successful read in the SAME agent turn. A cached search result is not proof.
 * This only validates URL provenance/metadata relevance; it does not assert
 * that the fish heard audio, watched the whole video or owns the upload.
 */
const LINKS=/(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]{10})(?![0-9A-Za-z])/ig
export function verifyOutboundVideoLinks(message='',{ownerText='',readRecords=[],musicRequest=false}={}){
  const links=[...String(message).matchAll(LINKS)].map(m=>m[1])
  if(!links.length)return {ok:true,checked:0}
  const own=String(ownerText||'')
  const known=new Map()
  for(const r of readRecords){
    if(r?.ok!==true)continue
    if(r.action==='search'||r.action==='recent_activity')for(const v of Array.isArray(r.videos)?r.videos:[]){
      if(/^BV[0-9A-Za-z]{10}$/.test(String(v?.bvid||''))){
        const entries=known.get(v.bvid)||[]
        entries.push({video:v,query:String(r.query||'')})
        known.set(v.bvid,entries)
      }
    }
    if(r.action==='watch'&&/^BV[0-9A-Za-z]{10}$/.test(String(r.bvid||''))) {
      // A successful explicit video read proves the BV was opened, not its
      // musical contents. Do not let it bypass music relevance verification.
      const entries=known.get(r.bvid)||[]
      entries.push({video:null,query:''})
      known.set(r.bvid,entries)
    }
  }
  for(const bvid of links){
    // The owner may quote a link without the assistant having independently
    // verified its content. An echo is not proof of watching/listening.
    if(own.includes(bvid))continue
    const entries=known.get(bvid)||[]
    const grounded=entries.some(({video,query})=>!musicRequest?true:
      video&&relevantSearchVideo(video,{topic:query,searchGoal:'music'}))
    if(!grounded)return {ok:false,checked:links.length,invalidBvid:bvid,reason:entries.length?'本轮结果无法证明该链接符合音乐主题':'链接没有本轮真实读取证据'}
  }
  return {ok:true,checked:links.length}
}
