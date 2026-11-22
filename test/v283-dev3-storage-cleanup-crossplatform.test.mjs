import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {migrateDomainOffline,storageDataPath,rollbackDomainOffline} from '../lib/storage-layout.mjs'
import {inspectRetainedModelCopies,cleanupRetainedModelCopies} from '../lib/storage-maintenance.mjs'
import {storageTargetSuggestions,storageOfflineCommand} from '../lib/storage-platform.mjs'
const run=fn=>{const temp=mkdtempSync(join(tmpdir(),'dev3-storage-跨平台-')),root=join(temp,'bili-duty');mkdirSync(root);try{return fn({temp,root})}finally{rmSync(temp,{recursive:true,force:true})}}
const put=(file,content)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,content)}
const setup=({temp,root})=>{
 put(join(root,'.hf-cache','hub','model.bin'),'whisper-weights')
 put(join(root,'embedding-runtime','weights.bin'),'embed-weights')
 put(join(root,'tmp','asr','a.wav'),'asr-tmp')
 put(join(root,'vision-cache','a.json'),'reproducible')
 put(join(root,'life-memory','episodic.json'),'private life memory')
 put(join(root,'.venv','pyvenv.cfg'),'python env')
 const target=join(temp,'另一个盘','模型 storage','modelData')
 migrateDomainOffline({root,domain:'model',target,confirmedStopped:true})
 return target
}
test('platform suggestions use win32, macOS, Linux path rules and do not force a nonexistent D drive',()=>{
 assert.equal(storageTargetSuggestions('win32','C:\\Users\\鱼').model,'D:\\DSHData\\bili-duty\\modelData')
 assert.equal(storageTargetSuggestions('darwin','/Users/鱼').memory,'/Users/鱼/DSHData/bili-duty/lifeData')
 assert.equal(storageTargetSuggestions('linux','/home/鱼').python,'/home/鱼/DSHData/bili-duty/pythonData')
})
test('PowerShell single quotes and POSIX shell quotes preserve Unicode, spaces and apostrophes',()=>{
 const values={script:'/Users/a/b c.mjs',root:"/Users/O'Neil/大肥鱼",domain:'model',target:'/Volumes/外置 磁盘/模型'}
 const command=storageOfflineCommand({platform:'darwin',...values})
 assert.ok(command.includes("O'\\''Neil"));assert.ok(command.includes("'/Volumes/外置 磁盘/模型'"))
 const ps=storageOfflineCommand({platform:'win32',script:"C:\\O'Neil\\命令.mjs",root:"C:\\O'Neil\\data",domain:'python',target:'D:\\model dir',mode:'cache'})
 assert.ok(ps.includes("O''Neil"));assert.match(ps,/--mode 'cache'/)
 assert.doesNotMatch(storageOfflineCommand({platform:'linux',...values}),/PowerShell|D:\\\\DSHData/)
})
test('model copy inspection is non-destructive; cleanup needs all three explicit operator confirmations',()=>run(({temp,root})=>{
 const target=setup({temp,root})
 const scan=inspectRetainedModelCopies({root})
 assert.equal(scan.eligible,true);assert.equal(scan.verified,false);assert.equal(scan.paths.length,4)
 const verified=inspectRetainedModelCopies({root,verify:true})
 assert.equal(verified.eligible,true);assert.equal(verified.verified,true)
 assert.throws(()=>cleanupRetainedModelCopies({root}),/退出 DSH/)
 assert.throws(()=>cleanupRetainedModelCopies({root,confirmedStopped:true,confirmedRuntimeVerified:true}),/确认删除/)
 assert.equal(existsSync(join(root,'.hf-cache','hub','model.bin')),true)
 const result=cleanupRetainedModelCopies({root,confirmedStopped:true,confirmedRuntimeVerified:true,confirmedDeleteOldCopy:true})
 assert.equal(result.ok,true)
 for(const rel of ['.hf-cache','embedding-runtime','vision-cache'])assert.equal(existsSync(join(root,rel)),false)
 assert.equal(existsSync(join(root,'tmp','asr')),false)
 assert.equal(readFileSync(join(root,'life-memory','episodic.json'),'utf8'),'private life memory')
 assert.equal(readFileSync(join(root,'.venv','pyvenv.cfg'),'utf8'),'python env')
 assert.equal(readFileSync(storageDataPath(root,'.hf-cache','hub','model.bin'),'utf8'),'whisper-weights')
 assert.equal(existsSync(join(root,'.dafeiyu-model-cleanup-v1.json')),true)
 assert.match(inspectRetainedModelCopies({root}).reason,/清理记录/)
 assert.throws(()=>cleanupRetainedModelCopies({root,confirmedStopped:true,confirmedRuntimeVerified:true,confirmedDeleteOldCopy:true}),/清理被安全拒绝/)
 assert.throws(()=>rollbackDomainOffline({root,domain:'model',confirmedStopped:true}),/已有变化/)
}))
test('old copy changed after migration is not eligible for cleanup, preserving all original data',()=>run(({temp,root})=>{
 const target=setup({temp,root})
 put(join(root,'.hf-cache','hub','model.bin'),'changed and not matching')
 const report=inspectRetainedModelCopies({root,verify:true})
 assert.equal(report.eligible,false);assert.match(report.reason,/不同/)
 assert.throws(()=>cleanupRetainedModelCopies({root,confirmedStopped:true,confirmedRuntimeVerified:true,confirmedDeleteOldCopy:true}),/安全拒绝/)
 assert.equal(readFileSync(join(root,'.hf-cache','hub','model.bin'),'utf8'),'changed and not matching')
 assert.equal(readFileSync(join(target,'.hf-cache','hub','model.bin'),'utf8'),'whisper-weights')
}))
test('second model migration must never treat the original root as a verified active rollback copy',()=>run(({temp,root})=>{
 const first=setup({temp,root})
 migrateDomainOffline({root,domain:'model',target:join(temp,'second','modelData'),confirmedStopped:true})
 assert.equal(inspectRetainedModelCopies({root,verify:true}).eligible,false)
 assert.equal(existsSync(join(first,'.hf-cache','hub','model.bin')),true)
 assert.equal(existsSync(join(root,'.hf-cache','hub','model.bin')),true)
}))
test('escaping links in old Whisper directory prevent cleanup, even when source file exists',t=>run(({temp,root})=>{
 setup({temp,root})
 put(join(temp,'private','sensitive.bin'),'do not delete')
 try{symlinkSync(join(temp,'private','sensitive.bin'),join(root,'.hf-cache','outside.bin'),'file')}
 catch(error){if(['EPERM','EACCES'].includes(error?.code)){t.skip('no permission to create symlink');return}throw error}
 const report=inspectRetainedModelCopies({root,verify:true})
 assert.equal(report.eligible,false);assert.match(report.reason,/不可信|不同/)
 assert.throws(()=>cleanupRetainedModelCopies({root,confirmedStopped:true,confirmedRuntimeVerified:true,confirmedDeleteOldCopy:true}),/安全拒绝/)
 assert.equal(existsSync(join(temp,'private','sensitive.bin')),true)
}))
test('UI renders distinct root disk usage, active partitions, old-copy preview and platform-specific shell instructions',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const backend=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 for(const id of ['storage-retained-model-info','storage-retained-model-check','storage-retained-model-command'])assert.ok(html.includes(`id="${id}"`))
 assert.match(html,/上方仅统计原业务根目录的物理占用/)
 assert.match(js,/storagePlatform==='win32'/)
 assert.match(js,/--cleanup-retained-model/)
 assert.match(backend,/storage\/verify-retained-model/)
 assert.match(backend,/suggestedTargets:storageTargetSuggestions/)
})

