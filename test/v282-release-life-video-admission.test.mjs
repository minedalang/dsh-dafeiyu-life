import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseLifeFocusBatchAnswer,lifeFocusBatchPrompt} from '../lib/life-video-read-admission.mjs'

const admission=readFileSync(new URL('../lib/life-video-read-admission.mjs',import.meta.url),'utf8')
const willingness=readFileSync(new URL('../lib/life-willingness.mjs',import.meta.url),'utf8')
test('only the verified post-overview read-only opportunity changes Life interest framing',()=>{
  assert.match(willingness,/trigger==='life-post-overview-focus'&&safeCandidates\.every\(c=>c\.kind==='explore_video'\)/)
  assert.match(willingness,/不要为了完成任务而观看，也不要仅因正常流量或模型费用就默认拒绝/)
  assert.match(willingness,/对外写入时必须同时审视拟发送内容/)
  assert.match(admission,/可选只读探索：核实全局预览中感兴趣或没看清的局部/)
  assert.match(admission,/life-declined/)
  assert.match(admission,/life-deferred/)
  assert.match(admission,/account-changed/)
  assert.match(admission,/willingness\.verify\(choice\.proof,'explore_video'/)
})
test('second stage can independently decline with zero extra model output fields',()=>{
  assert.deepEqual(parseLifeFocusBatchAnswer('{"focusTargets":[]}'),[])
  assert.equal(parseLifeFocusBatchAnswer('{"focusTargets":[{"atSeconds":16,"durationSeconds":15}],"reason":"可选"}').length,1)
  assert.equal(parseLifeFocusBatchAnswer('{"focusTargets":[{"atSeconds":16,"durationSeconds":1}]}'),null)
  assert.equal(parseLifeFocusBatchAnswer('{"focusTargets":[{"atSeconds":16,"durationSeconds":15,"url":"https://attacker.invalid"}]}'),null)
  const prompt=lifeFocusBatchPrompt({candidates:[{atSeconds:16,visualCue:'好奇的动作'}],tier:{candidates:4,perBatch:2},remaining:{seconds:30,windows:2,frames:12,bytes:5000000}})
  assert.match(prompt,/不必凑满/)
  assert.match(prompt,/只输出 JSON/)
  assert.match(prompt,/不想继续则输出/)
  assert.doesNotMatch(prompt,/必须选择至少一个|一定要继续看/)
})
