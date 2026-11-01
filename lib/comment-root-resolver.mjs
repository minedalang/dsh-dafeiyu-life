/** Distinguish verified comment thread lookup from Bili send-root semantics. */
const ID=v=>/^\d{1,20}$/.test(String(v??''))&&BigInt(String(v))>0n?String(v):''
export function resolveCommentCoordinates(entry={},rpid='',{kind='notice'}={}){
 let uriRoot='';for(const raw of [entry.uri,entry.native_uri]){
  if(typeof raw!=='string'||raw.length>1500)continue
  try{const u=new URL(raw);if(!((u.protocol==='https:'&&(u.hostname==='bilibili.com'||u.hostname.endsWith('.bilibili.com')))||(u.protocol==='bilibili:'&&u.hostname==='video')))continue
   uriRoot=ID(u.searchParams.get('comment_root_id'));if(uriRoot)break}catch{}
 }
 const rootId=ID(entry.root_id),targetId=ID(entry.target_id),replyId=ID(rpid)
 const top=String(entry.root_id??'')==='0'&&!targetId&&!uriRoot
 const topFromUri=uriRoot===replyId&&!targetId
 const topLevel=top||topFromUri
 const contextRoot=uriRoot||rootId||(topLevel?replyId:'')
 const sendRoot=topLevel?'':(uriRoot||rootId)
 return {locationRoot:contextRoot,locationSource:uriRoot?'bili-uri':rootId?'root-id':topLevel?'top':'unknown',
   contextRoot,sendRoot,targetId,topLevel,unresolvedNested:!contextRoot&&kind!=='top'}
}
