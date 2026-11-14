import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {memoryNeuralProjection} from '../lib/memory-neural-projection.mjs'
import {systemHealthSnapshot} from '../lib/system-health-projection.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'

const answer=value=>JSON.stringify({items:[{id:'0',action:'reply',reply:'回复',mood:'neutral',intensity:0,...value}]})
const input={kind:'comment',uid:'123456',bvid:'BV1AbCdEfGh2',incomingRpid:'123456789',verifiedCommentSource:true,
 text:'这条视频讨论怎么样？',availableContexts:['public_person'],canSkip:true}

test('神经记忆节点严格来自已留存记录，无关键词臆造连线，无封存/删除记录',()=>{
 const view=memoryNeuralProjection({gardenRows:[
  {id:'x',gardenKind:'experience',text:'讨论独立游戏',sourceIds:['event-source-1'],stage:'clear'},
  {id:'y',gardenKind:'interest',text:'跨日确实探索了独立游戏',sourceIds:['event-source-1'],stage:'fuzzy'},
  {id:'z',gardenKind:'relationship',text:'某次真实公开往来',sourceIds:['other-event']},
  {id:'deleted',gardenKind:'fact',text:'不应出现的旧记忆',deletedAt:'2026-01-02'},
  {id:'false',gardenKind:'interest',text:'独立游戏',sourceIds:['unrelated']},
 ]})
 assert.equal(view.nodes.length,4)
 assert.equal(view.edges.length,1)
 assert.equal(view.edges[0].type,'interest')
 assert.equal(JSON.stringify(view).includes('event-source-1'),false)
 assert.equal(JSON.stringify(view).includes('不应出现'),false)
 assert.equal(view.nodes.every(x=>!x.emotion),true)
})

test('检索无结果绝不绘制伪节点；只接受已有的当时情绪源',()=>{
 const x=memoryNeuralProjection({query:'从未存在的关键词',gardenRows:[{id:'x',text:'公开经历',gardenKind:'experience'}]})
 assert.deepEqual(x.nodes,[]);assert.deepEqual(x.edges,[])
 const y=memoryNeuralProjection({gardenRows:[
  {id:'a',text:'有情绪证据的经历',gardenKind:'experience',sourceIds:['mood-source'],emotionObservation:{sourceEventId:'mood-source',mood:'curious'}},
  {id:'b',text:'错误关联',gardenKind:'experience',emotionObservation:{sourceEventId:'unproven',mood:'sad'}}
 ]})
 assert.equal(y.nodes.find(v=>v.title.includes('有情绪'))?.emotion,'curious')
 assert.equal(y.nodes.find(v=>v.title.includes('错误'))?.emotion,'')
})

test('技术告警来自已有快照：-509 冷却、超时及网络重试，不增加新的网络请求',()=>{
 const now=Date.parse('2026-11-10T08:00:00Z')
 const health=systemHealthSnapshot({now,planner:{modelFailureCode:'timeout',modelRetryAt:now+120000},
  scheduler:{running:true,readBudget:{blocked:true,reason:'platform-cooldown',retryAt:now+60000},networkBackoff:{dm:{category:'network',streak:3,nextAt:now+90000}}}})
 assert.equal(health.state,'degraded')
 assert.ok(health.issues.some(x=>x.id==='model'&&x.code==='model-timeout'))
 assert.ok(health.issues.some(x=>x.id==='read'&&x.retryAt===now+60000))
 assert.ok(health.issues.some(x=>x.id==='network'))
 assert.equal(JSON.stringify(health).includes('UID'),false)
 const ok=systemHealthSnapshot({now,planner:{},scheduler:{running:true}})
 assert.equal(ok.state,'no-current-alert')
})

test('评论 Agent 提出额外公开投稿读取，Life 不愿意时不得执行网络读取，仍可决定正常回复',async()=>{
 let calls=0,reads=0,life=0
 const batcher=createInteractionBatcher({delayMs:1,getContextMode:()=> 'compact',getPersona:()=> 'Life Voice',logger:{warn(){}},
  prepareContexts:async()=>[{availableContexts:['public_person']}],
  authorizeContextRead:async()=>{life++;return {ok:false,reason:'life-declined'}},
  loadRequestedContexts:async()=>{reads++;return [{publicPersonContext:'不应读取'}]},
  invoke:async()=>++calls===1?answer({action:'skip',reply:'',contextRequests:['public_person']}):answer({reply:'这次先不看对方主页，直接聊视频'})})
 try{
  const r=await batcher.generate(input)
  assert.equal(r,'这次先不看对方主页，直接聊视频')
  assert.equal(life,1);assert.equal(reads,0)
 }finally{batcher.stop()}
})

