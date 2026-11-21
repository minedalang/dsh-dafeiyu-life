import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,symlinkSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {listWhisperModels,deleteWhisperModel} from '../lib/whisper-model-cache.mjs'
const sandbox=()=>{
 const root=mkdtempSync(join(tmpdir(),'whisper-owned-cache-'))
 const hub=join(root,'.hf-cache','hub');mkdirSync(hub,{recursive:true})
 const make=(model)=>{const repo=join(hub,'models--Systran--faster-whisper-'+model)
  const snap=join(repo,'snapshots','abc');mkdirSync(snap,{recursive:true})
  writeFileSync(join(snap,'model.bin'),'weight');writeFileSync(join(snap,'config.json'),'{}');return repo}
 return {root,hub,make}
}
test('models are discovered only within fixed plugin cache and active model is protected',()=>{
 const {root,make}=sandbox()
 try{
  const tiny=make('tiny'),small=make('small')
  const found=listWhisperModels({stateDir:root,selectedModel:'tiny'})
  assert.equal(found.models.length,2)
  assert.equal(found.models.find(x=>x.model==='tiny').ready,true)
  assert.equal(deleteWhisperModel({stateDir:root,selectedModel:'tiny',model:'tiny',confirm:'DELETE_WHISPER_tiny'}).ok,false)
  assert.equal(deleteWhisperModel({stateDir:root,selectedModel:'tiny',model:'small',confirm:'DELETE_WHISPER_small',installing:true}).ok,false)
  assert.equal(deleteWhisperModel({stateDir:root,selectedModel:'tiny',model:'small',confirm:'DELETE_WHISPER_small'}).ok,true)
  assert.equal(existsSync(small),false);assert.equal(existsSync(tiny),true)
 }finally{rmSync(root,{recursive:true,force:true})}
})
test('path traversal, malformed name and symlinked cache folders cannot be deleted',()=>{
 const {root,hub,make}=sandbox()
 const elsewhere=mkdtempSync(join(tmpdir(),'whisper-outside-'))
 try{
   make('tiny')
   assert.equal(deleteWhisperModel({stateDir:root,model:'../tiny',selectedModel:'small',confirm:'DELETE_WHISPER_../tiny'}).ok,false)
   assert.equal(deleteWhisperModel({stateDir:root,model:'tiny',selectedModel:'small',confirm:'NO'}).ok,false)
   // Windows directory junctions are usable without file-symlink privilege,
   // and must be refused just like a Unix symlinked model repository.
   const sentinel=join(elsewhere,'DO-NOT-DELETE');writeFileSync(sentinel,'keep')
   symlinkSync(elsewhere,join(hub,'models--Systran--faster-whisper-base'),process.platform==='win32'?'junction':'dir')
   assert.equal(deleteWhisperModel({stateDir:root,model:'base',selectedModel:'small',confirm:'DELETE_WHISPER_base'}).ok,false)
   assert.equal(readFileSync(sentinel,'utf8'),'keep','must not delete the external model directory')
 }finally{rmSync(root,{recursive:true,force:true});rmSync(elsewhere,{recursive:true,force:true})}
})
test('production API is protected by local origin and only calls the owned cache manager',()=>{
 const index=readFileSync(resolve('index.js'),'utf8'),ui=readFileSync(resolve('lib/management-console.js'),'utf8')
 assert.match(index,/仅允许从本机 DSH 管理中心删除插件自有 Whisper 模型/)
 assert.match(index,/deleteWhisperModel\(\{stateDir,model:body\?\.model/)
 assert.match(index,/activeTranscription/)
 assert.match(index,/lastRun/)
 assert.match(ui,/\/video-dependencies\/whisper\/status/)
 assert.match(ui,/startWhisperPoll\(\)/)
 assert.match(ui,/DELETE_WHISPER_/)
})


test('npm consumer distribution includes the model downloader script used by the production installer',()=>{
 const pkg=JSON.parse(readFileSync(resolve('package.json'),'utf8'))
 assert.ok(pkg.files.includes('scripts/download_whisper_model.py'),
   'npm files allowlist must ship the actual Python downloader, not only source checkout')
 assert.ok(existsSync(resolve('scripts/download_whisper_model.py')))
 const installer=readFileSync(resolve('index.js'),'utf8')
 assert.match(installer,/const modelDownloadScript=join\(pluginDir,'scripts','download_whisper_model\.py'\)/)
 assert.match(installer,/plugin-package-missing-model-downloader/)
})
