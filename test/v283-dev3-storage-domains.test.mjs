import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {storageDataPath,storageDomainRoot,storageLayoutStatus,inspectDomainMigration,migrateDomainOffline,rollbackDomainOffline,storageDomainsUsage} from '../lib/storage-layout.mjs'
import {readWhisperReadiness} from '../lib/video-dependencies.mjs'
import {listWhisperModels} from '../lib/whisper-model-cache.mjs'
import {collectBackupFiles,createLifeMemoryBackup,restoreLifeMemoryBackup} from '../lib/data-backup.mjs'
import {createColdSnapshot} from '../lib/cold-state-snapshot.mjs'
const fixture=fn=>{const t=mkdtempSync(join(tmpdir(),'dafeiyu-dev3-')),root=join(t,'bili-duty');mkdirSync(root);try{fn({t,root,path:(...x)=>join(root,...x)})}finally{rmSync(t,{recursive:true,force:true})}}
const put=(path,text)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text)}
test('no layout leaves all default legacy locations identical',()=>fixture(({root})=>{
 assert.equal(storageDataPath(root,'.hf-cache','hub'),join(root,'.hf-cache','hub'))
 assert.equal(storageDataPath(root,'life-memory','episodic.json'),join(root,'life-memory','episodic.json'))
 assert.equal(storageLayoutStatus(root).configured,0)
 assert.equal(storageDomainsUsage(root).length,5)
}))
test('explicit offline migration isolates embedding and leaves original verified copy',()=>fixture(({t,root,path})=>{
 put(path('embedding-runtime','model.gguf'),'model-data')
 put(path('life-memory','episodic.json'),'life')
 const target=join(t,'drive','models'),plan=inspectDomainMigration({root,domain:'embedding',target})
 assert.equal(plan.changesNow,false)
 assert.equal(plan.bytes,10)
 assert.throws(()=>migrateDomainOffline({root,domain:'embedding',target}),/退出 DSH/)
 const result=migrateDomainOffline({root,domain:'embedding',target,confirmedStopped:true})
 assert.equal(result.sourcePreserved,true)
 assert.equal(storageDataPath(root,'embedding-runtime','model.gguf'),join(target,'embedding-runtime','model.gguf'))
 assert.equal(readFileSync(storageDataPath(root,'embedding-runtime','model.gguf'),'utf8'),'model-data')
 assert.equal(readFileSync(path('embedding-runtime','model.gguf'),'utf8'),'model-data')
 assert.equal(storageDataPath(root,'life-memory','episodic.json'),path('life-memory','episodic.json'))
 const second=join(t,'another-disk','embedding')
 assert.equal(inspectDomainMigration({root,domain:'embedding',target:second}).sourceRoot,target)
 assert.equal(migrateDomainOffline({root,domain:'embedding',target:second,confirmedStopped:true}).ok,true)
 assert.equal(storageDataPath(root,'embedding-runtime','model.gguf'),join(second,'embedding-runtime','model.gguf'))
 assert.equal(readFileSync(join(target,'embedding-runtime','model.gguf'),'utf8'),'model-data')
}))
test('offline rollback requires byte-identical legacy copy; changed memory can never be reset',()=>fixture(({t,root,path})=>{
 put(path('life-memory','episodic.json'),'original')
 migrateDomainOffline({root,domain:'memory',target:join(t,'memory'),confirmedStopped:true})
 assert.throws(()=>rollbackDomainOffline({root,domain:'memory'}),/退出/)
 assert.equal(rollbackDomainOffline({root,domain:'memory',confirmedStopped:true}).ok,true)
 assert.equal(storageDataPath(root,'life-memory','episodic.json'),path('life-memory','episodic.json'))
 migrateDomainOffline({root,domain:'memory',target:join(t,'memory2'),confirmedStopped:true})
 put(storageDataPath(root,'life-memory','episodic.json'),'new actual memory')
 assert.throws(()=>rollbackDomainOffline({root,domain:'memory',confirmedStopped:true}),/已有变化/)
 assert.equal(readFileSync(storageDataPath(root,'life-memory','episodic.json'),'utf8'),'new actual memory')
}))
test('Whisper symbolic snapshots only follow source-contained regular blob, then readiness and model listing use one path',t=>fixture(({t:tmp,root,path})=>{
 const repo=path('.hf-cache','hub','models--Systran--faster-whisper-small')
 put(join(repo,'blobs','bin'),'binary-weight');put(join(repo,'blobs','cfg'),'{}')
 const snap=join(repo,'snapshots','v1');mkdirSync(snap,{recursive:true})
 try{symlinkSync(join(repo,'blobs','bin'),join(snap,'model.bin'),'file');symlinkSync(join(repo,'blobs','cfg'),join(snap,'config.json'),'file')}
 catch(e){if(['EPERM','EACCES'].includes(e?.code)){t.skip('Windows symlinks disabled');return}throw e}
 const target=join(tmp,'whisper')
 assert.equal(migrateDomainOffline({root,domain:'whisper',target,confirmedStopped:true}).ok,true)
 assert.equal(readWhisperReadiness({stateDir:root,model:'small'}).modelCached,true)
 assert.ok(listWhisperModels({stateDir:root}).models.find(m=>m.model==='small'&&m.ready))
 assert.equal(readFileSync(storageDataPath(root,'.hf-cache','hub','models--Systran--faster-whisper-small','snapshots','v1','model.bin'),'utf8'),'binary-weight')
}))
test('configured target unavailable fails closed, never creates a blank identity',()=>fixture(({t,root,path})=>{
 put(path('life-memory','episodic.json'),'original')
 const target=join(t,'memory')
 migrateDomainOffline({root,domain:'memory',target,confirmedStopped:true})
 assert.equal(storageDataPath(root,'life-memory','episodic.json'),join(target,'life-memory','episodic.json'))
 rmSync(target,{recursive:true,force:true})
 assert.throws(()=>storageDataPath(root,'life-memory','episodic.json'),/不存在|身份|缺失/)
 assert.equal(readFileSync(path('life-memory','episodic.json'),'utf8'),'original')
}))
test('memory bundle still reads one migrated location and preserves revocation while restoring',()=>fixture(({t,root,path})=>{
 put(path('life-memory','episodic.json'),JSON.stringify({version:1,episodes:[],archiveKeys:[],updatedAt:0}))
 put(path('long-term-memory','dafeiyu.json'),JSON.stringify({version:3,scope:'dafeiyu-identity',policy:{},memories:[],traces:[],deleted:[],migration:{legacySessionFiles:[]}}))
 put(path('detail-protection','revocations-v1.json'),JSON.stringify({version:1,ids:['e-'+'a'.repeat(18)]}))
 migrateDomainOffline({root,domain:'memory',target:join(t,'life'),confirmedStopped:true})
 const data=collectBackupFiles(root)
 assert.ok(data['life-memory/episodic.json'])
 assert.ok(data['detail-protection/revocations-v1.json'])
 const pack=createLifeMemoryBackup(root)
 assert.ok(pack.files['long-term-memory/dafeiyu.json'])
 restoreLifeMemoryBackup(root,pack)
 assert.deepEqual(JSON.parse(readFileSync(storageDataPath(root,'detail-protection','revocations-v1.json'))).ids,['e-'+'a'.repeat(18)])
}))
test('legacy root-only cold snapshot fails closed after splitting stores',()=>fixture(({t,root,path})=>{
 put(path('life-memory','episodic.json'),'only-source-of-truth')
 migrateDomainOffline({root,domain:'memory',target:join(t,'life'),confirmedStopped:true})
 assert.throws(()=>createColdSnapshot({root,destination:join(t,'backup'),stoppedConfirmed:true}),/外置数据|不完整快照/)
}))
test('Python runtime is intentionally not copied: target rebuild required, legacy environment preserved',()=>fixture(({t,root,path})=>{
 put(path('.venv','pyvenv.cfg'),'home=old-path')
 const destination=join(t,'new-python')
 const plan=inspectDomainMigration({root,domain:'python',target:destination})
 assert.equal(plan.mode,'rebuild')
 const outcome=migrateDomainOffline({root,domain:'python',target:destination,confirmedStopped:true})
 assert.equal(outcome.rebuildRequired,true)
 assert.equal(existsSync(storageDataPath(root,'.venv','pyvenv.cfg')),false)
 assert.equal(existsSync(path('.venv','pyvenv.cfg')),true)
 assert.equal(storageDataPath(root,'.vision-venv','Scripts','python.exe'),join(destination,'.vision-venv','Scripts','python.exe'))
}))
test('nested / nonempty / symlink attacks and unknown migration domains are refused',()=>fixture(({t,root})=>{
 assert.throws(()=>inspectDomainMigration({root,domain:'memory',target:join(root,'child')}),/不能迁到|父目录/)
 const occupied=join(t,'occupied');mkdirSync(occupied);writeFileSync(join(occupied,'a'),'a')
 assert.throws(()=>inspectDomainMigration({root,domain:'memory',target:occupied}),/为空/)
 assert.throws(()=>inspectDomainMigration({root,domain:'unknown',target:join(t,'new')}),/未知/)
}))
test('forbidden symlink escaping Whisper repository is refused even for file targets',t=>fixture(({t:tmp,root,path})=>{
 const repo=path('.hf-cache','hub','models--Systran--faster-whisper-small')
 put(join(repo,'blobs','file'),'inside')
 put(join(tmp,'private-secret'),'outside-data')
 const snap=join(repo,'snapshots','v1');mkdirSync(snap,{recursive:true})
 try{symlinkSync(join(tmp,'private-secret'),join(snap,'secret.bin'),'file')}
 catch(e){if(['EPERM','EACCES'].includes(e?.code)){t.skip('Windows symlink privilege unavailable');return}throw e}
 assert.throws(()=>inspectDomainMigration({root,domain:'whisper',target:join(tmp,'external')}),/非预期的目录链接/)
 assert.equal(existsSync(join(tmp,'external')),false)
}))
test('tampered domain identity markers reject any active read without fallback',()=>fixture(({t,root,path})=>{
 put(path('life-memory','episodic.json'),'unique-lived-memory')
 const target=join(t,'life')
 migrateDomainOffline({root,domain:'memory',target,confirmedStopped:true})
 const marker=join(target,'.dafeiyu-storage-domain-v1.json')
 const content=JSON.parse(readFileSync(marker,'utf8'))
 content.nonce='malformed-local-identity'
 writeFileSync(marker,JSON.stringify(content))
 assert.throws(()=>storageDataPath(root,'life-memory','episodic.json'),/身份验证失败/)
 assert.equal(readFileSync(path('life-memory','episodic.json'),'utf8'),'unique-lived-memory')
}))
test('Windows offline Python/vision repair scripts use the validated active partition instead of stale C-drive paths',()=>{
 for(const name of ['repair-dsh-python-runtime.ps1','repair-dsh-vision-python.ps1']){
  const src=readFileSync(new URL('../tools/'+name,import.meta.url),'utf8')
  assert.match(src,/resolve-bili-duty-storage\.mjs/)
  assert.match(src,/\$target=\$resolved|\$venv=\$resolved/)
 }
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
 assert.ok(pkg.files.includes('scripts/resolve-bili-duty-storage.mjs'))
})
test('management endpoints are read-only and delegate actual migration to an offline script',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(host,/inspectDomainMigration\(/)
 assert.doesNotMatch(host,/migrateDomainOffline\(/)
 for(const id of ['storage-domain','storage-domain-list','storage-target','storage-offline-steps'])assert.ok(html.includes(`id="${id}"`))
})
