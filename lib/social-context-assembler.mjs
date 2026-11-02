/** Uniform, evidence-labeled Bilibili context construction. Does not authorize tools. */
const clean=(v,n=1100)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,n)
export function createSocialContextAssembler({policy,memoryRetriever,getMeme=async()=>'',getPersona=()=>'',getIdentity=()=>'',getRelationship=()=>'',getPrivateLifeContext=()=>'',videoContext=null,logger=console}={}){
 if(!policy)throw TypeError('social policy required')
 async function message(input={}){
  const uid=String(input.uid||''),actor=policy.actor(uid),kind=input.kind==='dm'?'dm':'comment',query=clean([input.text,input.context,input.olderContext,...(Array.isArray(input.history)?input.history.slice(-4).map(x=>x?.text):[])].filter(Boolean).join('\n'),1600)
  if(actor.role==='unverified')return {ok:false,role:'unverified',memoryContext:'',memeContext:'',identityContext:'',relationshipContext:''}
  let memoryContext='',memeContext='',identityContext='',relationshipContext=''
  try{
   memoryContext=policy.memoryScope({uid,kind})==='owner-private'
    ?memoryRetriever?.localContext(query,'chat')||''
    :memoryRetriever?.socialContext(query,{actorUid:uid,role:actor.role,excludeEventKey:input.incomingRpid&&input.bvid?`social:${uid}:${input.bvid}:${input.incomingRpid}`:'',currentBvid:input.bvid||'',maxItems:6,maxChars:1200})||''
   if(kind==='dm'&&['owner','friend'].includes(actor.role)){
    const privateContext=getPrivateLifeContext({uid,role:actor.role,query})||''
    if(privateContext)memoryContext=[memoryContext,privateContext].filter(Boolean).join('\n').slice(0,1450)
   }
  }catch(e){logger.warn?.('社交记忆读取失败：'+clean(e?.message||e,130))}
  try{memeContext=String(await getMeme({...input,role:actor.role})||'')}catch(e){logger.warn?.('梗知识读取失败：'+clean(e?.message||e,130))}
  if(policy.canViewIdentity({uid,kind}))try{identityContext=String(getIdentity(uid)||'')}catch{}
  if(policy.canViewRelationship({uid,kind}))try{relationshipContext=String(getRelationship(uid)||'')}catch{}
  return {ok:true,role:actor.role,memoryContext:clean(memoryContext,1400),memeContext:clean(memeContext,1500),identityContext:clean(identityContext,900),relationshipContext:clean(relationshipContext,400),query}
 }
 const batch=items=>Promise.all((items||[]).map(item=>message(item)))
 async function comment(row={}){
  const uid=String(row.uid||''),actor=policy.actor(uid)
  if(actor.role==='unverified')return {ok:false,reason:'unknown-sender'}
  let video={usable:false,text:'',counts:{}}
  try{video=await videoContext?.forReply(row.bvid,{aid:row.aid,root:row.contextRoot||row.locationRoot||row.root,rpid:row.rpid,targetId:row.targetId,
   unresolvedNested:row.unresolvedNested===true,topLevel:row.topLevel===true,text:row.text,context:row.context,kind:row.kind,includeHot:true})||video}
  catch(e){logger.warn?.('可信评论视频上下文读取失败：'+clean(e?.message||e,130))}
  const enriched=clean([row.context,video.text].filter(Boolean).join('\n'),7500)
  const ctx=await message({kind:'comment',uid,text:row.text,context:enriched,bvid:row.bvid,incomingRpid:row.rpid,memeSourceText:row.context})
  const persona=String(getPersona([{kind:'comment',uid,text:row.text,context:enriched}])||'').slice(0,3000)
  return {...ctx,video,persona,context:enriched,diagnostics:{video:video.usable===true,hot:video.counts?.hotProvided||0,thread:video.counts?.thread||0,memory:!!ctx.memoryContext,meme:!!ctx.memeContext}}
 }
 async function ownerDm({uid,text,history=[]}={}){
  if(policy.actor(uid).role!=='owner')return {ok:false,reason:'not-owner'}
  const ctx=await message({uid,kind:'dm',text,history})
  return {...ctx,persona:String(getPersona([{kind:'dm',uid,text}])||'').slice(0,1500)}
 }
 return {message,batch,comment,ownerDm}
}
