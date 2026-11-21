import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeDecisionTrace,lifeTraceExplanation} from '../lib/life-decision-trace.mjs'
import {createLifeWillingness} from '../lib/life-willingness.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

const A='a'.repeat(16),B='b'.repeat(16),T=Date.parse('2026-11-19T01:00:00Z')
const make=(steps=[],state='finished')=>({state,at:T,updatedAt:T,steps:steps.map(x=>({at:T,...x}))})
const choice=(action='skip',code='valid')=>({type:'model-choice',action,code})
const exec=(result,delivery='not-proven')=>({type:'execution-result',result,delivery})
const explain=(steps,state)=>lifeTraceExplanation(make(steps,state),T)
const home=async fn=>{const dir=mkdtempSync(join(tmpdir(),'life-dev8-explain-'));try{return await fn(dir)}finally{rmSync(dir,{force:true,recursive:true})}}

test('read-only projection distinguishes voluntary rest, deferral and invalid model decisions',()=>{
  const rest=explain([choice(),exec('voluntary-rest','not-sent')])
  assert.equal(rest.category,'voluntary-rest');assert.equal(rest.actor,'life');assert.equal(rest.proof,'model-choice')
  assert.equal(explain([{type:'model-choice',action:'skip',code:'model-json-invalid'},exec('invalid-decision','not-sent')]).category,'invalid-decision')
  assert.equal(explain([choice('defer','model-accepted'),exec('no-action','not-sent')]).category,'voluntary-defer')
  assert.equal(explain([{type:'candidate-scan',eventCount:0},{type:'finish',result:'no-actionable-options'}]).category,'no-opportunity')
  assert.equal(explain([{type:'candidate-scan',eventCount:4}]).category,'candidates-only')
  assert.equal(explain([{type:'blocked',code:'model-backoff'},choice('skip')]).category,'choice-without-receipt')
})

test('platform success requires verified result AND platform-confirmed delivery; local and delegated remain separate',()=>{
  assert.equal(explain([choice('act','model-accepted'),exec('verified','platform-confirmed')]).category,'platform-verified')
  assert.equal(explain([choice('act','model-accepted'),exec('verified','not-proven')]).category,'action-verified')
  assert.equal(explain([choice('act','model-accepted'),exec('delegated','delegated-not-confirmed')]).category,'delegated-unconfirmed')
  assert.equal(explain([choice('talk_to_owner'),exec('owner-chat-queued','host-queued-not-delivered')]).category,'host-queued')
  assert.equal(explain([choice('consider_social'),exec('attention-only','not-sent')]).category,'local-only')
  assert.equal(explain([choice('act','model-accepted'),exec('accepted-unverified','not-confirmed')]).category,'local-result-unverified')
  assert.equal(explain([choice('act','model-accepted'),exec('uncertain','outcome-unknown')]).category,'result-uncertain')
  assert.equal(explain([choice('act','model-accepted'),exec('verified','platform-confirmed'),{type:'action-result',result:'failed'}]).category,'result-uncertain')
  // A previous success cannot cover a later unknown action in the same run.
  assert.equal(explain([choice('act','model-accepted'),exec('verified','platform-confirmed'),choice('act','model-accepted'),exec('uncertain','outcome-unknown')]).category,'result-uncertain')
})

test('technical block, network, budget, account, evidence, model and read failure are not Life refusal',()=>{
  const cases=[
    ['comment-permission-off','permission-blocked'],['metadata-rate-limited','platform-rate-limit'],
    ['life-resource-deferred','resource-deferred'],['model-backoff','model-unavailable'],
    ['life-account-changed','account-unavailable'],['metadata-read-busy','reservation-held'],
    ['life-context-unavailable','evidence-insufficient'],['read-budget-exhausted','budget-deferred'],
    ['dns-backoff','network-deferred'],['unknown-private-error','technical-blocked']]
  for(const [code,expected] of cases){
    const x=explain([{type:'blocked',code}], 'blocked')
    assert.equal(x.category,expected,code);assert.equal(x.actor,'system',code)
  }
  assert.equal(explain([choice('inspect_exploration'),{type:'read-result',state:'rejected',code:'metadata-api-error'},exec('metadata-read-failed')]).category,'read-unavailable')
  assert.equal(explain([choice('inspect_exploration'),{type:'read-result',state:'rejected',code:'metadata-rate-limited'},exec('metadata-read-failed')]).category,'platform-rate-limit')
  assert.equal(explain([choice('skip','model-accepted'),{type:'error',code:'model-call-failed'}],'failed').category,'model-unavailable')
})

