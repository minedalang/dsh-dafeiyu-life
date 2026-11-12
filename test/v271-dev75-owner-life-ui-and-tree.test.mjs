import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const planner=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
const once=id=>assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`single ${id}`)
const within=(panel,id)=>{
  const a=html.indexOf(`<section id="panel-${panel}"`),b=html.indexOf('</section>',a)
  assert.ok(a>=0&&b>a,`panel ${panel}`)
  assert.ok(html.slice(a,b).includes(`id="${id}"`),`${id} located in ${panel}`)
}
test('life plans retain real todo/source tools without the obsolete duplicate flow',()=>{
  for(const id of ['panel-plans','life-plan-hub-grid','life-plan-admin','life-todo-section','owner-todo-list','life-opportunities-section'])once(id)
  for(const id of ['life-todo-section','life-opportunities-section'])within('plans',id)
  assert.doesNotMatch(html,/class="life-source-flow"/)
  assert.match(html,/data-life-plan-tool="todo"/)
  assert.match(html,/data-life-plan-tool="source"/)
  assert.match(js,/showLifePlanTool/)
  assert.match(js,/if\(tab==='todos'\)tab='plans'/)
  assert.match(js,/plans:async\(\)=>\{await Promise\.all\(\[loadOwnerTodos\(\),loadLifeOpportunities\(\)\]\)\}/)
})
test('pace is above life timeline, collapsed by default and old timeline remains',()=>{
  once('life-now-settings');once('life-timeline-section');once('life-behavior-tree')
  assert.ok(html.indexOf('id="life-now-settings"')<html.indexOf('class="life-now-timeline"'))
  assert.match(html,/<details id="life-now-settings" class="life-now-settings">/)
})
test('behavior map follows real read-only decision traces, not a fake autoplay or write action',()=>{
  assert.match(js,/const loadLifeBehaviorTree=async\(\)=>/)
  const start=js.indexOf('const loadLifeBehaviorTree=async()=>')
  const end=js.indexOf("$('life-behavior-refresh')",start)
  const segment=js.slice(start,end)
  assert.match(segment,/request\('\/life-agent\/decision-traces'\)/)
  assert.match(segment,/type==='execution-plan'/)
  assert.match(segment,/type==='execution-result'/)
  assert.match(segment,/life-tree-edge/)
  assert.doesNotMatch(segment,/request\('\/(?:bili|comment|dm|life-agent\/wake)'\s*,\s*\{/)
  assert.match(html,/prefers-reduced-motion:reduce/)
})
test('tree shows genuinely wired Life branches and clearly distinguishes professional actions',()=>{
  for(const action of ['execute_read','inspect_exploration','inspect_creator_space','inspect_public_person','browse_home','consider_social','reflect','reach_out_friend']){
    assert.ok(planner.includes(`'${action}'`),`supported by planner: ${action}`)
    assert.ok(js.includes(`'${action}'`),`shown in map: ${action}`)
  }
  assert.match(html,/专业工具与发送门禁/)
})
test('Headless explicit verification path is separate from preview-then-confirm sync',()=>{
  assert.match(html,/同步到 Headless · 先预览/)
  assert.match(html,/必须完成相应配置同步与真实模型验证后才能就绪/)
  assert.match(html,/id="headless-sync-commit" hidden/)
  assert.match(js,/request\('\/headless-model\/preview'/)
  assert.match(js,/request\('\/headless-model\/sync'/)
  assert.match(js,/request\('\/headless-model\/verify'/)
})
test('owner friendly DM and memories do not expose raw errors by default',()=>{
  assert.match(html,/聊天内容的保留与清理/)
  assert.match(js,/最近一次连接有异常，详情请打开「运行诊断」/)
  assert.match(js,/过期内容可清理/)
  assert.match(html,/memory-journey-nav/)
  assert.match(html,/真实积累的喜好/)
})
