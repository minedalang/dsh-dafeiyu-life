import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {diagnoseVideoFocusReceipt,verifyVideoFocusReview} from '../lib/video-focus-review.mjs'
import {ownerFocusSafeReport,saveVideoDebugSummary} from '../lib/video-debug-receipt.mjs'

const BV='BV1ddsr6GEDs'
const plan={status:'ready',startSeconds:118.5,endSeconds:133.5,networkBudgetBytes:50*1048576}
const v={ok:true,bvid:BV,status:'analyzed',description:'R1C1 [01:59]：人物在室内走动。',
 image_source:'B站公开视频片段（离线解码）',
 focus_window:{startSeconds:118.5,endSeconds:133.5},times:[119,121,123],
 sampling:{sampler_version:8,strategy:'decoded-storyboard-stratified-2fps',
  frame_budget:24,candidates_examined:30,input_bytes:500000,
  network_budget_bytes:50*1048576,frame_plan:24}}
const accepted={sources:[
 {kind:'decoded_video_frames',timePointsMs:[119000,121000,123000]},
 {kind:'decoded_visual_analysis',timePointsMs:[119000,121000,123000]}]}

test('focus failure distinguishes missing tool, model, frame provenance, and alignment',()=>{
 assert.equal(diagnoseVideoFocusReceipt({bvid:BV,plan,result:null,evidence:null}).code,'tool-result-unavailable')
 assert.equal(diagnoseVideoFocusReceipt({bvid:BV,plan,result:{...v,status:'vision_unavailable'},evidence:accepted}).code,'visual-model-incomplete')
 assert.equal(diagnoseVideoFocusReceipt({bvid:BV,plan,result:v,evidence:{sources:[]}}).code,'decoded-frame-provenance-rejected')
 assert.equal(diagnoseVideoFocusReceipt({bvid:BV,plan,result:v,evidence:{sources:accepted.sources.slice(0,1)}}).code,'decoded-visual-receipt-rejected')
 const bad={...v,focus_window:{startSeconds:117,endSeconds:133.5}}
 assert.equal(diagnoseVideoFocusReceipt({bvid:BV,plan,result:bad,evidence:accepted}).code,'focus-window-budget-time-rejected')
 assert.ok(verifyVideoFocusReview({bvid:BV,plan,result:v,evidence:accepted}))
 assert.equal(diagnoseVideoFocusReceipt({bvid:BV,plan,result:v,evidence:accepted}).code,'focus-evidence-verified')
})

test('safe diagnosis is exported through existing reports/ without modifying owner log BAT',()=>{
 const dir=mkdtempSync(join(tmpdir(),'focus-safe-report-'))
 try{
  const now=Date.now()
  const job={status:'done',sourceMode:'owner-focus',step:6,at:now-500,updatedAt:now,
   bvid:'PRIVATE_BV',description:'secret',
   ownerFocus:{status:'focus-unavailable',selectedTargets:[{durationSeconds:20,atSeconds:126}],
    focusWindows:[],focusDiagnosis:{stage:'visual-model',code:'visual-model-incomplete',
      decodedFrames:3,decodedCandidates:40,frameBudget:24,samplerVersion:8,
      bvid:'PRIVATE_BV',message:'secret-model-output'}}}
  assert.equal(saveVideoDebugSummary(dir,job,'owner-account'),true)
  const target=join(dir,'reports','video-focus-last-diagnostic.json')
  assert.equal(existsSync(target),true)
  const report=JSON.parse(readFileSync(target,'utf8'))
  assert.equal(report.requestedSeconds,20)
  assert.equal(report.decodedFrames,3)
  assert.equal(report.stage,'visual-model')
  assert.equal(report.code,'visual-model-incomplete')
  assert.equal(report.verifiedWindows,0)
  const raw=readFileSync(target,'utf8')
  for(const secret of ['PRIVATE_BV','secret','owner-account'])assert.equal(raw.includes(secret),false)
  assert.equal(ownerFocusSafeReport({...job,status:'running'},'owner-account'),null)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('Life action tree prioritizes recent real executed video step above parent plan',()=>{
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(ui,/const startedActions=steps\.filter\(x=>x\.type==='action-start'\)/)
 assert.match(ui,/const actions=\[actionStep\?\.action,actionStep\?\.kind,plan\?\.action/)
 assert.match(ui,/x\.action===selected/)
 assert.match(ui,/近期视频观察/)
 assert.match(ui,/focus_video','局部复查视频画面/)
 assert.match(ui,/decoded-frame-provenance-rejected/)
})
