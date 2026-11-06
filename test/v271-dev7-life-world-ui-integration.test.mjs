import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {projectLifeWorldEvidence,projectLifeIntegrationStatus} from '../lib/life-system-integration.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
import {lifeSettingsV2} from '../lib/life-settings-control.mjs'

const BVID='BV1aa411c7mD', AT=Date.parse('2026-11-06T12:00:00Z'), ACCOUNT='e'.repeat(16)
const withDir=async callback=>{const dir=mkdtempSync(join(tmpdir(),'dsh-dev7-'));try{return await callback(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('public world projection keeps only eligible interests and still-clear verified video memory',()=>{
 const interests=[{topic:'音乐',stage:'growing',secret:'hidden'},{topic:'音乐',stage:'stable'},
  {topic:'美食',stage:'core'},{topic:'旧话题',stage:'unknown'},...Array.from({length:12},(_,i)=>({topic:'兴趣'+i,stage:'emerging'}))]
 const episodes=[{kind:'private-social',stage:'clear',bvid:BVID,summary:'别人的私信'},
  {kind:'watch',stage:'forgotten',bvid:BVID,summary:'已遗忘的长篇'},
  {kind:'watch',stage:'fuzzy',bvid:BVID,summary:'已模糊不可传的正文'},
  {kind:'watch',stage:'clear',bvid:'bad-uid',summary:'无可信 BV'},
  {kind:'watch',stage:'clear',bvid:BVID,summary:'公开音乐 元数据'},
  {kind:'watch',stage:'clear',bvid:BVID,summary:'同 BV 重复'},
  {kind:'watch',stage:'clear',bvid:'BV1xx411c7mD',summary:'另一个公开视频'},
  {kind:'watch',stage:'clear',bvid:'BV1zz411c7mD',summary:'第三条不应该出现'}]
 const snapshot=structuredClone({interests,episodes})
 const x=projectLifeWorldEvidence({interests,episodes})
 assert.equal(x.publicInterests.length,4)
 assert.deepEqual(x.publicInterests[0],{topic:'音乐',stage:'growing'})
 assert.equal(x.relatedPublicMemories.length,2)
 assert.deepEqual(x.relatedPublicMemories.map(row=>row.bvid),[BVID,'BV1xx411c7mD'])
 assert.ok(x.relatedPublicMemories.every(row=>row.evidence.includes('metadata')))
 assert.doesNotMatch(JSON.stringify(x),/别人的私信|已遗忘|已模糊|hidden|bad-uid|第三条|同 BV 重复/)
 assert.deepEqual({interests,episodes},snapshot)
})

test('missing integration does not masquerade as healthy or completed Life handoff',()=>{
 const x=projectLifeIntegrationStatus({at:AT,config:{lifeAgentMode:'active',masterEnabled:false}})
 assert.equal(x.memory.state,'unavailable');assert.equal(x.todos.state,'unavailable')
 assert.equal(x.personality.state,'unavailable');assert.equal(x.social.decisionOwner,'legacy')
 assert.equal(x.social.handoffComplete,false);assert.equal(x.releaseReady,false)
 assert.ok(x.note.includes('尚未完成'))
})

test('integration reports original verified growth summaries without exposing private row content',()=>{
 const secret='USER-SECRET-CHAT-123'
 const x=projectLifeIntegrationStatus({at:AT,config:{lifeAgentMode:'active',masterEnabled:true},
  planner:{ok:true,lifeRuns:8,socialRuns:2,lastModelOutput:secret},
  memory:{ok:true,counts:{clear:2,fuzzy:1,forgotten:9},privateNotes:secret},
  coordinator:{ok:true,pending:3,rawMessage:secret},reflection:{ok:true,pending:4,recentPublicRun:{personalityAccepted:1}},
  personality:{ok:true,enabled:true,traits:[{evidenceCount:5,rawText:secret},{evidenceCount:0}]},
  todos:{ok:true,open:2,deferred:1,uncertain:1,items:[{uid:secret}]},
  interests:[{topic:'舞蹈',stage:'growing',privateName:secret}],relationshipsReady:true})
 assert.equal(x.decision.runsToday,8)
 assert.equal(x.memory.recallable,3)
 assert.equal(x.memory.projectionPending,3)
 assert.equal(x.personality.evidenceTraits,1)
 assert.equal(x.reflection.lastPublicAccepted,1)
 assert.equal(x.todos.open,2);assert.equal(x.interests.eligibleTopics,1)
 assert.equal(x.relationships.state,'connected')
 assert.doesNotMatch(JSON.stringify(x),new RegExp(secret))
 assert.equal(x.releaseReady,false)
})

test('normal Life choice reads bounded world but social fast wake cannot request it',()=>withDir(async dir=>{
 let worldCalls=0;const prompts=[]
 const events=createLifeAgentEvents({stateDir:dir,now:()=>AT,getAccountTag:()=>ACCOUNT})
 const cfg={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,
  autonomousPlannerMinutes:10,autonomousPlannerDailyLimit:10,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>AT,getConfig:()=>cfg,getTodos:()=>[],
  getLifeAccountTag:()=>ACCOUNT,getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),
  offerLifeWake:row=>events.offer(row),settleLifeEvents:(ids,reason)=>events.settle(ids,reason),
  recordLifeDecision:row=>events.recordDecision(row),
  getLifeCapabilities:()=>[{id:'mock.video',risk:'read'}],
  getLifeWorldEvidence:()=>{worldCalls++;return {interests:[{topic:'真实公开主题',stage:'core'}],
    episodes:[{kind:'watch',stage:'clear',bvid:BVID,summary:'可信元数据'}]}},
  invokeModel:async prompt=>{prompts.push(prompt);return '{"action":"skip"}'},
  executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
 events.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'manual'})
 const first=await planner.tick({force:true})
 assert.equal(first.result,'voluntary-rest')
 assert.equal(worldCalls,1)
 assert.ok(prompts[0].includes('真实公开主题'))
 assert.ok(prompts[0].includes('可信元数据'))
 events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'private-source-key'})
 const second=await planner.tick({socialWake:true})
 assert.ok(['voluntary-rest','invalid-decision','social-signal-considered'].includes(second.result))
 assert.equal(worldCalls,1)
 assert.equal(prompts.length,2)
 assert.doesNotMatch(prompts[1],/真实公开主题|可信元数据|private-source-key/)
}))

