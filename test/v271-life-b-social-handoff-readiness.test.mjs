import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {join} from 'node:path'
import {createSocialHandoffFence} from '../lib/social-handoff-fence.mjs'
import {createSocialDecisionOwnership} from '../lib/social-decision-ownership.mjs'
import {createSocialSendTransaction} from '../lib/social-send-transaction.mjs'

const ACCOUNT='a'.repeat(16)
function make(t){
  const dir=mkdtempSync(join(tmpdir(),'dsh-b-handoff-'))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  let account=ACCOUNT,mode='active',optedIn=true
  const getAccountTag=()=>account
  const fence=createSocialHandoffFence({dataDir:dir,getAccountTag})
  const txn=createSocialSendTransaction({dataDir:dir,getAccountTag})
  const sample=()=>({enabled:optedIn,byChannel:{dm:{paired:6},comment:{paired:6}}})
  const ownership=createSocialDecisionOwnership({getAccountTag,getLifeAgentMode:()=>mode,
    handoffFence:fence,getSendTransactionStatus:()=>txn.inspect(),getSocialShadowStatus:sample})
  return {dir,fence,txn,ownership,setAccount:x=>account=x,setMode:x=>mode=x,setOptedIn:x=>optedIn=x}
}
const inspectEmpty=()=>({ok:true,accountReady:true,channels:{dm:{confirmed:0,attempted:0,uncertain:0,incomplete:0},
  comment:{confirmed:0,attempted:0,uncertain:0,incomplete:0}}})

