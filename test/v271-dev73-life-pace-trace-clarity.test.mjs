import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {lifeSettingsV2,planLifeSettingsV2} from '../lib/life-settings-control.mjs'
import {lifePacePolicy} from '../lib/life-pace-policy.mjs'
import {lifeTracePresentation,createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'
const TAG='a'.repeat(16),T=Date.parse('2026-11-11T08:00:00Z')
const config=(minutes,limit)=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
  autonomousPlannerMinutes:minutes,autonomousPlannerDailyLimit:limit,
  autonomousPlannerStartHour:0,autonomousPlannerEndHour:24})
test('新档位显式升级，保留旧用户已保存的较低模型额度',()=>{
  const legacy=config(10,100)
  assert.equal(lifeSettingsV2(legacy).pace,'legacy-2026-lively')
  const base={schemaVersion:2,revision:lifeSettingsV2(legacy).revision,mode:'active',previewOnly:true}
  assert.deepEqual(planLifeSettingsV2(legacy,{...base,pace:'legacy-2026-lively'}).patch,{peakValley:false})
  assert.deepEqual(planLifeSettingsV2(legacy,{...base,pace:'lively'}).patch,{autonomousPlannerDailyLimit:200,peakValley:false,videoAgentMinIntervalMinutes:15,videoAgentReadTargetPerRound:8,videoAgentPickTargetPerRound:5})
  assert.equal(lifePacePolicy(config(10,200)).spontaneousWindowMinutes,10)
  assert.equal(lifePacePolicy(config(30,100)).pace,'natural')
  assert.equal(lifePacePolicy(config(80,50)).pace,'quiet')
})
test('意愿判断批准后未结算应显示等待回执，超时不伪称中断或平台成功',t=>{
  const dir=mkdtempSync(join(tmpdir(),'life73-trace-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  let clock=T
  const trace=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>TAG,now:()=>clock})
  const entry=trace.begin({mode:'willingness',trigger:'video-comment-consideration'})
  entry.step('model-choice',{action:'act',code:'model-accepted'})
  entry.step('execution-plan',{action:'act',kind:'video_comment',delivery:'approval-only'})
  const pending=trace.list().runs.find(x=>x.id===entry.id)
  assert.equal(pending.state,'running')
  assert.equal(pending.presentation,'approval-pending')
  clock+=5*60_000+1000
  assert.equal(trace.list().runs[0].presentation,'approval-unsettled')
  entry.step('execution-result',{action:'video_comment',result:'verified',delivery:'platform-confirmed'})
  entry.finish({state:'finished',result:'verified'})
  assert.equal(trace.list().runs[0].presentation,'platform-verified')
  assert.equal(lifeTracePresentation({state:'running',updatedAt:T,at:T,steps:[{type:'model-call'}]},T+11*60_000),'decision-unsettled')
})
test('生活页使用真实只读状态展示三类生活记录，解释额度与事件差异',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  // The dev.73 duplicate counters retired in 2.8.0; use one unified board.
  for(const id of ['life-plan-hub-grid','owner-todo-list','life-opportunities-list']){
    assert.match(html,new RegExp('id="'+id+'"'))
    assert.ok(js.includes("$('"+id+"')"))
  }
  for(const kind of ['cue','opportunity','todo'])assert.match(html,new RegExp('data-life-plan-filter="'+kind+'"'))
  assert.doesNotMatch(html,/class="life-source-flow"/)
  for(const pace of ['80 分 / 50 次','30 分 / 100 次','10 分 / 200 次'])assert.ok(html.includes(pace))
  assert.match(js,/approval-pending':'Life 已同意/)
})
test('自动生活轮遵守用户设定的最短间隔，即使出现经验跟进候选',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'life73-cadence-'));t.after(()=>rmSync(dir,{recursive:true,force:true}))
  let clock=T,turns=0
  const settings=config(10,200)
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>clock,getConfig:()=>settings,getTodos:()=>[],
    getLifeAccountTag:()=>TAG,getLifeEvents:()=>[],getLifeEventStatus:()=>({ok:true,dueExperienceFollowup:true,nextExperienceFollowupAt:T+2*60_000}),
    getLifeCapabilities:()=>[{id:'bilibili.video-explore'}],getLifeVoice:()=>'',
    invokeModel:async()=>{turns++;return '{"action":"skip","reason":"暂时休息"}'},
    executeRead:async()=>({ok:true}),reflect:async()=>({ok:true}),updateTodo:()=>{},runLifeCapability:()=>({started:true})})
  writeFileSync(join(dir,'autonomous-planner.json'),JSON.stringify({version:1,
    day:new Date(T).toLocaleDateString('en-CA'),runs:1,lifeRuns:1,socialRuns:0,willingnessRuns:0,
    willingnessBillingVersion:2,lastAt:T,lastResult:'',lastError:'',recent:[]})+'\n')
  clock+=2*60_000
  assert.equal((await planner.tick()).skipped,'cooldown')
  assert.equal(turns,0)
  assert.ok(planner.status().nextDecisionAt>=T+10*60_000)
})
