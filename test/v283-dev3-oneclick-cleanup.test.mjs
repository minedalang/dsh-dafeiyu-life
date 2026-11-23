import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {migrateDomainOffline,storageDataPath} from '../lib/storage-layout.mjs'
import {inspectRetainedModelCopies} from '../lib/storage-maintenance.mjs'
import {verifyRelocatedModelRuntime,findLocalWhisperModel} from '../lib/storage-model-runtime-check.mjs'
import {queueModelCleanup,runQueuedCleanup,readCleanupJob,runtimeProcessesStopped,provenExternalOllamaRunner} from '../lib/storage-cleanup-queue.mjs'
const put=(p,text)=>{mkdirSync(dirname(p),{recursive:true});writeFileSync(p,text)}
const withMigration=async fn=>{
 const temp=mkdtempSync(join(tmpdir(),'oneclick-存储-')),root=join(temp,'bili-duty');mkdirSync(root)
 try{
  put(join(root,'.hf-cache','hub','models--Systran--faster-whisper-small','snapshots','abc','model.bin'),'weight')
  put(join(root,'.hf-cache','hub','models--Systran--faster-whisper-small','snapshots','abc','config.json'),'{}')
  put(join(root,'embedding-runtime','model.gguf'),'fake')
  put(join(root,'vision-cache','frame.json'),'cached frame')
  put(join(root,'.venv','pyvenv.cfg'),'do not touch')
  put(join(root,'life-memory','memory.json'),'precious memory')
  const target=join(temp,'new storage','modelData')
  migrateDomainOffline({root,domain:'model',target,confirmedStopped:true})
  return await fn({temp,root,target})
 }finally{rmSync(temp,{force:true,recursive:true})}
}
const fakeEmbed=root=>({paths:{root:storageDataPath(root,'embedding-runtime')},status:()=>({server:{ready:false}}),start:async()=>{},embedQuery:async()=>new Float32Array(1024).fill(.4),stopAndWait:async()=>{}})
test('one-click verifier loads migrated Whisper snapshot and requires a real 1024-dimensional embedding query',()=>withMigration(async({root,target})=>{
 const calls=[]
 const result=await verifyRelocatedModelRuntime({root,asrPython:process.execPath,embeddingRuntime:fakeEmbed(root),
  pythonProbe:async x=>{calls.push(x);return {ok:true,reason:'real probe mocked for unit test'}},visionEnabled:false})
 assert.equal(result.ready,true)
 assert.equal(result.target,target)
 assert.equal(calls.length,1)
 assert.match(calls[0].modelDir,/modelData/)
 assert.equal(result.checks.vision.notApplicable,true)
 assert.equal(findLocalWhisperModel({root,model:'small'}),calls[0].modelDir)
}))
test('embedding verification rejects a healthy server still bound to its old model path',()=>withMigration(async({root})=>{
 const stale=fakeEmbed(root)
 stale.paths.root=join(root,'embedding-runtime')
 const result=await verifyRelocatedModelRuntime({root,asrPython:process.execPath,
  pythonProbe:async()=>({ok:true}),embeddingRuntime:stale,visionEnabled:false})
 assert.equal(result.ready,false)
 assert.equal(result.checks.embedding.ok,false)
 assert.match(result.checks.embedding.reason,/仍指向旧位置/)
}))
test('image result must be reviewed by owner; a model response alone cannot authorize deletion',()=>withMigration(async({root})=>{
 const result=await verifyRelocatedModelRuntime({root,asrPython:process.execPath,embeddingRuntime:fakeEmbed(root),
  pythonProbe:async()=>({ok:true}),visionEnabled:true,visionMode:'independent_dsh',
  visionPipelineProbe:async()=>({ok:true}),
  visionDshReview:{verify:async()=>({ok:true,awaitingReview:true,reviewId:'review-1'})}})
 assert.equal(result.ready,false)
 assert.equal(result.checks.vision.pendingReview,true)
}))
test('button only enqueues; worker requires parent exit and rehashes before deleting any files',()=>withMigration(async({root,target})=>{
 let workerArgs
 const fakeSpawn=(...args)=>{workerArgs=args;return {pid:444,unref(){}}}
 assert.throws(()=>queueModelCleanup({root,verification:{ready:false,at:Date.now(),target},workerScript:'worker.mjs',spawnImpl:fakeSpawn}),/未全部通过/)
 assert.equal(existsSync(join(root,'.hf-cache')),true)
 const queued=queueModelCleanup({root,verification:{ready:true,at:Date.now(),target},workerScript:'worker.mjs',parentPid:123456,spawnImpl:fakeSpawn})
 assert.equal(queued.scheduled,true);assert.equal(readCleanupJob(root).status,'waiting')
 assert.equal(existsSync(join(root,'.hf-cache')),true)
 assert.equal(workerArgs[1].includes('--parent-pid'),true)
 const blocked=await runQueuedCleanup({root,parentPid:123456,jobId:readCleanupJob(root).id,
  processIsAlive:()=>false,inspectProcesses:()=>({ok:false,conflicts:['python.exe']}),pause:async()=>{}})
 assert.equal(blocked.ok,false);assert.equal(readCleanupJob(root).status,'failed')
 assert.equal(existsSync(join(root,'.hf-cache')),true)
 // A new explicit button action is required after a failed attempt.
 queueModelCleanup({root,verification:{ready:true,at:Date.now(),target},workerScript:'worker.mjs',parentPid:123456,spawnImpl:fakeSpawn})
 const completed=await runQueuedCleanup({root,parentPid:123456,jobId:readCleanupJob(root).id,
  processIsAlive:()=>false,inspectProcesses:()=>({ok:true,conflicts:[]}),pause:async()=>{}})
 assert.equal(completed.ok,true)
 assert.equal(readCleanupJob(root).status,'completed')
 assert.equal(existsSync(join(root,'.hf-cache')),false)
 assert.equal(readFileSync(join(root,'life-memory','memory.json'),'utf8'),'precious memory')
 assert.equal(readFileSync(join(root,'.venv','pyvenv.cfg'),'utf8'),'do not touch')
 assert.equal(existsSync(join(target,'.hf-cache')),true)
}))
test('background worker refuses changes after confirmation and never deletes old copies',()=>withMigration(async({root,target})=>{
 queueModelCleanup({root,verification:{ready:true,at:Date.now(),target},workerScript:'worker.mjs',parentPid:123456,
  spawnImpl:()=>({pid:444,unref(){}})})
 put(join(root,'embedding-runtime','model.gguf'),'MUTATED')
 const denied=await runQueuedCleanup({root,parentPid:123456,jobId:readCleanupJob(root).id,
  processIsAlive:()=>false,inspectProcesses:()=>({ok:true,conflicts:[]})})
 assert.equal(denied.ok,false);assert.match(denied.reason,/变化/)
 assert.equal(existsSync(join(root,'embedding-runtime','model.gguf')),true)
}))
test('cross-platform process scan blocks Python/DSH and fails closed on unsupported systems',()=>{
 const posix=()=>({status:0,stdout:' 1 init\n 90 python3.12\n 100 node\n'})
 const blocked=runtimeProcessesStopped({platform:'darwin',exec:posix,selfPid:100})
 assert.equal(blocked.ok,false);assert.ok(blocked.conflicts.includes('python3.12'))
 const windows=()=>({status:0,stdout:'"DSH Desktop.exe","32","Console","1","1,000 K"\n"node.exe","100","Console","1","1,000 K"'})
 assert.equal(runtimeProcessesStopped({platform:'win32',exec:windows,selfPid:100}).ok,false)
 assert.throws(()=>runtimeProcessesStopped({platform:'freebsd'}),/尚未验证/)
})

