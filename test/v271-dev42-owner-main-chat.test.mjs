import test from 'node:test'
import {createHash} from 'node:crypto'
import {ownerExplorationCandidate,ownerExplorationInboxCurrent,deliverOwnerExploration} from '../lib/life-experience-continuity.mjs'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMainSessionBridge} from '../lib/main-session-bridge.mjs'
import {plannerActionMenu,validateOfferedLifeAction} from '../lib/autonomous-planner.mjs'

const scope='1234567890abcdef',id='abcdef012345abcdef012345'
const key=scope+':'+id
const at=new Date('2026-11-09T12:00:00').getTime()
const config=()=>({masterEnabled:true,lifeAgentMode:'active',mainSessionBridgeEnabled:true,
  ownerSpontaneousChatEnabled:true,mainSessionId:'main'})
function harness({cfg=config(),clock=at,fail=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'owner-chat-')),calls=[]
  let t=clock
  const agent={id:'main',followup:async m=>{calls.push(m);if(fail)throw Error('transport timeout: secret 123')}}
  const agents={get:(id)=>id==='main'?agent:null,list:()=>[agent]}
  const make=()=>createMainSessionBridge({dataDir:dir,agents,getConfig:()=>cfg,now:()=>t,
    getWatched:()=>[],getComments:()=>({rows:[]}),logger:{warn(){}}})
  return {dir,calls,make,setTime:value=>{t=value},cleanup:()=>rmSync(dir,{recursive:true,force:true})}
}
test('Life makes owner contact a selectable but nonmandatory action with exact verified source',()=>{
  const events=[{id,kind:'experience-ready'},{id:'b'.repeat(24),kind:'dm-received'}]
  const menu=plannerActionMenu({lifeEvents:events,ownerChatAvailable:true})
  assert.deepEqual(menu.find(x=>x.action==='talk_to_owner').ids,[id,'owner-idle'])
  assert.equal(validateOfferedLifeAction({action:'talk_to_owner',id},menu),true)
  assert.equal(validateOfferedLifeAction({action:'talk_to_owner',id:'owner-idle'},menu),true)
  assert.equal(validateOfferedLifeAction({action:'talk_to_owner',id:'c'.repeat(24)},menu),false)
  assert.equal(plannerActionMenu({lifeEvents:events,ownerChatAvailable:false}).some(x=>x.action==='talk_to_owner'),false)
})
test('opt-in, quiet time and exact online main session gate proactive messages',async()=>{
  const h=harness();try{
    const bridge=h.make()
    assert.equal(bridge.ownerChatReadiness({sourceKey:key}).eligible,true)
    assert.equal((await bridge.initiateOwnerChat({sourceKey:key,eventKind:'video-round-ended',reason:'test'})).ok,false)
    assert.equal(h.calls.length,0)
    const result=await bridge.initiateOwnerChat({sourceKey:key,eventKind:'experience-ready',reason:'想到一件事'})
    assert.equal(result.ok,true);assert.equal(result.queued,true);assert.equal(result.delivered,false)
    assert.equal(h.calls.length,1)
    assert.equal(h.calls[0].source.kind,'dafeiyu-life-owner-chat')
    assert.match(h.calls[0].content[0].text,/可以自然地分享自己的想法/)
    assert.equal((await h.make().initiateOwnerChat({sourceKey:key,eventKind:'experience-ready'})).reason,'source-used')
    assert.equal(h.calls.length,1)
    const state=JSON.parse(readFileSync(join(h.dir,'main-session-memory.json'),'utf8'))
    assert.equal(state.ownerChatAttempts.length,1);assert.equal(state.ownerChatAttempts[0].status,'queued')
  }finally{h.cleanup()}
})
test('host transport uncertainty is never retried or described as delivered',async()=>{
  const h=harness({fail:true});try{
    const bridge=h.make(),result=await bridge.initiateOwnerChat({sourceKey:key,eventKind:'experience-ready',reason:'want to talk'})
    assert.equal(result.ok,false);assert.equal(result.uncertain,true)
    assert.equal((await h.make().initiateOwnerChat({sourceKey:key,eventKind:'experience-ready'})).ok,false)
    assert.equal(h.calls.length,1)
    const status=h.make().status().ownerChat
    assert.equal(status.attempts[0].status,'unknown')
    assert.doesNotMatch(JSON.stringify(status),/secret 123|main|abcdef/)
  }finally{h.cleanup()}
})
test('disabled permission never schedules and quiet hours block',async()=>{
  const h=harness({cfg:{...config(),ownerSpontaneousChatEnabled:false}});try{
    assert.equal(h.make().ownerChatReadiness().reason,'not-authorized')
    assert.equal((await h.make().initiateOwnerChat({sourceKey:key,eventKind:'experience-ready'})).ok,false)
    h.setTime(new Date('2026-11-09T23:00:00').getTime())
    const h2=harness({clock:new Date('2026-11-09T23:00:00').getTime()})
    try{assert.equal(h2.make().ownerChatReadiness().reason,'quiet-hours')}finally{h2.cleanup()}
  }finally{h.cleanup()}
})
test('main session spontaneous communication does not override EmotionRecall suspension or install style cards',()=>{
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const bridge=readFileSync(new URL('../lib/main-session-bridge.mjs',import.meta.url),'utf8')
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  assert.match(src,/paused:true, \/\/ 2\.6\.0:/)
  assert.match(src,/runOwnerChat:async/)
  assert.match(src,/ownerSpontaneousChatEnabled: z\.boolean\(\)\.default\(true\)/)
  assert.match(html,/owner-spontaneous-chat-enabled/)
  assert.doesNotMatch(html,/俏皮碎碎念|温柔日常/)
  assert.match(bridge,/agent\.followup/)
})

