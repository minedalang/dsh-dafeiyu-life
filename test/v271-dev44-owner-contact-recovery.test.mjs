import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {checkOwnerContact,ownerContactPolicy} from '../lib/owner-contact-policy.mjs'
import {classifyPollFailure,createNetworkPollBackoff} from '../lib/network-poll-backoff.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'
import {createMainSessionBridge} from '../lib/main-session-bridge.mjs'
const tag='1234567890abcdef'
const date=(hour,min=0)=>new Date(2026,10,9,hour,min,0,0).getTime()
const withDir=async callback=>{const dir=mkdtempSync(join(tmpdir(),'dsh-dev44-'));try{await callback(dir)}finally{rmSync(dir,{force:true,recursive:true})}}
test('contact preset cards express access limits, not compulsory personality',()=>{
 assert.deepEqual(ownerContactPolicy({ownerContactPreset:'quiet'}),{preset:'quiet',startHour:10,endHour:20,cooldownMinutes:720,dailyLimit:1,silenceMinutes:120})
 assert.equal(ownerContactPolicy({ownerContactPreset:'lively'}).dailyLimit,4)
 assert.equal(ownerContactPolicy({ownerContactPreset:'custom',ownerContactStartHour:21,ownerContactEndHour:6,ownerContactSilenceMinutes:70}).silenceMinutes,70)
 assert.equal(checkOwnerContact({config:{ownerContactPreset:'natural'},now:date(23)}).reason,'quiet-hours')
 assert.equal(checkOwnerContact({config:{ownerContactPreset:'lively'},now:date(8)}).eligible,true)
 assert.equal(checkOwnerContact({config:{ownerContactPreset:'custom',ownerContactStartHour:22,ownerContactEndHour:6},now:date(23)}).eligible,true)
 assert.equal(checkOwnerContact({config:{ownerContactPreset:'natural'},now:date(12),attempts:[{at:date(11)}]}).reason,'cooldown')
 assert.equal(checkOwnerContact({config:{ownerContactPreset:'quiet'},now:date(19),attempts:[{at:date(6)}]}).reason,'daily-limit')
})
test('Bilibili failure classification covers -509, DNS, timeout and connection reset',()=>{
 for(const message of ['HTTP 200 code=-509 请求过于频繁','HTTP 429 rate limit'])assert.equal(classifyPollFailure(message),'rate-limit')
 for(const message of ['ENOTFOUND api.vc.bilibili.com','getaddrinfo failed','ETIMEDOUT','ECONNRESET'])assert.equal(classifyPollFailure(message),'network')
 assert.equal(classifyPollFailure(''), '')
})
test('persistent network backoff survives restart and is isolated by account and lanes',async()=>withDir(async dir=>{
 let now=date(12),scope=tag
 const make=()=>createNetworkPollBackoff({dataDir:dir,getAccountTag:()=>scope,now:()=>now})
 let a=make();a.settle('dm','code=-509')
 assert.equal(make().check('dm').allowed,false)
 assert.equal(make().check('replies').allowed,true)
 assert.equal(make().check('dm').remainingMs,300000)
 now+=300000;a=make();assert.equal(a.check('dm').allowed,true)
 a.settle('dm','ENOTFOUND');assert.equal(make().check('dm').remainingMs,120000)
 scope='fedcba9876543210';assert.equal(make().check('dm').allowed,true)
 scope=tag;a.settle('dm','');assert.equal(make().check('dm').allowed,true)
}))
test('interaction scheduler suppresses network requests in the persisted cooldown window',async()=>withDir(async dir=>{
 let now=date(11),calls=0
 const cfg={masterEnabled:true,dmWatch:true,dmWatchMinutes:1,commentWatchReplies:false,commentAtEnabled:false}
 const setup=()=>createInteractionScheduler({dataDir:dir,getAccountTag:()=>tag,now:()=>now,getConfig:()=>cfg,
  dm:{poll:async()=>{calls++;return calls===1?{error:'HTTP 200 code=-509'}:{sent:0}}},comments:{poll:async()=>({sent:0})}})
 let scheduler=setup();scheduler.start();await scheduler.tick(); // start triggers its own async tick too
 assert.equal(calls,1)
 now+=60_000;await scheduler.tick();assert.equal(calls,1)
 scheduler.stop();scheduler=setup();scheduler.start();await scheduler.tick();assert.equal(calls,1)
 now+=5*60_000;await scheduler.tick();assert.equal(calls,2)
 scheduler.stop()
}))
test('main and Bstation owner DM share one durable contact quota and ID replay gate',async()=>withDir(async dir=>{
 const agent={id:'main',followup:async()=>{}}
 const config={masterEnabled:true,lifeAgentMode:'active',mainSessionBridgeEnabled:true,mainSessionId:'main',ownerSpontaneousChatEnabled:true,
  ownerDmAgentEnabled:true,ownerDmSilenceFollowupEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerContactPreset:'quiet'}
 let clock=date(12)
 const make=()=>createMainSessionBridge({dataDir:dir,agents:{get:()=>agent,list:()=>[agent]},getConfig:()=>config,getAccountTag:()=>tag,
   getWatched:()=>[],getComments:()=>({rows:[]}),now:()=>clock})
 const bridge=make(), source=tag+':dm-silence:'+'a'.repeat(24)
 assert.equal(bridge.reserveOwnerContact({channel:'owner-dm',sourceKey:source}).ok,true)
 assert.equal(bridge.settleOwnerContact({sourceKey:source,status:'confirmed'}).ok,true)
 const next=tag+':idle:2026-11-09'
 clock=date(19)
 assert.equal(make().ownerChatReadiness({sourceKey:next}).reason,'cooldown')
 assert.equal(make().reserveOwnerContact({channel:'owner-dm',sourceKey:source}).reason,'source-used')
 const ledger=JSON.parse(readFileSync(join(dir,'main-session-memory.json'),'utf8'))
 assert.equal(ledger.ownerChatAttempts.length,1)
}))
test('UI provides contact cards, silence toggles, scheduler heartbeats and removes obsolete native button',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const native=readFileSync(new URL('../client.js',import.meta.url),'utf8')
 for(const name of ['quiet','natural','lively','custom'])assert.match(html,new RegExp('name="owner-contact-choice" value="'+name+'"'))
 for(const id of ['main-session-silence-enabled','owner-dm-silence-enabled','owner-contact-silence'])assert.ok(html.includes('id="'+id+'"'))
 assert.match(ui,/sched\.schedulerPulse/)
 assert.match(ui,/ownerContactSilenceMinutes:boundedInt/)
 assert.doesNotMatch(native,/h\('button',[^\n]+现在跑一轮/)
})
test('main Session observes only authentic owner turn and cancels stale silence on new owner input',async()=>withDir(async dir=>{
  const handlers=new Map(),followups=[]
  const agent={id:'main',ctx:{on:(event,fn)=>{handlers.set(event,fn);return ()=>handlers.delete(event)}},followup:async m=>followups.push(m)}
  const cfg={masterEnabled:true,lifeAgentMode:'active',ownerSpontaneousChatEnabled:true,mainSessionSilenceFollowupEnabled:true,
    mainSessionBridgeEnabled:true,mainSessionId:'main',ownerContactPreset:'lively'}
  let t=date(12),bridge=createMainSessionBridge({dataDir:dir,agents:{get:()=>agent,list:()=>[agent]},
   getConfig:()=>cfg,getAccountTag:()=>tag,getWatched:()=>[],getComments:()=>({rows:[]}),now:()=>t})
  assert.equal(bridge.mainSilenceCandidate().eligible,false)
  handlers.get('agent/inbox/inserted')({role:'user',id:'real-u1',source:{kind:'dsh-chat'}})
  handlers.get('session/event')(null,{type:'assistant/message'})
  assert.equal(bridge.mainSilenceCandidate().eligible,false)
  t+=21*60_000
  const candidate=bridge.mainSilenceCandidate()
  assert.equal(candidate.eligible,true)
  assert.match(candidate.sourceKey,new RegExp('^'+tag+':main-silence:'))
  handlers.get('agent/inbox/inserted')({role:'user',id:'new-u2',source:{kind:'dsh-chat'}})
  assert.equal(bridge.mainSilenceCandidate().eligible,false)
  assert.equal((await bridge.initiateOwnerChat({sourceKey:candidate.sourceKey,eventKind:'owner-silence'})).ok,false)
  assert.equal(followups.length,0)
  bridge.stop()
  assert.equal(handlers.size,0)
}))

