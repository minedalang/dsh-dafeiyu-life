import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {probeFFmpeg,testFFmpegDecode,readWhisperReadiness,openFFmpegInstaller,ffmpegInstallCommand} from '../lib/video-dependencies.mjs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const mcp=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')

test('视觉模型区统一显示 FFmpeg/Whisper，评论梗图仅在评论页',()=>{
  for(const id of ['models-transcribe','models-asr-model','models-comment-memes','models-comment-memes-debug','models-whisper-last','models-ffmpeg-test'])
    assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id)
  for(const id of ['bili-transcribe','bili-asr-model','bili-comment-memes','bili-comment-memes-debug'])
    assert.doesNotMatch(html,new RegExp('id="'+id+'"'))
  assert.match(html,/data-open-tab="models" data-open-anchor="video-aux-dependencies"/)
  const vision=html.slice(html.indexOf('id="models-vision-settings"'),html.indexOf('id="panel-comments"'))
  assert.match(vision,/id="video-aux-dependencies"/)
  assert.match(vision,/id="models-ffmpeg-install"/)
  assert.match(vision,/id="models-whisper-install"/)
  assert.doesNotMatch(vision,/id="models-comment-memes"/)
  const comments=html.slice(html.indexOf('<section id="panel-comments"'),html.indexOf('<section id="panel-meme"'))
  assert.match(comments,/id="models-comment-memes"/)
  assert.match(comments,/id="models-memes-save"/)
  assert.match(ui,/const loadVideoAux=async/)
  assert.match(ui,/models-aux-save/)
  assert.doesNotMatch(ui,/\['bili-transcribe','transcribe'\]/)
  assert.match(ui,/payload=\{transcribe:\$\('models-transcribe'\)/)
})
test('Whisper 模型选择必须实际传入 Python 转写，并有不包含正文的实际回执',()=>{
  assert.match(server,/BILI_ASR_MODEL:.*yq\(cfg.asrModel/)
  assert.match(server,/mcpKeyNow.*\$\{cfg\.asrModel\}/)
  assert.match(mcp,/\[str\(python\), str\(asr\), bv, '--json', '--model', model\]/)
  assert.match(mcp,/asr-last-run\.json/)
  assert.doesNotMatch(mcp,/payload\['text'\].*asr-last-run/)
  assert.match(server,/readWhisperReadiness\(\{stateDir,model:cfg.asrModel/)
})
test('FFmpeg availability is real version output; decode test is an actual ffmpeg invocation',()=>{
  assert.equal(probeFFmpeg({run:()=>({status:0,stdout:'malicious garbage'})}).available,false)
  assert.equal(probeFFmpeg({run:()=>({status:0,stdout:'ffmpeg version 7.0\n'})}).available,true)
  assert.equal(probeFFmpeg({run:()=>({status:1})}).available,false)
  const args=[]
  const run=(cmd,argv)=>{args.push([cmd,argv]);return {status:0,stdout:'ffmpeg version 7.0'}}
  assert.equal(testFFmpegDecode({run}).ok,true)
  assert.deepEqual(args.map(x=>x[0]),['ffmpeg','ffmpeg'])
  assert.ok(args[1][1].includes('lavfi'))
})
test('Whisper selected-model cache requires actual files; a hub dir alone is insufficient',()=>{
  const dir=mkdtempSync(join(tmpdir(),'video-dependencies-'))
  try{
    mkdirSync(join(dir,'.hf-cache','hub'),{recursive:true})
    assert.equal(readWhisperReadiness({stateDir:dir,model:'small',pythonAvailable:true,packageAvailable:true}).modelCached,false)
    const model=join(dir,'.hf-cache','hub','models--Systran--faster-whisper-small','snapshots','hash1')
    mkdirSync(model,{recursive:true})
    writeFileSync(join(model,'model.bin'),'model');writeFileSync(join(model,'config.json'),'{}')
    assert.equal(readWhisperReadiness({stateDir:dir,model:'small'}).modelCached,true)
    assert.equal(readWhisperReadiness({stateDir:dir,model:'medium'}).modelCached,false)
    writeFileSync(join(dir,'asr-last-run.json'),JSON.stringify({version:1,at:'2026-11-14T12:00:00Z',outcome:'success',model:'small',segments:21,text:'PRIVATE',bvid:'BV1234567890'}))
    const record=readWhisperReadiness({stateDir:dir,model:'small'}).lastRun
    assert.deepEqual(Object.keys(record).sort(),['at','model','outcome','reason','segments'])
    assert.equal(record.segments,21)
    assert.doesNotMatch(JSON.stringify(record),/PRIVATE|BV123/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
test('FFmpeg Windows winget is fixed, and macOS/Linux package commands never accept user input',async()=>{
  assert.match(ffmpegInstallCommand({platform:'darwin',run:()=>({status:0}),exists:x=>x==='/opt/homebrew/bin/brew'}).binary,/brew/)
  assert.deepEqual(ffmpegInstallCommand({platform:'linux',run:cmd=>({status:['pkexec','apt-get'].includes(cmd)?0:1})}).args,['apt-get','install','-y','ffmpeg'])
  assert.equal(ffmpegInstallCommand({platform:'darwin',run:()=>({status:1})}).error.includes('Homebrew'),true)
  assert.equal((await openFFmpegInstaller({platform:'win32',run:()=>({status:1})})).ok,false)
  let launch=[]
  const res=await openFFmpegInstaller({platform:'win32',run:()=>({status:0}),spawn:(exe,args,options)=>{
    launch=[exe,args,options]
    const handlers={}
    const child={stderr:{on(){}},once(k,fn){handlers[k]=fn; if(k==='close')queueMicrotask(()=>fn(0))}}
    return child
  }})
  assert.equal(res.ok,true);assert.equal(res.opened,true)
  assert.equal(launch[0],'powershell.exe')
  assert.equal(launch[2].shell,false)
  assert.match(launch[1].join(' '),/Start-Process.*powershell\.exe/)
  const b64=/EncodedCommand','([^']+)'/.exec(launch[1].join(' '))?.[1]
  assert.ok(b64)
  const script=Buffer.from(b64,'base64').toString('utf16le')
  assert.match(script,/winget install --id Gyan\.FFmpeg\.Essentials --exact --source winget/)
  assert.doesNotMatch(script,/Invoke-WebRequest|\$env:|Set-ExecutionPolicy|--silent/i)
})