test('Life may chat without an event, but cannot reuse idle opportunity on restart',async()=>{
  const h=harness();try{
    const source=scope+':idle:2026-11-09'
    const r=await h.make().initiateOwnerChat({sourceKey:source,eventKind:'self-initiated',reason:'今天忽然想说说话'})
    assert.equal(r.ok,true)
    assert.equal(h.calls.length,1)
    assert.equal(h.make().ownerChatReadiness({sourceKey:source}).reason,'source-used')
  }finally{h.cleanup()}
})
test('4h natural contact spacing and two-attempt daily limit remain durable',async()=>{
  const h=harness();try{
    assert.equal((await h.make().initiateOwnerChat({sourceKey:key,eventKind:'experience-ready'})).ok,true)
    h.setTime(new Date('2026-11-09T15:59:00').getTime())
    const second=scope+':'+'e'.repeat(24)
    assert.equal(h.make().ownerChatReadiness({sourceKey:second}).reason,'cooldown')
    h.setTime(new Date('2026-11-09T21:00:00').getTime())
    assert.equal((await h.make().initiateOwnerChat({sourceKey:second,eventKind:'experience-ready'})).ok,true)
    const third=scope+':'+'f'.repeat(24)
    assert.equal(h.make().ownerChatReadiness({sourceKey:third}).reason,'cooldown')
    assert.equal(h.make().status().ownerChat.attempts.length,2)
  }finally{h.cleanup()}
})

