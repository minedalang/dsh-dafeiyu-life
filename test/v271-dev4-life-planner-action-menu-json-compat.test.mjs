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
