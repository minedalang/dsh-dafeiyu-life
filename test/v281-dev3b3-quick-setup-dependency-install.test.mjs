import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const html=read('lib/management-console.html'),ui=read('lib/management-console.js'),client=read('client.js'),server=read('index.js')

test('quick setup owns main installer, both quick setup and AI models reuse optional installers',()=>{
  for(const id of ['fs-deps-card','fs-main-deps-install','fs-main-deps-refresh','fs-install-ffmpeg','fs-install-whisper','fs-addons-install'])
    assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id)
  assert.match(html,/id="models-ffmpeg-install"/)
  assert.match(html,/id="models-whisper-install"/)
  assert.match(html,/id="models-ffmpeg-install"/)
  assert.match(html,/id="models-whisper-install"/)
  assert.doesNotMatch(client,/onClick:onInstall\b|const onInstall\b|const onInstallAsr\b/)
  assert.match(client,/安装／修复主依赖/)
  assert.match(ui,/request\('\/install',\{\}\)/)
  assert.match(ui,/request\('\/video-dependencies\/ffmpeg\/install',\{\}\)/)
  assert.match(ui,/request\('\/install-asr',\{\}\)/)
})

test('Whisper enabled control has recommended label, unchanged config and explicit consent',()=>{
  assert.match(html,/视频语音识别模型（推荐开启）/)
  assert.match(html,/id="models-transcribe"[^>]+>启用视频语音识别/)
  assert.match(ui,/transcribe:\$\('models-transcribe'\)\.checked/)
  assert.match(ui,/addFfmpeg=\$\('fs-install-ffmpeg'\)\.checked,addWhisper=\$\('fs-install-whisper'\)\.checked/)
  assert.match(ui,/!addFfmpeg&&!addWhisper/)
  assert.match(ui,/confirmAction\(\{title:'安装勾选的视频增强组件？'/)
  assert.match(html,/Whisper tiny \/ base \/ small/)
  assert.doesNotMatch(html,/<input id="fs-install-whisper"[^>]*checked/)
  assert.match(ui,/\.textContent='FFmpeg：'/)
  assert.match(ui,/modelCached/)
  assert.match(html,/data-open-tab="models" data-open-anchor="video-aux-dependencies"/)
})

test('installation before onboarding is allowed but optional installers keep loopback origin gate',()=>{
  assert.match(server,/setupAccess =[\s\S]*?path==='\/api\/bili-duty\/install-asr'/)
  assert.match(server,/setupAccess =[\s\S]*?path==='\/api\/bili-duty\/video-dependencies\/ffmpeg\/install'/)
  const asr=server.slice(server.indexOf("path === '/api/bili-duty/install-asr'"),server.indexOf('// 收藏夹列表',server.indexOf("path === '/api/bili-duty/install-asr'")))
  assert.match(asr,/req\.headers\.origin/)
  assert.match(asr,/req\.socket\?\.remoteAddress/)
  assert.match(asr,/sec-fetch-site/)
  assert.match(asr,/127\.0\.0\.1/)
  assert.match(asr,/runAsrInstall\(\)/)
})

test('AI models owns direct FFmpeg and Whisper installation plus status and FFmpeg decode test',()=>{
  assert.match(ui,/const loadVideoAux=async/)
  assert.match(ui,/models-ffmpeg-test/)
  assert.match(html,/id="models-whisper-last"/)
  assert.match(ui,/\$\('models-whisper-install'\)/)
  assert.match(ui,/\$\('models-ffmpeg-install'\)/)
  assert.match(ui,/installTail/)
})

test('unverified onboarding can read dependency status, while remote-origin Whisper installation is rejected',async()=>{
  const {Readable}=await import('node:stream')
  const {apply}=await import('../index.js')
  const home=mkdtempSync(join(tmpdir(),'fish-install-setup-'))
  let handler
  try{
    const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
      logger:{info(){},warn(){}},tools:{register(){}},connection:{requestRejection(){},admit(){return {peer:{principal:{kind:'owner'}}}}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
    apply(ctx,{})
    const send=async(method,path,origin='http://127.0.0.1:8761')=>{
      const req=Readable.from(method==='POST'?[Buffer.from('{}')]:[])
      req.method=method;req.url='/api/bili-duty/'+path
      req.headers={host:'127.0.0.1:8761',origin,'sec-fetch-site':'same-origin'}
      // The server validates req.socket.remoteAddress for actual installation.
      req.socket={remoteAddress:'::1'}
      let code=0,data=''
      await handler(req,{writeHead(status){code=status},end(content){data=String(content||'')}})
      return {code,data}
    }
    assert.equal((await send('GET','video-dependencies/status')).code,200)
    const refused=await send('POST','install-asr','https://other.example')
    assert.equal(refused.code,403)
    assert.match(refused.data,/只接受本机同源请求|仅允许从本机/)
    const ffmpegRefused=await send('POST','video-dependencies/ffmpeg/install','https://other.example')
    assert.equal(ffmpegRefused.code,403)
    assert.equal((await send('GET','life-memory/status')).code,423)
  }finally{rmSync(home,{recursive:true,force:true})}
})


test('必要配置逐步展示，推荐增强默认可见，高级配置折叠',()=>{
  const panel=html.slice(html.indexOf('<section id="panel-firststart"'),html.indexOf('<section id="panel-models"'))
  for(const id of ['fs-guide-runtime','fs-guide-account','fs-guide-model','fs-guide-next'])assert.match(panel,new RegExp('id="'+id+'"'))
  assert.ok(panel.indexOf('id="fs-deps-card"')<panel.indexOf('id="fs-enhancements"'))
  assert.ok(panel.indexOf('id="fs-bili-verify"')<panel.indexOf('id="fs-enhancements"'))
  assert.ok(panel.indexOf('id="fs-headless-state"')<panel.indexOf('id="fs-enhancements"'))
  assert.match(panel,/<details id="fs-enhancements" class="setup-disclosure" open>/)
  assert.match(panel,/<details id="fs-advanced-settings" class="setup-disclosure">/)
  assert.match(ui,/setupMainReady=mainReady;setupMainInstalling=main.installing===true;renderSetupGuide\(onboarding\)/)
  assert.match(ui,/state.requiredReady!==true\|\|setupMainReady!==true/);assert.match(ui,/await request\('\/onboarding\/complete'/)
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)\{\.guided-track span\{transition:none\}/)
})
