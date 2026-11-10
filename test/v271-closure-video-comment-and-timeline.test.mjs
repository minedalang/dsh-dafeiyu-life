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

test('未经 Life 评论意愿决策的顶层直接写入必须拒绝，不能触发模型或发送',async t=>{
 for(const reason of ['主观想评论','草稿已准备']){
  let callCount=0
  const bridge=createLifeVideoActionBridge({getAccountUid:()=>UID,getAccountTag:()=>TAG,
   choose:async()=>{callCount++;return {ok:true}},verify:()=>({ok:false}),receipt:()=>assert.fail('no receipt')})
  await bridge.start();t.after(()=>bridge.stop())
  const outcome=await post(bridge)
  assert.equal(outcome.status,409)
  assert.equal(outcome.body.reason,'comment-review-not-current')
  assert.equal(callCount,0)
  assert.equal(bridge.status().pending,0)
 }
})

test('旧式直接发送不允许借用意愿模型审批；必须由视频入选后的考虑接口先决定',async t=>{
 let calls=0
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>UID,getAccountTag:()=>TAG,
  choose:async()=>{calls++;return {ok:true,proof:{id:'test'}}},verify:()=>({ok:true}),receipt:()=>assert.fail('no grant')})
 t.after(()=>bridge.stop());await bridge.start()
 const result=await post(bridge)
 assert.equal(result.status,409)
 assert.equal(result.body.reason,'comment-review-not-current')
 assert.equal(bridge.status().pending,0)
 assert.equal(calls,0)
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
 assert.match(js,/life-independent/)
 assert.match(js,/日期记录（时间未知）/)
 assert.match(js,/row\.detail/)
 assert.match(html,/life-continuity-layout/)
})


test('视频写入审批必须使用受支持的 Life 人格场景；评论使用 comment，其他写操作使用 main',async t=>{
 const cases=[
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
  const response=await fetch(env.BILI_LIFE_ACTION_URL+'/life-action',{
   method:'POST',headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},
   body:JSON.stringify(payload)})
  assert.equal(response.status,409)
  assert.deepEqual(await response.json(),{ok:false,reason:'life-declined-video-action'})
  assert.equal(chosen?.candidates[0].kind,({bili_video_like:'video_like',bili_video_collect:'video_collect',bili_follow_creator:'video_follow',
     bili_unfollow_creator:'video_unfollow',bili_favorite_folder_delete:'video_folder_delete'})[tool])
  assert.equal(bridge.status().pending,0,'a model decline never grants a send')
 }
})


test('视频评论调试回执包含安全的阻断原因码，而非只有总括性 technically-blocked',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(index,/diagnostic\.blocked>0\|\|diagnostic\.proposed>0/)
 assert.match(index,/reason:commentDiagnostics\.lastReason/)
})

test('Life 时间线明确展示自主休息，但不把休息伪装成已执行动作',()=>{
 const rows=buildLifeTimeline({now:T+100,days:7,lifeDecisions:[
  {at:T,mode:'active',action:'skip',result:'voluntary-rest',failed:false,eventRefs:['a'.repeat(16)]},
  {at:T-1000,mode:'active',action:'skip',result:'model-or-execution-error',failed:true,eventRefs:['b'.repeat(16)]}
 ]})
 assert.equal(rows.length,1)
 assert.equal(rows[0].type,'life-rest')
 assert.equal(rows[0].label,'自主休息')
 assert.match(rows[0].title,/决定暂时休息/)
 assert.match(rows[0].detail,/没有执行外部动作/)
})

test('Life Planner 已作出 browse_home 意愿选择后，执行层不再发起第二次 AI 意愿审批',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const start=index.indexOf("const lifeCapabilities=createLifeCapabilities")
 const end=index.indexOf("const lifeDecisionTrace=createLifeDecisionTrace",start)
 const block=index.slice(start,end)
 assert.ok(start>=0&&end>start)
 assert.doesNotMatch(block,/lifeWillingness\?\.decide\(/)
 assert.match(block,/technical\/privacy checks/)
 assert.match(block,/return runDuty\('life-agent'/)
})

test('Life timeline includes verified Episode actions that have no legacy event row, without exposing private targets',()=>{
 const rows=buildLifeTimeline({now:T+100,days:7,episodes:[{id:'a'.repeat(24),seriesId:'b'.repeat(24),history:[
  {action:'dm_reply',outcome:'verified',channel:'dm',at:T-3000},
  {action:'dynamic_post',outcome:'verified',channel:'dynamic',at:T-2000},
  {action:'video_like',outcome:'verified',channel:'video-agent',at:T-1000},
  {action:'dm_reply',outcome:'unknown',channel:'dm',at:T}
 ]}]})
 assert.equal(rows.length,3)
 assert.deepEqual(rows.map(x=>x.title).sort(),['发布了一条动态','回复了一条私信','给一条视频点了赞'].sort())
 assert.doesNotMatch(JSON.stringify(rows),/b{24}|uid|BV1/)
})

test('视频 Agent 时间线同时显示真实进程启动和结束，不把启动说成观看',()=>{
 const start=T-60_000,end=T
 const rows=buildLifeTimeline({now:T+100,days:7,videoRounds:[{source:'life-agent',ref:'d'.repeat(12),state:'completed',startedAt:start,endedAt:end,pickedCount:2}]})
 assert.equal(rows.length,2)
 assert.equal(rows.find(x=>x.type==='video-round-start')?.at,new Date(start).toISOString())
 assert.match(rows.find(x=>x.type==='video-round-start').detail,/不代表视频已经观看/)
 assert.equal(rows.find(x=>x.type==='video-round')?.at,new Date(end).toISOString())
})
