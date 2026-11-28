import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAutonomousPlanner,parsePlannerDecisionObject,plannerActionMenu,validatePlannerDecision} from '../lib/autonomous-planner.mjs'

const NOW=Date.parse('2026-11-06T10:00:00Z')
const TAG='a'.repeat(16)
const TODO={id:'todo-read',type:'check_notifications',status:'open',title:'检查通知',createdAt:NOW-1000}
const config=()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerMinutes:30,
  autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24})
const inDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-action-menu-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

function rig(dir,{model,rows=[TODO],scope=()=>TAG,opportunities=()=>[],events=()=>[],capabilities=()=>[]}={}){
  let calls=0,reads=0,updates=0
  let prompt=''
  const planner=createAutonomousPlanner({dataDir:dir,getConfig:config,getTodos:()=>rows,now:()=>NOW,
    getLifeAccountTag:scope,getLifeEvents:events,getLifeEventStatus:()=>({pending:0,videoStartsToday:0,lastVideoAt:0}),
    getLifeCapabilities:capabilities,getLifeOpportunities:opportunities,
    invokeModel:async p=>{prompt=p;calls++;return model},executeRead:async()=>{reads++;return {ok:true}},
    updateTodo:async()=>{updates++},reflect:async()=>({ok:true})})
  return {planner,get calls(){return calls},get reads(){return reads},get updates(){return updates},get prompt(){return prompt}}
}

test('single fenced JSON is safe; prose, multiple objects and size overrun are never salvaged',()=>{
  const rows=[TODO]
  for(const content of ['{"action":"skip"}','```json\n{"action":"skip"}\n```','```\r\n{"action":"skip"}\r\n```']){
    assert.equal(validatePlannerDecision(content,rows).action,'skip')
    assert.equal(validatePlannerDecision(content,rows).invalid,undefined)
  }
  for(const text of ['Here: {"action":"skip"}','```json\n{"action":"skip"}\n```\n谢谢',
    '{"action":"skip"}{"action":"execute_read","id":"todo-read"}',
    '```json\n{"action":"skip"}\n```\n```json\n{"action":"execute_read"}\n```',
    ' '.repeat(4097)]){
    assert.equal(validatePlannerDecision(text,rows).diagnosticCode,'model-json-invalid')
  }
  assert.equal(parsePlannerDecisionObject('```json\n[]\n```').error,'model-response-shape')
  assert.equal(validatePlannerDecision('```json\n{"action":"execute_read","id":"fake"}\n```',rows).diagnosticCode,'model-target-invalid')
  assert.equal(validatePlannerDecision('```json\n{"action":"send_dm","id":"todo-read"}\n```',rows).diagnosticCode,'model-action-unknown')
})

test('menu does not advertise unrelated actions, and exact IDs/BV/capability are scoped to their own action',()=>{
  const base=plannerActionMenu({candidates:[TODO],opportunities:[{id:'op1',source:'discussion-read'}],canReflect:false})
  assert.deepEqual(base.map(x=>x.action),['skip','execute_read','defer','dismiss','inspect_opportunity'])
  assert.deepEqual(base.find(x=>x.action==='defer').ids,['todo-read','op1'])
  assert.equal(base.some(x=>x.action==='consider_social'||x.action==='use_capability'||x.action==='reflect'),false)
  const menu=plannerActionMenu({intents:[{id:'int1',status:'ready',selectedBvid:'BVabcdefghij',videos:[{bvid:'BVabcdefghij'}]}],
    lifeEvents:[{id:'social1',kind:'dm-received'},{id:'video1',kind:'manual-wake'}],
    lifeSkills:[{id:'bilibili.video-agent'}],videoEligible:true,canReflect:true})
  assert.deepEqual(menu.find(x=>x.action==='inspect_exploration').targets,[{id:'int1',bvids:['BVabcdefghij']}])
  assert.deepEqual(menu.find(x=>x.action==='consider_social').ids,['social1'])
  assert.deepEqual(menu.find(x=>x.action==='use_capability').capabilities,['bilibili.video-agent'])
  assert.ok(menu.some(x=>x.action==='reflect'))
})

test('fenced valid model choice executes one allowed read with one charged model call',()=>inDir(async dir=>{
  const x=rig(dir,{model:'```json\n{"action":"execute_read","id":"todo-read","reason":"想先看看通知"}\n```'})
  const out=await x.planner.tick({force:true})
  assert.equal(out.ok,true)
  assert.equal(out.action,'execute_read');assert.equal(out.result,'done')
  assert.equal(x.calls,1);assert.equal(x.reads,1);assert.equal(x.planner.status().runs,1)
  const menu=JSON.parse(x.prompt.split('【本轮真正允许的动作和精确目标（这些只是候选，执行仍要后端重新核验）】\n')[1].split('\n')[0])
  assert.deepEqual(menu.map(x=>x.action),['skip','execute_read','defer','dismiss'])
  assert.deepEqual(menu[1].ids,['todo-read'])
  assert.ok(!x.prompt.includes('"action":"use_capability"'))
}))

