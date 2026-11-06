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
  ['```json\n{"action":"skip"}\n```','model-json-invalid'],
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

test('single everyday life setup is outside developer diagnostic; old fields remain compatible but hidden',()=>{
 assert.ok(html.indexOf('id="panel-life"')<html.indexOf('id="life-settings-v2-panel"'))
 assert.ok(html.indexOf('id="life-settings-v2-panel"')<html.indexOf('id="life-agent-wake"'))
 assert.ok(html.indexOf('id="life-developer-diagnostics"')<html.indexOf('id="life-social-context-optin"'))
 assert.ok(html.includes('<summary>🛠️ 开发者诊断与旧配置（普通使用无需打开）</summary>'))
 for(const id of ['life-v2-mode','life-v2-pace','life-v2-save-btn','life-agent-wake','life-agent-wake-result','life-social-context-optin','life-legacy-planner-advanced','autonomous-planner-enabled']){
  assert.equal(html.split('id="'+id+'"').length-1,1,id)
 }
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
