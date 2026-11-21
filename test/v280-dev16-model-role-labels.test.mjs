import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const root=new URL('../',import.meta.url)
const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
const index=readFileSync(new URL('index.js',root),'utf8')
const ui=readFileSync(new URL('lib/management-console.js',root),'utf8')

test('Life 决策拥有真实独立模型路由，仍兼容原互动模型',()=>{
  assert.match(index,/behaviorDecisionModelProvider: z\.string\(\)/)
  assert.match(index,/route==='behaviorDecision'\?cfg\.behaviorDecisionModelProvider\|\|cfg\.interactionModelProvider/)
  assert.match(index,/modelRoute:'behaviorDecision'/)
  assert.match(index,/headless-life-decision-overlay\.yml/)
  assert.match(index,/recordModelTask\(stateDir,summaryRoute\?'video':modelRoute\)/)
  assert.match(index,/cfg\.interactionModelProvider\|\|cfg\.pluginDefaultModelProvider/)
  assert.match(index,/cfg\.videoModelProvider\|\|cfg\.pluginDefaultModelProvider/)
})
