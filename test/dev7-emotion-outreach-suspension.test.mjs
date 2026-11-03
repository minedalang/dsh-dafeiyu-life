import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createEmotionalState} from '../lib/emotional-state.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'

const root=resolve(fileURLToPath(import.meta.url),'../..')
const src=x=>readFileSync(join(root,x),'utf8')
const temp=async f=>{const d=mkdtempSync(join(tmpdir(),'dafeiyu-dev7-emotion-'));try{return await f(d)}finally{rmSync(d,{recursive:true,force:true})}}
const BV='BV19SJi6VEj1'
const now=Date.parse('2026-11-01T17:00:00Z')

test('主动回访即使旧配置仍开启，生产暂停模式不生成草稿、不调用模型、不发送',()=>temp(async dir=>{
  let models=0,sends=0
  const cfg={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,socialAutoSend:true,socialOutreachDailyLimit:1000,
    friendDirectory:JSON.stringify([{uid:'11111',dm:true,recommend:'dm'}]),
    mentionProfiles:JSON.stringify({'11111':{personalityInterests:'美食'}})}
  const e=createSocialIntentEngine({dataDir:dir,paused:true,getConfig:()=>cfg,now:()=>now,
    invokeModel:async()=>{models++;return '{"action":"draft","message":"这条视频很好看哦！"}'},sendMessage:async()=>{sends++;return {ok:true}}})
  assert.deepEqual({paused:e.status().paused,enabled:e.status().enabled,auto:e.status().autoSend},{paused:true,enabled:false,auto:false})
  assert.equal((await e.reflectOnWatched([{bvid:BV,picked:true,title:'美食视频'}])).skipped,'paused-for-2.6.1')
  assert.match((await e.send('unknown',{confirm:true})).error,/暂停主动回访/)
  assert.equal(models,0);assert.equal(sends,0)
  // Paused mode remains supported for legacy tests, but production now restores
  // only the independent, explicit-consent video interest recommendation path.
  assert.match(src('index.js'),/dataDir:stateDir,videoRecommendationsOnly:true/)
}))

test('管理页恢复独立视频推荐授权，旧回访草稿仍不能被点击发送',()=>{
  const html=src('lib/management-console.html'),js=src('lib/management-console.js')
  assert.match(html,/id="social-outreach-legacy"/)
  assert.match(html,/<details id="social-outreach-legacy"[^>]*\bopen\b/)
  assert.match(html,/<fieldset class="outreach-permissions">/)
  assert.match(html,/旧版完成待办回访与情绪主动联系仍留待 P6/)
  assert.match(js,/\$\('social-enabled'\)\.checked=c\.socialOutreachEnabled===true/)
  assert.match(js,/socialVideoRecommendationsAuthorizedV2/)
  assert.match(js,/row\.status==='draft'&&!record\.paused&&row\.type==='interest-share'/)
})

test('公开评论情绪只附上既有生成片段，不多一次 AI 请求，重启后仍可看灰字',()=>temp(async dir=>{
  let invocations=0;let at=now
  const emotion=createEmotionalState({dataDir:dir,now:()=>at})
  const onEmotion=update=>emotion.update(update)
  const batcher=createInteractionBatcher({delayMs:1,invoke:async()=>{
    invocations++;return JSON.stringify({items:[{id:'0',action:'reply',reply:'海里躲斩击！',mood:'joyful',intensity:2}]})
  },getPersona:()=>'',onEmotion,onEmotionContext:x=>emotion.attachContext(x)})
  try{
    assert.equal(await batcher.generate({kind:'comment',uid:'11111',text:'宿傩的斩击怎么应对？'}),'海里躲斩击！')
    assert.equal(invocations,1)
    assert.equal(emotion.snapshot().history[0].preview.incoming,'宿傩的斩击怎么应对？')
    assert.equal(emotion.snapshot().history[0].preview.generated,'海里躲斩击！')
    const reloaded=createEmotionalState({dataDir:dir,now:()=>at})
    assert.equal(reloaded.snapshot().history[0].preview.generated,'海里躲斩击！')
    assert.ok(src('lib/management-console.js').includes('非发送回执'))
    const raw=readFileSync(join(dir,'life-memory','emotional-state.json'),'utf8')
    assert.doesNotMatch(raw,/"uid"|11111/)
  }finally{batcher.stop()}
}))

test('私信一轮摘要仅当前进程临时展示，重新加载文件不含私信或 UID',()=>temp(async dir=>{
  const mood=createEmotionalState({dataDir:dir,now:()=>now})
  const result=mood.update({mood:'warm',intensity:2,source:'dm'})
  mood.attachContext({at:result.at,source:'dm',incoming:'只给你看的私人话题',generated:'我听见了'})
  assert.equal(mood.snapshot().history[0].preview.incoming,'只给你看的私人话题')
  const raw=readFileSync(join(dir,'life-memory','emotional-state.json'),'utf8')
  assert.doesNotMatch(raw,/私人话题|我听见了|"preview"/)
  assert.equal(createEmotionalState({dataDir:dir,now:()=>now}).snapshot().history[0].preview,undefined)
}))

test('反思使用已有模型 note 摘要，评论敏感信息过滤，旧情绪记录仍兼容',()=>temp(async dir=>{
  const mood=createEmotionalState({dataDir:dir,now:()=>now})
  const first=mood.update({mood:'curious',intensity:1,source:'life-reflection',summary:'从真实的视频评论里产生了一点新的理解'})
  assert.equal(mood.snapshot().history[0].summary,'从真实的视频评论里产生了一点新的理解')
  const second=mood.update({mood:'joyful',intensity:1,source:'comment'})
  mood.attachContext({at:second.at,source:'comment',incoming:'我的手机号13800138000、密码abc123',generated:'收到'})
  assert.equal(mood.snapshot().history[0].preview.incoming,'[涉及私密内容，已隐藏]')
  assert.ok(first.at)
}))
