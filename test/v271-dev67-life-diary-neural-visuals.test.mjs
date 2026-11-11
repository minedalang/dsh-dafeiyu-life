import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'

const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const now=Date.parse('2026-11-11T14:00:00+08:00')

test('repeated empty scheduler turns stay out of the owner diary without changing source decisions',()=>{
 const decisions=[1,5,12,25].map(n=>({at:now-n*60000,mode:'active',action:'skip',result:'no-actionable-options',
  blocker:'video-launch-cooldown',options:{video:0},kinds:[]}))
 const original=structuredClone(decisions)
 const diary=buildLifeTimeline({lifeDecisions:decisions,now})
 assert.deepEqual(diary,[])
 assert.deepEqual(decisions,original,'diagnostic evidence remains untouched in the source ledger')
 const withRest=buildLifeTimeline({lifeDecisions:[...decisions,{at:now-2000,mode:'active',action:'skip',
  result:'voluntary-rest',restReasonCode:'need-rest',options:{todos:1}}],now})
 assert.deepEqual(withRest.map(row=>row.type),['life-rest'])
 assert.match(withRest[0].title,/休息|歇/)
 assert.doesNotMatch(JSON.stringify(withRest),/no-actionable-options|video-launch-cooldown|调度诊断/)
})

test('owner video diary omits internal comment decision codes while retaining real selection counts',()=>{
 const rounds=[{source:'life-agent',ref:'b'.repeat(12),startedAt:now-80_000,endedAt:now-20_000,
  state:'completed',pickedCount:3,commentGate:'configured',commentDiagnostics:{reviewRejected:2,modelReviewNotObserved:1}}]
 const diary=buildLifeTimeline({videoRounds:rounds,now})
 assert.equal(diary.find(row=>row.type==='video-round')?.title,'这一轮挑中了 3 条视频')
 assert.equal(diary.find(row=>row.type==='video-round')?.detail,'')
 assert.equal(rounds[0].commentDiagnostics.reviewRejected,2,'original receipt is not changed')
})

test('neural canvas uses uniform high-DPI geometry and retains invisible SVG interaction',()=>{
 const js=src('lib/management-console.js'),html=src('lib/management-console.html')
 const source=js.match(/const neuralViewportGeometry=\(width,height\)=>\{[\s\S]*?\n  \};/)
 assert.ok(source,'viewport geometry helper exists')
 const geometry=new Function(`${source[0]};return neuralViewportGeometry`)()
 assert.deepEqual(geometry(1000,570),{scale:1,offsetX:0,offsetY:0})
 const tall=geometry(660,570)
 assert.equal(tall.scale,.66)
 assert.ok(tall.offsetY>90&&tall.offsetY<100)
 const wide=geometry(1600,570)
 assert.equal(wide.scale,1)
 assert.equal(wide.offsetX,300)
 assert.match(js,/ctx\.setTransform\(dpr\*geometry\.scale,0,0,dpr\*geometry\.scale/)
 assert.match(js,/neuralViewport\.classList\.contains\('is-canvas'\)/)
 assert.match(js,/event\.clientX-rect\.left-geometry\.offsetX/)
 assert.match(html,/\.neural-memory-viewport\.is-canvas #neural-memory-svg\{opacity:0;pointer-events:auto\}/)
 assert.match(html,/\.neural-node \.neural-dot\{stroke:/)
})

test('AGENTS fixes the packaging and concise Chinese Conventional Commit contract',()=>{
 const guide=src('AGENTS.md')
 assert.match(guide,/单个完整 ZIP/)
 assert.match(guide,/Git Patch/)
 assert.match(guide,/COMMIT_MESSAGE\.txt/)
 assert.match(guide,/`<type>\(<scope>\): dev\.N/)
 assert.match(guide,/3～6 条/)
})
