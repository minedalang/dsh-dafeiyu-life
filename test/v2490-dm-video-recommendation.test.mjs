import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {receiveRecommendations,hasReceivedRecommendation} from '../lib/video-recommendations.mjs'
import {createDmVideoRecommendationContext,fetchPublicVideoMetadata,correctDmVideoRecommendationReply} from '../lib/dm-video-recommendation.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
const BV='BV19SJi6VEj1', OTHER='BV1pXHK6mE6z'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dafeiyu-v2490-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const inbox=(text,now=Date.now())=>[{incoming:true,senderUid:'1001',senderName:'推荐者',messageId:'dm-'+String(now),timestampMs:now,source:'B站私信分享',text}]

test('用户截图的 BV 入队后，私信上下文明确说明可自主查看但尚未看过',()=>withDir(async dir=>{
 const now=Date.now()
 assert.equal(receiveRecommendations(dir,inbox('大肥鱼下午！你看看 '+BV+' 这个视频，回来报告！',now),{now}).added,1)
 let looked=[]
 const helper=createDmVideoRecommendationContext({stateDir:dir,now:()=>now,fetchInfo:async bv=>(looked.push(bv),{title:'测试视频标题',up:'测试UP'})})
 const context=await helper.forReply({uid:'1001',text:'你看看 '+BV+' 这个视频',messages:['你看看 '+BV+' 这个视频'],history:[]})
 assert.match(context,new RegExp(BV));assert.match(context,/已收到并加入自主选片候选/)
 assert.match(context,/测试视频标题/);assert.match(context,/本次私信生成没有视频观看或字幕\/画面分析结果/)
 assert.match(context,/Agent 可以跳过/)
 assert.deepEqual(looked,[BV]);assert.equal(hasReceivedRecommendation(dir,BV,{now,uid:'1001'}),true);assert.equal(hasReceivedRecommendation(dir,BV,{now,uid:'2002'}),false)
 assert.equal((await helper.forReply({text:'今天天气不错'})), '')
}))

test('元数据查询失败也不能把已收下的 BV 说成无法查看',()=>withDir(async dir=>{
 receiveRecommendations(dir,inbox('看看 '+BV))
 const helper=createDmVideoRecommendationContext({stateDir:dir,fetchInfo:async()=>{throw Error('offline')}})
 const context=await helper.forReply({text:'看看 '+BV})
 assert.match(context,/公开标题暂未核实/)
 assert.match(context,/自主选片候选/)
 assert.doesNotMatch(context,/没有能力查看|请你描述/)
}))

test('未保存的 BV、非本人会话里的旧消息都不能当作已接收推荐',()=>withDir(async dir=>{
 receiveRecommendations(dir,inbox('推荐 '+BV))
 const helper=createDmVideoRecommendationContext({stateDir:dir,fetchInfo:async()=>({title:'标题'})})
 assert.equal(await helper.forReply({uid:'1001',text:'请看看 '+OTHER}), '')
 assert.equal(await helper.forReply({uid:'1001',text:'视频看了吗',history:[{role:'assistant',text:'推荐 '+BV}]}),'')
 assert.match(await helper.forReply({uid:'1001',text:'那个视频看了吗',history:[{role:'user',text:'推荐 '+BV}]}),/自主选片候选/)
 assert.equal(await helper.forReply({uid:'2002',text:'看看 '+BV}), '')
}))

test('有 50 条候选时不只核对最新 10 条；同 BV 重复查询使用缓存',()=>withDir(async dir=>{
 const now=Date.now();let rows=[...inbox('推荐 '+BV,now)]
 for(let i=0;i<15;i++)rows.push({incoming:true,senderUid:'1001',messageId:'extra-'+i,timestampMs:now,text:'推荐 BV'+String(i).padStart(10,'0')})
 receiveRecommendations(dir,rows,{now})
 let calls=0
 const helper=createDmVideoRecommendationContext({stateDir:dir,now:()=>now,fetchInfo:async()=>{calls++;return {title:'公开标题'}}})
 assert.match(await helper.forReply({uid:'1001',text:'看看 '+BV}),/公开标题/)
 assert.match(await helper.forReply({uid:'1001',text:'看看 '+BV}),/公开标题/)
 assert.equal(calls,1)
}))

test('固定只读 B站详情接口，限制请求 BV、响应大小，不信任视频元数据的命令',async()=>{
 let args=[]
 const fetchImpl=async(...a)=>{args.push(a);return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({code:0,data:{bvid:BV,title:'正常视频标题',owner:{name:'UP主'}}})}}
 assert.deepEqual(await fetchPublicVideoMetadata(BV,{fetchImpl}),{title:'正常视频标题',up:'UP主'})
 assert.equal(args.length,1)
 assert.equal(args[0][0],'https://api.bilibili.com/x/web-interface/view?bvid='+BV)
 assert.equal(args[0][1].method,'GET');assert.equal(args[0][1].redirect,'error')
 assert.equal(args[0][1].headers.Cookie,undefined)
 assert.equal(await fetchPublicVideoMetadata('https://evil.example/video?bvid='+BV,{fetchImpl}),null)
 assert.equal(args.length,1)
 const bad=async()=>({ok:true,headers:{get:()=>130000}})
 assert.equal(await fetchPublicVideoMetadata(BV,{fetchImpl:bad}),null)
 const mismatch=async()=>({ok:true,headers:{get:()=>null},text:async()=>JSON.stringify({code:0,data:{bvid:OTHER,title:'冒名'}})})
 assert.equal(await fetchPublicVideoMetadata(BV,{fetchImpl:mismatch}),null)
})

