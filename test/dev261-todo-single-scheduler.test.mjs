import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')

test('管理页仅有独立自主调度和不强制执行的提醒入口', () => {
  const html = read('../lib/management-console.html')
  const js = read('../lib/management-console.js')
  assert.ok(html.includes('id="autonomous-planner-enabled"'))
  assert.ok(html.includes('id="owner-todo-remind"'))
  assert.ok(html.includes('预计下次自动决策'))
  assert.ok(!html.includes('id="owner-todo-auto-review"'))
  assert.ok(!html.includes('id="owner-todo-review-minutes"'))
  assert.ok(!js.includes("$('owner-todo-auto-review')"))
  assert.ok(!js.includes("$('owner-todo-review-minutes')"))
  assert.ok(js.includes("request('/autonomous-planner/remind'"))
})

test('停用旧主 Session 定时注入，不影响只读自主计划器运行', () => {
  const source = read('../index.js')
  assert.ok(!source.includes('const ownerTodoReviewTimer='))
  assert.ok(!source.includes('const ownerTodoReviewTick='))
  assert.ok(!source.includes('dafeiyu-owner-todo-review'))
  assert.ok(source.includes('autonomousPlanner.start()'))
  assert.ok(source.includes('autonomousPlanner.tick({force:true,todosOnly:true})'))
  assert.ok(source.includes('ownerTodoAutoReviewEnabled: z.boolean()'), '旧配置保持可读取')
  assert.ok(source.includes('autoReview:false'), '老 API 不应误报旧定时器正在运行')
})
