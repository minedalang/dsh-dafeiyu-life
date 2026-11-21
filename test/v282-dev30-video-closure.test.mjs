import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseLifeFocusBatchAnswer,runLifePostOverviewBatchReview} from '../lib/life-video-read-admission.mjs'
import {videoExplorationTier} from '../lib/video-exploration-budget.mjs'

const BV='BV1ab2345678',ACCOUNT='1234567890abcdef'
const anchors=[20,60,110]
const candidates=anchors.map(atSeconds=>({atSeconds,startSeconds:atSeconds-5,endSeconds:atSeconds+5}))
const overview={ok:true,bvid:BV,info:{duration:150},
  perceptionHandoff:{video:{source:'low-resolution-preview',modelDescription:'only seen official preview'}},
  videoEvidence:{sources:[{kind:'preview_frames',timePointsMs:anchors.map(t=>t*1000)}]}}
const fakeWillingness=()=>({
  decide:async()=>({ok:true,candidateId:'batch-focus-review',proof:{proof:'verified'}}),
  verify:()=>({ok:true}),receipt:()=>{}
})

test('Life focus batch JSON rejects untrusted extra keys, timestamps and oversized plans',()=>{
  assert.equal(parseLifeFocusBatchAnswer('{"focusTargets":[{"atSeconds":20,"durationSeconds":10,"url":"https://evil.invalid"}]}'),null)
  assert.equal(parseLifeFocusBatchAnswer('{"focusTargets":[{"atSeconds":20,"durationSeconds":121}]}'),null)
  assert.equal(parseLifeFocusBatchAnswer('{"focusTargets":[{"atSeconds":20,"durationSeconds":10}],"force":true}'),null)
  assert.equal(parseLifeFocusBatchAnswer('{"focusTargets":[],"reason":"rest"}').length,0)
})

test('Life may read two unrelated trusted moments; second receives remaining actual-frame allowance',async()=>{
  const readCaps=[]
  const out=await runLifePostOverviewBatchReview({willingness:fakeWillingness(),getAccountTag:()=>ACCOUNT,bvid:BV,
    overview,candidates,tier:videoExplorationTier(24),
    chooseBatch:async()=>JSON.stringify({focusTargets:[{atSeconds:20,durationSeconds:10},{atSeconds:110,durationSeconds:10}]}),
    readFocus:async({frameBudgetLimit,networkBudgetBytes,plan})=>{
      readCaps.push([frameBudgetLimit,networkBudgetBytes,plan.startSeconds])
      return {ok:true,review:{frameCount:3,inputBytes:20000,source:'decoded-public-video-focus'}}
    }})
  assert.equal(out.status,'focused')
  assert.equal(out.focusWindows.length,2)
  assert.equal(out.usage.frames,6)
  assert.deepEqual(readCaps.map(x=>x[0]),[24,21])
  assert.ok(readCaps[1][1]<readCaps[0][1]);assert.ok(out.remaining.frames===18)
  assert.equal(out.candidates.length,3)
})

test('Life cannot fetch a fabricated time anchor; budget is checked before any read',async()=>{
  let reads=0
  const result=await runLifePostOverviewBatchReview({willingness:fakeWillingness(),getAccountTag:()=>ACCOUNT,
    bvid:BV,overview,candidates,tier:videoExplorationTier(12),
    chooseBatch:async()=>JSON.stringify({focusTargets:[{atSeconds:79,durationSeconds:10}]}),
    readFocus:async()=>{reads++;return {ok:true}}})
  assert.equal(result.status,'invalid-focus-plan');assert.equal(reads,0)
})

test('production frame ceiling, Debug batch and hidden legacy-model editor are wired',()=>{
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const planner=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
  const ui=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  assert.match(host,/runLifePostOverviewBatchReview\(/)
  assert.match(host,/frame_budget_limit:frameBudgetLimit/)
  assert.match(planner,/frameBudgetLimit/)
  assert.match(ui,/最高 640×360/)
  assert.doesNotMatch(ui,/旧版主人 Agent 模型（兼容配置）/)
})