test('UI has one Life V2 editor, retires duplicate legacy controls and keeps distinct system pages',()=>{
 const html=read('lib/management-console.html'),js=read('lib/management-console.js'),server=read('index.js')
 assert.equal((html.match(/id="life-settings-v2-panel"/g)||[]).length,1)
 for(const id of ['panel-life-agent','life-link-planner','life-link-memory','life-link-todos','life-link-interests',
   'life-link-personality','life-link-social','life-integration-refresh','life-social-shadow-save'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id)
 assert.ok(html.indexOf('id="panel-life-agent"')<html.indexOf('id="life-settings-v2-panel"'))
 for(const id of ['autonomous-planner-enabled','autonomous-planner-limit','autonomous-planner-minutes',
  'autonomous-planner-recommended','life-agent-mode','life-legacy-planner-advanced'])assert.doesNotMatch(html,new RegExp('id="'+id+'"'))
 for(const tab of ['life','todos','relationships','personality','diagnostics'])assert.match(html,new RegExp('data-open-tab="'+tab+'"'))
 assert.match(js,/['"]life-agent['"]:async/)
 assert.match(js,/life:loadLifeMemory/)
 assert.match(server,/life-agent\/integration-status/)
 assert.match(server,/projectLifeIntegrationStatus/)
 const start=js.indexOf("$('owner-todo-settings-save').addEventListener"),end=js.indexOf("$('owner-todo-add').addEventListener",start)
 assert.ok(start>0&&end>start)
 assert.doesNotMatch(js.slice(start,end),/lifeAgentSocialContextOptIn|lifeSocialShadowConfirm/)
 assert.match(js,/\$\('life-social-shadow-save'\)\.addEventListener/)
})

test('dev.7 still preserves previously saved legacy V2 values without implicit migration',()=>{
 const c={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,
   autonomousPlannerMinutes:60,autonomousPlannerDailyLimit:12,
   autonomousPlannerStartHour:9,autonomousPlannerEndHour:23}
 assert.equal(lifeSettingsV2(c).pace,'legacy-natural')
 assert.equal(c.autonomousPlannerMinutes,60)
 assert.equal(c.autonomousPlannerDailyLimit,12)
})