test('评论 Agent 公开投稿读取获得 Life 选择后，继续受到真实执行器核验',async()=>{
 let calls=0,reads=0,life=0
 const batcher=createInteractionBatcher({delayMs:1,getContextMode:()=> 'compact',getPersona:()=> 'Life Voice',logger:{warn(){}},
  prepareContexts:async()=>[{availableContexts:['public_person']}],
  authorizeContextRead:async({row,readKinds})=>{life++;assert.equal(row.kind,'comment');assert.deepEqual(readKinds,['public_person']);return {ok:true,allowedReadKinds:['public_person']}},
  loadRequestedContexts:async()=>{reads++;return [{publicPersonContext:'已核验公开投稿 BV1AbCdEfGh2'}]},
  invoke:async()=>++calls===1?answer({action:'skip',reply:'',contextRequests:['public_person']}):answer({reply:'我看到了核验后的公开视频标题'})})
 try{const r=await batcher.generate(input);assert.equal(r,'我看到了核验后的公开视频标题');assert.equal(life,1);assert.equal(reads,1)}finally{batcher.stop()}
})


test('同时提议热门评论与对方公开投稿：Life 只选一个，绝不能跨越另一个的授权',async()=>{
 let calls=0,actual=[]
 const batcher=createInteractionBatcher({delayMs:1,getContextMode:()=> 'compact',getPersona:()=> 'Life Voice',logger:{warn(){}},
  prepareContexts:async()=>[{availableContexts:['hot_comments','public_person']}],
  authorizeContextRead:async({readKinds})=>{assert.deepEqual(readKinds,['hot_comments','public_person']);return {ok:true,allowedReadKinds:['hot_comments']}},
  loadRequestedContexts:async(_rows,kinds)=>{actual.push(kinds);return [{hotCommentsContext:'本轮热评已核验'}]},
  invoke:async()=>++calls===1?answer({action:'skip',reply:'',contextRequests:['hot_comments','public_person']}):answer({reply:'看完可核验热评后回复'})})
 try{assert.equal(await batcher.generate(input),'看完可核验热评后回复');assert.deepEqual(actual,[[['hot_comments']]])}
 finally{batcher.stop()}
})

test('模型请求热门评论但 Life 拒绝时不读取，回复 Agent 仍能选择停止或回答',async()=>{
 let calls=0,reads=0
 const batcher=createInteractionBatcher({delayMs:1,getContextMode:()=> 'compact',getPersona:()=> 'Life Voice',logger:{warn(){}},
  prepareContexts:async()=>[{availableContexts:['hot_comments']}],
  authorizeContextRead:async()=>({ok:false,reason:'voluntary-rest'}),
  loadRequestedContexts:async()=>{reads++;return [{hotCommentsContext:'不应调用'}]},
  invoke:async()=>++calls===1?answer({action:'skip',reply:'',contextRequests:['hot_comments']}):answer({reply:'依据已有评论内容答复'})})
 try{assert.equal(await batcher.generate(input),'依据已有评论内容答复');assert.equal(reads,0)}finally{batcher.stop()}
})

test('拒绝权限同时宣称 ok=true 但无选择范围，必须 fail-closed',async()=>{
 let calls=0,reads=0
 const batcher=createInteractionBatcher({delayMs:1,getContextMode:()=> 'compact',getPersona:()=> 'Life Voice',logger:{warn(){}},
  prepareContexts:async()=>[{availableContexts:['hot_comments']}],authorizeContextRead:async()=>({ok:true}),
  loadRequestedContexts:async()=>{reads++;return [{}]},
  invoke:async()=>++calls===1?answer({contextRequests:['hot_comments']}):answer({reply:'无需再读取'})})
 try{assert.equal(await batcher.generate(input),'无需再读取');assert.equal(reads,0)}finally{batcher.stop()}
})

test('管理器有意关闭监听时不能显示为故障',()=>{
 assert.equal(systemHealthSnapshot({scheduler:{running:false},schedulerExpected:false}).state,'no-current-alert')
 assert.equal(systemHealthSnapshot({scheduler:{running:false},schedulerExpected:true}).state,'degraded')
})
test('管理页的图谱与故障提示使用真实接口和可访问元素；公开投稿读取固定开启但仍有可信身份边界',()=>{
 const h=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(h,/neural-memory-svg/);assert.match(h,/neural-memory-results/);assert.match(h,/neural-show-emotion/);assert.match(h,/prefers-reduced-motion/)
 assert.match(js,/main-session\/memory\/neural/);assert.match(js,/life-agent\/system-health/)
 assert.match(index,/memoryNeuralProjection/);assert.match(index,/authorizeContextRead/)
 assert.match(index,/commentPublicProfileReadEnabled:true/)
})
