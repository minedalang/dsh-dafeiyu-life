import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {assertLegacyLifeSettingsPatchCompatible,lifeSettingsV2,planLifeSettingsV2} from '../lib/life-settings-control.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
import {createLifeAgentEvents} from '../lib/life-agent-events.mjs'
const T=Date.parse('2026-11-05T12:00:00Z'),A='a'.repeat(16),B='b'.repeat(16)
const base={masterEnabled:true,lifeAgentMode:'shadow',peakValley:false,autonomousPlannerEnabled:true,autonomousPlannerMinutes:60,
  autonomousPlannerDailyLimit:12,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,
  dmStrangerAutonomyEnabled:false,socialAutoSend:false}
const inTemp=async f=>{const dir=mkdtempSync(join(tmpdir(),'dsh-phase67c-'));try{return await f(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
test('6c: legacy mode and managed budgets cannot drift through generic save',()=>{
 assert.throws(()=>assertLegacyLifeSettingsPatchCompatible(base,{lifeAgentMode:'off'}),/统一生活设置/)
 for(const key of ['autonomousPlannerEnabled','autonomousPlannerMinutes','autonomousPlannerDailyLimit']){
  assert.throws(()=>assertLegacyLifeSettingsPatchCompatible(base,{[key]:key==='autonomousPlannerEnabled'?false:1}),/统一生活设置/)
  assert.equal(assertLegacyLifeSettingsPatchCompatible(base,{[key]:base[key]}),true)
 }
 assert.throws(()=>assertLegacyLifeSettingsPatchCompatible(base,{autonomousPlannerStartHour:9}),/统一生活设置/)
 assert.equal(assertLegacyLifeSettingsPatchCompatible(base,{dmStrangerAutonomyEnabled:false}),true)
 const legacy={...base,lifeAgentMode:'off'}
 assert.equal(assertLegacyLifeSettingsPatchCompatible(legacy,{autonomousPlannerMinutes:99}),true)
})
test('6c: new versioned settings can still explicitly change budget and never enable social permissions',()=>{
 const req={schemaVersion:2,revision:lifeSettingsV2(base).revision,mode:'active',pace:'quiet',confirm:'APPLY_LIFE_SETTINGS_V2'}
 const plan=planLifeSettingsV2(base,req)
 assert.equal(plan.patch.lifeAgentMode,'active')
 assert.equal(plan.patch.autonomousPlannerMinutes,180)
 assert.equal(plan.patch.autonomousPlannerDailyLimit,4)
 for(const k of ['socialAutoSend','dmStrangerAutonomyEnabled','masterEnabled'])assert.equal(Object.hasOwn(plan.patch,k),false)
 assert.deepEqual(lifeSettingsV2(base).legacyManagedFields,['lifeAgentMode','autonomousPlannerEnabled','autonomousPlannerMinutes','autonomousPlannerDailyLimit','autonomousPlannerStartHour','autonomousPlannerEndHour'])
})
test('6c: management UI and production config POST both enforce new ownership',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(index,/assertLegacyLifeSettingsPatchCompatible\(cfg,validatedPatch\)/)
 assert.match(html,/life-legacy-managed-note/)
 assert.match(js,/\$\(id\)\.disabled=true/)
 assert.match(js,/loadUnifiedLifeSettings/)
})
test('7c: only matching successful read pairs can become short-lived categories; no raw subject stored',async()=>inTemp(dir=>{
 let t=T,scope=A
 const ledger=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>scope,now:()=>t})
 ledger.recordDecision({action:'skip',mode:'shadow',result:'voluntary-rest',verifiedReadKind:'todo-read'})
 ledger.recordDecision({action:'execute_read',mode:'shadow',result:'failed',verifiedReadKind:'todo-read'})
 ledger.recordDecision({action:'execute_read',mode:'shadow',result:'done',failed:true,verifiedReadKind:'todo-read'})
 assert.equal(ledger.status().recentVerifiedReads.length,0)
 ledger.recordDecision({action:'execute_read',mode:'shadow',result:'done',verifiedReadKind:'todo-read',targetId:'secret-user-id'})
 assert.equal(ledger.status().recentVerifiedReads[0].kind,'todo-read')
 assert.doesNotMatch(readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8'),/secret-user-id/)
 scope=B;assert.deepEqual(ledger.status().recentVerifiedReads,[])
 scope=A;t+=49*3600_000;assert.deepEqual(ledger.status().recentVerifiedReads,[])
}))
async function replay({success=true}={}){return inTemp(async dir=>{
 let t=T;const ledger=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>t})
 let done=false,calls=0;const prompts=[]
 const todo=[{id:'todo-one',type:'check_notifications',status:'open',createdAt:t-3600_000,origin:{uid:'1234567'}},
  {id:'todo-two',type:'check_notifications',status:'open',createdAt:t,origin:{uid:'1234567'}}]
 const planner=createAutonomousPlanner({dataDir:dir,now:()=>t,getConfig:()=>base,getTodos:()=>todo.filter(x=>x.status==='open'),
  getAcceptedActionReservations:()=>[],getLifeAccountTag:()=>A,getLifeEvents:()=>ledger.peek(),getLifeEventStatus:()=>ledger.status(),
  recordLifeDecision:x=>ledger.recordDecision(x),offerLifeWake:x=>ledger.offer(x),settleLifeEvents:(...args)=>ledger.settle(...args),
  invokeModel:async prompt=>{calls++;prompts.push(prompt);return calls===1?'{"action":"execute_read","id":"todo-one"}':'{"action":"skip"}'},
  executeRead:async id=>{if(id==='todo-one'&&success){todo[0].status='done';done=true;return {ok:true}}return {ok:false}},
  updateTodo:async()=>{},reflect:async()=>({ok:false})})
 ledger.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'one'})
 const first=await planner.tick({force:true});t+=3600_000
 ledger.offer({kind:'manual-wake',platform:'bilibili',sourceKey:'two'})
 const second=await planner.tick({force:true})
 const two=JSON.parse(prompts[1].split('\n').at(-1))
 return {first,second,two,entries:ledger.status().timeline,calls,done,ledger:readFileSync(join(dir,'life-agent-events',A+'.json'),'utf8')}
})}
test('7c: verified first-round read enters next model prompt; no fake watch or social send',async()=>{
 const x=await replay()
 assert.equal(x.first.result,'done')
 assert.equal(x.done,true)
 assert.equal(x.calls,2)
 assert.deepEqual(x.two.recentVerifiedReadEvidence,[{kind:'todo-read',hoursAgo:1}])
 assert.equal(x.entries[0].priorVerifiedReadReferenced,true)
 assert.equal(x.entries[1].verifiedReadKind,'todo-read')
 assert.doesNotMatch(x.ledger,/todo-one|todo-two|1234567/)
})
test('7c: failed read never becomes evidence for next turn',async()=>{
 const x=await replay({success:false});assert.equal(x.first.result,'failed')
 assert.deepEqual(x.two.recentVerifiedReadEvidence,[])
 assert.equal(x.entries[0].priorVerifiedReadReferenced,false)
})
test('7c: legacy ledger without evidence field remains readable and does not fake growth',async()=>inTemp(dir=>{
 const events=createLifeAgentEvents({stateDir:dir,getAccountTag:()=>A,now:()=>T})
 events.recordDecision({action:'skip',result:'voluntary-rest',mode:'shadow'})
 assert.deepEqual(events.status().recentVerifiedReads,[])
 assert.equal(events.status().timeline[0].priorVerifiedReadReferenced,false)
}))
