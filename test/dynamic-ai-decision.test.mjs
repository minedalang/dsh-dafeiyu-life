import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const index=readFileSync(new URL('../index.js', import.meta.url),'utf8')
const client=readFileSync(new URL('../client.js', import.meta.url),'utf8')
const charter=readFileSync(new URL('../prompts/duty.md',import.meta.url),'utf8')
const python=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8')
test('one AI decision per bili_reply, not unconditional auto sync',()=>{
  assert.match(index,/sync_to_dynamic: false/)
  assert.match(index,/sync_to_dynamic: \{ type: 'boolean'/)
  assert.match(index,/dynamic_daily_limit: cfg\.dynamicDailyLimit/)
  assert.match(python,/return \(arg is True and/)
  assert.match(charter,/sync_to_dynamic: true\/false/)
  assert.match(index,/BILI_SYNC_DYNAMIC: ' \+ yq\('0'\)/)
})
test('daily cap is part of settings, overlay, status and UI',()=>{
  for(const x of ['dynamicDailyLimit: z.natural().default(3)','BILI_DYNAMIC_DAILY_LIMIT','dynamicSyncUsage','dynamicDailyLimit']) assert.ok(index.includes(x),x)
  const manager=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  for(const x of ['每天最多分享评论为动态','quota-dynamic-daily']) assert.ok(manager.includes(x),x)
  assert.match(client,/动态今日已尝试/)
})
test('dynamic prompt actively evaluates shareability and records a short local reason',()=>{
  assert.match(index,/sync_dynamic_reason: \{ type: 'string'/)
  assert.match(index,/sync_dynamic_ai_decision: args\.sync_to_dynamic === true/)
  assert.match(index,/自己确实想把这段评论分享给更多人/)
  assert.doesNotMatch(index,/通常不必同步|一般随手吐槽设 false/)
  assert.match(charter,/只有当你自己真的想分享给大家/)
  assert.match(index,/动态同步开关当前关闭：本轮 sync_to_dynamic 必须为 false/)
  assert.match(index,/动态同步已开启：同一次 bili_reply 调用必须明确填写/)
  assert.match(python,/\"dynamic_status\"/)
  assert.match(python,/\"dynamic_reason\"/)
})
test('no random sync, safe atomic quota',()=>{
  assert.doesNotMatch(python,/randbelow|random\.random/)
  assert.match(python,/BEGIN IMMEDIATE/)
  assert.match(python,/return \"already_attempted\"/)
  assert.match(python,/reservation_failed_no_publish/)
})
