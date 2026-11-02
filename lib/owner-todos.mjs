/**
 * Unified, backward-compatible Bilibili accepted-TODO ledger.
 * All channels share one lifecycle. Received suggestions are NOT accepted tasks;
 * external writes still require independently authenticated owner authorization.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE='owner-todos.json'
const VERSION=1
const MAX_FILE=1_000_000
const MAX_ITEMS=500
const CLOSED=new Set(['done','dismissed'])
const ACTIVE=new Set(['open','deferred','running','uncertain','blocked'])
const cleanEvent=(from,to,at,reason='')=>({from:clean(from,24),to:clean(to,24),at,reason:clean(reason,100)})
const logTransition=(row,to,at,reason='')=>{row.history=Array.isArray(row.history)?row.history.slice(-5):[];row.history.push(cleanEvent(row.status,to,at,reason));row.status=to}
const publicTask=row=>{const safe={...row};delete safe.text;if(safe.origin&&safe.origin.kind!=='owner-dm'&&safe.origin.kind!=='owner-session'){safe.origin={...safe.origin,quotedText:''}}return safe}
const DAY=86400000
const BV=/^BV[0-9A-Za-z]{10}$/
const UID=/^[1-9]\d{0,18}$/
export const OWNER_TODO_TYPES=new Set(['watch_video','like_video','inspect_my_space','inspect_creator_videos','search_videos','check_notifications','collect_video','follow_creator','unfollow_creator','comment_video','dm_friend'])
export const WRITE_TODO_TYPES=new Set(['like_video','collect_video','follow_creator','unfollow_creator','comment_video','dm_friend'])
const TYPES=OWNER_TODO_TYPES
export const READ_TODO_TYPES=new Set([...OWNER_TODO_TYPES].filter(type=>!WRITE_TODO_TYPES.has(type)))
const WRITE_TYPES=WRITE_TODO_TYPES
const clean=(v,n=180)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const safeInt=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>{const n=Number(v);return Number.isSafeInteger(n)?Math.max(min,Math.min(max,n)):min}
const fileOf=dir=>join(dir,FILE)
function blank(){return {version:VERSION,items:[],lastUpdatedAt:0,lastAutoReviewAt:0}}
function read(dir){
  const file=fileOf(dir)
  try{
    if(!existsSync(file))return blank()
    const st=lstatSync(file)
    if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_FILE)throw Error('待办文件不安全或过大')
    const x=JSON.parse(readFileSync(file,'utf8'))
    if(x?.version!==VERSION||!Array.isArray(x.items))throw Error('待办文件版本不兼容')
    return {...blank(),...x,items:x.items.filter(x=>x&&typeof x.id==='string').slice(-MAX_ITEMS)}
  }catch(e){if(e?.code==='ENOENT')return blank();throw e}
}
function write(dir,data,now=Date.now()){
  mkdirSync(dir,{recursive:true});const file=fileOf(dir)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('待办文件是符号链接，拒绝写入')
  const out={version:VERSION,lastUpdatedAt:now,lastAutoReviewAt:safeInt(data.lastAutoReviewAt,0,8.64e15),items:(data.items||[]).slice(-MAX_ITEMS)}
  const tmp=file+`.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tmp,JSON.stringify(out,null,2)+'\n',{encoding:'utf8',mode:0o600});renameSync(tmp,file);return out
}
function validate(input,{source='owner',now=Date.now()}={}){
  const type=String(input?.type||'')
  if(!TYPES.has(type))return {ok:false,error:'不支持的待办类型'}
  const bvid=String(input?.bvid||'').trim()
  const uid=String(input?.uid||'').trim()
  const topic=clean(input?.topic||'',120)
  if(['watch_video','like_video','collect_video','follow_creator','comment_video'].includes(type)&&!BV.test(bvid))return {ok:false,error:'此待办需要一个真实 BV 号'}
  if(['inspect_creator_videos','unfollow_creator','dm_friend'].includes(type)&&!UID.test(uid))return {ok:false,error:'此待办需要有效 UID'}
  if(type==='search_videos'&&!topic)return {ok:false,error:'搜索待办需要关键词'}
  if(type==='collect_video'&&!clean(input?.folderTitle||'',40))return {ok:false,error:'收藏待办需要指定收藏夹名称'}
  if(['comment_video','dm_friend'].includes(type)&&!clean(input?.text||'',2000))return {ok:false,error:'评论/私信待办需要明确正文，不能在后台凭空生成或改写外发内容'}
  if(type==='comment_video'&&String(input?.text||'').length>2000)return {ok:false,error:'评论正文不能超过 2000 字'}
  if(type==='dm_friend'&&String(input?.text||'').length>450)return {ok:false,error:'私信正文不能超过 450 字'}
  const write=WRITE_TYPES.has(type)
  return {ok:true,item:{
    id:randomUUID(),type,title:clean(input?.title||defaultTitle(type,input),120)||defaultTitle(type,input),
    bvid:BV.test(bvid)?bvid:'',uid:UID.test(uid)?uid:'',topic,
    folderTitle:clean(input?.folderTitle||'',40),createFolder:input?.createFolder===true,
    text:clean(input?.text||'',2000),rpid:safeInt(input?.rpid,0,Number.MAX_SAFE_INTEGER),root:safeInt(input?.root,0,Number.MAX_SAFE_INTEGER),
    note:clean(input?.note||'',220),source:source==='recommendation'?'recommendation':'owner',recommendationSources:[],
    acceptance:{kind:source==='recommendation'?'social-willingness':clean(input?.acceptance?.kind||'explicit-owner',40),at:now},history:[],
    acceptance:{kind:source==='recommendation'?'social-willingness':clean(input?.acceptance?.kind||'explicit-owner',40),at:now},history:[],
    acceptance:{kind:source==='recommendation'?'social-willingness':clean(input?.acceptance?.kind||'explicit-owner',40),at:now},history:[],
    origin:{kind:source==='recommendation'?['bilibili-comment','bilibili-dm'].includes(input?.origin?.kind)?input.origin.kind:'bilibili-dm':['owner-session','owner-dm','owner','friend','stranger','bilibili-comment','bilibili-dm'].includes(input?.origin?.kind)?input.origin.kind:'owner',uid:UID.test(String(input?.origin?.uid||''))?String(input.origin.uid):'',senderName:clean(input?.origin?.senderName||'',60),messageId:clean(input?.origin?.messageId||'',150),quotedText:clean(input?.origin?.quotedText||'',700),at:safeInt(input?.origin?.at,0,8.64e15)},
    sourceKey:clean(input?.sourceKey||'',240),ownerAuthorized:write&&input?.ownerAuthorized===true,
    status:'open',createdAt:now,updatedAt:now,dueAt:safeInt(input?.dueAt,0,8.64e15),
    attempts:0,lastError:'',resultSummary:'',attemptAt:0,completedAt:0,
  }}
}
function defaultTitle(type,input={}){
  const bvid=String(input?.bvid||'').trim(),uid=String(input?.uid||'').trim(),topic=clean(input?.topic||'',80)
  return ({watch_video:`看看视频 ${bvid}`,like_video:`给视频 ${bvid} 点赞`,inspect_my_space:'看看我自己的空间投稿',inspect_creator_videos:`看看 UID ${uid} 的投稿`,search_videos:`搜索视频：${topic}`,check_notifications:'检查 B 站通知',collect_video:`收藏视频 ${bvid}`,follow_creator:`关注视频 ${bvid} 的 UP 主`,unfollow_creator:`取关 UID ${uid}`,comment_video:`评论视频 ${bvid}`,dm_friend:`给 UID ${uid} 发私信`})[type]||'大肥鱼待办'
}
export function createOwnerTodoEngine({dataDir,now=Date.now}={}){
  if(!dataDir)throw TypeError('owner TODO dataDir missing')
  const list=({includeClosed=false,limit=80}={})=>{
    const d=read(dataDir);let rows=d.items.slice().sort((a,b)=>Number(b.createdAt)-Number(a.createdAt))
    if(!includeClosed)rows=rows.filter(x=>['open','deferred','running','uncertain','blocked'].includes(x.status))
    return rows.slice(0,Math.max(1,Math.min(500,Number(limit)||80))).map(x=>({...x}))
  }
  const add=(input,options={})=>{
    const source=options.source||'owner',d=read(dataDir),checked=validate(input,{source,now:now()})
    if(!checked.ok)return checked
    const row=checked.item
    if(row.sourceKey&&d.items.some(x=>x.sourceKey===row.sourceKey&&x.status!=='dismissed'))return {ok:true,created:false,duplicate:true,item:d.items.find(x=>x.sourceKey===row.sourceKey)}
    if(source==='recommendation'){
      const same=d.items.find(x=>x.source==='recommendation'&&x.bvid===row.bvid&&x.sourceKey===row.sourceKey&&x.status!=='dismissed')
      if(same)return {ok:true,created:false,duplicate:true,item:same}
    }
    // Never evict accepted unfinished commitments silently. Discard oldest closed
    // history only when the bounded legacy JSON file reaches its capacity.
    while(d.items.length>=MAX_ITEMS){const removable=d.items.filter(x=>CLOSED.has(x.status)).sort((a,b)=>Number(a.updatedAt||a.createdAt)-Number(b.updatedAt||b.createdAt))[0];if(!removable)return {ok:false,error:'待办容量已满，不能静默丢弃仍未完成的事'};d.items.splice(d.items.indexOf(removable),1)}
    d.items.push(row);write(dataDir,d,now());return {ok:true,created:true,item:row}
  }
  const syncRecommendations=(entries=[],{requireAccepted=false}={})=>{
    let added=0,duplicates=0
    for(const e of (Array.isArray(entries)?entries:[]).slice(-50)){
      if(requireAccepted&&e?.accepted!==true)continue
      const bvid=String(e?.bvid||e?.bv_id||'')
      const at=Number(e?.at||e?.timestampMs||0)
      if(!BV.test(bvid)||!Number.isFinite(at)||at>now()+60000||now()-at>7*DAY)continue
      const uid=UID.test(String(e?.uid||''))?String(e.uid):''
      // One read-only optional task per BV, regardless of who recommended it.
      // Preserve provenance without creating N duplicate tasks or reopening a
      // task the fish already chose to dismiss or finish.
      const state=read(dataDir)
      const existing=state.items.find(x=>x.source==='recommendation'&&x.type==='watch_video'&&x.bvid===bvid)
      const sender={uid,channel:e?.source==='B站评论分享'?'comment':'dm',at}
      if(existing){
        duplicates++
        existing.recommendationSources=Array.isArray(existing.recommendationSources)?existing.recommendationSources.slice(-11):[]
        if(!existing.recommendationSources.some(s=>s.uid===uid&&s.channel===sender.channel)){
          existing.recommendationSources.push(sender);write(dataDir,state,now())
        }
        continue
      }
      const sourceKey=`recommendation:${bvid}`
      const r=add({type:'watch_video',bvid,title:`考虑看看别人推荐的视频 ${bvid}`,
        note:requireAccepted?'已通过生活域意愿判断，鱼鱼愿意把这条推荐列为待办。':'收到 B 站视频推荐；由大肥鱼决定现在看、稍后看或跳过。',
        origin:{uid,senderName:e?.senderName,messageId:e?.messageId,quotedText:'',at},dueAt:0,sourceKey,acceptance:{kind:'social-willingness'}},{source:'recommendation'})
      if(r.created){added++;const s=read(dataDir),row=s.items.find(x=>x.id===r.item.id);if(row){row.recommendationSources=[sender];row.origin.kind=sender.channel==='comment'?'bilibili-comment':'bilibili-dm';write(dataDir,s,now())}}
      else if(r.duplicate)duplicates++
    }
    return {added,duplicates}
  }
  const update=(id,action,{dueAt=0,note=''}={})=>{
    const d=read(dataDir),row=d.items.find(x=>x.id===String(id))
    if(!row)return {ok:false,error:'没有找到这条待办'}
    if(action==='dismiss'){if(['done','dismissed'].includes(row.status))return {ok:false,error:'这条待办已经结束'};logTransition(row,'dismissed',now(),'自主放弃')}
    else if(action==='defer'){if(!['open','deferred','blocked'].includes(row.status))return {ok:false,error:'当前状态不能延期'};logTransition(row,'deferred',now(),'重新考虑时间');row.dueAt=safeInt(dueAt,now()+60_000,now()+365*DAY)}
    else if(action==='reopen'){if(!['done','dismissed','blocked','uncertain'].includes(row.status))return {ok:false,error:'当前状态无需重新打开'};logTransition(row,'open',now(),'人工重新开启');row.dueAt=0;row.lastError='';row.attemptAt=0}
    else if(action==='done'){if(row.status==='uncertain')return {ok:false,error:'结果不确定的外部操作不能直接标记完成，请先核实 B 站实际状态'};logTransition(row,'done',now(),'已人工标记完成');row.completedAt=now()}
    else return {ok:false,error:'未知待办操作'}
    if(note)row.note=clean(note,220);row.updatedAt=now();write(dataDir,d,now());return {ok:true,item:{...row}}
  }
  const begin=id=>{
    const d=read(dataDir),row=d.items.find(x=>x.id===String(id))
    if(!row)return {ok:false,error:'没有找到这条待办'}
    if(!['open','deferred'].includes(row.status))return {ok:false,error:row.status==='uncertain'?'上次操作结果不确定，先核实平台状态，不会重试':'这条待办当前不能执行'}
    if(row.dueAt&&row.dueAt>now())return {ok:false,error:'这条待办还没到计划时间'}
    logTransition(row,'running',now(),'开始执行');row.attempts=safeInt(row.attempts,0,100000)+1;row.attemptAt=now();row.updatedAt=now();row.lastError='';write(dataDir,d,now());return {ok:true,item:{...row}}
  }
  const finish=(id,result={})=>{
    const d=read(dataDir),row=d.items.find(x=>x.id===String(id));if(!row)return {ok:false,error:'没有找到这条待办'}
    const ok=result?.ok===true
    logTransition(row,ok?'done':result?.uncertain===true?'uncertain':'open',now(),ok?'收到成功回执':result?.uncertain===true?'执行结果不确定':'执行未完成')
    row.completedAt=ok?now():0;row.lastError=ok?'':clean(result?.error||'执行失败',220)
    row.resultSummary=clean(result?.summary||result?.message||'',420);row.updatedAt=now();write(dataDir,d,now())
    return {ok,status:row.status,item:{...row}}
  }
  const run=async(id,executor)=>{
    if(typeof executor!=='function')throw TypeError('todo executor missing')
    const started=begin(id);if(!started.ok)return started
    const task=started.item
    try{const result=await executor(task);const final=finish(task.id,result||{ok:false,error:'执行器没有返回结果'});return {...final,result:result||null}}
    catch(e){const result={ok:false,uncertain:task.ownerAuthorized&&WRITE_TYPES.has(task.type),error:String(e?.message||e).slice(0,220)};return {...finish(task.id,result),result}}
  }
  /** Deterministic, bounded cursor pagination over accepted tasks. No OFFSET scan on the client. */
  const page=({filter='active',cursor='',limit=25}={})=>{
    if(!['active','finished','all'].includes(filter))return {ok:false,error:'无效待办筛选'}
    const size=Math.max(1,Math.min(50,Number.isSafeInteger(Number(limit))?Number(limit):25))
    const rows=read(dataDir).items.slice()
    const counts={active:rows.filter(x=>ACTIVE.has(x.status)).length,finished:rows.filter(x=>CLOSED.has(x.status)).length,uncertain:rows.filter(x=>x.status==='uncertain').length,open:rows.filter(x=>x.status==='open').length,deferred:rows.filter(x=>x.status==='deferred').length}
    let boundary=null
    if(cursor){try{if(cursor.length>300)throw Error('oversize');boundary=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(boundary?.filter!==filter||!Number.isSafeInteger(boundary.at)||typeof boundary.id!=='string'||boundary.id.length>80||!/^[0-9a-f-]{36}$/.test(boundary.id))throw Error('invalid')}catch{return {ok:false,error:'分页游标无效'}}}
    const applicable=rows.filter(x=>filter==='all'||(filter==='active'?ACTIVE:CLOSED).has(x.status)).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt)||String(b.id).localeCompare(String(a.id)))
    const after=boundary?applicable.filter(x=>Number(x.createdAt)<boundary.at||(Number(x.createdAt)===boundary.at&&String(x.id)<boundary.id)):applicable
    const batch=after.slice(0,size),last=batch.at(-1)
    return {ok:true,filter,limit:size,counts,total:applicable.length,items:batch.map(publicTask),nextCursor:after.length>size&&last?Buffer.from(JSON.stringify({filter,at:Number(last.createdAt),id:last.id})).toString('base64url'):null}
  }
  /** No automatic replay of interrupted external writes after a host restart. */
  const recoverInterrupted=()=>{
    const d=read(dataDir),interrupted=d.items.filter(x=>x.status==='running')
    if(!interrupted.length)return {ok:true,recovered:0}
    for(const task of interrupted){const write=WRITE_TYPES.has(task.type);logTransition(task,write?'uncertain':'blocked',now(),'插件中断，需人工核实');task.updatedAt=now();task.lastError=write?'外部操作可能已发生，请核对平台，不会自动重试':'上次只读检查被中断，请确认后重新打开'}
    write(dataDir,d,now());return {ok:true,recovered:interrupted.length}
  }
  const markAutoReview=()=>{const d=read(dataDir);d.lastAutoReviewAt=now();write(dataDir,d,now());return d.lastAutoReviewAt}
  const lastAutoReviewAt=()=>read(dataDir).lastAutoReviewAt||0
  const context=(limit=8)=>{const d=read(dataDir);return d.items.slice().sort((a,b)=>Number(b.createdAt)-Number(a.createdAt)).filter(x=>x.status==='open'||(x.status==='deferred'&&(!x.dueAt||x.dueAt<=now()))).slice(0,Math.max(1,Math.min(12,limit))).map(x=>({id:x.id,type:x.type,status:x.status,title:x.title,bvid:x.bvid,uid:x.uid,topic:x.topic,source:x.source,origin:x.origin,dueAt:x.dueAt,ownerAuthorized:x.ownerAuthorized,note:x.note}))}
  const status=()=>({ok:true,open:list({limit:500}).filter(x=>x.status==='open').length,deferred:list({limit:500}).filter(x=>x.status==='deferred').length,uncertain:list({limit:500}).filter(x=>x.status==='uncertain').length,items:list({includeClosed:true,limit:100}).map(publicTask)})
  return {list,add,syncRecommendations,update,begin,finish,run,context,status,page,recoverInterrupted,markAutoReview,lastAutoReviewAt,file:fileOf(dataDir)}
}

export const __test={validate,defaultTitle,FILE,VERSION,TYPES,WRITE_TYPES}
