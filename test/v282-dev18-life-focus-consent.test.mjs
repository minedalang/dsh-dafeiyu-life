import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const focus=readFileSync(new URL('../lib/video-focus-review.mjs',import.meta.url),'utf8')
const admission=readFileSync(new URL('../lib/life-video-read-admission.mjs',import.meta.url),'utf8')
const watch=server.slice(server.indexOf('const executeWatchVideo = async'),server.indexOf("name:'bili_life_consider_video'"))
const revisit=server.slice(server.indexOf("name:'bili_video_revisit_moment'"),server.indexOf("name:'bili_video_revisit_moment'")+6500)

test('overview uncertainty is only a suggestion, never an automatic focus read',()=>{
  assert.ok(watch.length>1500)
  assert.match(watch,/let focusReview=null,focusReviewStatus=null,focusPlan=null/)
  assert.match(watch,/focusPlan=planVideoFocusReview/)
  assert.match(watch,/focusReviewStatus='life-decision-required'/)
  assert.match(watch,/focusReviewSuggestion/)
  assert.match(watch,/kind:'life-choice-only'/)
  assert.doesNotMatch(watch,/call\('bili_preview_vision',\{bvid,perception_source:'adaptive',view_depth:'deep',\s*focus_start_seconds:focusPlan/)
  assert.match(focus,/no-verified-focus-candidate/)
})
test('actual revisit runs the existing Life vote and verification first',()=>{
  assert.match(revisit,/runLifeChosenVideoRead\(\{willingness:lifeWillingness/)
  assert.match(revisit,/mode:'revisit'/)
  const vote=revisit.indexOf('runLifeChosenVideoRead(')
  const read=revisit.indexOf("call('bili_preview_vision'")
  assert.ok(vote>=0&&read>vote)
  assert.match(admission,/willingness\.decide\(/)
  assert.match(admission,/willingness\.verify\(/)
  assert.match(revisit,/verifyVideoFocusReview/)
})
