import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')

test('陌生人自主回复授权只有交流方案可见入口，保留旧配置字段但不重复展示',()=>{
  assert.match(html,/name="dm-conversation-choice" value="free"/)
  assert.match(html,/name="dm-conversation-choice" value="friends"/)
  assert.match(html,/<div hidden aria-hidden="true"><input id="dm-stranger-enabled" type="checkbox"><\/div>/)
  assert.doesNotMatch(html,/允许鱼鱼自主考虑并多轮回复陌生人（新增授权，默认关闭）/)
  assert.match(js,/dmStrangerAutonomyEnabled:\$\('dm-stranger-enabled'\)\.checked/)
  assert.match(js,/确认开放陌生人私信/)
})

test('严格暗号旧配额仅兼容迁移，当前自然表达与跨渠道防扰仍可配置',()=>{
  assert.match(html,/<div hidden aria-hidden="true"><input id="dm-stranger-max"/)
  assert.match(html,/<h4>🌱 自然表达与续聊 · 独立方案<\/h4>/)
  assert.match(html,/id="dm-p6-enabled"/)
  assert.match(html,/id="social-p6-min-delay"/)
  assert.match(html,/id="social-rhythm-cooldown"/)
  assert.match(js,/dmP6MaxBubbles:boundedInt/)
  assert.match(js,/socialRhythmCrossChannelMinutes:boundedInt/)
})

test('私信管理页显示快通道实测次数，而不把开启等同于实际执行',()=>{
  assert.match(html,/id="dm-fast-status"/)
  assert.match(js,/interactionSchedulerStatus\?\.activeDm/)
  assert.match(js,/尚未观察到定向检查/)
  assert.match(js,/Number\(fast\.checks\)/)
})
