import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {lifeTransitionReadiness} from '../lib/life-transition-readiness.mjs'
import {createSocialSendTransaction} from '../lib/social-send-transaction.mjs'
import {createSocialHandoffFence} from '../lib/social-handoff-fence.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

const A='a'.repeat(16),B='b'.repeat(16)
const config={masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',
  autonomousPlannerMinutes:60,autonomousPlannerDailyLimit:12,
  peakValley:true,dmStrangerAutonomyEnabled:false,socialAutoSend:false}
const withHome=async work=>{const dir=mkdtempSync(join(tmpdir(),'fish-finalization-'))
  try{return await work(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('read-only transition audit never interprets old video flag as old video driver, or a shadow as social owner',()=>{
 const c=structuredClone(config)
 const x=lifeTransitionReadiness({config:c,accountReady:true,
   planner:{lifeEvents:{ok:true}},handoff:{ok:true,accountReady:true,channels:{dm:{inFlight:0},comment:{inFlight:0}}},
   transactions:{ok:true,accountReady:true,channels:{dm:{},comment:{}}}})
 assert.deepEqual(c,config)
 assert.equal(x.status.legacyVideoRetired,true)
 assert.equal(x.status.oldSocialOwner,true)
 assert.equal(x.phase6,'integration-incomplete')
 assert.equal(x.phase7,'growth-validation-incomplete')
 assert.equal(x.phase8,'not-accepted')
 assert.equal(x.releaseReady,false)
 assert.equal(x.checks.find(c=>c.id==='legacy-video-clock').status,'passed')
 assert.equal(x.checks.find(c=>c.id==='legacy-social-owner').status,'pending')
 assert.equal(x.checks.find(c=>c.id==='windows-real-model-bilibili').status,'pending')
 assert.equal(x.status.unknownSendResults,0)
})
test('unknown account, unreadable ledgers and paused mode never produce a green release status',()=>{
 const x=lifeTransitionReadiness({config:{...config,lifeAgentMode:'off',autonomousPlannerEnabled:false}})
 assert.equal(x.status.accountReady,false)
 assert.equal(x.status.lifeActive,false)
 assert.equal(x.checks.find(c=>c.id==='life-settings').status,'attention')
 assert.equal(x.checks.find(c=>c.id==='send-ledger').status,'unknown')
 assert.equal(x.checks.find(c=>c.id==='handoff-ledger').status,'unknown')
 assert.equal(x.releaseReady,false)
 assert.equal(x.remaining.includes('cold-backup-restore'),true)
})
test('uncertain real transaction and held handoff block migration without exposing account, source or message',()=>withHome(async dir=>{
 let account=A
 const tx=createSocialSendTransaction({dataDir:dir,getAccountTag:()=>account})
 const fence=createSocialHandoffFence({dataDir:dir,getAccountTag:()=>account})
 let calls=0
 const sent=await tx.execute({channel:'dm',eventKey:'private-from-uid-991100'},async()=>{calls++;return {ok:true}})
 assert.equal(sent.ok,false)
 const lease=fence.reserve({channel:'comment',expectedScope:account})
 assert.equal(lease.ok,true)
 const inspected=tx.inspect(),held=fence.inspect()
 const x=lifeTransitionReadiness({config,accountReady:true,planner:{lifeEvents:{ok:true}},handoff:held,transactions:inspected})
 assert.equal(x.status.unknownSendResults,1)
 assert.equal(x.status.needsReview,1)
 assert.equal(x.checks.find(c=>c.id==='send-ledger').status,'attention')
 assert.equal(x.checks.find(c=>c.id==='handoff-ledger').status,'attention')
 assert.match(x.guidance,/不要自动解锁或重试/)
 const serialized=JSON.stringify(x)
 assert.doesNotMatch(serialized,/private-from-uid|991100|aaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb|receiptId|rpid/)
 account=B
 const other=lifeTransitionReadiness({config,accountReady:true,planner:{lifeEvents:{ok:true}},handoff:fence.inspect(),transactions:tx.inspect()})
 assert.equal(other.status.unknownSendResults,0)
 assert.equal(other.status.needsReview,0)
 assert.equal(calls,1)
}))
test('generic manual Life wake respects explicit pause; owner todo manual path is still independent',()=>withHome(async dir=>{
 let calls=0
 const p=createAutonomousPlanner({dataDir:dir,getConfig:()=>({...config,lifeAgentMode:'off',autonomousPlannerEnabled:false}),
   getTodos:()=>[],invokeModel:async()=>{calls++;return '{"action":"skip"}'},
   executeRead:async()=>({ok:true}),updateTodo:async()=>{},reflect:async()=>({ok:true})})
 assert.equal((await p.tick({force:true})).skipped,'life-paused')
 assert.equal((await p.tick({force:true,todosOnly:true})).skipped,'nothing-to-do')
 assert.equal(calls,0)
}))
test('production endpoint and management use only read-only diagnostics; no permission setting or new owner',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(index,/req\.method === 'GET' && path === '\/api\/bili-duty\/life-agent\/transition-readiness'/)
 assert.match(index,/socialSendTransaction\.inspect\(\)/)
 assert.match(index,/socialHandoffFence\.inspect\(\)/)
 assert.match(js,/request\('\/life-agent\/transition-readiness'\)/)
 assert.match(html,/id="life-transition-checklist"/)
 assert.doesNotMatch(index,/path === '\/api\/bili-duty\/life-agent\/transition-readiness'[^\n]*req\.method === 'POST'/)
})
