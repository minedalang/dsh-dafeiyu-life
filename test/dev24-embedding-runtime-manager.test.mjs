import test from 'node:test'
import assert from 'node:assert/strict'
import {createEmbeddingRuntimeManager,__test} from '../lib/embedding-runtime-manager.mjs'
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

test('Qwen3 GGUF 模型资产固定到官方 revision、文件大小和 SHA-256',()=>{
  assert.equal(__test.MODEL.id,'Qwen/Qwen3-Embedding-0.6B-GGUF')
  assert.equal(__test.MODEL.revision,'370f27d7550e0def9b39c1f16d3fbaa13aa67728')
  assert.equal(__test.MODEL.file,'Qwen3-Embedding-0.6B-Q8_0.gguf')
  assert.equal(__test.MODEL.bytes,639150592)
  assert.match(__test.MODEL.sha256,/^[a-f0-9]{64}$/)
  assert.equal(__test.MODEL.dimension,1024)
  assert.match(__test.MODEL.url,/huggingface\.co\/Qwen\/Qwen3-Embedding-0\.6B-GGUF\/resolve\/370f27d/)
})

test('llama.cpp CPU Runtime 平台资产固定版本和官方构建摘要',()=>{
  assert.equal(__test.RUNTIME.version,'b12110')
  assert.equal(__test.runtimeAsset('win32','x64').file,'llama-b12110-bin-win-cpu-x64.zip')
  assert.equal(__test.runtimeAsset('win32','x64').sha256,'98901e327c252875accaf2d1bf364e10e868843b0b63468baad1aa945cdc5da2')
  assert.equal(__test.runtimeAsset('darwin','arm64').file,'llama-b12110-bin-macos-arm64.tar.gz')
  assert.equal(__test.runtimeAsset('linux','x64').file,'llama-b12110-bin-ubuntu-x64.tar.gz')
  assert.throws(()=>__test.runtimeAsset('freebsd','x64'),/暂不支持/)
})

test('Runtime 压缩包路径校验拒绝绝对路径、盘符和目录穿越',()=>{
  assert.equal(__test.validateArchiveNames('bin/llama-server\nlib/libggml.so\n'),2)
  assert.throws(()=>__test.validateArchiveNames('../outside.txt'),/不安全路径/)
  assert.throws(()=>__test.validateArchiveNames('/etc/passwd'),/不安全路径/)
  assert.throws(()=>__test.validateArchiveNames('C:\\Windows\\system.ini'),/不安全路径/)
})

test('不支持的平台可以读取状态，但不会在插件初始化时崩溃',async()=>{
  const manager=createEmbeddingRuntimeManager({dataDir:'/tmp/dsh-embedding-test',platform:'freebsd',arch:'x64',fetchImpl:async()=>{throw Error('unexpected fetch')}})
  const status=manager.status()
  assert.equal(status.supported,false)
  assert.equal(status.server.ready,false)
  await assert.rejects(manager.install(),/暂不支持/)
})


test('平台安装包内置 Runtime 优先使用，删除模型时不会删除随包 Runtime',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-bundled-runtime-')),data=join(root,'state'),packageRoot=join(root,'package')
  try{
    const bundle=join(packageRoot,'vendor','embedding-runtime','linux-x64'),runtime=join(bundle,'runtime')
    await mkdir(runtime,{recursive:true});await writeFile(join(runtime,'llama-server'),'fake-runtime')
    const asset=__test.RUNTIME.assets['linux-x64']
    await writeFile(join(bundle,'dsh-runtime-manifest.json'),JSON.stringify({schema:1,version:__test.RUNTIME.version,platform:'linux-x64',sha256:asset.sha256,binary:'runtime/llama-server'}))
    const manager=createEmbeddingRuntimeManager({dataDir:data,packageRoot,platform:'linux',arch:'x64',fetchImpl:async()=>{throw Error('不应下载 Runtime')}})
    const before=await manager.inspect()
    assert.equal(before.runtime.installed,true)
    assert.equal(before.runtime.source,'bundled')
    await manager.removeAssets()
    const after=await manager.inspect()
    assert.equal(after.runtime.installed,true)
    assert.equal(after.runtime.source,'bundled')
    assert.equal(after.model.installed,false)
    assert.equal(await readFile(join(runtime,'llama-server'),'utf8'),'fake-runtime')
  }finally{await rm(root,{recursive:true,force:true})}
})