test('real Life planner can select owner-idle when there are no other Life candidates',async()=>{
  const {createAutonomousPlanner}=await import('../lib/autonomous-planner.mjs')
  const dir=mkdtempSync(join(tmpdir(),'life-owner-idle-'))
  try{
    let calls=0,selected=0,prompt=''
    const planner=createAutonomousPlanner({dataDir:dir,now:()=>at,
      getConfig:()=>({...config(),autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:6,autonomousPlannerMinutes:5,
        autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
      getLifeAccountTag:()=>scope,getLifeEvents:()=>[],getLifeEventStatus:()=>({}),getTodos:()=>[],
      getOwnerChatReadiness:()=>({eligible:true}),runOwnerChat:async input=>{selected++;assert.equal(input.id,'owner-idle');return {ok:true,queued:true,delivered:false}},
      invokeModel:async p=>{calls++;prompt=p;return JSON.stringify({action:'talk_to_owner',id:'owner-idle',reason:'我有点想聊聊'})},
      reflectionStatus:()=>({canAutoReflect:false,pending:0}),executeRead:async()=>({ok:false}),updateTodo:()=>({ok:false}),reflect:async()=>({ok:false})})
    const r=await planner.tick({force:true})
    assert.equal(calls,1)
    assert.equal(selected,1)
    assert.equal(r.action,'talk_to_owner')
    assert.equal(r.result,'owner-chat-queued')
    assert.match(prompt,/talk_to_owner/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('Life model may refuse contact without calling main Session',async()=>{
  const {createAutonomousPlanner}=await import('../lib/autonomous-planner.mjs')
  const dir=mkdtempSync(join(tmpdir(),'life-owner-rest-'))
  try{
    let called=false
    const planner=createAutonomousPlanner({dataDir:dir,now:()=>at,
      getConfig:()=>({...config(),autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:6,
        autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
      getLifeAccountTag:()=>scope,getLifeEvents:()=>[],getLifeEventStatus:()=>({}),getTodos:()=>[],
      getOwnerChatReadiness:()=>({eligible:true}),runOwnerChat:async()=>{called=true;return {ok:true}},
      invokeModel:async()=>JSON.stringify({action:'skip',reason:'我现在不想打扰主人'}),
      reflectionStatus:()=>({canAutoReflect:false,pending:0}),executeRead:async()=>({ok:false}),updateTodo:()=>({ok:false}),reflect:async()=>({ok:false})})
    const r=await planner.tick({force:true})
    assert.equal(r.result,'voluntary-rest')
    assert.equal(called,false)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

// The new path derives from the original owner message + exact Episode and
// still-live visual evidence. No TODO, new polling queue or model vote.
const ownerUid='12345',video='BV1xx411c7mD',sharedAt=at-60_000
const message={incoming:true,system:false,senderUid:ownerUid,messageId:ownerUid+':123',timestampMs:sharedAt,text:'https://www.bilibili.com/video/'+video}
function explorationFixture(){
 const shareId=createHash('sha256').update([scope,ownerUid,message.messageId,JSON.stringify({kind:'video',bvid:video})].join('\0')).digest('hex').slice(0,24)
 const share={id:shareId,at:sharedAt,senderRole:'owner',senderUid:ownerUid,bvid:video,status:'inspected',resolvedKind:'video',title:'原分享视频',deferredExploration:{goal:'observe_video',at:sharedAt+1}}
 const episode={id:'episode-1',source:'inspected-opportunity',sourceId:'friend-shared-bili-link:'+shareId,expiresAt:at+60_000,status:'inspected',observedVideoBvids:[video],episodeHistory:[{action:'observe-video',bvid:video,at:at-1000,frameCount:3,visualSource:'decoded-public-video'}]}
 const evidence={readOnly:true,visibility:'public-event',memoryId:'e-'+'a'.repeat(18),bvid:video,at:at-2000,sources:['visual-model-observation'],visual:{source:'decoded-public-video',frameCount:3}}
 return {uid:ownerUid,now:at,share,episodes:[episode],visualEvidence:[evidence]}
}
test('owner voluntary exploration candidate needs its own visual receipt and current public memory',()=>{
 const f=explorationFixture(),c=ownerExplorationCandidate(f)
 assert.equal(c.bvid,video);assert.equal(c.frameCount,3)
 for(const change of [x=>x.share.senderRole='friend',x=>x.share.senderUid='12346',x=>delete x.share.deferredExploration,
  x=>x.episodes[0].sourceId='friend-shared-bili-link:'+id,x=>x.episodes[0].episodeHistory[0].action='inspect-video',
  x=>x.episodes[0].episodeStatus='review',x=>x.visualEvidence=[],x=>x.visualEvidence[0].visibility='owner-private',
  x=>x.visualEvidence[0].at=sharedAt-1,x=>x.now=sharedAt+25*3600_000]){
  const copy=structuredClone(f);change(copy);assert.equal(ownerExplorationCandidate(copy),null)
 }
})
test('owner inbox probe verifies exact original share and refuses newer or ambiguous inputs',()=>{
 const candidate=ownerExplorationCandidate(explorationFixture()),verify=rows=>ownerExplorationInboxCurrent({rows,scope,uid:ownerUid,candidate})
 assert.equal(verify([message]),true)
 assert.equal(verify([]),false)
 assert.equal(verify([{...message,messageId:'other'}]),false)
 assert.equal(verify([{...message,text:'https://www.bilibili.com/video/BV1yy411c7mD'}]),false)
 assert.equal(verify([message,{...message,messageId:'new',timestampMs:at,text:'先聊别的吧'}]),false)
 assert.equal(verify([message,{...message,messageId:'same-second'}]),false)
 assert.equal(verify([message,{...message,messageId:'older',timestampMs:sharedAt-1000}]),true)
})
function deliveryFixture(){
 const candidate=ownerExplorationCandidate(explorationFixture()),calls=[]
 let live=candidate,used=false
 return {calls,setLive:value=>{live=value},input:{candidate,scope,uid:ownerUid,text:'刚才抽样了解了那个视频，感觉挺有意思。',
  getCurrent:()=>live,probe:async()=>[message],checkText:()=>true,reserve:()=>{if(used)return {ok:false,reason:'source-used'};used=true;calls.push('reserve');return {ok:true}},
  settle:s=>calls.push(s),send:async(_body,guard)=>{assert.equal(guard(),true);calls.push('send');return {ok:true,receiptId:'message-key-123'}},onConfirmed:()=>calls.push('project')}}
}
test('confirmed exploration sends once; original reservation prevents duplicate',async()=>{
 const f=deliveryFixture()
 assert.deepEqual(await deliverOwnerExploration(f.input),{ok:true,delivered:true})
 assert.deepEqual(f.calls,['reserve','send','confirmed','project'])
 assert.equal((await deliverOwnerExploration(f.input)).ok,false)
 assert.deepEqual(f.calls,['reserve','send','confirmed','project'])
})
test('new owner message or forgotten evidence before reservation blocks without a send',async()=>{
 for(const mode of ['new','forgotten','unavailable','bad-expression']){
  const f=deliveryFixture()
  if(mode==='new')f.input.probe=async()=>[message,{...message,messageId:'new',timestampMs:at}]
  if(mode==='forgotten')f.input.probe=async()=>{f.setLive(null);return [message]}
  if(mode==='unavailable')f.input.probe=async()=>{throw Error('network')}
  if(mode==='bad-expression')f.input.text='我刚刚看完了整个视频，真好听！'
  assert.equal((await deliverOwnerExploration(f.input)).ok,false);assert.deepEqual(f.calls,[])
 }
})
test('revocation while waiting for platform dispatch and unknown receipts never project success',async()=>{
 for(const mode of ['revoked','unknown','missing-receipt']){
  const f=deliveryFixture()
  f.input.send=async(_body,guard)=>{if(mode==='revoked'){f.setLive(null);assert.equal(guard(),false);return {ok:false,notAttempted:true}}
    if(mode==='unknown')throw Error('transport');return {ok:true}}
  const r=await deliverOwnerExploration(f.input);assert.equal(r.ok,false)
  assert.deepEqual(f.calls,['reserve',mode==='revoked'?'blocked':'unknown'])
 }
})
test('existing contact ledger requires explicit owner options and shares cooldown with main Session',()=>{
 const f=explorationFixture(),sourceKey=scope+':dm-exploration:'+f.share.id
 const cfg={...config(),dmWatch:true,dmOwnerUid:ownerUid,ownerDmAgentEnabled:true,ownerDmSilenceFollowupEnabled:true,ownerTodoCompletionFollowupEnabled:false}
 const h=harness({cfg});try{
  const bridge=h.make();assert.equal(bridge.ownerChatReadiness({sourceKey,channel:'owner-dm'}).eligible,false)
  assert.equal(bridge.reserveOwnerContact({sourceKey,channel:'owner-dm'}).ok,false)
  cfg.ownerTodoCompletionFollowupEnabled=true
  assert.equal(bridge.reserveOwnerContact({sourceKey,channel:'main'}).ok,false)
  assert.equal(bridge.ownerChatReadiness({sourceKey,channel:'owner-dm'}).eligible,true)
  assert.equal(bridge.reserveOwnerContact({sourceKey,channel:'owner-dm'}).ok,true)
  assert.equal(bridge.settleOwnerContact({sourceKey,status:'confirmed'}).ok,true)
  assert.equal(h.make().reserveOwnerContact({sourceKey,channel:'owner-dm'}).reason,'source-used')
  assert.equal(h.make().ownerChatReadiness({sourceKey:key}).reason,'cooldown')
 }finally{h.cleanup()}
})
test('original Planner offers exact exploration without main Session and may choose silence',async()=>{
 const candidate=ownerExplorationCandidate(explorationFixture())
 for(const mode of ['confirm','skip','generation-changed']){
  const dir=mkdtempSync(join(tmpdir(),'owner-explore-planner-'));try{
   let generation=1,called=0
   const {createAutonomousPlanner}=await import('../lib/autonomous-planner.mjs')
   const planner=createAutonomousPlanner({dataDir:dir,now:()=>at,
    getConfig:()=>({...config(),autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:6,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
    getLifeAccountTag:()=>scope,getLifeAccountGeneration:()=>generation,getLifeEvents:()=>[],getLifeEventStatus:()=>({}),getTodos:()=>[],
    getOwnerChatReadiness:()=>({eligible:true,mainAvailable:false,explorations:[candidate]}),
    runOwnerChat:async x=>{called++;assert.deepEqual(x.exploration,candidate);assert.equal(x.expectedGeneration,1);assert.equal(x.text,'这个视频的抽样画面挺有意思。');return {ok:true,delivered:true}},
    invokeModel:async prompt=>{assert.match(prompt,/owner-exploration:/);if(mode==='generation-changed')generation=2;return JSON.stringify(mode==='skip'?{action:'skip'}:{action:'talk_to_owner',id:candidate.id,text:'这个视频的抽样画面挺有意思。',reason:'想分享探索'})},
    reflectionStatus:()=>({canAutoReflect:false,pending:0}),executeRead:async()=>({ok:false}),updateTodo:()=>({ok:false}),reflect:async()=>({ok:false})})
   const menu=plannerActionMenu({ownerChatAvailable:true,ownerMainChatAvailable:false,ownerExplorationCandidates:[candidate]})
   assert.deepEqual(menu.find(x=>x.action==='talk_to_owner').ids,[candidate.id])
   const r=await planner.tick({force:true})
   assert.equal(called,mode==='confirm'?1:0);assert.equal(r.result,mode==='confirm'?'owner-chat-confirmed':mode==='skip'?'voluntary-rest':'owner-chat-evidence-expired')
  }finally{rmSync(dir,{recursive:true,force:true})}
 }
})
test('owner exploration choice is sealed on existing willingness fence without another model vote',async()=>{
 const {createLifeWillingness}=await import('../lib/life-willingness.mjs'),dir=mkdtempSync(join(tmpdir(),'owner-explore-seal-'))
 try{
  let calls=0,activeScope=scope
  const will=createLifeWillingness({dataDir:dir,getAccountTag:()=>activeScope,getContext:()=>'',invokeModel:async()=>{calls++;return ''},now:()=>at})
  const candidate=ownerExplorationCandidate(explorationFixture()),sourceKey=scope+':dm-exploration:'+candidate.shareId,text='抽样画面让我有些好奇。'
  const choice=will.adoptOwnerExplorationDecision({uid:ownerUid,sourceKey,text})
  assert.equal(choice.ok,true)
  assert.equal(will.verify(choice.proof,'followup',{uid:'12346',targetKey:sourceKey,text}).ok,false)
  assert.equal(will.verify(choice.proof,'followup',{uid:ownerUid,targetKey:sourceKey,text:'编辑过的文本'}).ok,false)
  assert.equal(will.verify(choice.proof,'followup',{uid:ownerUid,targetKey:sourceKey,text}).ok,true)
  assert.equal(will.verify(choice.proof,'followup',{uid:ownerUid,targetKey:sourceKey,text}).ok,false)
  assert.equal(will.receipt(choice.proof,{status:'verified',receiptId:'bili-dm:123'}).ok,true);assert.equal(calls,0)
  activeScope='b'.repeat(16);assert.equal(will.adoptOwnerExplorationDecision({uid:ownerUid,sourceKey,text}).ok,false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('real shared-link, voluntary Episode and live Gateway agree before offering owner followup',async()=>{
 const {createLifeSharedBiliLinks}=await import('../lib/life-shared-bili-links.mjs')
 const {createLifeOpportunities}=await import('../lib/life-opportunities.mjs')
 const {createLifeMemoryGateway}=await import('../lib/life-memory-gateway.mjs')
 const dir=mkdtempSync(join(tmpdir(),'owner-explore-ledgers-'));let clock=sharedAt
 const links=createLifeSharedBiliLinks({stateDir:dir,getAccountTag:()=>scope,now:()=>clock})
 const opportunities=createLifeOpportunities({stateDir:dir,getCredential:()=>({dedeuserid:'1234567',sessdata:'test'}),getAccountTag:()=>scope,now:()=>clock})
 const gateway=createLifeMemoryGateway({dataDir:dir,getAccountTag:()=>scope,now:()=>clock,getConfig:()=>({mainSessionMemoryHalfLifeDays:1})})
 try{
  const shareId=links.offerFromMessage({uid:ownerUid,role:'owner',text:message.text,messageId:message.messageId,at:clock}).ids[0]
  const input=()=>({uid:ownerUid,now:clock,share:links.get(shareId,scope),episodes:opportunities.intentions({includeClosed:true,limit:20}),visualEvidence:gateway.videoEvidenceTrace({accountTag:scope,bvid:video,visualOnly:true})})
  assert.equal(links.recordExplorationIntent(shareId,{uid:ownerUid,role:'owner',goal:'observe_video'},scope).ok,true)
  clock+=1000
  assert.equal(links.recordRead(shareId,{ok:true,kind:'video',bvid:video,title:'原分享视频'},scope).ok,true)
  const episode=opportunities.beginSharedVideoExploration(shareId,{ok:true,sourceId:shareId,accountTag:scope,at:clock,bvid:video,title:'原分享视频'},scope)
  assert.equal(episode.ok,true);assert.equal(ownerExplorationCandidate(input()),null)
  clock+=2000
  gateway.recordEvents([{kind:'watch',key:'verified-explore-sample',bvid:video,title:'原分享视频',at:clock,accountTag:scope,
   experience:{source:'bili-life',metadata:true,preview:true,vision:true,evidenceSchema:'life-video-evidence/v1',visualReceipt:{source:'low-resolution-preview',frameCount:2,firstAtMs:1000,lastAtMs:9000},visualSceneNotes:['出现两个角色'],purpose:'自主探索'}}])
  assert.equal(ownerExplorationCandidate(input()),null,'memory alone does not prove original episode observed')
  clock+=1000
  assert.equal(opportunities.recordVideoVisual(opportunities.intentions()[0].id,{ok:true,bvid:video,depth:'standard',source:'low-resolution-preview',frameCount:2},scope).ok,true)
  const candidate=ownerExplorationCandidate(input());assert.equal(candidate.shareId,shareId)
  assert.equal(gateway.recentVisualExperienceContext({accountTag:scope,memoryIds:[candidate.memoryId],limit:1})[0].memoryId,candidate.memoryId)
  assert.equal(ownerExplorationInboxCurrent({scope,uid:ownerUid,candidate,rows:[message]}),true)
  assert.equal(links.decide(shareId,'dismiss').ok,true);assert.equal(ownerExplorationCandidate(input()),null)
 }finally{gateway.close();rmSync(dir,{recursive:true,force:true})}
})
