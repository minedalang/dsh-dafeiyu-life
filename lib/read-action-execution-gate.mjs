/**
 * 2.7.1-dev.3: durable, account-scoped concurrency gate for the SHARED JS Bilibili
 * read adapter. Not a second TODO ledger; not a permission grant; not a general
 * social write outbox. Python headless MCP calls do not pass this JS boundary.
 *
 * A mkdir('wx' equivalent) is the cross-process reservation. On process death
 * the reservation remains until EXPLICIT review: we do not assume a platform
 * read succeeded, and we never automatically replay an interrupted action.
 * Audit rows intentionally contain no actual target, UID, prompt or DM text.
 */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

const ROOT='read-action-executions', HEX=/^[a-f0-9]{64}$/, BV=/^BV[0-9A-Za-z]{10}$/
const exactInteger=(value,defaultValue,{min=0,max=Number.MAX_SAFE_INTEGER}={})=>{
  if(value===undefined||value===null)return defaultValue
  const s=String(value)
  if(!/^(0|[1-9]\d*)$/.test(s))throw Error('只读评论参数必须是有效整数')
  const n=Number(s)
  if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('只读评论参数超出安全范围')
  return n
}
const clean=v=>String(v??'').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim()
const digest=v=>createHash('sha256').update(v).digest('hex')
const processAlive=pid=>{
  if(!Number.isSafeInteger(pid)||pid<=0)return false
  try{process.kill(pid,0);return true}catch(e){return e?.code!=='ESRCH'}
}
const safeDir=p=>{if(existsSync(p)){const s=lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink())throw Error('只读动作预约目录不安全')}}
const safeFile=p=>{if(existsSync(p)){const s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>4096)throw Error('只读动作回执文件不安全')}}
function atomic(file,data){safeFile(file);const tmp=file+'.'+randomUUID()+'.tmp';try{writeFileSync(tmp,JSON.stringify(data)+'\n',{flag:'wx',mode:0o600});renameSync(tmp,file)}finally{try{rmSync(tmp,{force:true})}catch{}}}
const boundedInt=(n,defaultValue,max)=>Number.isSafeInteger(Number(n))&&Number(n)>0?Math.min(max,Number(n)):defaultValue

/** Only comparable, safely identified public reads are included in phase 1.
 * Search options/pagination are part of identity: different reads cannot be
 * incorrectly deduplicated. Invalid inputs fail in the preflight gate.
 */
export function readToolAction(tool,args={}){
  const name=String(tool||''),a=args||{}
  if(name==='bili_video_info'||name==='bili_creator_relation_status'){
    if(!BV.test(String(a.bvid||'')))throw Error('只读动作缺少有效 BV')
    return {operation:name,target:String(a.bvid)}
  }
  if(name==='bili_subtitle'){
    const bvid=String(a.bvid||'')
    if(!BV.test(bvid))throw Error('字幕只读动作缺少有效 BV')
    // The optional visual fallback may consume model quota. It is NOT a
    // permission granted by this read reservation and stays behind the
    // existing video-agent vision gate. Both paths first read the exact same
    // subtitle resource, so the reservation identity is BV-only.
    if(a.auto_vision_on_missing!==undefined && typeof a.auto_vision_on_missing!=='boolean')
      throw Error('字幕视觉回退参数必须是布尔值')
    return {operation:name,target:bvid}
  }
  if(name==='bili_danmaku'){
    const bvid=String(a.bvid||'')
    if(!BV.test(bvid))throw Error('弹幕只读动作缺少有效 BV')
    const num=exactInteger(a.num,100,{min:1,max:300})
    return {operation:name,target:JSON.stringify([bvid,num])}
  }
  if(name==='bili_comments'||name==='bili_comment_thread'){
    const bvid=String(a.bvid||'')
    if(!BV.test(bvid))throw Error('评论区只读动作缺少有效 BV')
    if(name==='bili_comments'){
      const num=exactInteger(a.num,30,{min:1,max:300})
      return {operation:name,target:JSON.stringify([bvid,num])}
    }
    const root=exactInteger(a.root,undefined,{min:1})
    if(root===undefined)throw Error('楼中楼只读动作缺少根评论 ID')
    const num=exactInteger(a.num,20,{min:1,max:300})
    const target=exactInteger(a.target_rpid,0)
    return {operation:name,target:JSON.stringify([bvid,String(root),num,String(target)])}
  }
  if(name==='bili_preview_frames'){
    // Internal frame FETCH only, never the outer vision agent or its model call.
    if(!BV.test(String(a.bvid||'')))throw Error('预览帧读取缺少有效 BV')
    return {operation:name,target:String(a.bvid)}
  }
  if(name==='bili_user_info'){
    const uid=String(a.uid??'')
    if(!/^[1-9]\d{0,18}$/.test(uid))throw Error('UP 主资料缺少有效 UID')
    return {operation:name,target:uid}
  }
  if(name==='bili_hot_videos'||name==='bili_hot_buzzwords'){
    const pn=exactInteger(name==='bili_hot_videos'?a.pn:a.page_num,1,{min:1,max:10000})
    const ps=exactInteger(name==='bili_hot_videos'?a.ps:a.page_size,20,{min:1,max:50})
    return {operation:name,target:JSON.stringify([pn,ps])}
  }
  if(name==='bili_weekly_hot'){
    return {operation:name,target:String(exactInteger(a.week,0,{min:0,max:99999}))}
  }
  if(name==='bili_rank'){
    const categories=new Set(['all','original','rookie','douga','music','dance','game','knowledge','technology','sports','car','life','food','animal','fashion','ent','cinephile'])
    const category=String(a.category??'all').toLowerCase(),day=exactInteger(a.day,3,{min:3,max:7})
    if(!categories.has(category)||![3,7].includes(day))throw Error('排行榜参数无效')
    return {operation:name,target:JSON.stringify([category,day])}
  }
  if(name==='bili_favorite_lists'){
    const uid=String(exactInteger(a.uid,0,{min:0,max:Number.MAX_SAFE_INTEGER}))
    return {operation:name,target:uid,privacyDomain:'account'}
  }
  if(name==='bili_favorite_content'){
    const id=exactInteger(a.media_id,undefined,{min:1}),page=exactInteger(a.page,1,{min:1,max:10000})
    if(id===undefined)throw Error('收藏夹 ID 无效')
    const keyword=clean(a.keyword||'')
    if(keyword.length>80)throw Error('收藏夹关键词过长')
    return {operation:name,target:JSON.stringify([String(id),page,keyword]),privacyDomain:'account'}
  }
  if(name==='bili_home_recommendations'||name==='bili_unread_messages'||name==='bili_received_replies'||name==='bili_received_at_and_likes'){
    return {operation:name,target:'current-account',privacyDomain:'account'}
  }
  if(name==='bili_search'){
    const keyword=clean(a.keyword)
    if(!keyword||keyword.length>300)throw Error('只读搜索缺少有效主题')
    return {operation:name,target:JSON.stringify([keyword.toLowerCase(),boundedInt(a.num,10,100),clean(a.order||'totalrank')])}
  }
  if(name==='bili_user_videos'){
    const uid=String(a.uid||'')
    if(!/^[1-9]\d{0,18}$/.test(uid))throw Error('只读作者资料缺少有效 UID')
    return {operation:name,target:JSON.stringify([uid,boundedInt(a.pn,1,10000),boundedInt(a.ps,30,100),clean(a.order||'pubdate'),clean(a.keyword||'')])}
  }
  return null
}

