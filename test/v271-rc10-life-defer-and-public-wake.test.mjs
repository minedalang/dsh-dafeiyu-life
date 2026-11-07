import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const dynamic=readFileSync(new URL('../lib/daily-dynamic.mjs',import.meta.url),'utf8')
test('Life cross-channel defer never becomes silent SKIP without a valid P6 continuation',()=>{
  assert.match(index,/req\.socialAutonomy!==true\|\|cfg\.dmP6Enabled===false/)
  assert.match(index,/req\.kind==='at'\?cfg\.commentAtP6Enabled===true:cfg\.commentP6Enabled===true/)
  assert.match(index,/throw Error\('Life 延后私信：当前续行未启用，保留原消息/)
  assert.match(index,/throw Error\('Life 延后评论：当前续行未启用，保留原消息/)
})
test('only a confirmed public reply queues a bounded Life dynamic opportunity, not direct platform publishing',()=>{
  // Locate the actual PUBLIC comment send branch, not an exact adjacent
  // source-text substring: the Life receipt is deliberately recorded between
  // the platform ack and the downstream memory projection.
  const start=index.indexOf('// 后台独立发送，受评论互动专用开关保护')
  const stop=index.indexOf('const interactionScheduler =',start)
  assert.ok(start>0&&stop>start)
  const send=index.slice(start,stop)
  const confirmed=send.indexOf('if(ack?.ok!==true)return ack')
  const wake=send.indexOf('wakeDynamicAfterConfirmedComment()',confirmed)
  assert.ok(confirmed>0&&wake>confirmed)
  assert.match(send,/lifeWillingness\?\.receipt\(req\.lifeWillingnessProof/)
  assert.match(index,/commentDynamicWakeTimer=setTimeout/)
  assert.match(index,/trustedLifeAccountTag\(\)!==scope/)
  assert.match(index,/cfg\.commentSyncDynamic!==true/)
  assert.match(index,/dailyDynamic\?\.tick\(\{trigger:'confirmed-public-comment'\}\)/)
  assert.match(dynamic,/const tick=async\(\{trigger='spontaneous-window'\}/)
  assert.match(dynamic,/const choice=await chooseLife\(\{trigger,sourceKey:/)
})
