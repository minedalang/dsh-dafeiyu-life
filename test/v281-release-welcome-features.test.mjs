import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')

test('DSH 原生大肥鱼设置在标题下展示简洁的 2.8.1 特性',()=>{
  const client=read('client.js')
  const start=client.indexOf('🐳 大肥鱼 · DSH 生活系统')
  assert.ok(start>0)
  const next=client.slice(start,start+1200)
  for(const phrase of ['视觉配置与验收','记忆神经场','自主探索与互动','资源协调与 Headless 同步'])
    assert.ok(next.includes(phrase),`缺少 ${phrase}`)
  assert.match(client,/data-bd-281-intro/)
})

test('首次打开管理中心按 2.8.1 引导状态弹出特色介绍，并能定位 02B',()=>{
  const html=read('lib/management-console.html')
  const ui=read('lib/management-console.js')
  assert.match(html,/<dialog id="release-281-dialog"[^>]+aria-labelledby="release-281-title"/)
  assert.match(html,/id="release-281-description"/)
  assert.match(html,/id="release-281-close"/)
  assert.match(html,/id="release-281-view-setup"/)
  assert.match(html,/release-281-feature/)
  for(const text of ['视频视觉感知','记忆神经场','更连续的 Life','资源与配置管理'])assert.match(html,new RegExp(text))
  assert.match(html,/2\.8\.1 · 新版本导览/)
  assert.match(ui,/const showRelease281IfNeeded=state=>/)
  assert.match(ui,/state\.quickSetupSeen===true\)return/)
  assert.match(ui,/sessionStorage\.getItem\(release281SessionKey\)/)
  assert.match(ui,/showRelease281IfNeeded\(state\)/)
  assert.match(ui,/showStyledDialog\(release281Dialog,closeRelease281\)/)
  assert.match(ui,/if\(!state\.completed \|\| !state\.requiredReady \|\| !state\.quickSetupSeen\)switchTab\('firststart'\)/)
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
