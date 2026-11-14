import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const root=new URL('../',import.meta.url)
const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
const index=readFileSync(new URL('index.js',root),'utf8')
const ui=readFileSync(new URL('lib/management-console.js',root),'utf8')

test('AI 模型页按九种实际任务说明质量与成本取舍',()=>{
  assert.match(html,/按工作选模型，不必九项都选最贵/)
  for(const name of ['行为决策模型','社交互动模型','主人 Agent 模型','视频 Agent 模型',
    '视觉识别模型','人生反思与经历提炼模型','人生记忆检索模型','生活动态文案模型','表情包规则优化模型'])
    assert.ok(html.includes(name),`missing task ${name}`)
  assert.match(html,/默认复用视频 Agent 模型/)
  assert.match(html,/文字连接测试不证明识图成功/)
  assert.match(html,/旧用户未单独配置时仍沿用互动模型/)
  assert.match(html,/高频 · 推荐均衡模型/)
  assert.match(html,/无须默认使用昂贵的深度推理档/)
  assert.match(html,/id="models-behaviorDecision"/)
  assert.match(html,/id="models-video"/)
  assert.match(html,/id="models-interaction"/)
  assert.match(ui,/behaviorDecisionModelProvider/)
})

test('Life 决策拥有真实独立模型路由，仍兼容原互动模型',()=>{
  assert.match(index,/behaviorDecisionModelProvider: z\.string\(\)/)
  assert.match(index,/route==='behaviorDecision'\?cfg\.behaviorDecisionModelProvider\|\|cfg\.interactionModelProvider/)
  assert.match(index,/modelRoute:'behaviorDecision'/)
  assert.match(index,/headless-life-decision-overlay\.yml/)
  assert.match(index,/recordModelTask\(stateDir,modelRoute\)/)
  assert.match(index,/cfg\.interactionModelProvider\|\|cfg\.pluginDefaultModelProvider/)
  assert.match(index,/cfg\.videoModelProvider\|\|cfg\.pluginDefaultModelProvider/)
})
