import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')

test('3b33 本地 Ollama 文案采用简短版本，代理示例按需展开',()=>{
  assert.match(html,/本地视觉模型负责画面观察。下面提供一键安装，需本机有 Ollama 环境。也可直接在 DSH 中配置 Ollama Provider 调用本地模型。/)
  assert.match(html,/简化下载和代理：/)
  assert.match(html,/<details class="visual-advanced"><summary>Windows 使用本地网络代理启动 Ollama 示例<\/summary>/)
  assert.match(html,/\$env:HTTPS_PROXY = "http:\/\/127\.0\.0\.1:7890"/)
  assert.match(html,/ollama serve # 启动 Ollama 服务/)
  assert.doesNotMatch(html,/下载时展示的是 Ollama 当前文件层的进度/)
  assert.doesNotMatch(html,/无需在 DSH 中另外配置 Ollama Provider 或 API Key/)
})

test('3b33 图片验收默认只展示用户三步，真实 MCP 细节藏在可展开诊断内',()=>{
  const panel=html.slice(html.indexOf('id="vision-unified-probe-panel"'),html.indexOf('id="local-vision-controls"'))
  for(const id of ['vision-journey','vision-journey-next','vision-probe-image','vision-probe-answer','vision-probe-verify','vision-probe-approve','vision-probe-reject','vision-technical-diagnostics','vision-route-capabilities','vision-probe-stages','vision-probe-last-run','vision-probe-error']){
    assert.match(panel,new RegExp('id="'+id+'"'))
  }
  for(const step of ['choose','test','review'])assert.match(panel,new RegExp('data-step="'+step+'"'))
  assert.match(panel,/<details class="visual-advanced vision-technical-diagnostics" id="vision-technical-diagnostics">/)
  assert.ok(panel.indexOf('id="vision-technical-diagnostics"')<panel.indexOf('id="vision-probe-stages"'))
  assert.match(panel,/模型实际回答/)
  assert.match(panel,/识别正确，认可/)
  assert.match(panel,/测试使用固定图片，不会发布到 B站/)
})

test('3b33 管理页高风险维护操作/高级路径折叠，原按钮 ID 和安全回执保留',()=>{
  for(const id of ['local-vision-install','local-vision-select','local-vision-delete','local-vision-refresh','models-ffmpeg-path-save','models-whisper-path-save','models-vision-debug','headless-sync-links']){
    assert.match(html,new RegExp('id="'+id+'"'))
  }
  assert.match(html,/<details class="visual-advanced local-vision-maintenance">/)
  assert.match(html,/FFmpeg 自定义路径（高级）/)
  assert.match(html,/Whisper 使用已有模型目录（高级）/)
  assert.match(html,/查看模型大小与硬件建议/)
  assert.match(html,/按任务选择模型的建议（可选）/)
  assert.match(js,/confirmAction\(\{title:'删除 Ollama 全局模型？'/)
  assert.match(js,/reviewId:record\.reviewId,accepted/)
  assert.match(js,/visionRouteHasUnsavedChanges\(\)/)
})

test('3b33 视觉用户进度：MCP 预检不得代替回答和人工认可',()=>{
  const start=js.indexOf('  const updateVisionJourney=')
  const end=js.indexOf('  const setVisionStage=',start)
  assert.ok(start>=0&&end>start)
  const code=js.slice(start,end).replace('const updateVisionJourney=','var updateVisionJourney=')
  const elements=new Map()
  const steps=['choose','test','review'].map(key=>({dataset:{state:'pending'}}))
  const root={dataset:{},querySelector(selector){const key=selector.match(/data-step="([^"]+)"/)?.[1];return steps[['choose','test','review'].indexOf(key)]||null}}
  elements.set('vision-journey',root)
  elements.set('vision-journey-next',{textContent:''})
  const context={$:id=>elements.get(id)}
  vm.runInNewContext(code,context)
  context.updateVisionJourney({ready:true})
  assert.deepEqual(steps.map(x=>x.dataset.state),['done','current','blocked'])
  context.updateVisionJourney({ready:true,failed:true})
  assert.equal(root.dataset.state,'failed')
  assert.match(elements.get('vision-journey-next').textContent,/未成功/)
  assert.equal(steps[2].dataset.state,'blocked')
  context.updateVisionJourney({ready:true,reviewable:true})
  assert.deepEqual(steps.map(x=>x.dataset.state),['done','done','current'])
  context.updateVisionJourney({ready:true,approved:true})
  assert.deepEqual(steps.map(x=>x.dataset.state),['done','done','done'])
  context.updateVisionJourney({local:true,ready:false})
  assert.deepEqual(steps.map(x=>x.dataset.state),['current','blocked','blocked'])
  assert.match(elements.get('vision-journey-next').textContent,/Ollama/)
})
