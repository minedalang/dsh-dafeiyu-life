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
  assert.equal(state.productionEnabled,true)
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
    const previous=calls;await assert.rejects(manager.visionStatus(),/标记/);await assert.rejects(manager.inspect(),/标记/)
    await assert.rejects(manager.runVision('install','qwen3.5-4b'),/标记/);assert.equal(calls,previous)
    await assert.rejects(access(join(storage.visionModelDir,'qwen3.5-4b')))
  }finally{await rm(root,{recursive:true,force:true})}
})


test('native vision lease keeps owned process alive for multiple requests, revokes scope and cleans up',async()=>{
  const {withLlamaVisionRuntime,LLAMA_VISION_MODELS}=await import('../lib/llama-vision-experiment.mjs')
  const {EventEmitter}=await import('node:events')
  let closed=0,scope,requests=[]
  const options={binary:'/fake/llama-server',weights:'/fake/a.gguf',mmproj:'/fake/p.gguf',model:LLAMA_VISION_MODELS[0],port:12345,signal:new AbortController().signal,
    spawnImpl:()=>{const child=new EventEmitter();child.kill=()=>{closed++;child.emit('exit',0);child.emit('close',0);return true};return child},
    fetchImpl:async(url,opts)=>{requests.push([url,opts.headers.Authorization]);return new Response(JSON.stringify(url.endsWith('/health')?{status:'ok'}:{choices:[]}))}}
  const answer=await withLlamaVisionRuntime(options,async lease=>{
    scope=lease;assert.equal(closed,0);assert.equal(lease.model,'qwen3.5-2b');assert.equal(lease.signal.aborted,false)
    await lease.request({stream:false},1000);await lease.request({stream:false},1000)
    return 'done'
  })
  assert.equal(answer,'done');assert.equal(closed,1);assert.equal(scope.signal.aborted,true)
  assert.equal(requests.length,3);assert.ok(requests.every(([url,key])=>url.startsWith('http://127.0.0.1:12345/')&&key==='Bearer '+scope.key))
  assert.throws(()=>scope.request({},1000),/租约已结束/)
  await assert.rejects(withLlamaVisionRuntime(options,async()=>{throw Error('consumer failed')}),/consumer failed/)
  assert.equal(closed,2)
})

test('native production lease refuses missing assets and excludes maintenance until settled',async()=>{
  const home=await mkdtemp(join(tmpdir(),'dsh-native-lease-'))
  try{
    const manager=createEmbeddingRuntimeManager({dataDir:home,platform:'linux',arch:'x64'})
    const lease=manager.withVisionRuntime('qwen3.5-2b',()=>assert.fail('missing assets cannot reach consumer'))
    assert.throws(()=>manager.beginEmbeddingMaintenance(),/共享运行时/)
    assert.throws(()=>manager.runVision('install','qwen3.5-4b'),/共享运行时/)
    await assert.rejects(lease,/视觉资源尚未安装/)
    const release=manager.beginEmbeddingMaintenance();release()
    assert.throws(()=>manager.withVisionRuntime('../model',()=>{}),/受管视觉模型/)
  }finally{await rm(home,{recursive:true,force:true})}
})

