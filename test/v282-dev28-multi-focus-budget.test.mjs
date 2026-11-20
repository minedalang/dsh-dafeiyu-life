import test from 'node:test'
import assert from 'node:assert/strict'
import {videoExplorationTier,planFocusBatch,remainingExplorationBudget} from '../lib/video-exploration-budget.mjs'
import {continuationMenu,parseContinuationDecision,continuationPrompt} from '../lib/life-continuation.mjs'
const ID='a'.repeat(24),BV='BV1ab2345678'
const candidates=[10,33,65,110,157,220,260,300].map(atSeconds=>({atSeconds,startSeconds:atSeconds-5,endSeconds:atSeconds+10,source:'verified-preview-sample'}))
const intention={id:ID,selectedBvid:BV,status:'ready',selectedTitle:'可信已选视频',metadataAt:Date.now()-1000,
  observedVideoBvids:[BV],expiresAt:Date.now()+3600000,episodeSteps:1}
test('tiers bound candidates and batch windows independently; different events can coexist',()=>{
  for(const [frames,count,perBatch,windows] of [[12,4,2,2],[24,6,3,4],[48,8,4,6]]){
    const tier=videoExplorationTier(frames)
    const menu=continuationMenu(intention,{focusCandidates:candidates,focusFrames:frames,focusDurationSeconds:480})
    assert.equal(menu.find(x=>x.action==='focus_video').candidates.length,count)
    assert.equal(tier.perBatch,perBatch);assert.equal(tier.windows,windows)
  }
  const targets=[{atSeconds:10,durationSeconds:5},{atSeconds:110,durationSeconds:5}]
  const tier=videoExplorationTier(24)
  const result=planFocusBatch({targets,candidates,tier,videoDurationSeconds:480})
  assert.equal(result.ok,true);assert.equal(result.plans.length,2)
  assert.equal(result.totalDuration,10)
})
test('Life chooses multiple trusted timestamps with duration, no unverified ranges or other URLs',()=>{
  const menu=continuationMenu(intention,{focusCandidates:candidates,focusFrames:24,focusDurationSeconds:480})
  const make=focusTargets=>JSON.stringify({action:'focus_video',id:ID,bvid:BV,focusTargets})
  assert.deepEqual(parseContinuationDecision(make([{atSeconds:10,durationSeconds:5},{atSeconds:110,durationSeconds:5}]),menu).focusTargets,
    [{atSeconds:10,durationSeconds:5},{atSeconds:110,durationSeconds:5}])
  for(const rows of [[{atSeconds:11,durationSeconds:5}], [{atSeconds:10,durationSeconds:121}],
    [{atSeconds:10,durationSeconds:5},{atSeconds:10,durationSeconds:5}],
    [{atSeconds:10,durationSeconds:5,url:'https://evil.example'}]]){
    const decision=parseContinuationDecision(make(rows),menu)
    assert.equal(decision.action,'stop')
  }
  assert.match(continuationPrompt(menu),/focusTargets/)
})
test('overlapping anchors merge into single bounded decoded window, retain both sources',()=>{
  const tier=videoExplorationTier(48)
  const plan=planFocusBatch({targets:[{atSeconds:10,durationSeconds:30},{atSeconds:33,durationSeconds:30}],
    tier,candidates,videoDurationSeconds:480})
  assert.equal(plan.ok,true)
  assert.equal(plan.plans.length,1)
  assert.equal(plan.plans[0].anchors.length,2)
  assert.ok(plan.plans[0].endSeconds-plan.plans[0].startSeconds<=120)
})
test('budget is across batches; an exact replay is not allowed; global candidates persist',()=>{
  const tier=videoExplorationTier(24)
  const usage={windows:2,frames:18,seconds:65,bytes:40*1048576,batches:2}
  const remaining=remainingExplorationBudget(tier,usage)
  assert.equal(remaining.windows,2);assert.equal(remaining.frames,6)
  const menu=continuationMenu(intention,{focusCandidates:candidates,focusFrames:24,focusDurationSeconds:480,
    focusUsage:usage,focusHistory:[{atSeconds:10,durationSeconds:5}]})
  const row=menu.find(x=>x.action==='focus_video')
  assert.equal(row.candidates.length,6)
  assert.equal(parseContinuationDecision(JSON.stringify({action:'focus_video',id:ID,bvid:BV,
    focusTargets:[{atSeconds:10,durationSeconds:5}]}),menu).action,'stop')
  assert.equal(planFocusBatch({targets:[{atSeconds:220,durationSeconds:30}],candidates,tier,usage,
    videoDurationSeconds:480}).ok,false)
})
