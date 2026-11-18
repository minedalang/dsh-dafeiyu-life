import test from 'node:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {deliverMessageBurst} from '../lib/message-burst.mjs'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
import {collectDmInbox} from '../lib/dm-inbox.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'
import {normalizeDmContinuation,parseDmContinuationReply,dmContinuationPrompt} from '../lib/dm-progressive-expression.mjs'
import {createOwnerDmAgent,parseAgentStep} from '../lib/owner-dm-agent.mjs'
import {createLifeWillingness} from '../lib/life-willingness.mjs'

const t0=1790000000000
const uid='11122'
const person='22334'
const mk=async(fn)=>{const dir=await mkdtemp(join(tmpdir(),'dev16-dm-'));try{return await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}}
const input=(id,text)=>({senderUid:person,messageId:person+':'+id,timestampMs:t0,incoming:true,text})

test('expression cue is bounded, strictly model-originated and never a tool grant',()=>{
 assert.deepEqual(normalizeDmContinuation({intent:'maybe',thoughtCue:' 想问什么锅底 '}),{intent:'maybe',thoughtCue:'想问什么锅底'})
 assert.deepEqual(normalizeDmContinuation({intent:'none',thoughtCue:'关注他'}),{intent:'none',thoughtCue:''})
 assert.equal(parseDmContinuationReply('{"action":"stop","reply":""}'),'')
 assert.equal(parseDmContinuationReply('{"action":"continue","reply":"再问一句！"}'),'再问一句！')
 assert.equal(parseDmContinuationReply('{"action":"continue","reply":"@陌生用户"}'),'')
 assert.match(dmContinuationPrompt({first:'嗯',cue:'锅底'}),/不是第二次 Life 意愿审批/)
 assert.deepEqual(parseAgentStep({action:'reply',messages:['你好'],continuation:{intent:'maybe',thoughtCue:'多聊几句'}}).continuation,{intent:'maybe',thoughtCue:'多聊几句'})
})

test('transport extends only after a confirmed first send, never on unknown or duplicate output',async()=>{
 const sent=[];let next=0
 const good=await deliverMessageBurst({messages:['首条'],send:async({text})=>{sent.push(text);return {ok:true,receiptId:String(sent.length)}},
  nextMessage:async()=>{next++;return '事后想到的新话'},onConfirmed:async()=>{}})
 assert.equal(good.status,'confirmed');assert.deepEqual(sent,['首条','事后想到的新话']);assert.equal(next,1)
 const unknown=await deliverMessageBurst({messages:['失败首条'],send:async()=>{throw Error('network lost')},nextMessage:async()=>{next++ ;return '不应出现'}})
 assert.equal(unknown.status,'unknown');assert.equal(next,1)
 const noDuplicate=await deliverMessageBurst({messages:['重复'],send:async()=>({ok:true,receiptId:'ok'}),nextMessage:async()=> '重复'})
 assert.equal(noDuplicate.planned,1)
})

test('non-owner DM occasionally reconsiders after confirmed delivery without a predeclared cue',async()=>mk(async dataDir=>{
 const inbox=[],sent=[];let gen=0,extra=0,clock=t0
 const config={enabled:true,strangerEnabled:true,p6Enabled:true,p6MaxBubbles:3,whitelist:[],whitelistCooldownSeconds:0,dmActivePollEnabled:true,dmActivePollSeconds:10,dmActiveWindowSeconds:180}
 let mode='no-cue', chance=1
 const engine=createDmAutoReply({dataDir,getConfig:()=>config,selfUid:'999',now:()=>clock,reconsiderRandom:()=>chance,fetchIncoming:async()=>inbox,
   send:async req=>{sent.push(req.text);return {ok:true,receiptId:'receipt-'+sent.length}},
   generateReply:async()=>{gen++;return {action:'reply',messages:['一句完整回答'],continuation:mode==='cue'?{intent:'maybe',thoughtCue:'想再问一个独立问题'}:{intent:'none'}}},
   generateContinuation:async()=>{extra++;return '事后补充的问题'},logger:{warn(){},error(){}}})
 await engine.poll();inbox.push(input('1','你好'));assert.equal((await engine.poll()).sent,1)
 assert.equal(extra,0);assert.deepEqual(sent,['一句完整回答'])
 mode='no-cue';chance=0;clock+=20_000;inbox.push(input('2','想听后续'));assert.equal((await engine.poll()).sent,2)
 assert.equal(extra,1);assert.deepEqual(sent.slice(-2),['一句完整回答','事后补充的问题'])
 assert.equal(engine.status().p6LastTurn.postSendStage,'post-send-confirmed')
 assert.equal(engine.nextFastUid(),'') // no immediate redundant read after a confirmed outgoing bubble
 clock+=10_000;let received=0;const next=engine.nextFastUid();assert.equal(next,person)
 await engine.poll({fastUid:next}); // test transport can pass a scoped fast fetch, old IDs do not resend
 assert.equal(sent.length,3)
 assert.equal(received,0)
 clock+=181_000;assert.equal(engine.nextFastUid(),'')
}))

