import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createLifeSocialShadow} from '../lib/life-social-shadow.mjs'
import {runPhase6gSocialAuditOffline} from '../tools/dev4-phase6g-social-audit-offline.mjs'

const A='a'.repeat(16),B='b'.repeat(16),ID='1'.repeat(24)
function fixture(){
  let account=A,allowed=true,clock=1_000_000
  const shadow=createLifeSocialShadow({getAccountTag:()=>account,getConsent:()=>allowed,now:()=>clock})
  const row={eventId:ID,channel:'dm',uid:'111',sourceKey:'id-1',text:'secret-personal-body',role:'friend',verified:true}
  return {shadow,row,account:x=>{account=x},consent:x=>{allowed=x},time:x=>{clock+=x}}
}
test('verified source pairing is immutable even with duplicate different anonymous event IDs',()=>{
  const x=fixture(),{shadow,row}=x
  assert.equal(shadow.capture(row).created,true)
  assert.equal(shadow.capture({...row,eventId:'2'.repeat(24)}).reason,'source-already-staged')
  assert.equal(shadow.capture(row).created,false)
  assert.equal(shadow.noteLife({eventId:ID,expectedScope:A,action:'reply'}).created,true)
  assert.equal(shadow.noteLife({eventId:ID,expectedScope:A,action:'reply'}).created,false)
  assert.equal(shadow.noteLife({eventId:ID,expectedScope:A,action:'defer'}).reason,'life-choice-already-recorded')
  assert.equal(shadow.noteLegacy({channel:'dm',uid:'111',sourceKey:'id-1',action:'silent'}).created,true)
  assert.equal(shadow.noteLegacy({channel:'dm',uid:'111',sourceKey:'id-1',action:'reply'}).reason,'legacy-choice-already-recorded')
  assert.deepEqual([shadow.status().paired,shadow.status().agreed,shadow.status().disagreed],[1,0,1])
})
test('per-channel audit isolates unmatched from truly silent decisions; no payload leakage',()=>{
  const x=fixture(),s=x.shadow
  s.capture(x.row)
  s.capture({eventId:'3'.repeat(24),channel:'comment',uid:'222',sourceKey:'BV1ABcdE123:9',text:'second-private-token',role:'stranger',verified:true})
  s.noteLife({eventId:ID,expectedScope:A,action:'silent'})
  s.noteLegacy({channel:'comment',uid:'222',sourceKey:'BV1ABcdE123:9',action:'silent'})
  const stats=s.status()
  assert.equal(stats.socialHandoffReady,false)
  assert.deepEqual([stats.byChannel.dm.awaitingLegacy,stats.byChannel.dm.awaitingLife],[1,0])
  assert.deepEqual([stats.byChannel.comment.awaitingLegacy,stats.byChannel.comment.awaitingLife],[0,1])
  assert.equal(stats.paired,0)
  assert.doesNotMatch(JSON.stringify(stats),/secret-personal-body|second-private-token|BV1ABcdE123|id-1|a{16}/)
  s.noteLegacy({channel:'dm',uid:'111',sourceKey:'id-1',action:'silent'})
  assert.equal(s.status().byChannel.dm.agreed,1)
  assert.equal(s.status().byChannel.comment.paired,0)
})
test('account change, expired TTL and opt-in revocation invalidate prior verdicts',()=>{
  const x=fixture(),s=x.shadow;s.capture(x.row)
  s.noteLife({eventId:ID,expectedScope:A,action:'reply'})
  x.account(B)
  assert.equal(s.status().staged,0)
  x.account(A)
  assert.equal(s.noteLegacy({channel:'dm',uid:'111',sourceKey:'id-1',action:'reply'}).ok,false)
  s.capture(x.row)
  x.consent(false)
  assert.equal(s.status().staged,0)
  x.consent(true)
  s.capture(x.row)
  x.time(10*60_000+1)
  assert.equal(s.status().paired,0)
})
test('shadow metrics remain read-only; explicit maintenance owner switching is separate',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const consoleJs=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const owner=readFileSync(new URL('../lib/social-decision-ownership.mjs',import.meta.url),'utf8')
  assert.match(index,/socialShadow:lifeSocialShadow\.status\(\)/)
  assert.match(consoleJs,/shadow\.byChannel\?\.\[key\]/)
  assert.match(consoleJs,/未配对不代表选择沉默/)
  assert.match(owner,/!\['legacy','life-agent'\]\.includes\(requester\)/)
  assert.doesNotMatch(index,/socialDecisionOwnership\.route\(\{channel:'dm',requester:'life-agent'/)
})
test('offline audit runs without model, B站 credentials, network or any outbound send',()=>{
  const result=runPhase6gSocialAuditOffline()
  assert.equal(result.ok,true)
  assert.equal(result.scenarios.length,5)
  assert.equal(result.externalMessagesSent,0)
  assert.equal(result.networkCalls,0)
  assert.equal(result.modelCalls,0)
  assert.equal(result.realBilibiliTested,false)
  assert.equal(result.socialHandoffEnabled,false)
})
