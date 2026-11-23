import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync,chmodSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {probeVisionCacheAccess} from '../lib/storage-vision-cache-access.mjs'
import {migrateDomainOffline,storageLayoutStatus,storageDataPath,returnDomainHomeOffline} from '../lib/storage-layout.mjs'
import {migrateStorageOffline,storageLocationStatus} from '../lib/storage-location.mjs'
const withRoot=fn=>{
 const base=mkdtempSync(join(tmpdir(),'vision-acl-')),root=join(base,'bili-duty')
 mkdirSync(root)
 try{return fn({root,base})}finally{rmSync(base,{recursive:true,force:true})}
}
const put=(p,text)=>{mkdirSync(join(p,'..'),{recursive:true});writeFileSync(p,text)}
test('vision cache probe checks atomic replacement and leaves existing cache files untouched',()=>withRoot(({root})=>{
 const cache=join(root,'vision-cache')
 put(join(cache,'real.json'),'preserved')
 put(join(cache,'BV1-preview-board-v14.tmp'),'stale-but-owned-by-user')
 assert.deepEqual(probeVisionCacheAccess(cache),{ok:true,create:true,atomicReplace:true,delete:true})
 assert.equal(readFileSync(join(cache,'real.json'),'utf8'),'preserved')
 assert.equal(readFileSync(join(cache,'BV1-preview-board-v14.tmp'),'utf8'),'stale-but-owned-by-user')
 assert.equal(readdirSync(cache).length,2)
}))
test('model move refuses publication when target vision cache cannot replace a file',()=>withRoot(({root,base})=>{
 put(join(root,'.hf-cache','model.bin'),'model')
 put(join(root,'vision-cache','valid.json'),'visual')
 const target=join(base,'modelData')
 let calls=0
 const error=()=>{calls++;throw Object.assign(new Error('acl denied'),{code:'EACCES'})}
 assert.throws(()=>migrateDomainOffline({root,domain:'model',target,confirmedStopped:true,visionCacheProbe:error}),/acl denied/)
 assert.equal(calls,1)
 assert.equal(storageLayoutStatus(root).configured,0)
 assert.equal(readFileSync(join(root,'vision-cache','valid.json'),'utf8'),'visual')
 assert.equal(storageDataPath(root,'vision-cache','valid.json'),join(root,'vision-cache','valid.json'))
 assert.equal(readFileSync(join(target,'vision-cache','valid.json'),'utf8'),'visual')
 // An uncommitted target is never used as the active storage location.
}))
test('model migration verifies cache access before publishing and succeeds with real probe',()=>withRoot(({root,base})=>{
 put(join(root,'vision-cache','real.json'),'same')
 const target=join(base,'modelData')
 const result=migrateDomainOffline({root,domain:'model',target,confirmedStopped:true})
 assert.equal(result.ok,true)
 assert.equal(storageDataPath(root,'vision-cache','real.json'),join(target,'vision-cache','real.json'))
 assert.equal(readdirSync(join(target,'vision-cache')).length,1)
}))
test('return-home cache failure preserves the external authoritative model pointer',()=>withRoot(({root,base})=>{
 put(join(root,'vision-cache','real.json'),'old')
 const target=join(base,'modelData')
 migrateDomainOffline({root,domain:'model',target,confirmedStopped:true})
 assert.throws(()=>returnDomainHomeOffline({root,domain:'model',confirmedStopped:true,visionCacheProbe:()=>{throw Error('TARGET_DENIED')}}),/TARGET_DENIED/)
 assert.equal(storageDataPath(root,'vision-cache','real.json'),join(target,'vision-cache','real.json'))
 assert.equal(readFileSync(join(target,'vision-cache','real.json'),'utf8'),'old')
}))
test('legacy whole-root migration verifies vision cache access before switching bootstrap pointer',()=>withRoot(({root,base})=>{
 put(join(root,'vision-cache','real.json'),'data')
 const result=migrateStorageOffline({source:root,target:join(base,'whole-target'),confirmedStopped:true})
 assert.equal(result.ok,true)
 assert.equal(storageLocationStatus(root).relocated,true)
 assert.equal(readFileSync(join(result.currentDir,'vision-cache','real.json'),'utf8'),'data')
}))

test('read-only visual cache files are made writable in the NEW copy only',()=>withRoot(({root,base})=>{
 put(join(root,'vision-cache','read-only.json'),'model-answer')
 const source=join(root,'vision-cache','read-only.json')
 chmodSync(source,0o400)
 const dest=join(base,'modelData')
 migrateDomainOffline({root,domain:'model',target:dest,confirmedStopped:true})
 assert.equal(readFileSync(join(dest,'vision-cache','read-only.json'),'utf8'),'model-answer')
 if(process.platform!=='win32'){
  assert.equal(statSync(source).mode&0o200,0)
  assert.notEqual(statSync(join(dest,'vision-cache','read-only.json')).mode&0o200,0)
 }
}))

test('an absent vision cache stays absent after migration and remains rollback-compatible',()=>withRoot(({root,base})=>{
 put(join(root,'.hf-cache','model.bin'),'model')
 const target=join(base,'modelData')
 migrateDomainOffline({root,domain:'model',target,confirmedStopped:true})
 assert.equal(existsSync(join(target,'vision-cache')),false)
 assert.equal(existsSync(join(root,'vision-cache')),false)
}))

test('installed cache CLI refuses unknown roots and does not create any data directory',()=>withRoot(({root,base})=>{
 const script=new URL('../scripts/check-vision-cache-access.mjs',import.meta.url).pathname
 const wrong=join(base,'not-installed-root')
 const denied=spawnSync(process.execPath,[script,'--root',wrong],{encoding:'utf8'})
 assert.notEqual(denied.status,0)
 assert.equal(existsSync(wrong),false)
 const good=spawnSync(process.execPath,[script,'--root',root],{encoding:'utf8'})
 assert.equal(good.status,0)
 assert.equal(JSON.parse(good.stdout).checks.atomicReplace,true)
 assert.equal(existsSync(join(root,'vision-cache')),false)
}))