test('fast session scheduler keeps the one-time baseline scan and then targets only the active conversation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev16-fast-sentinel-'));let clock=t0,fastReady='22334';const calls=[]
 const cfg={masterEnabled:true,dmWatch:true,dmActivePollEnabled:true,dmActivePollSeconds:10,commentWatchReplies:false,commentAtEnabled:false}
 const dm={poll:async opt=>{calls.push(opt||{});return {ok:true,sent:0}},nextFastUid:()=>fastReady,status:()=>({fast:{activeCount:1,nextIntervalSeconds:10}})}
 const scheduler=createInteractionScheduler({dataDir:dir,getAccountTag:()=> 'aaaaaaaaaaaaaaaa',dm,comments:{poll:async()=>({})},
   readPrivateUnread:async()=>({followUnread:0,unfollowUnread:0,dustbinUnread:0,unfollowPushUnread:0,dustbinPushUnread:0,bizFollowUnread:0,bizUnfollowUnread:0,customUnread:0}),
   getConfig:()=>cfg,now:()=>clock})
 try{
  scheduler.start();await new Promise(r=>setTimeout(r,15));assert.deepEqual(calls[0],{})
  clock+=10_000;await scheduler.tick();assert.deepEqual(calls.at(-1),{fastUid:'22334'})
  assert.equal(scheduler.status().checks.dmFast.lastResult,'completed')
  assert.equal(scheduler.status().checks.dmFast.intervalSeconds,10)
  cfg.dmActivePollEnabled=false;clock+=10_000;await scheduler.tick();assert.equal(calls.length,2)
  cfg.dmActivePollEnabled=true;fastReady='';clock+=10_000;await scheduler.tick();assert.equal(calls.length,2)
  clock+=120_000;await scheduler.tick();assert.equal(calls.length,2,'no new counter means no new full-session scan')
 }finally{scheduler.stop();rmSync(dir,{recursive:true,force:true})}
})

test('a verified Life bubble may extend its own exact text seal once, never another recipient',async()=>mk(async dataDir=>{
 const scope='a'.repeat(16)
 const life=createLifeWillingness({dataDir,getAccountTag:()=>scope,getContext:()=>({}),invokeModel:async()=>'',now:()=>t0})
 const choice=life.adoptSocialDecision({kind:'dm_reply',uid,sourceKey:'dm:'+uid+':msg1',messages:['原首条']})
 assert.equal(choice.ok,true)
 assert.equal(life.extendConfirmedDmExpression(choice.proof,'提前补发').ok,false)
 assert.equal(life.verify(choice.proof,'dm_reply',{uid,targetKey:'',text:'原首条'}).ok,true)
 assert.equal(life.receipt(choice.proof,{status:'verified',receiptId:'receipt-0001'}).ok,true)
 assert.equal(life.extendConfirmedDmExpression(choice.proof,'再补充一句').ok,true)
 assert.equal(life.extendConfirmedDmExpression(choice.proof,'第三条').ok,false)
 assert.equal(life.verify(choice.proof,'dm_reply',{uid:'44556',targetKey:'',text:'再补充一句'}).ok,false)
 assert.equal(life.verify(choice.proof,'dm_reply',{uid,targetKey:'',text:'再补充一句'}).ok,true)
 assert.equal(life.verify(choice.proof,'dm_reply',{uid,targetKey:'',text:'再补充一句'}).ok,false)
}))


