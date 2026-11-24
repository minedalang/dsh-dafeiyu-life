import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const count=id=>(html.match(new RegExp('id="'+id+'"','g'))||[]).length
const panel=html.slice(html.indexOf('<section id="panel-life-agent"'),html.indexOf('<section id="panel-plans"'))
const plans=html.slice(html.indexOf('<section id="panel-plans"'),html.indexOf('</section>',html.indexOf('<section id="panel-plans"')))

test('action tree and day timeline share one life card with real chronology below the tree',()=>{
  const card=panel.slice(panel.indexOf('<section class="life-behavior-card"'),panel.indexOf('<div id="life-now-recent"'))
  assert.match(card,/id="life-behavior-tree"/)
  assert.match(card,/class="life-now-timeline life-behavior-timeline"/)
  assert.match(card,/id="life-timeline-list"/)
  assert.ok(card.indexOf('id="life-behavior-tree"')<card.indexOf('id="life-timeline-list"'))
  assert.ok(panel.indexOf('id="life-timeline-list"')<panel.indexOf('id="life-now-recent"'))
  assert.equal(count('life-timeline-list'),1)
  assert.equal(count('life-timeline-days'),1)
  assert.equal(count('life-timeline-refresh'),1)
  assert.equal(count('life-behavior-tree'),1)
  assert.equal((panel.match(/class="life-now-timeline/g)||[]).length,1)
})

test('timeline remains independently refreshable using existing read-only business endpoint and SSE',()=>{
  assert.match(js,/request\('\/life-timeline\?days='/)
  assert.match(js,/\$\('life-timeline-days'\)\.addEventListener\('change'/)
  assert.match(js,/\$\('life-timeline-refresh'\)\.addEventListener\('click'/)
  assert.match(js,/const loadLifeNowTimeline=\(\)=>/)
  assert.match(js,/EventSource/)
  assert.doesNotMatch(panel,/href="#life-timeline-section"/,'用户要求删除重复的标题与时间线跳转')
  assert.match(js,/setInterval\(\(\)=>\{void reconcileVisibleLife\(\)\},4000\)/)
})

test('life records are parallel, compact selectable categories, not a funnel',()=>{
  assert.match(plans,/class="life-plan-overview" role="group"/)
  assert.doesNotMatch(plans,/<svg class="life-plan-flow-svg"/)
  assert.doesNotMatch(plans,/0[123] · (生活线索|生活契机|已接待办)/)
  for(const kind of ['cue','opportunity','todo']){
    assert.match(plans,new RegExp('data-life-plan-overview="'+kind+'"[^>]*aria-controls="life-plan-hub-grid"'))
    assert.match(plans,new RegExp('data-life-plan-filter="'+kind+'"'))
  }
  for(const text of ['从已有经历中','已经明确接下','彼此独立、可以并存'])
    assert.match(plans,new RegExp(text))
  assert.doesNotMatch(plans,/life-plan-overview-origin/, '卡片不再重复展示过长的来源解释')
  assert.match(html,/#panel-plans \.life-plan-overview-card::before\{display:none!important\}/)
  assert.match(html,/#panel-plans \.life-plan-overview-card\{min-height:0/)

  for(const id of ['life-flow-cues','life-flow-opportunities','life-flow-todos'])assert.equal(count(id),1)
  assert.match(js,/button\.dataset\.lifePlanOverview/)
  assert.match(js,/overviewCounts=\{cue:'life-flow-cues',opportunity:'life-flow-opportunities',todo:'life-flow-todos'\}/)
  assert.match(html,/#panel-plans \.life-plan-overview-card\[aria-pressed="true"\]/)
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)/)
})