test('下载式 Runtime 清单含平台标识，重启后仍能识别本机安装',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-runtime-restart-'))
  try{
    const state=join(root,'state'),runtime=join(state,'embedding-runtime','llama-b12110-linux-x64')
    await mkdir(runtime,{recursive:true})
    await writeFile(join(runtime,'llama-server'),'test-runtime')
    const manager=createEmbeddingRuntimeManager({dataDir:state,packageRoot:join(root,'unbundled'),platform:'linux',arch:'x64'})
    const asset=__test.RUNTIME.assets['linux-x64']
    const manifest={schema:1,version:__test.RUNTIME.version,platform:'linux-x64',sha256:asset.sha256,binary:'llama-server'}
    await writeFile(join(runtime,'dsh-runtime-manifest.json'),JSON.stringify(manifest))
    const found=await manager.inspect()
    assert.equal(found.runtime.installed,true)
    assert.equal(found.runtime.source,'state')
    // Legacy/incomplete manifests must fail closed, rather than accept a runtime from an unbound platform.
    await writeFile(join(runtime,'dsh-runtime-manifest.json'),JSON.stringify({...manifest,platform:'win32-x64'}))
    const different=createEmbeddingRuntimeManager({dataDir:state,packageRoot:join(root,'unbundled'),platform:'linux',arch:'x64'})
    assert.equal((await different.inspect()).runtime.installed,false)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('模型离线导入失败会清理临时文件且不安装无效模型',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-embedding-import-'))
  try{
    const manager=createEmbeddingRuntimeManager({dataDir:root,platform:'linux',arch:'x64'})
    const {Readable}=await import('node:stream')
    await assert.rejects(manager.importModel(Readable.from([Buffer.from('not-a-model')]),{contentLength:11}),/校验失败/)
    const {access}=await import('node:fs/promises')
    await assert.rejects(access(manager.paths.modelPath))
    await assert.rejects(access(manager.paths.modelPath+'.import.part'))
  }finally{await rm(root,{recursive:true,force:true})}
})

test('内置视觉只有两款 Qwen 固定配对，拒绝 MiniCPM 与任意下载输入',async()=>{
  const {LLAMA_VISION_MODELS,llamaVisionAssetUrl}=await import('../lib/llama-vision-experiment.mjs')
  const manager=createEmbeddingRuntimeManager({dataDir:'/tmp/dsh-native-vision-catalog',platform:'linux',arch:'x64',fetchImpl:async()=>{throw Error('unexpected network')}})
  const state=await manager.visionStatus()
  assert.deepEqual(state.models.map(x=>x.id),['qwen3.5-2b','qwen3.5-4b'])
  assert.equal(state.productionEnabled,false)
  assert.throws(()=>manager.runVision('install','minicpm-v4.7-1b'),/仅支持 Qwen/)
  assert.throws(()=>manager.runVision('install','https://example.invalid/model.gguf'),/仅支持 Qwen/)
  for(const model of LLAMA_VISION_MODELS)for(const asset of [model.weights,model.mmproj]){
    assert.equal(asset.sha256.length,64)
    assert.ok(asset.bytes>0)
    assert.equal(new URL(llamaVisionAssetUrl(model,asset)).hostname,'huggingface.co')
    assert.ok(llamaVisionAssetUrl(model,asset).includes('/resolve/'+model.revision+'/'))
  }
})

test('视觉下载复用已有 Runtime，损坏文件不安装，Embedding 状态与文件保持',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-native-vision-download-'))
  try{
    const dataDir=join(root,'state'),packageRoot=join(root,'package'),bundle=join(packageRoot,'vendor','embedding-runtime','linux-x64')
    await mkdir(bundle,{recursive:true});await writeFile(join(bundle,'llama-server'),'fake-runtime')
    await writeFile(join(bundle,'dsh-runtime-manifest.json'),JSON.stringify({schema:1,version:__test.RUNTIME.version,platform:'linux-x64',sha256:__test.RUNTIME.assets['linux-x64'].sha256,binary:'llama-server'}))
    const requests=[]
    const manager=createEmbeddingRuntimeManager({dataDir,packageRoot,platform:'linux',arch:'x64',logger:{warn(){}},fetchImpl:async(url,opts)=>{requests.push(url);return new Response('corrupt')}})
    await assert.rejects(manager.runVision('install','qwen3.5-2b'),/文件大小不匹配/)
    const state=await manager.visionStatus()
    assert.equal(state.progress.phase,'error');assert.equal(state.models[0].filesPresent,false);assert.equal(state.models[0].result,null)
    assert.ok(requests.length>0&&requests.every(url=>url.includes('Qwen3.5-2B-GGUF')))
    assert.equal(manager.status().progress.phase,'missing')
    assert.equal((await manager.inspect()).model.installed,false)
    assert.equal(await readFile(join(bundle,'llama-server'),'utf8'),'fake-runtime')
    await assert.rejects(manager.runVision('verify','qwen3.5-2b'),/尚未安装/)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('Embedding 与视觉共享运行时下载；取消单方不影响另一方，维护仍排他',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-native-vision-cancel-'))
  try{
    let notify,signal,calls=0;const started=new Promise(r=>notify=r)
    const manager=createEmbeddingRuntimeManager({dataDir:root,packageRoot:join(root,'empty'),platform:'linux',arch:'x64',logger:{warn(){}},fetchImpl:async(url,opts)=>{calls++;signal=opts.signal;notify();return new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})}})
    const vision=manager.runVision('install','qwen3.5-4b');vision.catch(()=>{});await started
    const embedding=manager.install();embedding.catch(()=>{});
    // Observe both subscribers receiving the same runtime progress.
    for(let i=0;i<100&&manager.status().progress.phase!=='downloading';i++)await new Promise(r=>setTimeout(r,10))
    assert.equal(manager.status().progress.phase,'downloading')
    assert.equal(calls,1);assert.equal((await manager.visionStatus()).visionBusy,true)
    assert.throws(()=>manager.runVision('verify','qwen3.5-2b'),/正在安装或测试/)
    assert.throws(()=>manager.beginEmbeddingMaintenance(),/正在维护/)
    await assert.rejects(manager.removeAssets(),/暂不能删除/)
    assert.equal(manager.cancelVision(),true);await assert.rejects(vision)
    assert.equal(signal.aborted,false);assert.equal((await manager.visionStatus()).progress.phase,'cancelled')
    assert.equal(manager.cancelInstall(),true);await assert.rejects(embedding)
    assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(manager.status().progress.phase,'cancelled')
  }finally{await rm(root,{recursive:true,force:true})}
})

