/**
 * Reproducible OFFLINE conversational simulations. No real DSH model or B站
 * message is invoked. The assertions inspect the ACTUAL final model prompts
 * and safety/read contracts, not the quality of the model's sampled prose.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {composeLifeVoiceContext} from '../lib/life-voice-context.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {buildTrustedSocialPrompt} from '../lib/comment-social-ai.mjs'
import {buildOwnerSocialCommentPrompt} from '../lib/owner-comment-social.mjs'
import {buildOwnerCommentDraftPrompt} from '../lib/owner-comment-draft.mjs'
import {lifeFactsFromCompletedTodos,currentLifeFactView,verifyLifeOutbound} from '../lib/verified-life-facts.mjs'

const source=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')
const p={
  persona:'主人人设标识：鱼鱼有点傲娇，但会认真听别人说话；不喜欢客服式套话。',
  lore:'世界观标识：爱冒泡的鲸鱼少女，在B站有自己的生活。',
  growth:'认可成长标识：比过去更耐心，尊重不同想法。',
  personality:'个性成长标识：好奇时敢追问，累了会适时沉默。',
  emotion:'连续情绪标识：当前开心，但只表示说话节奏。',
  relationship:'关系阶段标识：这是相识很久的朋友，不等于授权。',
}
const marks=Object.values(p)
const voice=(scene,overrides={},maxChars=2700)=>composeLifeVoiceContext({scene,...p,...overrides,maxChars})
const requireSections=x=>{for(const v of marks)assert.ok(x.includes(v),`漏掉统一角色片段：${v}`)}

// 7 external/main language scenes × 4 mood states × 3 relationship states ×
// 3 task states. The task state is kept OUTSIDE the identity field by design.
test('252 种渠道／情绪／关系／任务组合保留同一身份，事实与人设分离',()=>{
 const scenes=['dm','owner-dm','comment','todo-followup','social-share','dynamic','main']
 const moods=['开心','低落','疲惫','烦躁']
 const relations=['主人','熟悉朋友','普通用户']
 const tasks=['未提出','待执行','已核验完成']
 let count=0
 for(const scene of scenes)for(const mood of moods)for(const rel of relations)for(const task of tasks){
   const x=voice(scene,{emotion:p.emotion+`当前心情=${mood}`,relationship:p.relationship+`对象=${rel}`},2700)
   requireSections(x)
   assert.match(x,/当前心情=/)
   assert.match(x,/对象=/)
   assert.ok(x.length<=2700)
   assert.ok(!x.includes(`任务=${task}`),'任务事实不能注入人格')
   assert.ok(x.includes('不同渠道只是面对不同对象和场景'))
   count++
 }
 assert.equal(count,252)
})

test('极长的主人基础人设不会挤掉末尾的成长、当前心情及同一人的关系',()=>{
 for(const scene of ['comment','owner-dm','dm','todo-followup','social-share','dynamic','main']){
   const x=voice(scene,{persona:p.persona+'自定义设定'.repeat(2500),lore:p.lore+'背景'.repeat(300)},scene==='owner-dm'?5200:2700)
   assert.ok(x.includes(p.growth),scene+' growth')
   assert.ok(x.includes(p.personality),scene+' personality')
   assert.ok(x.includes(p.emotion),scene+' emotion')
   assert.ok(x.includes(p.relationship),scene+' relationship')
 }
})

test('私信和普通评论实际批次提示词收到六类人格；跨 UID / 公私消息不合并',async()=>{
 const prompts=[]
 const batcher=createInteractionBatcher({delayMs:1,batchSize:8,
   getPersona:batch=>voice(batch[0].kind==='comment'?'comment':'dm',
     {relationship:p.relationship+'只对 '+batch[0].uid+' 可见'},2700),
   prepareContexts:async batch=>batch.map(x=>({memoryContext:'仅给'+x.uid+'的私人背景',relationshipContext:'此对象 '+x.uid,lifeStateContext:'当前角色心情：开心'})),
   invoke:async prompt=>{
     prompts.push(prompt)
     return JSON.stringify({items:[{id:'0',action:'reply',reply:'鱼鱼听见啦～',todoDisposition:'none',suggestedTodo:null,mood:'curious',intensity:1}]})
   },logger:{warn:e=>{throw Error(String(e))}}
 })
 try{
   const rows=[{kind:'dm',uid:'12345',text:'你好',canSkip:false},
     {kind:'comment',uid:'67890',text:'你今天开心吗',canSkip:false},
     {kind:'dm',uid:'24680',text:'听说你接了个待办？',canSkip:false}]
   const responses=await Promise.all(rows.map(x=>batcher.generate(x)))
   assert.equal(responses.length,3)
   assert.equal(prompts.length,3)
   for(const text of prompts)requireSections(text)
   for(const uid of rows.map(x=>x.uid)){
     const own=prompts.find(x=>x.includes('只对 '+uid+' 可见'))
     assert.ok(own,uid)
     for(const other of rows.map(x=>x.uid).filter(id=>id!==uid)){
       assert.ok(!own.includes('只对 '+other+' 可见'))
       assert.ok(!own.includes('仅给'+other+'的私人背景'))
     }
   }
 }finally{batcher.stop()}
})

test('评论意愿、评论成品和主人评论草稿三个模型提示都收到完整的当前人格',()=>{
 const style=voice('comment',{},2700)
 const main=buildTrustedSocialPrompt({row:{bvid:'BV1EYxt6yE7P',text:'鱼鱼，来看看'},role:'friend',style,emotion:{energy:60,sociality:60}})
 const social=buildOwnerSocialCommentPrompt({video:{title:'某个视频'},invitation:'来看看',style,canPublish:false})
 const draft=buildOwnerCommentDraftPrompt({bvid:'BV1EYxt6yE7P',title:'某个视频'},{style})
 for(const [kind,prompt] of Object.entries({main,social,draft})){
   for(const mark of marks)assert.ok(prompt.includes(mark),kind+': '+mark)
 }
})

test('主人私信的主角色输入被预先按预算装配，不在末尾二次切掉关系',()=>{
 const x=voice('owner-dm',{persona:p.persona+'长人设'.repeat(2000)},5200)
 requireSections(x)
 const index=source('index.js')
 assert.match(index,/getPersona:\(\)=>lifeVoiceContext\(\{scene:'owner-dm',[^\n]*maxChars:5200\}/)
 assert.match(source('lib/owner-dm-agent.mjs'),/scrub\(getPersona\(\),5500\)/)
})

test('完成回执在回访发送前即可读取，但不同 UID、不同渠道不得串用',()=>{
 const at=Date.now()-20_000
 const done={id:'todo-a',type:'watch_video',status:'done',bvid:'BV1EYxt6yE7P',completedAt:at,
   origin:{uid:'12345',kind:'bilibili-dm'},history:[{to:'done',reason:'收到成功回执'}]}
 const events=lifeFactsFromCompletedTodos([done],{uid:'12345'})
 assert.ok(events.some(e=>e.type==='todo_read_completed'))
 assert.ok(events.some(e=>e.type==='video_metadata_read'))
 assert.ok(currentLifeFactView(events,{uid:'12345',channel:'dm'}).length>=2)
 assert.equal(currentLifeFactView(events,{uid:'67890',channel:'dm'}).length,0)
 assert.equal(currentLifeFactView(events,{uid:'12345',channel:'comment'}).length,0)
 assert.equal(verifyLifeOutbound('我亲耳听完这首歌了',{uid:'12345',channel:'dm',events}).ok,false)
 assert.equal(verifyLifeOutbound('我刚查了一下这条视频，但没有完整听过歌曲',{uid:'12345',channel:'dm',events}).ok,true)
})

test('源码中 7 类自动对外路径共用人格核心；评论链路无旧版180/260字二次压缩',()=>{
 const index=source('index.js')
 for(const scene of ['owner-dm','dm','comment','todo-followup','social-share','dynamic','main'])
   assert.ok(index.includes("scene:'"+scene+"'"),scene)
 assert.ok(index.includes("maxChars:scene==='comment'?2700:2900"))
 assert.match(index,/const uid=oneRecipient\?String\(batch\[0\]\.uid\|\|''\):''/)
 assert.match(source('lib/comment-social-ai.mjs'),/clean\(style,3000\)/)
 assert.match(source('lib/owner-comment-social.mjs'),/slice\(0,3000\)/)
 assert.match(source('lib/owner-comment-draft.mjs'),/buildOwnerCommentDraftPrompt\(video,\{style\}\)/)
})

test('同一 UID 的两条连发消息仍是一条鱼，关系和成长风格不可因为批处理消失',async()=>{
 const seen=[]
 const batcher=createInteractionBatcher({delayMs:15,batchSize:8,
   getPersona:batch=>voice('dm',{relationship:p.relationship+`本次对象=${batch[0].uid}`},2700),
   invoke:async prompt=>{
     seen.push(prompt)
     return JSON.stringify({items:[0,1].map(i=>({id:String(i),action:'reply',reply:'鱼鱼在呢～',todoDisposition:'none',mood:'warm',intensity:1}))})
   }
 })
 try{
   const result=await Promise.all([
     batcher.generate({kind:'dm',uid:'12345',text:'你还记得我吗',canSkip:false}),
     batcher.generate({kind:'dm',uid:'12345',text:'刚刚我们说到哪儿了',canSkip:false}),
   ])
   assert.equal(result.length,2)
   assert.equal(seen.length,1)
   assert.ok(seen[0].includes('本次对象=12345'))
   requireSections(seen[0])
 }finally{batcher.stop()}
})
