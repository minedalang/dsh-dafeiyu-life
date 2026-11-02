import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {intakeAiReadProposal} from '../lib/social-todo-intake.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
const T=Date.parse('2026-11-01T10:00:00Z'),BV='BV1mzso6uEZh'
const withHome=fn=>{const home=mkdtempSync(join(tmpdir(),'dev3-social-intake-'));try{fn(home)}finally{rmSync(home,{recursive:true,force:true})}}
const row=(messageId='m1',text='我最近对猫咪科普有点兴趣，有空可以了解一下')=>({incoming:true,senderUid:'522504190',messageId,timestampMs:T,text,senderName:'普通用户'})
const candidate=(evidence='我最近对猫咪科普有点兴趣，有空可以了解一下')=>({type:'search_videos',topic:'猫咪科普',title:'有空了解猫咪科普',evidence})
const decide=()=>({decision:'allow',score:90})
test('AI 同轮接受自然语言建议后才创建只读搜索待办；无关键词句式依赖',()=>withHome(home=>{
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 const result=intakeAiReadProposal({row:row(),channel:'dm',todoDisposition:'accept',suggestedTodo:candidate(),currentMessages:[row().text],decide,todos,now:()=>T})
 assert.equal(result.accepted,true);assert.equal(result.created,true)
 assert.equal(todos.list().length,1)
 const item=todos.list()[0]
 assert.equal(item.type,'search_videos');assert.equal(item.topic,'猫咪科普')
 assert.equal(item.source,'recommendation');assert.equal(item.ownerAuthorized,false)
 assert.equal(item.origin.kind,'bilibili-dm');assert.equal(item.origin.uid,'522504190')
 assert.equal(item.origin.quotedText,'')
 assert.ok(!readFileSync(join(home,'owner-todos.json'),'utf8').includes('我最近对猫咪科普'))
 const duplicate=intakeAiReadProposal({row:row(),channel:'dm',todoDisposition:'accept',suggestedTodo:{...candidate(),topic:'猫咪'},currentMessages:[row().text],decide,todos,now:()=>T})
 assert.equal(duplicate.duplicate,true);assert.equal(todos.list().length,1)
}))
test('AI defer/refuse/none 都不创建待办，也不调用后续意愿 gate',()=>withHome(home=>{
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T});let calls=0
 const gate=()=>{calls++;return {decision:'allow'}}
 for(const disposition of ['defer','refuse','none']){
  const result=intakeAiReadProposal({row:row('m-'+disposition),channel:'comment',todoDisposition:disposition,suggestedTodo:candidate(),currentMessages:[row().text],decide:gate,todos,now:()=>T})
  assert.equal(result.accepted,undefined);assert.ok(['model-defer','model-refuse','no-proposal'].includes(result.skipped))
 }
 assert.equal(calls,0);assert.equal(todos.list().length,0)
}))
test('主人以外的社交用户可用同一 AI intake；来源和时间仍须由平台事件验证',()=>withHome(home=>{
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 const base=row('c-1','我觉得无人机挺有意思，鱼鱼以后有空了解下')
 const proposal={type:'search_videos',topic:'无人机',evidence:'我觉得无人机挺有意思，鱼鱼以后有空了解下'}
 const ok=intakeAiReadProposal({row:{...base,senderUid:'123456'},channel:'comment',todoDisposition:'accept',suggestedTodo:proposal,currentMessages:[base.text],decide,todos,now:()=>T})
 assert.equal(ok.created,true);assert.equal(todos.list()[0].origin.kind,'bilibili-comment')
 const fake=intakeAiReadProposal({row:{...base,senderUid:''},channel:'dm',todoDisposition:'accept',suggestedTodo:proposal,currentMessages:[base.text],decide,todos,now:()=>T})
 assert.equal(fake.skipped,'unverified-event')
 const stale=intakeAiReadProposal({row:{...base,timestampMs:T-48*3600_000},channel:'dm',todoDisposition:'accept',suggestedTodo:proposal,currentMessages:[base.text],decide,todos,now:()=>T})
 assert.equal(stale.skipped,'unverified-event')
}))
test('AI 主题必须由当前原话或同一 UID 的近期用户原话支持',()=>withHome(home=>{
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 const base=row('m2','那首歌我之后想再了解一下')
 const proposal={type:'search_videos',topic:'孙燕姿的歌',evidence:base.text,contextEvidence:'我最近在听孙燕姿的歌'}
 const good=intakeAiReadProposal({row:base,channel:'dm',todoDisposition:'accept',suggestedTodo:proposal,currentMessages:[base.text],history:[{role:'user',uid:'522504190',at:T-60_000,text:'我最近在听孙燕姿的歌'}],decide,todos,now:()=>T})
 assert.equal(good.created,true)
 const other=createOwnerTodoEngine({dataDir:home,now:()=>T})
 const bad=intakeAiReadProposal({row:row('m3','那首歌我之后想再了解一下'),channel:'dm',todoDisposition:'accept',suggestedTodo:proposal,currentMessages:['那首歌我之后想再了解一下'],history:[{role:'user',uid:'111111',at:T-60_000,text:'我最近在听孙燕姿的歌'}],decide,todos:other,now:()=>T})
 assert.equal(bad.skipped,'context-evidence-not-in-same-user-history')
}))
test('拆分私信和常见错字由 AI 语义纠正，但证据必须来自真实当前消息',()=>withHome(home=>{
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 const messages=['有空听听陶喆的喝','歌']
 const result=intakeAiReadProposal({row:{...row('dm-2','有空听听陶喆的喝歌'),messageIds:['dm-1','dm-2']},channel:'dm',todoDisposition:'accept',
  suggestedTodo:{type:'search_videos',topic:'陶喆的歌',evidence:'有空听听陶喆的喝歌'},currentMessages:messages,decide,todos,now:()=>T})
 assert.equal(result.created,true);assert.equal(todos.list()[0].topic,'陶喆的歌')
 const wrong=intakeAiReadProposal({row:row('dm-3','有空听听陶喆的歌'),channel:'dm',todoDisposition:'accept',
  suggestedTodo:{type:'search_videos',topic:'周杰伦的歌',evidence:'有空听听陶喆的歌'},currentMessages:['有空听听陶喆的歌'],decide,todos:createOwnerTodoEngine({dataDir:home,now:()=>T}),now:()=>T})
 assert.equal(wrong.skipped,'topic-not-grounded-in-user-evidence')
}))
test('watch_video 只能引用真实消息、当前平台视频或已接收的 BV；写操作类型拒绝',()=>withHome(home=>{
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 const text='有空看看这个视频'
 const good=intakeAiReadProposal({row:{...row('c-bv',text),bvid:BV,rpid:7788,root:0},channel:'comment',todoDisposition:'accept',
  suggestedTodo:{type:'watch_video',bvid:BV,evidence:text},currentMessages:[text],decide,todos,now:()=>T})
 assert.equal(good.created,true);assert.equal(todos.list()[0].origin.commentRpid,7788)
 const unsafe=intakeAiReadProposal({row:row('m-like','有空给这个视频点赞'),channel:'dm',todoDisposition:'accept',
  suggestedTodo:{type:'like_video',bvid:BV,evidence:'有空给这个视频点赞'},currentMessages:['有空给这个视频点赞'],decide,todos,now:()=>T})
 assert.equal(unsafe.skipped,'unsupported-task-type')
}))
test('当前来源 UID、消息 ID、时间或 AI disposition 缺失时不得入队',()=>withHome(home=>{
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 for(const patch of [{senderUid:''},{messageId:''},{timestampMs:T+120_000}]){
  const result=intakeAiReadProposal({row:{...row(),...patch},channel:'dm',todoDisposition:'accept',suggestedTodo:candidate(),currentMessages:[row().text],decide,todos,now:()=>T})
  assert.equal(result.skipped,'unverified-event')
 }
 const noAi=intakeAiReadProposal({row:row(),channel:'dm',suggestedTodo:candidate(),currentMessages:[row().text],decide,todos,now:()=>T})
 assert.equal(noAi.skipped,'invalid-disposition');assert.equal(todos.list().length,0)
}))
test('生产入口从同一次社交 AI 输出 intake，不再在 AI 之前用正则解析任务',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const batch=readFileSync(new URL('../lib/interaction-batch.mjs',import.meta.url),'utf8')
 assert.match(source,/intakeAiReadProposal/)
 assert.match(source,/allowTodoIntake:true/)
 assert.match(batch,/onTodoProposal\(\{todoDisposition/)
 assert.doesNotMatch(source,/intakePublicReadProposal|parsePublicReadProposal|hasExplicitVideoRecommendation/)
 assert.match(source,/recommendationEligible=incoming\.filter/)
 assert.match(source,/receiveRecommendations\(stateDir,recommendationEligible\)/)
})

test('跨轮主题引用只允许同 UID 最近 24 小时内的原话',()=>withHome(home=>{
 const todos=createOwnerTodoEngine({dataDir:home,now:()=>T})
 const text='那首歌我之后想再了解一下'
 const result=intakeAiReadProposal({row:row('m-old',text),channel:'dm',todoDisposition:'accept',
  suggestedTodo:{type:'search_videos',topic:'孙燕姿的歌',evidence:text,contextEvidence:'我最近在听孙燕姿的歌'},
  currentMessages:[text],history:[{role:'user',uid:'522504190',at:T-25*3600_000,text:'我最近在听孙燕姿的歌'}],decide,todos,now:()=>T})
 assert.equal(result.skipped,'context-evidence-not-in-same-user-history')
}))