test('both channels remain legacy even with a clean readiness report until explicitly switched',t=>{
  const x=make(t),status=x.ownership.status()
  for(const channel of ['dm','comment']){
    assert.deepEqual(status.handoffReadiness.channels[channel].preflightBlockers,[])
    assert.equal(status.handoffReadiness.channels[channel].preflightReady,false)
    assert.equal(x.ownership.route({channel}).owner,'legacy')
  }
  assert.equal(status.socialHandoffEnabled,false)
})
test('a held rehearsal remains a hard blocker on exactly one channel',t=>{
  const x=make(t),claim=x.fence.reserve({channel:'dm'})
  assert.equal(claim.ok,true)
  assert.ok(x.ownership.readiness().channels.dm.preflightBlockers.includes('handoff-reservation-held'))
  assert.equal(x.ownership.readiness().channels.comment.preflightBlockers.length,0)
  assert.equal(x.ownership.route({channel:'dm'}).reason,'handoff-fence-held')
  assert.equal(x.fence.releaseDecisionOnly({token:claim.token}).ok,true)
})
test('rehearsal closes and reopens only its own lane, never authorizes a sender',t=>{
  const x=make(t),before=x.fence.inspect()
  assert.equal(before.channels.dm.held,false)
  const dry=x.fence.rehearse({channel:'dm',expectedScope:ACCOUNT,inspectSendTransactions:()=>x.txn.inspect()})
  assert.deepEqual(dry,{ok:true,reason:'decision-only-dry-run-passed',quiescent:true,
    confirmedHistoricalSends:0,held:false,socialHandoffEnabled:false})
  assert.equal(x.fence.inspect().channels.dm.held,false)
  assert.equal(x.ownership.route({channel:'dm'}).owner,'legacy')
  assert.equal(x.fence.inspect().handoffEnabled,false)
})
test('rehearsal with a live legacy send returns blocked and does not leak reservation',t=>{
  const x=make(t),operation=x.fence.beginLegacyOperation({channel:'dm',phase:'send'})
  assert.equal(operation.ok,true)
  const result=x.fence.rehearse({channel:'dm',inspectSendTransactions:inspectEmpty})
  assert.equal(result.reason,'legacy-operations-in-flight')
  assert.equal(result.held,false)
  assert.equal(result.inFlight,1)
  assert.equal(x.fence.endLegacyOperation({token:operation.token}).ok,true)
  assert.equal(x.fence.rehearse({channel:'dm',inspectSendTransactions:inspectEmpty}).ok,true)
})
test('unknown, incomplete and attempted sends each block rehearsal without repeating platform calls',async t=>{
  for(const result of [undefined,{ok:false},{ok:true,receiptId:''}]){
    const x=make(t);let calls=0
    const ack=await x.txn.execute({channel:'dm',eventKey:'dm:sample:'+String(calls)+':'+String(result)},async()=>{calls++;return result})
    assert.equal(ack.no_retry,true)
    assert.equal(calls,1)
    const dry=x.fence.rehearse({channel:'dm',inspectSendTransactions:()=>x.txn.inspect()})
    assert.equal(dry.reason,'send-transaction-review-required')
    assert.equal(dry.uncertain,1)
    assert.equal(x.ownership.readiness().channels.dm.sendNeedsReview,1)
    assert.equal(x.fence.inspect().channels.dm.held,false)
  }
})
test('a confirmed historical send does not mistakenly freeze other future decisions',async t=>{
  const x=make(t),ack=await x.txn.execute({channel:'comment',eventKey:'comment:source:123'},async()=>({ok:true,rpid:'123'}))
  assert.equal(ack.ok,true)
  const dry=x.fence.rehearse({channel:'comment',inspectSendTransactions:()=>x.txn.inspect()})
  assert.equal(dry.ok,true)
  assert.equal(dry.confirmedHistoricalSends,1)
  assert.equal(x.ownership.route({channel:'comment'}).owner,'legacy')
})
test('inspector is mandatory and a failed or malformed report never proves quiescence',t=>{
  const x=make(t)
  for(const inspect of [undefined,()=>({ok:true,channels:{}}),()=>{throw Error('broken')},
    ()=>({ok:true,accountReady:true,channels:{dm:{confirmed:0,uncertain:-1,attempted:0,incomplete:0}}})]){
    const out=x.fence.rehearse({channel:'dm',inspectSendTransactions:inspect})
    assert.equal(out.ok,false)
    assert.equal(out.held,false)
  }
})
test('switching login during rehearsal freezes old account reservation for explicit review',t=>{
  const x=make(t)
  const out=x.fence.rehearse({channel:'dm',inspectSendTransactions:()=>{
    x.setAccount('b'.repeat(16));return inspectEmpty()
  }})
  assert.equal(out.reason,'rehearsal-reservation-review-required')
  assert.equal(out.held,true)
  assert.equal(x.ownership.readiness().channels.dm.preflightBlockers.includes('handoff-reservation-held'),false,
    'new account is not contaminated by prior account lane')
  x.setAccount(ACCOUNT)
  assert.equal(x.fence.check({channel:'dm'}).reason,'handoff-fence-held')
})
test('readiness is privacy-preserving, fail-closed, account-scoped and not a credential',t=>{
  const x=make(t)
  x.setOptedIn(false)
  let status=x.ownership.status()
  assert.equal(status.handoffReadiness.channels.dm.preflightBlockers.includes('verified-social-context-not-opted-in'),false, 'retired shadow opt-in is not a production blocker')
  x.setMode('off')
  assert.ok(x.ownership.readiness().channels.comment.preflightBlockers.includes('life-not-active'))
  x.setAccount('')
  status=x.ownership.status()
  assert.ok(status.handoffReadiness.channels.comment.preflightBlockers.includes('account-scope-unavailable'))
  assert.equal(x.ownership.route({channel:'comment',requester:'life-agent'}).ok,false)
  assert.equal(JSON.stringify(status).includes(ACCOUNT),false)
  assert.equal(JSON.stringify(status).includes('123456789'),false)
})
test('source wiring migrates both channels under the fence and keeps dry-run manual',()=>{
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(source,/getSendTransactionStatus:\(\)=>socialSendTransaction\.inspect\(\)/)
  assert.match(source,/getSocialShadowStatus:\(\)=>lifeSocialShadow\?\.status\(\)/)
  assert.equal((source.match(/socialHandoffFence\.rehearse\(/g)||[]).length,1,'only the explicit developer endpoint may run rehearsal')
  assert.match(source,/socialHandoffFence\.migrateAllToLife\(\{expectedScope/)
  assert.match(source,/body\?\.confirmation!==/)
  assert.match(source,/requester:'life-agent'/)
})

test('manual rehearsal remains backend-gated and is absent from ordinary management UI',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  assert.match(index,/req\.method === 'POST' && path === '\/api\/bili-duty\/life-agent\/social-handoff-rehearsal'/)
  assert.match(index,/body\?\.confirm!=='DRY_RUN_SOCIAL_HANDOFF_NO_SEND'/)
  assert.match(index,/sec-fetch-site/)
  assert.match(index,/noPlatformCalls:true/)
  assert.match(index,/cfg\.masterEnabled===true.*关闭 B站生活总开关/)
  assert.match(index,/rehearsalPassed:report\.ok===true/)
  assert.doesNotMatch(js,/只读交接演练|request\('\/life-agent\/social-handoff-rehearsal'/)
  assert.doesNotMatch(html,/life-handoff-dry-dm|life-handoff-dry-comment|life-transition-checklist/)
  assert.doesNotMatch(index,/socialHandoffFence\.rehearse\(\{channel:'dm'/)
})

test('transition audit version is supplied by current package, not pinned to old dev4',async()=>{
  const {lifeTransitionReadiness}=await import('../lib/life-transition-readiness.mjs')
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
  assert.equal(lifeTransitionReadiness({version:pkg.version}).version,pkg.version)
  assert.equal(lifeTransitionReadiness().version,'unknown')
})


async function spawnLegacyWorker(t,dir){
  const moduleUrl=new URL('../lib/social-handoff-fence.mjs',import.meta.url).href
  const code=`import {createSocialHandoffFence} from ${JSON.stringify(moduleUrl)};
    const fence=createSocialHandoffFence({dataDir:process.argv[1],getAccountTag:()=>${JSON.stringify(ACCOUNT)}});
    const claim=fence.beginLegacyOperation({channel:'dm',phase:'send'});
    if(!claim.ok){process.stderr.write(claim.reason);process.exit(2)}
    process.stdout.write('READY\\n');
    process.stdin.once('data',()=>{const released=fence.endLegacyOperation({token:claim.token});process.exit(released.ok?0:3)});`
  const child=spawn(process.execPath,['--input-type=module','-e',code,dir],{stdio:['pipe','pipe','pipe']})
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL')})
  const result=await Promise.race([once(child.stdout,'data'),once(child,'exit').then(([code])=>{throw Error('worker exited before ready: '+code)})])
  assert.match(String(result[0]),/READY/)
  return child
}

test('separate Node processes cannot pass a channel rehearsal while a legacy send is active',async t=>{
  const x=make(t),child=await spawnLegacyWorker(t,x.dir)
  const state=x.fence.inspect()
  assert.equal(state.channels.dm.inFlight,1)
  const dry=x.fence.rehearse({channel:'dm',inspectSendTransactions:()=>x.txn.inspect()})
  assert.equal(dry.ok,false)
  assert.equal(dry.reason,'legacy-operations-in-flight')
  assert.equal(x.fence.inspect().channels.dm.held,false)
  child.stdin.write('release\n')
  const [code]=await once(child,'exit')
  assert.equal(code,0)
  assert.equal(x.fence.inspect().channels.dm.inFlight,0)
  assert.equal(x.fence.rehearse({channel:'dm',inspectSendTransactions:()=>x.txn.inspect()}).ok,true)
})

test('crashed foreign process leaves a non-expiring in-flight review record',async t=>{
  const x=make(t),child=await spawnLegacyWorker(t,x.dir)
  child.kill('SIGKILL')
  await once(child,'exit')
  const state=x.fence.inspect()
  assert.equal(state.channels.dm.inFlight,1)
  assert.equal(state.channels.dm.inFlightNeedsReview,1)
  const dry=x.fence.rehearse({channel:'dm',inspectSendTransactions:()=>x.txn.inspect()})
  assert.equal(dry.ok,false)
  assert.equal(dry.reason,'legacy-inflight-review-required')
  assert.equal(dry.needsReview,1)
  assert.equal(x.ownership.readiness().channels.dm.preflightBlockers.includes('legacy-operation-review-required'),true)
  assert.equal(x.fence.inspect().channels.dm.inFlightNeedsReview,1)
})
