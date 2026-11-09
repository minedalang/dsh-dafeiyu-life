import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runLifeExperienceOfflineDemo} from '../lib/life-experience-demo.mjs'
import {lifeExperienceReadiness} from '../lib/life-experience-readiness.mjs'
const at=Date.parse('2026-11-05T12:00:00Z')
const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:20}
const events={ok:true,pending:0,pendingSocial:0,videoStartsToday:0,lastVideoAt:0}
const caps=[{id:'bilibili.video-explore'}]
const inspect=(patch={},ev=events,cap=caps)=>lifeExperienceReadiness({config:{...cfg,...patch},planner:{runs:3},events:ev,capabilities:cap,at})
test('status inspection differentiates active, shadow and legacy without claiming execution',()=>{
 assert.equal(inspect().videoDelegationEligible,true)
 assert.deepEqual(inspect({lifeAgentMode:'shadow'}).blockers,['shadow-no-video'])
 assert.ok(inspect({lifeAgentMode:'off'}).blockers.includes('not-life-mode'))
 assert.ok(inspect({masterEnabled:false}).blockers.includes('master-off'))
 assert.ok(inspect({autonomousPlannerEnabled:false}).blockers.includes('planner-off'))
})
test('status explains planner quota, missing video adapter and 20-minute cooldown',()=>{
 assert.deepEqual(inspect({}, {...events,videoStartsToday:51}).blockers,[])
 assert.deepEqual(inspect({},events,[]).blockers,['no-video-capability'])
 assert.deepEqual(inspect({}, {...events,lastVideoAt:at-10*60_000}).blockers,['video-cooldown'])
 assert.equal(inspect({autonomousPlannerDailyLimit:3}).remainingDecisions,0)
 assert.ok(inspect({autonomousPlannerDailyLimit:3}).blockers.includes('model-quota'))
 assert.ok(inspect({}, {...events,ok:false}).blockers.includes('event-ledger-unavailable'))
})
test('readiness contains anonymous counters, not raw message contents or identities',()=>{
 const r=inspect({}, {...events,pending:3,pendingSocial:1})
 assert.equal(r.pendingEvents,3)
 assert.equal(r.pendingSocialEvents,1)
 assert.doesNotMatch(JSON.stringify(r),/uid|bvid|cookie|privateText|messageBody/i)
})
test('four synthetic life paths run the real planner without accessing user services',async()=>{
 const r=await runLifeExperienceOfflineDemo()
 assert.equal(r.ok,true)
 assert.equal(r.synthetic,true)
 assert.deepEqual(r.cases.map(x=>x.result),['shadow-would-explore','capability-launched','voluntary-rest','no-actionable-options'])
 assert.deepEqual(r.cases.map(x=>x.fakeVideoStarts),[0,1,0,0])
 assert.deepEqual(r.cases.map(x=>x.fakeModelCalls),[1,1,1,0])
 assert.equal(r.realModelCalls,0)
 assert.equal(r.networkCalls,0)
 assert.equal(r.outboundMessages,0)
})
test('management exposes real status and manual Agent run, without synthetic developer demo',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(html,/id="life-readiness"/)
 assert.match(html,/id="life-actual-proof"/)
 assert.match(html,/id="life-video-agent-test-run"/)
 assert.match(html,/id="life-readiness-refresh"/)
 assert.doesNotMatch(html,/life-offline-demo|演示四种选择/)
 assert.match(js,/sched\.experienceReadiness/)
 assert.match(js,/life\.videoStartsToday/)
 assert.doesNotMatch(js,/request\('\/life-agent\/offline-demo'/)
})
test('offline demo remains a backend-only fixture and cannot change outbound ownership',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const planner=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
 assert.match(planner,/experienceReadiness=lifeExperienceReadiness/)
 assert.match(index,/path==='\/api\/bili-duty\/life-agent\/offline-demo'/)
 assert.match(index,/runLifeExperienceOfflineDemo\(\)/)
 assert.match(index,/path==='\/api\/bili-duty\/life-agent\/wake'/)
 assert.doesNotMatch(readFileSync(new URL('../lib/life-experience-demo.mjs',import.meta.url),'utf8'),/https:\/\/|child_process|fetch\(/)
})