test('owner Bstation DM model may skip silence without sending and without replaying the same owner turn',async()=>withDir(async dir=>{
  const {createOwnerDmAgent}=await import('../lib/owner-dm-agent.mjs')
  let t=date(12),sent=[],probes=0,modelCalls=0
  const cfg={masterEnabled:true,lifeAgentMode:'active',ownerSpontaneousChatEnabled:true,
    ownerDmSilenceFollowupEnabled:true,ownerDmAgentEnabled:true,dmWatch:true,dmOwnerUid:'123',ownerContactPreset:'lively',dmP6Enabled:true,dmP6MaxBubbles:3}
  const client=createOwnerDmAgent({dataDir:dir,now:()=>t,getConfig:()=>cfg,getAccountTag:()=>tag,
    getPersona:()=> '大肥鱼长期人格（不包含固定语气强制）',probeOwnerIncoming:async()=>{probes++;return []},
    reserveOwnerContact:()=>{throw Error('skip must never reserve')},
    invokeModel:async prompt=>{modelCalls++;return JSON.stringify({action:modelCalls===1?'reply':'skip',text:'刚刚看到的真有趣',messages:modelCalls===1?['刚刚看到的真有趣']:[]})},
    executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:true}),send:async msg=>{sent.push(msg);return {ok:true,receiptId:'verified-'+sent.length}},logger:{warn(){}}})
  client.primeInbox([])
  const row={incoming:true,senderUid:'123',messageId:'message-one',timestampMs:t,text:'鱼鱼在吗'}
  const original=await client.processMessage(row)
  assert.equal(original.ok,true);assert.equal(sent.length,1)
  t+=22*60_000
  const r=await client.considerSilence()
  assert.equal(r.chosen,'silent')
  assert.equal(sent.length,1)
  assert.equal(modelCalls,2)
  assert.equal((await client.considerSilence()).reason,'already-considered')
  assert.ok(probes>=1)
}))
