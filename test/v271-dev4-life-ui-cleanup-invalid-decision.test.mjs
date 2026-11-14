import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname,resolve} from 'node:path'
import {validatePlannerDecision} from '../lib/autonomous-planner.mjs'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const html=readFileSync(resolve(root,'lib/management-console.html'),'utf8')
const ui=readFileSync(resolve(root,'lib/management-console.js'),'utf8')

test('invalid model output has safe reason categories, without leaking model text or granting a write',()=>{
 const allowed=[{id:'read-1',type:'check_notifications'}]
 const cases=[
  ['```json invalid ```','model-json-invalid'],
  ['[]','model-response-shape'],
  ['{}','model-action-unknown'],
  ['{"action":"send_dm","id":"read-1"}','model-action-unknown'],
  ['{"action":"execute_read","id":"nonexistent"}','model-target-invalid'],
  ['{"action":"inspect_opportunity","id":"nonexistent"}','model-target-invalid']]
 for(const [raw,code] of cases){
  const x=validatePlannerDecision(raw,allowed)
  assert.equal(x.action,'skip');assert.equal(x.invalid,true);assert.equal(x.diagnosticCode,code)
  assert.equal(JSON.stringify(x).includes('nonexistent'),false)
 }
 assert.equal(validatePlannerDecision('{"action":"skip"}',allowed).invalid,undefined)
})

test('Life 常规设置移除旧开发选项，真实运行入口保留；评论只读授权归入评论设置',()=>{
 assert.ok(html.indexOf('id="panel-life-agent"')<html.indexOf('id="life-settings-v2-panel"'))
 assert.ok(html.indexOf('id="life-settings-v2-panel"')<html.indexOf('id="life-agent-wake"'))
 for(const id of ['life-agent-expert-settings','life-developer-diagnostics','life-social-context-optin','life-social-shadow-save',
   'life-transition-checklist','life-handoff-dry-dm','life-handoff-dry-comment','life-offline-demo','life-evidence-contrast'])
  assert.doesNotMatch(html,new RegExp('id="'+id+'"'),id)
 for(const id of ['life-legacy-planner-advanced','autonomous-planner-enabled'])assert.ok(!html.includes('id="'+id+'"'),id)
 for(const id of ['life-v2-mode','life-v2-pace','life-v2-save-btn','life-agent-wake','life-agent-wake-result','life-integration-refresh','life-video-agent-test-run']){
  assert.equal(html.split('id="'+id+'"').length-1,1,id)
 }
 const comments=html.indexOf('id="panel-comments"')
 assert.ok(comments>=0)
 assert.doesNotMatch(html,/id="comment-public-person-read"/,'评论公开资料只读能力固定开启，退休的单独开关不得复活')
 assert.equal(html.includes('🐟 Life Agent · 自主生活驱动（dev.4'),false)
 assert.equal(html.includes('Phase 5/6g · 社交上下文影子对照'),false)
})

test('failed choice has a visible distinct message and never presents itself as voluntary rest',()=>{
 assert.ok(ui.includes("r.result==='invalid-decision'"))
 assert.ok(ui.includes("$('life-agent-wake-result').textContent=resultText"))
 assert.ok(ui.includes('本次 AI 决策未通过校验，未执行动作'))
 assert.ok(ui.includes('模型选择了不存在或无权处理的目标'))
 assert.ok(ui.includes("$('life-v2-mode').value==='active'"))
 assert.ok(!ui.includes("$('life-agent-mode').value==='active'&&!confirm"))
})
