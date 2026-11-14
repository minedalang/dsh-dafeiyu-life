import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {normalizeTopicState,mayUnpromptedContinue} from '../lib/conversation-topic-state.mjs'
import {naturalExpressionPolicy,NATURAL_EXPRESSION_PROFILES,createNaturalExpressionOpportunity} from '../lib/natural-expression-opportunity.mjs'
import {parseAgentStep} from '../lib/owner-dm-agent.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
const read=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8')

test('话题结束由同轮模型状态声明，常见中文词不能替代判定',()=>{
 assert.equal(normalizeTopicState('settled'),'settled')
 assert.equal(normalizeTopicState('waiting'),'waiting')
 assert.equal(normalizeTopicState('INVALID'),'open')
 assert.equal(mayUnpromptedContinue('settled'),false)
 assert.equal(mayUnpromptedContinue('waiting'),false)
 assert.equal(mayUnpromptedContinue('open'),true)
 assert.equal(parseAgentStep({action:'reply',messages:['这件事已经说清楚了'],topicState:'settled'}).topicState,'settled')
 assert.equal(parseAgentStep({action:'reply',messages:['先等你回答'],topicState:'waiting'}).topicState,'waiting')
})

test('默认方案、更多预设和自定义都按已有字段传递，不新增发送授权',()=>{
 assert.deepEqual(naturalExpressionPolicy({}),NATURAL_EXPRESSION_PROFILES.balanced)
 assert.deepEqual(naturalExpressionPolicy({naturalThoughtOwnerMinutes:1,naturalThoughtIntimateMinutes:3,naturalThoughtFamiliarMinutes:6,naturalThoughtStrangerMinutes:15,naturalThoughtChancePercent:40}),NATURAL_EXPRESSION_PROFILES.lively)
 const html=read('lib/management-console.html'),js=read('lib/management-console.js'),index=read('index.js')
 for(const name of ['gentle','balanced','lively','custom'])assert.match(html,new RegExp('name="dm-natural-choice" value="'+name+'"'))
 for(const id of ['natural-owner-minutes','natural-intimate-minutes','natural-familiar-minutes','natural-stranger-minutes','natural-chance-percent'])assert.match(html,new RegExp('id="'+id+'"'))
 assert.match(js,/dmNaturalPlans/)
 assert.match(js,/setChoice\('dm-natural-choice',naturalPlanMatch\(readNaturalFields\(\)\)\)/)
 assert.match(js,/bubbles:Number\(cfg\.dmP6MaxBubbles\?\?3\)/)
 assert.match(js,/for\(const id of \[\.\.\.Object\.values\(naturalFields\),'dm-p6-enabled','dm-p6-max-bubbles'\]/)
 assert.doesNotMatch(js,/for\(const id of \['dm-watch','dm-stranger-enabled','dm-approval-enabled','dm-p6-enabled'\]/)
 assert.match(index,/naturalThoughtOwnerMinutes:z\.natural\(\)\.default\(2\)/)
 assert.match(index,/naturalThoughtChancePercent:z\.natural\(\)\.default\(25\)/)
})

test('关系冷却可运行时配置，沉默后也进入冷却，无每日上限',()=>{
 const dir=mkdtempSync(join(tmpdir(),'natural-config-'))
 try{
  let t=1000000000000,chance=0,config={naturalThoughtOwnerMinutes:2,naturalThoughtChancePercent:100}
  const l=createNaturalExpressionOpportunity({dataDir:dir,now:()=>t,random:()=>chance,getPolicy:()=>config})
  const args={account:'same-account',peer:'same-peer',stage:'owner'}
  assert.equal(l.tryAcquire(args).ok,true)
  t+=60_000;assert.equal(l.tryAcquire(args).reason,'cooldown')
  t+=60_000;assert.equal(l.tryAcquire(args).ok,true)
  config={naturalThoughtOwnerMinutes:10,naturalThoughtChancePercent:0}
  t+=2*60_000;assert.equal(l.tryAcquire(args).reason,'cooldown')
  t+=10*60_000;assert.equal(l.tryAcquire(args).reason,'not-selected')
  config.naturalThoughtChancePercent=100
  assert.equal(l.tryAcquire(args).ok,true)
 } finally{rmSync(dir,{recursive:true,force:true})}
})

test('已删除旧预约设置，新的自然表达卡片仍独立于私信授权',()=>{
 const js=read('lib/management-console.js'),html=read('lib/management-console.html'),index=read('index.js')
 assert.doesNotMatch(html,/旧版延期预约与跨渠道防打扰|旧预约最短延期/)
 assert.doesNotMatch(index,/socialP6MinDelayMinutes|socialP6MaxDelayMinutes/)
 assert.doesNotMatch(js,/socialP6MinDelayMinutes|socialP6MaxDelayMinutes/)
 assert.match(js,/naturalThoughtOwnerMinutes:boundedInt/)
 const group=js.match(/const dmPlans=(\{[\s\S]*?\n  \});/)
 assert.ok(group)
 assert.doesNotMatch(group[1],/dmP6Enabled|naturalThought/)
})

test('互动模型结构化输出不再携带旧预约参数',()=>{
 const source=read('lib/interaction-batch.mjs')
 assert.match(source,/topicState/)
 assert.doesNotMatch(source,/followUpMinutes:|idleReconsiderMinutes:|p6MinDelayMinutes|p6MaxDelayMinutes/)
})

test('互动模型一次生成回复和 settled 状态，原授权校验不再二次判断',async()=>{
 const batcher=createInteractionBatcher({invoke:async()=>JSON.stringify({items:[{id:'0',action:'reply',reply:'说清楚啦',messages:['说清楚啦'],topicState:'settled',followUpMinutes:5,idleReconsiderMinutes:5,idleReconsiderReason:'open-conversation',mood:'neutral',intensity:0}]}),getPersona:()=> '鱼鱼自主生活人格',delayMs:1,logger:{warn(){}}})
 try{
  const choice=await batcher.generate({kind:'dm',uid:'12345',text:'没问题了',messages:['没问题了'],history:[],socialAutonomy:true,threadKey:'dm:12345',trigger:'incoming',authorization:'trusted',p6MaxBubbles:3,p6MinDelayMinutes:5,p6MaxDelayMinutes:360})
  assert.equal(choice.action,'reply')
  assert.deepEqual(choice.messages,['说清楚啦'])
  assert.equal(choice.topicState,'settled')
  assert.equal(choice.followUpMinutes,undefined)
  assert.equal(choice.idleReconsiderMinutes,undefined)
 } finally{batcher.stop()}
})

test('普通私信话题 settled 后即使抽中额外思考也不再补话或安排老续聊',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dm-topic-state-'))
 try{
  let clock=1800000000000,queue=[],sends=[],extras=0,topic='settled'
  const {createDmAutoReply}=await import('../lib/dm-autoreply.mjs')
  const cfg={enabled:true,strangerEnabled:true,p6Enabled:true,p6MaxBubbles:3,
    whitelist:[],whitelistCooldownSeconds:0,maxPerDay:0,delayMinMinutes:5,delayMaxMinutes:360,
    naturalThoughtChancePercent:100,naturalThoughtStrangerMinutes:30}
  const engine=createDmAutoReply({dataDir:dir,now:()=>clock,reconsiderRandom:()=>0,selfUid:'77777',getConfig:()=>cfg,
    fetchIncoming:async()=>queue,send:async({text})=>{sends.push(text);return {ok:true,receiptId:'r'+sends.length}},
    generateReply:async()=>({action:'reply',messages:['这一段说完啦'],topicState:topic,followUpMinutes:5,idleReconsiderMinutes:5,idleReconsiderReason:'open-conversation'}),
    generateContinuation:async()=>{extras++;return '不该补充'},logger:{warn(){}}})
  await engine.poll()
  queue=[{senderUid:'88888',messageId:'88888:1',timestampMs:clock+1000,incoming:true,text:'这个话题已经解答啦'}]
  clock+=1000;await engine.poll()
  assert.deepEqual(sends,['这一段说完啦'])
  assert.equal(extras,0)
  assert.equal(engine.status().p6,undefined)
  assert.doesNotMatch(read('lib/dm-autoreply.mjs'),/scheduleContinuity|ledgerFor/)
  // A genuinely new incoming message should remain eligible for a new decision.
  topic='open';clock+=40*60_000
  queue.push({senderUid:'88888',messageId:'88888:2',timestampMs:clock,incoming:true,text:'对了，想问新问题'})
  await engine.poll()
  assert.ok(sends.length>=2)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

function mainSessionHarness(){
 const callbacks=new Map(),steered=[],followups=[]
 const inbox={nextTurn:[],nextStep:[],remove(id){this.nextTurn=this.nextTurn.filter(m=>m.id!==id);this.nextStep=this.nextStep.filter(m=>m.id!==id)}}
 const agent={status:'running',inbox,steer(m){steered.push(m);inbox.nextStep.push(m)},followup(m){followups.push(m);inbox.nextTurn.push(m)},
  ctx:{on(name,fn){callbacks.set(name,[...(callbacks.get(name)||[]),fn]);return ()=>{}}}}
 const emit=(name,...args)=>{for(const fn of callbacks.get(name)||[])fn(...args)}
 const claim=(message,turn)=>{inbox.remove(message.id);emit('agent/inbox/claimed',{message,turn})}
 return {agent,emit,claim,steered,followups}
}

test('主 Session 模型声明话题结束，连续气泡仍发完，但禁止额外自主续想',async()=>{
 const {createSessionMessageBurstController}=await import('../lib/message-burst.mjs')
 const h=mainSessionHarness();let reconsiderCount=0
 const ctl=createSessionMessageBurstController({agent:h.agent,tryReconsider:()=>{reconsiderCount++;return true},logger:{warn(){}}})
 try{
  h.emit('agent/inbox/inserted',{message:{role:'user',source:{kind:'user'}}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:11}})
  assert.equal(ctl.start(['第一条正常表达','第二条是完整表达'],{topicState:'settled'}).ok,true)
  h.claim(h.steered[0],11)
  h.emit('session/event',null,{type:'assistant/message',data:{turn:11,message:{content:[{type:'text',text:'第一条正常表达'}]}}})
  h.emit('agent/turn-stopping',{turn:11,signal:new AbortController().signal})
  assert.equal(h.followups.length,1,'已生成的第二条照常递送')
  h.emit('session/event',null,{type:'turn/end',data:{turn:11}})
  h.emit('session/event',null,{type:'turn/start',data:{turn:12}})
  h.claim(h.followups[0],12)
  h.emit('session/event',null,{type:'assistant/message',data:{turn:12,message:{content:[{type:'text',text:'第二条是完整表达'}]}}})
  h.emit('agent/turn-stopping',{turn:12,signal:new AbortController().signal})
  assert.equal(h.followups.length,1,'不会再安排第三条')
  assert.equal(reconsiderCount,0,'话题已自然结束时不调用第二次模型')
 } finally {ctl.dispose()}
})

test('配置未填写及 null 会使用默认方案，明确配置 0% 则关闭额外思考机会',()=>{
 assert.deepEqual(naturalExpressionPolicy({naturalThoughtChancePercent:null,naturalThoughtOwnerMinutes:null}),NATURAL_EXPRESSION_PROFILES.balanced)
 assert.equal(naturalExpressionPolicy({naturalThoughtChancePercent:0}).probability,0)
})
