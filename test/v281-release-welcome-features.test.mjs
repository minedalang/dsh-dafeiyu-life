import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')

test('DSH 原生大肥鱼设置在标题下展示简洁的 2.8.2 特性',()=>{
  const client=read('client.js')
  const start=client.indexOf('🐳 大肥鱼 · DSH 生活系统')
  assert.ok(start>0)
  const next=client.slice(start,start+2200)
  for(const phrase of ['先看视频全貌，再细看喜欢的片段','看过哪些画面，有时间和记录可查','鱼鱼自己决定看几段，也可以不看','没字幕也可尝试听声音'])
    assert.ok(next.includes(phrase),`缺少 ${phrase}`)
  assert.match(client,/data-bd-281-intro/)
  assert.match(client,/2\.8\.2 版本亮点/)
  assert.match(client,/大肥鱼的核心能力/)
})

test('首次打开管理中心按 2.8.2 引导状态弹出特色介绍，并能定位 02B',()=>{
  const html=read('lib/management-console.html')
  const ui=read('lib/management-console.js')
  assert.match(html,/<dialog id="release-281-dialog"[^>]+aria-labelledby="release-281-title"/)
  assert.match(html,/id="release-281-description"/)
  assert.match(html,/id="release-281-close"/)
  assert.match(html,/id="release-281-view-setup"/)
  assert.match(html,/release-281-feature/)
  for(const text of ['先看全貌，再看细节','看过什么，有迹可循','鱼鱼可以自己决定看多久','没字幕也能尝试听懂'])assert.match(html,new RegExp(text))
  assert.match(html,/2\.8\.2 · 新版本导览/)
  assert.match(ui,/const showRelease281IfNeeded=state=>/)
  assert.match(ui,/state\.quickSetupSeen===true\)return/)
  assert.match(ui,/sessionStorage\.getItem\(release281SessionKey\)/)
  assert.match(ui,/showRelease281IfNeeded\(state\)/)
  assert.match(ui,/showStyledDialog\(release281Dialog,closeRelease281\)/)
  assert.match(ui,/const needsSetup=!state\.completed\|\|!state\.requiredReady\|\|!state\.quickSetupSeen/)
  assert.match(ui,/needsSetup\?switchTab\('firststart'\):switchTab/)
  assert.match(ui,/const target=\$\('fs-vision-guide'\)/)
  assert.match(ui,/if\(target\)revealTarget\(target\)/)
})

test('弹窗关闭绝不能代替新版确认、启用视觉或产生外发授权',()=>{
  const ui=read('lib/management-console.js')
  const fragment=ui.slice(ui.indexOf('const release281Dialog='),ui.indexOf('  // First Start: versioned welcome gate'))
  assert.match(fragment,/release281Dialog\.close\(\)/)
  assert.doesNotMatch(fragment,/request\(|fetch\(|quickSetupSeenRevision|visionEnabled\s*=|models-vision-enabled'\)\.checked\s*=|patchConfig\(/)
  assert.match(fragment,/sessionStorage\.setItem/)
  assert.match(ui,/#release-281-close,#release-281-view-setup/,'手机查看模式需允许关闭弹窗')
  assert.match(read('lib/management-console.html'),/release-281-dialog::backdrop/)
})
