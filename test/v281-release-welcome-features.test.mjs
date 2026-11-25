import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')

test('DSH 原生大肥鱼设置在标题下展示简洁的 2.8.2 特性',()=>{
  const client=read('client.js')
  const start=client.indexOf('🐳 大肥鱼 · DSH 生活系统')
  assert.ok(start>0)
  const next=client.slice(start,start+2200)
  for(const phrase of ['先看视频全貌，再细看喜欢的片段','看过哪些画面，有时间和记录可查','鱼鱼自己决定看几段，也可以不看','没字幕也能尝试听懂；模型更好管理'])
    assert.ok(next.includes(phrase),`缺少 ${phrase}`)
  assert.match(client,/data-bd-281-intro/)
  assert.match(client,/2\.8\.2 版本亮点/)
  assert.match(client,/大肥鱼的核心能力/)
  assert.match(client,/首次使用：先按上方步骤完成浏览器授权/)
  assert.doesNotMatch(client,/aria-label':'2.8.2 特色功能'/)
  assert.match(read('README.md'),/先看全貌，再看细节/)
})

test('管理中心不再出现重复 2.8.2 宣传弹窗，快速设置入口和视觉引导保留',()=>{
  const html=read('lib/management-console.html'),ui=read('lib/management-console.js')
  assert.doesNotMatch(html,/release-281-dialog|release-281-feature|release-281-top|release-281-actions/)
  assert.doesNotMatch(ui,/release281|release-281|intro-dismissed|showRelease281IfNeeded/)
  assert.match(html,/id="fs-vision-guide"/)
  assert.match(html,/2\.8\.2 视频感知优化 · 可选/)
  assert.match(html,/2\.8\.2 优化了视频感知流程/)
  // The informational update notice cannot force an already-unlocked owner
  // back through first installation; real verification failures remain separate.
  assert.match(ui,/const needsSetup=\(state\.welcomeCompleted\?\?state\.completed\)!==true/)
  assert.match(ui,/const needsRepair=unlocked&&!ready/)
  assert.match(ui,/needsSetup\?switchTab\('firststart'\):switchTab/)
  assert.match(ui,/const state=await loadFirstStart\(\)/)
  assert.match(ui,/if\(!state\.welcomeSeen\)await request\('\/onboarding\/welcome'/)
})

test('删弹窗不影响设置授权、手机只读与首次配置确认',()=>{
  const ui=read('lib/management-console.js'),html=read('lib/management-console.html')
  assert.match(ui,/const mobileReadOnlySelector=/)
  assert.doesNotMatch(ui,/mobileReadOnlySelector='[^']*,\s*'/)
  assert.match(ui,/quickSetupSeen/)
  assert.match(ui,/renderFirstStart/)
  assert.match(html,/id="fs-vision-guide"/)
  assert.match(html,/id="fs-headless-state"/)
  assert.match(html,/id="models-vision-enabled"/)
  assert.match(html,/id="action-confirm-dialog"/)
})