test('共享运行时已安装时两种权重实际并行，单项取消不影响另一下载',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-model-parallel-'))
  try{
    const packageRoot=join(root,'package'),bundle=join(packageRoot,'vendor','embedding-runtime','linux-x64')
    await mkdir(bundle,{recursive:true});await writeFile(join(bundle,'llama-server'),'fake-runtime')
    await writeFile(join(bundle,'dsh-runtime-manifest.json'),JSON.stringify({schema:1,version:__test.RUNTIME.version,platform:'linux-x64',sha256:__test.RUNTIME.assets['linux-x64'].sha256,binary:'llama-server'}))
    const signals=new Map()
    const manager=createEmbeddingRuntimeManager({dataDir:join(root,'state'),packageRoot,platform:'linux',arch:'x64',logger:{warn(){}},fetchImpl:async(url,{signal})=>{signals.set(url.includes('Embedding')?'embedding':'vision',signal);return new Promise((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true})})}})
    const embedding=manager.install();embedding.catch(()=>{});const vision=manager.runVision('install','qwen3.5-2b');vision.catch(()=>{});
    try{for(let i=0;i<150&&signals.size!==2;i++)await new Promise(r=>setTimeout(r,10));assert.equal(signals.size,2);manager.cancelInstall();await assert.rejects(embedding);assert.equal(signals.get('vision').aborted,false);assert.equal((await manager.visionStatus()).visionBusy,true)}finally{manager.cancelInstall();manager.cancelVision();await Promise.allSettled([embedding,vision])}
    assert.equal(manager.status().progress.phase,'cancelled');assert.equal((await manager.visionStatus()).progress.phase,'cancelled')
  }finally{await rm(root,{recursive:true,force:true})}
})

