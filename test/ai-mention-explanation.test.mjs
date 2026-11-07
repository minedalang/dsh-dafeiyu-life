import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
const charter=readFileSync(new URL('../prompts/duty.md',import.meta.url),'utf8')
test('comment decision has AI-facing short explanation field in SAME tool call',()=>{
  assert.match(index,/no_mention_reason: \{type:'string'/)
  assert.match(index,/no_mention_reason: args\.should_mention === false/)
  assert.match(index,/should_mention: args\.should_mention === true/)
  assert.match(index,/sync_to_dynamic: false/)
  assert.match(charter,/no_mention_reason/)
  assert.match(index,/它只保存到用户本地诊断/)
})
test('python persists only self-declared explanation for AI decline, never returns it',()=>{
  assert.match(py,/no_mention_reason: str = ""/)
  assert.match(py,/"ai_reason": no_mention_reason if mention_reason == "ai_declined" else ""/)
  assert.match(py,/diagnostic\.get\("reason"\) == "ai_declined"/)
  assert.match(py,/"ai_reason": _public_no_mention_reason/)
  assert.match(py,/AI说明=/)
  assert.doesNotMatch(py,/return json\.dumps\(\{\s*"mention_diagnostic"/)
})
test('settings shows reason in existing daily mention panel, no extra model calls',()=>{
  assert.match(ui,/AI说明：/)
  assert.match(ui,/x\.reason==='ai_declined'&&x\.ai_reason/)
  assert.match(ui,/mention-diagnostics/)
  assert.match(ui,/今天还没有 @ 诊断记录/)
})
