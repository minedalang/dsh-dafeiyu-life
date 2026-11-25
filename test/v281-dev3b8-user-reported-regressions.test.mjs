import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
import {validateFFmpegSelection, inspectWhisperModelDirectory,readWhisperReadiness,probeFFmpeg} from '../lib/video-dependencies.mjs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const html=read('lib/management-console.html'), js=read('lib/management-console.js'), backend=read('index.js')

test('卡片方案归属视频探索，视觉模型双向跳转、评论梗图回归最近评论，删除旧高级诊断',()=>{
  assert.match(html,/id="bili-vision-plan-save"/)
  assert.match(html,/data-open-tab="bili" data-open-anchor="bili-video-perception-plans"/)
  assert.match(html,/data-open-tab="models" data-open-anchor="models-vision-settings"/)
  const biliStart=html.indexOf('<section id="panel-bili"'),modelsStart=html.indexOf('<section id="panel-models"')
  const cardStart=html.indexOf('id="bili-vision-plan-save"')
  assert.ok(biliStart>=0&&modelsStart>=0&&cardStart>biliStart)
  const comments=html.slice(html.indexOf('<section id="panel-comments"'),html.indexOf('<section id="panel-meme"'))
  assert.match(comments,/id="models-comment-memes"/)
  const model=html.slice(modelsStart,html.indexOf('<section id="panel-bili"'))
  assert.doesNotMatch(model,/id="models-comment-memes"/)
  assert.doesNotMatch(html,/原创评论准入与视频轮次 · 高级诊断/)
})

test('每日独立视觉调用次数限制在 UI、Node、Python 已取消，但保留每视频帧数档',()=>{
  assert.doesNotMatch(html,/每天最多额外调用独立视觉模型|id="quota-vision-daily"/)
  assert.doesNotMatch(js,/visionDailyLimit/)
  assert.doesNotMatch(backend,/visionDailyLimit|BILI_VISION_DAILY_LIMIT/)
  assert.match(html,/data-vision-frame-plan="12"/)
  assert.match(html,/data-vision-frame-plan="24"/)
  assert.match(html,/data-vision-frame-plan="48"/)
  assert.match(js,/dataset\.readinessDisabled/)
})

test('FFmpeg 和 Whisper 已安装路径可校验；仅认绝对真实文件或转换模型目录',()=>{
  const home=mkdtempSync(join(tmpdir(),'fish-visual-paths-'))
  try{
    const model=join(home,'small')
    mkdirSync(model,{recursive:true})
    assert.equal(inspectWhisperModelDirectory(model).ok,false)
    writeFileSync(join(model,'config.json'),'{}');writeFileSync(join(model,'model.bin'),'dummy')
    assert.equal(inspectWhisperModelDirectory(model).ok,true)
    assert.equal(readWhisperReadiness({stateDir:home,modelPath:model,pythonAvailable:true,packageAvailable:true}).modelCached,true)
    assert.equal(inspectWhisperModelDirectory('../relative').ok,false)
    assert.equal(validateFFmpegSelection(join(home,'other')).ok,false)
    const ff=join(home,process.platform==='win32'?'ffmpeg.exe':'ffmpeg')
    writeFileSync(ff,'fake')
    assert.equal(validateFFmpegSelection(ff).ok,true)
    assert.equal(probeFFmpeg({binary:ff}).available,false,'仅文件存在不代表可运行 ffmpeg')
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('梗库 JSON 不再被截断到 25000 字符，超限明示而非发送坏 JSON',()=>{
  const start=backend.indexOf('const memeLearningScript=(mode,payload)=>')
  const end=backend.indexOf('memeLearning=createMemeLearning(',start)
  const part=backend.slice(start,end)
  assert.ok(part.length>600)
  assert.match(part,/Buffer\.concat\(chunks\)/)
  assert.match(part,/total>1024\*1024/)
  assert.doesNotMatch(part,/slice\(0,\s*25000\)/)
})

test('首次设置期间允许本机选择现有 Whisper 模型目录，禁止跨站或远程修改',async()=>{
  const home=mkdtempSync(join(tmpdir(),'fish-firststart-paths-'))
  let handler
  try{
    const ctx={get:k=>k==='dshHomePath'?(...parts)=>join(home,...parts):undefined,
      logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(o){handler=o.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
    apply(ctx,{})
    const model=join(home,'custom-whisper');mkdirSync(model)
    writeFileSync(join(model,'model.bin'),'test');writeFileSync(join(model,'config.json'),'{}')
    const call=async(origin,remote='::1',path=model)=>{
      const request=Readable.from([Buffer.from(JSON.stringify({kind:'whisper',path}))]);request.method='POST';request.url='/api/bili-duty/video-dependencies/paths'
      request.headers={host:'127.0.0.1:8968',origin,'sec-fetch-site':origin==='http://127.0.0.1:8968'?'same-origin':'cross-site'}
      request.socket={remoteAddress:remote}
      let code=0,raw=''
      await handler(request,{writeHead(status){code=status},end(data){raw=String(data||'')}})
      return {code,data:JSON.parse(raw)}
    }
    assert.equal((await call('https://evil.example')).code,403)
    assert.equal((await call('http://127.0.0.1:8968','192.168.0.5')).code,403)
    const ok=await call('http://127.0.0.1:8968')
    assert.equal(ok.code,200,JSON.stringify(ok))
    assert.equal(ok.data.selectedPath,model)
    assert.equal((await call('http://127.0.0.1:8968','::1','../nope')).code,400)
  }finally{rmSync(home,{recursive:true,force:true})}
})
