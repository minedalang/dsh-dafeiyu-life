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

test('评论者公开投稿只读许可位于评论设置，并沿用服务端单独确认门禁',()=>{
  const comments=html.indexOf('id="panel-comments"')
  const setting=html.indexOf('id="comment-public-person-read"')
  const life=html.indexOf('id="panel-life-agent"')
  assert.ok(comments>=0&&setting>comments&&setting>life)
  assert.match(ui,/commentPublicProfileReadEnabled:publicRead/)
  assert.match(ui,/commentProfileReadConfirm:'ENABLE_PUBLIC_COMMENTER_READ'/)
  assert.match(ui,/publicReadNew&&!await confirmAction/)
  assert.match(ui,/\$\('comment-public-person-read'\)\.dataset\.loaded/)
  assert.match(server,/commentProfileReadConfirm!=='ENABLE_PUBLIC_COMMENTER_READ'/)
  assert.doesNotMatch(ui,/lifeAgentSocialContextOptIn|lifeSocialShadowConfirm/)
})
