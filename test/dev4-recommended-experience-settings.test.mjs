import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {RECOMMENDED_EXPERIENCE_SETTINGS,RECOMMENDED_EXPERIENCE_GROUPS} from '../lib/recommended-experience-settings.mjs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('推荐值按功能组定义且全部为合法数值，不包含身份、授权、密钥或发送额度',()=>{
  const groups=RECOMMENDED_EXPERIENCE_GROUPS
  assert.equal(RECOMMENDED_EXPERIENCE_SETTINGS.version,'2.6.0-dev.4')
  assert.deepEqual(Object.keys(groups),['reflection','recall','retrieval','commentContext','dmContext'])
  assert.equal(groups.recall.mainSessionMemoryDailyQuota,30)
  assert.equal(groups.recall.mainSessionMemoryMaxItems,8)
  assert.equal(groups.recall.mainSessionMemoryMaxChars,1200)
  assert.equal(groups.commentContext.commentReplyHotCount,12)
  assert.equal(groups.dmContext.dmContextMessages,40)
  for(const [group,settings] of Object.entries(groups)){
    assert.ok(Object.keys(settings).length>0,group)
    for(const [key,value] of Object.entries(settings)){
      assert.ok(Number.isFinite(value),key)
      assert.doesNotMatch(key,/OwnerUid|Whitelist|Enabled|Provider|ModelId|Password|Token|CommentReplyPerDay|DmReplyPerDay|AutoSend/)
    }
  }
})

test('后台向管理中心提供与新安装默认值一致的版本化推荐值，保留老安装兼容默认',()=>{
  const index=read('index.js')
  assert.match(index,/recommendedSettings:RECOMMENDED_EXPERIENCE_SETTINGS/)
  assert.match(index,/mainSessionMemoryDailyQuota: RECOMMENDED_EXPERIENCE_GROUPS\.recall\.mainSessionMemoryDailyQuota/)
  assert.match(index,/mainSessionMemoryMaxItems: RECOMMENDED_EXPERIENCE_GROUPS\.recall\.mainSessionMemoryMaxItems/)
  assert.match(index,/mainSessionMemoryMaxChars: RECOMMENDED_EXPERIENCE_GROUPS\.recall\.mainSessionMemoryMaxChars/)
  assert.match(index,/mainSessionReflectionBatchSize: RECOMMENDED_EXPERIENCE_GROUPS\.reflection\.mainSessionReflectionBatchSize/)
  assert.match(index,/legacyExperienceDefaults\s*=\s*\{[\s\S]{0,500}mainSessionMemoryMaxItems:\s*6/)
  assert.match(index,/mainSessionMemoryMaxChars:\s*800/)
})

test('管理中心每组都有对应按钮和全部输入框；老用户必须手动保存才能生效',()=>{
  const html=read('lib/management-console.html'),js=read('lib/management-console.js')
  const ids={
    reflection:['main-reflection-min','main-reflection-batch','main-reflection-hours','main-reflection-daily'],
    recall:['main-memory-half-life','main-memory-threshold','main-memory-max-items','main-memory-max-chars','main-memory-daily','main-memory-facts'],
    retrieval:['main-memory-candidates','main-memory-search-daily'],
    commentContext:['comment-reply-hot-count'],dmContext:['dm-context-messages'],
  }
  for(const [group,controls] of Object.entries(ids)){
    assert.match(html,new RegExp(`data-recommend-group="${group}"`))
    assert.match(js,new RegExp(`\\b${group}:\\{`))
    for(const id of controls)assert.ok(html.includes(`id="${id}"`),id)
  }
  assert.match(js,/const r=await request\('\/config'\);const preset=r\.recommendedSettings\?\.groups\?\.\[group\]/)
  assert.match(js,/el\.value=String\(preset\[key\]\)/)
  assert.doesNotMatch(js.match(/const stageRecommendedGroup=async group=>\{[\s\S]*?\n  \};/)?.[0]||'',/request\('\/config',\s*\{/)
  assert.match(js,/mainSessionMemoryDailyQuota:boundedInt\('main-memory-daily',1,100/)
  assert.match(html,/id="main-memory-daily" max="100"/)
  assert.equal((html.match(/class="recommended-reset" data-recommend-group="[^"]+">使用推荐值<\/button>/g)||[]).length,5)
  assert.match(html,/\.recommended-reset\{[^}]*linear-gradient/)
  assert.doesNotMatch(html,/>恢复最新推荐值<\/button>/)
})

test('release 更新说明明确建议老用户主动恢复并说明隐私与保存边界',()=>{
  const ui=read('lib/management-console.js'),html=read('lib/management-console.html'),readme=read('README.md')
  assert.match(ui,/const stageRecommendedGroup=async group=>/)
  assert.match(ui,/recommendedSettings\?\.groups/)
  assert.match(html,/使用推荐值/)
  assert.match(readme,/未来规划/)
  assert.match(readme,/白名单/)
})