test('CLI inspection is read-only and non-Windows advanced Python rebuild is refused before any mutation',()=>run(({temp,root})=>{
 setup({temp,root})
 const cli=new URL('../scripts/migrate-bili-duty-domain.mjs',import.meta.url)
 const result=spawnSync(process.execPath,[cli.pathname,'--root',root,'--inspect-retained-model'],{encoding:'utf8'})
 assert.equal(result.status,0)
 assert.match(result.stdout,/"verified": true/)
 assert.equal(existsSync(join(root,'.hf-cache','hub','model.bin')),true)
 if(process.platform!=='win32'){
  const denied=spawnSync(process.execPath,[cli.pathname,'--root',root,'--domain','python','--mode','rebuild',
   '--to',join(temp,'pythonData'),'--confirm-stopped'],{encoding:'utf8'})
  assert.equal(denied.status,1)
  assert.match(denied.stderr,/仅可迁移 uv\/pip 包缓存/)
  assert.equal(existsSync(join(temp,'pythonData')),false)
 }
}))
test('HF internal blob file symlinks materialized on new storage remain verifiable before cleanup',t=>run(({temp,root})=>{
 const cache=join(root,'.hf-cache','hub','models--example')
 put(join(cache,'blobs','weight'), 'the-blob')
 mkdirSync(join(cache,'snapshots','main'),{recursive:true})
 try{symlinkSync(join(cache,'blobs','weight'),join(cache,'snapshots','main','weights.bin'),'file')}
 catch(e){if(['EPERM','EACCES'].includes(e?.code)){t.skip('no symlink creation permission');return}throw e}
 const target=join(temp,'modelData')
 migrateDomainOffline({root,domain:'model',target,confirmedStopped:true})
 const report=inspectRetainedModelCopies({root,verify:true})
 assert.equal(report.eligible,true)
 assert.equal(readFileSync(join(target,'.hf-cache','hub','models--example','snapshots','main','weights.bin'),'utf8'),'the-blob')
}))
