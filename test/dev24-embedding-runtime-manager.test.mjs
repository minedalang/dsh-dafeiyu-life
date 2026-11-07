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
