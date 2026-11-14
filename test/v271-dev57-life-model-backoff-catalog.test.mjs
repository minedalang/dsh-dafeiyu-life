import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {modelFailureEvidence,modelFailureExplanation,modelTestFailure} from '../lib/model-failure-diagnostics.mjs'
import {systemHealthSnapshot} from '../lib/system-health-projection.mjs'
import {providerIds,modelIds,mergeObservedModel} from '../lib/model-catalog.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

const T=Date.parse('2026-11-10T20:00:00Z')
const SCOPE='a'.repeat(16)
const config=()=>({masterEnabled:true,autonomousPlannerEnabled:true,lifeAgentMode:'active',autonomousPlannerDailyLimit:30,
 autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24,homeRecommendationsEnabled:true})
function planner(dir,now,model){
 return createAutonomousPlanner({dataDir:dir,now:()=>now.value,getConfig:config,getTodos:()=>[],getLifeAccountTag:()=>SCOPE,
 getLifeEvents:()=>[],getLifeEventStatus:()=>({ok:true,events:[],pending:0}),
 getLifeCapabilities:()=>[{id:'bilibili.video-explore',risk:'delegated-existing-permissions'}],
 getLifeCapabilityReadiness:()=>({ok:true}),runLifeCapability:()=>({started:false}),
 getLifeVideoReadiness:()=>({ready:true}),
 invokeModel:model,reflect:async()=>({ok:false}),executeRead:async()=>({ok:false}),updateTodo:async()=>({ok:false})})
}

test('502 upstream gateway is identified without lying about local network and without leaking secrets',()=>{
 const raw='DSH 宿主模型调用失败：502 {"error":{"type":"bad_response_status_code","message":"bad response status code 502 (request id: 20261110132159495722938dznU5fe7)"},"type":"error"} API_KEY=my-secret https://myservice.invalid/token'
 const diag=modelFailureEvidence(Error(raw))
 assert.equal(diag.category,'upstream-gateway');assert.equal(diag.httpStatus,502)
 assert.equal(diag.providerErrorType,'bad_response_status_code')
 assert.equal(diag.requestId,'20261110132159495722938dznU5fe7')
 const report=modelTestFailure(Error(raw))
 assert.match(report.error,/502/);assert.match(report.error,/请求 ID/)
 assert.doesNotMatch(JSON.stringify(report),/my-secret|myservice\.invalid/)
 assert.match(modelFailureExplanation(diag),/无法仅凭/)
})
test('auth, rate limit, timeout and transport have distinct codes; 502 cannot be misclassified as user silence',()=>{
 for(const [err,category] of [['429 rate limit','rate-limited'],['401 Unauthorized','authentication'],['ETIMEDOUT','timeout'],['ENOTFOUND DNS','network'],['502 Bad Gateway','upstream-gateway']])
  assert.equal(modelFailureEvidence(Error(err)).category,category,err)
})
test('health banner shows active backoff count, category, code, last incident and retry time; not stale failures',()=>{
 const planner={modelFailureCode:'upstream-gateway',modelFailureStreak:3,modelFailureAt:T-30000,
  modelRetryAt:T+15*60_000,modelFailureEvidence:{httpStatus:502,providerErrorType:'bad_response_status_code',requestId:'20261110132159495722938dznU5fe7'}}
 const snap=systemHealthSnapshot({now:T,planner,scheduler:{running:true}})
 const issue=snap.issues.find(x=>x.id==='model')
 assert.equal(issue.inBackoff,true);assert.equal(issue.canClear,true);assert.equal(issue.streak,3)
 assert.equal(issue.code,'model-upstream-gateway');assert.match(issue.detail,/502|上游/)
 assert.equal(issue.at,T-30000);assert.equal(issue.retryAt,T+15*60_000)
 assert.equal(issue.technicalEvidence.requestId,'20261110132159495722938dznU5fe7')
 assert.equal(systemHealthSnapshot({now:T+20*60_000,planner,scheduler:{running:true}}).issues.some(x=>x.id==='model'),false)
})
test('current host selected model and saved identifiers can populate UI without fabricating verified adapters',()=>{
 assert.deepEqual(providerIds({providers:[{id:'p1'},'p2',{id:'p1'}]}),['p1','p2'])
 assert.deepEqual(modelIds({models:[{id:'m1'},'m2']}),['m1','m2'])
 const observed=mergeObservedModel([],{provider:'my-provider',model:'my-model'})
 assert.deepEqual(observed,[{id:'my-provider',models:['my-model'],kind:'observed-only',synced:false}])
 assert.deepEqual(mergeObservedModel([{id:'p',models:['one']}],{provider:'p',model:'two'})[0].models,['one','two'])
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(js,/hostObservedModel=r\.observedHostModel/)
 assert.match(js,/include\(c\.pluginDefaultModelProvider,c\.pluginDefaultModelId\)/)
 assert.match(js,/saved-only/)
 assert.match(server,/observedHostModel:provider&&model/)
 assert.match(server,/modelTestFailure\(e\)/)
})
test('clearing Life backoff is CAS guarded, requires active timer and never calls a model or changes call quotas',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev57-life-backoff-')),now={value:T};let calls=0
 try{
  const fail=planner(dir,now,async()=>{calls++;throw Error('502 bad_response_status_code')})
  const result=await fail.tick({force:true});assert.equal(result.ok,false)
  const st=fail.status();assert.equal(st.modelFailureCode,'upstream-gateway');assert.equal(st.modelFailureStreak,1)
  assert.equal(calls,1)
  assert.equal(fail.clearModelBackoff({expectedRetryAt:st.modelRetryAt-1}).ok,false)
  const cleared=fail.clearModelBackoff({expectedRetryAt:st.modelRetryAt})
  assert.equal(cleared.ok,true);assert.equal(cleared.modelCalled,false)
  assert.equal(calls,1)
  const after=fail.status()
  assert.equal(after.modelRetryAt,0);assert.equal(after.modelFailureStreak,0)
  assert.equal(after.lifeRuns,st.lifeRuns);assert.equal(after.runs,st.runs)
  assert.equal(fail.clearModelBackoff({expectedRetryAt:st.modelRetryAt}).ok,false)
  assert.equal(readFileSync(join(dir,'autonomous-planner.json'),'utf8').includes('bad_response_status_code'),false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('management UI owns a guarded clear action and duty charter is not quota authority',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const server=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const duty=readFileSync(new URL('../prompts/duty.md',import.meta.url),'utf8')
 assert.match(html,/life-health-clear-model-backoff/)
 assert.match(ui,/expectedRetryAt/);assert.match(ui,/confirm:true,expectedRetryAt/)
 assert.match(server,/autonomousPlanner\.clearModelBackoff/)
 assert.match(duty,/不是配额数据库或授权服务/)
 assert.match(duty,/每日选片数量没有上限/)
})