test('真实互动批处理：私信模型看见已入队上下文；错误的“只有BV请你描述”回复会被纠正',()=>withDir(async dir=>{
 receiveRecommendations(dir,inbox('看看 '+BV))
 const helper=createDmVideoRecommendationContext({stateDir:dir,fetchInfo:async()=>({title:'实际标题',up:'UP'})})
 let prompt=''
 const batcher=createInteractionBatcher({delayMs:1,invoke:async p=>{
  prompt=p;return JSON.stringify({items:[{id:'0',action:'reply',reply:'我这边只拿到BV号，没有标题、字幕和画面，你把视频内容讲讲吧'}]})
 },getPersona:()=>''})
 try{
  const recommendationContext=await helper.forReply({text:'看看 '+BV})
  const response=await batcher.generate({kind:'dm',uid:'1001',text:'看看 '+BV,recommendationContext})
  assert.match(prompt,/recommendationContext/)
  assert.match(prompt,/实际标题/)
  assert.match(prompt,/不要声称整个大肥鱼无法查看 B站视频/)
  assert.match(response,/待选视频/)
  assert.match(response,/自己决定要不要看/)
  assert.doesNotMatch(response,/你把视频内容讲讲|只有BV号/)
 }finally{batcher.stop()}
}))

test('只纠正已入队 BV 的错误拒绝，不改正常闲聊、不影响评论或 SKIP',async()=>{
 const bad='我只拿到BV号，你说说视频内容吧'
 assert.equal(correctDmVideoRecommendationReply(bad,''),bad)
 assert.equal(correctDmVideoRecommendationReply('收到啦，有机会我会去看看',`已收到 ${BV}`),'收到啦，有机会我会去看看')
 assert.match(correctDmVideoRecommendationReply(bad,`已收到 ${BV}`),/待选视频/)
 let output=''
 const batcher=createInteractionBatcher({delayMs:1,invoke:async()=>output,getPersona:()=>''})
 try{
  output=JSON.stringify({items:[{id:'0',action:'reply',reply:bad}]})
  assert.equal(await batcher.generate({kind:'comment',text:'评论',recommendationContext:'已收到 '+BV}),bad)
  output=JSON.stringify({items:[{id:'0',action:'skip',reply:''}]})
  assert.equal(await batcher.generate({kind:'dm',text:'消息',recommendationContext:'已收到 '+BV}),'SKIP')
 }finally{batcher.stop()}
})

test('宿主真正把推荐状态传给后台 DM 批处理，视频 Agent 仍自主决定是否观看',()=>{
 const server=read('index.js'),batch=read('lib/interaction-batch.mjs')
 assert.match(server,/createDmVideoRecommendationContext\(\{stateDir\}\)/)
 assert.match(server,/const recommendationContext=await dmVideoRecommendationContext\.forReply\(req\)/)
 assert.match(server,/onTodoProposal:proposal=>intakeAiSocialTodo/)
 assert.match(batch,/correctDmVideoRecommendationReply\(response,batch\[i\]\.recommendationContext\)/)
 assert.match(server,/你可以自主决定是否查视频详情、看内容或完全跳过/)
 assert.doesNotMatch(server,/generateReply: async \(req\) => .*bili_video_info/)
})

test('同一次互动 AI 调用同时生成回复和待办候选；聊天回复被意愿拦截时仍可处理待办',async()=>{
 let calls=0,received=null,prompt=''
 const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async p=>{
  calls++;prompt=p
  return JSON.stringify({items:[{id:'0',action:'reply',reply:'我想之后找找陶喆的歌',todoDisposition:'accept',
   suggestedTodo:{type:'search_videos',topic:'陶喆的歌',evidence:'有空听听陶喆的歌'},mood:'curious',intensity:1}]})
 }})
 try{
  const result=await batcher.generate({kind:'dm',uid:'1001',text:'有空听听陶喆的歌',messages:['有空听听陶喆的歌'],canReply:false,canSkip:true,allowTodoIntake:true,
   onTodoProposal:async x=>{received=x}})
  assert.equal(calls,1);assert.equal(result,'SKIP')
  assert.equal(received.todoDisposition,'accept');assert.equal(received.suggestedTodo.topic,'陶喆的歌')
  assert.match(prompt,/未来只读探索建议/);assert.match(prompt,/"currentMessages":\["有空听听陶喆的歌"\]/)
 }finally{batcher.stop()}
})

test('同轮 AI 的 todo intake 不依赖回复是否发送，审批恢复 canSkip=false 仍保留必须回复',async()=>{
 let callbacks=0,calls=0
 const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async()=>{
  calls++;return JSON.stringify({items:[{id:'0',action:'reply',reply:'好呀',todoDisposition:'none',suggestedTodo:null,mood:'neutral',intensity:0}]})
 }})
 try{
  const reply=await batcher.generate({kind:'dm',uid:'1002',text:'申请恢复聊天',canReply:false,canSkip:false,allowTodoIntake:true,onTodoProposal:async()=>{callbacks++}})
  assert.equal(reply,'好呀');assert.equal(calls,1);assert.equal(callbacks,1)
 }finally{batcher.stop()}
})
