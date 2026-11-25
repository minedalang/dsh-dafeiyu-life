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
 assert.match(fragment,/class="neural-canvas-legend"/);assert.match(fragment,/neural-legend|neural-recall-controls/)
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

test('all neural legend controls are adjacent to viewport; long evidence has its own scroll and cannot size canvas',()=>{
 const a=html.indexOf('class="neural-canvas-legend"'),b=html.indexOf('id="neural-memory-viewport"',a),fragment=html.slice(a,b);assert.ok(a>0&&b>a);
 for(const id of ['neural-show-all','neural-node-limit','neural-show-interest','neural-show-relationship','neural-show-source','neural-show-association','neural-show-emotion','neural-filter-experience','neural-filter-relationship','neural-filter-interest','neural-filter-fact','neural-filter-emotion','neural-association-types']){assert.ok(fragment.includes(`id="${id}"`),id);assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id)}
 assert.match(html,/\.neural-recall-layout\{align-items:start;min-width:0;grid-template-columns:minmax\(0,2\.3fr\) minmax\(0,1fr\)/);assert.match(html,/\.neural-memory-viewport\{flex:0 0 auto;height:clamp/);assert.match(html,/\.neural-memory-detail\{min-width:0;min-height:0;max-height:clamp[^}]+overflow:auto;overflow-wrap:anywhere/);assert.match(html,/\.neural-relation-list\{display:grid;grid-template-columns:minmax\(0,1fr\)/);assert.match(fragment,/青色光束 · 本次搜索相似度/);assert.match(fragment,/灰点 · 未命中/)
})