test('running approval is not a crash or verified send, and stale approvals require review',()=>{
  const steps=[choice('act','model-accepted'),{type:'execution-plan',action:'act',delivery:'approval-only'}]
  assert.equal(explain(steps,'running').category,'approval-pending')
  assert.equal(lifeTraceExplanation(make(steps,'running'),T+6*60_000).category,'approval-review-required')
  assert.equal(explain([...steps,exec('verified','platform-confirmed')],'running').category,'receipt-unsettled')
  assert.equal(explain(steps).category,'approval-review-required')
  assert.equal(explain([choice('browse_home'),{type:'action-start',action:'browse_home'}],'running').category,'execution-in-progress')
  assert.equal(explain([choice('skip')],'running').category,'choice-awaiting-result')
})

test('comment menu reasons are independent of final Life choice; no raw model text or identifiers',()=>home(async dir=>{
  let account=A
  const t=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>account,now:()=>T})
  const row=t.begin({mode:'active',trigger:'social'})
  row.step('model-call',{commentOffered:false,commentNotOfferedCode:'comment-permission-off',prompt:'secret owner',target:'BV1abcdefghij'})
  row.step('model-choice',{action:'skip',code:'valid',restReasonCode:'not-now',reason:'owner private UID 1234567'})
  row.step('execution-result',{action:'skip',result:'voluntary-rest',delivery:'not-sent'})
  row.finish({state:'finished',result:'voluntary-rest'})
  const listed=t.list().runs[0]
  assert.equal(listed.explanation.category,'voluntary-rest')
  assert.equal(listed.explanation.commentOpportunity,'comment-permission-off')
  assert.equal(listed.explanation.restReason,'not-now')
  assert.deepEqual(t.get(row.id).explanation,listed.explanation)
  assert.doesNotMatch(JSON.stringify(listed),/secret owner|1234567|BV1abcdefghij/)
  account=B;assert.deepEqual(t.list().runs,[]);assert.equal(t.get(row.id).ok,false)
}))

test('production Planner and Willingness traces expose actual decisions without an extra model call',()=>home(async dir=>{
  const journal=createLifeDecisionTrace({dataDir:dir,getAccountTag:()=>A,now:()=>T})
  let calls=0
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>T,getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,
    lifeAgentMode:'active',autonomousPlannerDailyLimit:20,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
    getLifeAccountTag:()=>A,getTodos:()=>[{id:'123e4567-e89b-12d3-a456-426614174000',type:'inspect_my_space',title:'secret-title',status:'open'}],
    invokeModel:async()=>{calls++;return '{"action":"skip","reason":"先休息","restReasonCode":"need-rest"}'},
    executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false}),reflect:async()=>({ok:false}),
    beginDecisionTrace:args=>journal.begin(args)})
  const p=await planner.tick({force:true})
  assert.equal(calls,1)
  assert.equal(journal.get(p.traceId).explanation.category,'voluntary-rest')
  const willing=createLifeWillingness({dataDir:dir,getAccountTag:()=>A,now:()=>T,
    getContext:async()=>({voice:'private',world:{},experience:{}}),
    invokeModel:async()=>{calls++;return '{"action":"defer","reason":"以后再考虑"}'},
    beginTrace:args=>journal.begin(args)})
  const w=await willing.decide({trigger:'comment-received',sourceKey:'private-key',candidates:[{id:'candidate_1',kind:'comment_reply',label:'private text'}]})
  assert.equal(w.action,'defer');assert.equal(calls,2)
  assert.equal(journal.list().runs.find(r=>r.mode==='willingness').explanation.category,'voluntary-defer')
  assert.doesNotMatch(JSON.stringify(journal.list()),/private text|private-key|secret-title/)
}))

test('management console consumes only read-only projected explanation and labels uncertain receipts safely',()=>{
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  assert.match(js,/const explanations=\{/)
  assert.match(js,/item\.explanation\?\.category/)
  assert.match(js,/模型选择不等于执行成功/)
  assert.match(js,/外部结果未知，保持安全冻结，不自动重发/)
  assert.match(js,/choice\.code\)/)
  assert.match(html,/id="life-decision-traces-section"/)
})
