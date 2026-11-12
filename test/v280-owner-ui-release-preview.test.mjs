import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const html=src('lib/management-console.html'),ui=src('lib/management-console.js')

test('graph search is immediately above its 3D viewport in the same field, including fullscreen',()=>{
 const a=html.indexOf('<div class="neural-recall-field">')
 const b=html.indexOf('id="neural-memory-viewport"',a)
 const fragment=html.slice(a,b)
 assert.ok(a>=0&&b>a)
 assert.match(fragment,/id="neural-search-input"/)
 assert.match(fragment,/id="neural-search-apply"/)
 assert.doesNotMatch(fragment,/neural-legend|neural-recall-controls/)
 assert.equal((html.match(/id="neural-search-input"/g)||[]).length,1)
 assert.match(ui,/neuralBoard\.requestFullscreen/)
})

test('old duplicate plan flow is gone and functional admin tools are tabs, not three stacked pages',()=>{
 assert.doesNotMatch(html,/class="life-source-flow"|class="todo-page-intro"/)
 for(const id of ['life-plan-hub-grid','life-plan-admin','life-todo-section','owner-todo-list','life-opportunities-section','owner-todo-add','owner-todo-settings-save'])
  assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1)
 assert.match(html,/data-life-plan-open="todo"/)
 assert.match(html,/data-life-plan-open="source"/)
 assert.match(html,/id="life-opportunities-section"[^>]*hidden/)
 assert.match(ui,/showLifePlanTool/)
 assert.match(ui,/todo\.hidden=normalized!=='todo';source\.hidden=normalized!=='source'/)
 assert.match(ui,/\('owner-todo-add'\)\.addEventListener/)
})

test('2.8.0 preview version and user release docs are consistent without public release',()=>{
 const pkg=JSON.parse(src('package.json')),lock=JSON.parse(src('package-lock.json'))
 assert.equal(pkg.version,'2.8.0-dev.1')
 assert.equal(lock.version,pkg.version)
 assert.equal(lock.packages[''].version,pkg.version)
 assert.ok(pkg.files.includes('RELEASE_NOTES_v2.8.0.md'))
 const readme=src('README.md'),notes=src('RELEASE_NOTES_v2.8.0.md'),audit=src('docs/architecture/2.8.0-release-readiness.md')
 assert.match(readme,/新生活系统刚上线/)
 assert.match(readme,/反馈体验和提出建议/)
 assert.match(notes,/可能仍有不稳定、遗漏或 Bug/)
 assert.match(readme,/2\.8\.0-life-overview\.svg/)
 assert.match(audit,/releaseReady:false/)
 assert.match(audit,/至少 72 小时|72 小时/)
 assert.match(readme,/没有引入 Vue/)
})
