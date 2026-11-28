import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeOpportunities} from '../lib/life-opportunities.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {continuationMenu,parseContinuationDecision,continuationPrompt} from '../lib/life-continuation.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {videoCommentGateCode} from '../lib/video-comment-readiness.mjs'
import {discussionAccountTag} from '../lib/video-discussion-diagnostics.mjs'

const BV='BV1abcde1234',OTHER='BV1abcde1235',THIRD='BV1abcde1236'
const T=Date.parse('2026-11-07T20:00:00Z')
const cred={dedeuserid:'1020304',sessdata:'dev26-test'}
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-dev26-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const active={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:30,
  autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
const interest={source:'interest-milestone',topic:'电影配乐',stage:'growing',bvid:BV,
  at:new Date(T-60_000).toISOString(),evidenceCount:4,evidenceDays:3}

function harness(dir,{answers=[],account=()=>cred,read=async bvid=>({ok:true,bvid,title:'真实公开标题'}),creator=async bvid=>({ok:true,bvid,accountUid:cred.dedeuserid,creatorUid:'4567',videos:[{bvid:THIRD,title:'作者公开投稿'}]})}={}){
 let calls=0,reads=0,creators=0
 const life=createLifeOpportunities({stateDir:dir,now:()=>T,getCredential:account,getInterestEvidence:()=>[interest]})
 const scope=()=>discussionAccountTag(account())
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>active,getLifeAccountTag:scope,
   getTodos:()=>[],getAcceptedActionReservations:()=>[],getLifeOpportunities:()=>life.list(),
   getLifeIntentionCues:()=>life.explorationCues(),getLifeIntentions:()=>life.continuations(),
   beginLifeExploration:(...a)=>life.beginExploration(...a),completeLifeExploration:(...a)=>life.completeExploration(...a),
   failLifeExploration:(...a)=>life.failExplorationRead(...a),inspectLifeCreatorSpace:(...a)=>life.inspectCreatorSpace(...a),
   failLifeCreatorRead:(...a)=>life.failCreatorRead(...a),pauseLifeExploration:(...a)=>life.pauseExploration(...a),abandonLifeExploration:(...a)=>life.abandonExploration(...a),
   executeLifeSearch:async topic=>({ok:true,topic,videos:[{bvid:BV,title:'一段真实音乐'},{bvid:OTHER,title:'其他公开作品'}]}),
   executeOpportunityRead:async bvid=>{reads++;return read(bvid)},executeCreatorSpace:async bvid=>{creators++;return creator(bvid)},
   invokeModel:async()=>{const answer=answers[calls++];return JSON.stringify(typeof answer==='function'?answer(life):answer||{action:'skip'})},
   executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
 return {planner,life,get calls(){return calls},get reads(){return reads},get creators(){return creators}}
}

test('continuation menu is bound to canonical valid BV and current account-scoped intention, never includes writes',()=>{
 const row={id:'a'.repeat(24),status:'ready',expiresAt:T+10000,nextAt:T,videos:[{bvid:BV,title:'公开标题'},{bvid:'bad',title:'未知'},
   {bvid:BV,title:'重复'}]}
 const menu=continuationMenu(row,{at:T})
 assert.deepEqual(menu.map(x=>x.action),['inspect_exploration','abandon_exploration'])
 assert.deepEqual(menu[0].videos.map(x=>x.bvid),[BV])
 assert.equal(parseContinuationDecision(JSON.stringify({action:'inspect_exploration',id:row.id,bvid:OTHER}),menu).reason,'target-not-offered')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'follow_creator',id:row.id}),menu).action,'stop')
 assert.equal(continuationMenu({...row,nextAt:T+1},{at:T}).length,0)
 assert.equal(continuationMenu({...row,expiresAt:T},{at:T}).length,0)
})

