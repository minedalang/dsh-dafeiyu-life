import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,readdirSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {largeDataStatus,inspectLargeDataMigration,migrateLargeDataOffline} from '../lib/storage-large-data-v2.mjs'
import {storageDataPath,storageDomainRoot,migrateDomainOffline,storageLayoutStatus} from '../lib/storage-layout.mjs'
import {inspectStorageTarget} from '../lib/storage-location.mjs'
import {readWhisperReadiness} from '../lib/video-dependencies.mjs'
import {createEmbeddingRuntimeManager} from '../lib/embedding-runtime-manager.mjs'
import {createColdSnapshot} from '../lib/cold-state-snapshot.mjs'
import {spawnSync} from 'node:child_process'
import {probeCoreMediaPython} from '../lib/storage-large-data-v2.mjs'
const fixture=fn=>{const t=mkdtempSync(join(tmpdir(),'dsh-v2-')),root=join(t,'bili-duty');mkdirSync(root);try{fn({t,root,at:(...x)=>join(root,...x)})}finally{rmSync(t,{recursive:true,force:true})}}
const put=(p,value)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,value)}
const baseModels=at=>{
 const w=at('.hf-cache','hub','models--Systran--faster-whisper-small','snapshots','r1')
 put(join(w,'model.bin'),'whisper-weight');put(join(w,'config.json'),'{}')
 put(at('embedding-runtime','Qwen3-Embedding-0.6B-Q8_0.gguf'),'gguf-weight')
 put(at('embedding-runtime','llama-b12110-win32-x64','llama-server.exe'),'keep-runtime-here')
 put(at('life-memory','episodic.json'),'irreplaceable-memory')
 put(at('vision-cache','old.json'),'regenerable-vision')
}
const migrate=(root,target)=>migrateLargeDataOffline({root,target,confirmedStopped:true,python:'fixture-python',runtimeProbe:()=>true})
test('V2 migrates all registered large model assets, but NEVER moves executable, cache, Python or Life',()=>fixture(({t,root,at})=>{
 baseModels(at)
 const target=join(t,'external','data'),plan=inspectLargeDataMigration({root,target,legacy:storageLayoutStatus(root)})
 assert.equal(plan.domain,'large');assert.equal(plan.changesNow,false);assert.equal(plan.files,3)
 assert.ok(plan.excluded.some(x=>x.key==='memory'))
 assert.equal(migrate(root,target).ok,true)
 assert.equal(readFileSync(join(target,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf'),'utf8'),'gguf-weight')
 assert.equal(readFileSync(join(target,'whisper','.hf-cache','hub','models--Systran--faster-whisper-small','snapshots','r1','model.bin'),'utf8'),'whisper-weight')
 assert.equal(largeDataStatus(root).target,target)
 assert.equal(storageDataPath(root,'embedding-runtime','llama-b12110-win32-x64','llama-server.exe'),at('embedding-runtime','llama-b12110-win32-x64','llama-server.exe'))
 assert.equal(storageDataPath(root,'.hf-cache','hub'),at('.hf-cache','hub'))
 assert.equal(storageDataPath(root,'vision-cache','new.json'),join(root,'runtime-media-v2','vision-cache','new.json'))
 assert.equal(storageDomainRoot(root,'media'),join(root,'runtime-media-v2'))
 assert.equal(storageDataPath(root,'life-memory','episodic.json'),at('life-memory','episodic.json'))
 assert.equal(readWhisperReadiness({stateDir:root,model:'small'}).modelCached,true)
 assert.equal(readFileSync(at('life-memory','episodic.json'),'utf8'),'irreplaceable-memory')
 assert.equal(readFileSync(at('vision-cache','old.json'),'utf8'),'regenerable-vision')
 assert.throws(()=>createColdSnapshot({root,destination:join(t,'backup'),stoppedConfirmed:true}),/分层存储/)
}))
test('V2 repeated migration moves the complete current library and preserves both old targets',()=>fixture(({t,root,at})=>{
 baseModels(at)
 const first=join(t,'D','data'),second=join(t,'E','data')
 migrate(root,first);migrate(root,second)
 assert.equal(largeDataStatus(root).target,second)
 assert.equal(readFileSync(join(first,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf'),'utf8'),'gguf-weight')
 assert.equal(readFileSync(join(second,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf'),'utf8'),'gguf-weight')
 assert.equal(existsSync(at('embedding-runtime','Qwen3-Embedding-0.6B-Q8_0.gguf')),true)
}))
test('V2 safely returns E to previously occupied D without overwriting the retained D history',()=>fixture(({t,root,at})=>{
 baseModels(at)
 const first=join(t,'D','data'),second=join(t,'E','data')
 migrate(root,first);migrate(root,second)
 const result=migrate(root,first)
 assert.equal(result.ok,true)
 assert.ok(result.priorHistoricalArchive&&existsSync(result.priorHistoricalArchive))
 assert.equal(largeDataStatus(root).target,first)
 assert.equal(readFileSync(join(first,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf'),'utf8'),'gguf-weight')
 assert.equal(existsSync(join(second,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf')),true)
}))
test('V2 adopts v1 modelData without migrating its media or embedding executable',()=>fixture(({t,root,at})=>{
 baseModels(at)
 const old=join(t,'D','modelData')
 migrateDomainOffline({root,domain:'model',target:old,confirmedStopped:true})
 const next=join(t,'E','data')
 assert.equal(migrateLargeDataOffline({root,target:next,legacy:storageLayoutStatus(root),confirmedStopped:true,python:'fixture-python',runtimeProbe:()=>true}).ok,true)
 assert.equal(readFileSync(join(next,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf'),'utf8'),'gguf-weight')
 assert.equal(storageDomainRoot(root,'media'),join(root,'runtime-media-v2'))
 assert.equal(storageDataPath(root,'uv-cache','pkg'),at('uv-cache','pkg'))
 // V1 modelData is now retained history, not a startup dependency.
 rmSync(old,{recursive:true,force:true})
 assert.equal(storageDataPath(root,'.hf-cache','hub'),at('.hf-cache','hub'))
 assert.equal(readWhisperReadiness({stateDir:root,model:'small'}).modelCached,true)
}))
test('V2 identity and destination guards fail closed, no implicit fallback to stale model weights',()=>fixture(({t,root,at})=>{
 baseModels(at)
 assert.throws(()=>inspectLargeDataMigration({root,target:join(root,'inside'),legacy:storageLayoutStatus(root)}),/嵌套/)
 const target=join(t,'D','data');put(join(target,'unexpected.txt'),'do not touch')
 assert.throws(()=>migrate(root,target),/不是 V2 历史分区/)
 rmSync(target,{recursive:true,force:true});migrate(root,target)
 rmSync(join(target,'.dafeiyu-large-data-v2.json'))
 assert.throws(()=>largeDataStatus(root),/标记/)
 assert.throws(()=>storageDataPath(root,'vision-cache','x.json'),/标记/)
}))
test('V2 never publishes before real Python writer is healthy',()=>fixture(({t,root,at})=>{
 baseModels(at);const target=join(t,'D','data')
 assert.throws(()=>migrateLargeDataOffline({root,target,confirmedStopped:true,python:'fixture-python',runtimeProbe:()=>{throw Error('Low Python write denied')}}),/Low Python/)
 assert.equal(largeDataStatus(root).configured,false)
 assert.equal(readFileSync(at('life-memory','episodic.json'),'utf8'),'irreplaceable-memory')
}))
test('V2 stops untrusted HF symlinks before committing any target',t=>fixture(({t:tmp,root,at})=>{
 baseModels(at)
 const foreign=join(tmp,'private-key');put(foreign,'secret')
 try{symlinkSync(foreign,at('.hf-cache','unsafe-link'),'file')}catch(e){if(['EPERM','EACCES'].includes(e?.code)){t.skip('symlinks disabled');return}throw e}
 const target=join(tmp,'D','data')
 assert.throws(()=>inspectLargeDataMigration({root,target,legacy:storageLayoutStatus(root)}),/链接指向源目录外/)
 assert.equal(existsSync(join(root,'storage-large-data-v2.json')),false)
}))

test('real local Python writes to every V2 core cache directory, never the external data volume',t=>fixture(({root,at})=>{
 const candidates=process.platform==='win32'?['py','python']:['python3','python']
 const found=candidates.find(py=>spawnSync(py,['-c','print(1)'],{timeout:3000,encoding:'utf8'}).status===0)
 if(!found){t.skip('Python unavailable in the test environment');return}
 const actual=spawnSync(found,['-c','import sys; print(sys.executable)'],{timeout:3000,encoding:'utf8'}).stdout.trim()
 assert.equal(probeCoreMediaPython({root,python:actual}),true)
 for(const rel of ['runtime-media-v2','.hf-cache','uv-cache','pip-cache'])assert.ok(existsSync(at(rel)))
}))

test('V2 disables whole bili-duty root move without altering its existing contents',()=>fixture(({t,root,at})=>{
 baseModels(at)
 const target=join(t,'data');migrate(root,target)
 assert.throws(()=>inspectStorageTarget({source:root,target:join(t,'whole-root')}),/V2/)
 assert.equal(readFileSync(at('life-memory','episodic.json'),'utf8'),'irreplaceable-memory')
}))
test('V2 leaves an existing external Life V1 partition at its verified original location',()=>fixture(({t,root,at})=>{
 baseModels(at)
 const oldLife=join(t,'old-life')
 migrateDomainOffline({root,domain:'memory',target:oldLife,confirmedStopped:true})
 const target=join(t,'large')
 const before=storageDataPath(root,'life-memory','episodic.json')
 assert.equal(before,join(oldLife,'life-memory','episodic.json'))
 assert.equal(migrateLargeDataOffline({root,target,legacy:storageLayoutStatus(root),confirmedStopped:true,python:'fixture-python',runtimeProbe:()=>true}).ok,true)
 assert.equal(storageDataPath(root,'life-memory','episodic.json'),before)
 assert.equal(readFileSync(before,'utf8'),'irreplaceable-memory')
 assert.equal(storageLayoutStatus(root).domains.memory.configured,true)
}))
