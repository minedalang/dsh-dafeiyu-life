import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {inspectDomainMigration,storageDataPath,storageLayoutStatus} from '../lib/storage-layout.mjs'
import {queueDomainMigration,runQueuedMigration,readMigrationJob} from '../lib/storage-migration-queue.mjs'
import {inspectExternalLifeCopy,deleteExternalLifeCopy} from '../lib/storage-external-life-retired.mjs'
import {queueExternalLifeCleanup,runQueuedLifeCleanup,readLifeCleanupJob} from '../lib/storage-life-cleanup-queue.mjs'
import {storageArchiveInventory} from '../lib/storage-archive-inventory.mjs'
import {readLifeReturnEvidence} from '../lib/storage-life-return-evidence.mjs'
const put=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value))}
const clear=()=>({ok:true,conflicts:[]})
const blocked=()=>({ok:false,conflicts:['python.exe']})
const spawnFake=()=>({pid:81231,unref(){}})
const parent=81233
async function fixture(fn){
 const temp=mkdtempSync(join(tmpdir(),'dafeiyu-explicit-retire-'))
 const root=join(temp,'bili-duty'),target=join(temp,'data-drive','lifeData');mkdirSync(root)
 try{
  put(join(root,'life-memory','episodic.json'),{version:1,episodes:[],archiveKeys:[],updatedAt:0})
  put(join(root,'long-term-memory','dafeiyu.json'),{version:3,scope:'dafeiyu-identity',policy:{},memories:[],traces:[],deleted:[],migration:{legacySessionFiles:[]}})
  put(join(root,'detail-protection','revocations-v1.json'),{version:1,ids:[]})
  const opts={root,domain:'memory',target,workerScript:'unused.mjs',parentPid:parent,spawnImpl:spawnFake}
  queueDomainMigration(opts)
  const moved=await runQueuedMigration({root,parentPid:parent,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
  assert.equal(moved.ok,true)
  queueDomainMigration({...opts,returnHome:true})
  const returned=await runQueuedMigration({root,parentPid:parent,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
  assert.equal(returned.ok,true)
  assert.equal(storageLayoutStatus(root).domains.memory.configured,false)
  assert.equal(readMigrationJob(root).externalSnapshot?.target,target)
  assert.equal(storageDataPath(root,'life-memory','episodic.json'),join(root,'life-memory','episodic.json'))
  return await fn({temp,root,target})
 }finally{rmSync(temp,{recursive:true,force:true})}
}
test('nonempty old D target NEVER becomes an implicit migration, even with valid same-instance marker',()=>fixture(({root,target})=>{
 assert.throws(()=>inspectDomainMigration({root,domain:'memory',target}),/必须为空|不允许自动复用/)
 assert.equal(existsSync(join(target,'life-memory','episodic.json')),true)
 put(join(target,'life-memory','my-own-extra.json'),'user new data')
 assert.throws(()=>inspectDomainMigration({root,domain:'memory',target}),/必须为空/)
 assert.equal(readFileSync(join(target,'life-memory','my-own-extra.json'),'utf8'),'user new data')
}))
test('explicit offline cleanup deletes old D only after read-only check and fresh SHA, then migration to same EMPTY target works',()=>fixture(async({root,target,temp})=>{
 const verified=inspectExternalLifeCopy({root,verify:true})
 assert.equal(verified.eligible,true)
 assert.equal(verified.proof,'return-home-snapshot')
 assert.throws(()=>deleteExternalLifeCopy({root,expected:verified,confirmedStopped:true}),/确认/)
 assert.equal(existsSync(target),true)
 const queued=queueExternalLifeCleanup({root,verification:{ready:true,at:Date.now(),target,fingerprint:verified.fingerprint},workerScript:'unused.mjs',parentPid:parent,spawnImpl:spawnFake})
 assert.equal(queued.scheduled,true)
 assert.equal(readLifeCleanupJob(root).kind,'external-life')
 const result=await runQueuedLifeCleanup({root,parentPid:parent,jobId:readLifeCleanupJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(result.ok,true)
 assert.equal(existsSync(target),false)
 assert.equal(readLifeCleanupJob(root).status,'completed')
 assert.ok(readFileSync(join(root,'life-memory','episodic.json'),'utf8').includes('episodes'))
 assert.equal(inspectDomainMigration({root,domain:'memory',target}).ok,true)
 assert.deepEqual(readdirSync(dirname(target)),[])
}))
test('added user file nested under a known Life folder invalidates old D snapshot, and deletion refuses',()=>fixture(({root,target})=>{
 const before=inspectExternalLifeCopy({root,verify:true})
 put(join(target,'life-memory','personal-note.txt'),'user-added item')
 assert.throws(()=>inspectExternalLifeCopy({root,verify:true}),/新增或修改/)
 assert.throws(()=>deleteExternalLifeCopy({root,expected:before,confirmedStopped:true,confirmedDelete:true}),/新增或修改/)
 assert.equal(readFileSync(join(target,'life-memory','personal-note.txt'),'utf8'),'user-added item')
}))
test('new top-level user file or edited old Life record also blocks deletion and keeps both copies',()=>fixture(({root,target})=>{
 put(join(target,'notes.txt'),'not ours')
 assert.throws(()=>inspectExternalLifeCopy({root,verify:true}),/其他文件/)
 rmSync(join(target,'notes.txt'))
 put(join(target,'life-memory','episodic.json'),'{"user":"new"}')
 assert.throws(()=>inspectExternalLifeCopy({root,verify:true}),/新增或修改/)
 assert.equal(existsSync(join(root,'life-memory','episodic.json')),true)
}))
test('legacy return-home without a captured snapshot uses byte-identical-to-current rule; a unique D file blocks cleanup',()=>fixture(({root,target})=>{
 const filename=join(root,'.dafeiyu-domain-migration-job-v1.json')
 const old=JSON.parse(readFileSync(filename,'utf8'));delete old.externalSnapshot;writeFileSync(filename,JSON.stringify(old))
 assert.equal(inspectExternalLifeCopy({root,verify:true}).proof,'strict-current-copy')
 put(join(target,'life-memory','unique-after-return.json'),'do not delete')
 assert.throws(()=>inspectExternalLifeCopy({root,verify:true}),/没有的资料/)
 assert.equal(existsSync(join(target,'life-memory','unique-after-return.json')),true)
}))
test('legacy return-home keeps old D if C memory has changed, even with identical file names',()=>fixture(({root,target})=>{
 const filename=join(root,'.dafeiyu-domain-migration-job-v1.json')
 const old=JSON.parse(readFileSync(filename,'utf8'));delete old.externalSnapshot;writeFileSync(filename,JSON.stringify(old))
 put(join(root,'life-memory','episodic.json'),{version:1,episodes:[],archiveKeys:[],updatedAt:1234567})
 assert.throws(()=>inspectExternalLifeCopy({root,verify:true}),/不相同/)
 assert.equal(existsSync(target),true)
}))
test('blocked stop check or SHA changed since schedule never deletes old D',()=>fixture(async({root,target})=>{
 const report=inspectExternalLifeCopy({root,verify:true})
 queueExternalLifeCleanup({root,verification:{ready:true,at:Date.now(),target,fingerprint:report.fingerprint},workerScript:'unused.mjs',parentPid:parent,spawnImpl:spawnFake})
 const jobId=readLifeCleanupJob(root).id
 const stopped=await runQueuedLifeCleanup({root,parentPid:parent,jobId,processIsAlive:()=>false,inspectProcesses:blocked})
 assert.equal(stopped.ok,false)
 assert.equal(existsSync(target),true)
 assert.equal(readLifeCleanupJob(root).status,'failed')
 queueExternalLifeCleanup({root,verification:{ready:true,at:Date.now(),target,fingerprint:report.fingerprint},workerScript:'unused.mjs',parentPid:parent,spawnImpl:spawnFake})
 put(join(target,'life-memory','user-new-file'),'new before worker')
 const changed=await runQueuedLifeCleanup({root,parentPid:parent,jobId:readLifeCleanupJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(changed.ok,false)
 assert.equal(existsSync(join(target,'life-memory','user-new-file')),true)
}))
test('verification may not operate on active external Life and cannot be scheduled without a valid completion record',()=>fixture(({root,target})=>{
 const jobFile=join(root,'.dafeiyu-domain-migration-job-v1.json')
 const job=JSON.parse(readFileSync(jobFile,'utf8'));job.status='failed';writeFileSync(jobFile,JSON.stringify(job))
 rmSync(join(root,'.dafeiyu-life-return-evidence-v1.json'))
 assert.throws(()=>inspectExternalLifeCopy({root,verify:true}),/没有可核验的 Life 回迁完成记录/)
 assert.equal(existsSync(target),true)
}))

test('persistent Life return-home evidence survives a later unrelated migration job',()=>fixture(async({root,target})=>{
 const evidence=readLifeReturnEvidence(root,{migrationJob:readMigrationJob(root)})
 assert.equal(evidence.externalSources[0],target)
 // A second migration overwrites the shared job journal. Keep the Life proof.
 put(join(root,'uv-cache','wheel.bin'),'cached')
 queueDomainMigration({root,domain:'python',target:join(dirname(target),'pythonData'),workerScript:'unused.mjs',parentPid:parent,spawnImpl:spawnFake})
 const other=await runQueuedMigration({root,parentPid:parent,jobId:readMigrationJob(root).id,processIsAlive:()=>false,inspectProcesses:clear})
 assert.equal(other.ok,true)
 assert.equal(readMigrationJob(root).domain,'python')
 assert.equal(readLifeReturnEvidence(root,{migrationJob:readMigrationJob(root)}).externalSources[0],target)
 assert.equal(inspectExternalLifeCopy({root,verify:true}).eligible,true)
 assert.ok(storageArchiveInventory({root,migrationJob:readMigrationJob(root),lifeReturnEvidence:readLifeReturnEvidence(root,{migrationJob:readMigrationJob(root)})}).items.some(x=>x.path===target))
}))
test('current C memories may grow after return-home without making unchanged old D snapshot authoritative',()=>fixture(({root,target})=>{
 put(join(root,'life-memory','new-experience.json'),'fresh on C only')
 const result=inspectExternalLifeCopy({root,verify:true})
 assert.equal(result.eligible,true)
 assert.equal(result.proof,'return-home-snapshot')
 assert.equal(existsSync(join(target,'life-memory','new-experience.json')),false)
}))
test('process appears after quarantine rename: no file is deleted, original D target is restored',()=>fixture(({root,target})=>{
 const checked=inspectExternalLifeCopy({root,verify:true})
 let probes=0
 assert.throws(()=>deleteExternalLifeCopy({root,expected:checked,confirmedStopped:true,confirmedDelete:true,
  ensureStopped:()=>{if(++probes===2)throw Error('new DSH process')}}),/new DSH process/)
 assert.equal(existsSync(target),true)
 assert.equal(existsSync(join(target,'life-memory','episodic.json')),true)
}))
test('user file appearing in D staged directory during stop recheck prevents any deletion and is restored',()=>fixture(({root,target})=>{
 const checked=inspectExternalLifeCopy({root,verify:true})
 let calls=0
 assert.throws(()=>deleteExternalLifeCopy({root,expected:checked,confirmedStopped:true,confirmedDelete:true,
  ensureStopped:()=>{
   if(++calls!==2)return
   const stage=readdirSync(dirname(target)).find(n=>n.startsWith('.dafeiyu-life-delete-staged-'))
   assert.ok(stage)
   put(join(dirname(target),stage,'life-memory','personal-after-check.txt'),'new user data in staging')
  }}),/内容变化|清理停止/)
 assert.equal(existsSync(join(target,'life-memory','episodic.json')),true)
 assert.equal(readFileSync(join(target,'life-memory','personal-after-check.txt'),'utf8'),'new user data in staging')
}))
test('archive inventory exposes retained default-root and old D copies as non-deletable read-only entries',()=>fixture(({root,target})=>{
 const migrationJob=readMigrationJob(root)
 const result=storageArchiveInventory({root,migrationJob})
 assert.ok(result.items.some(row=>row.path===target&&row.current===false&&row.eligibleForDeletion===false))
 assert.ok(result.items.some(row=>row.kind.includes('旧默认目录')&&row.current===false))
 assert.ok(existsSync(target))
}))
test('management UI uses a separate explicit check and delete button; migration no longer auto-reuses occupied targets',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const script=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(html,/id="storage-external-life-check"/)
 assert.match(html,/id="storage-external-life-delete-button"/)
 assert.match(html,/必须为空，不允许自动复用历史分区/)
 assert.match(script,/\/storage\/verify-external-life-copy/)
 assert.match(script,/\/storage\/schedule-external-life-cleanup/)
 assert.match(index,/DELETE_VERIFIED_EXTERNAL_LIFE_COPY/)
 assert.doesNotMatch(script,/r\.retainedTarget\?\.kind/)
 assert.match(script,/lifeCleanupJob\?\.kind==='external-life'&&x\.lifeCleanupJob\?\.status==='completed'/)
})