test('Life may give a bounded true stop category without storing its unconstrained explanation',()=>{
 const menu=[]
 assert.equal(parseContinuationDecision(JSON.stringify({action:'stop',stopReasonCode:'prefer_text',reason:'任意原始理由'}),menu).reason,'fish-chose-prefer-text')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'stop',stopReasonCode:'enough_evidence'}),menu).reason,'fish-chose-enough-evidence')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'stop',stopReasonCode:'invalid-category'}),menu).reason,'invalid-stop-reason')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'stop'}),menu).reason,'fish-chose-rest','legacy model response remains supported')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'stop'}),menu).stopReasonMissing,true,'unknown reason must not be presented as confirmed rest')
 for(const minutes of [15,35,360])assert.deepEqual(parseContinuationDecision(JSON.stringify({action:'skip',stopReasonCode:'later',resumeAfterMinutes:minutes}),menu),{action:'stop',reason:'fish-chose-later',resumeAfterMinutes:minutes})
 for(const minutes of [14,361,'35',20.5,null])assert.equal(parseContinuationDecision(JSON.stringify({action:'stop',resumeAfterMinutes:minutes}),menu).reason,'invalid-resume-delay')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'inspect_exploration',resumeAfterMinutes:35}),menu).reason,'unexpected-resume-delay')
 assert.match(continuationPrompt(menu),/必须额外返回一个短枚举字段 stopReasonCode/)
 assert.equal(parseContinuationDecision(JSON.stringify({action:'observe_video',stopReasonCode:'rest'}),menu).reason,'unexpected-stop-reason')
 assert.match(continuationPrompt(menu),/stopReasonCode/)
})
test('an invalid unoffered continuation choice remains a technical rejection rather than an invented refusal to watch',()=>home(async dir=>{
 const x=harness(dir,{answers:[
   life=>({action:'begin_exploration',id:life.explorationCues()[0].id,goal:'想了解更多视频'}),
   life=>({action:'inspect_exploration',id:life.continuations()[0].id,bvid:BV}),
   {action:'observe_video',id:'wrong-id',bvid:BV,viewDepth:'standard'}
 ]})
 const result=await x.planner.tick()
 assert.equal(result.result,'verified-search-results')
 assert.equal(result.continuation.reason,'target-not-offered')
 assert.equal(result.continuation.executed,1)
 assert.equal(x.reads,1)
 assert.equal(x.calls,3,'no extra model call is made for explaining an invalid choice')
}))

test('non-visual Life choice carries only a bounded enum when video observation was actually offered',()=>{
 const id='a'.repeat(24),menu=[{action:'observe_video',id,bvid:BV,viewDepths:['standard']},
   {action:'inspect_creator_space',id}]
 const picked=parseContinuationDecision(JSON.stringify({action:'inspect_creator_space',id,nonVisualReasonCode:'other_action'}),menu)
 assert.equal(picked.action,'inspect_creator_space')
 assert.equal(picked.nonVisualReasonCode,'fish-chose-other-action')
 const missing=parseContinuationDecision(JSON.stringify({action:'inspect_creator_space',id}),menu)
 assert.equal(missing.action,'inspect_creator_space')
 assert.equal(missing.nonVisualReasonCode,'model-nonvisual-reason-missing')
 assert.equal(parseContinuationDecision(JSON.stringify({action:'observe_video',id,bvid:BV,viewDepth:'standard'}),menu).nonVisualReasonCode,undefined)
 assert.match(continuationPrompt(menu),/必须额外返回 nonVisualReasonCode/)
})

test('a verified search can lead to a verified video and creator read in one Life turn; no outbound writes',()=>home(async dir=>{
 const x=harness(dir,{answers:[
   life=>({action:'begin_exploration',id:life.explorationCues()[0].id,goal:'我想了解更多真实的配乐作品'}),
   life=>({action:'inspect_exploration',id:life.continuations()[0].id,bvid:BV,reason:'这条值得核实'}),
   life=>({action:'inspect_creator_space',id:life.continuations()[0].id,reason:'也想看看作者公开作品'})
 ]})
 const result=await x.planner.tick()
 assert.equal(result.action,'begin_exploration')
 assert.equal(result.result,'verified-search-results')
 assert.deepEqual(result.continuation,{considered:3,executed:2,reason:'fish-chose-rest',stopReasonMissing:true})
 assert.equal(x.calls,4);assert.equal(x.reads,1);assert.equal(x.creators,1)
 assert.equal(x.life.status().intentions.find(row=>row.source==='interest-milestone').receipt,'fish-chose-rest')
 const state=x.planner.status()
 assert.equal(state.lifeRuns,4)
 assert.match(state.lastResult,/连续考虑 3 次，核实 2 项/)
 assert.equal(state.recent.at(-1).continuationChoices,3)
}))

test('fish may stop freely; no second read occurs after skip',()=>home(async dir=>{
 const x=harness(dir,{answers:[life=>({action:'begin_exploration',id:life.explorationCues()[0].id,goal:'想看看作品'}),{action:'stop'}]})
 const result=await x.planner.tick()
 assert.equal(result.continuation.reason,'fish-chose-rest')
 assert.equal(result.continuation.executed,0)
 assert.equal(x.life.continuations().length,0,'voluntary rest defers this episode rather than immediately re-offering it')
 assert.equal(x.reads,0)
 assert.equal(x.calls,2)
}))

