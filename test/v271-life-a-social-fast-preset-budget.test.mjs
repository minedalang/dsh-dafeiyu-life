import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {lifeSettingsV2,planLifeSettingsV2} from '../lib/life-settings-control.mjs'
import {createLifeAgentEvents,lifeEventDebugRef} from '../lib/life-agent-events.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
const TAG_A='a'.repeat(16),TAG_B='b'.repeat(16),AT=Date.parse('2026-11-06T12:00:00.000Z')
const withDir=async fn=>{const dir=mkdtempSync(join(tmpdir(),'dsh-life-a-'));try{return await fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}
const settings=(config,pace,confirm=false)=>planLifeSettingsV2(config,{schemaVersion:2,
  revision:lifeSettingsV2(config).revision,mode:'active',pace,previewOnly:!confirm,
  ...(confirm?{confirm:'APPLY_LIFE_SETTINGS_V2'}:{})})

test('new pace values are explicit and saved legacy presets are never silently migrated',()=>{
  const config={masterEnabled:true,lifeAgentMode:'active',autonomousPlannerEnabled:true,
    autonomousPlannerMinutes:30,autonomousPlannerDailyLimit:20,autonomousPlannerStartHour:9,autonomousPlannerEndHour:23,peakValley:false}
  assert.equal(lifeSettingsV2(config).pace,'legacy-lively')
  assert.deepEqual(settings(config,'legacy-lively',true).patch,{})
  assert.deepEqual(settings(config,'lively',false).patch,{autonomousPlannerMinutes:10,autonomousPlannerDailyLimit:200})
  assert.deepEqual(settings(config,'natural').patch,{autonomousPlannerDailyLimit:100})
  assert.deepEqual(settings(config,'quiet').patch,{autonomousPlannerMinutes:80,autonomousPlannerDailyLimit:50})
  assert.throws(()=>settings(config,'legacy-quiet'),/只允许保留/)
  assert.equal(config.autonomousPlannerDailyLimit,20)
})
function make(dir,{lifeLimit=1,mode='active',result=null,tag=TAG_A,video=false}={}){
  let current=AT,scope=tag,modelCalls=0,videoCalls=0
  const events=createLifeAgentEvents({stateDir:dir,now:()=>current,getAccountTag:()=>scope})
  const cfg={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:mode,
    autonomousPlannerMinutes:120,autonomousPlannerDailyLimit:lifeLimit,
    autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}
  const planner=createAutonomousPlanner({dataDir:dir,getConfig:()=>cfg,getTodos:()=>[],
    getLifeAccountTag:()=>scope,getLifeEvents:()=>events.peek(4),getLifeEventStatus:()=>events.status(),
    getLifeCapabilities:()=>video?[{id:'bilibili.video-explore'}]:[],
    runLifeCapability:()=>{videoCalls++;return {started:true}},recordVideoStart:()=>{videoCalls++;return {ok:true}},
    offerLifeWake:e=>events.offer(e),settleLifeEvents:(ids,reason)=>events.settle(ids,reason),
    recordLifeDecision:e=>events.recordDecision(e),now:()=>current,
    invokeModel:async prompt=>{modelCalls++;const options=JSON.parse(prompt.split('\n').at(-1)).lifeCapabilityOpportunities
      assert.equal(options.capabilities.length,0,'social fast lane cannot offer a video launch')
      if(result)return result
      return JSON.stringify({action:'consider_social',id:options.events.find(x=>x.kind==='dm-received'||x.kind==='comment-received')?.id})},
    executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
  return {events,planner,cfg,get modelCalls(){return modelCalls},get videoCalls(){return videoCalls},setScope:x=>scope=x,advance:ms=>{current+=ms}}
}
test('verified DM bypasses ordinary cooldown and exhausted LIFE quota, but uses social-only budget',()=>withDir(async dir=>{
  const r=make(dir,{lifeLimit:1,video:true})
  assert.equal((await r.planner.tick({socialWake:true})).skipped,'social-no-pending')
  // The original persisted global ledger has no category fields.
  writeFileSync(join(dir,'autonomous-planner.json'),JSON.stringify({version:1,day:'2026-11-06',runs:1,
    lastAt:AT,recent:[],lastError:'',lastResult:''}))
  r.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'sensitive-uid:sensitive-private-id'})
  const outcome=await r.planner.tick()
  assert.equal(outcome.result,'social-signal-considered')
  assert.equal(r.modelCalls,1)
  assert.equal(r.videoCalls,0)
  const status=r.planner.status()
  assert.equal(status.lifeRuns,1)
  assert.equal(status.socialRuns,1)
  assert.equal(status.runs,2)
  assert.equal(status.dailyGlobalLimit,25) // only optional planner + read-only social attention
  assert.equal(r.events.status().pendingSocial,0)
  const raw=readFileSync(join(dir,'autonomous-planner.json'),'utf8')
  assert.doesNotMatch(raw,/sensitive-uid|sensitive-private-id/)
}))
test('social quota exhaustion does not starve the ordinary Life poll',()=>withDir(async dir=>{
  const r=make(dir,{lifeLimit:1})
  r.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'incoming-a'})
  writeFileSync(join(dir,'autonomous-planner.json'),JSON.stringify({version:1,day:'2026-11-06',
    runs:24,lifeRuns:0,socialRuns:24,lastAt:0,recent:[],lastError:'',lastResult:''}))
  assert.equal((await r.planner.tick({socialWake:true})).skipped,'social-quota')
  assert.equal(r.modelCalls,0)
  const ordinary=await r.planner.tick()
  assert.equal(ordinary.result,'social-signal-considered')
  assert.equal(r.modelCalls,1)
  assert.deepEqual([r.planner.status().lifeRuns,r.planner.status().socialRuns,r.planner.status().runs],[1,24,25])
}))
test('a fast social tick never authorizes video or platform send, even if model requests it',()=>withDir(async dir=>{
  const r=make(dir,{result:'{"action":"use_capability","capability":"bilibili.video-explore"}',video:true})
  r.events.offer({kind:'comment-received',platform:'bilibili',sourceKey:'comment-a'})
  const outcome=await r.planner.tick({socialWake:true})
  assert.equal(outcome.result,'invalid-decision')
  assert.equal(r.videoCalls,0)
  assert.equal(r.planner.status().socialRuns,1)
}))
test('disabled Life mode and unknown account do not fast-wake on social input',()=>withDir(async dir=>{
  const r=make(dir,{mode:'off'})
  r.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'a'})
  assert.equal((await r.planner.tick({socialWake:true})).skipped,'social-no-pending')
  assert.equal(r.modelCalls,0)
  r.cfg.lifeAgentMode='active';r.setScope(TAG_B)
  assert.equal((await r.planner.tick({socialWake:true})).skipped,'social-no-pending')
  assert.equal(r.modelCalls,0)
}))
test('anon event references correlate the trace and timeline, but reveal no external message identity',()=>withDir(async dir=>{
  const r=make(dir)
  const offered=r.events.offer({kind:'dm-received',platform:'bilibili',sourceKey:'123456789:secret-id'})
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>TAG_A,now:()=>AT})
  const ref=lifeEventDebugRef(offered.id)
  assert.match(ref,/^[a-f0-9]{16}$/)
  const entry=trace.begin({trigger:'social',mode:'active'})
  entry.step('candidate-scan',{eventRefs:[ref,'secret-id'],social:1})
  entry.finish({state:'finished'})
  assert.deepEqual(trace.get(entry.id).run.steps[0].eventRefs,[ref])
  assert.equal(r.events.status().recent[0].ref,ref)
  await r.planner.tick({socialWake:true})
  assert.deepEqual(r.events.status().timeline[0].eventRefs,[ref])
  const ledger=readFileSync(join(dir,'life-agent-events',TAG_A+'.json'),'utf8')
  assert.doesNotMatch(ledger,/123456789|secret-id/)
}))