test('untrusted prose and fabricated action do not execute or re-invoke the model',()=>inDir(async dir=>{
  const x=rig(dir,{model:'这个回答好像可以：{"action":"execute_read","id":"todo-read"}'})
  const out=await x.planner.tick({force:true})
  assert.equal(out.result,'invalid-decision')
  assert.equal(out.diagnosticCode,'model-json-invalid')
  assert.equal(x.calls,1);assert.equal(x.reads,0);assert.equal(x.updates,0)
  assert.equal(x.planner.status().runs,1)
}))

test('an unknown target in fenced JSON is rejected with no write or tool call',()=>inDir(async dir=>{
  const x=rig(dir,{model:'```json\n{"action":"execute_read","id":"invented"}\n```'})
  const out=await x.planner.tick({force:true})
  assert.equal(out.result,'invalid-decision');assert.equal(out.diagnosticCode,'model-target-invalid')
  assert.equal(x.reads,0);assert.equal(x.updates,0)
}))


test('自主延期兴趣仅作为原机会候选，模型可以休息而不执行或建立待办',()=>inDir(async dir=>{
 const id='0123456789abcdef01234567';const x=rig(dir,{model:'{"action":"skip"}',rows:[],opportunities:()=>[{id,source:'owner-shared-bili-link',status:'pending',kind:'video',deferredGoal:'observe_video',at:new Date(NOW-5000).toISOString()}]});
 const out=await x.planner.tick({force:true});assert.equal(out.action,'skip');assert.equal(x.calls,1);assert.equal(x.reads,0);assert.equal(x.updates,0);
 assert.match(x.prompt,/"deferredGoal":"observe_video"/);const menu=JSON.parse(x.prompt.split('【本轮真正允许的动作和精确目标（这些只是候选，执行仍要后端重新核验）】\n')[1].split('\n')[0]);
 assert.deepEqual(menu.find(v=>v.action==='inspect_shared_link').ids,[id]);assert.equal(menu.some(v=>v.action==='execute_read'||v.action==='talk_to_owner'),false);
}));


