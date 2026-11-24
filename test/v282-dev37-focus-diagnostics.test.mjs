import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import vm from 'node:vm'
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
 assert.equal(diagnoseVideoFocusReceipt({bvid:BV,plan,result:{ok:false,status:'video_mp4_index_unavailable'},evidence:null}).code,'video_mp4_index_unavailable')
 assert.equal(diagnoseVideoFocusReceipt({bvid:BV,plan,result:{ok:false,status:'video_decode_failed'},evidence:null}).code,'video_decode_failed')
 assert.equal(diagnoseVideoFocusReceipt({bvid:BV,plan,result:{ok:false,status:'platform_rate_limited'},evidence:null}).code,'platform_rate_limited')
 assert.equal(diagnoseVideoFocusReceipt({bvid:BV,plan,result:{ok:false,status:'user-secret-string'},evidence:null}).code,'tool-result-unavailable')
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
  const withSourceStatus={...job,ownerFocus:{...job.ownerFocus,
    focusDiagnosis:{stage:'decode-or-tool',code:'video_mp4_index_unavailable',
      decodedFrames:0,frameBudget:0,decodedCandidates:0,samplerVersion:0,
      error:'https://example.org/private.mp4'}}}
  assert.equal(saveVideoDebugSummary(dir,withSourceStatus,'owner-account'),true)
  const safeSource=JSON.parse(readFileSync(target,'utf8'))
  assert.equal(safeSource.code,'video_mp4_index_unavailable')
  assert.equal(JSON.stringify(safeSource).includes('private.mp4'),false)
  assert.equal(ownerFocusSafeReport({...job,status:'running'},'owner-account'),null)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('Life action tree prioritizes recent real executed video step above parent plan',()=>{
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(ui,/const startedActions=steps\.filter\(x=>x\.type==='action-start'\)/)
 assert.match(ui,/const actions=\[actionStep\?\.action,actionStep\?\.kind,plan\?\.action/)
 assert.match(ui,/x\.action===selected/)
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(html,/<details id="life-video-attempt-panel"[^>]*><summary>最近视觉尝试/)
 assert.match(ui,/recentVideoRows\.map\(formatVideoAttempt\)/)
 assert.match(ui,/focus_video','局部复查视频画面/)
 assert.match(ui,/decoded-frame-provenance-rejected/)
 assert.match(ui,/真实局部视频分镜拼图/)
})

// Exercise the actual read-only selection logic, not merely UI copy/regex.
// A nested Life observe_video/focus_video start must outrank its parent plan;
// a live observation is an in-flight overlay, never a verified watch.
test('Life action tree selects newest executed video step, preserving live override',()=>{
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const start=ui.indexOf("      const startedActions=steps.filter(x=>x.type==='action-start');")
 const end=ui.indexOf('      const result=steps.slice().reverse()',start)
 assert.ok(start>0&&end>start,'missing runtime Life action selection block')
 const logic=ui.slice(start,end)
 const choose=vm.runInNewContext(`(steps,plan,lifeTreeGroups,liveVideoObserve)=>{
   let selected='';
   const latest={origin:'self-choice'};
   const liveOwnerVideoDebug=null;
   const $=()=>null;
   const lifeOriginLabel=()=>'';
   ${logic}
   return selected;
 }`)
 const groups=[{items:[['inspect_exploration','核实视频'],['observe_video','观看视频画面'],['focus_video','局部复查视频画面']]}]
 const plan={action:'inspect_exploration'}
 const one=[{type:'action-start',action:'inspect_exploration'},
            {type:'action-start',action:'observe_video'}]
 assert.equal(choose(one,plan,groups,null),'observe_video')
 assert.equal(choose([...one,{type:'action-start',action:'focus_video'}],plan,groups,null),'focus_video')
 assert.equal(choose([one[0]],plan,groups,null),'inspect_exploration')
 assert.equal(choose([one[0]],plan,groups,{kind:'video-observe'}),'observe_video')
})
