import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const count=id=>(html.match(new RegExp('id="'+id+'"','g'))||[]).length
const panel=html.slice(html.indexOf('<section id="panel-life-agent"'),html.indexOf('<section id="panel-plans"'))
const plans=html.slice(html.indexOf('<section id="panel-plans"'),html.indexOf('</section>',html.indexOf('<section id="panel-plans"')))

test('action tree and day timeline share one life card with real chronology below the tree',()=>{
  const card=panel.slice(panel.indexOf('<section class="life-behavior-card"'),panel.indexOf('</section>',panel.indexOf('<section class="life-behavior-card"')))
  assert.match(card,/id="life-behavior-tree"/)
  assert.match(card,/class="life-now-timeline life-behavior-timeline" open/)
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
  assert.match(js,/querySelector\('#panel-life-agent \.life-now-timeline'\)/)
  assert.match(js,/EventSource/)
  assert.match(panel,/href="#life-timeline-section"/)
})

test('the three explanations are concise, singular, and paired with original filters',()=>{
  assert.match(plans,/class="life-plan-meaning"/)
  for(const [label,keyword] of [['生活线索','真实经历'],['生活契机','可核对的来源'],['已接待办','真实回执']]){
    assert.match(plans,new RegExp(label+'[^<]*<\/strong><span>[^<]*'+keyword))
  }
  assert.equal((plans.match(/role="listitem"/g)||[]).length,3)
  for(const kind of ['cue','opportunity','todo'])assert.match(plans,new RegExp('data-life-plan-filter="'+kind+'"'))
  assert.match(plans,/id="life-plan-hub-grid"/)
  assert.match(html,/#panel-plans \.life-plan-meaning/)
  assert.match(html,/@media\(max-width:760px\)/)
})
