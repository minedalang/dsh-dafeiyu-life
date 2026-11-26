import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,readdirSync,utimesSync,renameSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {largeDataStatus,inspectLargeDataMigration,migrateLargeDataOffline} from '../lib/storage-large-data-v2.mjs'
import {storageDataPath,storageDomainRoot,migrateDomainOffline,storageLayoutStatus} from '../lib/storage-layout.mjs'
import {inspectStorageTarget} from '../lib/storage-location.mjs'
import {readWhisperReadiness} from '../lib/video-dependencies.mjs'
import {createEmbeddingRuntimeManager} from '../lib/embedding-runtime-manager.mjs'
import {createColdSnapshot,createSplitColdSnapshot,verifySplitColdSnapshot,restoreSplitColdSnapshot,inspectModelRecovery,recoverSnapshotModels,rollbackSplitColdRestore} from '../lib/cold-state-snapshot.mjs'
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

import {pruneVideoCaches} from '../lib/video-cache-retention.mjs'
test('V2 cache expiry follows actual runtime-media-v2, never deletes retained migration sources or library',()=>fixture(({t,root,at})=>{
 baseModels(at)
 const target=join(t,'external','data');assert.equal(migrate(root,target).ok,true)
 const bv='BV1234567890.json',old=at('vision-cache',bv),active=storageDataPath(root,'vision-cache',bv)
 for(const file of [old,active]){put(file,'{}');utimesSync(file,0,0)}
 assert.equal(pruneVideoCaches(root).removed,1)
 assert.equal(existsSync(active),false);assert.equal(existsSync(old),true)
 assert.equal(existsSync(join(target,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf')),true)
 assert.equal(existsSync(at('life-memory','episodic.json')),true)
}))


test('dev.26 V2 full snapshot ignores retired V1 model path, includes active V1 Life and V2 model store',()=>fixture(({t,root,at})=>{
 baseModels(at)
 const retired=join(t,'retired'),life=join(t,'life'),large=join(t,'large'),snapshot=join(t,'snapshot')
 migrateDomainOffline({root,domain:'model',target:retired,confirmedStopped:true})
 migrateDomainOffline({root,domain:'memory',target:life,confirmedStopped:true})
 migrate(root,large)
 rmSync(retired,{recursive:true,force:true})
 const checkStopped=()=>({ok:true})
 assert.equal(createSplitColdSnapshot({root,destination:snapshot,stoppedConfirmed:true,checkStopped}).partitions,3)
 assert.equal(verifySplitColdSnapshot(snapshot).partitions,3)
 assert.equal(readFileSync(join(snapshot,'partitions','v1-memory','life-memory','episodic.json'),'utf8'),'irreplaceable-memory')
 assert.equal(readFileSync(join(snapshot,'partitions','v2-large','embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf'),'utf8'),'gguf-weight')
 put(join(large,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf'),'broken')
 assert.equal(restoreSplitColdSnapshot({root,snapshot,stoppedConfirmed:true,confirm:'RESTORE_FULL_DSH_STATE',checkStopped}).restored,true)
 assert.equal(readFileSync(join(large,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf'),'utf8'),'gguf-weight')
 assert.equal(existsSync(retired),false)
}))


import {stateDirOf} from '../lib/state.mjs'
import {coldRestoreFencePath} from '../lib/cold-restore-fence.mjs'
const stopped=()=>({ok:true})
const recoveryFixture=fn=>fixture(({t,root,at})=>{
 baseModels(at);put(at('character-identity.json'),JSON.stringify({id:'fish-fixture-123'}))
 const life=join(t,'life'),old=join(t,'old-model'),snapshot=join(t,'snapshot'),destination=join(t,'new-model')
 migrateDomainOffline({root,domain:'memory',target:life,confirmedStopped:true});migrate(root,old)
 put(join(old,'whisper','.hf-cache','token'),'must-not-copy-token')
 put(join(old,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf.part'),'unfinished')
 createSplitColdSnapshot({root,destination:snapshot,stoppedConfirmed:true,checkStopped:stopped})
 const args={root,snapshot,destination,stoppedConfirmed:true,confirm:'RECOVER_DSH_MODELS_ONLY',checkStopped:stopped}
 fn({t,root,at,life,old,snapshot,destination,args})
})
test('dev.26 recover models on a new disk from a historical snapshot without rolling back live Life, permission, or outbound data',()=>recoveryFixture(({root,at,life,old,destination,args})=>{
 const memory=join(life,'life-memory','episodic.json'),revoked=join(life,'detail-protection','revocations-v1.json')
 put(memory,'new memory after snapshot');put(revoked,'latest forgotten evidence');put(at('account-binding.json'),'current permission');put(at('outbound-action-executions','receipt.json'),'unknown external send');put(at('unknown-business.json'),'latest unknown state')
 rmSync(old,{recursive:true})
 const plan=inspectModelRecovery(args);assert.equal(plan.oldTargetPresent,false);assert.equal(plan.changesNow,false);assert.equal(plan.files,3);assert.equal(existsSync(destination),false)
 const result=recoverSnapshotModels(args);assert.equal(result.restored,true);assert.equal(result.scope,'v2-models-only');assert.equal(result.modelHealthCheckRequired,true)
 assert.equal(largeDataStatus(root).target,destination);assert.equal(storageLayoutStatus(root).domains.memory.root,life)
 assert.equal(readFileSync(join(destination,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf'),'utf8'),'gguf-weight')
 assert.equal(readWhisperReadiness({stateDir:root,model:'small'}).modelCached,true)
 for(const [p,value] of [[memory,'new memory after snapshot'],[revoked,'latest forgotten evidence'],[at('account-binding.json'),'current permission'],[at('outbound-action-executions','receipt.json'),'unknown external send'],[at('unknown-business.json'),'latest unknown state']])assert.equal(readFileSync(p,'utf8'),value)
 assert.equal(existsSync(join(destination,'whisper','.hf-cache','token')),false);assert.equal(existsSync(join(destination,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf.part')),false)
 assert.equal(existsSync(old),false);assert.equal(existsSync(coldRestoreFencePath(root)),false)
}))
test('dev.26 model recovery retains a readable old disk and rejects existing targets, different character and changed model route',()=>recoveryFixture(({t,root,at,old,destination,args})=>{
 assert.throws(()=>recoverSnapshotModels({...args,confirm:'RESTORE_FULL_DSH_STATE'}),/确认/)
 assert.throws(()=>inspectModelRecovery({...args,destination:old}),/重叠/)
 put(join(destination,'keep'),'untouched');assert.throws(()=>inspectModelRecovery(args),/不存在/);assert.equal(readFileSync(join(destination,'keep'),'utf8'),'untouched');rmSync(destination,{recursive:true})
 put(at('character-identity.json'),JSON.stringify({id:'different-fish-123'}));assert.throws(()=>inspectModelRecovery(args),/角色身份/)
 put(at('character-identity.json'),JSON.stringify({id:'fish-fixture-123'}));migrate(root,join(t,'other-current'));assert.throws(()=>inspectModelRecovery(args),/存储世代/)
 assert.equal(existsSync(old),true);assert.equal(existsSync(destination),false)
}))
test('dev.26 missing Life disk cannot be hidden by model recovery, and tampered snapshot cannot be used',()=>recoveryFixture(({root,life,old,snapshot,destination,args})=>{
 const moved=life+'-offline';renameSync(life,moved);assert.throws(()=>recoverSnapshotModels(args),/目录不存在/);renameSync(moved,life)
 put(join(snapshot,'partitions','v2-large','embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf'),'tampered');assert.throws(()=>recoverSnapshotModels(args),/校验失败/)
 assert.equal(largeDataStatus(root).target,old);assert.equal(existsSync(destination),false);assert.equal(existsSync(coldRestoreFencePath(root)),false)
}))
test('dev.26 model recovery on a healthy old disk stages and switches only new target, and preserves the old disk',()=>recoveryFixture(({root,old,destination,args})=>{
 const before=readFileSync(join(old,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf'))
 assert.equal(recoverSnapshotModels(args).restored,true);assert.equal(largeDataStatus(root).target,destination)
 assert.deepEqual(readFileSync(join(old,'embedding-model','Qwen3-Embedding-0.6B-Q8_0.gguf')),before)
}))
test('dev.26 second stop check fails before publishing model route; preserves old pointer, stage and existing models',()=>recoveryFixture(({root,at,old,destination,args})=>{
 let checks=0;const route=readFileSync(at('storage-large-data-v2.json'))
 assert.throws(()=>recoverSnapshotModels({...args,checkStopped:()=>({ok:++checks===1})}),/已保留原路由/)
 assert.deepEqual(readFileSync(at('storage-large-data-v2.json')),route);assert.equal(largeDataStatus(root).target,old);assert.equal(existsSync(destination),false);assert.equal(existsSync(coldRestoreFencePath(root)),false)
 assert.ok(readdirSync(dirname(destination)).some(n=>n.startsWith('new-model.cold-stage-')))
}))
test('dev.26 process exit during new model staging blocks host startup; rollback handles a published pointer without deleting either model copy',()=>recoveryFixture(({t,root,at,old,destination,args})=>{
 const original=readFileSync(at('storage-large-data-v2.json'))
 const script=`import {recoverSnapshotModels} from './lib/cold-state-snapshot.mjs';let n=0;recoverSnapshotModels({...JSON.parse(process.argv[1]),checkStopped:()=>{if(++n===2)process.exit(73);return {ok:true}}})`
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,JSON.stringify(args)],{cwd:process.cwd(),encoding:'utf8',timeout:15000})
 assert.equal(child.status,73,child.stderr);const fence=coldRestoreFencePath(root),j=JSON.parse(readFileSync(fence,'utf8'))
 assert.throws(()=>stateDirOf({get:()=>()=>root}),/禁止启动/)
 // Simulate the precise on-disk state after the later atomic pointer switch.
 renameSync(destination+'.cold-stage-'+j.id,destination)
 put(at('storage-large-data-v2.json'),JSON.stringify({version:2,base:root,target:destination,nonce:j.id})+'\n')
 assert.equal(largeDataStatus(root).target,destination);assert.throws(()=>stateDirOf({get:()=>()=>root}),/禁止启动/)
 const result=rollbackSplitColdRestore({root,stoppedConfirmed:true,confirm:'ROLLBACK_FULL_DSH_STATE',checkStopped:stopped})
 assert.equal(result.rolledBack,true);assert.deepEqual(readFileSync(at('storage-large-data-v2.json')),original);assert.equal(largeDataStatus(root).target,old);assert.ok(existsSync(destination));assert.ok(existsSync(old));assert.equal(existsSync(fence),false)
}))

test('dev.26 unknown V2 route fields or concurrent pointer drift cannot be silently overwritten',()=>recoveryFixture(({root,at,old,destination,args})=>{
 const config=at('storage-large-data-v2.json'),prior=JSON.parse(readFileSync(config,'utf8'))
 put(config,JSON.stringify({...prior,futureState:'preserve'}));assert.throws(()=>inspectModelRecovery(args),/路由|位置身份/);assert.equal(JSON.parse(readFileSync(config,'utf8')).futureState,'preserve');put(config,JSON.stringify(prior)+'\n')
 let checks=0
 assert.throws(()=>recoverSnapshotModels({...args,checkStopped:()=>{if(++checks===2)put(config,JSON.stringify({...prior,nonce:'concurrent-generation'})+'\n');return {ok:true}}}),/保持冻结/)
 const fence=coldRestoreFencePath(root);assert.ok(existsSync(fence));assert.equal(existsSync(destination),false)
 assert.throws(()=>rollbackSplitColdRestore({root,stoppedConfirmed:true,confirm:'ROLLBACK_FULL_DSH_STATE',checkStopped:stopped}),/其他操作修改/)
 assert.equal(JSON.parse(readFileSync(config,'utf8')).nonce,'concurrent-generation');assert.ok(existsSync(old));assert.ok(existsSync(fence))
}))
test('dev.26 model-only recovery excludes incomplete HF payload and retains missing-disk route on interrupted rollback',()=>recoveryFixture(({root,at,old,snapshot,destination,args})=>{
 // Use a newly verified snapshot containing an unfinished download.
 put(join(old,'whisper','.hf-cache','hub','models--test','blobs','unfinished.incomplete'),'partial')
 const second=snapshot+'-second';createSplitColdSnapshot({root,destination:second,stoppedConfirmed:true,checkStopped:stopped})
 rmSync(old,{recursive:true});const plan=inspectModelRecovery({...args,snapshot:second});assert.equal(plan.files,3)
 let checks=0;assert.throws(()=>recoverSnapshotModels({...args,snapshot:second,checkStopped:()=>({ok:++checks===1})}),/已保留原路由/)
 assert.equal(JSON.parse(readFileSync(at('storage-large-data-v2.json'),'utf8')).target,old);assert.equal(existsSync(old),false);assert.throws(()=>largeDataStatus(root),/目录不存在/)
 assert.equal(recoverSnapshotModels({...args,snapshot:second}).restored,true);assert.equal(existsSync(join(destination,'whisper','.hf-cache','hub','models--test','blobs','unfinished.incomplete')),false)
}))

test('dev.26 recovery CLI exposes read-only model preflight and refuses implicit writes',()=>recoveryFixture(({root,snapshot,destination})=>{
 const cli=['tools/dev4-cold-state-backup.mjs','plan-model-recovery','--root',root,'--snapshot',snapshot,'--to',destination]
 const plan=spawnSync(process.execPath,cli,{encoding:'utf8',timeout:15000});assert.equal(plan.status,0,plan.stderr);assert.equal(JSON.parse(plan.stdout).changesNow,false);assert.equal(existsSync(destination),false)
 cli[1]='recover-models';const refused=spawnSync(process.execPath,cli,{encoding:'utf8',timeout:15000});assert.equal(refused.status,1);assert.match(refused.stderr,/确认仅恢复模型/);assert.equal(existsSync(destination),false)
}))
