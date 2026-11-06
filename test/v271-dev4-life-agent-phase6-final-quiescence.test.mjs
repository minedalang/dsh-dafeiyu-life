import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {createSocialHandoffFence} from '../lib/social-handoff-fence.mjs'
import {createSocialSendTransaction} from '../lib/social-send-transaction.mjs'
import {createUnsafeDirectoryLinkOrSkip} from './helpers/unsafe-directory-link.mjs'

const A='a'.repeat(16),B='b'.repeat(16)
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'dsh-final-social-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  let scope=A
  return {dir,make:()=>createSocialHandoffFence({dataDir:dir,getAccountTag:()=>scope}),
    switchAccount:next=>{scope=next},getAccount:()=>scope}
}
test('a handoff cannot be declared quiescent while a legacy decision is in progress',t=>{
  const f=fixture(t),one=f.make(),other=f.make()
  const op=one.beginLegacyOperation({channel:'dm',phase:'decision'})
  assert.equal(op.ok,true)
  const claim=other.reserve({channel:'dm'})
  assert.equal(claim.ok,true)
  assert.equal(claim.quiescent,false)
  assert.equal(claim.inFlight,1)
  assert.equal(other.inspect().channels.dm.quiescent,false)
  assert.equal(one.beginLegacyOperation({channel:'dm',phase:'send'}).reason,'handoff-fence-held')
  assert.equal(one.endLegacyOperation({token:op.token}).ok,true)
  assert.equal(other.inspect().channels.dm.quiescent,true)
  assert.equal(other.check({channel:'dm'}).reason,'handoff-fence-held',
    'draining an operation must not itself unlock the handoff fence')
  assert.equal(other.releaseDecisionOnly({token:claim.token}).ok,true)
})
test('a held handoff is visible to an operation that starts after reservation',t=>{
  const f=fixture(t),one=f.make(),two=f.make()
  const claim=one.reserve({channel:'comment'})
  assert.equal(claim.quiescent,true)
  assert.equal(two.beginLegacyOperation({channel:'comment',phase:'decision'}).reason,'handoff-fence-held')
  assert.equal(two.inspect().channels.comment.inFlight,0)
  assert.equal(two.beginLegacyOperation({channel:'dm',phase:'send'}).ok,true,
    'the unrelated channel still has a separate lane')
  assert.equal(one.releaseDecisionOnly({token:claim.token}).ok,true)
})
test('in-flight records do not leak across accounts or channels, and only the owner may finish',t=>{
  const f=fixture(t),one=f.make(),two=f.make()
  const op=one.beginLegacyOperation({channel:'dm',phase:'send'})
  assert.equal(op.ok,true)
  assert.equal(two.endLegacyOperation({token:op.token}).reason,'legacy-operation-not-owned')
  f.switchAccount(B)
  assert.equal(two.inspect().channels.dm.inFlight,0)
  assert.equal(two.reserve({channel:'dm'}).quiescent,true)
  f.switchAccount(A)
  assert.equal(two.inspect().channels.dm.inFlight,1)
  assert.equal(one.endLegacyOperation({token:op.token}).ok,true)
  assert.equal(two.inspect().channels.dm.inFlight,0)
})
test('a crashed legacy process prevents a false all-clear, without automatic unlock',t=>{
  const f=fixture(t)
  const moduleUrl=new URL('../lib/social-handoff-fence.mjs',import.meta.url).href
  // Use an actual child process with an independent in-memory owner map.
  const program=`import {createSocialHandoffFence} from ${JSON.stringify(moduleUrl)};
    const f=createSocialHandoffFence({dataDir:process.env.DSH_TEST_ROOT,getAccountTag:()=>${JSON.stringify(A)}});
    const op=f.beginLegacyOperation({channel:'dm',phase:'decision'});
    if(!op.ok)process.exit(2);process.exit(0);`
  const child=spawnSync(process.execPath,['--input-type=module','-e',program],
    {env:{...process.env,DSH_TEST_ROOT:f.dir},encoding:'utf8'})
  assert.equal(child.status,0,child.stderr)
  const second=f.make(),claim=second.reserve({channel:'dm'})
  assert.equal(claim.ok,true)
  assert.equal(claim.quiescent,false)
  assert.equal(claim.inFlight,1)
  assert.equal(claim.needsReview,1)
  assert.equal(second.inspect().channels.dm.inFlightNeedsReview,1)
  assert.equal(second.check({channel:'dm'}).reason,'handoff-fence-held')
})
test('dangling path links and ordinary files fail closed instead of appearing absent',async t=>{
  const x=fixture(t)
  const target=join(x.dir,'missing-target-directory')
  if(!createUnsafeDirectoryLinkOrSkip(t,target,join(x.dir,'social-handoff-fence')))return
  assert.equal(x.make().check({channel:'dm'}).reason,'handoff-fence-storage-unsafe')
  assert.equal(x.make().beginLegacyOperation({channel:'dm'}).reason,'legacy-operation-storage-unsafe')
  const tx=createSocialSendTransaction({dataDir:x.dir,getAccountTag:()=>A})
  let sent=0
  const result=await tx.execute({channel:'dm',eventKey:'real:incoming:1'},async()=>{sent++;return {ok:true,receiptId:'ack'}})
  // A transaction in a different, healthy directory is independent.
  assert.equal(result.ok,true)
  assert.equal(sent,1)
})
test('transaction root with a dangling link or ordinary file refuses every network callback',async t=>{
  const x=fixture(t),outside=join(x.dir,'never-created')
  const root=join(x.dir,'social-send-transactions')
  if(createUnsafeDirectoryLinkOrSkip(t,outside,root)){
    let count=0
    const tx=createSocialSendTransaction({dataDir:x.dir,getAccountTag:()=>A})
    const res=await tx.execute({channel:'comment',eventKey:'video:valid:123'},async()=>{count++;return {ok:true,rpid:'123'}})
    assert.equal(res.reason,'social-transaction-storage-unsafe')
    assert.equal(count,0)
  }
})
test('trusted comment and additional owner/social-share senders join the pre-handoff boundary',()=>{
  const source=awaitReadIndex()
  assert.match(source,/trusted-comment:\$\{bvid\}:\$\{rpid\}:\$\{actorUid\}:\$\{kind\}/)
  assert.match(source,/const receipt=await socialSendTransaction\.execute\(\{channel:'comment'/)
  for(const snippet of ["legacySocialWrite('dm'", "legacySocialWrite('comment'", "()=>ownerCommentAgent.accept(req)",
    "runOwnerDmPublishComment(bvid,body)"])
    assert.ok(source.includes(snippet),`missing live pre-handoff route: ${snippet}`)
})
test('new production callbacks participate in the quiescence protocol without enabling Life Agent sends',()=>{
  const source=String((awaitReadIndex()))
  for(const channel of ['dm','comment'])for(const phase of ['decision','send'])
    assert.match(source,new RegExp(`runLegacySocialOperation\\(\\{channel:'${channel}',expectedScope:owner\\.scope,phase:'${phase}'`))
  assert.match(source,/phase:'send'},\(\)=>ownerCommentAgent\.accept\(req\)/)
  assert.doesNotMatch(source,/socialHandoffFence\.reserve\(/)
  assert.doesNotMatch(source,/socialDecisionOwnership\.route\(\{channel:'dm',requester:'life-agent'/)
})
function awaitReadIndex(){return readFileSync(new URL('../index.js',import.meta.url),'utf8')}