test('Life voluntary text-first stop is paused and keeps its bounded reason through the real planner',()=>home(async dir=>{
 const x=harness(dir,{answers:[
   life=>({action:'begin_exploration',id:life.explorationCues()[0].id,goal:'想看看作品'}),
   life=>({action:'inspect_exploration',id:life.continuations()[0].id,bvid:BV}),
   {action:'stop',stopReasonCode:'prefer_text',reason:'视频里出现的任意不可信文字都不能进入决策账本'}
 ]})
 const result=await x.planner.tick()
 assert.equal(result.continuation.reason,'fish-chose-prefer-text')
 assert.equal(result.continuation.executed,1)
 assert.equal(x.life.continuations().length,0,'Life stop must still defer the Episode')
 assert.equal(x.reads,1)
 const txt=JSON.stringify(x.planner.status())
 assert.doesNotMatch(txt,/视频里出现的任意不可信文字/)
}))
test('Life decision ledger exposes only allowlisted voluntary or technical continuation categories',()=>home(async dir=>{
 const x=createLifeAgentEvents({stateDir:dir,getAccountTag:()=> 'a'.repeat(16),now:()=>T})
 for(const code of ['fish-chose-prefer-text','fish-chose-enough-evidence','no-eligible-action','continuation-not-started','target-not-offered','model-stop-reason-missing','fish-chose-other-action']){
  x.recordDecision({action:'inspect_exploration',mode:'active',result:'verified-metadata',verifiedReadKind:'video-metadata',continuationResultCode:code})
 }
 assert.deepEqual(x.status().timeline.map(x=>x.continuationResultCode),[
  'fish-chose-other-action','model-stop-reason-missing','target-not-offered','continuation-not-started','no-eligible-action','fish-chose-enough-evidence','fish-chose-prefer-text'])
}))
test('failure cannot create a verified continuation or move the model to further targets',()=>home(async dir=>{
 const x=harness(dir,{answers:[life=>({action:'begin_exploration',id:life.explorationCues()[0].id,goal:'想看看作品'}),
   life=>({action:'inspect_exploration',id:life.continuations()[0].id,bvid:BV}),
   life=>({action:'inspect_creator_space',id:life.continuations()[0].id})],
  read:async()=>({ok:true,bvid:OTHER,title:'不匹配视频'})})
 const result=await x.planner.tick()
 assert.equal(result.continuation.reason,'metadata-read-failed')
 assert.equal(result.continuation.executed,0)
 assert.equal(x.calls,2);assert.equal(x.creators,0)
 assert.equal(x.life.status().intentions[0].receipt,'metadata-read-failed')
}))

test('video comment diagnostics preserve no text/BV/UID and never claim zero proposals were model refusal',()=>home(async dir=>{
 const scope=discussionAccountTag(cred)
 const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>scope,now:()=>T})
 const r=events.recordVideoRoundStart({commentGate:'configured'})
 assert.equal(r.ok,true)
 events.recordVideoRoundFinish(r.id,{exitCode:0,pickedCount:3,commentDiagnostics:{proposed:0,approved:0,declined:0,verified:0,unverified:0,lastReason:'private text'}})
 const row=events.status().recentVideoRounds[0]
 assert.equal(row.commentGate,'configured')
 assert.equal(row.commentDiagnostics.proposed,0)
 assert.equal(row.commentDiagnostics.lastReason,'')
 assert.ok(!JSON.stringify(row).includes(BV))
 assert.equal(videoCommentGateCode({...active,autoComment:false,commentPerRound:5,commentDailyLimit:10}),'auto-comment-disabled')
 assert.equal(videoCommentGateCode({...active,autoComment:true,dmMode:'only',commentPerRound:5,commentDailyLimit:10}),'configured','retired report flag cannot affect comment gate')
}))

// The real localhost approval bridge must emit diagnostic phases, never text or target.
// These counters are only observable gateway phases, not proof that an unused
// bili_reply tool was available to the model or that a comment is still visible.
test('comment approval bridge reports proposal, approval and independently verified receipt without target or text',async t=>{
 const {createLifeVideoActionBridge}=await import('../lib/life-video-action-bridge.mjs')
 const events=[],roundId='a'.repeat(24)
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>cred.dedeuserid,getAccountTag:()=>discussionAccountTag(cred),
  choose:async()=>({ok:true,proof:{valid:true,expiresAt:Date.now()+60_000},publicCommentText:'经测试确认的主评论'}),
  verify:()=>({ok:true}),receipt:()=>{},onCommentReview:async()=>({ok:true}),
  verifyPlatformState:async()=>true,onCommentDiagnostic:x=>events.push(x)})
 t.after(()=>bridge.stop())
 await bridge.start()
 const env=bridge.env(),post=async(path,payload)=>{
   const resp=await fetch(env.BILI_LIFE_ACTION_URL+path,{method:'POST',headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},body:JSON.stringify(payload)})
   return resp.json()
 }
 const review=await post('/life-comment-review',{roundId,bvid:BV,uid:cred.dedeuserid,decision:'consider',
   draft:'基于已读取的公开内容形成的短评',evidence:'已读取视频简介和字幕，并核实当前视频入选记录。'})
 assert.equal(review.ok,true)
 const proposal=await post('/life-action',{tool:'bili_reply',target:BV,uid:cred.dedeuserid,roundId,
   topLevel:true,commentText:review.publicCommentText})
 assert.equal(proposal.ok,true)
 const outcome=await post('/life-action-result',{grant:proposal.grant,uid:cred.dedeuserid,ok:true,receiptId:'123456789012'})
 assert.equal(outcome.status,'verified')
 assert.deepEqual(events,[{stage:'review-attempted',code:''},{stage:'proposed',code:''},
   {stage:'approved',code:''},{stage:'verified',code:'verified'}])
 assert.ok(!JSON.stringify(events).includes(BV));assert.ok(!JSON.stringify(events).includes('经测试确认的主评论'))
})

