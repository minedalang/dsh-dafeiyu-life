import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {queueDomainMigration,readMigrationJob,assertMigrationStartupSafe,requestMigrationCancellation} from '../lib/storage-migration-queue.mjs'
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const fixture=fn=>{const parent=mkdtempSync(join(tmpdir(),'dsh-v2-queue-')),root=join(parent,'bili-duty');mkdirSync(root);try{return fn({parent,root})}finally{rmSync(parent,{force:true,recursive:true})}}
const spawnFake=()=>({pid:8888,unref(){}})
test('V2 is the only schedulable migration: model, python, memory and return-home are rejected',()=>fixture(({root,parent})=>{
 for(const domain of ['model','python','memory','whisper','embedding'])
  assert.throws(()=>queueDomainMigration({root,domain,target:join(parent,'D','data'),workerScript:'worker.mjs',spawnImpl:spawnFake}),/旧版数据迁移已移除/)
 assert.throws(()=>queueDomainMigration({root,domain:'large',returnHome:true,target:join(parent,'D','data'),workerScript:'worker.mjs',spawnImpl:spawnFake}),/旧版数据迁移已移除/)
 assert.equal(existsSync(join(root,'.dafeiyu-domain-migration-job-v1.json')),false)
}))
test('V2 queue only records intent: no copy while DSH runs; startup rejects pending copy',()=>fixture(({root,parent})=>{
 const target=join(parent,'D','data')
 const queued=queueDomainMigration({root,domain:'large',target,workerScript:'worker.mjs',parentPid:12345,spawnImpl:spawnFake})
 assert.equal(queued.ok,true);assert.equal(readMigrationJob(root).domain,'large');assert.equal(existsSync(target),false)
 assert.throws(()=>assertMigrationStartupSafe(root),/仍处于 waiting/)
 assert.throws(()=>queueDomainMigration({root,domain:'large',target:join(parent,'E','data'),workerScript:'worker.mjs',spawnImpl:spawnFake}),/已有待处理/)
}))
test('V2 pending job can be safely cancelled without copying, altering data or disabling protection',()=>fixture(({root,parent})=>{
 const target=join(parent,'D','data')
 queueDomainMigration({root,domain:'large',target,workerScript:'worker.mjs',parentPid:12345,spawnImpl:spawnFake})
 const job=readMigrationJob(root)
 const result=requestMigrationCancellation({root,jobId:job.id})
 assert.equal(result.requested,true);assert.equal(existsSync(target),false)
 assert.throws(()=>assertMigrationStartupSafe(root),/仍处于 waiting/)
}))
test('V2 storage interface exposes one destination and no legacy migration actions',()=>{
 const html=source('lib/management-console.html'),ui=source('lib/management-console.js'),host=source('index.js')
 for(const id of ['storage-large-v2-target','storage-large-v2-check','storage-large-v2-schedule','storage-retained-model-check','storage-migration-job-status','backup-export'])
  assert.ok(html.includes(`id="${id}"`),id)
 for(const old of ['storage-domain','storage-return-check','storage-schedule-migration','storage-life-undo','storage-external-life-delete-button','storage-retained-model-confirm-clean','storage-archive-inventory'])
  assert.doesNotMatch(html,new RegExp(`id="${old}"`),old)
 for(const endpoint of ['verify-retained-model','verify-python-cache','schedule-life-cleanup','schedule-model-cleanup','verify-external-life-copy'])
  assert.equal(host.includes(`/api/bili-duty/storage/${endpoint}`),false,endpoint)
 assert.match(host,/body\?\.domain!=='large'/)
 assert.match(ui,/request\('\/storage\/schedule-migration',\{domain:'large'/)
})
test('V1 offline executable CLI tools retired; only V2 stopped-instance worker remains',()=>{
 assert.equal(existsSync(new URL('../scripts/migrate-bili-duty-domain.mjs',import.meta.url)),false)
 assert.equal(existsSync(new URL('../scripts/migrate-bili-duty-storage.mjs',import.meta.url)),false)
 assert.ok(existsSync(new URL('../scripts/migrate-bili-duty-after-exit.mjs',import.meta.url)))
 assert.match(source('lib/storage-migration-queue.mjs'),/job\.domain!=='large'/)
})
