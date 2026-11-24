import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {queueDomainMigration} from '../lib/storage-migration-queue.mjs'
import {migrateLargeDataOffline,largeDataStatus} from '../lib/storage-large-data-v2.mjs'
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const fixture=fn=>{const temp=mkdtempSync(join(tmpdir(),'v2-life-retired-')),root=join(temp,'core');mkdirSync(root);try{return fn({temp,root})}finally{rmSync(temp,{recursive:true,force:true})}}
test('retired Life migration, return-home and external cleanup are never exposed through management HTTP',()=>{
 const host=source('index.js'),html=source('lib/management-console.html')
 for(const api of ['verify-life-memory','schedule-life-cleanup','schedule-external-life-cleanup','verify-external-life-copy'])
  assert.equal(host.includes(`/api/bili-duty/storage/${api}`),false,api)
 for(const id of ['storage-life-undo','storage-external-life-check','storage-external-life-delete-button'])
  assert.doesNotMatch(html,new RegExp(`id="${id}"`),id)
})
test('V2 queue refuses historical Life migration or return-home before touching disk',()=>fixture(({temp,root})=>{
 const original=join(root,'life-memory','episodic.json');mkdirSync(join(root,'life-memory'))
 writeFileSync(original,'my memory')
 for(const returnHome of [false,true])assert.throws(()=>queueDomainMigration({root,domain:'memory',target:join(temp,'life'),returnHome,workerScript:'worker.mjs',parentPid:1000}),/旧版数据迁移已移除/)
 assert.equal(readFileSync(original,'utf8'),'my memory')
 assert.equal(existsSync(join(temp,'life')),false)
}))
test('one V2 large-data migration preserves all Life and forgetting data byte-for-byte',()=>fixture(({temp,root})=>{
 for(const [name,value] of [['life-memory/episodic.json','episodes'],['long-term-memory/dafeiyu.json','facts'],['detail-protection/revocations-v1.json','revoked'],['embedding-memory-index/index.json','vectors']]){
   const file=join(root,name);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,value)
 }
 const model=join(root,'embedding-runtime','Qwen3-Embedding-0.6B-Q8_0.gguf');mkdirSync(join(model,'..'),{recursive:true});writeFileSync(model,'GGUF')
 const target=join(temp,'models')
 const result=migrateLargeDataOffline({root,target,confirmedStopped:true,python:'fixture',runtimeProbe:()=>true})
 assert.equal(result.ok,true);assert.equal(largeDataStatus(root).target,target)
 for(const [name,value] of [['life-memory/episodic.json','episodes'],['long-term-memory/dafeiyu.json','facts'],['detail-protection/revocations-v1.json','revoked'],['embedding-memory-index/index.json','vectors']])
   assert.equal(readFileSync(join(root,name),'utf8'),value)
 assert.equal(existsSync(join(target,'life-memory')),false)
}))
test('old shutdown-only Life deletion and whole-root migration executable scripts are not packaged',()=>{
 const pkg=JSON.parse(source('package.json'))
 for(const file of ['scripts/cleanup-retained-life-after-exit.mjs','scripts/cleanup-retained-model-after-exit.mjs','scripts/migrate-bili-duty-domain.mjs','scripts/migrate-bili-duty-storage.mjs']){
   assert.equal(existsSync(new URL('../'+file,import.meta.url)),false,file)
   assert.equal(pkg.files.includes(file),false,file)
 }
})
