/** Minimal maintenance-only web surface; no Life, Python, MCP or cache writers. */
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {readMigrationJob,reconcileInterruptedMigration,requestMigrationCancellation,readMigrationCancellation} from './storage-migration-queue.mjs'
import {writeMaintenanceLease,removeMaintenanceLease} from './storage-migration-maintenance-state.mjs'
import {managementOwnerStatus,managementAuthError,explicitManagementIntent} from './management-host-auth.mjs'

const active=row=>['waiting','running'].includes(row?.status)
const send=(res,status,body)=>{
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'})
 res.end(JSON.stringify(body))
}
export function migrationMaintenanceView(root){
 let row,recoveryUncertain=false
 try{row=reconcileInterruptedMigration(root)}catch{
  // Keep the cancel/status page available when target verification failed.
  // No business module is activated and no pointer is silently repaired.
  row=readMigrationJob(root);recoveryUncertain=true
 }
 const cancellation=active(row)&&readMigrationCancellation(root,row.id)
 return {ok:true,maintenance:active(row),id:row.id||'',status:row.status,domain:row.domain||'',
  operation:row.operation||'',createdAt:row.createdAt||'',startedAt:row.startedAt||'',
  files:row.files||0,bytes:row.bytes||0,reason:row.reason||'',
  cancelRequested:!!cancellation,recoveryUncertain,notice:row.notice||'',phase:row.phase||''}
}
/** Called before the ordinary plugin activation. The returned early-boot
 * handler must not access user data or create business runtimes. */
export function registerMigrationMaintenance(ctx,{root,pluginDir,pollMs=2000}={}){
 const initial=readMigrationJob(root)
 if(!active(initial))return false
 const token=randomUUID(),lease={jobId:initial.id,pid:process.pid,token}
 const tick=()=>{
  const current=readMigrationJob(root)
  if(active(current)&&current.id===lease.jobId)writeMaintenanceLease(root,lease)
  else removeMaintenanceLease(root,token)
 }
 tick()
 const timer=setInterval(()=>{try{tick()}catch{/* worker fails closed when lease is stale */}},pollMs)
 timer.unref?.()
 ctx.effect(()=>()=>{clearInterval(timer);removeMaintenanceLease(root,token)},'bili-duty: 结束迁移维护模式')
 const local=req=>{
  const peer=String(req.socket?.remoteAddress||'')
  const host=String(req.headers.host||''),origin=String(req.headers.origin||'')
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer)&&
   /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)&&
   String(req.headers['sec-fetch-site']||'').toLowerCase()!=='cross-site'&&
   (!origin||['http://'+host,'https://'+host].includes(origin))
 }
 const readBody=req=>new Promise((resolve,reject)=>{
  let raw='',size=0
  req.on('data',part=>{size+=part.length;if(size>1024){reject(Error('请求过大'));req.destroy();return}raw+=part.toString('utf8')})
  req.on('end',()=>{try{resolve(JSON.parse(raw))}catch{reject(Error('无效的请求内容'))}})
  req.on('error',reject)
 })
 ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/api/bili-duty',auth:'required',handler:async(req,res,peer)=>{
  if(!local(req))return send(res,403,{ok:false,error:'仅允许本机同源管理中心操作'})
  const status=await managementOwnerStatus(ctx,req,peer)
  if(status!==200)return send(res,status,managementAuthError(status))
  const path=new URL(req.url,'http://127.0.0.1').pathname
  if(req.method==='GET'&&path==='/api/bili-duty/manage'){
   res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store',
    'x-dafeiyu-management':'1','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"})
   return res.end(readFileSync(join(pluginDir,'lib','migration-wait.html'),'utf8'))
  }
  if(req.method==='GET'&&path==='/api/bili-duty/migration-wait.js'){
   res.writeHead(200,{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'})
   return res.end(readFileSync(join(pluginDir,'lib','migration-wait.js'),'utf8'))
  }
  if(req.method==='GET'&&path==='/api/bili-duty/migration/status'){
   try{return send(res,200,migrationMaintenanceView(root))}catch{return send(res,409,{ok:false,error:'迁移状态不可验证，保持保护'})}
  }
  if(req.method==='POST'&&path==='/api/bili-duty/migration/cancel'){
   if(!explicitManagementIntent(req))
    return send(res,403,{ok:false,error:'只能从本机管理页发起取消'})
   try{
    const body=await readBody(req)
    if(body?.confirm!==true)return send(res,400,{ok:false,error:'取消需要明确确认'})
    return send(res,202,requestMigrationCancellation({root,jobId:body.jobId}))
   }catch(e){return send(res,409,{ok:false,error:String(e?.message||e).slice(0,150)})}
  }
  return send(res,423,{ok:false,maintenance:true,error:'数据迁移尚未结算，业务模块暂停启动；请打开管理中心查看等待状态'})
 }}),'bili-duty: 迁移维护状态与取消入口')
 return true
}
