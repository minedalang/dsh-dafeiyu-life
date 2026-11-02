/** 2.6.0 bounded owner-only task-completion callback.
 * Independent of the paused legacy emotional/random outreach. Never sends from
 * a search-only result and never claims to have listened to audio/video.
 */
import {randomUUID} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync,openSync,closeSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
const FILE='owner-todo-followups.json',MAX_BYTES=80000,DAY=86400000,BV=/^BV[0-9A-Za-z]{10}$/
const UID=/^[1-9]\d{0,18}$/
const clean=(v,n=100)=>String(v??'').replace(/[\u0000-\u001f\u007f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const blank=()=>({version:1,items:[],lastSentAt:0})
function read(dir){const file=join(dir,FILE);if(!existsSync(file))return blank();const st=lstatSync(file)
  if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw Error('主人待办回访账本不安全')
  const obj=JSON.parse(readFileSync(file,'utf8'));if(obj?.version!==1||!Array.isArray(obj.items))throw Error('主人回访账本结构错误');return obj}
function save(dir,d){mkdirSync(dir,{recursive:true});const file=join(dir,FILE)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('主人回访账本不能是符号链接')
  d.items=d.items.slice(-120);const tmp=file+'.'+process.pid+'.'+randomUUID()+'.tmp'
  writeFileSync(tmp,JSON.stringify(d,null,2)+'\n',{mode:0o600});renameSync(tmp,file)}
export function createOwnerTodoFollowup({dataDir,getConfig,send,canContact=()=>true,now=Date.now,logger={},hourOf=t=>new Date(t).getHours()}={}){
  if(!dataDir||typeof getConfig!=='function'||typeof send!=='function')throw TypeError('owner followup dependencies missing')
  let busy=false
  const queue=(task,result)=>{
    // New consent never backfills completed tasks from before it was enabled.
    if(getConfig()?.ownerTodoCompletionFollowupEnabled!==true)return {queued:false,reason:'not-opted-in'}
    // Only a *confirmed* read of a linked search candidate is eligible.
    if(!task||task.type!=='watch_video'||!String(task.sourceKey||'').startsWith('owner-ai-watch:')||result?.ok!==true)return {queued:false,reason:'not-a-verified-owner-watch'}
    const uid=String(task.origin?.uid||''),bvid=String(task.bvid||''),taskId=String(task.id||'')
    if(!UID.test(uid)||!BV.test(bvid)||!taskId||!String(task.origin?.messageId||''))return {queued:false,reason:'invalid-provenance'}
    const d=read(dataDir);if(d.items.some(x=>x.taskId===taskId))return {queued:false,reason:'duplicate'}
    const title=clean(result?.data?.info?.title||bvid,70)
    const topic=clean(task.topic,60),subject=topic.replace(/\s+/g,'').replace(/(?:歌曲|视频|合集|现场|演唱会|的歌|音乐)+$/g,'')
    if(subject.length>=2&&!title.includes(subject))return {queued:false,reason:'video-topic-not-verified'}
    d.items.push({taskId,uid,bvid,title,topic,at:now(),status:'pending',reason:''})
    save(dataDir,d);return {queued:true}
  }
  const tick=async()=>{
    if(busy)return {ok:true,skipped:'busy'}
    const cfg=getConfig()||{},t=now()
    if(cfg.masterEnabled!==true||cfg.dmWatch!==true||cfg.ownerTodoCompletionFollowupEnabled!==true)return {ok:true,skipped:'disabled'}
    const uid=String(cfg.dmOwnerUid||'')
    if(!UID.test(uid))return {ok:true,skipped:'owner-not-verified'}
    const hour=hourOf(t);if(hour<9||hour>=22)return {ok:true,skipped:'quiet-hours'}
    busy=true
    // Multiple DSH instances must not race to send the same private message.
    // An abandoned lock fails closed: do not auto-remove it and risk replay.
    const lockFile=join(dataDir,'owner-todo-followup.lock')
    let lockFd
    try{mkdirSync(dataDir,{recursive:true});lockFd=openSync(lockFile,'wx',0o600)}
    catch(e){busy=false;if(e?.code==='EEXIST')return {ok:true,skipped:'locked'};throw e}
    try{
      const d=read(dataDir)
      for(const row of d.items){if(row.status==='pending'&&t-row.at>7*DAY){row.status='expired';row.reason='超过7天不再主动补发'}}
      const one=d.items.find(x=>x.status==='pending'&&x.uid===uid&&t>=x.at&&t-x.at<=7*DAY)
      if(!one){save(dataDir,d);return {ok:true,skipped:'empty'}}
      if(d.lastSentAt&&t-d.lastSentAt<DAY){save(dataDir,d);return {ok:true,skipped:'24h-cooldown'}}
      const allow=await canContact({uid,bvid:one.bvid,title:one.title})
      // Reload after async checks: a new completion may have been queued meanwhile.
      const fresh=read(dataDir),claim=fresh.items.find(x=>x.taskId===one.taskId)
      if(!claim||claim.status!=='pending')return {ok:true,skipped:'already-claimed'}
      if(allow===false||allow?.blocked===true){claim.status='blocked';claim.reason='对方已拒绝此类主动联系';save(dataDir,fresh);return {ok:true,skipped:'opted-out'}}
      // Reserve before any network I/O. On uncertain receipt there is no auto retry.
      claim.status='sending';claim.startedAt=t;save(dataDir,fresh)
      const topic=clean(one.topic,45),title=clean(one.title,55)
      const text=`🐟 之前你推荐我${topic?'了解「'+topic+'」':'看看相关视频'}，今天我查看了相关视频《${title}》的资料（${one.bvid}）！先来报个进度～我还没真正听完或看完整段内容，不会乱说已体验过。你有什么特别喜欢的片段吗？`
      let receipt
      try{receipt=await send({uid,text:text.slice(0,450)})}catch(e){logger.warn?.('待办回访回执未确认：'+clean(e?.message||e,90));receipt={ok:false}}
      const latest=read(dataDir),actual=latest.items.find(x=>x.taskId===one.taskId)
      if(!actual||actual.status!=='sending')return {ok:false,status:'uncertain'}
      actual.status=receipt===true||receipt?.ok===true?'sent':'uncertain';actual.finishedAt=now();actual.reason=actual.status==='sent'?'平台已确认发送':'发送结果不确定，禁止自动重试'
      if(actual.status==='sent')latest.lastSentAt=actual.finishedAt
      save(dataDir,latest);return {ok:actual.status==='sent',status:actual.status}
    }finally{busy=false;try{closeSync(lockFd)}catch{};try{unlinkSync(lockFile)}catch{}}
  }
  const status=()=>{const d=read(dataDir);return {ok:true,pending:d.items.filter(x=>x.status==='pending').length,recent:d.items.slice(-8).map(x=>({status:x.status,at:x.at,title:x.title,reason:x.reason}))}}
  return {queue,tick,status}
}