test('B站 -509 / 共享读取暂停立即停止整轮私信扫描；普通网络错误仍可检查其他会话',async()=>{
 const source=[{uid:person,unread:1,lastTs:t0},{uid:'33445',unread:1,lastTs:t0}]
 const rateCalls=[]
 const throttled=async(uid)=>{rateCalls.push(uid);throw Error('HTTP 200 code=-509 请求过于频繁')}
 await assert.rejects(collectDmInbox({sessions:source,ownUid:uid,readConversation:throttled,now:()=>t0,logger:{warn(){}}}),/HTTP 200 code=-509/)
 assert.deepEqual(rateCalls,[person],'命中平台限流后不能继续读取第二个会话')
 const normal=await collectDmInbox({sessions:source,ownUid:uid,readConversation:async target=>{
   if(target===person)throw Error('ECONNRESET')
   return [{key:'k',ts:t0,text:'你好',fromMe:false,kind:1}]
 },now:()=>t0,logger:{warn(){}}})
 assert.equal(normal.length,1,'普通单会话网络错误仍允许本轮检查其他会话')
 await assert.rejects(collectDmInbox({sessions:source.slice(0,1),ownUid:uid,readConversation:throttled,now:()=>t0,failClosed:true,logger:{warn(){}}}),/HTTP 200 code=-509/)
})

test('active lane is account-scoped and does not retry failed model every ten seconds',async()=>mk(async dataDir=>{
 let clock=t0,account='999',generateError=false
 const inbox=[]
 const config={enabled:true,strangerEnabled:true,p6Enabled:true,p6MaxBubbles:3,whitelist:[],whitelistCooldownSeconds:0,dmActivePollSeconds:10,dmActiveWindowSeconds:180}
 const engine=createDmAutoReply({dataDir,getConfig:()=>config,selfUid:()=>account,now:()=>clock,fetchIncoming:async()=>inbox,
   send:async()=>({ok:true,receiptId:'confirmed'}),generateReply:async()=>{if(generateError)throw Error('temporary model outage');return {action:'reply',messages:['回应']}} ,logger:{warn(){},error(){}}})
 await engine.poll();inbox.push(input('1','早上好'));await engine.poll();
 clock+=10_000;assert.equal(engine.nextFastUid(),person)
 generateError=true;inbox.push(input('2','再说点什么'));
 const err=await engine.poll({fastUid:person});assert.ok(err.failed>0)
 clock+=10_000;assert.equal(engine.nextFastUid(),'') // model error cooldown
 clock+=60_000;assert.equal(engine.nextFastUid(),person)
 account='998';assert.equal(engine.nextFastUid(),'')
 assert.equal((await engine.poll({fastUid:person})).skipped,'inactive-session')
}))