test('one-shot native worker receives only its lease, checks staged scripts and closes',async()=>{
  const {callScopedNativeVision}=await import('../lib/scoped-native-vision-read.mjs')
  const home=await mkdtemp(join(tmpdir(),'dsh-native-worker-'))
  try{
    for(const [name,source] of [['mcp_server.py','../vendor/bilibili-mcp/mcp_server.py'],['preview_vision.py','../lib/preview_vision.py']])await writeFile(join(home,name),await readFile(new URL(source,import.meta.url)))
    let current=true,started=0,stopped=0,aborted=false
    const controller=new AbortController(),key='a'.repeat(64)
    const runtime={withVisionRuntime:async(id,fn)=>{started++;return fn({model:id,port:12345,key,signal:controller.signal})}}
    const opts={runtime,modelId:'qwen3.5-2b',command:'python',home,isCurrent:()=>current,args:{bvid:'BV1234567890'},makeClient:options=>{
      assert.equal(options.env.BILI_MCP_TOOLS,'bili_preview_vision');assert.equal(options.env.BILI_JS_MCP_ADAPTER,'0');assert.equal(options.env.DSH_NATIVE_VISION_KEY,key);assert.equal(options.env.BILI_VISION_MODEL,'qwen3.5:2b')
      return {call:async(tool,args)=>{assert.equal(tool,'bili_preview_vision');assert.deepEqual(args,opts.args);if(aborted)controller.abort();return {ok:true,status:'analyzed'}},stopAndWait:async()=>{stopped++}}
    }}
    assert.deepEqual(await callScopedNativeVision(opts),{ok:true,status:'analyzed'});assert.equal(stopped,1)
    current=false;await assert.rejects(callScopedNativeVision(opts),/执行范围/);assert.equal(started,1)
    current=true;aborted=true;await assert.rejects(callScopedNativeVision(opts));assert.equal(stopped,2)
    await writeFile(join(home,'preview_vision.py'),'stale');await assert.rejects(callScopedNativeVision(opts),/一致性/);assert.equal(started,2)
  }finally{await rm(home,{recursive:true,force:true})}
})


test('round native host accepts only current selected BV and revokes pending scope',async()=>{
  const {startNativeVisionRoundHost}=await import('../lib/scoped-native-vision-read.mjs')
  let current=true,selected=true,calls=0,scope
  const host=await startNativeVisionRoundHost({isCurrent:()=>current,isSelected:bv=>selected&&bv==='BV1234567890',observe:async(args,opts)=>{calls++;scope=opts;assert.deepEqual(args,{bvid:'BV1234567890',perception_source:'adaptive',view_depth:'deep'});return {ok:true,bvid:args.bvid}}})
  const request=(body,token=host.env.DSH_NATIVE_ROUND_TOKEN)=>fetch('http://127.0.0.1:'+host.env.DSH_NATIVE_ROUND_PORT+'/observe',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(body)})
  const body={bvid:'BV1234567890',view_depth:'deep'}
  try{
    assert.equal((await request(body,'wrong')).status,403)
    assert.equal((await request({...body,extra:true})).status,403)
    selected=false;assert.equal((await request(body)).status,403);selected=true
    assert.equal((await request(body)).status,200);assert.equal(calls,1);assert.equal(scope.isCurrent(),true)
    current=false;assert.equal((await request(body)).status,403);assert.equal(scope.isCurrent(),false)
  }finally{await host.close()}
  assert.equal(scope.signal.aborted,true)
})

test('complete fixed-hash partial survives restart, invalid or cancelled data cannot replace an existing model',async()=>{
  const {createHash}=await import('node:crypto')
  const home=await mkdtemp(join(tmpdir(),'dsh-completed-part-')),target=join(home,'asset'),part=target+'.part'
  const bytes=Buffer.from('verified fixture'),sha256=createHash('sha256').update(bytes).digest('hex')
  const options={expectedBytes:bytes.length,sha256}
  try{
    await writeFile(target,'old');await writeFile(part,Buffer.alloc(bytes.length))
    assert.equal(await __test.recoverCompletedPart(part,target,options),null)
    assert.equal(await readFile(target,'utf8'),'old')
    await writeFile(part,bytes)
    const abort=new AbortController();abort.abort()
    await assert.rejects(__test.recoverCompletedPart(part,target,{...options,signal:abort.signal}))
    assert.deepEqual(await readFile(part),bytes)
    let checks=0
    await assert.rejects(__test.recoverCompletedPart(part,target,{...options,assertModelStorage:()=>{if(++checks===2)throw Error('target lost')}}),/target lost/)
    assert.equal(await readFile(target,'utf8'),'old')
    assert.deepEqual(await __test.recoverCompletedPart(part,target,options),{bytes:bytes.length,sha256})
    assert.deepEqual(await readFile(target),bytes)
    await assert.rejects(readFile(part),/ENOENT/)
  }finally{await rm(home,{recursive:true,force:true})}
})

