import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const html=read('lib/management-console.html')
const ui=read('lib/management-console.js')
const server=read('index.js')

test('Life 常规设置彻底移除旧开发者控件，但保留真实运行状态与手动视频 Agent',()=>{
  const panel=html.indexOf('id="panel-life-agent"')
  const settings=html.indexOf('id="life-settings-v2-panel"')
  const status=html.indexOf('id="life-real-acceptance"')
  const run=html.indexOf('id="life-video-agent-test-run"')
  assert.ok(panel>=0&&settings>panel&&status>settings&&run>status)
  for(const id of [
    'life-agent-expert-settings','life-developer-diagnostics','life-transition-checklist',
    'life-handoff-dry-dm','life-handoff-dry-comment','life-offline-demo','life-evidence-contrast',
    'life-social-context-optin','life-social-shadow-save','life-agent-timeline','life-social-ownership',
    'life-settings-preview','life-agent-status','autonomous-planner-status'
  ])assert.doesNotMatch(html,new RegExp('id="'+id+'"'),id)
  assert.doesNotMatch(html,/开发者选项|开发者诊断与旧配置|演示四种选择|DEBUG/)
  assert.doesNotMatch(ui,/DEBUG：|DEBUG 此条/)
  assert.match(html,/id="life-readiness-refresh"/)
  assert.match(html,/不会强迫选片、发表评论或点赞/)
  assert.match(ui,/START_ONE_REAL_VIDEO_AGENT_ROUND/)
  assert.match(ui,/request\('\/life-agent\/video-agent-test-run'/)
  assert.doesNotMatch(ui,/request\('\/life-agent\/(?:offline-demo|transition-readiness|social-handoff-rehearsal|evidence-contrast)'/)
})

test('评论者公开资料读取为统一能力，管理页不再重复询问但仍限制精确账号和证据',()=>{
  assert.doesNotMatch(html,/id="comment-public-person-read"/)
  assert.doesNotMatch(ui,/commentProfileReadConfirm:'ENABLE_PUBLIC_COMMENTER_READ'/)
  assert.match(server,/commentPublicProfileReadEnabled:\s*z\.boolean\(\)\.default\(true\)/)
  assert.match(server,/readVerifiedCommenterPublicVideos\(/)
  assert.doesNotMatch(ui,/lifeAgentSocialContextOptIn|lifeSocialShadowConfirm/)
})
