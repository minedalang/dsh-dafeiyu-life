import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createSocialDecisionOwnership} from '../lib/social-decision-ownership.mjs'
import {runPhase4OfflineAcceptance} from '../tools/dev4-phase4-offline-acceptance.mjs'
const A='a'.repeat(16),B='b'.repeat(16)
const make=({initialMode='active'}={})=>{
  let current=A,mode=initialMode,time=1_000_000
  const api=createSocialDecisionOwnership({getAccountTag:()=>current,getLifeAgentMode:()=>mode,now:()=>time})
  return {api,setAccount:value=>{current=value},setMode:value=>{mode=value},advance:n=>{time+=n}}
}
test('off, shadow and active are not social takeover modes; life agent may never claim a reply',()=>{
  const r=make({initialMode:'off'})
  for(const mode of ['off','shadow','active']){
    r.setMode(mode)
    for(const channel of ['dm','comment']){
      assert.deepEqual(r.api.route({channel}).owner,'legacy')
      assert.equal(r.api.route({channel,requester:'life-agent'}).reason,'social-handoff-not-enabled')
      assert.equal(r.api.route({channel,requester:'model'}).ok,false)
    }
  }
  assert.equal(r.api.status().socialHandoffEnabled,false)
})
test('reject unsupported channels, ambiguous scope, and account switch between decision and send',()=>{
  const r=make()
  assert.equal(r.api.route({channel:'follow'}).ok,false)
  const before=r.api.route({channel:'dm'})
  assert.equal(before.scope,A)
  r.setAccount(B)
  assert.equal(r.api.route({channel:'dm',expectedScope:before.scope}).reason,'account-changed')
  r.setAccount('')
  assert.equal(r.api.route({channel:'dm'}).reason,'account-scope-unavailable')
  r.setMode('off')
  assert.equal(r.api.route({channel:'dm'}).ok,true,'legacy off-mode behavior remains unchanged')
})
test('observations are verified-only, account-scoped, deduplicated and do not store raw messages in diagnostics',()=>{
  const r=make(),key='123456:private-comment-secret-body'
  assert.equal(r.api.observe({channel:'dm',eventKey:key}).ok,false)
  assert.equal(r.api.observe({channel:'dm',eventKey:key,verified:true}).created,true)
  assert.equal(r.api.observe({channel:'dm',eventKey:key,verified:true}).created,false)
  assert.deepEqual(r.api.status().observedVerified,{dm:1,comment:0})
  assert.doesNotMatch(JSON.stringify(r.api.status()),/123456|private-comment-secret-body|a{16}/)
  r.setAccount(B)
  assert.deepEqual(r.api.status().observedVerified,{dm:0,comment:0})
  assert.equal(r.api.observe({channel:'dm',eventKey:key,verified:true}).created,true)
  r.setAccount(A)
  assert.deepEqual(r.api.status().observedVerified,{dm:1,comment:0})
})
test('observed signals expire in a bounded volatile TTL and cannot mutate life memory or platform receipts',()=>{
  const r=make()
  assert.equal(r.api.observe({channel:'comment',eventKey:'a',verified:true}).ok,true)
  r.advance(24*60*60*1000+1)
  assert.deepEqual(r.api.status().observedVerified,{dm:0,comment:0})
  assert.equal(Object.keys(r.api).includes('send'),false)
  assert.equal(Object.keys(r.api).includes('write'),false)
})
test('no privilege escalation through unusual runtime mode or fake requester',()=>{
  const r=make()
  r.setMode('social-active')
  assert.equal(r.api.status().mode,'off')
  assert.equal(r.api.route({channel:'dm',requester:'life-agent',expectedScope:A}).ok,false)
  assert.equal(r.api.observe({channel:'comment',eventKey:'',verified:true}).ok,false)
  assert.equal(r.api.observe({channel:'comment',eventKey:'x'.repeat(181),verified:true}).ok,false)
})
test('production DM + comment generation and sends recheck same account; read-only status is exposed',()=>{
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(src,/createSocialDecisionOwnership\(\{[\s\S]*?getAccountTag:trustedLifeAccountTag/)
  assert.match(src,/generateReply: async \(req\) => \{\s*const owner=routedSocialOwner\('dm'\)/)
  assert.match(src,/generateReply: async \(req\) => \{\s*const owner=routedSocialOwner\('comment'\)/)
  for(const channel of ['dm','comment'])assert.match(src,new RegExp("socialDecisionOwnership\\.route\\(\\{channel:'"+channel+"',requester:owner\\.owner,expectedScope:owner\\.scope,expectedGeneration:owner\\.generation\\}\\)"))
  assert.match(src,/socialDecisionOwnership\.status\(\)/)
  const gate=readFileSync(new URL('../lib/social-decision-ownership.mjs',import.meta.url),'utf8')
  assert.match(gate,/!\['legacy','life-agent'\]\.includes\(requester\)/) // only the durable gate, not a model, selects owner
})
test('offline acceptance runs with synthetic messages and fake snapshot; no B站, no model, no network',()=>{
  const r=runPhase4OfflineAcceptance()
  assert.equal(r.scenarios,5)
  assert.equal(r.results.every(x=>x.passed),true)
  assert.equal(r.externalMessagesSent,0)
  assert.equal(r.networkCalls,0)
  assert.equal(r.modelCalls,0)
  assert.equal(r.realBilibiliTested,false)
})
