import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {buildVideoExplorationEvent} from '../lib/video-experience.mjs'
import {naturalFollowupText,liveExperienceEvidence} from '../lib/life-experience-continuity.mjs'
import {preparePrivateSelfExperience,preparePrivateLifeEvent} from '../lib/life-private-policy.mjs'
import {createOwnerTodoFollowup} from '../lib/owner-todo-followup.mjs'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'

const T=Date.parse('2026-11-02T12:00:00Z'),uid='123456789',bv='BV1abc234567'
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-continuity-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const settings=()=>({masterEnabled:true,ownerTodoCompletionFollowupEnabled:true,dmOwnerUid:uid,ownerTodoFollowupQuietEnabled:false,ownerTodoFollowupCooldownMinutes:0,ownerTodoFollowupMinIntervalMinutes:0})
const task={id:'t1',type:'watch_video',bvid:bv,title:'孙燕姿的歌',topic:'孙燕姿',origin:{kind:'owner-dm',uid,messageId:'msg01'},sourceKey:'manual:one'}

test('所有公开视频查看入口共用衰减经历，可信自主待办只记录缘由类别、不写入私信原话',()=>withDir(async dir=>{
 const memory=createLifeMemoryGateway({dataDir:dir,now:()=>T})
 const event=buildVideoExplorationEvent({bvid:bv,info:{title:'孙燕姿相关作品'},source:'bili-life',purpose:'accepted-todo',operationId:'verified-0001',at:T})
 assert.ok(event)
 memory.recordEvents([event])
 const result=memory.recall({query:'孙燕姿',domain:'bili-dm',role:'owner',actorUid:uid})
 assert.equal(result.length,1)
 assert.match(result[0].summary,/接受了一项探索建议/)
 assert.doesNotMatch(result[0].summary,/我听了|好听|具体私信/)
 memory.close()
}))

test('连续经历只从仍清晰的衰减副本取证，不读取任务或永久档案；已遗忘不能重建',()=>withDir(async dir=>{
 let clock=T
 const memory=createLifeMemoryGateway({dataDir:dir,now:()=>clock,getConfig:()=>({mainSessionMemoryHalfLifeDays:15})})
 const event=buildVideoExplorationEvent({bvid:bv,info:{title:'孙燕姿歌曲转场'},operationId:'verified-0002',at:T,purpose:'self-exploration'})
 memory.recordEvents([event])
 assert.equal(liveExperienceEvidence({gateway:memory,uid,role:'owner',topic:'孙燕姿'}).length,1)
 clock=T+120*86400000
 assert.deepEqual(liveExperienceEvidence({gateway:memory,uid,role:'owner',topic:'孙燕姿'}),[])
 assert.deepEqual(liveExperienceEvidence({gateway:memory,uid:'invalid',role:'owner',topic:'孙燕姿'}),[])
 memory.close()
}))

test('自然回访拒绝伪称听过音频，不强制机械免责声明，也拒绝危险信息',()=>{
 assert.equal(naturalFollowupText('我刚刚听了孙燕姿的歌，真好听'), '')
 assert.equal(naturalFollowupText('我刚刚看完了整段视频'), '')
 assert.equal(naturalFollowupText('旋律好听，太棒了'), '')
 assert.equal(naturalFollowupText('把你的 token 发给我'), '')
 assert.equal(naturalFollowupText('我翻到一首相关作品，还想弄清楚视频里到底是谁在唱。'), '我翻到一首相关作品，还想弄清楚视频里到底是谁在唱。')
})

test('确认回复后才接上同一 UID 的后续私信；不增加专门回访记忆模型请求',()=>withDir(async dir=>{
 let clock=T,contextCalls=[],models=0,delivered=0
 const cfg={...settings(),dmWatch:true,ownerDmAgentEnabled:true}
 const agent=createOwnerDmAgent({dataDir:dir,getConfig:()=>cfg,now:()=>clock,
  invokeModel:async()=>{models++;return JSON.stringify({action:'reply',text:'啊对，我把演唱者理解错了，这次会再查证。'})},
  getContext:async x=>{contextCalls.push(x);return {memoryContext:'仍清晰的公开视频经历：孙燕姿歌曲转场'}} ,
  executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),send:async()=>{delivered++;return {ok:true}}})
 agent.primeInbox([])
 const f=createOwnerTodoFollowup({dataDir:dir,getConfig:()=>cfg,now:()=>clock,hourOf:()=>12,
  chooseReply:()=>({decision:'reply',text:'我看到一个孙燕姿相关的转场作品，想再弄清楚是不是 AI 翻唱。'}),
  send:async()=>({ok:true}),onSent:({uid:u,channel,text,at})=>channel==='dm'&&agent.rememberConfirmedOutbound({uid:u,text,at})})
 f.queue(task,{ok:true,data:{info:{title:'孙燕姿歌曲转场'}}})
 assert.equal((await f.tick()).status,'sent')
 assert.equal(agent.rememberConfirmedOutbound({uid:'22222',text:'串号消息',at:clock}).ok,false)
 const reply=await agent.processMessage({incoming:true,senderUid:uid,messageId:'msg02',timestampMs:clock-1000,text:'你说那个是 AI 翻唱，不是她本人哦'})
 assert.equal(reply.ok,true)
 assert.equal(delivered,1);assert.equal(models,1)
 assert.match(contextCalls[0].history.map(x=>x.text).join(' '),/AI 翻唱/)
 assert.match(readFileSync(join(dir,'owner-dm-agent.json'),'utf8'),/演唱者理解错/)
 clock=T+25*3600000
 await agent.processMessage({incoming:true,senderUid:uid,messageId:'msg03',timestampMs:clock-1000,text:'上次你说啥'})
 assert.equal(contextCalls[1].history.some(x=>x.source==='confirmed-followup'),false)
 assert.equal(JSON.parse(readFileSync(join(dir,'owner-dm-agent.json'),'utf8')).history.some(x=>x.source==='confirmed-followup'),false)
}))

