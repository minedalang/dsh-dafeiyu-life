/**
 * Accepted-task completion followups. A verified inbound message is provenance,
 * never authorization to change channels. Completion is evidence, not a demand
 * to contact someone. Legacy owner-todo-followups.json is preserved in place.
 */
import {randomUUID} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync,openSync,closeSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
const FILE='owner-todo-followups.json',MAX_BYTES=160_000,DAY=86400000
const BV=/^BV[0-9A-Za-z]{10}$/,UID=/^[1-9]\d{0,18}$/
const clean=(v,n=100)=>String(v??'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const validId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):0
const blank=()=>({version:1,items:[],lastSentAt:0,sentHistory:[]})
function read(dir){const file=join(dir,FILE);if(!existsSync(file))return blank()
  const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw Error('待办回访账本不安全')
  const d=JSON.parse(readFileSync(file,'utf8'))
  if(d?.version!==1||!Array.isArray(d.items))throw Error('回访账本结构错误')
  return {...blank(),...d,sentHistory:Array.isArray(d.sentHistory)?d.sentHistory.slice(-80):[]}
}
function save(dir,d){mkdirSync(dir,{recursive:true});const file=join(dir,FILE)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('回访账本不能是符号链接')
  // Old unfinished rows are never silently evicted to make room for new sends.
  if(d.items.length>300){const closed=d.items.filter(x=>!['pending','sending','uncertain'].includes(x.status));
    for(const row of closed.slice(0,d.items.length-300))d.items.splice(d.items.indexOf(row),1)
    if(d.items.length>300)throw Error('回访队列已满，禁止挤掉未处理记录')}
  d.sentHistory=(d.sentHistory||[]).slice(-80)
  const tmp=file+'.'+process.pid+'.'+randomUUID()+'.tmp'
  writeFileSync(tmp,JSON.stringify(d,null,2)+'\n',{mode:0o600});renameSync(tmp,file)
}
const ownerTask=task=>String(task?.origin?.kind||'').startsWith('owner-')||String(task?.sourceKey||'').startsWith('owner-ai-watch:')
function recipients(task){
  const out=[]
  const add=(src,channel,owner)=>{
    const uid=String(src?.uid||''),messageId=clean(src?.messageId,150)
    if(!UID.test(uid)||!messageId||!['dm','comment'].includes(channel))return
    if(!owner&&!['bilibili-comment','bilibili-dm'].includes(String(src?.kind||'')))return
    if((src.kind==='bilibili-comment')!==(channel==='comment')&&!owner)return
    const row={uid,channel,social:!owner,originalMessageId:messageId,
      commentBvid:channel==='comment'&&BV.test(String(src.commentBvid||''))?String(src.commentBvid):'',
      commentRpid:channel==='comment'?validId(src.commentRpid):0,
      commentRoot:channel==='comment'?validId(src.commentRoot):0}
    if(channel==='comment'&&(!row.commentBvid||!row.commentRpid))return
    if(!out.some(x=>x.uid===uid&&x.channel===channel&&x.originalMessageId===messageId))out.push(row)
  }
  const source=task?.origin||{},owner=ownerTask(task)
  add(source,source.kind==='bilibili-comment'?'comment':'dm',owner)
  for(const s of (Array.isArray(task?.recommendationSources)?task.recommendationSources:[]).slice(0,30)){
    const kind=s.channel==='comment'?'bilibili-comment':'bilibili-dm'
    add({...s,kind},s.channel==='comment'?'comment':'dm',false)
  }
  return out
}
const messageOf=r=>r.type==='search_videos'
  ?`🐟 之前你邀请我搜索「${clean(r.topic,42)}」，我已经查了相关公开视频资料，先来告诉你进度～搜索过不代表看过内容。`
  :`🐟 之前你推荐的《${clean(r.title,56)}》（${r.bvid}），我已经查看了公开视频的可用资料。我还没真正听完或看完整段内容，不会乱说已体验过。`
/**
 * chooseReply is a bounded optional AI decision; it cannot confer contact rights.
 * canContact validates permissions before send; verifyComment checks live B站 UID and rpid.
 */
export function createOwnerTodoFollowup({dataDir,getConfig,send,canContact=()=>true,verifyComment=()=>false,chooseReply=()=>({decision:'reply'}),now=Date.now,logger={},hourOf=t=>new Date(t).getHours()}={}){
  if(!dataDir||typeof getConfig!=='function'||typeof send!=='function')throw TypeError('followup dependencies missing')
  let busy=false,lastCheck={at:0,reason:'尚未检查'}
  const queue=(task,result)=>{
    const cfg=getConfig()||{}
    if(cfg.ownerTodoCompletionFollowupEnabled!==true&&cfg.socialTodoCompletionFollowupEnabled!==true)return {queued:false,reason:'not-opted-in'}
    if(!task||!['watch_video','search_videos'].includes(task.type)||result?.ok!==true||!String(task.id||''))return {queued:false,reason:'not-a-verified-completion'}
    if(task.type==='watch_video'&&!BV.test(String(task.bvid||'')))return {queued:false,reason:'invalid-bv'}
    // An owner's search is intermediate. Only the linked inspected BV gets a callback.
    if(task.type==='search_videos'&&ownerTask(task))return {queued:false,reason:'intermediate-owner-search'}
    if(task.type==='watch_video'&&String(task.sourceKey||'').startsWith('owner-ai-watch:')){
      const topic=clean(task.topic,60).replace(/\s+/g,'').replace(/(?:歌曲|视频|合集|现场|演唱会|的歌|音乐)+$/g,'')
      const title=clean(result?.data?.info?.title||task.bvid,70)
      if(topic.length>=2&&!title.includes(topic))return {queued:false,reason:'video-topic-not-verified'}
    }
    const d=read(dataDir),selected=recipients(task)
    let added=0
    for(const target of selected){
      if(target.social?cfg.socialTodoCompletionFollowupEnabled!==true:cfg.ownerTodoCompletionFollowupEnabled!==true)continue
      const taskId=String(task.id),key=taskId+':'+target.channel+':'+target.uid+':'+target.originalMessageId
      if(d.items.some(x=>x.key===key||(x.taskId===taskId&&x.uid===target.uid&&String(x.channel||'dm')===target.channel)))continue
      d.items.push({...target,key,taskId,type:task.type,bvid:BV.test(String(task.bvid||''))?task.bvid:'',
        title:clean(result?.data?.info?.title||task.title||task.bvid||task.topic,70),topic:clean(task.topic,60),
        at:now(),status:'pending',reason:'',attempts:0,nextAt:0});added++
    }
    if(added)save(dataDir,d)
    return {queued:added>0,added,reason:added?'':'no-authorized-target'}
  }
  const checked=(at,reason)=>{lastCheck={at,reason};return {ok:true,skipped:reason}}
  const tick=async()=>{
    if(busy)return {ok:true,skipped:'busy'}
    const cfg=getConfig()||{},at=now()
    if(cfg.masterEnabled!==true)return checked(at,'disabled')
    if(cfg.ownerTodoCompletionFollowupEnabled!==true&&cfg.socialTodoCompletionFollowupEnabled!==true)return checked(at,'disabled')
    if(cfg.ownerTodoCompletionFollowupEnabled===true&&cfg.socialTodoCompletionFollowupEnabled!==true&&cfg.dmWatch!==true)return checked(at,'disabled')
    if(hourOf(at)<9||hourOf(at)>=22)return checked(at,'quiet-hours')
    busy=true;const lockFile=join(dataDir,'owner-todo-followup.lock');let fd
    try{mkdirSync(dataDir,{recursive:true});fd=openSync(lockFile,'wx',0o600)}
    catch(e){busy=false;if(e?.code==='EEXIST')return checked(at,'发送锁占用，需要人工核查');throw e}
    try{
      const d=read(dataDir)
      // Conservative migration: never retry interrupted sends or guess the origin of old records.
      for(const r of d.items){
        if(r.status==='sending'){r.status='uncertain';r.reason='上次发送中断，禁止自动重试'}
        if(r.status==='pending'&&at-Number(r.at)>7*DAY){r.status='expired';r.reason='超过7天，不再发送'}
      }
      const history=(d.sentHistory||[]).filter(x=>Number(x.at)>at-DAY&&Number(x.at)<=at)
      const pending=d.items.filter(x=>x.status==='pending'&&at>=Number(x.at)&&at-Number(x.at)<=7*DAY)
      if(!pending.length){save(dataDir,d);return checked(at,'empty')}
      if(history.length>=4){save(dataDir,d);return checked(at,'全局24小时最多4条完成回访')}
      if(history.length&&at-Math.max(...history.map(x=>Number(x.at)))<30*60_000){save(dataDir,d);return checked(at,pending.every(x=>history.some(h=>h.uid===x.uid))?'24h-cooldown':'两次回访至少间隔30分钟')}
      if(!history.length&&d.lastSentAt&&at-d.lastSentAt<DAY){save(dataDir,d);return checked(at,'24h-cooldown')}
      let possible=pending.filter(x=>!history.some(h=>h.uid===x.uid))
      if(!possible.length){save(dataDir,d);return checked(at,'24h-cooldown')}
      const r=possible.find(x=>!x.nextAt||at>=x.nextAt)
      if(!r){save(dataDir,d);return checked(at,'鱼鱼选择延期，等待下次考虑')}
      const social=r.social===true,originChannel=r.channel||'dm'
      if(social?cfg.socialTodoCompletionFollowupEnabled!==true:cfg.ownerTodoCompletionFollowupEnabled!==true){save(dataDir,d);return checked(at,'该类回访尚未授权')}
      if(!UID.test(String(r.uid||''))){r.status='blocked';r.reason='来源UID缺失';save(dataDir,d);return checked(at,'来源身份无效')}
      if(!social&&String(r.uid)!==String(cfg.dmOwnerUid||'')){save(dataDir,d);return checked(at,'empty')}
      // The relationship hint affects willingness only, not contact authorization.
      let channel=originChannel
      let decision={decision:'reply'}
      if(typeof chooseReply==='function')try{decision=await chooseReply({uid:r.uid,channel:originChannel,social,
        title:r.title,topic:r.topic,type:r.type,at:r.at,attempts:r.attempts||0})||decision}catch(e){logger.warn?.('回访意愿暂不可用：'+clean(e?.message||e,80))}
      if(decision.decision==='skip'){
        r.status='skipped';r.reason='鱼鱼自主决定这次不主动回访';save(dataDir,d);return checked(at,'鱼鱼决定保持沉默')
      }
      if(decision.decision==='defer'){
        r.attempts=(Number(r.attempts)||0)+1
        if(r.attempts>2){r.status='skipped';r.reason='鱼鱼多次选择不联系'}
        else{r.nextAt=at+6*3600_000;r.reason='鱼鱼选择稍后再考虑'}
        save(dataDir,d);return checked(at,'鱼鱼选择延期')
      }
      // An incoming DM NEVER moves to a public comment. Comment -> DM only if the
      // verified relationship is familiar AND a separate DM grant exists.
      if(originChannel==='comment'&&decision.channel==='dm'&&decision.familiar===true){
        const grant=await canContact({...r,channel:'dm',crossChannel:true})
        if(grant!==false&&grant?.blocked!==true)channel='dm'
      }
      const permission=await canContact({...r,channel,crossChannel:channel!==originChannel})
      if(permission===false||permission?.blocked===true){
        if(channel!=='origin'&&channel!==originChannel){channel=originChannel}
        else{r.status='blocked';r.reason=clean(permission?.reason||'当前渠道或用户未授权',90);save(dataDir,d);return checked(at,'opted-out')}
      }
      const permitted=await canContact({...r,channel,crossChannel:channel!==originChannel})
      if(permitted===false||permitted?.blocked===true){r.status='blocked';r.reason=clean(permitted?.reason||'原渠道未授权',90);save(dataDir,d);return checked(at,'原渠道不可用')}
      if(channel==='comment'){
        if(!BV.test(String(r.commentBvid||''))||!validId(r.commentRpid)){
          r.status='blocked';r.reason='缺少原评论的BV或评论ID，禁止猜测目标';save(dataDir,d);return checked(at,'原评论定位缺失')
        }
        const verified=await verifyComment({uid:r.uid,bvid:r.commentBvid,rpid:r.commentRpid,root:r.commentRoot||r.commentRpid})
        if(verified!==true){
          r.status='blocked';r.reason='B站未能确认原评论和作者相符，禁止发表';save(dataDir,d);return checked(at,'原评论核验失败')
        }
      }
      // Re-read after asynchronous steps: the task may have been edited / disabled.
      const current=read(dataDir),claim=current.items.find(x=>(x.key||x.taskId)===(r.key||r.taskId))
      if(!claim||claim.status!=='pending')return checked(at,'回访已经被处理')
      const latest=getConfig()||{}
      if(latest.masterEnabled!==true||(social?latest.socialTodoCompletionFollowupEnabled!==true:latest.ownerTodoCompletionFollowupEnabled!==true))return checked(at,'发送前权限已撤销')
      claim.status='sending';claim.startedAt=at;claim.selectedChannel=channel;save(dataDir,current)
      let receipt
      try{receipt=await send({uid:r.uid,channel,text:messageOf(r).slice(0,430),
        commentBvid:r.commentBvid,commentRpid:r.commentRpid,commentRoot:r.commentRoot,social})}
      catch(e){logger.warn?.('回访发送回执不确定：'+clean(e?.message||e,90));receipt={ok:false}}
      const after=read(dataDir),actual=after.items.find(x=>(x.key||x.taskId)===(r.key||r.taskId))
      if(!actual||actual.status!=='sending')return {ok:false,status:'uncertain'}
      actual.status=receipt===true||receipt?.ok===true?'sent':'uncertain';actual.finishedAt=now()
      actual.reason=actual.status==='sent'?'平台已确认发送':'回执不确定，禁止自动重试'
      if(actual.status==='sent'){
        after.lastSentAt=actual.finishedAt
        after.sentHistory.push({at:actual.finishedAt,uid:r.uid,channel})
      }
      save(dataDir,after);lastCheck={at:now(),reason:actual.reason}
      return {ok:actual.status==='sent',status:actual.status,channel,uid:r.uid}
    }finally{busy=false;try{closeSync(fd)}catch{};try{unlinkSync(lockFile)}catch{}}
  }
  const status=()=>{const d=read(dataDir),cfg=getConfig()||{}
    return {ok:true,pending:d.items.filter(x=>x.status==='pending').length,lastCheck,
      recent:d.items.slice(-16).map(x=>({status:x.status,at:x.at,uid:x.uid,channel:x.selectedChannel||x.channel||'dm',
        title:x.title,reason:x.reason||'',type:x.type||'watch_video',
        eligibility:x.social===true?(cfg.socialTodoCompletionFollowupEnabled===true?'已授权社交回访':'社交回访未授权'):
          String(x.uid)===String(cfg.dmOwnerUid||'')?'主人':'主人 UID 不匹配'}))}}
  return {queue,tick,status}
}
