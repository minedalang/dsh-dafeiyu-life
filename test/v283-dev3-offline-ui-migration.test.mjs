import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {storageLayoutStatus} from '../lib/storage-layout.mjs'
import {verifyRelocatedLifeMemory} from '../lib/storage-life-runtime-check.mjs'
import {inspectRetainedLifeCopies} from '../lib/storage-life-retained.mjs'
import {queueLifeCleanup,readLifeCleanupJob,runQueuedLifeCleanup} from '../lib/storage-life-cleanup-queue.mjs'
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

test('Python cache-only waiting job cannot prevent plugin startup; model/Life still block',()=>fixture(async({temp,root})=>{
 const target=join(temp,'pythonData')
 queueDomainMigration({root,domain:'python',mode:'cache',target,workerScript:'worker.mjs',parentPid:88888,spawnImpl:spawnFake})
 const startup=assertMigrationStartupSafe(root)
 assert.equal(startup.startupAllowed,true)
 assert.equal(startup.status,'waiting')
 assert.equal(storageLayoutStatus(root).domains.python.configured,false)
 assert.equal(readFileSync(join(root,'.venv','pyvenv.cfg'),'utf8'),'keep old interpreter')
 assert.equal(readFileSync(join(root,'uv-cache','download.whl'),'utf8'),'cached wheels')
 assert.equal(existsSync(target),false,'no copy needed to activate plugin')
}))

