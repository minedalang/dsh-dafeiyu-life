import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {EventEmitter} from 'node:events'
import {createLocalVisionModelManager} from '../lib/local-vision-model-manager.mjs'
import {ensureOllamaService,ollamaExecutable} from '../lib/ollama-service.mjs'
import {ffmpegInstallCommand} from '../lib/video-dependencies.mjs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const sha=d=>'sha256:'+d.repeat(64)
const json=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}})

test('dev.3b.4 version is the real package metadata source; AGENTS enforces dev release version',()=>{
 const p=JSON.parse(read('package.json')), lock=JSON.parse(read('package-lock.json'))
 assert.equal(p.version,'2.8.1-dev.3b.5')
 assert.equal(lock.version,p.version)
 assert.equal(lock.packages[''].version,p.version)
 assert.match(read('AGENTS.md'),/每次开发增量均同步更新真实版本号/)
 assert.match(read('index.js'),/version: myVersion\(\)/)
})

test('UI: single unified visual panel with FFmpeg and Whisper; comment memes belong to comment page',()=>{
 const html=read('lib/management-console.html'),js=read('lib/management-console.js')
 const vision=html.slice(html.indexOf('<details class="settings-section model-task"><summary><strong>视觉识别模型'),html.indexOf('<details class="settings-section model-task"><summary><strong>人生反思'))
 assert.match(vision,/id="video-aux-dependencies"/)
 assert.match(vision,/id="vision-unified-probe-panel"/)
 assert.match(vision,/id="models-ffmpeg-install"/)
 assert.match(vision,/id="models-whisper-install"/)
 assert.doesNotMatch(vision,/id="models-comment-memes"/)
 const comments=html.slice(html.indexOf('<section id="panel-comments"'),html.indexOf('<section id="panel-meme"'))
 assert.match(comments,/id="models-comment-memes"/)
 assert.match(js,/models-memes-save/)
 assert.doesNotMatch(js,/local-vision\/start-ollama/)
 assert.doesNotMatch(html,/id="local-vision-start-ollama"/)
 assert.match(html,/id="local-vision-ensure"/)
 assert.match(js,/model\?\.installed\?'已下载，无需重装'/)
 assert.match(js,/await restoreOllama\(\)/)
})

test('artificially interrupted Ollama service does not erase approval; restart restores same digest, never changed digest',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fish-vision-approval-'))
 let online=true,digest=sha('a')
 const fetchImpl=async url=>{
   if(!online)throw Error('ECONNREFUSED')
   if(url.endsWith('/api/tags'))return json({models:[{name:'qwen3.5:4b',digest}]})
   if(url.endsWith('/api/chat'))return json({message:{content:'蓝色头发，白色裙子。'}})
   throw Error('unexpected request')
 }
 try{
   const first=createLocalVisionModelManager({fetchImpl,stateDir:dir})
   const result=await first.verifyId('qwen3.5-4b')
   await first.review('qwen3.5-4b',{reviewId:result.reviewId,accepted:true})
   assert.equal((await first.list()).models[0].verified,true)
   const receipt=readFileSync(join(dir,'local-vision-approvals.json'),'utf8')
   assert.doesNotMatch(receipt,/蓝色头发|白色裙子|base64|api.key/i)
   assert.match(receipt,/sha256:/)
   online=false
   assert.equal((await first.list()).running,false)
   online=true
   const restarted=createLocalVisionModelManager({fetchImpl,stateDir:dir})
   assert.equal((await restarted.list()).models[0].verified,true)
   assert.equal((await restarted.list()).models[0].verification.status,'approved')
   digest=sha('b')
   const altered=(await restarted.list()).models[0]
   assert.equal(altered.verified,false)
   const third=createLocalVisionModelManager({fetchImpl,stateDir:dir})
   assert.equal((await third.list()).models[0].verified,false)
   online=false;assert.equal((await third.list()).running,false)
   online=true;digest=sha('a');await third.list() // prior approval was already revoked when digest changed
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('native Ollama startup is owner-triggered and never invokes shell/PowerShell or downloads',async()=>{
 let active=false,launches=0
 const probe=async()=>({running:active})
 const noLaunch=await ensureOllamaService({probe:async()=>({running:true}),spawn:()=>{throw Error('should not run')}})
 assert.equal(noLaunch.alreadyRunning,true)
 const started=await ensureOllamaService({probe,waitFor:async()=>{active=true},executable:'ollama',spawn:(bin,args,options)=>{
   launches++;assert.equal(bin,'ollama');assert.deepEqual(args,['serve']);assert.equal(options.shell,false)
   assert.equal(options.detached,true)
   const ch=new EventEmitter();ch.unref=()=>{}
   queueMicrotask(()=>ch.emit('spawn'))
   return ch
 }})
 assert.equal(started.ok,true)
 assert.equal(launches,1)
 assert.notEqual(ollamaExecutable({platform:'darwin',exists:x=>x==='/Applications/Ollama.app/Contents/Resources/ollama'}),'powershell.exe')
})

test('cross-platform FFmpeg installer commands fixed, Linux without polkit explains manual setup',()=>{
 const mac=ffmpegInstallCommand({platform:'darwin',run:()=>({status:0}),exists:x=>x==='/opt/homebrew/bin/brew'})
 assert.deepEqual(mac.args,['install','ffmpeg'])
 const linux=ffmpegInstallCommand({platform:'linux',run:cmd=>({status:['pkexec','dnf'].includes(cmd)?0:1})})
 assert.deepEqual(linux.args,['dnf','install','-y','ffmpeg'])
 const fallback=ffmpegInstallCommand({platform:'linux',run:()=>({status:1})})
 assert.match(fallback.error,/pkexec/)
 assert.match(read('index.js'),/video-dependencies\/ffmpeg\/install/)
 assert.match(read('lib/management-console.html'),/40 MB～1 GB/)
})