test('活跃私信快通道在连续无新消息时自适应 10→20→30 秒，有新来信后重置',async()=>mk(async dataDir=>{
 let clock=t0
 const inbox=[input('baseline','旧消息')]
 const config={enabled:true,strangerEnabled:false,p6Enabled:true,p6MaxBubbles:3,whitelist:[person],
   whitelistCooldownSeconds:0,dmActivePollSeconds:10,dmActiveWindowSeconds:600}
 const engine=createDmAutoReply({dataDir,getConfig:()=>config,selfUid:'999',now:()=>clock,fetchIncoming:async()=>inbox,
   send:async()=>({ok:true,receiptId:'adaptive'}),generateReply:async()=>({action:'skip',messages:[]}),
   logger:{warn(){},error(){}}})
 await engine.poll() // establish safe baseline
 inbox.push(input('new-1','刚刚有新消息'))
 await engine.poll() // create active session; model may choose silence
 assert.equal(engine.status().fast.nextIntervalSeconds,10)
 clock+=10_000;assert.equal(engine.nextFastUid(),person)
 await engine.poll({fastUid:person}) // quiet check 1
 assert.equal(engine.status().fast.nextIntervalSeconds,20)
 clock+=10_000;assert.equal(engine.nextFastUid(),'')
 clock+=10_000;assert.equal(engine.nextFastUid(),person)
 await engine.poll({fastUid:person}) // quiet check 2
 assert.equal(engine.status().fast.nextIntervalSeconds,30)
 clock+=20_000;assert.equal(engine.nextFastUid(),'')
 clock+=10_000;assert.equal(engine.nextFastUid(),person)
 await engine.poll({fastUid:person}) // quiet check 3
 assert.equal(engine.status().fast.nextIntervalSeconds,30)
 clock+=20_000;assert.equal(engine.nextFastUid(),'')
 clock+=10_000;assert.equal(engine.nextFastUid(),person)
 inbox.push(input('new-2','又有新消息'))
 await engine.poll({fastUid:person})
 assert.equal(engine.status().fast.nextIntervalSeconds,10,'新消息重新建立快速响应窗口')
}))


test('owner direct chat may occasionally think once more without a predicted cue',async()=>mk(async dataDir=>{
 const cfg={masterEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:true,dmP6Enabled:true,dmP6MaxBubbles:3}
 let modelCalls=0;const sent=[]
 const agent=createOwnerDmAgent({dataDir,getConfig:()=>cfg,now:()=>t0, getAccountTag:()=> 'a'.repeat(16),reconsiderRandom:()=>0,
   invokeModel:async()=>{modelCalls++;return modelCalls===1
     ?JSON.stringify({action:'reply',messages:['我先说一句。'],continuation:{intent:'maybe',thoughtCue:'后来想到的小事'}})
     :JSON.stringify({action:'continue',reply:'又想起一个小问题。'})},
   executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),
   send:async r=>{sent.push(r.text);return {ok:true,receiptId:'owner-'+sent.length}},logger:{warn(){}}})
 agent.primeInbox([])
 const first=await agent.processMessage({incoming:true,senderUid:'123',messageId:'o1',timestampMs:t0,text:'跟我聊聊'})
 assert.equal(first.ok,true);assert.deepEqual(sent,['我先说一句。','又想起一个小问题。']);assert.equal(modelCalls,2)
 const ownerState=JSON.parse((await import('node:fs/promises')).readFile?await (await import('node:fs/promises')).readFile(join(dataDir,'owner-dm-agent.json'),'utf8'):'{}')
 assert.equal(ownerState.items.find(x=>x.confirmedBubbles===2)?.postSendStage,'post-send-confirmed')
 assert.equal((await agent.processMessage({incoming:true,senderUid:'123',messageId:'o1',timestampMs:t0,text:'跟我聊聊'})).skipped,'duplicate')
}))

test('owner no-extra opportunity returns one message without filler',async()=>mk(async dataDir=>{
 const cfg={masterEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:true,dmP6Enabled:true,dmP6MaxBubbles:3}
 let modelCalls=0;const sent=[]
 const agent=createOwnerDmAgent({dataDir,getConfig:()=>cfg,now:()=>t0,getAccountTag:()=> 'a'.repeat(16),reconsiderRandom:()=>1,
  invokeModel:async()=>{modelCalls++;return modelCalls===1
   ?JSON.stringify({action:'reply',messages:['今晚就说到这。']})
   :JSON.stringify({action:'stop',reply:''})},
  executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),
  send:async r=>{sent.push(r.text);return {ok:true,receiptId:'owner-'+sent.length}},logger:{warn(){}}})
 agent.primeInbox([])
 const result=await agent.processMessage({incoming:true,senderUid:'123',messageId:'o2',timestampMs:t0,text:'晚安'})
 assert.equal(result.ok,true);assert.deepEqual(sent,['今晚就说到这。']);assert.equal(modelCalls,1)
}))