test('dev47 延期观察原意愿进入真实 Episode 子决策，但不强制观察、不触发外发',()=>inDir(async dir=>{
 const id='0123456789abcdef01234567',bvid='BV1abcde1234',prompts=[];let reads=0,pauses=0
 const row={id,source:'inspected-opportunity',sourceId:'friend-shared-bili-link:'+id,status:'inspected',selectedBvid:bvid,selectedTitle:'已核验公开视频',metadataAt:NOW-1000,expiresAt:NOW+60000,nextAt:NOW-1000,episodeSteps:1,episodeMaxSteps:5,visitedBvids:[bvid],deferredGoal:'observe_video'}
 const planner=createAutonomousPlanner({dataDir:dir,getConfig:()=>({...config(),visionEnabled:true}),getTodos:()=>[],now:()=>NOW,getLifeAccountTag:()=>TAG,
  getLifeIntentions:()=>[row],pauseLifeExploration:(target,ms,scope)=>{assert.equal(target,id);assert.equal(ms,3600000);assert.equal(scope,TAG);pauses++;return {ok:true}},canLifeObserveVideo:()=>true,executeLifeVideoObservation:async()=>{reads++;return {ok:false}},
  invokeModel:async p=>{prompts.push(p);return JSON.stringify(prompts.length===1?{action:'resume_episode',id,reason:'想继续之前的探索'}:{action:'stop',stopReasonCode:'later'})},
  executeRead:async()=>{reads++;return {ok:false}},updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
 const result=await planner.tick();assert.equal(result.action,'resume_episode');assert.equal(result.continuation.reason,'fish-chose-later');assert.equal(reads,0);assert.equal(pauses,1)
 assert.equal(prompts.length,2);assert.match(prompts[0],/"deferredGoal":"observe_video"/);assert.match(prompts[1],/【原自主延期意愿】/);assert.match(prompts[1],/"goal":"observe_video","bvid":"BV1abcde1234"/);assert.doesNotMatch(prompts[1],/friend-shared-bili-link:/)
}))

// Real Planner path: model chooses a public recall, then changes search or
// chooses another action based on actual output, without a new Episode step.
for(const scenario of ['repeat-miss','duplicate','revoked','private','scope-changed','disabled','episode-changed','unavailable','continue-read','last-budget'])test('dev48 Life public recall '+scenario,()=>inDir(async dir=>{
 const id='0123456789abcdef01234567',bvid='BV1abcde1234',other='BV1abcde5678',prompts=[],queries=[];let valid=true,scope=TAG,active=true,observations=0,visualCalls=0,pauses=0,creatorCalls=0
 const row={id,source:'inspected-opportunity',sourceId:'friend-shared-bili-link:'+id,status:'inspected',selectedBvid:bvid,selectedTitle:'当前公开视频',metadataAt:NOW-1000,expiresAt:NOW+60000,nextAt:NOW-1000,episodeSteps:1,episodeMaxSteps:5,visitedBvids:[bvid],deferredGoal:'observe_video'}
 const cfg=()=>({...config(),visionEnabled:true,...(scenario==='last-budget'?{autonomousPlannerDailyLimit:2}:{})})
 const planner=createAutonomousPlanner({dataDir:dir,getConfig:cfg,getTodos:()=>[],now:()=>NOW,getLifeAccountTag:()=>scope,
  getLifeIntentions:()=>[row],canLifeRecallPublicVideo:()=>active&&scenario!=='disabled',validateLifeVideoMemory:()=>valid,
  getRecentLifeVideoMemory:async opts=>{assert.equal(opts.accountTag,TAG);assert.equal(opts.recentFallback,false);queries.push(opts.queries);if(scenario==='scope-changed')scope='b'.repeat(16);if(scenario==='episode-changed')row.status='abandoned';if(scenario==='unavailable')return null;if(queries.length===2)return [];return [{bvid:other,title:'旧观察测试证据',sceneNotes:['旧场景线索'],recallRoute:'direct',...(scenario==='private'?{visibility:'private-session'}:{})}]},
  executeCreatorSpace:async target=>{assert.equal(target,bvid);creatorCalls++;return {ok:true}},inspectLifeCreatorSpace:()=>{row.episodeSteps++;row.creatorExploredBvids=[bvid];return {ok:true}},
  observeLifeVideoMemory:()=>{observations++},pauseLifeExploration:()=>{pauses++;return {ok:true}},canLifeObserveVideo:()=>true,executeLifeVideoObservation:async()=>{visualCalls++;return {ok:false}},
  invokeModel:async p=>{prompts.push(p);if(prompts.length===1)return JSON.stringify({action:'resume_episode',id,reason:'继续探索'});
    if(prompts.length===2){if(['disabled','last-budget'].includes(scenario)){assert.doesNotMatch(p.split('当前合法行动菜单：').at(-1),/"action":"recall_public_experience"/);return JSON.stringify({action:'stop',stopReasonCode:'rest'})}return JSON.stringify({action:'recall_public_experience',id,recallQueries:['旧场景']})}
    assert.match(p,/【本次自主回忆工具回执】/);if(scenario==='unavailable'){assert.match(p,/unavailable/);assert.doesNotMatch(p,/旧观察测试证据/);return JSON.stringify({action:'stop',stopReasonCode:'later'})}assert.match(p,/旧观察测试证据/)
    if(scenario==='continue-read')return JSON.stringify({action:'inspect_creator_space',id})
    if(scenario==='revoked'){valid=false;return JSON.stringify({action:'observe_video',id,bvid,viewDepth:'standard'})}
    if(prompts.length===3)return JSON.stringify({action:'recall_public_experience',id,recallQueries:[scenario==='duplicate'?'旧场景':'另一个线索']})
    assert.match(p,/not-found/);assert.doesNotMatch(p.split('\u5f53\u524d\u5408\u6cd5\u884c\u52a8\u83dc\u5355\uff1a').at(-1),/"action":"recall_public_experience"/);return JSON.stringify({action:'stop',stopReasonCode:'later'})},
  executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
 const result=await planner.tick();assert.equal(result.action,'resume_episode');assert.equal(visualCalls,0);assert.equal(result.continuation.executed,scenario==='continue-read'?1:0);assert.equal(row.episodeSteps,scenario==='continue-read'?2:1)
 if(scenario==='repeat-miss'){assert.deepEqual(queries,[['旧场景'],['另一个线索']]);assert.equal(prompts.length,4);assert.equal(pauses,1);assert.equal(observations,1);assert.equal(result.continuation.reason,'fish-chose-later')}
 else if(scenario==='duplicate'){assert.equal(queries.length,1);assert.equal(result.continuation.reason,'public-recall-duplicate-or-budget')}
 else if(['disabled','last-budget'].includes(scenario)){assert.equal(queries.length,0);assert.equal(pauses,1)}
 else if(scenario==='unavailable'){assert.equal(queries.length,1);assert.equal(pauses,1);assert.equal(observations,0);assert.equal(result.continuation.reason,'fish-chose-later')}
 else if(scenario==='continue-read'){assert.equal(queries.length,1);assert.equal(creatorCalls,1);assert.equal(observations,1);assert.equal(result.continuation.reason,'no-new-public-evidence')}
 else{assert.equal(queries.length,1);assert.equal(pauses,0);assert.equal(result.continuation.reason,'public-recall-evidence-changed');if(scenario!=='revoked')assert.equal(prompts.length,2)}
}))

test('dev48 public recall validates offered exact episode and parameters without granting arbitrary scope',async()=>{
 const {parseContinuationDecision}=await import('../lib/life-continuation.mjs');const id='0123456789abcdef01234567';const menu=[{action:'recall_public_experience',id}]
 const parse=x=>parseContinuationDecision(JSON.stringify(x),menu);const base={action:'recall_public_experience',id,recallQueries:['主题']}
 assert.equal(parse(base).action,'recall_public_experience')
 for(const bad of [{id:'other'},{scope:'owner'},{bvid:'BV1abcde1234'},{recallQueries:['https://example.com']},{recallQueries:[]},{recallQueries:['aa','bb','cc','dd']},{recallQueries:{q:'topic'}}])assert.equal(parse({...base,...bad}).action,'stop')
 assert.equal(parseContinuationDecision(JSON.stringify(base),[]).action,'stop')
})

// Registered route names share a read gateway, not their authorization/domain.
test('dev49 shared read registry rejects cross-scene routes, writes and revoked scopes',async()=>{
 const {registeredLifeRead,executeRegisteredLifeRead}=await import('../lib/life-agent-read-runtime.mjs');let calls=0,current=true
 const run=(scene,actions,read=async()=>{calls++;return {ok:true}})=>executeRegisteredLifeRead({scene,actions,isCurrent:()=>current,read})
 assert.equal(registeredLifeRead('social','read_memory').kind,registeredLifeRead('episode','recall_public_experience').kind)
 assert.equal(registeredLifeRead('episode','inspect_creator_space').kind,'public_person')
 for(const [scene,actions] of [['episode',['read_owner_todos']],['social',['inspect_creator_space']],['episode',['comment_video']],['social',['read_memory','send_dm']],['episode',['inspect_creator_space','inspect_video_discussion']],['social',[]],['social',['read_memory','read_memory']],['other',['read_memory']]]){
  assert.deepEqual(await run(scene,actions),{ok:false,reason:'life-read-not-registered'})
 }
 assert.equal(calls,0);assert.deepEqual(await run('social',['read_memory','read_history']),{ok:true,value:{ok:true}})
 const changed=await run('episode',['inspect_creator_space'],async()=>{calls++;current=false;return {ok:true,private:'not delivered'}})
 assert.deepEqual(changed,{ok:false,reason:'life-read-scope-changed'});assert.equal(calls,2)
 assert.deepEqual(await run('episode',['inspect_creator_space']),{ok:false,reason:'life-read-scope-changed'});assert.equal(calls,2)
})

// Real Planner I/O changes the canonical scope/target in place before returning.
// No success OR failure receipt is allowed to settle into the changed episode.
for(const scenario of ['creator-disabled','creator-source-changed','creator-error-after-revoke','discussion-revoked','metadata-removed','home-disabled','person-revoked','creator-account-changed'])test('dev49 registered Episode read rejects stale result '+scenario,()=>inDir(async dir=>{
 const id='0123456789abcdef01234567',personId='abcdef0123456789abcdef01',bvid='BV1abcde1234',other='BV1abcde5678',prompts=[]
 let scope=TAG,enabled=true,homeEnabled=true,reads=0,settled=0
 const person={id:personId,source:'public-person-observation',personKey:'public-person',eligible:true}
 const row={id,source:scenario==='home-disabled'?'home-browse':'inspected-opportunity',sourceId:'original',status:'inspected',selectedBvid:bvid,selectedTitle:'当前公开视频',metadataAt:NOW-1000,expiresAt:NOW+60000,nextAt:NOW-1000,episodeSteps:1,episodeMaxSteps:5,visitedBvids:[bvid],videos:[{bvid:other,title:'后续视频'}],commenterPersonIds:[personId]}
 const actions={'discussion-revoked':'inspect_video_discussion','metadata-removed':'inspect_exploration','home-disabled':'browse_home_more','person-revoked':'inspect_commenter_works'}
 const action=actions[scenario]||'inspect_creator_space'
 const change=()=>{reads++;switch(scenario){case 'creator-disabled':case 'creator-error-after-revoke':enabled=false;break;case 'creator-source-changed':row.sourceId='replacement';break;case 'discussion-revoked':row.discussionReadBvids=[bvid];break;case 'metadata-removed':row.videos=[];break;case 'home-disabled':homeEnabled=false;break;case 'person-revoked':person.eligible=false;break;case 'creator-account-changed':scope='b'.repeat(16);break}if(scenario==='creator-error-after-revoke')throw Error('read failed after cancellation')}
 const settle=()=>{settled++;return {ok:true}}
 const planner=createAutonomousPlanner({dataDir:dir,getConfig:()=>({...config(),masterEnabled:enabled,homeRecommendationsEnabled:homeEnabled}),getTodos:()=>[],now:()=>NOW,getLifeAccountTag:()=>scope,getLifeIntentions:()=>[row],getLifeOpportunities:()=>[person],
  executeCreatorSpace:async()=>{change();return {ok:true}},inspectLifeCreatorSpace:settle,failLifeCreatorRead:settle,
  executeVideoDiscussion:async()=>{change();return {ok:true,verified:true,bvid,count:0,comments:[]}},inspectLifeVideoDiscussion:settle,
  executeOpportunityRead:async()=>{change();return {ok:true,bvid:other,title:'后续视频'}},completeLifeExploration:settle,failLifeExploration:settle,
  executeLifeHomeMore:async()=>{change();return {ok:true}},recordLifeHomeMore:settle,
  executePublicPersonPortfolio:async()=>{change();return {ok:true,personKey:'public-person'}},beginPublicPersonExploration:settle,
  invokeModel:async p=>{prompts.push(p);if(prompts.length===1)return JSON.stringify({action:'resume_episode',id});
    assert.match(p,/【当前注册只读能力】/);const menu=JSON.parse(p.split('当前合法行动菜单：').at(-1).split('\n')[0]);assert.ok(menu.some(x=>x.action===action));
    return JSON.stringify({action,id,...(action==='inspect_exploration'?{bvid:other}:action==='inspect_video_discussion'?{bvid}:action==='inspect_commenter_works'?{personId}:{})})},
  executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
 const out=await planner.tick();assert.equal(out.action,'resume_episode');assert.equal(reads,1);assert.equal(settled,0);assert.equal(prompts.length,2);assert.equal(out.continuation.executed,0)
 assert.equal(out.continuation.reason,scenario==='creator-account-changed'?'account-changed':'life-read-scope-changed')
}))

// dev.52: the native host still owns the main Session loop; its actual read
// adapters share the registry and scope fence, not social or write authority.
test('dev52 main read inventory and gateway isolate scene, writes and stale scope',async()=>{
 const {registeredLifeRead,registeredLifeReads,executeRegisteredLifeRead}=await import('../lib/life-agent-read-runtime.mjs')
 assert.deepEqual(['social','episode','main-session'].map(s=>registeredLifeReads(s).length),[15,9,31])
 for(const scene of ['social','episode','main-session'])assert.equal(new Set(registeredLifeReads(scene).map(x=>x.action)).size,registeredLifeReads(scene).length)
 let current=true,calls=0
 const run=(actions,read=async()=>{calls++;return {verified:true}})=>executeRegisteredLifeRead({scene:'main-session',actions,isCurrent:()=>current,read})
 for(const action of ['read_memory','observe_video','bili_reply','bili_video_like','dafeiyu_share_observation','dafeiyu_remember','bili_watch_video','dafeiyu_todo_execute'])assert.equal((await run([action])).reason,'life-read-not-registered')
 assert.equal((await run(['bili_search','bili_comments'])).reason,'life-read-not-registered');assert.equal(calls,0)
 assert.deepEqual(await run(['bili_search']),{ok:true,value:{verified:true}})
 assert.equal((await run(['dafeiyu_life_recall'],async()=>{calls++;current=false;return {private:'not delivered'}})).reason,'life-read-scope-changed')
 assert.equal((await run(['dafeiyu_todo_list'])).reason,'life-read-scope-changed');assert.equal(calls,2)
 assert.equal(registeredLifeRead('episode','bili_search'),null)
})


test('dev53 registry groups shared semantics without granting aliases or autonomous writes in social/main scenes',async()=>{
 const {registeredLifeTool,registeredLifeTools,registeredLifeWrite,registeredLifeRead,executeRegisteredLifeWrite}=await import('../lib/life-agent-read-runtime.mjs')
 assert.deepEqual(['social','episode','main-session'].map(s=>registeredLifeTools(s).length),[15,13,31])
 for(const [social,episode,main] of [['read_memory','recall_public_experience','dafeiyu_life_recall'],['read_video','inspect_exploration','bili_video_info'],['read_hot_comments','inspect_video_discussion','bili_comments'],['read_public_person','inspect_creator_space','bili_user_videos']]){
   assert.equal(registeredLifeTool('social',social).capability,registeredLifeTool('episode',episode).capability)
   assert.equal(registeredLifeTool('social',social).capability,registeredLifeTool('main-session',main).capability)
   assert.equal(registeredLifeTool('social',main),null)
 }
 const names=['like_video','collect_video','follow_creator','comment_video']
 assert.deepEqual(registeredLifeTools('episode').filter(x=>x.risk==='write').map(x=>x.action),names)
 for(const action of names){
   assert.equal(registeredLifeRead('episode',action),null)
   assert.equal(registeredLifeWrite('main-session',action),null)
   assert.equal(registeredLifeWrite('social',action),null)
 }
 let calls=0,current=true
 const run=(scene,action,isCurrent=()=>current)=>executeRegisteredLifeWrite({scene,action,isCurrent,write:async()=>{calls++;current=false;return {ok:true,status:'verified'}}})
 assert.equal((await run('social','like_video')).code,'life-write-not-registered')
 assert.equal((await run('episode','observe_video')).code,'life-write-not-registered')
 assert.equal((await run('episode','like_video',()=>{throw Error('guard failed')})).attempted,false)
 assert.deepEqual(await run('episode','like_video'),{ok:true,status:'verified'},'already-dispatched result must settle even when authorization changes')
 assert.equal((await run('episode','like_video')).attempted,false);assert.equal(calls,1)
})

// The same role gets fresh life context even before any focus menu exists.
// Explicit memory reads remain optional; changing mood is not an action gate.
test('dev54 ordinary Episode uses fresh state and interests on each choice without automatic historical expansion',()=>inDir(async dir=>{
 const id='0123456789abcdef01234567',bvid='BV1abcde1234',other='BV1abcde5678',prompts=[],worldReads=[]
 let state={ok:true,enabled:true,mood:'curious',energy:62,sociality:49,curiosity:81,history:[{preview:'private-emotion-cause'}]},topic='第一份兴趣',reads=0,pauses=0
 const row={id,source:'inspected-opportunity',sourceId:'friend-shared-bili-link:'+id,status:'inspected',selectedBvid:bvid,selectedTitle:'当前公开视频',metadataAt:NOW-1000,expiresAt:NOW+60000,nextAt:NOW-1000,episodeSteps:1,episodeMaxSteps:5,visitedBvids:[bvid]}
 const planner=createAutonomousPlanner({dataDir:dir,getConfig:()=>({...config(),visionEnabled:false}),getTodos:()=>[],now:()=>NOW,getLifeAccountTag:()=>TAG,
  getLifeIntentions:()=>[row],getLifeState:()=>state,getLifeWorldEvidence:opts=>{worldReads.push(opts.includeMemories);return {interests:[{topic,stage:'growing'}],episodes:[{kind:'watch',stage:'clear',bvid:other,summary:'unrequested-history-marker'}]}},
  getLifeVoice:()=> '同一角色人格',canLifeRecallPublicVideo:()=>true,validateLifeVideoMemory:()=>true,
  getRecentLifeVideoMemory:async opts=>{if(opts.recentFallback!==false)return [];reads++;state={...state,mood:'tired',energy:9,curiosity:17};topic='更新后的兴趣';return [{bvid:other,title:'模型自主选择的旧观察',sceneNotes:['真实旧观察'],recallRoute:'direct'}]},
  observeLifeVideoMemory:()=>{},pauseLifeExploration:()=>{pauses++;return {ok:true}},
  invokeModel:async p=>{prompts.push(p);assert.doesNotMatch(p,/private-emotion-cause/);if(prompts.length===1)return JSON.stringify({action:'resume_episode',id});
    assert.doesNotMatch(p,/unrequested-history-marker/);assert.match(p,/同一角色人格/);
    if(prompts.length===2){assert.match(p,/第一份兴趣/);assert.match(p,/"energy":62/);assert.match(p,/"sociality":49/);return JSON.stringify({action:'recall_public_experience',id,recallQueries:['旧场景']})}
    assert.match(p,/更新后的兴趣/);assert.match(p,/"energy":9/);assert.match(p,/模型自主选择的旧观察/);return JSON.stringify({action:'stop',stopReasonCode:'rest'})},
  executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
 const result=await planner.tick();assert.equal(result.action,'resume_episode');assert.equal(result.continuation.reason,'fish-chose-rest');assert.equal(pauses,1);assert.equal(reads,1);assert.equal(row.episodeSteps,1);assert.deepEqual(worldReads,[undefined,false,false]);assert.equal(prompts.length,3)
}))

test('dev54 disabled state is not projected as actual emotion in initial or continuation decision',()=>inDir(async dir=>{
 const id='0123456789abcdef01234567',bvid='BV1abcde1234',prompts=[];let reads=0
 const row={id,source:'inspected-opportunity',sourceId:'friend-shared-bili-link:'+id,status:'inspected',selectedBvid:bvid,selectedTitle:'当前视频',metadataAt:NOW-1000,expiresAt:NOW+60000,nextAt:NOW-1000,episodeSteps:1,episodeMaxSteps:5,visitedBvids:[bvid]}
 const planner=createAutonomousPlanner({dataDir:dir,getConfig:config,getTodos:()=>[],now:()=>NOW,getLifeAccountTag:()=>TAG,getLifeIntentions:()=>[row],getLifeState:()=>({enabled:false,energy:1,mood:'sad'}),
  canLifeObserveVideo:()=>false,executeCreatorSpace:async()=>{reads++;return {ok:true}},inspectLifeCreatorSpace:()=>{row.episodeSteps++;row.creatorExploredBvids=[bvid];return {ok:true}},
  invokeModel:async p=>{prompts.push(p);assert.match(p,/"lifeState":\{"status":"disabled"\}/);assert.doesNotMatch(p,/"energy":1|"mood":"sad"/);return JSON.stringify({action:prompts.length===1?'resume_episode':'inspect_creator_space',id})},
  executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false})})
 const result=await planner.tick();assert.equal(result.action,'resume_episode');assert.equal(reads,1);assert.equal(row.episodeSteps,2);assert.equal(prompts.length,2)
}))

// dev.55: real planner + original opportunity ledger, no synthetic TODOs.
const {createLifeOpportunities,normalizeLifePublicTopic}=await import('../lib/life-opportunities.mjs')
function topicRig(dir,{answers=[],scenario='',rows=[],daily=12,mode='active'}={}){
 let clock=NOW,gen=0,allowed=true;const prompts=[],reads=[],memories=[],episodes=[],updates=[]
 const life=createLifeOpportunities({stateDir:dir,getCredential:()=>({}),getAccountTag:()=>TAG,now:()=>clock})
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock,getConfig:()=>({...config(),autonomousPlannerDailyLimit:daily,lifeAgentMode:mode}),getTodos:()=>rows,getLifeAccountTag:()=>TAG,getLifeAccountGeneration:()=>gen,
   getLifeVoice:()=> 'PRIVATE_OUTER_MARKER',getLifeState:()=>({energy:33,mood:'curious',private:'PRIVATE_STATE_MARKER'}),getLifeIntentions:()=>life.continuations(),getActiveLifeIntentionReservations:()=>life.intentions({includeClosed:true,limit:20}),getLifeIntentionCues:()=>life.explorationCues(),
   canLifeSearchPublicTopic:()=>allowed,publicTopicAvailable:(...a)=>life.publicTopicAvailable(...a),beginLifePublicTopic:(...a)=>life.beginPublicTopicExploration(...a),refineLifePublicTopic:(...a)=>life.refinePublicTopicExploration(...a),pauseLifeExploration:(...a)=>life.pauseExploration(...a),
   executeLifePublicTopicSearch:async(topic,scope,generation,current)=>{assert.equal(scope,TAG);assert.equal(generation,gen);assert.equal(current(),true);reads.push(topic);if(scenario==='read-revoked')allowed=false;if(scenario==='read-generation')gen++;return {ok:scenario!=='api-error',topic:scenario==='mismatched'?'不匹配主题':topic,videos:(scenario==='empty'||scenario==='refine-empty'&&reads.length===2)?[]:[{bvid:reads.length===1?'BV1abcde1234':'BV1abcde5678',title:'真实公开候选'+reads.length}]}},
   invokeModel:async p=>{prompts.push(p);if(scenario==='model-generation'&&prompts.length===2)gen++;const answer=answers.shift();return JSON.stringify(typeof answer==='function'?answer(life,p):answer||{action:'skip',stopReasonCode:'rest'})},
   onVerifiedRead:proof=>{memories.push(proof);return {ok:true}},onEpisodeAction:proof=>{episodes.push(proof);return {ok:true}},executeRead:async()=>({ok:false}),updateTodo:async(...a)=>{updates.push(a);return {ok:true}},reflect:async()=>({ok:false})})
 return {planner,life,prompts,reads,memories,episodes,updates,advance:ms=>{clock+=ms},clock:()=>clock,answers}
}
const entryChoice={action:'search_public_topic'},newTopic={action:'search',topic:'鸟类翅膀绘画'},later={action:'stop',stopReasonCode:'later',resumeAfterMinutes:35}
test('dev55 no existing cue: original ledger search, refine, postpone and resume with both public topics',()=>inDir(async dir=>{
 const x=topicRig(dir,{answers:[entryChoice,newTopic,(life,p)=>{assert.match(p,/鸟类翅膀绘画/);return {action:'search_public_topic',id:life.continuations()[0].id}}, {action:'search',topic:'鸟类飞行结构'},later]})
 const out=await x.planner.tick();assert.equal(out.action,'search_public_topic',JSON.stringify(out));assert.equal(out.result,'verified-search-results',JSON.stringify(out));assert.deepEqual(x.reads,['鸟类翅膀绘画','鸟类飞行结构']);assert.equal(x.updates.length,0)
 const rows=x.life.intentions({includeClosed:true});assert.equal(rows.length,1);const row=rows[0];assert.equal(x.episodes[0].sourceRef,"intention:"+row.id);assert.deepEqual(row.publicSearchTopics,x.reads);assert.equal(row.episodeSteps,2);assert.equal(row.nextAt,NOW+35*60_000);assert.equal(x.life.continuations().length,0)
 const isolated=x.prompts.filter(p=>p.includes('【Life 公开主题独立上下文】'));assert.equal(isolated.length,2);for(const p of isolated){assert.doesNotMatch(p,/PRIVATE_|真实公开候选/);assert.match(p,/"energy":33/)}assert.match(x.prompts.at(-1),/鸟类飞行结构/);assert.equal(x.memories.length,2);assert.notEqual(x.memories[0].sourceId,x.memories[1].sourceId);assert.equal(x.episodes.filter(p=>p.action==='search_public_topic').length,2)
 const evidence=x.life.timelineEvidence({});assert.deepEqual(evidence.filter(e=>e.action==='search').map(e=>[e.sourceTopic,e.searchPhase,e.relatedVideos[0].bvid]),[['鸟类翅膀绘画','entry','BV1abcde1234'],['鸟类飞行结构','refine','BV1abcde5678']]);
 x.advance(36*60_000);x.answers.push({action:'resume_episode',id:row.id},(life,p)=>{assert.match(p,/鸟类翅膀绘画/);assert.match(p,/鸟类飞行结构/);assert.doesNotMatch(p.split('当前合法行动菜单：').at(-1),/"action":"search_public_topic"/);return later});const resumed=await x.planner.tick();assert.equal(resumed.action,'resume_episode',JSON.stringify(resumed));assert.equal(x.life.intentions({includeClosed:true})[0].id,row.id);assert.equal(x.reads.length,2)
}))
for(const scenario of ['stop','invalid','outer-injection','model-generation','read-generation','read-revoked','api-error','mismatched','empty','accepted','duplicate','budget','shadow','manual','skip'])test('dev55 public topic guard '+scenario,()=>inDir(async dir=>{
 const rows=scenario==='accepted'?[{id:'todo-promise',type:'search_videos',topic:'鸟类翅膀绘画',status:'deferred',title:'已接受待办',createdAt:NOW-1000,nextAt:NOW+3600000}]:[]
 const answers=[scenario==='outer-injection'?{...entryChoice,topic:'私信'}:scenario==='skip'?{action:'skip',stopReasonCode:'rest'}:entryChoice,scenario==='stop'?{action:'stop'}:scenario==='invalid'?{action:'search',topic:'https://example.com'}:newTopic,later]
 const x=topicRig(dir,{scenario,answers,rows,daily:scenario==='budget'?1:12,mode:scenario==='shadow'?'shadow':'active'})
 if(scenario==='duplicate'){assert.equal(x.life.beginPublicTopicExploration(newTopic.topic,{ok:true,topic:newTopic.topic,videos:[{bvid:'BV1abcde1234',title:'已在进行的探索'}]},TAG).ok,true)}
 await x.planner.tick(scenario==='manual'?{force:true}:{});assert.equal(x.reads.length,['read-generation','read-revoked','api-error','mismatched','empty'].includes(scenario)?1:0,JSON.stringify({scenario,prompts:x.prompts.map(p=>p.slice(0,70))}));assert.equal(x.memories.length,0);assert.equal(x.episodes.length,0);assert.equal(x.life.intentions({includeClosed:true}).length,scenario==='duplicate'?1:0);assert.equal(x.updates.length,0)
}))
test('dev55 parameter shape, exact normalized topic and canonical receipt',()=>inDir(async dir=>{
 for(const t of ['密码','私信内容','BV1abcde1234','UID 12345','abc123456','https://example.com','foo@example.com','a\nb','1'])assert.equal(normalizeLifePublicTopic(t),'',t)
 assert.equal(normalizeLifePublicTopic('  Ｃ++  绘画 '),'C++ 绘画')
 const x=topicRig(dir),topic='C++ 绘画',found={ok:true,topic,videos:[{bvid:'BV1abcde1234',title:'作品'}]}
 assert.equal(x.life.beginPublicTopicExploration(topic,{...found,topic:'错误'},TAG).ok,false)
 const first=x.life.beginPublicTopicExploration(topic,found,TAG);assert.equal(first.ok,true);assert.equal(x.life.publicTopicAvailable('ｃ++ 绘画',TAG),false);assert.equal(x.life.refinePublicTopicExploration(first.id,topic,found,TAG).ok,false);assert.equal(x.life.refinePublicTopicExploration(first.id,'新的主题',{...found,topic:'新的主题'},'b'.repeat(16)).ok,false)
}))

test('dev55 failed refinement feeds real status to same model without fake step or retry',()=>inDir(async dir=>{
 const x=topicRig(dir,{scenario:'refine-empty',answers:[entryChoice,newTopic,life=>({action:'search_public_topic',id:life.continuations()[0].id}),{action:'search',topic:'新的飞行主题'},(life,p)=>{assert.match(p,/public-search-no-results/);assert.doesNotMatch(p.split('当前合法行动菜单：').at(-1),/"action":"search_public_topic"/);return later}]})
 const out=await x.planner.tick();assert.equal(out.result,'verified-search-results');assert.equal(out.continuation.reason,'fish-chose-later');assert.equal(x.reads.length,2);assert.equal(x.memories.length,1);assert.equal(x.life.intentions({includeClosed:true})[0].episodeSteps,1)
}))
