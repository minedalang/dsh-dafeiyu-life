import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import vm from 'node:vm'
import {planFocusBatch,videoExplorationTier,uncoveredFocusSeconds,
  hasNewFocusFrameSample,MIN_NEW_FOCUS_SECONDS} from '../lib/video-exploration-budget.mjs'
import {visualAttemptDiagnostic} from '../lib/video-visual-attempt-diagnostics.mjs'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
const tier=videoExplorationTier(48)
const candidates=[60,65,70,80,110].map(atSeconds=>({atSeconds,source:'verified-preview-sample'}))
const call=(atSeconds,durationSeconds,history=[])=>planFocusBatch({
  targets:[{atSeconds,durationSeconds}],candidates,tier,
  videoDurationSeconds:180,history})

test('already verified 50–70 seconds cannot be reread as a narrower or shifted window',()=>{
  const past=[{atSeconds:60,durationSeconds:20,startMs:50000,endMs:70000}]
  for(const [anchor,length] of [[60,10],[65,10],[60,20],[60,5]]){
    const plan=call(anchor,length,past)
    assert.equal(plan.ok,false,JSON.stringify({anchor,length,plan}))
    assert.equal(plan.reason,'focus-window-already-reviewed')
  }
  assert.equal(MIN_NEW_FOCUS_SECONDS,2)
})

test('overlap may pass only with >=2 seconds uncovered; existing history is not reset by another batch',()=>{
  const past=[{atSeconds:60,durationSeconds:20,startMs:50000,endMs:70000}]
  assert.ok(uncoveredFocusSeconds(65,75,past,180)>=5)
  assert.equal(uncoveredFocusSeconds(57,63,past,180),0)
  const newTime=call(80,20,past)
  assert.equal(newTime.ok,true)
  assert.ok(newTime.plans[0].startSeconds>=70)
})

test('union of multiple successful windows blocks an interior reread',()=>{
  const past=[{startMs:50000,endMs:60000},{startMs:60000,endMs:70000}]
  assert.equal(uncoveredFocusSeconds(55,65,past,180),0)
  assert.equal(call(60,10,past).reason,'focus-window-already-reviewed')
})

test('verified decoded frame must actually be outside prior covered windows',()=>{
  const past=[{startMs:50000,endMs:70000}]
  assert.equal(hasNewFocusFrameSample([55000,69000],past,180),false)
  assert.equal(hasNewFocusFrameSample([69000,75000],past,180),true)
  assert.equal(hasNewFocusFrameSample([NaN,-1,181000],past,180),false)
  assert.equal(hasNewFocusFrameSample([55000],[],180),true)
})

test('source diagnostics are bounded enums and do not claim exact model billing',()=>{
  assert.deepEqual(visualAttemptDiagnostic({action:'observe_video',status:'cached',verified:true}),
    {attemptKind:'reused-cache',modelRun:'cache-hit-reported',verification:'verified'})
  assert.deepEqual(visualAttemptDiagnostic({action:'focus_video',status:'analyzed',verified:true}),
    {attemptKind:'new-focus-evidence',modelRun:'analysis-reported',verification:'verified'})
  assert.equal(visualAttemptDiagnostic({action:'observe_video',status:'bad',previousFailure:true}).attemptKind,'retry-after-failure')
  assert.equal(visualAttemptDiagnostic({action:'observe_video',status:'vision_incomplete',modelAttempted:true}).modelRun,'attempt-reported')
  assert.equal(visualAttemptDiagnostic({action:'observe_video',existingMemory:true}).modelRun,'not-invoked')
  assert.equal(visualAttemptDiagnostic({action:'inject-unsafe'}),null)
})

test('Life trace persists provenance category only, never BV, model text or secrets',()=>{
  const dir=mkdtempSync(join(tmpdir(),'vision-novelty-'))
  try{
    const journal=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=> 'a'.repeat(16)})
    const run=journal.begin({mode:'active'})
    run.step('video-visual-attempt',{
      action:'focus_video',...visualAttemptDiagnostic({action:'focus_video',status:'cached',verified:true}),
      bvid:'BV1abc234567',modelResponse:'private output',modelCost:100})
    run.finish({result:'focused-visual-read-verified'})
    const step=journal.list().runs[0].steps.find(s=>s.type==='video-visual-attempt')
    assert.equal(step.attemptKind,'reused-cache')
    assert.equal(step.modelRun,'cache-hit-reported')
    assert.equal(step.verification,'verified')
    assert.equal(step.bvid,undefined)
    assert.equal(step.modelResponse,undefined)
    assert.equal(step.modelCost,undefined)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('failed new focus never appears in owner UI as already acquired new evidence',()=>{
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const from=js.indexOf('  const describeLifeVideoAttempt=run=>{')
  const to=js.indexOf('  let lastLifeTreeId=',from)
  assert.ok(from>0&&to>from)
  const describe=vm.runInNewContext(js.slice(from,to)+'\ndescribeLifeVideoAttempt',{})
  const run={at:100,state:'finished',steps:[
    {type:'action-start',at:100,action:'focus_video'},
    {type:'video-visual-attempt',at:101,action:'focus_video',
     attemptKind:'new-focus-evidence',verification:'unverified',modelRun:'analysis-reported'},
    {type:'blocked',at:102,action:'focus_video',code:'focus-no-new-sampled-evidence'}]}
  const shown=describe(run)
  assert.equal(shown.success,false)
  assert.match(shown.result,/未取得新增时间点/)
  assert.match(shown.result,/未核验成功/)
  assert.doesNotMatch(shown.result,/已取得可信视觉回执/)
})

test('failed 1-of-2 boards reports attempted model work rather than unknown or verified',()=>{
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const from=js.indexOf('  const describeLifeVideoAttempt=run=>{')
  const to=js.indexOf('  let lastLifeTreeId=',from)
  const describe=vm.runInNewContext(js.slice(from,to)+'\ndescribeLifeVideoAttempt',{})
  const attempt={at:100,state:'finished',steps:[
    {type:'action-start',at:100,action:'observe_video'},
    {type:'video-visual-attempt',at:101,action:'observe_video',attemptKind:'new-overview',
      verification:'unverified',modelRun:'attempt-reported'},
    {type:'blocked',at:102,action:'observe_video',code:'visual-read-unverified',
      visualStatus:'vision_incomplete',visionFailureCode:'vision_board_grid_mismatch',
      visionBoardsTotal:2,visionBoardsFailed:1}]}
  const shown=describe(attempt)
  assert.equal(shown.success,false)
  assert.match(shown.result,/分镜完成 1\/2/)
  assert.match(shown.result,/已报告尝试识图/)
  assert.doesNotMatch(shown.result,/模型调用情况未知|已取得可信视觉回执/)
})