test('内置视觉原图走真实环回 HTTP，严格区分可见回答与思考/截断，并回收自己的进程',async()=>{
  const {runLlamaVisionImageTest,LLAMA_VISION_MODELS}=await import('../lib/llama-vision-experiment.mjs')
  const {getLocalVisionTestImage,LOCAL_VISION_TEST_PROMPT}=await import('../lib/local-vision-model-manager.mjs')
  const {createServer}=await import('node:http');const {EventEmitter}=await import('node:events')
  let reply,expectedKey,requestBody,closed=0,authHeaders=[]
  const server=createServer(async(req,res)=>{
    authHeaders.push(req.headers.authorization)
    res.setHeader('Content-Type','application/json')
    if(req.url==='/health'){res.end(JSON.stringify({status:'ok'}));return}
    const chunks=[];for await(const chunk of req)chunks.push(chunk)
    requestBody=JSON.parse(Buffer.concat(chunks));res.end(JSON.stringify({choices:[reply]}))
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  try{
    const invoke=()=>runLlamaVisionImageTest({binary:'/fake/llama-server',weights:'/fake/a.gguf',mmproj:'/fake/p.gguf',model:LLAMA_VISION_MODELS[0],port:server.address().port,signal:new AbortController().signal,fetchImpl:fetch,spawnImpl:(file,args,opts)=>{
      assert.equal(opts.shell,false);assert.equal(args[args.indexOf('--host')+1],'127.0.0.1');assert.equal(args[args.indexOf('--n-gpu-layers')+1],'0')
      expectedKey='Bearer '+args[args.indexOf('--api-key')+1]
      const child=new EventEmitter();child.kill=()=>{closed++;child.emit('exit',0);child.emit('close',0);return true};return child
    }})
    reply={finish_reason:'stop',message:{content:'模拟原图描述',reasoning_content:'不应成为回答'}}
    assert.deepEqual(await invoke(),{answer:'模拟原图描述',finishReason:'stop'})
    assert.equal(authHeaders.at(-1),expectedKey)
    assert.equal(requestBody.messages[0].content[0].text,LOCAL_VISION_TEST_PROMPT)
    assert.deepEqual(Buffer.from(requestBody.messages[0].content[1].image_url.url.split(',')[1],'base64'),getLocalVisionTestImage())
    assert.equal(requestBody.chat_template_kwargs.enable_thinking,false)
    reply={finish_reason:'length',message:{content:'截断'}};await assert.rejects(invoke(),/未取得完整/)
    reply={finish_reason:'stop',message:{reasoning_content:'只有思考'}};await assert.rejects(invoke(),/未取得完整/)
    assert.equal(closed,3)
  }finally{await new Promise(resolve=>server.close(resolve))}
})

test('共享 Runtime 管理预约期间试验不可启动，解除后恢复',async()=>{
  const manager=createEmbeddingRuntimeManager({dataDir:'/tmp/dsh-native-vision-reservation',platform:'linux',arch:'x64'})
  const release=manager.beginEmbeddingMaintenance()
  assert.equal((await manager.visionStatus()).busy,true)
  assert.throws(()=>manager.runVision('install','qwen3.5-2b'),/共享运行时/)
  assert.throws(()=>manager.beginEmbeddingMaintenance(),/共享运行时/)
  release()
  assert.equal((await manager.visionStatus()).busy,false)
})

test('V2 native vision download uses external model directory and missing marker prevents new writes',async()=>{
  const {largeDataStatus,migrateLargeDataOffline}=await import('../lib/storage-large-data-v2.mjs')
  const root=await mkdtemp(join(tmpdir(),'dsh-native-vision-v2-'))
  try{
    const dataDir=join(root,'state'),target=join(root,'external'),packageRoot=join(root,'package'),bundle=join(packageRoot,'vendor','embedding-runtime','linux-x64')
    await mkdir(dataDir,{recursive:true});await mkdir(bundle,{recursive:true});await writeFile(join(bundle,'llama-server'),'fake-runtime')
    await writeFile(join(bundle,'dsh-runtime-manifest.json'),JSON.stringify({schema:1,version:__test.RUNTIME.version,platform:'linux-x64',sha256:__test.RUNTIME.assets['linux-x64'].sha256,binary:'llama-server'}))
    migrateLargeDataOffline({root:dataDir,target,confirmedStopped:true,python:'fixture',runtimeProbe:()=>true})
    const storage=largeDataStatus(dataDir);let calls=0
    const manager=createEmbeddingRuntimeManager({dataDir,modelDir:storage.embeddingModelDir,visionModelDir:storage.visionModelDir,assertModelStorage:()=>largeDataStatus(dataDir),packageRoot,platform:'linux',arch:'x64',fetchImpl:async()=>{calls++;return new Response('corrupt')}})
    await assert.rejects(manager.runVision('install','qwen3.5-2b'),/文件大小不匹配/)
    assert.equal(await readFile(join(storage.visionModelDir,'qwen3.5-2b','Qwen3.5-2B-Q4_K_M.gguf.part'),'utf8'),'corrupt')
    const {access}=await import('node:fs/promises');await assert.rejects(access(join(dataDir,'embedding-runtime','vision-models')))
    await rm(join(target,'.dafeiyu-large-data-v2.json'))
    const previous=calls;await assert.rejects(manager.visionStatus(),/标记/)
    await assert.rejects(manager.runVision('install','qwen3.5-4b'),/标记/);assert.equal(calls,previous)
    await assert.rejects(access(join(storage.visionModelDir,'qwen3.5-4b')))
  }finally{await rm(root,{recursive:true,force:true})}
})
