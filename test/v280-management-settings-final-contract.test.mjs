import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname,resolve} from 'node:path'
import {lifeSettingsV2,planLifeSettingsV2} from '../lib/life-settings-control.mjs'

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const read=name=>readFileSync(resolve(root,name),'utf8')
const html=read('lib/management-console.html')
const ui=read('lib/management-console.js')
const js=read('index.js')

test('神经回忆标题在遮罩外，遮罩限制在画布区域',()=>{
  const title=html.indexOf('<h4>神经回忆场</h4>')
  const field=html.indexOf('class="neural-recall-field"',title)
  const mask=html.indexOf('id="neural-embedding-mask"',field)
  assert.ok(title>0&&field>title&&mask>field)
  assert.match(html,/#panel-life \.neural-recall-field\{position:relative/)
  assert.match(html,/#panel-life \.neural-embedding-mask\{position:absolute;inset:55px 0 40px/)
  assert.match(ui,/model=data\.model\?\.installed===true/)
  assert.match(ui,/本地 Embedding 已安装，运行时尚未就绪/)
  assert.match(js,/semanticSearch:\{ready:cfg\.mainSessionMemoryEmbeddingEnabled===true&&embeddingIndex\?\.status\(\)\?\.ready===true/)
})

test('常开长期记忆/待反思收集/自动反思，不再显示关闭开关',()=>{
  assert.match(js,/const p = \{ \.\.\.patch, mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true/)
  assert.doesNotMatch(html,/id="main-memory-enabled"/)
  assert.doesNotMatch(html,/id="main-memory-auto-bili"/)
  assert.doesNotMatch(html,/id="main-reflection-auto"/)
  assert.match(html,/<section id="life-organic-presets"/)
})

test('移除旧评论自然续聊与获批用户私信单独额度；保留真实回复开关',()=>{
  assert.doesNotMatch(html,/id="comment-p6"|id="comment-at-p6"|id="dm-approved-total-limit"|id="dm-approved-daily-limit"/)
  assert.doesNotMatch(js,/approvedTotalLimit|approvedDailyLimit/)
  assert.match(js,/commentWatchReplies/)
  assert.match(js,/commentAtEnabled/)
  assert.match(js,/dmReplyPerDay/)
})

test('新安装评论、@、动态与私信默认值匹配推荐策略',()=>{
  for(const pattern of [
    /commentAtEnabled: z\.boolean\(\)\.default\(true\)/,
    /commentDailyLimit: z\.natural\(\)\.default\(500\)/,
    /dmReplyPerDay: z\.natural\(\)\.default\(200\)/,
    /commentSyncDynamic: z\.boolean\(\)\.default\(true\)/,
    /dailyDynamicEnabled: z\.boolean\(\)\.default\(true\)/,
    /dailyDynamicDraftOnly: z\.boolean\(\)\.default\(false\)/,
  ]) assert.match(js,pattern)
  assert.match(ui,/quotaPresetValues=\{[^\n]*natural:\{'quota-comment-daily':500,'dm-reply-per-day':200/)
  assert.match(html,/id="dm-reply-per-day"[^>]*value="200"/)
  assert.doesNotMatch(html,/id="comment-public-profile-read"/)
})

test('视频 Agent 三项跟随 Life 预设，旧配置仅在明确保存后改变',()=>{
  const config={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,
    autonomousPlannerMinutes:60,autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:9,
    autonomousPlannerEndHour:23,videoAgentMinIntervalMinutes:20,
    videoAgentReadTargetPerRound:8,videoAgentPickTargetPerRound:4}
  for(const [pace,minutes,read,pick] of [['quiet',60,3,3],['natural',30,5,5],['lively',15,8,5]]){
    const prev=lifeSettingsV2(config)
    const planned=planLifeSettingsV2(config,{schemaVersion:2,revision:prev.revision,mode:'active',pace,previewOnly:true})
    assert.equal(planned.after.budget.videoAgentMinIntervalMinutes,minutes)
    assert.equal(planned.after.budget.videoAgentReadTargetPerRound,read)
    assert.equal(planned.after.budget.videoAgentPickTargetPerRound,pick)
  }
  assert.match(html,/<details id="life-now-settings"/)
  assert.match(html,/<details class="life-subdetails" id="life-settings-advanced"/)
  assert.ok(html.indexOf('id="life-now-settings"')<html.indexOf('id="life-behavior-title"'))
  assert.ok(html.indexOf('id="life-v2-video-min-interval"')<html.indexOf('id="life-settings-advanced"')+1800)
  assert.ok(html.indexOf('id="life-video-manual-diagnostics"')>html.indexOf('id="panel-diagnostics"'))
})

test('README 链接新的成长路线，已删除过期路线和发布草稿',()=>{
  assert.match(read('README.md'),/docs\/ROADMAP\.md/)
  assert.match(read('docs/ROADMAP.md'),/2\.8\.1/)
  assert.equal(existsSync(resolve(root,'docs/FUTURE_ROADMAP_2.6.1_TO_2.9.1.md')),false)
  assert.equal(existsSync(resolve(root,'docs/release/archive/RELEASE_NOTES_v2.6.0-dev.3.md')),false)
})