export class ReadActionHeldError extends Error{
  constructor(code='reservation-held'){super('相同的只读动作正由另一入口执行，或上次运行中断尚未人工核查；未重复调用平台');this.name='ReadActionHeldError';this.code=code}
}

export function createReadActionExecutionGate({dataDir,getAccountScope,now=Date.now,logger={}}={}){
  if(!dataDir||typeof getAccountScope!=='function')throw TypeError('缺少统一只读动作预约依赖')
  const base=join(dataDir,ROOT),locks=join(base,'locks'),receipts=join(base,'receipts')
  const init=()=>{safeDir(dataDir);safeDir(base);mkdirSync(base,{recursive:true,mode:0o700});safeDir(locks);safeDir(receipts);mkdirSync(locks,{recursive:true,mode:0o700});mkdirSync(receipts,{recursive:true,mode:0o700})}
  const scope=()=>{const s=getAccountScope();if(typeof s!=='string'||s.length<8||s.length>256)throw Error('登录账号作用域尚未完成核验，禁止预约平台动作');return s}
  const keyOf=(operation,target,domain,s)=>digest(JSON.stringify([s,domain,operation,target]))
  const createReceipt=row=>{
    init();const file=join(receipts,`${String(row.at).padStart(15,'0')}-${randomUUID()}.json`)
    writeFileSync(file,JSON.stringify(row)+'\n',{flag:'wx',mode:0o600})
    // Diagnostics are bounded. Never touch active reservations here.
    const old=readdirSync(receipts).filter(x=>/^\d{15}-[0-9a-f-]{36}\.json$/.test(x)).sort()
    for(const filename of old.slice(0,Math.max(0,old.length-240))){try{rmSync(join(receipts,filename),{force:true})}catch{}}
  }
  const pending=()=>{
    init();return readdirSync(locks).filter(x=>HEX.test(x)).slice(0,256).map(id=>{
      const dir=join(locks,id);safeDir(dir)
      let row={id,state:'incomplete-reservation',at:0,operation:'unknown',source:'unknown'}
      try{const file=join(dir,'entry.json');safeFile(file);const r=JSON.parse(readFileSync(file,'utf8'))
        if(r?.version!==1||r.id!==id)throw Error('invalid');row={...row,...r}}
      catch{/* A crash before entry.json is still a blocking lock. */}
      return {...row,needsReview:now()-Number(row.at||0)>=30*60_000}
    })
  }
  const status=()=>{
    const currentScope=(()=>{try{return digest(scope()).slice(0,20)}catch{return ''}})()
    const held=pending().filter(x=>x.scopeHash===currentScope||!x.scopeHash),files=readdirSync(receipts).filter(x=>/^\d{15}-[0-9a-f-]{36}\.json$/.test(x)).sort().slice(-30).reverse()
    const recent=[]
    for(const name of files){try{const file=join(receipts,name);safeFile(file);const r=JSON.parse(readFileSync(file,'utf8'));if(r?.version===1&&r.scopeHash===currentScope)recent.push(r)}catch{recent.push({state:'receipt-unreadable'})}}
    return {ok:true,scopeReady:(()=>{try{scope();return true}catch{return false}})(),active:held.length,
      interrupted:held.filter(x=>x.needsReview).length,pending:held.map(x=>({id:x.id,state:x.state,operation:x.operation,source:x.source,at:x.at,needsReview:x.needsReview})),
      recent:recent.map(x=>({id:x.id,state:x.state,operation:x.operation,source:x.source,at:x.at})),
      note:'公开读取与账号读取按作用域独立预约；低清图片只锁抓取阶段，视觉模型单独受权限和额度保护。平台读取回执不等于已观看、听过或发送成功；对外写入由独立门禁管理。'}
  }
  const run=async({operation,target,source='plugin-read',sourceId='',obligationId='',privacyDomain='public'}={},execute)=>{
    if(typeof execute!=='function')throw TypeError('只读执行器缺失')
    const allowed=new Set(['bili_search','bili_video_info','bili_user_videos','bili_creator_relation_status','bili_comments','bili_comment_thread','bili_danmaku','bili_subtitle',
      'bili_preview_frames','bili_user_info','bili_hot_videos','bili_hot_buzzwords','bili_weekly_hot','bili_rank',
      'bili_favorite_lists','bili_favorite_content','bili_home_recommendations','bili_unread_messages','bili_received_replies','bili_received_at_and_likes'])
    if(!allowed.has(operation)||typeof target!=='string'||!target||target.length>500)throw Error('只读动作不在已审核的执行范围')
    if(!['public','account'].includes(privacyDomain))throw Error('未知读取隐私域，禁止预约')
    const beginning=scope(),id=keyOf(operation,target,privacyDomain,beginning),at=now()
    init();const folder=join(locks,id)
    try{mkdirSync(folder,{mode:0o700})}
    catch(e){if(e?.code==='EEXIST')throw new ReadActionHeldError();throw e}
    // Stable action identity is distinct from every source's obligation identity.
    const entry={version:1,id,scopeHash:digest(beginning).slice(0,20),operation,source:['owner-todo','life-planner','plugin-read','owner-dm','main-session'].includes(source)?source:'plugin-read',
      sourceHash:sourceId?digest(sourceId).slice(0,16):'',obligationHash:obligationId?digest(obligationId).slice(0,16):'',
      at,pid:process.pid,state:'reserved'}
    const file=join(folder,'entry.json')
    let finished=false,returned=false
    try{
      atomic(file,entry)
      atomic(file,{...entry,state:'executing'})
      const result=await execute()
      returned=true
      // The account may switch during a pending network call. Never forward
      // old-account data into a new account's memory or source ledger.
      if(scope()!==beginning)throw Error('读取期间账号作用域变化，拒绝使用旧结果')
      const raw=typeof result==='string'?(()=>{try{return JSON.parse(result)}catch{return null}})():result
      const failed=raw?.ok===false||raw?.success===false
      createReceipt({...entry,state:failed?'tool-rejected':'tool-returned',finishedAt:now()})
      finished=true;rmSync(folder,{recursive:true,force:true})
      return result
    }catch(error){
      // If the platform call already returned, failure to persist the receipt
      // MUST leave the reservation locked for manual reconciliation.
      if(!finished&&!returned){
        try{createReceipt({...entry,state:'call-failed-or-unverified',finishedAt:now()});finished=true;rmSync(folder,{recursive:true,force:true})}
        catch(err){logger.warn?.('只读预约异常且无法保存回执，已封存动作：'+String(err?.message||err).slice(0,90))}
      }
      throw error
    }
  }
  const acknowledge=(id,{confirm=false}={})=>{
    if(confirm!==true||!HEX.test(String(id||'')))return {ok:false,error:'必须明确确认具体的中断动作'}
    const currentScope=(()=>{try{return digest(scope()).slice(0,20)}catch{return ''}})()
    const row=pending().find(x=>x.id===id&&(x.scopeHash===currentScope||!x.scopeHash))
    if(!row)return {ok:false,error:'没有对应的中断预约'}
    if(!row.needsReview)return {ok:false,error:'预约仍可能在执行，30 分钟内禁止清除'}
    if(processAlive(Number(row.pid)))return {ok:false,error:'发起预约的进程仍在运行；先确认进程结束后才能人工清除'}
    const dir=join(locks,id)
    // Explicit release does not assert platform success or reopen the original TODO.
    createReceipt({version:1,id,scopeHash:row.scopeHash||currentScope,at:now(),operation:row.operation,source:row.source,state:'manual-review-no-replay'})
    rmSync(dir,{recursive:true,force:true})
    return {ok:true,status:'manual-review-no-replay',note:'只解除本动作的阻塞；未确认原动作成功，未补写任何业务回执或完成待办。'}
  }
  return {run,status,acknowledge}
}
