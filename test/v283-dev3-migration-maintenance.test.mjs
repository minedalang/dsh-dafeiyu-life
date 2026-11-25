import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {queueDomainMigration,readMigrationJob,runQueuedMigration,assertMigrationStartupSafe,
 requestMigrationCancellation,readMigrationCancellation,reconcileInterruptedMigration} from '../lib/storage-migration-queue.mjs'
import {migrationMaintenanceView,registerMigrationMaintenance} from '../lib/storage-migration-maintenance.mjs'
import {writeMaintenanceLease,readMaintenanceExemptPid,removeMaintenanceLease} from '../lib/storage-migration-maintenance-state.mjs'
import {runtimeProcessesStopped} from '../lib/storage-cleanup-queue.mjs'
import {storageLayoutStatus} from '../lib/storage-layout.mjs'
const spawnFake=()=>({pid:43218,unref(){}})
const stopped=()=>({ok:true,conflicts:[]})
const fixture=async fn=>{
 const temp=mkdtempSync(join(tmpdir(),'dsh-migration-maintenance-')),root=join(temp,'bili-duty')
 mkdirSync(root)
 for(const [file,data] of [['uv-cache/one.whl','first'],['pip-cache/two.whl','second'],['.venv/pyvenv.cfg','keep runtime'],
 ['life-memory/fact.json','irreversible memory'],['.hf-cache/model.bin','model'],['embedding-runtime/model.bin','embed']]){
  const dest=join(root,file);mkdirSync(join(dest,'..'),{recursive:true});writeFileSync(dest,data)
 }
 try{return await fn({root,temp})}finally{rmSync(temp,{recursive:true,force:true})}
}
const queue=({root,temp,domain='python',returnHome=false})=>queueDomainMigration({root,domain,
 target:join(temp,domain+'-target'),mode:domain==='python'?'cache':undefined,returnHome,
 parentPid:91231,workerScript:'fake-worker.mjs',spawnImpl:spawnFake})

test('restart with active Python/model/Life migration blocks business code and offers maintenance state',()=>fixture(async({root,temp})=>{
 for(const domain of ['python','model','memory']){
  queue({root,temp,domain})
  const row=migrationMaintenanceView(root)
  assert.equal(row.status,'waiting');assert.equal(row.maintenance,true);assert.equal(row.domain,domain)
  assert.throws(()=>assertMigrationStartupSafe(root),/维护页面/)
  // A terminal task allows another queued migration, but no task can overlap.
  assert.throws(()=>queue({root,temp,domain}),/已有待处理/)
  const jobPath=join(root,'.dafeiyu-domain-migration-job-v1.json')
  writeFileSync(jobPath,JSON.stringify({...readMigrationJob(root),status:'cancelled'})+'\n')
 }
}))

test('cancel during waiting is cooperative, durable and does not copy or switch source',()=>fixture(async({root,temp})=>{
 queue({root,temp})
 const job=readMigrationJob(root),target=job.target
 assert.equal(requestMigrationCancellation({root,jobId:job.id}).requested,true)
 assert.equal(readMigrationCancellation(root,job.id),true)
 const result=await runQueuedMigration({root,jobId:job.id,parentPid:91231,processIsAlive:()=>true,inspectProcesses:stopped})
 assert.equal(result.status,'cancelled')
 assert.equal(readMigrationJob(root).status,'cancelled')
 assert.equal(existsSync(target),false)
 assert.equal(storageLayoutStatus(root).domains.python.configured,false)
 assert.equal(readFileSync(join(root,'.venv/pyvenv.cfg'),'utf8'),'keep runtime')
 assert.doesNotThrow(()=>assertMigrationStartupSafe(root))
 assert.throws(()=>requestMigrationCancellation({root,jobId:job.id}),/已变更或结束/)
}))

test('cancel while copying is observed before publication; no half data becomes active',()=>fixture(async({root,temp})=>{
 queue({root,temp,domain:'model'})
 const job=readMigrationJob(root)
 let checks=0
 const result=await runQueuedMigration({root,parentPid:91231,jobId:job.id,processIsAlive:()=>false,
  inspectProcesses:()=>{
   checks++
   if(checks===2)requestMigrationCancellation({root,jobId:job.id})
   return stopped()
  }})
 assert.equal(result.status,'cancelled')
 assert.equal(readMigrationJob(root).status,'cancelled')
 assert.equal(storageLayoutStatus(root).domains.whisper.configured,false)
 assert.equal(readFileSync(join(root,'.hf-cache/model.bin'),'utf8'),'model')
}))

test('interrupted worker with no pointer publication recovers old Python cache after process exit',()=>fixture(async({root,temp})=>{
 queue({root,temp})
 const job=readMigrationJob(root),old=new Date(Date.now()-90000).toISOString()
 writeFileSync(join(root,'.dafeiyu-domain-migration-job-v1.json'),JSON.stringify({...job,
  workerPid:99990,workerStartedAt:old,status:'running',startedAt:old})+'\n')
 assert.equal(reconcileInterruptedMigration(root,{processIsAlive:()=>true}).status,'running',
  'a live or uncertain worker must never be released by timeout')
 assert.equal(reconcileInterruptedMigration(root,{processIsAlive:()=>false}).status,'failed')
 assert.doesNotThrow(()=>assertMigrationStartupSafe(root))
 assert.equal(storageLayoutStatus(root).domains.python.configured,false)
}))