const winRoot='C:\\Users\\dalang\\.dsh\\bili-duty'
const ollamaProvenance={
 pid:321,exe:'C:\\Users\\dalang\\AppData\\Local\\Programs\\Ollama\\lib\\ollama\\runners\\cpu\\llama-server.exe',
 command:'"C:\\Users\\dalang\\AppData\\Local\\Programs\\Ollama\\lib\\ollama\\runners\\cpu\\llama-server.exe" --model "D:\\Ollama Models\\blobs\\sha256-model" --ctx-size 4096',
 parentName:'ollama.exe',parentExe:'C:\\Users\\dalang\\AppData\\Local\\Programs\\Ollama\\ollama.exe',
}
test('external Ollama runner classification requires trusted parent, bundle and model outside old DSH root',()=>{
 assert.equal(provenExternalOllamaRunner(ollamaProvenance,{root:winRoot}),true)
 assert.equal(provenExternalOllamaRunner({...ollamaProvenance,parentName:'node.exe'},{root:winRoot}),false)
 assert.equal(provenExternalOllamaRunner({...ollamaProvenance,exe:winRoot+'\\embedding-runtime\\runtime\\llama-server.exe'},{root:winRoot}),false)
 assert.equal(provenExternalOllamaRunner({...ollamaProvenance,command:'llama-server.exe --model '+winRoot+'\\embedding-runtime\\model.gguf'},{root:winRoot}),false)
 assert.equal(provenExternalOllamaRunner({...ollamaProvenance,command:'llama-server.exe --ctx-size 4096'},{root:winRoot}),false)
 assert.equal(provenExternalOllamaRunner({...ollamaProvenance,command:ollamaProvenance.command+' --lora '+winRoot+'\\.hf-cache\\file'},{root:winRoot}),false)
 assert.equal(provenExternalOllamaRunner({...ollamaProvenance,parentExe:'C:\\External\\ollama.exe'},{root:winRoot}),false)
})
test('Windows cleanup process scan only ignores proven external Ollama llama-server; migration remains strict',()=>{
 const windowsTaskList={status:0,stdout:'"llama-server.exe","321","Console","1","123,456 K"\n"node.exe","100","Console","1","10,000 K"'}
 const exec=(command)=>command==='tasklist.exe'?windowsTaskList:({status:0,stdout:JSON.stringify(ollamaProvenance)})
 assert.equal(runtimeProcessesStopped({platform:'win32',exec,selfPid:100}).ok,false)
 const scoped=runtimeProcessesStopped({platform:'win32',exec,selfPid:100,root:winRoot})
 assert.equal(scoped.ok,true)
 const failClosed=runtimeProcessesStopped({platform:'win32',exec:(command)=>command==='tasklist.exe'?windowsTaskList:{status:1,stdout:''},selfPid:100,root:winRoot})
 assert.equal(failClosed.ok,false)
 assert.deepEqual(failClosed.conflicts,['llama-server.exe'])
})

test('a model process starting after SHA verification blocks cleanup before deletion',()=>withMigration(async({root,target})=>{
 queueModelCleanup({root,verification:{ready:true,at:Date.now(),target},workerScript:'worker.mjs',parentPid:123456,spawnImpl:()=>({pid:444,unref(){}})})
 let checks=0
 const denied=await runQueuedCleanup({root,parentPid:123456,jobId:readCleanupJob(root).id,processIsAlive:()=>false,
  inspectProcesses:()=>++checks===1?{ok:true,conflicts:[]}:{ok:false,conflicts:['llama-server.exe']}})
 assert.equal(checks,2)
 assert.equal(denied.ok,false)
 assert.equal(readCleanupJob(root).status,'failed')
 assert.equal(existsSync(join(root,'.hf-cache')),true)
 assert.equal(existsSync(join(target,'.hf-cache')),true)
}))