test('native round close cancels the admitted observation and waits for its worker cleanup',async()=>{
  const {startNativeVisionRoundHost}=await import('../lib/scoped-native-vision-read.mjs')
  let entered,allowExit,exited=false,closed=false
  const started=new Promise(r=>entered=r),cleanup=new Promise(r=>allowExit=r)
  const host=await startNativeVisionRoundHost({isCurrent:()=>true,isSelected:()=>true,observe:async(_args,{signal,isCurrent})=>{
    entered();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));assert.equal(isCurrent(),false)
    await cleanup;exited=true;return {ok:false}
  }})
  const request=fetch('http://127.0.0.1:'+host.env.DSH_NATIVE_ROUND_PORT+'/observe',{method:'POST',headers:{authorization:'Bearer '+host.env.DSH_NATIVE_ROUND_TOKEN},body:JSON.stringify({bvid:'BV1234567890',view_depth:'deep'})}).catch(()=>null)
  await started
  const closing=host.close().then(()=>{closed=true})
  try{await request;assert.equal(closed,false);assert.equal(exited,false)}finally{allowExit();await closing}
  assert.equal(closed,true);assert.equal(exited,true)
})

test('网络 AbortError 不是用户取消：固定源继续尝试，已下载残片可明确删除而不触及其他资源',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-vision-abort-fallback-'))
 try{
  const {LLAMA_VISION_MODELS}=await import('../lib/llama-vision-experiment.mjs'),model=LLAMA_VISION_MODELS[0],packageRoot=join(root,'package'),bundle=join(packageRoot,'vendor','embedding-runtime','linux-x64');await mkdir(bundle,{recursive:true});await writeFile(join(bundle,'llama-server'),'fixture');await writeFile(join(bundle,'dsh-runtime-manifest.json'),JSON.stringify({schema:1,version:__test.RUNTIME.version,platform:'linux-x64',sha256:__test.RUNTIME.assets['linux-x64'].sha256,binary:'llama-server'}))
  const calls=[];let networkFailure=false;const manager=createEmbeddingRuntimeManager({dataDir:join(root,'state'),packageRoot,platform:'linux',arch:'x64',logger:{warn(){}},fetchImpl:async(url)=>{calls.push(url);if(networkFailure||calls.length===1)throw new DOMException('transport aborted','AbortError');return new Response('partial')}})
  await assert.rejects(manager.runVision('install',model.id),/文件大小不匹配/);assert.equal(calls.length,2);assert.match(calls[0],/hf-mirror/);assert.match(calls[1],/huggingface.co/)
  let state=await manager.visionStatus();assert.equal(state.progress.phase,'error');assert.equal(state.models[0].hasResources,true);assert.equal(state.models[0].filesPresent,false)
  const dir=join(manager.paths.visionRoot,model.id);await writeFile(join(dir,'unrelated.txt'),'keep');await manager.removeVisionAssets(model.id);assert.equal(await readFile(join(dir,'unrelated.txt'),'utf8'),'keep');assert.equal(await readFile(join(bundle,'llama-server'),'utf8'),'fixture');state=await manager.visionStatus();assert.equal(state.models[0].hasResources,false)
  networkFailure=true;const before=calls.length;await assert.rejects(manager.runVision('install',model.id),/transport aborted/);assert.equal(calls.length-before,4);assert.equal((await manager.visionStatus()).progress.phase,'error')
 }finally{await rm(root,{recursive:true,force:true})}
})

