import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeDecisionTrace} from '../lib/life-decision-trace.mjs'
import vm from 'node:vm'

const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const planner=readFileSync(new URL('../lib/autonomous-planner.mjs',import.meta.url),'utf8')
// Execute only the isolated pure description function, not the DOM or API UI.
const start=ui.indexOf('  const describeLifeVideoAttempt=run=>{')
const stop=ui.indexOf('  // Gallery evidence is read-only',start)
assert.ok(start>0&&stop>start)
const describe=vm.runInNewContext(ui.slice(start,stop)+'\ndescribeLifeVideoAttempt',Object.freeze({}))
const event=(type,extra={},at=100)=>({type,at,...extra})

test('Life metadata success must not turn an incomplete visual child into a verified watch',()=>{
  const run={at:80,state:'finished',steps:[
    event('model-choice',{action:'inspect_exploration'}),
    event('action-start',{action:'inspect_exploration'}),
    event('model-choice',{action:'observe_video'},120),
    event('action-start',{action:'observe_video'},130),
    event('blocked',{code:'visual-read-unverified',visualStatus:'vision_incomplete',visionBoardsTotal:4,visionBoardsFailed:1},145),
    event('action-result',{action:'inspect_exploration',result:'verified-metadata'},160)
  ]}
  const result=describe(run)
  assert.equal(result.success,false)
  assert.match(result.result,/分镜识图不完整/)
  assert.match(result.result,/分镜完成 3\/4/)
  assert.equal(result.type,'观察视频画面')
  assert.equal(result.at,130)
})
test('Only the matching verified visual receipt proves success; owner debug has no Life action-start',()=>{
  assert.equal(describe({at:1,steps:[event('action-start',{action:'inspect_exploration'})]}),null)
  const run={at:1,steps:[event('action-start',{action:'observe_video'}),
    event('action-result',{action:'observe_video',result:'visual-read-verified'},150)]}
  assert.equal(describe(run).success,true)
  assert.match(describe(run).result,/可信视觉回执/)
})
test('For multi-window focus show last unsuccessful window, not an older success',()=>{
  const run={at:1,state:'finished',steps:[event('action-start',{action:'focus_video'},100),
    event('action-result',{action:'focus_video',result:'focused-visual-read-verified'},120),
    event('action-start',{action:'focus_video'},130),
    event('blocked',{action:'focus_video',code:'focus-evidence-unverified',visualStatus:'vision_unavailable'},150)]}
  const result=describe(run)
  assert.equal(result.success,false)
  assert.match(result.result,/视觉模型未返回有效结果/)
})
test('Tree and timeline surface recent attempts separately from durable Life experiences',()=>{
  assert.match(html,/id="life-video-attempt-panel"[^>]+hidden/)
  assert.match(html,/id="life-video-attempt-history"/)
  assert.match(ui,/const history=\$\('life-video-attempt-history'\),attemptPanel=\$\('life-video-attempt-panel'\)/)
  assert.match(ui,/视觉子动作：/)
  assert.match(ui,/上层元数据成功不代表这次识图成功/)
  assert.match(planner,/if\(!visualObservation\|\|visualObservation\.bvid!==choice\.bvid/)
})

test('Only bounded anonymized board counts survive the trace journal sanitizer',()=>{
  const home=mkdtempSync(join(tmpdir(),'vision-attempt-'))
  try{
    const journal=createLifeDecisionTrace({dataDir:home,getAccountTag:()=> 'a'.repeat(16)})
    const row=journal.begin({mode:'active'})
    row.step('action-start',{action:'observe_video'})
    row.step('blocked',{code:'visual-read-unverified',visualStatus:'vision_incomplete',
      visionBoardsTotal:4,visionBoardsFailed:1,
      modelDescription:'UNTRUSTED PRIVATE IMAGE DESCRIPTION',bvid:'BV1NOTPUBLIC1'})
    row.finish({state:'finished',result:'verified-metadata'})
    const latest=journal.list().runs[0]
    const blocked=latest.steps.find(s=>s.type==='blocked')
    assert.equal(blocked.visionBoardsTotal,4)
    assert.equal(blocked.visionBoardsFailed,1)
    assert.equal(blocked.modelDescription,undefined)
    assert.equal(blocked.bvid,undefined)
    const shown=describe(latest)
    assert.match(shown.result,/分镜完成 3\/4/)
    assert.equal(shown.success,false)
  }finally{rmSync(home,{recursive:true,force:true})}
})

test('offline Ollama failure is explicit at actual visual start, not parent time or later unrelated failure',()=>{
 const run={at:100,state:'finished',steps:[event('action-start',{action:'inspect_exploration'},101),event('action-result',{action:'inspect_exploration',result:'verified-metadata'},102),event('action-start',{action:'observe_video'},120),event('blocked',{action:'observe_video',code:'visual-read-unverified',visualStatus:'vision_incomplete',visionFailureCode:'ollama_service_offline',visionBoardsTotal:2,visionBoardsFailed:2},132),event('action-start',{action:'inspect_video_discussion'},135),event('blocked',{code:'account-changed'},140)]}
 const r=describe(run);assert.equal(r.at,120);assert.equal(r.success,false);assert.equal(r.settled,true);assert.match(r.result,/Ollama 未启动.*分镜完成 0\/2/);assert.doesNotMatch(r.result,/账号已切换/)
})
