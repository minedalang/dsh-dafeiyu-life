import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')

test('3b33 本地 Ollama 文案采用简短版本，代理示例按需展开',()=>{
  assert.match(html,/本地视觉模型负责画面观察。<strong>推荐新用户优先试 Qwen3\.5 2B<\/strong>/)
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

test('2.8.2 收口：不复活主人私信独立模型卡片，历史配置只兼容不批量重写',()=>{
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.doesNotMatch(html,/id="models-ownerDmAgent"/)
  assert.doesNotMatch(js,/\['ownerDmAgent','ownerDmAgentModelProvider'/)
  assert.doesNotMatch(js,/const modelTaskIds=\[[^\]]*'ownerDmAgent'/)
  assert.match(html,/下面全部八项当前任务/)
  assert.match(html,/行为决策模型（Life 的行动选择）/)
  assert.match(html,/社交互动模型（私信与评论）/)
  assert.match(host,/ownerDmAgentModelProvider: z\.string\(\)\.default\(''\)/)
  assert.match(host,/task==='ownerDmAgent'\) throw Error\('该独立模型路由已退役/)
  assert.match(js,/for\(const key of modelFields\)/) // no removed legacy field in modelFields
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


test('2.8.2 视觉设置：快速设置介绍新 2B，旧 1B 限历史兼容',()=>{
  const guide=html.slice(html.indexOf('id="local-vision-model"'),html.indexOf('id="local-vision-thinking"'))
  assert.match(guide,/Qwen3\.5 2B · 新版推荐/)
  assert.match(guide,/Qwen3\.5 4B/)
  assert.match(guide,/MiniCPM-V 4\.7 1B · 历史兼容（不推荐 \/ 不可下载）/)
  assert.match(js,/moveWizardControl\(\$\('models-vision-shell'\)\)/)
  assert.match(js,/wizardMounted==='vision'&&!wizardFfmpegReady/)
  assert.match(html,/id="fs-wizard-video"/)
})

test('2.8.2 视觉设置：下载/图片验收/启用都是普通操作，高风险删除才藏在高级区',()=>{
  const base=html.indexOf('id="local-vision-controls"')
  const start=html.indexOf('class="local-vision-activation-flow"',base)
  const advance=html.indexOf('<details class="visual-advanced local-vision-maintenance">',base)
  const download=html.indexOf('id="local-vision-install"',start)
  const review=html.indexOf('id="local-vision-review-open"',start)
  const enable=html.indexOf('id="local-vision-select"',start)
  const deletion=html.indexOf('id="local-vision-delete"',advance)
  assert.ok(base>=0&&start>base&&download>start&&review>download&&enable>review&&advance>enable&&deletion>advance)
  assert.match(html,/id="local-vision-effective" role="status" aria-live="polite"/)
  assert.match(html,/id="local-vision-selection-note" role="status" aria-live="polite"/)
  assert.match(html,/id="local-vision-model" aria-describedby="local-vision-selection-note"/)
  assert.match(js,/确认切换并开启视频观察/)
  assert.match(js,/\$\('local-vision-refresh'\)\.addEventListener\('click',\(\)=>run\(loadLocalVisionStatus\)\)/)
  assert.match(js,/await \(!wizard&&visionIsLocal\(\)&&c\.visionEnabled===true\?restoreOllama\(\):loadLocalVisionStatus\(\)\)\.catch/)
  assert.match(js,/设置尚未保存|summarizeSaveDrafts\(\)/)
  assert.match(js,/settingDraftTracker\.committed\(\$\('models-vision-mode'\)\)/)
})

test('2.8.2 视觉设置：待选型号与后台实际启用严格分开，并区分未安装、未认可及离线',()=>{
  const start=js.indexOf('  const describeLocalVisionChoice=')
  const end=js.indexOf('  const loadLocalVisionStatus=',start)
  assert.ok(start>0&&end>start)
  const code=js.slice(start,end).replace('const describeLocalVisionChoice=','var describeLocalVisionChoice=')
  const context={}
  vm.runInNewContext(code,context)
  const models=[
    {id:'qwen3.5-4b',name:'Qwen3.5 4B',installed:true,verified:true,downloadable:true},
    {id:'qwen3.5-2b',name:'Qwen3.5 2B',installed:true,verified:true,downloadable:true},
    {id:'minicpm-v4.7-1b',name:'MiniCPM 1B',installed:false,verified:false,downloadable:false}
  ]
  const state={running:true,active:'qwen3.5-4b',visionEnabled:true,models}
  const pending=context.describeLocalVisionChoice(state,'qwen3.5-2b')
  assert.match(pending.effective,/当前后台已启用：Qwen3\.5 4B/)
  assert.match(pending.selected,/待切换到 Qwen3\.5 2B/)
  assert.equal(pending.canActivate,true)
  assert.equal(pending.ready,false)
  const active=context.describeLocalVisionChoice(state,'qwen3.5-4b')
  assert.equal(active.ready,true)
  assert.equal(active.canActivate,false)
  assert.match(active.enableLabel,/已启用/)
  const old=context.describeLocalVisionChoice(state,'minicpm-v4.7-1b')
  assert.equal(old.canInstall,false)
  assert.equal(old.canActivate,false)
  assert.match(old.selected,/历史型号不再提供下载/)
  const needReview=context.describeLocalVisionChoice({...state,models:[models[0],{...models[1],verified:false}]},'qwen3.5-2b')
  assert.equal(needReview.canActivate,false)
  assert.match(needReview.selected,/尚未人工认可/)
  const disconnected=context.describeLocalVisionChoice({...state,running:false},'qwen3.5-2b')
  assert.equal(disconnected.canActivate,false)
  assert.match(disconnected.effective,/Ollama 未连接/)
  const disabled=context.describeLocalVisionChoice({...state,visionEnabled:false},'qwen3.5-4b')
  assert.equal(disabled.canActivate,true)
  assert.match(disabled.effective,/视频观察开关关闭/)
  const dsh=context.describeLocalVisionChoice({...state,active:''},'qwen3.5-2b')
  assert.match(dsh.effective,/DSH 识图路线/)
})

test('2.8.2 已保存字段确认只清除自身草稿，不掩盖其他未保存模型配置',()=>{
  const start=js.indexOf('  const createSettingDraftTracker=')
  const end=js.indexOf('  const API=',start)
  assert.ok(start>=0&&end>start)
  const code=js.slice(start,end).replace('const createSettingDraftTracker=','var createSettingDraftTracker=')
  const context={WeakMap,Map,Set,JSON,String}
  vm.runInNewContext(code,context)
  const draft=context.createSettingDraftTracker()
  const save={id:'models-save'}
  const route={value:'independent_dsh'}
  const model={value:'cloud-a'}
  draft.capture(route);draft.capture(model)
  route.value='independent_local';model.value='cloud-b'
  draft.change(route,save,'models');draft.change(model,save,'models')
  assert.equal(draft.drafts.size,1)
  draft.committed(route)
  assert.equal(draft.drafts.size,1)
  assert.ok(draft.drafts.get('models-save').fields.has(model))
  assert.ok(!draft.drafts.get('models-save').fields.has(route))
  draft.committed(model)
  assert.equal(draft.drafts.size,0)
})