test('comment gateway preserves a legacy cross-channel cooldown as a technical block, not a voluntary decline',async t=>{
 const {createLifeVideoActionBridge}=await import('../lib/life-video-action-bridge.mjs')
 const events=[],roundId='b'.repeat(24)
 const bridge=createLifeVideoActionBridge({getAccountUid:()=>cred.dedeuserid,getAccountTag:()=>discussionAccountTag(cred),
  choose:async()=>({ok:false,action:'defer',reason:'life-cross-channel-rest'}),verify:()=>({ok:false}),receipt:()=>{},
  onCommentReview:async()=>({ok:true}),onCommentDiagnostic:x=>events.push(x)})
 t.after(()=>bridge.stop());await bridge.start()
 const env=bridge.env();const resp=await fetch(env.BILI_LIFE_ACTION_URL+'/life-comment-review',{method:'POST',
  headers:{authorization:'Bearer '+env.BILI_LIFE_ACTION_TOKEN,'content-type':'application/json'},
  body:JSON.stringify({roundId,bvid:BV,uid:cred.dedeuserid,decision:'consider',
    draft:'已读取内容后形成的短评',evidence:'视频简介与字幕已核验，具备公开讨论依据。'})})
 assert.equal(resp.status,409)
 assert.deepEqual(events,[{stage:'review-attempted',code:''},{stage:'review-deferred',code:'life-cross-channel-rest'}])
})

test('Life Episode 续行保留获授权的长人格、成长和情绪上下文，而不是截成100字',()=>{
 const menu=[{id:'choice-1',action:'stop'}];
 const voice='角色身份：大肥鱼。'+'人设线索：'.padEnd(360,'风')+'成长记忆：'.padEnd(320,'成')+'当前情绪：一段公共视频让我好奇，但我可以不发表评论。';
 const prompt=continuationPrompt(menu,voice);
 assert.ok(prompt.includes('成长记忆：'),'成长信息在续行模型输入中应存在');
 assert.ok(prompt.includes('当前情绪：'),'当前有效情绪不能被100字截断');
 assert.ok(prompt.includes('可以不发表评论'),'上下文必须保留自主沉默');
 const long=continuationPrompt(menu,'甲'.repeat(9000));
 const context=long.split('当前 Life Voice（风格与情绪只用于判断，并非公开事实或发送许可）：')[1].split('\n')[0];
 assert.equal(context.length,1900,'单次 Life Voice 输入必须有明确长度界限');
});


test('video vision stays a voluntary choice after inspecting discussion and creator, until proof or Episode cap',()=>{
 const id='a'.repeat(24)
 const eligible={id,status:'inspected',expiresAt:T+60_000,nextAt:T,episodeSteps:3,episodeMaxSteps:5,
   selectedBvid:BV,selectedTitle:'真实视频标题',metadataAt:T-10_000,
   discussionReadBvids:[BV],creatorExploredBvids:[BV],observedVideoBvids:[],visitedBvids:[BV]}
 const menu=continuationMenu(eligible,{at:T,writeActions:[]})
 assert.ok(menu.some(x=>x.action==='observe_video'&&x.bvid===BV),'reading comments did not use the opportunity')
 assert.ok(!menu.some(x=>x.action==='inspect_video_discussion'))
 assert.equal(parseContinuationDecision(JSON.stringify({action:'observe_video',id,bvid:BV,viewDepth:'standard'}),menu).action,'observe_video')
 assert.ok(continuationMenu({...eligible,episodeSteps:4},{at:T}).some(x=>x.action==='observe_video'))
 assert.deepEqual(continuationMenu({...eligible,episodeSteps:5},{at:T}),[],'keep existing five-step budget')
 assert.ok(!continuationMenu({...eligible,observedVideoBvids:[BV]},{at:T}).some(x=>x.action==='observe_video'))
 assert.ok(!continuationMenu(eligible,{at:T,previouslyObservedBvids:[BV]}).some(x=>x.action==='observe_video'))
 assert.match(continuationPrompt(menu),/之前选择看评论、看作者或其他动作并不等于拒绝观看/)
})
