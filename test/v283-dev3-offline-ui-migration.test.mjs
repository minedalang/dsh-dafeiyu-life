import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {storageLayoutStatus} from '../lib/storage-layout.mjs'
import {queueDomainMigration,runQueuedMigration,readMigrationJob,assertMigrationStartupSafe} from '../lib/storage-migration-queue.mjs'

const put=(name,text)=>{mkdirSync(dirname(name),{recursive:true});writeFileSync(name,text)}
const fixture=async fn=>{
 const temp=mkdtempSync(join(tmpdir(),'dsh283-auto-停机-')),root=join(temp,'bili-duty')
 mkdirSync(root)
 put(join(root,'.hf-cache','model.bin'),'whisper-source')
 put(join(root,'embedding-runtime','weights.bin'),'embedding-source')
 put(join(root,'vision-cache','image.txt'),'visual-source')
 put(join(root,'uv-cache','download.whl'),'cached wheels')
 put(join(root,'pip-cache','sdist.tar'),'pip download')
 put(join(root,'.venv','pyvenv.cfg'),'keep old interpreter')
 put(join(root,'life-memory','unique.json'),'keep precious Life memory')
 try{return await fn({temp,root})}finally{rmSync(temp,{recursive:true,force:true})}
}
const spawnFake=()=>({pid:811,unref(){}})
const clear=()=>({ok:true,conflicts:[]})

