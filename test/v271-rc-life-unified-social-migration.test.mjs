import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialHandoffFence} from '../lib/social-handoff-fence.mjs'
import {createSocialDecisionOwnership} from '../lib/social-decision-ownership.mjs'
import {createSocialSendTransaction} from '../lib/social-send-transaction.mjs'
const A='a'.repeat(16),B='b'.repeat(16)
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'rc6-life-migrate-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  let tag=A, mode='off'
  const account=()=>tag
  const fence=()=>createSocialHandoffFence({dataDir:dir,getAccountTag:account})
  const tx=()=>createSocialSendTransaction({dataDir:dir,getAccountTag:account})
  const api=()=>createSocialDecisionOwnership({getAccountTag:account,getLifeAgentMode:()=>mode,
    unifiedLifeOnly:true,handoffFence:fence(),getSendTransactionStatus:()=>tx().inspect()})
  const migrate=()=>fence().migrateAllToLife({expectedScope:tag,lifeReady:true,inspectSendTransactions:()=>tx().inspect()})
  return {dir,account,fence,tx,api,migrate,setAccount:x=>tag=x,setMode:x=>mode=x}
}
test('upgrading an old account moves BOTH channels to Life without changing permissions',t=>{
  const x=fixture(t)
  assert.equal(x.api().route({channel:'dm',requester:'legacy'}).reason,'legacy-social-decisions-retired')
  assert.equal(x.api().status().socialDecisionOwner,'migration-pending')
  assert.equal(x.migrate().ok,true)
  assert.equal(x.api().status().socialDecisionOwner,'life')
  for(const channel of ['dm','comment']){
    assert.equal(x.api().route({channel,requester:'legacy'}).ok,false)
    assert.equal(x.api().route({channel,requester:'life-agent'}).ok,true)
  }
  assert.equal(x.migrate().alreadyMigrated,true)
  const another=x.fence()
  assert.equal(another.inspect().channels.dm.owner,'life-agent')
  assert.equal(another.inspect().channels.comment.owner,'life-agent')
})
test('the video Life mode does not secretly enable or disable previously authorized social channels',t=>{
  const x=fixture(t);assert.equal(x.migrate().ok,true)
  for(const mode of ['off','shadow','active']){
    x.setMode(mode)
    assert.equal(x.api().route({channel:'dm',requester:'life-agent'}).ok,true)
  }
  // The actual DM or comment sender is still protected by existing permissions.
})
test('another account has independent migration and cannot reuse stale generation',t=>{
  const x=fixture(t);assert.equal(x.migrate().ok,true)
  const before=x.api().route({channel:'dm',requester:'life-agent'})
  x.setAccount(B)
  assert.equal(x.api().status().socialDecisionOwner,'migration-pending')
  assert.equal(x.api().route({channel:'dm',requester:'life-agent'}).ok,false)
  assert.equal(x.migrate().ok,true)
  assert.equal(x.api().route({channel:'dm',requester:'life-agent',expectedScope:A}).reason,'account-changed')
  x.setAccount(A)
  assert.equal(x.api().route({channel:'dm',requester:'life-agent',expectedGeneration:before.generation}).ok,true)
})
test('inflight legacy activity blocks BOTH channels; does not leave a half migration',t=>{
  const x=fixture(t),f=x.fence()
  const held=f.beginLegacyOperation({channel:'comment',phase:'send'})
  assert.equal(held.ok,true)
  assert.equal(x.migrate().reason,'social-operations-not-drained')
  assert.equal(x.fence().inspect().channels.dm.owner,'legacy')
  assert.equal(x.fence().inspect().channels.comment.owner,'legacy')
  assert.equal(x.fence().inspect().channels.dm.held,false)
  assert.equal(f.endLegacyOperation({token:held.token}).ok,true)
  assert.equal(x.migrate().ok,true)
})
test('unknown send in either channel blocks migration (never refunds or retries)',async t=>{
  const x=fixture(t)
  const uncertain=await x.tx().execute({channel:'dm',eventKey:'unsafe:123'},async()=>({ok:false}))
  assert.equal(uncertain.no_retry,true)
  assert.equal(x.migrate().reason,'send-transaction-review-required')
  for(const lane of ['dm','comment'])assert.equal(x.fence().inspect().channels[lane].owner,'legacy')
})
test('corrupt prior owner record fails closed without auto replacing the file',t=>{
  const x=fixture(t)
  assert.equal(x.migrate().ok,true)
  const dir=join(x.dir,'social-handoff-fence','owners')
  const file=join(dir,readdirSync(dir)[0])
  writeFileSync(file,'{truncated')
  assert.equal(x.migrate().ok,false)
  assert.equal(x.api().route({channel:'dm',requester:'life-agent'}).ok,false)
  assert.equal(readFileSync(file,'utf8'),'{truncated')
})
test('previous explicit legacy rollback does NOT enable the retired runtime',t=>{
  const x=fixture(t)
  assert.equal(x.migrate().ok,true)
  const f=x.fence(),held=f.reserve({channel:'comment'})
  assert.equal(held.ok,true)
  const reverted=f.switchOwner({token:held.token,channel:'comment',targetOwner:'legacy',
    confirmation:'我已停机核实社交归属切换不会造成重复发送',masterDisabled:true,
    lifeReady:true,inspectSendTransactions:()=>x.tx().inspect()})
  assert.equal(reverted.ok,true)
  assert.equal(f.releaseDecisionOnly({token:held.token}).ok,true)
  assert.equal(x.api().route({channel:'comment',requester:'legacy'}).ok,false)
  assert.equal(x.api().route({channel:'comment',requester:'life-agent'}).ok,false)
  assert.equal(x.migrate().ok,true)
  assert.equal(x.api().status().socialDecisionOwner,'life')
})
test('production wiring uses Life for every social write and voluntary video final decision',()=>{
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const intent=readFileSync(new URL('../lib/social-intentions.mjs',import.meta.url),'utf8')
  assert.match(source,/unifiedLifeOnly:true/)
  assert.match(source,/const ensureUnifiedLifeOwner=\(\)=>/)
  assert.match(source,/socialHandoffFence\.migrateAllToLife/)
  assert.match(source,/const lifeSocialWrite=async\(channel,write\)=>/)
  assert.doesNotMatch(source,/const legacySocialWrite=/)
  assert.doesNotMatch(source,/legacyDmWithReceipt/)
  assert.match(source,/authorizeDraft:async/)
  assert.match(source,/decideLifeVideoShare/)
  assert.match(intent,/if\(automatic\)\{[\s\S]*?await authorizeDraft\(/)
  assert.match(source,/legacy-social-decisions-retired|unifiedLifeOnly:true/)
})
