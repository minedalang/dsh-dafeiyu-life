import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
test('Life controls are collapsed above the action tree and without running diagnostics',()=>{
  assert.ok(html.indexOf('id="panel-life-agent"')<html.indexOf('id="life-now-settings"'))
  assert.ok(html.indexOf('id="life-now-settings"')<html.indexOf('id="life-behavior-title"'))
  const panel=html.slice(html.indexOf('id="panel-life-agent"'),html.indexOf('id="panel-diagnostics"'))
  assert.doesNotMatch(panel,/id="life-real-acceptance"/)
  assert.match(html.slice(html.indexOf('id="panel-diagnostics"')),/id="life-real-acceptance"/)
  assert.match(panel,/<details id="life-now-settings"/)
  assert.doesNotMatch(panel,/<details id="life-now-settings"[^>]+open/)
  assert.ok(panel.indexOf('id="life-settings-advanced"')<panel.indexOf('id="life-video-agent-interval-setting"'))
  assert.ok(panel.indexOf('id="life-video-agent-interval-setting"')<panel.indexOf('id="life-v2-preview-btn"'))
})
test('choosing each preset pre-fills Video Agent controls but numeric edits switch to custom',()=>{
  assert.match(js,/quiet:\[60,3,3\],natural:\[30,5,5\],lively:\[15,8,5\]/)
  assert.match(js,/if\(r\.checked\)chooseLifePace\(r\.value\)/)
  assert.match(js,/chooseLifePace\('custom'\)/)
  for(const id of ['life-v2-video-min-interval','life-v2-video-read-target','life-v2-video-pick-target'])
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1)
})
