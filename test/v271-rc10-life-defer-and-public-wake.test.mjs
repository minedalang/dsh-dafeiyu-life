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
  const confirmed=index.indexOf("if(ack?.ok!==true)return ack\n      try{const role=socialPolicyGate.actor(req.uid).role")
  assert.ok(confirmed>0)
  const wake=index.indexOf('wakeDynamicAfterConfirmedComment()',confirmed)
  assert.ok(wake>confirmed&&wake-confirmed<1200)
  assert.match(index,/commentDynamicWakeTimer=setTimeout/)
  assert.match(index,/trustedLifeAccountTag\(\)!==scope/)
  assert.match(index,/cfg\.commentSyncDynamic!==true/)
  assert.match(index,/dailyDynamic\?\.tick\(\{trigger:'confirmed-public-comment'\}\)/)
  assert.match(dynamic,/const tick=async\(\{trigger='spontaneous-window'\}/)
  assert.match(dynamic,/const choice=await chooseLife\(\{trigger,sourceKey:/)
})
