import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
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

test('non-owner DM triggers zero extra calls without cue and exactly one after verified first bubble',async()=>mk(async dataDir=>{
 const inbox=[],sent=[];let gen=0,extra=0,clock=t0
 const config={enabled:true,strangerEnabled:true,p6Enabled:true,p6MaxBubbles:3,whitelist:[],whitelistCooldownSeconds:0,dmActivePollEnabled:true,dmActivePollSeconds:10,dmActiveWindowSeconds:180}
 let mode='no-cue'
 const engine=createDmAutoReply({dataDir,getConfig:()=>config,selfUid:'999',now:()=>clock,fetchIncoming:async()=>inbox,
   send:async req=>{sent.push(req.text);return {ok:true,receiptId:'receipt-'+sent.length}},
   generateReply:async()=>{gen++;return {action:'reply',messages:['一句完整回答'],continuation:mode==='cue'?{intent:'maybe',thoughtCue:'想再问一个独立问题'}:{intent:'none'}}},
   generateContinuation:async()=>{extra++;return '事后补充的问题'},logger:{warn(){},error(){}}})
 await engine.poll();inbox.push(input('1','你好'));assert.equal((await engine.poll()).sent,1)
 assert.equal(extra,0);assert.deepEqual(sent,['一句完整回答'])
 mode='cue';clock+=20_000;inbox.push(input('2','想听后续'));assert.equal((await engine.poll()).sent,2)
 assert.equal(extra,1);assert.deepEqual(sent.slice(-2),['一句完整回答','事后补充的问题'])
 assert.equal(engine.status().p6LastTurn.postSendStage,'post-send-confirmed')
 assert.equal(engine.nextFastUid(),'') // no immediate redundant read after a confirmed outgoing bubble
 clock+=10_000;let received=0;const next=engine.nextFastUid();assert.equal(next,person)
 await engine.poll({fastUid:next}); // test transport can pass a scoped fast fetch, old IDs do not resend
 assert.equal(sent.length,3)
 assert.equal(received,0)
 clock+=181_000;assert.equal(engine.nextFastUid(),'')
}))

test('fast session scheduler has no extra get_sessions call and obeys config / rate-limited backoff',async()=>{
 let clock=t0,fastReady='22334';const calls=[]
 const cfg={masterEnabled:true,dmWatch:true,dmWatchMinutes:2,dmActivePollEnabled:true,dmActivePollSeconds:10,commentWatchReplies:false,commentAtEnabled:false}
 const dm={poll:async opt=>{calls.push(opt||{});return {sent:0}},nextFastUid:()=>fastReady,status:()=>({fast:{activeCount:1}})}
 const scheduler=createInteractionScheduler({dm,comments:{poll:async()=>({})},getConfig:()=>cfg,now:()=>clock})
 try{
  scheduler.start();await new Promise(r=>setTimeout(r,8));assert.equal(calls.length,1)
  clock+=10_000;await scheduler.tick();assert.deepEqual(calls.at(-1),{fastUid:'22334'})
  // Expose the fast lane separately, not only the coarse full-session scan.
  assert.equal(scheduler.status().checks.dmFast.lastResult,'completed')
  assert.equal(scheduler.status().checks.dmFast.intervalSeconds,10)
  cfg.dmActivePollEnabled=false;clock+=10_000;await scheduler.tick();assert.equal(calls.length,2)
  cfg.dmActivePollEnabled=true;fastReady='';clock+=10_000;await scheduler.tick();assert.equal(calls.length,2)
  clock+=120_000;await scheduler.tick();assert.deepEqual(calls.at(-1),{})
 }finally{scheduler.stop()}
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


test('targeted fetch failure propagates into shared backoff; ordinary inbox keeps other sessions',async()=>{
 const source=[{uid:person,unread:1,lastTs:t0},{uid:'33445',unread:1,lastTs:t0}]
 const adapter=async(uid)=>{if(uid===person)throw Error('HTTP -509');return [{key:'k',ts:t0,text:'你好',fromMe:false,kind:1}]}
 const normal=await collectDmInbox({sessions:source,ownUid:uid,readConversation:adapter,now:()=>t0,logger:{warn(){}}})
 assert.equal(normal.length,1)
 await assert.rejects(collectDmInbox({sessions:source.slice(0,1),ownUid:uid,readConversation:adapter,now:()=>t0,failClosed:true,logger:{warn(){}}}),/HTTP -509/)
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


test('owner direct chat may think once more after confirmed first bubble; no compulsory second message',async()=>mk(async dataDir=>{
 const cfg={masterEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:true,dmP6Enabled:true,dmP6MaxBubbles:3}
 let modelCalls=0;const sent=[]
 const agent=createOwnerDmAgent({dataDir,getConfig:()=>cfg,now:()=>t0,
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

test('owner stop after first receipt never sends a filler bubble',async()=>mk(async dataDir=>{
 const cfg={masterEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:true,dmP6Enabled:true,dmP6MaxBubbles:3}
 let modelCalls=0;const sent=[]
 const agent=createOwnerDmAgent({dataDir,getConfig:()=>cfg,now:()=>t0,
  invokeModel:async()=>{modelCalls++;return modelCalls===1
   ?JSON.stringify({action:'reply',messages:['今晚就说到这。']})
   :JSON.stringify({action:'stop',reply:''})},
  executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),
  send:async r=>{sent.push(r.text);return {ok:true,receiptId:'owner-'+sent.length}},logger:{warn(){}}})
 agent.primeInbox([])
 const result=await agent.processMessage({incoming:true,senderUid:'123',messageId:'o2',timestampMs:t0,text:'晚安'})
 assert.equal(result.ok,true);assert.deepEqual(sent,['今晚就说到这。']);assert.equal(modelCalls,2)
}))
