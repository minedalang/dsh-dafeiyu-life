import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialHandoffFence} from '../lib/social-handoff-fence.mjs'
import {createSocialDecisionOwnership} from '../lib/social-decision-ownership.mjs'
import {createSocialSendTransaction} from '../lib/social-send-transaction.mjs'
const A='a'.repeat(16),B='b'.repeat(16)
const CONFIRM='我已停机核实社交归属切换不会造成重复发送'
function setup(t){
  const dir=mkdtempSync(join(tmpdir(),'rc-life-cutover-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  let account=A,mode='active'
  const tag=()=>account
  const fence=()=>createSocialHandoffFence({dataDir:dir,getAccountTag:tag})
  const tx=()=>createSocialSendTransaction({dataDir:dir,getAccountTag:tag})
  const api=()=>createSocialDecisionOwnership({getAccountTag:tag,getLifeAgentMode:()=>mode,handoffFence:fence(),getSendTransactionStatus:()=>tx().inspect()})
  const change=(channel,targetOwner='life-agent',overrides={})=>{
    const x=fence(),booking=x.reserve({channel,expectedScope:account})
    if(!booking.ok)return booking
    const result=x.switchOwner({token:booking.token,channel,targetOwner,confirmation:CONFIRM,
      masterDisabled:true,lifeReady:true,inspectSendTransactions:()=>tx().inspect(),...overrides})
    const released=x.releaseDecisionOnly({token:booking.token,expectedScope:account})
    assert.equal(released.ok,true)
    return result
  }
  return {dir,fence,tx,api,change,setAccount:v=>account=v,setMode:v=>mode=v}
}
test('old accounts start in legacy and a model cannot promote them by claiming to be Life',t=>{
  const x=setup(t)
  assert.equal(x.api().route({channel:'dm',requester:'life-agent'}).reason,'social-handoff-not-enabled')
  assert.equal(x.api().route({channel:'comment',requester:'life-agent'}).reason,'social-handoff-not-enabled')
  assert.equal(x.api().status().socialDecisionOwner,'legacy')
  assert.equal(x.fence().reserve({channel:'comment',requester:'life-agent'}).reason,'social-handoff-not-enabled')
})
test('maintenance requires both a paused session and an exact operator confirmation',t=>{
  const x=setup(t)
  for(const overrides of [{masterDisabled:false},{lifeReady:false},{confirmation:'yes'}]){
    assert.equal(x.change('comment','life-agent',overrides).ok,false)
    assert.equal(x.api().route({channel:'comment'}).ok,true)
  }
  assert.equal(x.api().status().socialHandoffEnabled,false)
})
test('channel cutover is durable, account-scoped, rejects old owner and other channel stays legacy',t=>{
  const x=setup(t),r=x.change('comment')
  assert.equal(r.ok,true)
  assert.equal(x.fence().check({channel:'comment'}).reason,'social-owner-mismatch')
  const next=x.api()
  assert.equal(next.route({channel:'comment'}).ok,false)
  const life=next.route({channel:'comment',requester:'life-agent'})
  assert.equal(life.ok,true)
  assert.equal(life.generation,r.generation)
  assert.equal(next.route({channel:'dm'}).owner,'legacy')
  assert.equal(next.status().socialDecisionOwner,'mixed')
  assert.equal(x.fence().beginLegacyOperation({channel:'comment',phase:'decision'}).ok,false)
  const lane=x.fence()
  const op=lane.beginSocialOperation({channel:'comment',phase:'decision',requester:'life-agent',expectedGeneration:r.generation})
  assert.equal(op.ok,true)
  assert.equal(lane.endLegacyOperation({token:op.token}).ok,true)
  x.setAccount(B)
  assert.equal(x.api().route({channel:'comment'}).owner,'legacy')
  assert.equal(x.api().route({channel:'comment',requester:'life-agent',expectedScope:A}).reason,'account-changed')
  x.setAccount(A)
  assert.equal(x.api().route({channel:'comment',requester:'life-agent'}).ok,true)
})
test('stale replies and inactive Life cannot pass owner generation, rollback invalidates old proof',t=>{
  const x=setup(t),promoted=x.change('comment')
  const life=x.api().route({channel:'comment',requester:'life-agent'})
  assert.equal(life.ok,true)
  x.setMode('shadow')
  assert.equal(x.api().route({channel:'comment',requester:'life-agent'}).reason,'life-not-active')
  x.setMode('active')
  assert.equal(x.change('comment','legacy').ok,true)
  assert.equal(x.api().route({channel:'comment',requester:'life-agent',expectedGeneration:promoted.generation}).ok,false)
  assert.equal(x.api().route({channel:'comment',expectedGeneration:promoted.generation}).reason,'social-owner-generation-changed')
  assert.equal(x.api().route({channel:'comment'}).ok,true)
  assert.equal(x.change('comment','life-agent').ok,true)
  assert.equal(x.api().route({channel:'comment',requester:'life-agent',expectedGeneration:life.generation}).reason,'social-owner-generation-changed')
})
test('active decisions or uncertain platform receipts block cutover and rollback',async t=>{
  const x=setup(t),f=x.fence()
  const inflight=f.beginLegacyOperation({channel:'dm',phase:'decision'})
  assert.equal(inflight.ok,true)
  assert.equal(x.change('dm').reason,'social-operations-not-drained')
  assert.equal(f.endLegacyOperation({token:inflight.token}).ok,true)
  const tx=await x.tx().execute({channel:'dm',eventKey:'dm:unsafe:123'},async()=>({ok:false}))
  assert.equal(tx.no_retry,true)
  assert.equal(x.change('dm').reason,'send-transaction-review-required')
  assert.equal(x.api().route({channel:'dm'}).owner,'legacy')
})
test('owner state tampering fails closed, never falls back to legacy',t=>{
  const x=setup(t)
  assert.equal(x.change('comment').ok,true)
  const root=join(x.dir,'social-handoff-fence','owners')
  const files=readdirSync(root)
  assert.equal(files.length,1)
  const before=readFileSync(join(root,files[0]),'utf8')
  assert.doesNotMatch(before,/a{16}|B站|UID|message|receipt/)
  writeFileSync(join(root,files[0]),'{broken')
  assert.equal(x.api().route({channel:'comment'}).ok,false)
  assert.equal(x.api().route({channel:'comment',requester:'life-agent'}).ok,false)
  assert.equal(x.fence().inspect().ok,false)
  const state=x.api().status()
  assert.equal(state.ok,false)
  assert.equal(state.socialDecisionOwner,'unavailable')
  assert.equal(state.channels.comment,'unavailable')
})
test('production wiring carries owner generation from model decision to final DM and comment send, without extra rights',()=>{
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const dm=readFileSync(new URL('../lib/dm-autoreply.mjs',import.meta.url),'utf8')
  const comment=readFileSync(new URL('../lib/comment-interact.mjs',import.meta.url),'utf8')
  assert.match(host,/const routedSocialOwner=channel=>/)
  assert.match(host,/const socialSendOwner=\(channel,proof\)=>/)
  assert.match(host,/life-decision-proof-required/)
  assert.match(host,/social-decision-stale-after-handoff/)
  assert.match(host,/requester:owner\.owner,expectedGeneration:owner\.generation/)
  assert.match(host,/socialHandoffFence\.switchOwner\(\{/)
  assert.match(host,/body\?\.channel!=='comment'/)
  assert.match(host,/cfg\.masterEnabled===true\|\|cfg\.lifeAgentMode!=='active'/)
  assert.match(host,/socialSendTransaction\.execute\(/)
  assert.match(dm,/socialOwnerProof:decision\.socialOwnerProof/)
  assert.match(comment,/socialOwnerProof:decision\.socialOwnerProof/)
  assert.match(comment,/socialOwnerProof=revised\.socialOwnerProof/)
})
