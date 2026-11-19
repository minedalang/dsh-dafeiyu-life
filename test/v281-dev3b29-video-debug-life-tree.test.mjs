import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {readVideoDebugSummary,saveVideoDebugSummary,videoDebugSummary} from '../lib/video-debug-receipt.mjs'
import {createLiveLifeActivity} from '../lib/live-life-activity.mjs'
const read=f=>readFileSync(new URL(f,import.meta.url),'utf8')
test('owner debug status is persisted with opaque account binding; raw video/answer never stored',()=>{
  const dir=mkdtempSync(join(tmpdir(),'video-debug-'))
  try{
    const row={status:'running',at:Date.now()-2000,updatedAt:Date.now(),step:3,stage:'contains-sensitive-video-title',bvid:'BV1NEVERWRITE',answer:'private-answer'}
    assert.equal(saveVideoDebugSummary(dir,row,'account-a'),true)
    const data=readFileSync(join(dir,'video-perception-debug-last-run.json'),'utf8')
    for(const secret of ['account-a','BV1NEVERWRITE','private-answer','contains-sensitive-video-title'])assert.equal(data.includes(secret),false)
    assert.equal(readVideoDebugSummary(dir,'account-b'),null)
    assert.equal(readVideoDebugSummary(dir,'account-a').status,'interrupted')
    row.status='done';assert.equal(saveVideoDebugSummary(dir,row,'account-a'),true)
    assert.equal(readVideoDebugSummary(dir,'account-a').status,'done')
    assert.equal(videoDebugSummary({status:'bad',step:800},'account-a').step,6)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
test('debug and Life video observation are separate, real process in-flight activities',()=>{
  let clock=Date.now(),changes=0
  const tracker=createLiveLifeActivity({now:()=>clock,onChange:()=>changes++})
  const stopDebug=tracker.start('video-observe-debug','account')
  const active=tracker.snapshot('account').active
  assert.equal(active.length,1)
  assert.equal(active[0].kind,'video-observe-debug')
  assert.match(active[0].detail,/不是鱼鱼的自主生活行动/)
  stopDebug()
  assert.equal(tracker.snapshot('account').active.length,0)
  assert.equal(tracker.snapshot('account').recent[0].kind,'video-observe-debug')
  assert.equal(tracker.snapshot('other').recent.length,0)
  assert.ok(changes>=2)
})
test('read-only video debug has a completion watchdog and does not count metadata as sight',()=>{
  const index=read('../index.js')
  const ui=read('../lib/management-console.js')
  const html=read('../lib/management-console.html')
  assert.match(index,/videoDebugWorkInFlight/)
  assert.match(index,/8\*60_000/)
  assert.match(index,/result\?\.visual\?\.status==='analyzed'/)
  assert.match(index,/video-observe-debug/)
  assert.match(ui,/lastSummary/)
  assert.match(ui,/当前.*视频|本次资料整理已结束/)
  assert.match(ui,/const branches=\[/)
  assert.match(html,/life-timeline-live-activity/)
  assert.equal((ui.match(/title:'生活安排'/g)||[]).length,1)
})
test('local vision reuse uses bounded warm keep alive rather than forced unload on each call',()=>{
  const local=read('../lib/local-vision-model-manager.mjs')
  const video=read('../lib/preview_vision.py')
  assert.match(local,/keep_alive:'5m'/)
  assert.match(video,/'keep_alive':'5m'/)
  assert.doesNotMatch(video,/'keep_alive':'0'/)
})


test('owner Debug source is an explicit allowlisted choice, preview by default; no fake Life decision',()=>{
  const index=read('../index.js')
  const html=read('../lib/management-console.html')
  const ui=read('../lib/management-console.js')
  assert.match(html,/<select id="video-debug-source"[^>]*><option value="preview" selected>/)
  assert.match(html,/<option value="adaptive">单阶段专项/)
  assert.match(html,/<option value="standard" selected>正常了解/)
  assert.match(ui,/sourceMode:\$\('video-debug-source'\)\.value|const sourceMode=\$\('video-debug-source'\)\.value/)
  assert.match(ui,/depth:\$\('video-debug-depth'\)\.value,sourceMode/)
  assert.match(index,/if\(body\?\.sourceMode!==undefined&&!\['preview','adaptive','life-two-stage'\]\.includes\(body\.sourceMode\)\)/)
  assert.match(index,/const debugPerceptionSource=requestedMode==='adaptive'\?'adaptive':'preview'/)
  assert.match(index,/__debugDryRun:true\},\s*\{debugPerceptionSource\}/)
  assert.match(index,/lifePayload\.visionDecision='owner-debug-'\+visionPlan\.depth/)
  assert.match(index,/if\(!dryRun&&args\.record_session!==false\)/)
  assert.match(html,/<option value="life-two-stage">完整两阶段/)
  assert.match(index,/runVideoDebugTwoStage\(\{bvid,account,job,overview:result\}\)/)
  assert.match(ui,/Life 看后第二次选择/)
})