async function preparationFixture(root,fetchImpl,scope='same'){
 const packageRoot=join(root,'package'),dataDir=join(root,'state'),bundle=join(packageRoot,'vendor','embedding-runtime','linux-x64')
 await mkdir(bundle,{recursive:true});await mkdir(dataDir,{recursive:true});await writeFile(join(bundle,'llama-server'),'fixture')
 await writeFile(join(bundle,'dsh-runtime-manifest.json'),JSON.stringify({schema:1,version:__test.RUNTIME.version,platform:'linux-x64',sha256:__test.RUNTIME.assets['linux-x64'].sha256,binary:'llama-server'}))
 return createEmbeddingRuntimeManager({dataDir,packageRoot,platform:'linux',arch:'x64',resumeScope:scope,logger:{warn(){}},fetchImpl})
}
function blockingPreparation(){
 const calls=[];let wake
 const fetchImpl=(url,{signal,headers})=>new Promise((resolve,reject)=>{
  calls.push({url,headers});wake?.();if(signal.aborted)return reject(signal.reason)
  signal.addEventListener('abort',()=>reject(signal.reason),{once:true})
 })
 return {calls,fetchImpl,async until(n){while(calls.length<n)await new Promise(resolve=>{wake=resolve})}}
}
test('两种已明确启动的模型准备停机后可独立恢复；恢复不等于启用或图片验收',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-preparation-restart-'))
 try{
  const first=blockingPreparation(),a=await preparationFixture(root,first.fetchImpl)
  assert.equal(a.resumeInstall(),null);assert.equal(a.resumeVisionInstall(),null);assert.equal(first.calls.length,0)
  const e=a.install(),v=a.runVision('install','qwen3.5-2b');const settled=Promise.allSettled([e,v]);await first.until(2);await a.shutdown();await settled
  assert.equal(JSON.parse(await readFile(join(root,'state','model-preparation-vision.json'),'utf8')).pid,null)
  const second=blockingPreparation(),b=await preparationFixture(root,second.fetchImpl)
  const resumed=[b.resumeInstall(),b.resumeVisionInstall()];assert.ok(resumed.every(Boolean));const done=Promise.allSettled(resumed);await second.until(2)
  assert.ok(second.calls.some(c=>c.url.includes('Embedding')));assert.ok(second.calls.some(c=>c.url.includes('Qwen3.5-2B')))
  assert.equal((await b.visionStatus()).models[0].result,null);assert.equal(b.status().server.ready,false)
  b.cancelInstall();b.cancelVision();await done;await b.shutdown()
  const c=await preparationFixture(root,()=>{throw Error('unexpected network')});assert.equal(c.resumeInstall(),null);assert.equal(c.resumeVisionInstall(),null)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('明确取消后紧接停机不会留下可恢复意图；普通失败不制造每次开机的重试循环',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-preparation-cancel-'))
 try{
  const first=blockingPreparation(),a=await preparationFixture(root,first.fetchImpl)
  const v=a.runVision('install','qwen3.5-4b'),done=Promise.allSettled([v]);await first.until(1);a.cancelVision();await a.shutdown();await done
  const b=await preparationFixture(root,async()=>new Response('failure',{status:403}));assert.equal(b.resumeVisionInstall(),null)
  await assert.rejects(b.runVision('install','qwen3.5-4b'),/HTTP 403/)
  const c=await preparationFixture(root,()=>{throw Error('unexpected network')});assert.equal(c.resumeVisionInstall(),null)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('重启意图绑定目录物理身份与分盘世代；活进程不被第二管理器抢占',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-preparation-scope-'))
 try{
  const first=blockingPreparation(),a=await preparationFixture(root,first.fetchImpl)
  const v=a.runVision('install','qwen3.5-2b'),done=Promise.allSettled([v]);await first.until(1)
  const peer=await preparationFixture(root,()=>{throw Error('unexpected network')});assert.equal(peer.resumeVisionInstall(),null);assert.throws(()=>peer.runVision('install','qwen3.5-2b'),/另一进程/)
  await a.shutdown();await done
  const changed=await preparationFixture(root,()=>{throw Error('unexpected network')},'changed-storage');assert.equal(changed.resumeVisionInstall(),null)
  const {rename,cp}=await import('node:fs/promises');await rename(join(root,'state'),join(root,'old-state'));await cp(join(root,'old-state'),join(root,'state'),{recursive:true})
  const restored=await preparationFixture(root,()=>{throw Error('unexpected network')});assert.equal(restored.resumeVisionInstall(),null)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('真正的退出进程遗留意图可由同一目录接续，不从任意残片或旧文件猜测任务',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-preparation-dead-owner-'))
 try{
  const {execFileSync}=await import('node:child_process'),{createModelPreparationIntent}=await import('../lib/model-preparation-intent.mjs')
  const source=new URL('../lib/model-preparation-intent.mjs',import.meta.url).href
  execFileSync(process.execPath,['--input-type=module','-e',`import {createModelPreparationIntent} from ${JSON.stringify(source)};createModelPreparationIntent({dataDir:${JSON.stringify(root)},scope:'same'}).claim('vision','qwen3.5-2b')`])
  const ledger=createModelPreparationIntent({dataDir:root,scope:'same'});assert.equal(ledger.pending('vision'),'qwen3.5-2b')
  const token=ledger.claim('vision','qwen3.5-2b',{resume:true});ledger.cancelActive('vision',token);ledger.finish('vision',token,true);assert.equal(ledger.pending('vision'),null)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('HTTP 206 续传拒绝错误偏移、总大小和短片段；保留合法残片供下一来源',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-preparation-range-'))
 try{
  const {LLAMA_VISION_MODELS}=await import('../lib/llama-vision-experiment.mjs'),model=LLAMA_VISION_MODELS[0],calls=[]
  let range=`bytes 1-2/${model.weights.bytes}`
  const a=await preparationFixture(root,async(url,opts)=>{calls.push(opts.headers.Range);return new Response('ab',{status:206,headers:{'content-range':range,'content-length':'2'}})})
  const folder=join(a.paths.visionRoot,model.id);await mkdir(folder,{recursive:true});const part=join(folder,model.weights.file+'.part');await writeFile(part,'abc')
  await assert.rejects(a.runVision('install',model.id),/响应范围不匹配/);assert.equal(await readFile(part,'utf8'),'abc');assert.deepEqual(calls,['bytes=3-','bytes=3-'])
  range=`bytes 3-4/${model.weights.bytes+1}`;await assert.rejects(a.runVision('install',model.id),/响应范围不匹配/);assert.equal(await readFile(part,'utf8'),'abc')
  range=`bytes 3-4/${model.weights.bytes}`;await assert.rejects(a.runVision('install',model.id),/响应范围不匹配/);assert.equal(await readFile(part,'utf8'),'abcab')
  assert.equal((await a.visionStatus()).models[0].filesPresent,false)
 }finally{await rm(root,{recursive:true,force:true})}
})
test('等待网络响应期间目标残片被替换成符号链接，拒绝写入及发布',async t=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-preparation-link-'))
 try{
  const {LLAMA_VISION_MODELS}=await import('../lib/llama-vision-experiment.mjs'),{symlink}=await import('node:fs/promises'),model=LLAMA_VISION_MODELS[0],outside=join(root,'outside');await writeFile(outside,'keep')
  const probe=join(root,'link-probe');try{await symlink(outside,probe,'file');await rm(probe)}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('当前系统不允许创建文件符号链接');return}throw e}
  let a,changed=false; a=await preparationFixture(root,async()=>{
   if(!changed){changed=true;await symlink(outside,join(a.paths.visionRoot,model.id,model.weights.file+'.part'),'file')}
   return new Response('malicious')
  })
  await assert.rejects(a.runVision('install',model.id),/非普通模型文件/);assert.equal(await readFile(outside,'utf8'),'keep')
 }finally{await rm(root,{recursive:true,force:true})}
})
