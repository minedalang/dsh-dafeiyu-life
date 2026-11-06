import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSocialHandoffFence} from '../lib/social-handoff-fence.mjs'
import {createSocialDecisionOwnership} from '../lib/social-decision-ownership.mjs'

const A='a'.repeat(16),B='b'.repeat(16)
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'dsh-social-fence-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  let account=A,time=1_000_000
  const factory=()=>createSocialHandoffFence({dataDir:dir,getAccountTag:()=>account,now:()=>time})
  return {dir,fence:factory(),factory,account:x=>account=x,time:x=>time+=x}
}
test('two independent instances cannot claim the same account/channel lane',t=>{
  const x=fixture(t),one=x.fence,two=x.factory()
  const reservation=one.reserve({channel:'dm',expectedScope:A})
  assert.equal(reservation.ok,true)
  assert.deepEqual(two.reserve({channel:'dm'}),{ok:false,reason:'handoff-fence-held'})
  assert.equal(two.check({channel:'dm'}).reason,'handoff-fence-held')
  assert.equal(two.reserve({channel:'comment'}).ok,true,'channels remain independent')
  assert.equal(one.releaseDecisionOnly({token:reservation.token}).ok,true)
  assert.equal(two.check({channel:'dm'}).ok,true)
})
test('reserving an anonymous lane cannot grant Life Agent social ownership',t=>{
  const x=fixture(t)
  for(const who of ['life-agent','model','unknown'])assert.equal(x.fence.reserve({channel:'dm',requester:who}).reason,'social-handoff-not-enabled')
  assert.equal(x.fence.check({channel:'follow'}).ok,false)
  assert.equal(x.fence.reserve({channel:'follow'}).ok,false)
  assert.equal(x.fence.inspect().handoffEnabled,false)
})
test('legacy production route denies a held lane, not the unrelated channel',t=>{
  const x=fixture(t)
  const owner=createSocialDecisionOwnership({getAccountTag:()=>A,getLifeAgentMode:()=> 'active',handoffFence:x.fence})
  assert.equal(owner.route({channel:'dm'}).ok,true)
  const claim=x.fence.reserve({channel:'dm'})
  assert.equal(owner.route({channel:'dm'}).reason,'handoff-fence-held')
  assert.equal(owner.route({channel:'comment'}).owner,'legacy')
  assert.equal(owner.status().handoffFence.channels.dm.held,true)
  assert.equal(owner.status().socialHandoffEnabled,false)
  assert.equal(x.fence.releaseDecisionOnly({token:claim.token}).ok,true)
  assert.equal(owner.route({channel:'dm'}).owner,'legacy')
})
test('scope change rejects completion and never reassigns old lock to new account',t=>{
  const x=fixture(t)
  const claim=x.fence.reserve({channel:'dm'})
  x.account(B)
  assert.equal(x.fence.check({channel:'dm'}).ok,true)
  assert.equal(x.fence.releaseDecisionOnly({token:claim.token}).reason,'account-changed')
  const second=x.fence.reserve({channel:'dm'})
  assert.equal(second.ok,true)
  x.account(A)
  assert.equal(x.fence.check({channel:'dm'}).reason,'handoff-fence-held')
  assert.equal(x.fence.releaseDecisionOnly({token:claim.token}).ok,true)
  x.account(B)
  assert.equal(x.fence.releaseDecisionOnly({token:second.token}).ok,true)
})
test('no verified current account fails closed; legacy off mode still keeps existing compatibility',t=>{
  const x=fixture(t)
  x.account('')
  assert.equal(x.fence.reserve({channel:'dm'}).reason,'account-scope-unavailable')
  assert.equal(x.fence.check({channel:'dm'}).reason,'account-scope-unavailable')
  const owner=createSocialDecisionOwnership({getAccountTag:()=>'',getLifeAgentMode:()=> 'off',handoffFence:x.fence})
  assert.equal(owner.route({channel:'dm'}).ok,true)
  assert.equal(owner.status().handoffFence.accountReady,false)
})
test('lock cannot be released by other process instance or wrong token; no stale timeout unlock',t=>{
  const x=fixture(t)
  const claim=x.fence.reserve({channel:'comment'})
  assert.equal(x.factory().releaseDecisionOnly({token:claim.token}).reason,'reservation-not-owned-by-process')
  assert.equal(x.fence.releaseDecisionOnly({token:'wrong'}).ok,false)
  x.time(31*60_000)
  assert.equal(x.fence.inspect().channels.comment.needsReview,true)
  assert.equal(x.fence.check({channel:'comment'}).ok,false)
  assert.equal(x.fence.releaseDecisionOnly({token:claim.token}).ok,true)
})
test('review requires exact explicit no-send confirmation and a dead owner',t=>{
  const x=fixture(t)
  const claim=x.fence.reserve({channel:'comment'})
  assert.equal(x.fence.reviewNoSend({channel:'comment',confirmation:'sure'}).reason,'explicit-no-send-confirmation-required')
  assert.equal(x.fence.reviewNoSend({channel:'comment',confirmation:'我已确认该预约从未触发平台发送'}).reason,'reservation-process-still-alive')
  assert.equal(x.fence.releaseDecisionOnly({token:claim.token}).ok,true)
  assert.equal(x.fence.reviewNoSend({channel:'comment',confirmation:'我已确认该预约从未触发平台发送'}).reason,'no-held-reservation')
})
test('interrupted empty reservation is never freed by inspection, and unsafe file is frozen',t=>{
  const x=fixture(t),res=x.fence.reserve({channel:'dm'}),lanes=join(x.dir,'social-handoff-fence','lanes')
  const [id]=readdirSync(lanes)
  assert.equal(id.length,64)
  assert.equal(readFileSync(join(lanes,id,'claim.json'),'utf8').includes(A),false)
  assert.equal(x.fence.releaseDecisionOnly({token:res.token}).ok,true)
  mkdirSync(join(lanes,id))
  assert.equal(x.fence.check({channel:'dm'}).reason,'handoff-fence-held')
  assert.equal(x.fence.inspect().channels.dm.state,'unreadable')
  assert.equal(x.fence.reviewNoSend({channel:'dm',confirmation:'我已确认该预约从未触发平台发送'}).reason,'reservation-incomplete')
})
test('symbolic links in the reservation path fail closed without modifying the target',t=>{
  const x=fixture(t),outside=mkdtempSync(join(tmpdir(),'dsh-fence-outside-'))
  t.after(()=>rmSync(outside,{recursive:true,force:true}))
  symlinkSync(outside,join(x.dir,'social-handoff-fence'))
  assert.equal(x.fence.reserve({channel:'dm'}).reason,'handoff-fence-storage-unsafe')
  assert.equal(x.fence.check({channel:'dm'}).reason,'handoff-fence-storage-unsafe')
  assert.deepEqual(readdirSync(outside),[])
})
test('status and claim never contain raw account, UID, private text, or target',t=>{
  const x=fixture(t),claim=x.fence.reserve({channel:'dm'})
  const status=x.fence.inspect(),contents=readFileSync(join(x.dir,'social-handoff-fence','lanes',readdirSync(join(x.dir,'social-handoff-fence','lanes'))[0],'claim.json'),'utf8')
  for(const secret of [A,'123456789','private chat','BV1abcdefghij']){
    assert.equal(JSON.stringify(status).includes(secret),false)
    assert.equal(contents.includes(secret),false)
  }
  assert.equal(x.fence.releaseDecisionOnly({token:claim.token}).ok,true)
})
test('source index integration is read-only and not a new platform sender',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const fence=readFileSync(new URL('../lib/social-handoff-fence.mjs',import.meta.url),'utf8')
  assert.match(index,/const socialHandoffFence=createSocialHandoffFence\(\{dataDir:stateDir,getAccountTag:trustedLifeAccountTag\}\)/)
  assert.match(index,/handoffFence:socialHandoffFence/)
  assert.doesNotMatch(fence,/bili_send_message|bili_reply|bili_dynamic_reply_inbox|fetch\(/)
  assert.doesNotMatch(index,/socialHandoffFence\.reserve\(/)
})
test('unreadable or modified lease phase cannot be cleared as a confirmed no-send decision',t=>{
  const x=fixture(t),claim=x.fence.reserve({channel:'dm'})
  const root=join(x.dir,'social-handoff-fence','lanes'),path=join(root,readdirSync(root)[0],'claim.json')
  const row=JSON.parse(readFileSync(path,'utf8'))
  writeFileSync(path,JSON.stringify({...row,phase:'platform-send',pid:0}))
  assert.equal(x.fence.check({channel:'dm'}).reason,'handoff-fence-held')
  assert.equal(x.fence.inspect().channels.dm.state,'unreadable')
  assert.equal(x.fence.reviewNoSend({channel:'dm',confirmation:'我已确认该预约从未触发平台发送'}).reason,'reservation-unreadable')
  assert.equal(x.fence.releaseDecisionOnly({token:claim.token}).reason,'reservation-mismatch')
})