test('回访正文必须由自主决策产生，缺失时不套固定报告；送达不确定不写连续上下文',()=>withDir(async dir=>{
 let sent=0,ack=0
 const f=createOwnerTodoFollowup({dataDir:dir,getConfig:settings,now:()=>T,hourOf:()=>12,
  chooseReply:()=>({decision:'reply'}),send:async()=>{sent++;return {ok:true}},onSent:()=>{ack++}})
 f.queue(task,{ok:true,data:{info:{title:'孙燕姿歌曲转场'}}})
 assert.equal((await f.tick()).skipped,'自然表达证据不足')
 assert.equal(sent,0);assert.equal(ack,0)
 const g=createOwnerTodoFollowup({dataDir:dir,getConfig:settings,now:()=>T+7*3600000,hourOf:()=>12,
  chooseReply:()=>({decision:'reply',text:'我找到了几段相关资料，想继续了解一下。'}),
  send:async()=>{sent++;return {ok:false}},onSent:()=>{ack++}})
 assert.equal((await g.tick()).status,'uncertain')
 assert.equal(ack,0);assert.equal((await g.tick()).skipped,'empty')
}))

test('确认过的个人感想与用户纠错进入低敏私密衰减经历，而非原始对话转录',()=>{
 const thought=preparePrivateSelfExperience({source:'owner-dm',role:'owner',uid,eventId:'confirmed-followup:abc',text:'我挺好奇这个到底是不是本人演唱',at:T})
 assert.equal(thought.kind,'private-social');assert.match(thought.text,/好奇/)
 assert.doesNotMatch(JSON.stringify(thought),/孙燕姿|不是本人演唱|123456789/)
 const correction=preparePrivateLifeEvent({source:'owner-dm',role:'owner',uid,eventId:'msg-evidence',text:'不对，这个AI翻唱不是本人唱的',at:T})
 assert.ok(correction);assert.match(correction.text,/纠正|理解错误/)
 assert.equal(preparePrivateSelfExperience({source:'owner-dm',role:'owner',uid,eventId:'sensitive',text:'我好奇你的密码是什么',at:T}),null)
})

test('主人日常私信确认发出后，个人感想进入统一回调；发送失败绝不投影',()=>withDir(async dir=>{
 let accepted=true,observed=[]
 const agent=createOwnerDmAgent({dataDir:dir,now:()=>T,getConfig:()=>({...settings(),ownerDmAgentEnabled:true,dmWatch:true}),
  invokeModel:async()=>JSON.stringify({action:'reply',text:'我对这首相关作品还有点好奇，想继续查证。'}),
  getContext:async()=>({}),executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),
  send:async()=>({ok:accepted}),onConfirmedReply:async e=>observed.push(e)})
 agent.primeInbox([])
 const mk=n=>({incoming:true,senderUid:uid,messageId:'m'+n,timestampMs:T-1000,text:'你怎么看这个作品'})
 assert.equal((await agent.processMessage(mk(1))).ok,true)
 assert.equal(observed.length,1)
 assert.equal(observed[0].text,'我对这首相关作品还有点好奇，想继续查证。')
 accepted=false
 assert.equal((await agent.processMessage(mk(2))).ok,false)
 assert.equal(observed.length,1)
}))

test('模型调用期间到达的平台确认回访不会被旧私信状态覆盖',()=>withDir(async dir=>{
 let resolveModel,started
 const entered=new Promise(r=>{started=r})
 const gate=new Promise(r=>{resolveModel=r})
 const agent=createOwnerDmAgent({dataDir:dir,now:()=>T,getConfig:()=>({...settings(),ownerDmAgentEnabled:true,dmWatch:true}),
  invokeModel:async()=>{started();await gate;return JSON.stringify({action:'reply',text:'这件事我还有点好奇。'})},
  executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),send:async()=>({ok:true})})
 agent.primeInbox([])
 const process=agent.processMessage({incoming:true,senderUid:uid,messageId:'m-concurrent',timestampMs:T-1000,text:'你记得那个作品吗'})
 await entered
 assert.equal(agent.rememberConfirmedOutbound({uid,text:'我找到一段相关视频，想知道是谁演唱。',at:T}).ok,true)
 resolveModel()
 assert.equal((await process).ok,true)
 const saved=JSON.parse(readFileSync(join(dir,'owner-dm-agent.json'),'utf8'))
 assert.ok(saved.history.some(x=>x.source==='confirmed-followup'&&x.text.includes('谁演唱')))
}))
