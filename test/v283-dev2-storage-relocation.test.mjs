import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {originalStateDir,storageLocationStatus,inspectStorageTarget,migrateStorageOffline,storageCategories} from '../lib/storage-location.mjs'
import {stateDirOf} from '../lib/state.mjs'
const withRoot=fn=>{const root=mkdtempSync(join(tmpdir(),'dafeiyu-location-'));try{return fn(root)}finally{rmSync(root,{recursive:true,force:true})}}
const fixture=root=>{const home=join(root,'dsh-home'),source=join(home,'bili-duty');mkdirSync(join(source,'life-memory'),{recursive:true});writeFileSync(join(source,'life-memory','episodic.json'),'old identity');return {home,source,ctx:{get(key){return key==='dshHomePath'?(...segments)=>join(home,...segments):null}}}}

test('storage default stays DSH controlled; read-only overview distinguishes usage categories',()=>withRoot(root=>{
 const {source,ctx}=fixture(root)
 assert.equal(originalStateDir(ctx),source)
 assert.equal(stateDirOf(ctx),source)
 const status=storageLocationStatus(source)
 assert.equal(status.relocated,false)
 const scan=storageCategories(source)
 assert.equal(scan.buckets.find(x=>x.key==='memory').bytes,12)
}))

test('no online migration; explicit offline copy verifies each byte and leaves original intact',()=>withRoot(root=>{
 const {source,ctx}=fixture(root),target=join(root,'new-drive','bili-duty')
 assert.equal(inspectStorageTarget({source,target}).changesNow,false)
 assert.throws(()=>migrateStorageOffline({source,target}),/关闭 DSH/)
 const result=migrateStorageOffline({source,target,confirmedStopped:true})
 assert.equal(result.ok,true)
 assert.equal(result.sourcePreserved,true)
 assert.equal(result.files,1)
 assert.equal(stateDirOf(ctx),target)
 assert.equal(storageLocationStatus(source).relocated,true)
 assert.equal(readFileSync(join(target,'life-memory','episodic.json'),'utf8'),'old identity')
 assert.equal(readFileSync(join(source,'life-memory','episodic.json'),'utf8'),'old identity')
 assert.throws(()=>migrateStorageOffline({source,target:join(root,'another'),confirmedStopped:true}),/已有其他迁移位置/)
}))

test('nested, nonempty and corrupted path pointer fail closed; no silent fresh identity',()=>withRoot(root=>{
 const {source,ctx}=fixture(root)
 assert.throws(()=>inspectStorageTarget({source,target:join(source,'nested')}),/嵌套/)
 const target=join(root,'target');mkdirSync(target);writeFileSync(join(target,'old'),'data')
 assert.throws(()=>inspectStorageTarget({source,target}),/非空/)
 writeFileSync(join(root,'dsh-home','.bili-duty-location-v1.json'),'{broken json')
 assert.throws(()=>stateDirOf(ctx),/配置损坏/)
}))

test('symbolic links cannot hide in migration source or target',t=>withRoot(root=>{
 const {source}=fixture(root),link=join(source,'bad-link')
 try{symlinkSync(join(source,'life-memory'),link,'dir')}
 catch(e){if(['EPERM','EACCES'].includes(e?.code)){t.skip('Windows lacks symlink privilege');return;}throw e}
 assert.throws(()=>migrateStorageOffline({source,target:join(root,'new-location'),confirmedStopped:true}),/链接/)
}))

test('management UI offers read-only status and offline-only copy without live relocation',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 for(const id of ['storage-location-panel','storage-current-path','storage-metrics','storage-target','storage-check','storage-offline-steps','storage-copy-command'])assert.ok(html.includes(`id="${id}"`))
 assert.match(js,/storage-offline-command/)
 assert.match(js,/offline-steps'\)\.hidden=false/)
 assert.match(host,/storage\/check/)
 assert.doesNotMatch(host,/migrateStorageOffline\(/)
})
