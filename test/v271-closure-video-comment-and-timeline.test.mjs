import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createLifeVideoActionBridge} from '../lib/life-video-action-bridge.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
import {composeLifeVoiceContext} from '../lib/life-voice-context.mjs'

const UID='12345678',TAG='a'.repeat(16),BV='BV1abcde1234'
const T=Date.parse('2026-11-09T09:11:06Z')
const post=async(bridge)=>{
 const env=bridge.env()
 const r=await fetch(env.BILI_LIFE_ACTION_URL+'/life-action',{
  method:'POST',headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},
  body:JSON.stringify({uid:UID,tool:'bili_reply',target:BV,reason:'想和视频作者讨论一下',commentText:'这段有意思，我想问问作者怎么看？',topLevel:true})
 })
 return {status:r.status,body:await r.json()}
}

test('Life 自主拒绝与技术暂不可用要区分，二者都不给可执行发送 grant',async t=>{
 for(const [decision,expected,stage] of [
   [{ok:false,reason:'life-declined-video-action'},'life-declined-video-action','declined'],
   [{ok:false,reason:'life-not-ready'},'life-not-ready','blocked'],
   [{ok:false,reason:'life-cross-channel-rest',notBefore:T+60_000},'life-cross-channel-rest','blocked']
 ]){
  const diagnostics=[]
  const bridge=createLifeVideoActionBridge({getAccountUid:()=>UID,getAccountTag:()=>TAG,
   choose:async()=>decision,verify:()=>({ok:false}),receipt:()=>assert.fail('must not consume receipt'),
   onCommentDiagnostic:x=>diagnostics.push(x),now:()=>T})
  await bridge.start();t.after(()=>bridge.stop())
  const result=await post(bridge)
  assert.equal(result.status,409)
  assert.deepEqual(result.body,{ok:false,reason:expected})
  assert.equal(bridge.status().pending,0)
  assert.equal(diagnostics.find(x=>x.stage===stage)?.code,expected)
 }
})

test('意愿同意但 proof 复核失败时不放宽发送，只报告 proof 异常',async t=>{
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>UID,getAccountTag:()=>TAG,
  choose:async()=>({ok:true,proof:{id:'test'}}),verify:()=>({ok:false}),receipt:()=>assert.fail('no grant')})
 t.after(()=>bridge.stop());await bridge.start()
 const result=await post(bridge)
 assert.equal(result.status,409)
 assert.equal(result.body.reason,'life-choice-review-required')
 assert.equal(bridge.status().pending,0)
})

test('生活时间线如实显示评论意愿与阻断，不把未发出的草稿写成公开评论',()=>{
 const rounds=[
  {source:'life-agent',ref:'aaaaaaaaaaaa',state:'completed',endedAt:T,pickedCount:1,commentGate:'configured',
   commentDiagnostics:{reviewed:1,passed:1}},
  {source:'life-agent',ref:'bbbbbbbbbbbb',state:'completed',endedAt:T-60_000,pickedCount:1,commentGate:'configured',
   commentDiagnostics:{reviewed:1,wanted:1,proposed:1,blocked:1,lastReason:'life-not-ready'}},
  {source:'life-agent',ref:'cccccccccccc',state:'completed',endedAt:T-120_000,pickedCount:1,commentGate:'configured',
   commentDiagnostics:{reviewed:1,wanted:1,proposed:1,verified:1}}
 ]
 const rows=buildLifeTimeline({now:T+100,videoRounds:rounds,days:7})
 assert.equal(rows.length,3)
 assert.match(rows[0].detail,/决定不发表主评论/)
 assert.match(rows[1].detail,/执行或 Life 审批被阻断/)
 assert.match(rows[2].detail,/通过平台独立核验/)
 assert.ok(rows.every(x=>x.type==='video-round'&&!x.bvid&&!x.url))
 const text=JSON.stringify(rows)
 assert.doesNotMatch(text,/12345678|commentText|评论草稿|私信正文/)
})

test('管理中心把只有日期的看过视频按天归组，不凭空给每条视频安上具体时间',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(js,/life-timeline-date-only/)
 assert.match(js,/原始账本没有逐条时间/)
 assert.match(js,/row\.detail/)
 assert.match(html,/旧判重表只有日期的视频折叠在当日记录中/)
})


test('视频写入审批必须使用受支持的 Life 人格场景；评论使用 comment，其他写操作使用 main',async t=>{
 const cases=[
  ['bili_reply',BV,'comment'],
  ['bili_video_like',BV,'main'],
  ['bili_video_collect',BV,'main'],
  ['bili_follow_creator',BV,'main'],
  ['bili_unfollow_creator',UID,'main'],
  ['bili_favorite_folder_delete',UID,'main']
 ]
 // This invalid scene was the reproducible root of life-base-identity-unavailable.
 assert.throws(()=>composeLifeVoiceContext({scene:'video-agent',persona:'大肥鱼'}),/未知人格场景/)
 for(const [tool,target,expectedScene] of cases){
  let chosen=null
  const bridge=createLifeVideoActionBridge({getAccountUid:()=>UID,getAccountTag:()=>TAG,
   choose:async input=>{
    chosen=input
    assert.equal(input.scene,expectedScene)
    assert.match(composeLifeVoiceContext({scene:input.scene,persona:'大肥鱼'}),/大肥鱼/)
    return {ok:false,reason:'life-declined-video-action'}
   },verify:()=>assert.fail('no proof'),receipt:()=>assert.fail('no send')})
  await bridge.start();t.after(()=>bridge.stop())
  const env=bridge.env()
  const payload={uid:UID,tool,target,reason:'明确需要先核验 Life 意愿'}
  if(tool==='bili_reply')Object.assign(payload,{topLevel:true,commentText:'这条内容我有一个具体问题。'})
  const response=await fetch(env.BILI_LIFE_ACTION_URL+'/life-action',{
   method:'POST',headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},
   body:JSON.stringify(payload)})
  assert.equal(response.status,409)
  assert.deepEqual(await response.json(),{ok:false,reason:'life-declined-video-action'})
  assert.equal(chosen?.candidates[0].kind,tool==='bili_reply'?'video_comment':
   ({bili_video_like:'video_like',bili_video_collect:'video_collect',bili_follow_creator:'video_follow',
     bili_unfollow_creator:'video_unfollow',bili_favorite_folder_delete:'video_folder_delete'})[tool])
  assert.equal(bridge.status().pending,0,'a model decline never grants a send')
 }
})


test('视频评论调试回执包含安全的阻断原因码，而非只有总括性 technically-blocked',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(index,/diagnostic\.blocked>0&&commentDiagnostics\?\.lastReason/)
 assert.match(index,/reason:commentDiagnostics\.lastReason/)
})
