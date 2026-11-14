import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
const dynamic=readFileSync(new URL('../lib/daily-dynamic.mjs',import.meta.url),'utf8')
test('Life 跨渠道自主沉默与延期不得签发写入证明，续聊不能绕过首次已核实发送',()=>{
  assert.match(index,/generated\?\.action==='defer'/)
  assert.match(index,/return attachSocialProof\(generated,owner\)/)
  assert.match(index,/adoptSocialDecisionQueued\(\{kind:'dm_reply'/)
  assert.match(index,/adoptSocialDecisionQueued\(\{kind:'comment_reply'/)
  assert.match(index,/extendConfirmedDmExpression\(lifeWillingnessProof,reply\)/)
  assert.match(index,/const checked=socialDecisionOwnership\.route\(\{channel:'comment'/)
})
test('only a confirmed public reply queues a bounded Life dynamic opportunity, not direct platform publishing',()=>{
  // Locate the actual PUBLIC comment send branch, not an exact adjacent
  // source-text substring: the Life receipt is deliberately recorded between
  // the platform ack and the downstream memory projection.
  const start=index.indexOf('const receiptId=ack?.ok===true',index.indexOf("channel:'comment',expectedScope:owner.scope,phase:'send'"))
  const stop=index.indexOf('wakeDynamicAfterConfirmedComment()',start)
  assert.ok(start>0&&stop>start)
  const send=index.slice(start,stop+40)
  const confirmed=send.indexOf('if(ack?.ok!==true)return ack')
  const wake=send.indexOf('wakeDynamicAfterConfirmedComment()',confirmed)
  assert.ok(confirmed>0&&wake>confirmed)
  assert.match(index,/lifeWillingness\?\.receipt\(proof,\{status,receiptId\}/)
  assert.match(index,/commentDynamicWakeTimer=setTimeout/)
  assert.match(index,/trustedLifeAccountTag\(\)!==scope/)
  assert.match(index,/cfg\.commentSyncDynamic!==true/)
  assert.match(index,/dailyDynamic\?\.tick\(\{trigger:'confirmed-public-comment'\}\)/)
  assert.match(dynamic,/const tick=async\(\{trigger='spontaneous-window'\}/)
  assert.match(dynamic,/const choice=await chooseLife\(\{trigger,sourceKey:/)
})