test('power loss during Python cache return-home never locks plugin or elects partial old cache',()=>fixture(async({temp,root})=>{
 const target=join(temp,'pythonData')
 queueDomainMigration({root,domain:'python',mode:'cache',target,workerScript:'worker.mjs',parentPid:88888,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:88888,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 queueDomainMigration({root,domain:'python',returnHome:true,workerScript:'worker.mjs',parentPid:88889,spawnImpl:spawnFake})
 const stateFile=join(root,'.dafeiyu-domain-migration-job-v1.json')
 const row=readMigrationJob(root)
 writeFileSync(stateFile,JSON.stringify({...row,status:'running',startedAt:new Date(0).toISOString(),expiresAt:new Date(0).toISOString()})+'\n')
 // Simulate an interrupted copy after an old root cache was partially moved.
 put(join(root,'uv-cache','partial.whl'),'partial legacy copy')
 const startup=assertMigrationStartupSafe(root)
 assert.equal(startup.startupAllowed,true)
 assert.equal(startup.status,'running')
 assert.equal(storageLayoutStatus(root).domains.python.root,target)
 assert.equal(readFileSync(join(target,'uv-cache','download.whl'),'utf8'),'cached wheels')
 assert.equal(readFileSync(join(root,'.venv','pyvenv.cfg'),'utf8'),'keep old interpreter')
 assert.match(readMigrationJob(root).notice,/超时或中断/)
}))

test('cache-only job marked running after pointer publication still loads verified current storage',()=>fixture(async({temp,root})=>{
 const target=join(temp,'pythonData')
 queueDomainMigration({root,domain:'python',mode:'cache',target,workerScript:'worker.mjs',parentPid:88888,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:88888,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 const stateFile=join(root,'.dafeiyu-domain-migration-job-v1.json')
 const done=readMigrationJob(root)
 writeFileSync(stateFile,JSON.stringify({...done,status:'running',startedAt:new Date(0).toISOString()})+'\n')
 assert.equal(assertMigrationStartupSafe(root).startupAllowed,true)
 assert.equal(storageLayoutStatus(root).domains.python.root,target)
 assert.equal(readFileSync(join(target,'pip-cache','sdist.tar'),'utf8'),'pip download')
}))

test('management page distinguishes safe cache-only restart from strict Life/model stop',()=>{
 const script=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(script,/migration\.domain==='python'\?'Python 缓存迁移已预约 · 不阻止插件启动'/)
 assert.match(script,/migration\.domain==='python'\?'Python 缓存迁移尚未结算 · 插件可正常使用'/)
 assert.match(script,/迁移进行中 · 暂勿启动 DSH/)
})

test('Life memory is queued only; after full stop, deep details, revocations and index move together',()=>fixture(async({temp,root})=>{
 put(join(root,'life-memory','deep','fragment.json'),'newest-life')
 put(join(root,'long-term-memory','facts.json'),'newest-long-term')
 put(join(root,'detail-protection','revoked.json'),'forgotten-id')
 put(join(root,'embedding-memory-index','index.bin'),'current-index')
 const target=join(temp,'different drive','lifeData')
 const queued=queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:88888,spawnImpl:spawnFake})
 assert.equal(queued.scheduled,true)
 assert.equal(existsSync(target),false)
 assert.throws(()=>assertMigrationStartupSafe(root),/waiting/)
 assert.equal(readMigrationJob(root).domain,'memory')
 const res=await runQueuedMigration({root,parentPid:88888,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(res.ok,true)
 assert.equal(readMigrationJob(root).status,'completed')
 assert.equal(storageLayoutStatus(root).domains.memory.root,target)
 for(const [rel,expected] of [
  ['life-memory/deep/fragment.json','newest-life'],
  ['long-term-memory/facts.json','newest-long-term'],
  ['detail-protection/revoked.json','forgotten-id'],
  ['embedding-memory-index/index.bin','current-index']]){
  assert.equal(readFileSync(join(target,...rel.split('/')),'utf8'),expected)
  assert.equal(readFileSync(join(root,...rel.split('/')),'utf8'),expected)
 }
 assert.match(readMigrationJob(root).notice,/遗忘保护/)
 assert.throws(()=>queueDomainMigration({root,domain:'python',mode:'rebuild',target:join(temp,'py'),workerScript:'worker.mjs'}),/仅支持 uv\/pip|不提供/)
}))

test('Life memory return-home takes current authoritative copy, not stale root history',()=>fixture(async({temp,root})=>{
 put(join(root,'long-term-memory','facts.json'),'old-long-term')
 put(join(root,'detail-protection','revoked.json'),'old-revocations')
 const target=join(temp,'external','lifeData')
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:5111,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:5111,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 put(join(target,'life-memory','unique.json'),'new-life-while-external')
 put(join(target,'detail-protection','revoked.json'),'new-revocations')
 queueDomainMigration({root,domain:'memory',returnHome:true,workerScript:'worker.mjs',parentPid:5112,spawnImpl:spawnFake})
 assert.equal(readMigrationJob(root).operation,'return-home')
 const result=await runQueuedMigration({root,parentPid:5112,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(result.ok,true)
 assert.equal(storageLayoutStatus(root).domains.memory.configured,false)
 assert.equal(readFileSync(join(root,'life-memory','unique.json'),'utf8'),'new-life-while-external')
 assert.equal(readFileSync(join(root,'detail-protection','revoked.json'),'utf8'),'new-revocations')
 assert.equal(readFileSync(join(target,'detail-protection','revoked.json'),'utf8'),'new-revocations')
}))

test('Life memory refuses changed source or non-stopped processes, preserving old memory and pointer',()=>fixture(async({temp,root})=>{
 const target=join(temp,'lifeData')
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:6677,spawnImpl:spawnFake})
 put(join(root,'detail-protection','just-forgot.json'),'forgotten')
 const result=await runQueuedMigration({root,parentPid:6677,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(result.ok,false)
 assert.match(result.reason,/发生变化/)
 assert.equal(existsSync(target),false)
 assert.equal(existsSync(join(root,'storage-layout-v1.json')),false)
 assert.equal(readFileSync(join(root,'detail-protection','just-forgot.json'),'utf8'),'forgotten')
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:6678,spawnImpl:spawnFake})
 const denied=await runQueuedMigration({root,parentPid:6678,jobId:readMigrationJob(root).id,processIsAlive:()=>false,
  inspectProcesses:()=>({ok:false,conflicts:['dsh-headless']})})
 assert.equal(denied.ok,false)
 assert.equal(existsSync(target),false)
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

test('management UI queues all three domain groups but keeps root migration offline, never HTTP-copies',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const script=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
 for(const id of ['storage-schedule-migration','storage-scheduled-steps','storage-migration-job-status','storage-offline-steps'])
  assert.ok(html.includes(`id="${id}"`),id)
 assert.match(script,/request\('\/storage\/schedule-migration'/)
 assert.match(script,/\['model','python','memory'\]\.includes\(domain\)/)
 assert.match(script,/Life 记忆已迁移 · 请核验回忆与遗忘保护/)
 assert.match(script,/Life 记忆、深层详情、遗忘保护与向量索引必须一致迁移/)
 assert.match(host,/\['model','python','memory'\]\.includes\(body\?\.domain\)/)
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

test('model return HOME is queued only after migration, and uses current active model copy',()=>fixture(async({temp,root})=>{
 const target=join(temp,'first destination','modelData')
 queueDomainMigration({root,domain:'model',target,workerScript:'worker.mjs',parentPid:888,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:888,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 put(join(target,'.hf-cache','model.bin'),'model changed after migration')
 queueDomainMigration({root,domain:'model',returnHome:true,workerScript:'worker.mjs',parentPid:999,spawnImpl:spawnFake})
 assert.equal(readMigrationJob(root).operation,'return-home')
 assert.equal(readFileSync(join(root,'.hf-cache','model.bin'),'utf8'),'whisper-source')
 const res=await runQueuedMigration({root,parentPid:999,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(res.ok,true)
 assert.equal(readFileSync(join(root,'.hf-cache','model.bin'),'utf8'),'model changed after migration')
 assert.equal(storageLayoutStatus(root).domains.whisper.configured,false)
 assert.equal(readMigrationJob(root).status,'completed')
}))

test('failed return HOME keeps external model as live source and old root copy untouched',()=>fixture(async({temp,root})=>{
 const target=join(temp,'target')
 queueDomainMigration({root,domain:'model',target,workerScript:'worker.mjs',parentPid:888,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:888,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 queueDomainMigration({root,domain:'model',returnHome:true,workerScript:'worker.mjs',parentPid:999,spawnImpl:spawnFake})
 put(join(target,'.hf-cache','extra.bin'),'unexpected update')
 const result=await runQueuedMigration({root,parentPid:999,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(result.ok,false)
 assert.equal(storageLayoutStatus(root).domains.whisper.root,target)
 assert.equal(readFileSync(join(root,'.hf-cache','model.bin'),'utf8'),'whisper-source')
}))


test('Life post-migration check is read-only, verifies live recall, revocations and optional index',()=>fixture(async({temp,root})=>{
 const id='e-'+'a'.repeat(18),target=join(temp,'lifeData')
 const episodic={version:1,episodes:[{id,kind:'watch',stage:'clear',at:Date.now(),text:'我曾经看过一段有意义的视频',visibility:'public-event'}],archiveKeys:[],updatedAt:1}
 put(join(root,'life-memory','episodic.json'),JSON.stringify(episodic))
 put(join(root,'detail-protection','revocations-v1.json'),JSON.stringify({version:1,ids:[]}))
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:9081,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:9081,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 const before=readFileSync(join(target,'life-memory','episodic.json'),'utf8')
 const good=verifyRelocatedLifeMemory({root})
 assert.equal(good.ready,true,JSON.stringify(good.checks))
 assert.equal(good.checks.recall.ok,true)
 assert.equal(good.checks.vectors.notApplicable,true)
 assert.equal(readFileSync(join(target,'life-memory','episodic.json'),'utf8'),before,'Life verification must never decay or update memory')
 episodic.episodes[0].stage='forgotten'
 put(join(target,'life-memory','episodic.json'),JSON.stringify(episodic))
 const failed=verifyRelocatedLifeMemory({root})
 assert.equal(failed.ready,false)
 assert.match(failed.checks.episodes.reason,/遗忘/)
 assert.equal(storageLayoutStatus(root).domains.memory.root,target,'failure must never change the active pointer')
}))

test('Life failed check may queue safe undo using newest external memory, never revive stale C copy',()=>fixture(async({temp,root})=>{
 const id='e-'+'b'.repeat(18),target=join(temp,'lifeData')
 put(join(root,'long-term-memory','sample.json'),JSON.stringify({version:1,rows:[]}))
 put(join(root,'embedding-memory-index','old.bin'),'index bytes')
 put(join(root,'life-memory','episodic.json'),JSON.stringify({version:1,episodes:[],archiveKeys:[],updatedAt:1}))
 put(join(root,'detail-protection','revocations-v1.json'),JSON.stringify({version:1,ids:[]}))
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:9082,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:9082,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 const newest={version:1,episodes:[{id,stage:'forgotten',text:'PRIVATE TEXT MUST NOT BE READ',at:Date.now()}],archiveKeys:[],updatedAt:2}
 put(join(target,'life-memory','episodic.json'),JSON.stringify(newest))
 put(join(target,'detail-protection','revocations-v1.json'),JSON.stringify({version:1,ids:[id]}))
 assert.equal(verifyRelocatedLifeMemory({root}).ready,false)
 queueDomainMigration({root,domain:'memory',returnHome:true,workerScript:'worker.mjs',parentPid:9083,spawnImpl:spawnFake})
 assert.equal(storageLayoutStatus(root).domains.memory.root,target,'undo must remain queued until DSH exits')
 assert.equal(readMigrationJob(root).operation,'return-home')
 const done=await runQueuedMigration({root,parentPid:9083,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(done.ok,true)
 assert.equal(storageLayoutStatus(root).domains.memory.configured,false)
 assert.deepEqual(JSON.parse(readFileSync(join(root,'detail-protection','revocations-v1.json'))).ids,[id])
 assert.equal(JSON.parse(readFileSync(join(root,'life-memory','episodic.json'))).episodes[0].stage,'forgotten')
 assert.equal(existsSync(join(target,'life-memory','episodic.json')),true,'external copy retained for safety')
 assert.ok(done.oldRootCopyArchive,'stale root copy is quarantined, never merged')
}))

test('Life undo is rejected if current authoritative memory vanished, leaving pointer untouched',()=>fixture(async({temp,root})=>{
 const target=join(temp,'lifeData')
 put(join(root,'life-memory','episodic.json'),JSON.stringify({version:1,episodes:[],archiveKeys:[]}))
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:9084,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:9084,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 rmSync(join(target,'life-memory','episodic.json'))
 assert.throws(()=>queueDomainMigration({root,domain:'memory',returnHome:true,workerScript:'worker.mjs',spawnImpl:spawnFake}),/缺少关键数据/)
 assert.equal(storageLayoutStatus(root).domains.memory.root,target)
}))

test('Life return-home supports read-only verification of CURRENT default directory without exposing external-copy deletion',()=>fixture(async({temp,root})=>{
 const id='e-'+'d'.repeat(18),target=join(temp,'lifeData')
 put(join(root,'life-memory','episodic.json'),JSON.stringify({version:1,episodes:[
  {id,kind:'watch',stage:'clear',at:Date.now(),text:'一条可回忆的安全测试经历',visibility:'public-event'}
 ],archiveKeys:[],updatedAt:1}))
 put(join(root,'long-term-memory','dafeiyu.json'),JSON.stringify({version:3,scope:'dafeiyu-identity',memories:[],deleted:[]}))
 put(join(root,'detail-protection','revocations-v1.json'),JSON.stringify({version:1,ids:[]}))
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:9901,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:9901,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 queueDomainMigration({root,domain:'memory',returnHome:true,workerScript:'worker.mjs',parentPid:9902,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:9902,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(readMigrationJob(root).operation,'return-home')
 assert.equal(storageLayoutStatus(root).domains.memory.configured,false)
 const current=join(root,'life-memory','episodic.json'),before=readFileSync(current,'utf8')
 assert.equal(verifyRelocatedLifeMemory({root}).ready,false,'default-home verification must remain opt-in')
 const verified=verifyRelocatedLifeMemory({root,allowDefaultHome:true})
 assert.equal(verified.ready,true,JSON.stringify(verified.checks))
 assert.equal(verified.target,root)
 assert.equal(verified.checks.identity.returnedHome,true)
 assert.equal(verified.checks.recall.ok,true)
 assert.equal(readFileSync(current,'utf8'),before,'return-home check must never rewrite memory')
 assert.equal(inspectRetainedLifeCopies({root,verify:true}).eligible,false,'default home must never be treated as retained old C copy')
 const episodes=JSON.parse(before);episodes.episodes[0].stage='forgotten'
 put(current,JSON.stringify(episodes))
 const failed=verifyRelocatedLifeMemory({root,allowDefaultHome:true})
 assert.equal(failed.ready,false)
 assert.match(failed.checks.episodes.reason,/遗忘/)
 assert.equal(storageLayoutStatus(root).domains.memory.root,root,'failed verification must not switch sources')
}))

test('Life verification and explicit safe-undo controls are gated in same-origin management UI',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const script=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 for(const id of ['storage-life-verify-panel','storage-life-verify','storage-life-undo','storage-life-undo-button','storage-life-verify-result'])
  assert.match(html,new RegExp(`id="${id}"`))
 assert.match(script,/storage\/verify-life-memory/)
 assert.match(script,/domain:'memory',returnHome:true/)
 assert.match(script,/Life 存储位置/)
 assert.match(index,/verifyRelocatedLifeMemory\(\{root:stateDir,allowDefaultHome:returnedHome\}\)/)
 assert.match(index,/migration\.domain==='memory'&&migration\.operation==='return-home'/)
 assert.match(script,/lifeReturnedHome/)
 assert.match(script,/storageLifeCheckLocation==='default'/)
 assert.match(index,/sec-fetch-site/)
 assert.doesNotMatch(index,/returnDomainHomeOffline\(\{root:stateDir/)
})


test('Life one-click verification can schedule verified old-copy cleanup, but only after actual shutdown',()=>fixture(async({temp,root})=>{
 const target=join(temp,'lifeData'),id='e-'+'c'.repeat(18)
 put(join(root,'life-memory','episodic.json'),JSON.stringify({version:1,episodes:[],archiveKeys:[],updatedAt:1}))
 put(join(root,'detail-protection','revocations-v1.json'),JSON.stringify({version:1,ids:[]}))
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:9191,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:9191,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 put(join(target,'life-memory','episodic.json'),JSON.stringify({version:1,episodes:[{id,stage:'forgotten',text:'',at:Date.now()}],archiveKeys:[],updatedAt:2}))
 put(join(target,'detail-protection','revocations-v1.json'),JSON.stringify({version:1,ids:[id]}))
 const probe=verifyRelocatedLifeMemory({root})
 assert.equal(probe.ready,true,JSON.stringify(probe.checks))
 const old=inspectRetainedLifeCopies({root,verify:true})
 assert.equal(old.verified,true,old.reason)
 const action=queueLifeCleanup({root,verification:{ready:true,at:Date.now(),target},workerScript:'worker.mjs',parentPid:9192,spawnImpl:spawnFake})
 assert.equal(action.scheduled,true)
 assert.equal(existsSync(join(root,'life-memory','episodic.json')),true)
 assert.throws(()=>assertMigrationStartupSafe(root),/Life 旧副本清理/)
 const result=await runQueuedLifeCleanup({root,parentPid:9192,jobId:readLifeCleanupJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(result.ok,true)
 assert.equal(readLifeCleanupJob(root).status,'completed')
 assert.equal(existsSync(join(root,'life-memory')),false,'only old root Life files deleted')
 assert.equal(existsSync(join(target,'life-memory','episodic.json')),true)
 assert.equal(storageLayoutStatus(root).domains.memory.root,target)
 assert.deepEqual(JSON.parse(readFileSync(join(target,'detail-protection','revocations-v1.json'))).ids,[id])
 assert.equal(existsSync(join(root,'.dafeiyu-life-cleanup-v1.json')),true)
}))

test('Life cleanup is cancelled on current/old content drift; never deletes stale root automatically',()=>fixture(async({temp,root})=>{
 const target=join(temp,'lifeData')
 put(join(root,'life-memory','episodic.json'),JSON.stringify({version:1,episodes:[],archiveKeys:[],updatedAt:1}))
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:9291,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:9291,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 queueLifeCleanup({root,verification:{ready:true,at:Date.now(),target},workerScript:'worker.mjs',parentPid:9292,spawnImpl:spawnFake})
 put(join(target,'life-memory','new.json'),'changed after UI verification')
 const result=await runQueuedLifeCleanup({root,parentPid:9292,jobId:readLifeCleanupJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(result.ok,false)
 assert.equal(existsSync(join(root,'life-memory','episodic.json')),true)
 assert.equal(existsSync(join(target,'life-memory','new.json')),true)
 assert.equal(storageLayoutStatus(root).domains.memory.root,target)
 assert.equal(readLifeCleanupJob(root).status,'failed')
}))

test('a stale root forgetting revocation not present in target prevents Life cleanup',()=>fixture(async({temp,root})=>{
 const target=join(temp,'lifeData'),id='e-'+'d'.repeat(18)
 put(join(root,'life-memory','episodic.json'),JSON.stringify({version:1,episodes:[],archiveKeys:[]}))
 put(join(root,'detail-protection','revocations-v1.json'),JSON.stringify({version:1,ids:[id]}))
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:9391,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:9391,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 put(join(target,'detail-protection','revocations-v1.json'),JSON.stringify({version:1,ids:[]}))
 const report=inspectRetainedLifeCopies({root,verify:true})
 assert.equal(report.eligible,false)
 assert.match(report.reason,/遗忘撤销/)
 assert.equal(existsSync(join(root,'detail-protection','revocations-v1.json')),true)
}))


test('Life cleanup never deletes while parent remains alive, and safely times out',()=>fixture(async({temp,root})=>{
 const target=join(temp,'lifeData')
 put(join(root,'life-memory','episodic.json'),JSON.stringify({version:1,episodes:[],archiveKeys:[]}))
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:9491,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:9491,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 queueLifeCleanup({root,verification:{ready:true,at:Date.now(),target},workerScript:'worker.mjs',parentPid:9492,spawnImpl:spawnFake})
 let clock=Date.now()
 const result=await runQueuedLifeCleanup({root,parentPid:9492,jobId:readLifeCleanupJob(root).id,
  processIsAlive:()=>true,inspectProcesses:()=>{throw Error('must not inspect/delete while parent lives')},
  now:()=>clock,pause:async()=>{clock+=31*60*1000}})
 assert.equal(result.ok,false)
 assert.equal(readLifeCleanupJob(root).status,'failed')
 assert.equal(existsSync(join(root,'life-memory','episodic.json')),true)
 assert.equal(storageLayoutStatus(root).domains.memory.root,target)
}))

test('Life cleanup refuses to delete a unique long-term fact missing from active memory',()=>fixture(async({temp,root})=>{
 const target=join(temp,'lifeData')
 put(join(root,'life-memory','episodic.json'),JSON.stringify({version:1,episodes:[],archiveKeys:[]}))
 put(join(root,'long-term-memory','dafeiyu.json'),JSON.stringify({version:3,scope:'dafeiyu-identity',memories:[{id:'long-unique',text:'唯一的长期记忆'}],deleted:[]}))
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:9910,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:9910,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 put(join(target,'long-term-memory','dafeiyu.json'),JSON.stringify({version:3,scope:'dafeiyu-identity',memories:[],deleted:[]}))
 assert.equal(verifyRelocatedLifeMemory({root}).ready,true,'file-level Life read verification alone is insufficient for deletion')
 const report=inspectRetainedLifeCopies({root,verify:true})
 assert.equal(report.eligible,false)
 assert.match(report.reason,/长期事实/)
 assert.equal(existsSync(join(root,'long-term-memory','dafeiyu.json')),true)
}))

test('Life cleanup refuses when active still-clear deep detail is missing',()=>fixture(async({temp,root})=>{
 const target=join(temp,'lifeData'),id='e-'+'f'.repeat(18),account='a'.repeat(16)
 put(join(root,'life-memory','episodic.json'),JSON.stringify({version:1,episodes:[{id,stage:'clear',text:'在视频中看到的情节',kind:'watch',visibility:'public-event',accountTag:account,at:1000,bvid:'BV1'}],archiveKeys:[]}))
 const oldDetail=join(root,'life-memory','details','v1',account,id+'.json')
 put(oldDetail,JSON.stringify({schema:'life-memory-detail/v1'}))
 queueDomainMigration({root,domain:'memory',target,workerScript:'worker.mjs',parentPid:9911,spawnImpl:spawnFake})
 await runQueuedMigration({root,parentPid:9911,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 rmSync(join(target,'life-memory','details','v1',account,id+'.json'))
 const report=inspectRetainedLifeCopies({root,verify:true})
 assert.equal(report.eligible,false)
 assert.match(report.reason,/可回忆深层详情/)
 assert.equal(existsSync(oldDetail),true)
}))