test('model button queues without copying, blocks plugin startup, worker copies only after shutdown',()=>fixture(async({temp,root})=>{
 const target=join(temp,'other disk','modelData')
 const queued=queueDomainMigration({root,domain:'model',target,workerScript:'worker.mjs',parentPid:99999,spawnImpl:spawnFake})
 assert.equal(queued.scheduled,true)
 assert.equal(existsSync(target),false)
 assert.match(readMigrationJob(root).status,/waiting/)
 assert.throws(()=>assertMigrationStartupSafe(root),/仍处于 waiting/)
 assert.throws(()=>queueDomainMigration({root,domain:'model',target,workerScript:'worker.mjs',spawnImpl:spawnFake}),/已有待处理/)
 const jobId=readMigrationJob(root).id
 const result=await runQueuedMigration({root,parentPid:99999,jobId,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(result.ok,true)
 assert.equal(readMigrationJob(root).status,'completed')
 assert.equal(storageLayoutStatus(root).domains.whisper.root,target)
 assert.equal(storageLayoutStatus(root).domains.embedding.root,target)
 assert.equal(storageLayoutStatus(root).domains.media.root,target)
 assert.equal(readFileSync(join(target,'.hf-cache','model.bin'),'utf8'),'whisper-source')
 assert.equal(readFileSync(join(root,'.hf-cache','model.bin'),'utf8'),'whisper-source')
 assert.equal(readFileSync(join(root,'life-memory','unique.json'),'utf8'),'keep precious Life memory')
 assert.doesNotThrow(()=>assertMigrationStartupSafe(root))
}))

test('Python one-click moves only uv/pip caches, never rebuilds environments',()=>fixture(async({temp,root})=>{
 const target=join(temp,'pythonData')
 queueDomainMigration({root,domain:'python',mode:'cache',target,workerScript:'worker.mjs',parentPid:88888,spawnImpl:spawnFake})
 const res=await runQueuedMigration({root,parentPid:88888,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(res.ok,true)
 assert.equal(readFileSync(join(target,'uv-cache','download.whl'),'utf8'),'cached wheels')
 assert.equal(readFileSync(join(target,'pip-cache','sdist.tar'),'utf8'),'pip download')
 assert.equal(existsSync(join(target,'.venv')),false)
 assert.equal(readFileSync(join(root,'.venv','pyvenv.cfg'),'utf8'),'keep old interpreter')
 assert.equal(readFileSync(join(root,'life-memory','unique.json'),'utf8'),'keep precious Life memory')
 assert.equal(storageLayoutStatus(root).domains.python.mode,'cache')
}))

test('Life-memory auto scheduling is rejected and root data unaffected',()=>fixture(async({temp,root})=>{
 assert.throws(()=>queueDomainMigration({root,domain:'memory',target:join(temp,'lifeData'),workerScript:'worker.mjs'}),/Life 记忆/)
 assert.throws(()=>queueDomainMigration({root,domain:'python',mode:'rebuild',target:join(temp,'py'),workerScript:'worker.mjs'}),/仅支持 uv\/pip|不提供/)
 assert.equal(existsSync(join(root,'storage-layout-v1.json')),false)
}))

test('conflicting processes fail closed without changing source or destination',()=>fixture(async({temp,root})=>{
 const target=join(temp,'modelData')
 queueDomainMigration({root,domain:'model',target,workerScript:'worker.mjs',parentPid:7777,spawnImpl:spawnFake})
 const result=await runQueuedMigration({root,parentPid:7777,jobId:readMigrationJob(root).id,processIsAlive:()=>false,
  inspectProcesses:()=>({ok:false,conflicts:['python3.12']})})
 assert.equal(result.ok,false)
 assert.equal(readMigrationJob(root).status,'failed')
 assert.equal(existsSync(target),false)
 assert.equal(existsSync(join(root,'storage-layout-v1.json')),false)
 assert.equal(readFileSync(join(root,'.hf-cache','model.bin'),'utf8'),'whisper-source')
}))

test('changes between schedule and stop require a fresh explicit queue, never migrate stale snapshot',()=>fixture(async({temp,root})=>{
 const target=join(temp,'modelData')
 queueDomainMigration({root,domain:'model',target,workerScript:'worker.mjs',parentPid:7777,spawnImpl:spawnFake})
 put(join(root,'.hf-cache','new-download.bin'),'new file')
 const result=await runQueuedMigration({root,parentPid:7777,jobId:readMigrationJob(root).id,
  processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(result.ok,false)
 assert.match(result.reason,/发生变化/)
 assert.equal(existsSync(target),false)
 assert.equal(existsSync(join(root,'storage-layout-v1.json')),false)
}))

test('parent stays alive until timeout, no background copying or deletion',()=>fixture(async({temp,root})=>{
 const target=join(temp,'modelData')
 queueDomainMigration({root,domain:'model',target,workerScript:'worker.mjs',parentPid:7777,spawnImpl:spawnFake})
 let clock=Date.now(),ticks=0
 const result=await runQueuedMigration({root,parentPid:7777,jobId:readMigrationJob(root).id,
  processIsAlive:()=>true,inspectProcesses:()=>{throw Error('should not scan before shutdown')},
  now:()=>clock,pause:async()=>{ticks++;clock+=31*60*1000}})
 assert.equal(ticks,1)
 assert.equal(result.ok,false)
 assert.equal(existsSync(target),false)
 assert.equal(readMigrationJob(root).status,'failed')
}))

test('unsafe worker identity cannot migrate files',()=>fixture(async({temp,root})=>{
 const target=join(temp,'modelData')
 queueDomainMigration({root,domain:'model',target,workerScript:'worker.mjs',parentPid:7777,spawnImpl:spawnFake})
 await assert.rejects(()=>runQueuedMigration({root,parentPid:7777,jobId:'wrong',processIsAlive:()=>false,inspectProcesses:clear}),/身份/)
 assert.equal(existsSync(target),false)
}))

test('in-progress or expired running job blocks DSH startup to prevent concurrent writes',()=>fixture(async({temp,root})=>{
 const target=join(temp,'modelData')
 queueDomainMigration({root,domain:'model',target,workerScript:'worker.mjs',parentPid:7777,spawnImpl:spawnFake})
 const job=readMigrationJob(root)
 writeFileSync(join(root,'.dafeiyu-domain-migration-job-v1.json'),JSON.stringify({...job,status:'running',expiresAt:'2020-01-01T00:00:00Z'}))
 assert.equal(readMigrationJob(root).status,'running')
 assert.throws(()=>assertMigrationStartupSafe(root),/仍处于 running/)
 assert.throws(()=>queueDomainMigration({root,domain:'model',target,workerScript:'worker.mjs',spawnImpl:spawnFake}),/已有待处理/)
}))

test('management UI uses a shutdown queue, retains separate manual Life workflow, and never HTTP-copies',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const script=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
 for(const id of ['storage-schedule-migration','storage-scheduled-steps','storage-migration-job-status','storage-offline-steps'])
  assert.ok(html.includes(`id="${id}"`),id)
 assert.match(script,/request\('\/storage\/schedule-migration'/)
 assert.match(script,/domain==='model'\|\|domain==='python'/)
 assert.match(script,/if\(domain==='model'\|\|domain==='python'\)/)
 assert.match(host,/assertMigrationStartupSafe\(stateDir\)/)
 assert.match(host,/SCHEDULE_STOPPED_MIGRATION/)
 assert.match(host,/仅允许电脑本机同源/)
 assert.doesNotMatch(host,/migrateDomainOffline\(/)
 assert.ok(pkg.files.includes('scripts/migrate-bili-duty-after-exit.mjs'))
})

test('worker spawn keeps detached child, no terminal shell expansion and no immediate source change',()=>fixture(async({temp,root})=>{
 const target=join(temp,"新 空目录 ' DSH",'modelData')
 let command,args,options
 queueDomainMigration({root,domain:'model',target,workerScript:"/some/worker with ' quote.mjs",parentPid:12010,
  spawnImpl:(cmd,argv,opt)=>{command=cmd;args=argv;options=opt;return spawnFake()}})
 assert.equal(command,process.execPath)
 assert.deepEqual(args.slice(0,2),["/some/worker with ' quote.mjs",'--root'])
 assert.ok(args.includes(target)===false,'target passed in bounded task file, not command line')
 assert.equal(options.shell,false)
 assert.equal(options.detached,true)
 assert.equal(options.stdio,'ignore')
 assert.equal(existsSync(target),false)
}))
