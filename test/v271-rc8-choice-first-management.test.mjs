import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const html=read('lib/management-console.html'),js=read('lib/management-console.js')
const choiceNames={
 'bili-interaction-choice':['free','balanced','observe','custom'],
 'dm-conversation-choice':['free','friends','paused','custom'],
 'social-share-choice':['free','off','custom'],
 'life-organic-choice':['gentle','balanced','curious','custom']
}
const objectFromSource=(name,after)=>{
 const match=js.match(new RegExp('const '+name+'=(\\{[^;]+\\});'))
 assert.ok(match,`${name} config must be inspectable`)
 return runInNewContext('('+match[1]+')',{})
}
test('视频互动、私信与主动分享展示对应卡片，不再提供草稿审批',()=>{
 for(const [group,values] of Object.entries(choiceNames)){
  for(const value of values)assert.match(html,new RegExp('name="'+group+'" value="'+value+'"'))
  const i=html.indexOf('name="'+group+'"');assert.ok(i>0)
  assert.ok(html.slice(Math.max(0,i-180),i).includes('choice-presets')||group==='life-organic-choice','card structure must be visible')
 }
 assert.match(html,/\.choice-card:has\(input:checked\)/)
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)\{\.choice-card/)
 for(const id of ['bili-interaction-advanced','dm-conversation-advanced','social-share-advanced'])assert.match(html,new RegExp('id="'+id+'"'))
})
test('视频互动方案只操作旧授权字段，不建立第二份设置账本',()=>{
 const p=objectFromSource('biliPlans')
 assert.deepEqual(Object.keys(p),['free','balanced','observe'])
 assert.equal(p.free.autoComment,true)
 assert.equal(p.free.agentFollowEnabled,true)
 assert.equal(p.free.incomingImageRecognitionEnabled,true)
 assert.equal(p.balanced.autoComment,false)
 assert.equal(p.balanced.autoVideoLike,true)
 assert.equal(p.observe.autoComment,false)
 assert.equal(p.observe.autoVideoCollect,false)
 assert.equal(p.observe.agentFollowEnabled,false)
 assert.equal(p.observe.autoFavoriteDelete,false)
 assert.match(js,/for\(const \[id,key\] of biliFields\)if\(Object\.hasOwn\(biliPlans\[r\.value\],key\)\)/)
 assert.match(js,/const newlyAllowed=/)
 assert.match(js,/title:'确认新增自主互动权限'/)
 assert.match(js,/const previous=\(await request\('\/config'\)\)\.config\|\|\{\}/)
})
test('私信方案不改变好友列表、额度和主人独立工具授权',()=>{
 const p=objectFromSource('dmPlans')
 assert.equal(p.free.dmStrangerAutonomyEnabled,true)
 assert.equal(p.friends.dmStrangerAutonomyEnabled,false)
 assert.equal(p.paused.dmWatch,false)
 for(const v of Object.values(p)){
  assert.deepEqual(Object.keys(v).sort(),['dmApprovalEnabled','dmP6Enabled','dmStrangerAutonomyEnabled','dmWatch'].sort())
 }
 assert.match(js,/selectedChoice\('dm-conversation-choice'\)!=='custom'\|\|\$\('dm-stranger-enabled'\)\.checked \? \{dmStrangerOnce:false\}/)
 assert.match(js,/title:'确认开放陌生人私信'/)
})
test('视频分享卡只改变候选及发送授权，不保留默认每日次数硬上限',()=>{
 const p=objectFromSource('socialSharePlans')
 assert.deepEqual(Object.keys(p.free).sort(),['auto','enabled'])
 assert.equal(p.free.auto,true)
 assert.equal(p.free.max,undefined)
 assert.equal(p.draft,undefined)
 assert.equal(p.off.enabled,false)
 assert.match(js,/if\(enabled&&auto&&\(!previous\.socialAutoSend\|\|!previous\.socialVideoRecommendationsAuthorizedV2\)/)
 assert.match(js,/confirm:enabled\?'ENABLE_VIDEO_RECOMMENDATIONS'/)
})
test('所有方案更改只落在本地表单，仍需按原按钮保存且可以取消',()=>{
 for(const name of Object.keys(choiceNames))assert.match(js,new RegExp('input\\[name="'+name+'"\\]'))
 for(const id of ['bili-save','dm-settings-save','social-save'])assert.match(js,new RegExp("\\$\\('"+id+"'\\)\\.addEventListener\\('click'"))
 assert.match(js,/const setChoice=\(group,value\)=>/)
 assert.match(js,/setChoice\('bili-interaction-choice',preset\)/)
 assert.match(js,/setChoice\('dm-conversation-choice',dmPreset\)/)
 assert.match(js,/setChoice\('social-share-choice',sharePreset\)/)
 assert.doesNotMatch(js,/(?:window\.)?\b(?:confirm|prompt|alert)\s*\(/)
})