test('worker died after pointer publication: verified identity reconciles completed status',()=>fixture(async({root,temp})=>{
 queue({root,temp})
 const job=readMigrationJob(root)
 const result=await runQueuedMigration({root,parentPid:91231,jobId:job.id,processIsAlive:()=>false,inspectProcesses:stopped})
 assert.equal(result.ok,true)
 const finished=readMigrationJob(root),old=new Date(Date.now()-90000).toISOString()
 writeFileSync(join(root,'.dafeiyu-domain-migration-job-v1.json'),JSON.stringify({...finished,
  workerPid:99990,workerStartedAt:old,status:'running',startedAt:old})+'\n')
 assert.equal(reconcileInterruptedMigration(root,{processIsAlive:()=>false}).status,'completed')
 assert.equal(storageLayoutStatus(root).domains.python.root,job.target)
}))

test('only fresh maintenance lease PID can be exempted; other Python/DSH processes still block',()=>fixture(async({root})=>{
 const jobId='9b5da3d1-e98c-4a0f-8bd8-b5b9c62f9112',token='secret-token-1234567890'
 writeMaintenanceLease(root,{jobId,pid:7421,token})
 assert.equal(readMaintenanceExemptPid(root,jobId),7421)
 assert.equal(readMaintenanceExemptPid(root,jobId,{now:Date.now()+30000}),null)
 assert.equal(readMaintenanceExemptPid(root,'different-job'),null)
 const exec=(cmd,args)=>({status:0,stdout:' 7421 node\n 7542 python\n 7551 dsh\n'})
 const scanned=runtimeProcessesStopped({platform:'linux',exec,selfPid:99999,ignorePid:readMaintenanceExemptPid(root,jobId)})
 assert.equal(scanned.ok,false)
 assert.equal(scanned.count,2)
 const mac=runtimeProcessesStopped({platform:'darwin',exec,selfPid:99999,ignorePid:readMaintenanceExemptPid(root,jobId)})
 assert.equal(mac.count,2)
 const windows=runtimeProcessesStopped({platform:'win32',exec:()=>({status:0,stdout:'"DSH.exe","7421","Console","1"\n"python.exe","7542","Console","1"\n'}),
   selfPid:99999,ignorePid:readMaintenanceExemptPid(root,jobId)})
 assert.equal(windows.count,1)
 removeMaintenanceLease(root,token)
 assert.equal(readMaintenanceExemptPid(root,jobId),null)
}))

test('maintenance-only plugin registers status/cancel surface without activating business API',()=>fixture(async({root,temp})=>{
 queue({root,temp})
 let handler;const disposers=[]
 const ctx={connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(spec){assert.equal(spec.path,'/api/bili-duty');handler=spec.handler;return ()=>{}}},effect(fn){disposers.push(fn())}}
 try{
  assert.equal(registerMigrationMaintenance(ctx,{root,pluginDir:new URL('..',import.meta.url).pathname}),true)
  const row=migrationMaintenanceView(root);assert.equal(row.maintenance,true)
  assert.equal(row.status,'waiting')
  assert.equal(typeof handler,'function')
  const res=()=>({status:0,body:'',writeHead(status){this.status=status},end(body){this.body=String(body)}})
  const base={socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost:3322','sec-fetch-site':'same-origin'}}
  const result=res()
  await handler({...base,method:'GET',url:'/api/bili-duty/migration/status'},result)
  assert.equal(result.status,200)
  assert.equal(JSON.parse(result.body).status,'waiting')
  const blocked=res()
  await handler({...base,method:'GET',url:'/api/bili-duty/life-memory/status'},blocked)
  assert.equal(blocked.status,423,'all business APIs stay blocked')
  const remote=res()
  await handler({...base,socket:{remoteAddress:'203.0.113.4'},method:'GET',url:'/api/bili-duty/migration/status'},remote)
  assert.equal(remote.status,403)
  const cancelReq=Readable.from([JSON.stringify({jobId:row.id,confirm:true})])
  Object.assign(cancelReq,{method:'POST',url:'/api/bili-duty/migration/cancel',socket:base.socket,
   headers:{...base.headers,origin:'http://localhost:3322'}})
  const cancelResponse=res()
  await handler(cancelReq,cancelResponse)
  assert.equal(cancelResponse.status,202)
  assert.equal(readMigrationCancellation(root,row.id),true)
 }finally{for(const fn of disposers.reverse())fn()}
}))

test('native DSH settings and standalone page show animated wait plus cancellable operation',()=>{
 const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/migration-wait.html',import.meta.url),'utf8')
 const script=readFileSync(new URL('../lib/migration-wait.js',import.meta.url),'utf8')
 assert.match(client,/migration\/status/)
 assert.match(client,/data-bd-migration-spin/)
 assert.match(client,/migration\/cancel/)
 assert.match(html,/id="spinner"/)
 assert.match(html,/id="cancel"/)
 assert.match(script,/setInterval\(refresh,2000\)/)
 assert.doesNotMatch(script,/\.innerHTML\s*=/)
})
