import {projectLifeSocialInterests} from './life-system-integration.mjs'
import {normalizeRecallQueries,combineRecallContext} from './active-recall-contract.mjs'
/** Uniform, evidence-labeled Bilibili context construction. Does not authorize tools. */
const clean=(v,n=1100)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,n)
export function createSocialContextAssembler({policy,memoryRetriever,getMeme=async()=>'',getPersona=()=>'',getIdentity=()=>'',getRelationship=()=>'',getPortrait=()=>'',getPrivateLifeContext=()=>'',getLifeStateContext=()=>'',getPublicInterests=()=>[],videoContext=null,logger=console}={}){
 if(!policy)throw TypeError('social policy required')
 async function message(input={}, {mode='full',requested=[]}={}){
  const lazy=mode==='compact',wants=k=>!lazy||requested.includes(k)
  const uid=String(input.uid||''),actor=policy.actor(uid),kind=input.kind==='dm'?'dm':'comment',query=clean([input.text,input.context,input.olderContext,...(Array.isArray(input.history)?input.history.slice(-4).map(x=>x?.text):[])].filter(Boolean).join('\n'),1600)
  const recallQueries=normalizeRecallQueries(input.recallQueries)
  const recallRequest=input.recallRequest&&typeof input.recallRequest==='object'?{...input.recallRequest,queries:recallQueries}:null
  if(actor.role==='unverified')return {ok:false,role:'unverified',memoryContext:'',memeContext:'',identityContext:'',relationshipContext:''}
  let memoryContext='',memeContext='',identityContext='',relationshipContext='',portraitContext='',privateUnderstandingContext=''
  const loadErrors=[]
  if(!input.privacyGuard&&wants('memory'))try{
   if(lazy&&!recallQueries.length)throw Error('memory-query-missing')
   const search=lazy?(recallRequest&&(recallRequest.time||recallRequest.intent!=='topic_recall'||recallRequest.kinds?.length)?recallRequest:recallQueries):[query] // explicit legacy full-mode compatibility
   if(policy.memoryScope({uid,kind})==='owner-private'){
    const reads=[]
    for(const q of (Array.isArray(search)?search:[search])){
     const value=typeof memoryRetriever?.localContextAsync==='function'
      ?await memoryRetriever.localContextAsync(q,'chat')
      :memoryRetriever?.localContext(q,'chat')||''
     reads.push(value||'')
    }
    memoryContext=combineRecallContext(reads,{maxChars:1200})
   }else{
    const options={actorUid:uid,role:actor.role,excludeEventKey:input.incomingRpid&&input.bvid?`social:${uid}:${input.bvid}:${input.incomingRpid}`:'',currentBvid:input.bvid||'',maxItems:6,maxChars:1200}
    memoryContext=typeof memoryRetriever?.socialContextAsync==='function'
     ?await memoryRetriever.socialContextAsync(search,options)
     :memoryRetriever?.socialContext(search,options)||''
   }
   if(kind==='dm'&&['owner','friend'].includes(actor.role)){
    const privateContext=[]
    for(const q of (Array.isArray(search)?search:[search]))privateContext.push(await getPrivateLifeContext({uid,role:actor.role,query:q})||'')
    memoryContext=combineRecallContext([memoryContext,...privateContext],{maxChars:1400})
   }
   if(kind==='comment'&&['owner','friend'].includes(actor.role)){
    const privateResults=[]
    for(const q of (Array.isArray(search)?search:[search]))privateResults.push(await getPrivateLifeContext({uid,role:actor.role,query:q,publicUnderstanding:true})||'')
    privateUnderstandingContext=combineRecallContext(privateResults,{maxChars:750})
   }
  }catch(e){loadErrors.push('memory');logger.warn?.('社交记忆读取失败：'+clean(e?.message||e,130))}
  if(!input.privacyGuard&&kind==='comment'&&['owner','friend'].includes(actor.role)&&!privateUnderstandingContext)try{
   privateUnderstandingContext=String(await getPrivateLifeContext({uid,role:actor.role,query:'',publicUnderstanding:true,overviewOnly:true})||'').slice(0,320)
  }catch(e){loadErrors.push('private-understanding');logger.warn?.('私下熟悉度读取失败：'+clean(e?.message||e,100))}
  if(!input.privacyGuard&&wants('meme'))try{memeContext=String(await getMeme({...input,role:actor.role})||'')}catch(e){loadErrors.push('meme');logger.warn?.('梗知识读取失败：'+clean(e?.message||e,130))}
  if(!input.privacyGuard&&policy.canViewIdentity({uid,kind}))try{identityContext=String(getIdentity(uid,kind)||'')}catch{}
  if(!input.privacyGuard&&policy.canViewRelationship({uid,kind}))try{relationshipContext=String(getRelationship(uid,kind)||'')}catch{}
  // Dedicated evidence field: do not truncate away portrait behind a long
  // user-authored identity/relationship profile. Never duplicate Life Voice.
  if(!input.privacyGuard&&wants('portrait')&&['friend','stranger'].includes(actor.role))try{portraitContext=String(getPortrait(uid,kind)||'')}catch(e){loadErrors.push('portrait');logger.warn?.('好友交流证据读取失败：'+clean(e?.message||e,100))}
  let lifeStateContext='';if(kind==='dm')try{lifeStateContext=clean(getLifeStateContext({uid,role:actor.role,query}),780)}catch(e){logger.warn?.('私信生命状态上下文失败：'+clean(e?.message||e,100))}
  let publicInterestEvidence=[]
  if(!input.privacyGuard)try{publicInterestEvidence=projectLifeSocialInterests(getPublicInterests({uid,kind,role:actor.role}))}
  catch(e){loadErrors.push('public-interests');logger.warn?.('社交公开兴趣读取失败：'+clean(e?.message||e,100))}
  // Capabilities describe what this authenticated channel is *allowed to query*,
  // not whether today's indexed search happens to return a hit.
  const availableContexts=input.privacyGuard?[]:[
   ...(kind==='dm'?['todo','recommendation']:[]), 'memory',
   ...(['friend','stranger'].includes(actor.role)?['portrait']:[]),
   'meme', ...(kind==='comment'?['video']:[]), 'history'];
  return {ok:true,role:actor.role,lifeStateContext,publicInterestEvidence,memoryContext:clean(memoryContext,1400),privateUnderstandingContext:clean(privateUnderstandingContext,750),memeContext:clean(memeContext,1500),identityContext:clean(identityContext,900),relationshipContext:clean(relationshipContext,400),portraitContext:clean(portraitContext,800),availableContexts,loadErrors,query}
 }
 const batch=(items,options={})=>Promise.all((items||[]).map((item,i)=>message(item,{
  ...options,requested:options.requestedByIndex?.[i]||options.requested||[]
 })))
 async function comment(row={}){
  const uid=String(row.uid||''),actor=policy.actor(uid)
  if(actor.role==='unverified')return {ok:false,reason:'unknown-sender'}
  let video={usable:false,text:'',counts:{}}
  try{video=await videoContext?.forReply(row.bvid,{aid:row.aid,root:row.contextRoot||row.locationRoot||row.root,rpid:row.rpid,targetId:row.targetId,
   unresolvedNested:row.unresolvedNested===true,topLevel:row.topLevel===true,text:row.text,context:row.context,kind:row.kind,includeHot:true})||video}
  catch(e){logger.warn?.('可信评论视频上下文读取失败：'+clean(e?.message||e,130))}
  const enriched=clean([row.context,video.text].filter(Boolean).join('\n'),7500)
  const ctx=await message({kind:'comment',uid,text:row.text,context:enriched,bvid:row.bvid,incomingRpid:row.rpid,memeSourceText:row.context},{mode:'compact'})
  const persona=String(getPersona([{kind:'comment',uid,text:row.text,context:enriched}])||'').slice(0,3000)
  return {...ctx,video,persona,context:enriched,diagnostics:{video:video.usable===true,hot:video.counts?.hotProvided||0,thread:video.counts?.thread||0,memory:!!ctx.memoryContext,meme:!!ctx.memeContext}}
 }
 async function ownerDm({uid,text,history=[]}={}){
  if(policy.actor(uid).role!=='owner')return {ok:false,reason:'not-owner'}
  const ctx=await message({uid,kind:'dm',text,history},{mode:'compact'})
  return {...ctx,persona:String(getPersona([{kind:'dm',uid,text}])||'').slice(0,1500)}
 }
 return {message,batch,comment,ownerDm}
}
