import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')

test('真实视频 Agent 单轮入口移至诊断页，旧开发者折叠仍已删除',()=>{
  const lifePanel=html.indexOf('id="life-settings-v2-panel"')
  const realStatus=html.indexOf('id="life-real-acceptance"')
  const diagnostics=html.indexOf('id="panel-diagnostics"')
  assert.ok(lifePanel>=0&&diagnostics>lifePanel&&realStatus>diagnostics,
    '真实运行诊断应位于诊断页而不是生活页')
  assert.doesNotMatch(html,/life-agent-expert-settings|life-developer-diagnostics|life-transition-checklist/)
  assert.equal((html.match(/id="life-real-acceptance"/g)||[]).length,1)
  assert.equal((html.match(/id="life-video-agent-test-run"/g)||[]).length,1)
  assert.match(html,/视频 Agent 运行证据/)
  assert.match(html,/不会强迫选片、发表评论或点赞/)
})

test('按钮仍要求站内二次确认并调用原单轮真实视频 Agent 接口',()=>{
  assert.match(ui,/手动启动一轮真实视频 Agent？/)
  assert.match(ui,/START_ONE_REAL_VIDEO_AGENT_ROUND/)
  assert.match(ui,/request\('\/life-agent\/video-agent-test-run'/)
  assert.match(source,/path==='\/api\/bili-duty\/life-agent\/video-agent-test-run'/)
  assert.match(source,/lifeCapabilities\.run\('bilibili\.video-explore',\{entryMode:'home',manualTrigger:true\}\)/)
})
