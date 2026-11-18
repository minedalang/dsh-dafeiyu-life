import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {buildVideoExplorationEvent} from '../lib/video-experience.mjs'

const source=readFileSync(new URL('../index.js', import.meta.url),'utf8')
const bv='BV1EWxd6sExz'

test('watch-video focus receipt remains in scope for non-debug Life memory write and perceptual handoff',()=>{
  const fn=source.slice(source.indexOf('const executeWatchVideo = async'),source.indexOf("name:'bili_video_revisit_moment'")).replace(/\r\n/g,'\n')
  assert.ok(fn.length>1000)
  const declaration=fn.indexOf('let focusReview=null,focusReviewStatus=null')
  const guardedRead=fn.indexOf('try{\n    if(willInvokeVision)')
  const guardedClose=fn.indexOf('}finally{stopLiveVideoObservation()}')
  const memoryWrite=fn.indexOf('accountTag:initialLifeAccountTag,focusReview,')
  const handoff=fn.indexOf('if(focusReview&&videoEvidence&&perceptionHandoff)')
  assert.ok(declaration>=0&&declaration<guardedRead, 'focusReview must be declared outside observation try block')
  assert.ok(guardedRead<guardedClose&&guardedClose<memoryWrite&&memoryWrite<handoff)
})

test('metadata-only exploration creates an honest read experience without pretending to have watched frames',()=>{
  const evt=buildVideoExplorationEvent({bvid:bv,info:{title:'公开视频测试',duration:20},operationId:'test-focus-scope-01',source:'bili-life'})
  assert.ok(evt)
  assert.equal(evt.experience.vision,false)
  assert.equal(evt.experience.visualReceipt,undefined)
})

test('manual video Agent diagnostic does not equate published comments with visual observation',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  assert.match(html,/发表评论，不等于取得视觉理解回执/)
  assert.match(source,/评论成功也不证明视觉理解/)
})
